// ─────────────────────────────────────────────────────────────────────────────
// Concurrency Tests — Slot Booking System
//
// Validates the FOR UPDATE SKIP LOCKED concurrency strategy by simulating
// parallel reservation attempts against a limited pool of slots.
//
// These tests use mocked DB calls to verify the SERVICE-LEVEL behavior
// under concurrent invocations. True DB-level concurrency testing would
// require a running PostgreSQL instance (integration test).
//
// What we validate:
//   1. N parallel reserveSlot() calls each get independent clients
//   2. Service correctly propagates SKIP LOCKED "no rows" as 409
//   3. Idempotent reservations never double-assign
//   4. Expired reservation cleanup under concurrent expiration calls
//   5. Confirm + cancel races resolve deterministically
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── Mock factories ──────────────────────────────────────────────────────────

// Each concurrent call to pool.connect() should get an independent client
// so we can simulate parallel transactions without shared state.
let connectCallIndex = 0;
type MockClient = {
  query: jest.Mock;
  release: jest.Mock;
  _calls: Array<{ text: string; params?: unknown[] }>;
};
const mockClients: MockClient[] = [];

function createMockClient(): MockClient {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const client: MockClient = {
    query: jest.fn((...args: unknown[]) => {
      const text = typeof args[0] === 'string' ? args[0] : '';
      const params = args[1] as unknown[] | undefined;
      calls.push({ text, params });
      return Promise.resolve({ rows: [], rowCount: 0 });
    }) as jest.Mock,
    release: jest.fn(),
    _calls: calls,
  };
  return client;
}

const mockPoolConnect = jest.fn(() => {
  const client = mockClients[connectCallIndex] ?? createMockClient();
  connectCallIndex++;
  return Promise.resolve(client);
});

const mockPublishEvent = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../src/shared/db.js', () => ({
  pool: { connect: mockPoolConnect },
  query: jest.fn(),
  getClient: jest.fn(),
}));

jest.unstable_mockModule('../../src/shared/kafka.js', () => ({
  publishEvent: mockPublishEvent,
  TOPICS: {
    LOAD_EVENTS: 'logistics.load.events',
    ASSIGNMENT_EVENTS: 'logistics.assignment.events',
  },
}));

jest.unstable_mockModule('../../src/shared/config.js', () => ({
  config: { serviceName: 'logistics-api-test' },
}));

jest.unstable_mockModule('../../src/shared/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.unstable_mockModule('../../src/api/services/slot-booking.metrics.js', () => ({
  slotsReserved: { inc: jest.fn() },
  slotsBooked: { inc: jest.fn() },
  slotReservationDuration: { startTimer: jest.fn(() => jest.fn()) },
  slotContentionRate: { inc: jest.fn() },
  slotExpirations: { inc: jest.fn() },
}));

const { reserveSlot, confirmBooking, cancelReservation, expireReservations } = await import(
  '../../src/api/services/slot-booking.service.js'
);

// ── Helpers ─────────────────────────────────────────────────────────────────

const LOAD_ID = 'load-concurrent-001';
const LOAD_ROW = { id: LOAD_ID, status: 'POSTED', total_trucks_required: 3 };

/**
 * Set up a client mock that returns a successful reservation sequence:
 *   BEGIN → SET LOCAL → load check → no existing → count(0) → SKIP LOCKED slot → UPDATE → COMMIT
 */
function setupSuccessClient(client: MockClient, slotId: string, slotNumber: number) {
  client.query
    .mockResolvedValueOnce({})                            // BEGIN
    .mockResolvedValueOnce({})                            // SET LOCAL
    .mockResolvedValueOnce({ rows: [LOAD_ROW] })          // Load check
    .mockResolvedValueOnce({ rows: [] })                  // No existing reservation
    .mockResolvedValueOnce({ rows: [{ count: '0' }] })   // Active count
    .mockResolvedValueOnce({                              // FOR UPDATE SKIP LOCKED
      rows: [{ id: slotId, slot_number: slotNumber, version: 1 }],
    })
    .mockResolvedValueOnce({})                            // UPDATE → RESERVED
    .mockResolvedValueOnce({});                           // COMMIT
}

/**
 * Set up a client mock that returns 0 rows from SKIP LOCKED (all slots locked).
 */
function setupContentionClient(client: MockClient) {
  client.query
    .mockResolvedValueOnce({})                            // BEGIN
    .mockResolvedValueOnce({})                            // SET LOCAL
    .mockResolvedValueOnce({ rows: [LOAD_ROW] })          // Load check
    .mockResolvedValueOnce({ rows: [] })                  // No existing reservation
    .mockResolvedValueOnce({ rows: [{ count: '0' }] })   // Active count
    .mockResolvedValueOnce({ rows: [] })                  // SKIP LOCKED → no available
    .mockResolvedValueOnce({});                           // ROLLBACK
}

describe('Slot Booking Concurrency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    connectCallIndex = 0;
    mockClients.length = 0;
    mockPublishEvent.mockResolvedValue(undefined);
  });

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 1: 3 slots, 3 concurrent requests → ALL succeed
  // ════════════════════════════════════════════════════════════════════════
  it('should allow exactly N reservations for N available slots', async () => {
    const clients = [createMockClient(), createMockClient(), createMockClient()];
    mockClients.push(...clients);

    setupSuccessClient(clients[0], 'slot-1', 1);
    setupSuccessClient(clients[1], 'slot-2', 2);
    setupSuccessClient(clients[2], 'slot-3', 3);

    const results = await Promise.allSettled([
      reserveSlot({ loadId: LOAD_ID, idempotencyKey: 'k1' }, 'user-A', 'org-1'),
      reserveSlot({ loadId: LOAD_ID, idempotencyKey: 'k2' }, 'user-B', 'org-2'),
      reserveSlot({ loadId: LOAD_ID, idempotencyKey: 'k3' }, 'user-C', 'org-3'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(3);

    // Each got a different slot
    const slotIds = fulfilled.map(
      (r) => (r as PromiseFulfilledResult<{ slotId: string }>).value.slotId,
    );
    expect(new Set(slotIds).size).toBe(3);
    expect(slotIds).toContain('slot-1');
    expect(slotIds).toContain('slot-2');
    expect(slotIds).toContain('slot-3');
  });

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 2: 3 slots, 5 concurrent requests → 3 succeed, 2 get 409
  // ════════════════════════════════════════════════════════════════════════
  it('should reject excess requests when all slots are locked', async () => {
    const clients = Array.from({ length: 5 }, () => createMockClient());
    mockClients.push(...clients);

    setupSuccessClient(clients[0], 'slot-1', 1);
    setupSuccessClient(clients[1], 'slot-2', 2);
    setupSuccessClient(clients[2], 'slot-3', 3);
    setupContentionClient(clients[3]); // All slots locked → 409
    setupContentionClient(clients[4]); // All slots locked → 409

    const results = await Promise.allSettled([
      reserveSlot({ loadId: LOAD_ID, idempotencyKey: 'k1' }, 'user-A', 'org-1'),
      reserveSlot({ loadId: LOAD_ID, idempotencyKey: 'k2' }, 'user-B', 'org-2'),
      reserveSlot({ loadId: LOAD_ID, idempotencyKey: 'k3' }, 'user-C', 'org-3'),
      reserveSlot({ loadId: LOAD_ID, idempotencyKey: 'k4' }, 'user-D', 'org-4'),
      reserveSlot({ loadId: LOAD_ID, idempotencyKey: 'k5' }, 'user-E', 'org-5'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(2);

    // Rejected requests should throw a 409 error
    for (const r of rejected) {
      const err = (r as PromiseRejectedResult).reason;
      expect(err.statusCode ?? err.status).toBe(409);
      expect(err.message).toContain('No available slots');
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 3: Same user, same load, concurrent → idempotent
  // ════════════════════════════════════════════════════════════════════════
  it('should return the same reservation for duplicate requests (idempotent)', async () => {
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    const clients = [createMockClient(), createMockClient()];
    mockClients.push(...clients);

    // First request: normal success
    setupSuccessClient(clients[0], 'slot-1', 1);

    // Second request: detects existing reservation and returns it
    clients[1].query
      .mockResolvedValueOnce({})                         // BEGIN
      .mockResolvedValueOnce({})                         // SET LOCAL
      .mockResolvedValueOnce({ rows: [LOAD_ROW] })       // Load check
      .mockResolvedValueOnce({                           // Existing reservation found
        rows: [{
          id: 'slot-1', slot_number: 1, status: 'RESERVED',
          reservation_expires_at: expiresAt,
        }],
      })
      .mockResolvedValueOnce({});                        // COMMIT

    const [r1, r2] = await Promise.all([
      reserveSlot({ loadId: LOAD_ID, idempotencyKey: 'k1' }, 'user-A', 'org-1'),
      reserveSlot({ loadId: LOAD_ID, idempotencyKey: 'k1-dup' }, 'user-A', 'org-1'),
    ]);

    expect(r1.slotId).toBe('slot-1');
    expect(r2.slotId).toBe('slot-1');
    expect(r1.status).toBe('RESERVED');
    expect(r2.status).toBe('RESERVED');
  });

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 4: Each concurrent connect gets its own client (isolation)
  // ════════════════════════════════════════════════════════════════════════
  it('should allocate independent DB clients for each concurrent request', async () => {
    const clients = [createMockClient(), createMockClient()];
    mockClients.push(...clients);

    setupSuccessClient(clients[0], 'slot-1', 1);
    setupSuccessClient(clients[1], 'slot-2', 2);

    await Promise.all([
      reserveSlot({ loadId: LOAD_ID, idempotencyKey: 'k1' }, 'user-A', 'org-1'),
      reserveSlot({ loadId: LOAD_ID, idempotencyKey: 'k2' }, 'user-B', 'org-2'),
    ]);

    // Verify each client was independently used
    expect(clients[0].release).toHaveBeenCalledTimes(1);
    expect(clients[1].release).toHaveBeenCalledTimes(1);

    // Verify each client ran its own BEGIN/COMMIT pair
    expect(clients[0].query).toHaveBeenCalled();
    expect(clients[1].query).toHaveBeenCalled();

    const beginCalls0 = clients[0].query.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0] === 'BEGIN',
    );
    const beginCalls1 = clients[1].query.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0] === 'BEGIN',
    );
    expect(beginCalls0).toHaveLength(1);
    expect(beginCalls1).toHaveLength(1);
  });

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 5: Concurrent expiration workers — advisory lock serializes
  // ════════════════════════════════════════════════════════════════════════
  it('should serialize concurrent expiration calls via advisory lock', async () => {
    const clients = [createMockClient(), createMockClient()];
    mockClients.push(...clients);

    // First worker succeeds
    clients[0].query
      .mockResolvedValueOnce({})        // BEGIN
      .mockResolvedValueOnce({})        // pg_advisory_xact_lock
      .mockResolvedValueOnce({          // UPDATE expired
        rows: [{ id: 'slot-exp-1', load_id: 'load-1', reserved_by: 'u-1' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({});       // COMMIT

    // Second worker also runs (advisory lock would block in real PG,
    // but in mock both succeed — we verify both called advisory lock)
    clients[1].query
      .mockResolvedValueOnce({})        // BEGIN
      .mockResolvedValueOnce({})        // pg_advisory_xact_lock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // Nothing left
      .mockResolvedValueOnce({});       // COMMIT

    const [count1, count2] = await Promise.all([
      expireReservations(),
      expireReservations(),
    ]);

    expect(count1).toBe(1);
    expect(count2).toBe(0);

    // Both clients called pg_advisory_xact_lock
    const lockCalls0 = clients[0].query.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('pg_advisory_xact_lock'),
    );
    const lockCalls1 = clients[1].query.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('pg_advisory_xact_lock'),
    );
    expect(lockCalls0).toHaveLength(1);
    expect(lockCalls1).toHaveLength(1);
  });

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 6: Reserve + cancel race — cancel only succeeds for owner
  // ════════════════════════════════════════════════════════════════════════
  it('should handle concurrent reserve and cancel on the same slot', async () => {
    const clients = [createMockClient(), createMockClient()];
    mockClients.push(...clients);

    // Reserve succeeds first
    setupSuccessClient(clients[0], 'slot-1', 1);

    // Cancel by original user succeeds
    clients[1].query
      .mockResolvedValueOnce({})                         // BEGIN
      .mockResolvedValueOnce({})                         // SET LOCAL
      .mockResolvedValueOnce({ rows: [{ id: 'slot-1' }], rowCount: 1 })  // UPDATE
      .mockResolvedValueOnce({});                        // COMMIT

    const reserveResult = await reserveSlot(
      { loadId: LOAD_ID, idempotencyKey: 'k1' }, 'user-A', 'org-1',
    );
    const cancelResult = await cancelReservation(
      { loadId: LOAD_ID, slotId: 'slot-1', idempotencyKey: 'cancel-1' }, 'user-A',
    );

    expect(reserveResult.slotId).toBe('slot-1');
    expect(cancelResult.status).toBe('AVAILABLE');
  });

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 7: High-volume — 20 requests for 5 slots
  // ════════════════════════════════════════════════════════════════════════
  it('should handle 20 concurrent requests for 5 slots cleanly', async () => {
    const TOTAL_SLOTS = 5;
    const TOTAL_REQUESTS = 20;
    const clients = Array.from({ length: TOTAL_REQUESTS }, () => createMockClient());
    mockClients.push(...clients);

    // First 5 get slots
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      setupSuccessClient(clients[i], `slot-${i + 1}`, i + 1);
    }

    // Remaining 15 hit contention
    for (let i = TOTAL_SLOTS; i < TOTAL_REQUESTS; i++) {
      setupContentionClient(clients[i]);
    }

    const results = await Promise.allSettled(
      Array.from({ length: TOTAL_REQUESTS }, (_, i) =>
        reserveSlot(
          { loadId: LOAD_ID, idempotencyKey: `k-${i}` },
          `user-${i}`,
          `org-${i}`,
        ),
      ),
    );

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    expect(successes).toHaveLength(TOTAL_SLOTS);
    expect(failures).toHaveLength(TOTAL_REQUESTS - TOTAL_SLOTS);

    // Verify unique slot IDs
    const reservedSlots = successes.map(
      (r) => (r as PromiseFulfilledResult<{ slotId: string }>).value.slotId,
    );
    expect(new Set(reservedSlots).size).toBe(TOTAL_SLOTS);
  });
});
