import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();
const mockPoolConnect = jest.fn();

jest.unstable_mockModule('../../src/shared/db.js', () => ({
  pool: {
    connect: mockPoolConnect,
  },
}));

jest.unstable_mockModule('../../src/shared/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { acceptLoad, dispatchLoad } = await import('../../src/api/services/load-acceptance.service.js');

describe('Load acceptance service', () => {
  const mockClient = {
    query: mockClientQuery,
    release: mockClientRelease,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPoolConnect.mockResolvedValue(mockClient);
  });

  it('awards a bid when the shipper owns the load', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('BEGIN')) return { rows: [] };
      if (sql.includes('set_config')) return { rows: [] };
      if (sql.includes('FROM logistics.bids')) {
        return {
          rows: [{
            id: 'bid-1',
            load_id: 'load-1',
            carrier_org_id: 'org-carrier',
            bid_amount_usd: 4200,
            status: 'PENDING',
            truck_id: 'truck-1',
            bidding_driver_id: 'driver-1',
          }],
        };
      }
      if (sql.includes('FROM logistics.loads')) {
        return {
          rows: [{
            id: 'load-1',
            shipper_org_id: 'org-shipper',
            pickup_earliest: '2026-04-05T08:00:00.000Z',
            dropoff_latest: '2026-04-06T18:00:00.000Z',
          }],
        };
      }
      if (sql.includes('FROM logistics.trucks')) {
        return { rows: [{ id: 'truck-1', organization_id: 'org-carrier', assigned_driver_id: 'driver-1' }] };
      }
      if (sql.includes('FROM logistics.driver_profiles')) {
        return { rows: [{ id: 'driver-1', organization_id: 'org-carrier' }] };
      }
      if (sql.includes('INSERT INTO logistics.assignments')) {
        return { rows: [{ id: 'asgn-1', load_id: 'load-1', start_ts: '2026-04-05T08:00:00.000Z', end_ts: '2026-04-06T18:00:00.000Z' }] };
      }
      if (sql.includes('COMMIT')) return { rows: [] };
      if (sql.includes('ROLLBACK')) return { rows: [] };
      return { rows: [] };
    });

    const result = await acceptLoad({ loadId: 'load-1', bidId: 'bid-1' }, 'user-1', 'org-shipper', 'SHIPPER_STAFF');

    expect(result.assignmentId).toBe('asgn-1');
    expect(result.status).toBe('CONFIRMED');
    expect(result.agreedRateUsd).toBe(4200);
  });

  it('rejects award when a non-owner shipper tries to award the load', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('BEGIN')) return { rows: [] };
      if (sql.includes('set_config')) return { rows: [] };
      if (sql.includes('FROM logistics.bids')) {
        return {
          rows: [{
            id: 'bid-1',
            load_id: 'load-1',
            carrier_org_id: 'org-carrier',
            bid_amount_usd: 4200,
            status: 'PENDING',
            truck_id: 'truck-1',
            bidding_driver_id: 'driver-1',
          }],
        };
      }
      if (sql.includes('FROM logistics.loads')) {
        return {
          rows: [{
            id: 'load-1',
            shipper_org_id: 'org-other-shipper',
            pickup_earliest: '2026-04-05T08:00:00.000Z',
            dropoff_latest: '2026-04-06T18:00:00.000Z',
          }],
        };
      }
      if (sql.includes('ROLLBACK')) return { rows: [] };
      return { rows: [] };
    });

    await expect(
      acceptLoad({ loadId: 'load-1', bidId: 'bid-1' }, 'user-1', 'org-shipper', 'SHIPPER_STAFF'),
    ).rejects.toThrow('Only the shipper org can award this bid');
  });

  it('rejects dispatch when the caller is not the assigned carrier org', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('BEGIN')) return { rows: [] };
      if (sql.includes('set_config')) return { rows: [] };
      if (sql.includes('FROM logistics.assignments')) {
        return {
          rows: [{
            id: 'asgn-1',
            load_id: 'load-1',
            carrier_org_id: 'org-carrier',
            status: 'ACTIVE',
            dispatched_at: null,
          }],
        };
      }
      if (sql.includes('ROLLBACK')) return { rows: [] };
      return { rows: [] };
    });

    await expect(
      dispatchLoad('load-1', 'asgn-1', 'user-1', 'org-other-carrier', 'DISPATCHER'),
    ).rejects.toThrow('Only the assigned carrier can dispatch this load');
  });
});