// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — Load Service
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockQuery = jest.fn();
const mockGetClient = jest.fn();
const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();

const mockPublishEvent = jest.fn();

jest.unstable_mockModule('../../src/shared/db.js', () => ({
  query: mockQuery,
  getClient: mockGetClient,
}));

jest.unstable_mockModule('../../src/shared/kafka.js', () => ({
  publishEvent: mockPublishEvent,
  TOPICS: { LOAD_EVENTS: 'logistics.loads.events' },
}));

jest.unstable_mockModule('../../src/shared/metrics.js', () => ({
  loadsCreated: { inc: jest.fn() },
}));

jest.unstable_mockModule('../../src/shared/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.unstable_mockModule('../../src/shared/elasticsearch.js', () => ({
  indexLoad: jest.fn().mockResolvedValue(undefined),
  removeLoad: jest.fn().mockResolvedValue(undefined),
}));

const { createLoad, getLoad, postLoad, cancelLoad, updateLoad } = await import(
  '../../src/api/services/load.service.js'
);

describe('Load Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPublishEvent.mockResolvedValue(undefined);
    mockGetClient.mockResolvedValue({
      query: mockClientQuery,
      release: mockClientRelease,
    });
  });

  describe('createLoad', () => {
    it('should create a load and return id + reference number', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [{ distance: 500 }] })  // PostGIS distance
        .mockResolvedValueOnce({
          rows: [{ id: 'load-1', reference_number: 'LD-20250101-0001' }],
        })  // INSERT ... RETURNING
        .mockResolvedValueOnce({});  // COMMIT

      const result = await createLoad({
        cargoType: 'DRY_VAN',
        commodity: 'Electronics',
        weightLbs: 10000,
        pickupAddress: '123 Main St',
        pickupCity: 'Dallas',
        pickupState: 'TX',
        pickupZip: '75201',
        pickupLat: 32.78,
        pickupLng: -96.80,
        pickupEarliest: '2025-01-15T08:00:00Z',
        pickupLatest: '2025-01-15T17:00:00Z',
        dropoffAddress: '456 Oak Ave',
        dropoffCity: 'Houston',
        dropoffState: 'TX',
        dropoffZip: '77001',
        dropoffLat: 29.76,
        dropoffLng: -95.37,
        dropoffEarliest: '2025-01-16T08:00:00Z',
        dropoffLatest: '2025-01-16T17:00:00Z',
        offeredRateUsd: 1500,
      }, 'user-1', 'org-1');

      expect(result.loadId).toBe('load-1');
      expect(result.referenceNumber).toBe('LD-20250101-0001');
      expect(mockPublishEvent).toHaveBeenCalledWith(
        'logistics.loads.events',
        expect.objectContaining({ eventType: 'load.created' }),
      );
    });
  });

  describe('getLoad', () => {
    it('should return a load by ID', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: 'load-1',
        status: 'DRAFT',
        commodity: 'Electronics',
      }]);

      const result = await getLoad('load-1', 'user-1');
      expect(result.id).toBe('load-1');
    });

    it('should throw 404 when load not found', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await expect(getLoad('missing', 'user-1')).rejects.toThrow('Load not found');
    });
  });

  describe('postLoad', () => {
    it('should transition DRAFT → POSTED', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: 'load-1',
        cargo_type: 'DRY_VAN',
        status: 'POSTED',
        load_board_visible: true,
        shipper_org_id: 'org-1',
        reference_number: 'LD-001',
        commodity: 'Test',
        weight_lbs: 5000,
        pickup_city: 'Dallas',
        pickup_state: 'TX',
        pickup_zip: '75201',
        pickup_earliest: '2025-01-15T08:00:00Z',
        pickup_latest: '2025-01-15T17:00:00Z',
        dropoff_city: 'Houston',
        dropoff_state: 'TX',
        dropoff_zip: '77001',
        dropoff_earliest: '2025-01-16T08:00:00Z',
        dropoff_latest: '2025-01-16T17:00:00Z',
        distance_miles: 240,
        offered_rate_usd: 1500,
        rate_per_mile_usd: 6.25,
        special_requirements: null,
        created_at: '2025-01-15T00:00:00Z',
      }]);

      const result = await postLoad('load-1', 'user-1');
      expect(result.status).toBe('POSTED');
      expect(mockPublishEvent).toHaveBeenCalled();
    });

    it('should throw 409 if not in DRAFT status', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await expect(postLoad('load-1', 'user-1')).rejects.toThrow(
        'Load must be in DRAFT status to post',
      );
    });
  });

  describe('cancelLoad', () => {
    it('should cancel an active load', async () => {
      // getLoad call
      mockQuery
        .mockResolvedValueOnce([{ id: 'load-1', status: 'POSTED' }])
        .mockResolvedValueOnce([]); // UPDATE

      await cancelLoad('load-1', 'Changed plans', 'user-1');
      expect(mockPublishEvent).toHaveBeenCalledWith(
        'logistics.loads.events',
        expect.objectContaining({ eventType: 'load.cancelled' }),
      );
    });

    it('should throw 409 when cancelling a DELIVERED load', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'load-1', status: 'DELIVERED' }]);

      await expect(cancelLoad('load-1', 'test', 'user-1')).rejects.toThrow(
        'Cannot cancel load in DELIVERED status',
      );
    });
  });

  describe('updateLoad', () => {
    it('should throw 400 with no fields', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'load-1', status: 'DRAFT' }]);

      await expect(updateLoad('load-1', {}, 'user-1')).rejects.toThrow('No fields to update');
    });
  });
});
