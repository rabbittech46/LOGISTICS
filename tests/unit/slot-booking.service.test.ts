// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — Slot Booking Service
//
// Tests the core reservation/booking engine with mocked DB interactions.
// Validates:
//   - Slot allocation (reserve, confirm, cancel)
//   - Idempotency (duplicate reservation returns same slot)
//   - Guard rails (capacity check, expiration, wrong owner)
//   - Error paths (no slots, expired, wrong status)
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── Mock setup ──────────────────────────────────────────────────────────────

const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();
const mockPoolConnect = jest.fn();

const mockPublishEvent = jest.fn();

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

const {
  reserveSlot,
  confirmBooking,
  cancelReservation,
  getSlotSummary,
  getMyReservation,
  expireReservations,
  cleanupIdempotencyKeys,
} = await import('../../src/api/services/slot-booking.service.js');

// ── Helpers ─────────────────────────────────────────────────────────────────

function setupMockClient() {
  mockPoolConnect.mockResolvedValue({
    query: mockClientQuery,
    release: mockClientRelease,
  });
}

const USER_ID = 'user-001';
const ORG_ID = 'org-001';
const LOAD_ID = 'load-001';
const SLOT_ID = 'slot-001';

describe('Slot Booking Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPublishEvent.mockResolvedValue(undefined);
    setupMockClient();
  });

  // ════════════════════════════════════════════════════════════════════════
  // reserveSlot
  // ════════════════════════════════════════════════════════════════════════
  describe('reserveSlot', () => {
    it('should reserve an available slot atomically', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({    // Load check (FOR SHARE)
          rows: [{ id: LOAD_ID, status: 'POSTED', total_trucks_required: 5 }],
        })
        .mockResolvedValueOnce({ rows: [] })  // Existing reservation check
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })  // Active reservation count
        .mockResolvedValueOnce({    // SELECT ... FOR UPDATE SKIP LOCKED
          rows: [{ id: SLOT_ID, slot_number: 1, version: 1 }],
        })
        .mockResolvedValueOnce({})  // UPDATE slot → RESERVED
        .mockResolvedValueOnce({}); // COMMIT

      const result = await reserveSlot(
        { loadId: LOAD_ID, idempotencyKey: 'idem-1' },
        USER_ID,
        ORG_ID,
      );

      expect(result.slotId).toBe(SLOT_ID);
      expect(result.loadId).toBe(LOAD_ID);
      expect(result.slotNumber).toBe(1);
      expect(result.status).toBe('RESERVED');
      expect(result.reservationExpiresAt).toBeDefined();

      // Verify FOR UPDATE SKIP LOCKED was used
      const skipLockedCall = mockClientQuery.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('FOR UPDATE SKIP LOCKED'),
      );
      expect(skipLockedCall).toBeDefined();
    });

    it('should return existing reservation when user already has one (idempotent)', async () => {
      const expiresAt = new Date(Date.now() + 300_000).toISOString();

      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({    // Load check
          rows: [{ id: LOAD_ID, status: 'POSTED', total_trucks_required: 5 }],
        })
        .mockResolvedValueOnce({    // Existing reservation — already reserved
          rows: [{
            id: SLOT_ID,
            slot_number: 3,
            status: 'RESERVED',
            reservation_expires_at: expiresAt,
          }],
        })
        .mockResolvedValueOnce({}); // COMMIT

      const result = await reserveSlot(
        { loadId: LOAD_ID, idempotencyKey: 'idem-2' },
        USER_ID,
        ORG_ID,
      );

      expect(result.slotId).toBe(SLOT_ID);
      expect(result.slotNumber).toBe(3);
      expect(result.status).toBe('RESERVED');
    });

    it('should throw 409 when user already has BOOKED slot on load', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({    // Load check
          rows: [{ id: LOAD_ID, status: 'POSTED', total_trucks_required: 5 }],
        })
        .mockResolvedValueOnce({    // Existing — already BOOKED
          rows: [{ id: SLOT_ID, slot_number: 1, status: 'BOOKED', reservation_expires_at: null }],
        })
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(
        reserveSlot({ loadId: LOAD_ID, idempotencyKey: 'idem-3' }, USER_ID, ORG_ID),
      ).rejects.toThrow('You already have a confirmed booking on this load');
    });

    it('should throw 409 when no available slots (all locked or booked)', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({    // Load check
          rows: [{ id: LOAD_ID, status: 'POSTED', total_trucks_required: 2 }],
        })
        .mockResolvedValueOnce({ rows: [] })   // No existing reservation
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })  // Count check
        .mockResolvedValueOnce({ rows: [] })   // FOR UPDATE SKIP LOCKED — nothing available
        .mockResolvedValueOnce({});             // ROLLBACK

      await expect(
        reserveSlot({ loadId: LOAD_ID, idempotencyKey: 'idem-4' }, USER_ID, ORG_ID),
      ).rejects.toThrow('No available slots');
    });

    it('should throw 404 when load does not exist', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({ rows: [] })  // Load not found
        .mockResolvedValueOnce({});            // ROLLBACK

      await expect(
        reserveSlot({ loadId: 'nonexistent', idempotencyKey: 'idem-5' }, USER_ID, ORG_ID),
      ).rejects.toThrow('Load not found');
    });

    it('should throw 409 when load is in wrong status', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({
          rows: [{ id: LOAD_ID, status: 'CONFIRMED', total_trucks_required: 3 }],
        })
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(
        reserveSlot({ loadId: LOAD_ID, idempotencyKey: 'idem-6' }, USER_ID, ORG_ID),
      ).rejects.toThrow('CONFIRMED status and cannot accept reservations');
    });

    it('should throw 429 when user has too many active reservations', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({
          rows: [{ id: LOAD_ID, status: 'POSTED', total_trucks_required: 5 }],
        })
        .mockResolvedValueOnce({ rows: [] })  // No existing on this load
        .mockResolvedValueOnce({ rows: [{ count: '10' }] })  // At max
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(
        reserveSlot({ loadId: LOAD_ID, idempotencyKey: 'idem-7' }, USER_ID, ORG_ID),
      ).rejects.toThrow('too many active reservations');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // confirmBooking
  // ════════════════════════════════════════════════════════════════════════
  describe('confirmBooking', () => {
    it('should confirm a reserved slot and create a booking', async () => {
      const expiresAt = new Date(Date.now() + 300_000).toISOString();

      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({    // Slot lock + validate
          rows: [{
            id: SLOT_ID, load_id: LOAD_ID, slot_number: 1,
            status: 'RESERVED', reserved_by: USER_ID, reserved_by_org_id: ORG_ID,
            reservation_expires_at: expiresAt, version: 2,
          }],
        })
        .mockResolvedValueOnce({    // Truck validation
          rows: [{ id: 'truck-1', status: 'AVAILABLE' }],
        })
        .mockResolvedValueOnce({})  // UPDATE slot → BOOKED
        .mockResolvedValueOnce({    // INSERT booking
          rows: [{
            id: 'booking-1', load_id: LOAD_ID, slot_id: SLOT_ID,
            driver_id: USER_ID, carrier_org_id: ORG_ID,
            confirmed_at: new Date().toISOString(),
          }],
        })
        .mockResolvedValueOnce({})  // UPDATE truck → BUSY
        .mockResolvedValueOnce({}); // COMMIT

      const result = await confirmBooking(
        {
          loadId: LOAD_ID, slotId: SLOT_ID, truckId: 'truck-1',
          idempotencyKey: 'idem-confirm-1',
        },
        USER_ID,
        ORG_ID,
      );

      expect(result.bookingId).toBe('booking-1');
      expect(result.status).toBe('BOOKED');
      expect(result.slotId).toBe(SLOT_ID);
    });

    it('should return existing booking when slot already BOOKED by same user (idempotent)', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({    // Slot is already BOOKED by this user
          rows: [{
            id: SLOT_ID, load_id: LOAD_ID, slot_number: 1,
            status: 'BOOKED', reserved_by: USER_ID, reserved_by_org_id: ORG_ID,
            reservation_expires_at: null, version: 3,
          }],
        })
        .mockResolvedValueOnce({    // Fetch existing booking
          rows: [{
            id: 'booking-existing', load_id: LOAD_ID, slot_id: SLOT_ID,
            driver_id: USER_ID, carrier_org_id: ORG_ID,
            confirmed_at: '2026-03-26T10:00:00Z',
          }],
        })
        .mockResolvedValueOnce({}); // COMMIT

      const result = await confirmBooking(
        {
          loadId: LOAD_ID, slotId: SLOT_ID, truckId: 'truck-1',
          idempotencyKey: 'idem-confirm-2',
        },
        USER_ID,
        ORG_ID,
      );

      expect(result.bookingId).toBe('booking-existing');
      expect(result.status).toBe('BOOKED');
    });

    it('should throw 409 when slot is not in RESERVED status', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({
          rows: [{
            id: SLOT_ID, load_id: LOAD_ID, slot_number: 1,
            status: 'AVAILABLE', reserved_by: null, reserved_by_org_id: null,
            reservation_expires_at: null, version: 1,
          }],
        })
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(
        confirmBooking(
          { loadId: LOAD_ID, slotId: SLOT_ID, truckId: 'truck-1', idempotencyKey: 'idem-confirm-3' },
          USER_ID, ORG_ID,
        ),
      ).rejects.toThrow('Slot is AVAILABLE');
    });

    it('should throw 403 when slot reserved by different user', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({
          rows: [{
            id: SLOT_ID, load_id: LOAD_ID, slot_number: 1,
            status: 'RESERVED', reserved_by: 'other-user', reserved_by_org_id: 'other-org',
            reservation_expires_at: new Date(Date.now() + 300_000).toISOString(), version: 2,
          }],
        })
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(
        confirmBooking(
          { loadId: LOAD_ID, slotId: SLOT_ID, truckId: 'truck-1', idempotencyKey: 'idem-confirm-4' },
          USER_ID, ORG_ID,
        ),
      ).rejects.toThrow('reserved by another user');
    });

    it('should throw 410 when reservation has expired', async () => {
      const expiredAt = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago

      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({
          rows: [{
            id: SLOT_ID, load_id: LOAD_ID, slot_number: 1,
            status: 'RESERVED', reserved_by: USER_ID, reserved_by_org_id: ORG_ID,
            reservation_expires_at: expiredAt, version: 2,
          }],
        })
        .mockResolvedValueOnce({})  // UPDATE slot → AVAILABLE (cleanup)
        .mockResolvedValueOnce({})  // COMMIT
        .mockResolvedValueOnce({}); // ROLLBACK (from re-throw)

      await expect(
        confirmBooking(
          { loadId: LOAD_ID, slotId: SLOT_ID, truckId: 'truck-1', idempotencyKey: 'idem-confirm-5' },
          USER_ID, ORG_ID,
        ),
      ).rejects.toThrow('Reservation expired');
    });

    it('should throw 404 when truck not found in org', async () => {
      const expiresAt = new Date(Date.now() + 300_000).toISOString();

      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({
          rows: [{
            id: SLOT_ID, load_id: LOAD_ID, slot_number: 1,
            status: 'RESERVED', reserved_by: USER_ID, reserved_by_org_id: ORG_ID,
            reservation_expires_at: expiresAt, version: 2,
          }],
        })
        .mockResolvedValueOnce({ rows: [] })  // Truck not found
        .mockResolvedValueOnce({});             // ROLLBACK

      await expect(
        confirmBooking(
          { loadId: LOAD_ID, slotId: SLOT_ID, truckId: 'bad-truck', idempotencyKey: 'idem-confirm-6' },
          USER_ID, ORG_ID,
        ),
      ).rejects.toThrow('Truck not found');
    });

    it('should throw 409 when truck is not AVAILABLE', async () => {
      const expiresAt = new Date(Date.now() + 300_000).toISOString();

      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({
          rows: [{
            id: SLOT_ID, load_id: LOAD_ID, slot_number: 1,
            status: 'RESERVED', reserved_by: USER_ID, reserved_by_org_id: ORG_ID,
            reservation_expires_at: expiresAt, version: 2,
          }],
        })
        .mockResolvedValueOnce({ rows: [{ id: 'truck-1', status: 'BUSY' }] })
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(
        confirmBooking(
          { loadId: LOAD_ID, slotId: SLOT_ID, truckId: 'truck-1', idempotencyKey: 'idem-confirm-7' },
          USER_ID, ORG_ID,
        ),
      ).rejects.toThrow('Truck is BUSY');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // cancelReservation
  // ════════════════════════════════════════════════════════════════════════
  describe('cancelReservation', () => {
    it('should cancel a RESERVED slot and set it AVAILABLE', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({    // UPDATE ... RETURNING
          rows: [{ id: SLOT_ID }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({}); // COMMIT

      const result = await cancelReservation(
        { loadId: LOAD_ID, slotId: SLOT_ID, idempotencyKey: 'cancel-1' },
        USER_ID,
      );

      expect(result.slotId).toBe(SLOT_ID);
      expect(result.status).toBe('AVAILABLE');
    });

    it('should return success when slot is already AVAILABLE (idempotent)', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // UPDATE returned nothing
        .mockResolvedValueOnce({
          rows: [{ id: SLOT_ID, status: 'AVAILABLE', reserved_by: null }],
        })  // Check slot exists
        .mockResolvedValueOnce({}); // COMMIT

      const result = await cancelReservation(
        { loadId: LOAD_ID, slotId: SLOT_ID, idempotencyKey: 'cancel-2' },
        USER_ID,
      );

      expect(result.status).toBe('AVAILABLE');
    });

    it('should throw 409 when slot is BOOKED', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{ id: SLOT_ID, status: 'BOOKED', reserved_by: USER_ID }],
        })
        .mockResolvedValueOnce({})  // COMMIT
        .mockResolvedValueOnce({}); // ROLLBACK (in catch)

      await expect(
        cancelReservation(
          { loadId: LOAD_ID, slotId: SLOT_ID, idempotencyKey: 'cancel-3' },
          USER_ID,
        ),
      ).rejects.toThrow('Cannot cancel a confirmed booking');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // getSlotSummary
  // ════════════════════════════════════════════════════════════════════════
  describe('getSlotSummary', () => {
    it('should return slot counts', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({
          rows: [{ total_slots: 10, available_slots: 5, reserved_slots: 3, booked_slots: 2 }],
        })
        .mockResolvedValueOnce({}); // COMMIT

      const result = await getSlotSummary(LOAD_ID, USER_ID);

      expect(result.totalSlots).toBe(10);
      expect(result.availableSlots).toBe(5);
      expect(result.reservedSlots).toBe(3);
      expect(result.bookedSlots).toBe(2);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // expireReservations
  // ════════════════════════════════════════════════════════════════════════
  describe('expireReservations', () => {
    it('should reclaim expired RESERVED slots', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // pg_advisory_xact_lock
        .mockResolvedValueOnce({    // UPDATE expired slots
          rows: [
            { id: 'slot-x1', load_id: 'load-1', reserved_by: 'user-a' },
            { id: 'slot-x2', load_id: 'load-2', reserved_by: 'user-b' },
          ],
          rowCount: 2,
        })
        .mockResolvedValueOnce({}); // COMMIT

      const count = await expireReservations();
      expect(count).toBe(2);
    });

    it('should return 0 when no expired reservations', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // pg_advisory_xact_lock
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // Nothing expired
        .mockResolvedValueOnce({}); // COMMIT

      const count = await expireReservations();
      expect(count).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // cleanupIdempotencyKeys
  // ════════════════════════════════════════════════════════════════════════
  describe('cleanupIdempotencyKeys', () => {
    it('should delete expired keys', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({ rowCount: 15 })  // DELETE
        .mockResolvedValueOnce({}); // COMMIT

      const count = await cleanupIdempotencyKeys();
      expect(count).toBe(15);
    });
  });
});
