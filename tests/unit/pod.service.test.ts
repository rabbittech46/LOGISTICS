import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();
const mockPoolConnect = jest.fn();
const mockSettlePayment = jest.fn();

jest.unstable_mockModule('../../src/shared/db.js', () => ({
  pool: {
    connect: mockPoolConnect,
  },
}));

jest.unstable_mockModule('../../src/shared/config.js', () => ({
  config: {
    awsRegion: 'us-east-1',
    s3PodBucket: 'pod-bucket',
  },
}));

jest.unstable_mockModule('../../src/shared/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  PutObjectCommand: jest.fn(),
}));

jest.unstable_mockModule('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

jest.unstable_mockModule('../../src/api/services/payment.service.js', () => ({
  settlePayment: mockSettlePayment,
}));

const { confirmDelivery } = await import('../../src/api/services/pod.service.js');

describe('POD service', () => {
  const mockClient = {
    query: mockClientQuery,
    release: mockClientRelease,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPoolConnect.mockResolvedValue(mockClient);
  });

  it('confirms delivery and triggers settlement after commit', async () => {
    const callOrder: string[] = [];

    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('BEGIN')) return { rows: [] };
      if (sql.includes('set_config')) return { rows: [] };
      if (sql.includes('FROM logistics.assignments')) {
        return {
          rows: [{
            id: 'asgn-1',
            load_id: 'load-1',
            carrier_org_id: 'org-carrier',
            driver_id: 'driver-1',
            truck_id: 'truck-1',
            agreed_rate_usd: 4500,
            status: 'ACTIVE',
          }],
        };
      }
      if (sql.includes('FROM logistics.loads')) {
        return { rows: [{ status: 'IN_TRANSIT' }] };
      }
      if (sql.includes('FROM logistics.payments')) {
        return { rows: [{ id: 'pay-1', gross_amount_cents: 450000, status: 'ESCROW_HELD' }] };
      }
      if (sql.includes('COMMIT')) {
        callOrder.push('COMMIT');
        return { rows: [] };
      }
      if (sql.includes('ROLLBACK')) return { rows: [] };
      return { rows: [] };
    });

    mockSettlePayment.mockImplementation(async () => {
      callOrder.push('SETTLE_PAYMENT');
    });

    const result = await confirmDelivery({
      assignmentId: 'asgn-1',
      podPhotoKeys: ['pod/asgn-1/photo-1.jpg'],
      podNotes: 'Signed by receiver',
    }, 'user-1', 'org-carrier', 'ORG_ADMIN');

    expect(result.paymentStatus).toBe('RELEASED');
    expect(callOrder).toEqual(['COMMIT', 'SETTLE_PAYMENT']);
    expect(mockSettlePayment).toHaveBeenCalledWith({ paymentId: 'pay-1', assignmentId: 'asgn-1' }, 'user-1');
  });

  it('keeps delivery confirmed when settlement needs follow-up', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('BEGIN')) return { rows: [] };
      if (sql.includes('set_config')) return { rows: [] };
      if (sql.includes('FROM logistics.assignments')) {
        return {
          rows: [{
            id: 'asgn-1',
            load_id: 'load-1',
            carrier_org_id: 'org-carrier',
            driver_id: 'driver-1',
            truck_id: 'truck-1',
            agreed_rate_usd: 4500,
            status: 'ACTIVE',
          }],
        };
      }
      if (sql.includes('FROM logistics.loads')) {
        return { rows: [{ status: 'IN_TRANSIT' }] };
      }
      if (sql.includes('FROM logistics.payments')) {
        return { rows: [{ id: 'pay-1', gross_amount_cents: 450000, status: 'ESCROW_HELD' }] };
      }
      if (sql.includes('COMMIT')) return { rows: [] };
      if (sql.includes('ROLLBACK')) return { rows: [] };
      return { rows: [] };
    });

    mockSettlePayment.mockRejectedValue(new Error('Stripe capture timeout'));

    const result = await confirmDelivery({
      assignmentId: 'asgn-1',
      podPhotoKeys: ['pod/asgn-1/photo-1.jpg'],
    }, 'user-1', 'org-carrier', 'ORG_ADMIN');

    expect(result.paymentStatus).toBe('SETTLEMENT_PENDING');
  });
});