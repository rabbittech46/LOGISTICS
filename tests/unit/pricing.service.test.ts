// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — Pricing Service
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock database module
const mockQuery = jest.fn();
jest.unstable_mockModule('../../src/shared/db.js', () => ({
  query: mockQuery,
  pool: { query: mockQuery, connect: jest.fn() },
  shutdownPool: jest.fn(),
}));

jest.unstable_mockModule('../../src/shared/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Must import after mocking
const { calculatePrice } = await import('../../src/api/services/pricing.service.js');

describe('Pricing Service', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  const basePricingModel = {
    id: 'model-1',
    base_rate_cents: 2500,          // $25 base
    per_mile_cents: 250,            // $2.50/mile
    per_lb_cents: 0.5,              // $0.005/lb
    fuel_surcharge_bps: 800,        // 8%
    hazmat_surcharge_bps: 1500,     // 15%
    reefer_surcharge_bps: 1200,     // 12%
    oversized_surcharge_bps: 2000,  // 20%
    surge_multiplier_bps: 10000,    // 1.0x (no surge)
    min_surge_bps: 8000,            // 0.8x floor
    max_surge_bps: 25000,           // 2.5x ceiling
    weekend_surcharge_bps: 500,     // 5%
    holiday_surcharge_bps: 1000,    // 10%
  };

  it('should return contracted lane rate when available', async () => {
    // First query: lane rate
    mockQuery.mockResolvedValueOnce([{ rate_cents: 150000 }]);

    const result = await calculatePrice({
      cargoType: 'DRY_VAN',
      weightLbs: 40000,
      distanceMiles: 500,
      originState: 'TX',
      destState: 'CA',
      pickupDate: '2024-06-15',
      shipperOrgId: 'org-123',
    });

    expect(result.contractedRate).toBe(true);
    expect(result.totalCents).toBe(150000);
    expect(result.surgeMultiplier).toBe(1.0);
  });

  it('should calculate distance-based pricing correctly', async () => {
    // First query: pricing model, then market snapshot
    mockQuery
      .mockResolvedValueOnce([basePricingModel])
      .mockResolvedValueOnce([]);

    const result = await calculatePrice({
      cargoType: 'DRY_VAN',
      weightLbs: 40000,
      distanceMiles: 500,
      originState: 'TX',
      destState: 'CA',
      pickupDate: '2024-06-12',     // Wednesday
    });

    expect(result.contractedRate).toBe(false);
    expect(result.baseCents).toBe(2500);
    expect(result.distanceCents).toBe(125000);        // 500 × 250
    expect(result.weightCents).toBe(20000);            // 40000 × 0.5
    // Subtotal before charges: 2500 + 125000 + 20000 = 147500
    expect(result.fuelSurchargeCents).toBe(11800);     // 147500 × 0.08
    expect(result.surgeCents).toBe(0);                 // 1.0x = no surge
    expect(result.weekendSurchargeCents).toBe(0);      // Wednesday
    expect(result.totalCents).toBe(159300);            // 147500 + 11800
    expect(result.ratePerMileCents).toBe(319);         // 159300 / 500
  });

  it('should apply hazmat surcharge', async () => {
    mockQuery
      .mockResolvedValueOnce([basePricingModel])  // model
      .mockResolvedValueOnce([]);                  // no market snapshot

    const result = await calculatePrice({
      cargoType: 'DRY_VAN',
      weightLbs: 10000,
      distanceMiles: 100,
      originState: 'IL',
      destState: 'IN',
      pickupDate: '2024-06-12',
      isHazmat: true,
    });

    expect(result.cargoSurchargeCents).toBeGreaterThan(0);
    expect(result.breakdown.some((b) => b.component === 'hazmat_surcharge')).toBe(true);
  });

  it('should apply surge pricing for undersupply', async () => {
    mockQuery
      .mockResolvedValueOnce([basePricingModel])
      .mockResolvedValueOnce([{ supply_demand_ratio: 0.5, avg_rate_per_mile: 300 }]); // Low supply

    const result = await calculatePrice({
      cargoType: 'DRY_VAN',
      weightLbs: 10000,
      distanceMiles: 100,
      originState: 'TX',
      destState: 'OK',
      pickupDate: '2024-06-12',
    });

    expect(result.surgeMultiplier).toBeGreaterThan(1.0);
    expect(result.surgeCents).toBeGreaterThan(0);
    expect(result.confidenceScore).toBe(0.9);
  });

  it('should cap surge at max_surge_bps', async () => {
    mockQuery
      .mockResolvedValueOnce([basePricingModel])
      .mockResolvedValueOnce([{ supply_demand_ratio: 0.1, avg_rate_per_mile: 500 }]); // Extreme undersupply

    const result = await calculatePrice({
      cargoType: 'DRY_VAN',
      weightLbs: 10000,
      distanceMiles: 100,
      originState: 'TX',
      destState: 'OK',
      pickupDate: '2024-06-12',
    });

    expect(result.surgeMultiplier).toBeLessThanOrEqual(2.5); // max_surge_bps / 10000
  });

  it('should throw when no pricing model found', async () => {
    mockQuery.mockResolvedValueOnce([]); // No model

    await expect(
      calculatePrice({
        cargoType: 'DRY_VAN',
        weightLbs: 10000,
        distanceMiles: 100,
        originState: 'ZZ',
        destState: 'ZZ',
        pickupDate: '2024-06-12',
      }),
    ).rejects.toThrow('No active pricing model');
  });
});
