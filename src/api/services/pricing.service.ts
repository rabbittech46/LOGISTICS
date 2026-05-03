// ─────────────────────────────────────────────────────────────────────────────
// Pricing Service — Dynamic rate calculation engine
//
// Computes load prices based on:
//   1. Distance (per-mile rates)
//   2. Cargo type surcharges (hazmat, reefer, oversized)
//   3. Supply/demand surge pricing (market snapshot data)
//   4. Fuel surcharge index
//   5. Lane-specific contracted rates
//   6. Time-of-week adjustments (weekend/holiday)
// ─────────────────────────────────────────────────────────────────────────────
import { query } from '../../shared/db.js';
import { logger } from '../../shared/logger.js';
import { AppError } from '../../shared/app-error.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PriceQuoteRequest {
  loadId?: string;
  cargoType: string;
  weightLbs: number;
  distanceMiles: number;
  originState: string;
  destState: string;
  pickupDate: string;      // ISO-8601
  isHazmat?: boolean;
  isOversized?: boolean;
  shipperOrgId?: string;   // For contracted rate lookup
}

export interface PriceQuote {
  baseCents: number;
  distanceCents: number;
  weightCents: number;
  fuelSurchargeCents: number;
  cargoSurchargeCents: number;
  surgeCents: number;
  weekendSurchargeCents: number;
  totalCents: number;
  ratePerMileCents: number;
  surgeMultiplier: number;
  breakdown: PriceBreakdown[];
  contractedRate: boolean;
  confidenceScore: number;
}

export interface PriceBreakdown {
  component: string;
  amountCents: number;
  description: string;
}

// ── DB Row types ────────────────────────────────────────────────────────────

interface PricingModelRow {
  id: string;
  base_rate_cents: number;
  per_mile_cents: number;
  per_lb_cents: number;
  fuel_surcharge_bps: number;
  hazmat_surcharge_bps: number;
  reefer_surcharge_bps: number;
  oversized_surcharge_bps: number;
  surge_multiplier_bps: number;
  min_surge_bps: number;
  max_surge_bps: number;
  weekend_surcharge_bps: number;
  holiday_surcharge_bps: number;
}

interface LaneRateRow {
  rate_cents: number;
}

interface MarketSnapshotRow {
  supply_demand_ratio: number;
  avg_rate_per_mile: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// calculatePrice — main entry point
// ─────────────────────────────────────────────────────────────────────────────
export async function calculatePrice(req: PriceQuoteRequest): Promise<PriceQuote> {
  const breakdown: PriceBreakdown[] = [];

  // 1. Check for contracted lane rate first
  if (req.shipperOrgId) {
    const laneRate = await query<LaneRateRow>(
      `SELECT rate_cents FROM logistics.lane_rates
        WHERE shipper_org_id = $1
          AND origin_state = $2
          AND dest_state = $3
          AND (cargo_type IS NULL OR cargo_type = $4::logistics.cargo_type)
          AND is_active = TRUE
          AND effective_from <= $5::date
          AND (effective_until IS NULL OR effective_until >= $5::date)
          AND (min_weight_lbs IS NULL OR $6 >= min_weight_lbs)
          AND (max_weight_lbs IS NULL OR $6 <= max_weight_lbs)
        ORDER BY cargo_type NULLS LAST
        LIMIT 1`,
      [req.shipperOrgId, req.originState, req.destState, req.cargoType, req.pickupDate, req.weightLbs],
    );

    if (laneRate.length > 0) {
      const totalCents = laneRate[0].rate_cents;
      return {
        baseCents: totalCents,
        distanceCents: 0,
        weightCents: 0,
        fuelSurchargeCents: 0,
        cargoSurchargeCents: 0,
        surgeCents: 0,
        weekendSurchargeCents: 0,
        totalCents,
        ratePerMileCents: req.distanceMiles > 0 ? Math.round(totalCents / req.distanceMiles) : 0,
        surgeMultiplier: 1.0,
        breakdown: [{ component: 'contracted_lane_rate', amountCents: totalCents, description: `Contracted rate for ${req.originState}→${req.destState}` }],
        contractedRate: true,
        confidenceScore: 1.0,
      };
    }
  }

  // 2. Get active pricing model
  const models = await query<PricingModelRow>(
    `SELECT * FROM logistics.pricing_models
      WHERE is_active = TRUE
        AND strategy = 'DISTANCE_BASED'
        AND (applies_to_cargo_types IS NULL OR $1::logistics.cargo_type = ANY(applies_to_cargo_types))
        AND (applies_to_origin_states IS NULL OR $2 = ANY(applies_to_origin_states))
        AND (applies_to_dest_states IS NULL OR $3 = ANY(applies_to_dest_states))
      ORDER BY version DESC
      LIMIT 1`,
    [req.cargoType, req.originState, req.destState],
  );

  if (models.length === 0) {
    throw new AppError(500, 'No active pricing model found for this route');
  }

  const model = models[0];

  // 3. Base rate
  const baseCents = model.base_rate_cents;
  breakdown.push({ component: 'base_rate', amountCents: baseCents, description: 'Base booking fee' });

  // 4. Distance component
  const distanceCents = Math.round(model.per_mile_cents * req.distanceMiles);
  breakdown.push({ component: 'distance', amountCents: distanceCents, description: `${req.distanceMiles.toFixed(0)} mi × ${(model.per_mile_cents / 100).toFixed(2)}/mi` });

  // 5. Weight component
  const weightCents = Math.round(model.per_lb_cents * req.weightLbs);
  if (weightCents > 0) {
    breakdown.push({ component: 'weight', amountCents: weightCents, description: `${req.weightLbs.toFixed(0)} lbs × ${(model.per_lb_cents / 100).toFixed(4)}/lb` });
  }

  let subtotalCents = baseCents + distanceCents + weightCents;

  // 6. Fuel surcharge
  const fuelSurchargeCents = Math.round(subtotalCents * model.fuel_surcharge_bps / 10000);
  if (fuelSurchargeCents > 0) {
    breakdown.push({ component: 'fuel_surcharge', amountCents: fuelSurchargeCents, description: `Fuel surcharge (${(model.fuel_surcharge_bps / 100).toFixed(1)}%)` });
  }

  // 7. Cargo surcharges
  let cargoSurchargeCents = 0;
  if (req.isHazmat && model.hazmat_surcharge_bps > 0) {
    const hazmatCents = Math.round(subtotalCents * model.hazmat_surcharge_bps / 10000);
    cargoSurchargeCents += hazmatCents;
    breakdown.push({ component: 'hazmat_surcharge', amountCents: hazmatCents, description: 'Hazmat handling surcharge' });
  }
  if (req.cargoType === 'REFRIGERATED' && model.reefer_surcharge_bps > 0) {
    const reeferCents = Math.round(subtotalCents * model.reefer_surcharge_bps / 10000);
    cargoSurchargeCents += reeferCents;
    breakdown.push({ component: 'reefer_surcharge', amountCents: reeferCents, description: 'Refrigeration surcharge' });
  }
  if (req.isOversized && model.oversized_surcharge_bps > 0) {
    const oversizedCents = Math.round(subtotalCents * model.oversized_surcharge_bps / 10000);
    cargoSurchargeCents += oversizedCents;
    breakdown.push({ component: 'oversized_surcharge', amountCents: oversizedCents, description: 'Oversized load surcharge' });
  }

  subtotalCents += fuelSurchargeCents + cargoSurchargeCents;

  // 8. Supply/demand surge pricing
  let surgeMultiplier = model.surge_multiplier_bps / 10000;
  let confidenceScore = 0.7; // default

  const marketSnapshot = await query<MarketSnapshotRow>(
    `SELECT supply_demand_ratio, avg_rate_per_mile
       FROM logistics.market_rate_snapshots
      WHERE origin_state = $1
        AND dest_state = $2
        AND cargo_type = $3::logistics.cargo_type
        AND sample_date >= ($4::date - INTERVAL '7 days')
      ORDER BY sample_date DESC
      LIMIT 1`,
    [req.originState, req.destState, req.cargoType, req.pickupDate],
  );

  if (marketSnapshot.length > 0) {
    const sdr = marketSnapshot[0].supply_demand_ratio;
    confidenceScore = 0.9; // Higher confidence with market data

    // Inverse relationship: low supply ratio → high surge
    if (sdr < 1.0) {
      // Undersupply: scale surge up. SDR 0.5 → 1.5x, SDR 0.3 → 2.0x
      surgeMultiplier = Math.min(1.0 / sdr, model.max_surge_bps / 10000);
    } else if (sdr > 1.5) {
      // Oversupply: scale down but not below floor
      surgeMultiplier = Math.max(1.0 / Math.sqrt(sdr), model.min_surge_bps / 10000);
    }
  }

  // Clamp surge to configured bounds
  surgeMultiplier = Math.max(
    model.min_surge_bps / 10000,
    Math.min(surgeMultiplier, model.max_surge_bps / 10000),
  );

  const surgeCents = Math.round(subtotalCents * (surgeMultiplier - 1));
  if (surgeCents !== 0) {
    breakdown.push({ component: 'surge_pricing', amountCents: surgeCents, description: `Surge multiplier: ${surgeMultiplier.toFixed(2)}x` });
  }

  subtotalCents += surgeCents;

  // 9. Weekend/holiday surcharge
  const pickupDow = new Date(req.pickupDate).getUTCDay();
  let weekendSurchargeCents = 0;
  if ((pickupDow === 0 || pickupDow === 6) && model.weekend_surcharge_bps > 0) {
    weekendSurchargeCents = Math.round(subtotalCents * model.weekend_surcharge_bps / 10000);
    breakdown.push({ component: 'weekend_surcharge', amountCents: weekendSurchargeCents, description: 'Weekend pickup surcharge' });
  }

  const totalCents = subtotalCents + weekendSurchargeCents;
  const ratePerMileCents = req.distanceMiles > 0 ? Math.round(totalCents / req.distanceMiles) : 0;

  logger.info(
    { cargoType: req.cargoType, distanceMiles: req.distanceMiles, totalCents, surge: surgeMultiplier },
    'Price quote calculated',
  );

  return {
    baseCents,
    distanceCents,
    weightCents,
    fuelSurchargeCents,
    cargoSurchargeCents,
    surgeCents,
    weekendSurchargeCents,
    totalCents,
    ratePerMileCents,
    surgeMultiplier: Math.round(surgeMultiplier * 100) / 100,
    breakdown,
    contractedRate: false,
    confidenceScore,
  };
}
