// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — Payment Settlement (Two-Phase Pattern)
//
// Validates that Stripe capture happens AFTER DB commit (Phase 2),
// and that a Stripe failure doesn't roll back the ledger.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

const mockPool = {
  connect: jest.fn(() => Promise.resolve(mockClient)),
  query: jest.fn(),
};

jest.unstable_mockModule('../../src/shared/db.js', () => ({
  pool: mockPool,
  query: jest.fn(),
  shutdownPool: jest.fn(),
}));

const mockStripeCapture = jest.fn();
jest.unstable_mockModule('stripe', () => {
  return {
    default: jest.fn(() => ({
      paymentIntents: {
        create: jest.fn(),
        capture: mockStripeCapture,
      },
      webhooks: { constructEvent: jest.fn() },
      transfers: { create: jest.fn() },
    })),
  };
});

jest.unstable_mockModule('../../src/shared/config.js', () => ({
  config: {
    stripeSecretKey: 'sk_test_fake',
    stripeWebhookSecret: 'whsec_test',
    serviceName: 'test',
    platformFeeBps: 1000,
  },
}));

jest.unstable_mockModule('../../src/shared/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.unstable_mockModule('../../src/shared/kafka.js', () => ({
  publishEvent: jest.fn(),
  TOPICS: { PAYMENT_EVENTS: 'logistics.payment.events' },
}));

const { settlePayment } = await import('../../src/api/services/payment.service.js');

describe('Payment Settlement — Two-Phase Pattern', () => {
  const paymentRow = {
    id: 'pay-001',
    processor_payment_id: 'pi_stripe_123',
    gross_amount_cents: 100000,
    platform_fee_cents: 10000,
    net_carrier_cents: 90000,
    advance_amount_cents: 0,
    carrier_org_id: 'org-carrier',
    shipper_org_id: 'org-shipper',
    status: 'ESCROW_HELD',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    mockClient.query.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('BEGIN')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('set_config')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('FROM logistics.payments')) return { rows: [paymentRow] };
      if (typeof sql === 'string' && sql.includes('INSERT INTO logistics.carrier_payouts')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('UPDATE logistics.payments')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('INSERT INTO logistics.ledger_journals')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('SELECT id FROM logistics.ledger_accounts')) return { rows: [{ id: 'acct-1' }] };
      if (typeof sql === 'string' && sql.includes('INSERT INTO logistics.ledger_entries')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('COMMIT')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('ROLLBACK')) return { rows: [] };
      return { rows: [] };
    });
  });

  it('should call Stripe capture AFTER DB commit (Phase 2)', async () => {
    // Track call order
    const callOrder: string[] = [];
    let accountCounter = 0;
    mockClient.query.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('COMMIT')) {
        callOrder.push('COMMIT');
        return { rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('ROLLBACK')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('BEGIN')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('set_config')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('FROM logistics.payments')) return { rows: [paymentRow] };
      if (typeof sql === 'string' && sql.includes('INSERT INTO logistics.carrier_payouts')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('UPDATE logistics.payments')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('INSERT INTO logistics.ledger_journals')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('SELECT id FROM logistics.ledger_accounts')) {
        accountCounter += 1;
        return { rows: [{ id: `acct-${accountCounter}` }] };
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO logistics.ledger_entries')) return { rows: [] };
      return { rows: [] };
    });

    mockStripeCapture.mockImplementation(async () => {
      callOrder.push('STRIPE_CAPTURE');
      return { id: 'pi_stripe_123', status: 'succeeded' };
    });

    await settlePayment({ paymentId: 'pay-001', assignmentId: 'asgn-001' }, 'user-001');

    // Stripe capture must happen AFTER commit
    const commitIdx = callOrder.indexOf('COMMIT');
    const captureIdx = callOrder.indexOf('STRIPE_CAPTURE');
    expect(commitIdx).toBeGreaterThanOrEqual(0);
    expect(captureIdx).toBeGreaterThan(commitIdx);
  });

  it('should NOT roll back DB if Stripe capture fails', async () => {
    mockStripeCapture.mockRejectedValueOnce(new Error('Stripe network timeout'));

    // The function should return without throwing (reconciliation handles retry)
    await expect(
      settlePayment({ paymentId: 'pay-001', assignmentId: 'asgn-001' }, 'user-001'),
    ).resolves.toBeUndefined();

    // DB client should have been released
    expect(mockClient.release).toHaveBeenCalled();

    // ROLLBACK should NOT have been called after COMMIT succeeded
    const rollbackCalls = mockClient.query.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('ROLLBACK'),
    );
    expect(rollbackCalls.length).toBe(0);
  });

  it('should reject settlement for non-ESCROW_HELD payments', async () => {
    const wrongStatusPayment = { ...paymentRow, status: 'DRAFT' };
    mockClient.query
      .mockReset()
      .mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('BEGIN')) return { rows: [] };
        if (typeof sql === 'string' && sql.includes('set_config')) return { rows: [] };
        if (typeof sql === 'string' && sql.includes('FROM logistics.payments')) return { rows: [wrongStatusPayment] };
        if (typeof sql === 'string' && sql.includes('ROLLBACK')) return { rows: [] };
        return { rows: [] };
      });

    await expect(
      settlePayment({ paymentId: 'pay-001', assignmentId: 'asgn-001' }, 'user-001'),
    ).rejects.toThrow('cannot settle');
  });
});
