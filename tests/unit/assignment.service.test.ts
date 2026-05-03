// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — Assignment Service
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockQuery = jest.fn();
const mockPoolConnect = jest.fn();
const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();

jest.unstable_mockModule('../../src/shared/db.js', () => ({
  query: mockQuery,
  pool: {
    connect: mockPoolConnect,
  },
}));

jest.unstable_mockModule('../../src/shared/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { getAssignment, listAssignments, recordMilestone, submitRating, cancelAssignment } =
  await import('../../src/api/services/assignment.service.js');

describe('Assignment Service', () => {
  const mockClient = {
    query: mockClientQuery,
    release: mockClientRelease,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPoolConnect.mockResolvedValue(mockClient);
  });

  describe('getAssignment', () => {
    it('should return an assignment by ID', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: 'asgn-1',
        load_id: 'load-1',
        status: 'ACTIVE',
      }]);

      const result = await getAssignment('asgn-1', 'user-1');
      expect(result.id).toBe('asgn-1');
    });

    it('should throw 404 when not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await expect(getAssignment('missing', 'user-1')).rejects.toThrow('Assignment not found');
    });
  });

  describe('listAssignments', () => {
    it('should list assignments with status filter', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'asgn-1', status: 'ACTIVE' },
        { id: 'asgn-2', status: 'ACTIVE' },
      ]);

      const result = await listAssignments('user-1', { status: 'ACTIVE' });
      expect(result).toHaveLength(2);
    });
  });

  describe('recordMilestone', () => {
    it('should record pickup_arrived milestone', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({    // SELECT FOR UPDATE
          rows: [{
            id: 'asgn-1', status: 'ACTIVE', dispatched_at: '2025-01-15T10:00:00Z',
            pickup_arrived_at: null, picked_up_at: null,
            dropoff_arrived_at: null, delivered_at: null,
            load_id: 'load-1',
          }],
        })
        .mockResolvedValueOnce({    // UPDATE RETURNING
          rows: [{ id: 'asgn-1', status: 'ACTIVE', pickup_arrived_at: '2025-01-15T11:00:00Z' }],
        })
        .mockResolvedValueOnce({});  // COMMIT

      const result = await recordMilestone('asgn-1', 'pickup_arrived', 'user-1');
      expect(result.pickup_arrived_at).toBeDefined();
    });

    it('should enforce milestone ordering', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({    // SELECT FOR UPDATE
          rows: [{
            id: 'asgn-1', status: 'ACTIVE', dispatched_at: '2025-01-15T10:00:00Z',
            pickup_arrived_at: null, picked_up_at: null,
            dropoff_arrived_at: null, delivered_at: null,
          }],
        })
        .mockResolvedValueOnce({})  // ROLLBACK
        ;

      await expect(
        recordMilestone('asgn-1', 'picked_up', 'user-1'),
      ).rejects.toThrow('Must record "pickup_arrived" before "picked_up"');
    });

    it('should require dispatched_at before any milestone', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({    // SELECT FOR UPDATE
          rows: [{
            id: 'asgn-1', status: 'ACTIVE', dispatched_at: null,
            pickup_arrived_at: null, picked_up_at: null,
            dropoff_arrived_at: null, delivered_at: null,
          }],
        })
        .mockResolvedValueOnce({})  // ROLLBACK
        ;

      await expect(
        recordMilestone('asgn-1', 'pickup_arrived', 'user-1'),
      ).rejects.toThrow('must be dispatched');
    });
  });

  describe('submitRating', () => {
    it('should submit a shipper rating', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: 'asgn-1', shipper_rating: 5, shipper_review: 'Great!',
      }]);

      const result = await submitRating('asgn-1', 'shipper', 5, 'Great!', 'user-1');
      expect(result.shipper_rating).toBe(5);
    });

    it('should reject invalid rating values', async () => {
      await expect(submitRating('asgn-1', 'shipper', 0, undefined, 'user-1'))
        .rejects.toThrow('Rating must be an integer between 1 and 5');

      await expect(submitRating('asgn-1', 'shipper', 6, undefined, 'user-1'))
        .rejects.toThrow('Rating must be an integer between 1 and 5');
    });

    it('should throw 409 if already rated', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await expect(submitRating('asgn-1', 'carrier', 4, undefined, 'user-1'))
        .rejects.toThrow('already rated');
    });
  });

  describe('cancelAssignment', () => {
    it('should cancel a pre-dispatch assignment', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({    // SELECT FOR UPDATE
          rows: [{ id: 'asgn-1', load_id: 'load-1', truck_id: 'truck-1', dispatched_at: null }],
        })
        .mockResolvedValueOnce({})  // UPDATE assignment
        .mockResolvedValueOnce({})  // UPDATE truck
        .mockResolvedValueOnce({})  // UPDATE load
        .mockResolvedValueOnce({});  // COMMIT

      await cancelAssignment('asgn-1', 'user-1');
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'CANCELLED'"),
        ['asgn-1'],
      );
    });

    it('should throw 409 after dispatch', async () => {
      mockClientQuery
        .mockResolvedValueOnce({})  // BEGIN
        .mockResolvedValueOnce({})  // SET LOCAL
        .mockResolvedValueOnce({    // SELECT FOR UPDATE
          rows: [{ id: 'asgn-1', load_id: 'load-1', truck_id: 'truck-1', dispatched_at: '2025-01-15T10:00:00Z' }],
        })
        .mockResolvedValueOnce({})  // ROLLBACK
        ;

      await expect(cancelAssignment('asgn-1', 'user-1')).rejects.toThrow('Cannot cancel');
    });
  });
});
