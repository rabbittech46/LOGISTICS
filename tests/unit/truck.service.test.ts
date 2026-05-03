// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — Truck Service
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockQuery = jest.fn();

jest.unstable_mockModule('../../src/shared/db.js', () => ({
  query: mockQuery,
  getClient: jest.fn(),
}));

jest.unstable_mockModule('../../src/shared/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { createTruck, getTruck, listTrucks, updateTruck } = await import(
  '../../src/api/services/truck.service.js'
);

describe('Truck Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createTruck', () => {
    it('should create a truck and return its ID', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'truck-1' }]);

      const result = await createTruck({
        vin: '1HGBH41JXMN109186',
        plateNumber: 'TX-1234',
        plateState: 'TX',
        make: 'Freightliner',
        model: 'Cascadia',
        year: 2023,
        cargoType: 'DRY_VAN',
        lengthIn: 636,
        widthIn: 102,
        heightIn: 110,
        payloadCapacityLbs: 45000,
        grossVehicleWtLbs: 80000,
        insuranceExpiry: '2026-01-01',
      }, 'user-1', 'org-1');

      expect(result.truckId).toBe('truck-1');
    });
  });

  describe('getTruck', () => {
    it('should return a truck by ID', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: 'truck-1', vin: '1HGBH41JXMN109186', status: 'AVAILABLE',
      }]);

      const result = await getTruck('truck-1', 'user-1');
      expect(result.id).toBe('truck-1');
    });

    it('should throw 404 when not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await expect(getTruck('missing', 'user-1')).rejects.toThrow('Truck not found');
    });
  });

  describe('listTrucks', () => {
    it('should list trucks with optional filters', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'truck-1', status: 'AVAILABLE' },
        { id: 'truck-2', status: 'AVAILABLE' },
      ]);

      const result = await listTrucks('user-1', 'AVAILABLE');
      expect(result).toHaveLength(2);
    });
  });

  describe('updateTruck', () => {
    it('should update truck plate number', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: 'truck-1', plate_number: 'TX-5678', status: 'AVAILABLE',
      }]);

      const result = await updateTruck('truck-1', { plateNumber: 'TX-5678' }, 'user-1');
      expect(result.plate_number).toBe('TX-5678');
    });

    it('should throw 400 with no fields', async () => {
      await expect(updateTruck('truck-1', {}, 'user-1')).rejects.toThrow('No fields to update');
    });

    it('should throw 404 when truck not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await expect(updateTruck('missing', { plateNumber: 'X' }, 'user-1'))
        .rejects.toThrow('Truck not found');
    });
  });
});
