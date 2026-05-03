import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();
const mockPoolConnect = jest.fn();
const mockStripeRetrieve = jest.fn();
const mockConstructEvent = jest.fn();
const mockPublishEvent = jest.fn();

jest.unstable_mockModule('../../src/shared/db.js', () => ({
  pool: {
    connect: mockPoolConnect,
  },
}));

jest.unstable_mockModule('stripe', () => ({
  default: jest.fn(() => ({
    paymentIntents: {
      create: jest.fn(),
      retrieve: mockStripeRetrieve,
      capture: jest.fn(),
    },
    webhooks: {
      constructEvent: mockConstructEvent,
    },
    transfers: {
      create: jest.fn(),
    },
  })),
}));

jest.unstable_mockModule('../../src/shared/config.js', () => ({
  config: {
    stripeSecretKey: 'sk_test_fake',
    stripeWebhookSecret: 'whsec_test',
    serviceName: 'test',
  },
}));

jest.unstable_mockModule('../../src/shared/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule('../../src/shared/kafka.js', () => ({
  publishEvent: mockPublishEvent,
  TOPICS: { PAYMENT_EVENTS: 'logistics.payment.events' },
}));

const { handleStripeWebhook, syncEscrowStatus } = await import('../../src/api/services/payment.service.js');

describe('Payment escrow confirmation', () => {
  const mockClient = {
    query: mockClientQuery,
    release: mockClientRelease,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPoolConnect.mockResolvedValue(mockClient);
  });

  it('marks escrow held when Stripe emits amount_capturable_updated', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'payment_intent.amount_capturable_updated',
      data: {
        object: { id: 'pi_auth_123' },
      },
    });

    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('BEGIN')) return { rows: [] };
      if (sql.includes('UPDATE logistics.payments') && sql.includes("status = 'ESCROW_HELD'")) {
        return {
          rows: [{
            id: 'pay-1',
            assignment_id: 'asgn-1',
            advance_amount_cents: 0,
            carrier_org_id: 'org-carrier',
          }],
        };
      }
      if (sql.includes('COMMIT')) return { rows: [] };
      if (sql.includes('ROLLBACK')) return { rows: [] };
      return { rows: [] };
    });

    await handleStripeWebhook(Buffer.from('payload'), 'sig_test');

    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'ESCROW_HELD'"),
      ['pi_auth_123'],
    );
    expect(mockPublishEvent).toHaveBeenCalledWith(
      'logistics.payment.events',
      expect.objectContaining({ eventType: 'payment.escrow_held', aggregateId: 'pay-1' }),
    );
  });

  it('syncs a pending payment into escrow held when Stripe reports requires_capture', async () => {
    mockStripeRetrieve.mockResolvedValue({
      id: 'pi_auth_456',
      status: 'requires_capture',
    });

    let paymentReadCount = 0;
    mockClientQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('BEGIN')) return { rows: [] };
      if (sql.includes('set_config')) return { rows: [] };
      if (sql.includes('SELECT') && sql.includes('FROM logistics.payments') && sql.includes('WHERE id = $1')) {
        paymentReadCount += 1;
        if (paymentReadCount === 1) {
          return {
            rows: [{
              id: 'pay-2',
              load_id: 'load-2',
              assignment_id: 'asgn-2',
              shipper_org_id: 'org-shipper',
              carrier_org_id: 'org-carrier',
              gross_amount_cents: 125000,
              platform_fee_cents: 10000,
              insurance_fee_cents: 0,
              net_carrier_cents: 115000,
              escrow_amount_cents: 125000,
              advance_pct: 0,
              advance_amount_cents: 0,
              status: 'PENDING',
              payment_method: null,
              processor: 'stripe',
              processor_payment_id: 'pi_auth_456',
              processor_transfer_id: null,
              processor_metadata: {},
              escrow_held_at: null,
              advance_paid_at: null,
              released_at: null,
              refunded_at: null,
              idempotency_key: 'escrow:asgn-2',
              created_at: '2026-04-05T10:00:00.000Z',
              updated_at: '2026-04-05T10:00:00.000Z',
            }],
          };
        }

        return {
          rows: [{
            id: 'pay-2',
            load_id: 'load-2',
            assignment_id: 'asgn-2',
            shipper_org_id: 'org-shipper',
            carrier_org_id: 'org-carrier',
            gross_amount_cents: 125000,
            platform_fee_cents: 10000,
            insurance_fee_cents: 0,
            net_carrier_cents: 115000,
            escrow_amount_cents: 125000,
            advance_pct: 0,
            advance_amount_cents: 0,
            status: 'ESCROW_HELD',
            payment_method: null,
            processor: 'stripe',
            processor_payment_id: 'pi_auth_456',
            processor_transfer_id: null,
            processor_metadata: {},
            escrow_held_at: '2026-04-05T10:02:00.000Z',
            advance_paid_at: null,
            released_at: null,
            refunded_at: null,
            idempotency_key: 'escrow:asgn-2',
            created_at: '2026-04-05T10:00:00.000Z',
            updated_at: '2026-04-05T10:02:00.000Z',
          }],
        };
      }
      if (sql.includes('UPDATE logistics.payments') && sql.includes("status = 'ESCROW_HELD'")) {
        expect(params).toEqual(['pi_auth_456']);
        return {
          rows: [{
            id: 'pay-2',
            assignment_id: 'asgn-2',
            advance_amount_cents: 0,
            carrier_org_id: 'org-carrier',
          }],
        };
      }
      if (sql.includes('COMMIT')) return { rows: [] };
      if (sql.includes('ROLLBACK')) return { rows: [] };
      return { rows: [] };
    });

    const result = await syncEscrowStatus('pay-2', 'user-1', 'org-shipper', 'SHIPPER_STAFF');

    expect(result.stripeIntentStatus).toBe('requires_capture');
    expect(result.payment.status).toBe('ESCROW_HELD');
  });
});