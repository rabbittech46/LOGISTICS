// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — Driver Profile Service
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockQuery = jest.fn();

jest.unstable_mockModule('../../src/shared/db.js', () => ({
  query: mockQuery,
}));

jest.unstable_mockModule('../../src/shared/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const {
  createDriverProfile, getDriverProfile, getDriverProfileByUserId,
  listDrivers, updateDriverProfile, toggleAvailability,
} = await import('../../src/api/services/driver.service.js');

describe('Driver Profile Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createDriverProfile', () => {
    it('should create a driver profile', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'driver-1' }]);

      const result = await createDriverProfile({
        userId: 'user-1',
        cdlNumber: 'CDL-123456',
        cdlClass: 'A',
        cdlState: 'TX',
        cdlExpiry: '2027-06-01',
        hazmatEndorsed: true,
      }, 'org-1', 'admin-user');

      expect(result.driverProfileId).toBe('driver-1');
    });
  });

  describe('getDriverProfile', () => {
    it('should return a driver by ID', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: 'driver-1', cdl_class: 'A', is_available: true,
      }]);

      const result = await getDriverProfile('driver-1', 'user-1');
      expect(result.cdl_class).toBe('A');
    });

    it('should throw 404 when not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await expect(getDriverProfile('missing', 'user-1')).rejects.toThrow('Driver profile not found');
    });
  });

  describe('getDriverProfileByUserId', () => {
    it('should find driver profile by user ID', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'driver-1', user_id: 'user-1' }]);

      const result = await getDriverProfileByUserId('user-1');
      expect(result.user_id).toBe('user-1');
    });
  });

  describe('listDrivers', () => {
    it('should list available drivers only', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'driver-1', is_available: true },
        { id: 'driver-2', is_available: true },
      ]);

      const result = await listDrivers('user-1', true);
      expect(result).toHaveLength(2);
    });
  });

  describe('updateDriverProfile', () => {
    it('should update endorsements', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: 'driver-1', hazmat_endorsed: true, tanker_endorsed: true,
      }]);

      const result = await updateDriverProfile(
        'driver-1',
        { hazmatEndorsed: true, tankerEndorsed: true },
        'admin-user',
      );

      expect(result.hazmat_endorsed).toBe(true);
    });

    it('should throw 400 with empty update', async () => {
      await expect(updateDriverProfile('driver-1', {}, 'user-1'))
        .rejects.toThrow('No fields to update');
    });
  });

  describe('toggleAvailability', () => {
    it('should toggle driver availability', async () => {
      mockQuery.mockResolvedValueOnce([{ is_available: false }]);

      const result = await toggleAvailability('driver-1', false, 'user-1');
      expect(result.is_available).toBe(false);
    });

    it('should throw 404 when driver not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await expect(toggleAvailability('missing', true, 'user-1'))
        .rejects.toThrow('Driver profile not found');
    });
  });
});
