// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — Bid Service
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockQuery = jest.fn();
const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};
const mockGetClient = jest.fn(async () => mockClient);

jest.unstable_mockModule('../../src/shared/db.js', () => ({
  query: mockQuery,
  getClient: mockGetClient,
}));

jest.unstable_mockModule('../../src/shared/kafka.js', () => ({
  publishEvent: jest.fn().mockResolvedValue(undefined),
  TOPICS: { BID_EVENTS: 'logistics.bids.events' },
}));

jest.unstable_mockModule('../../src/shared/metrics.js', () => ({
  bidsPlaced: { inc: jest.fn() },
}));

jest.unstable_mockModule('../../src/shared/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { createBid, getBid, listBidsForLoad, withdrawBid, counterOffer } = await import(
  '../../src/api/services/bid.service.js'
);

describe('Bid Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
  });

  describe('createBid', () => {
    it('should create a bid and return bid ID', async () => {
      mockQuery
        .mockResolvedValueOnce([{ id: 'load-1', status: 'POSTED' }])
        .mockResolvedValueOnce([{ id: 'truck-1' }]);
      mockClient.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          rows: [{
            id: 'bid-1',
            load_id: 'load-1',
            carrier_org_id: 'org-1',
            bidding_driver_id: 'driver-1',
            truck_id: 'truck-1',
            bid_amount_usd: 1200,
            rate_per_mile_usd: null,
            pickup_eta: '2025-01-15T10:00:00Z',
            delivery_eta: '2025-01-16T10:00:00Z',
            notes: null,
            status: 'PENDING',
            counter_offer_usd: null,
            responded_at: null,
            expires_at: null,
            created_at: '2025-01-15T09:00:00Z',
            updated_at: '2025-01-15T09:00:00Z',
          }],
        })
        .mockResolvedValueOnce(undefined);

      const result = await createBid({
        loadId: 'load-1',
        bidAmountUsd: 1200,
        truckId: 'truck-1',
        driverId: 'driver-1',
        pickupEta: '2025-01-15T10:00:00Z',
        deliveryEta: '2025-01-16T10:00:00Z',
      }, 'user-1', 'org-1');

      expect(result.id).toBe('bid-1');
      expect(mockGetClient).toHaveBeenCalledWith('user-1');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO logistics.bids'),
        expect.any(Array),
      );
    });
  });

  describe('getBid', () => {
    it('should return a bid by ID', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: 'bid-1',
        load_id: 'load-1',
        bid_amount_usd: 1200,
        status: 'PENDING',
      }]);

      const result = await getBid('bid-1', 'user-1');
      expect(result.id).toBe('bid-1');
    });

    it('should throw 404 when bid not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await expect(getBid('missing', 'user-1')).rejects.toThrow('Bid not found');
    });
  });

  describe('listBidsForLoad', () => {
    it('should return bids sorted by amount', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'bid-1', bid_amount_usd: 1100 },
        { id: 'bid-2', bid_amount_usd: 1200 },
      ]);

      const result = await listBidsForLoad('load-1', 'user-1');
      expect(result).toHaveLength(2);
      expect(result[0].bid_amount_usd).toBeLessThan(result[1].bid_amount_usd);
    });
  });

  describe('withdrawBid', () => {
    it('should withdraw a pending bid', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'bid-1' }]);

      await expect(withdrawBid('bid-1', 'user-1')).resolves.toBeUndefined();
    });

    it('should throw 409 if bid is not PENDING', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await expect(withdrawBid('bid-1', 'user-1')).rejects.toThrow('Bid cannot be withdrawn');
    });
  });

  describe('counterOffer', () => {
    it('should create a counter offer', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: 'bid-1',
        status: 'COUNTERED',
        counter_offer_usd: 1050,
      }]);

      const result = await counterOffer('bid-1', { counterOfferUsd: 1050 }, 'user-1');
      expect(result.counter_offer_usd).toBe(1050);
    });
  });
});
