// ─────────────────────────────────────────────────────────────────────────────
// Matching Service — PostGIS truck lookup, scoring, and bid invitation
//
// Queries fn_find_trucks_near_pickup(), enriches with driver rating,
// scores candidates, and optionally enqueues match notifications.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from '../../shared/db.js';
import { config } from '../../shared/config.js';
import { logger } from '../../shared/logger.js';
import { matchQueue } from '../../shared/queues.js';
import { AppError } from '../../shared/app-error.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface MatchRequest {
  loadId: string;
  /** Override radius; falls back to config */
  radiusMiles?: number;
}

export interface MatchCandidate {
  truckId: string;
  organizationId: string;
  cargoType: string;
  payloadCapacityLbs: number;
  distanceMiles: number;
  driverId: string | null;
  driverRating: number | null;
  deadheadRatio: number;
  score: number;
}

export interface MatchResult {
  loadId: string;
  candidates: MatchCandidate[];
  radiusMiles: number;
  totalFound: number;
  totalScored: number;
}

// ── Load row shape from DB ──────────────────────────────────────────────────
interface LoadRow {
  id: string;
  cargo_type: string;
  weight_lbs: number;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  distance_miles: number | null;
  status: string;
}

interface TruckRow {
  truck_id: string;
  organization_id: string;
  cargo_type: string;
  payload_capacity_lbs: number;
  distance_miles: number;
  driver_id: string | null;
}

interface DriverRatingRow {
  driver_id: string;
  avg_rating: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// findMatchingTrucks — main entry point
// ─────────────────────────────────────────────────────────────────────────────
export async function findMatchingTrucks(
  req: MatchRequest,
  userId: string,
): Promise<MatchResult> {
  const radiusMiles = req.radiusMiles ?? config.matchRadiusMiles;

  // 1. Fetch the load (under RLS)
  const loads = await query<LoadRow>(
    `SELECT id, cargo_type, weight_lbs,
            ST_Y(pickup_location::geometry)  AS pickup_lat,
            ST_X(pickup_location::geometry)  AS pickup_lng,
            ST_Y(dropoff_location::geometry) AS dropoff_lat,
            ST_X(dropoff_location::geometry) AS dropoff_lng,
            distance_miles, status
       FROM logistics.loads
      WHERE id = $1`,
    [req.loadId],
    userId,
  );

  if (loads.length === 0) {
    throw new AppError(404, 'Load not found');
  }

  const load = loads[0];
  if (!['POSTED', 'BIDDING'].includes(load.status)) {
    throw new AppError(409, `Load is in ${load.status} status and cannot accept matches`);
  }

  // 2. Find nearby trucks via PostGIS stored function
  const trucks = await query<TruckRow>(
    `SELECT * FROM logistics.fn_find_trucks_near_pickup($1, $2, $3, $4::logistics.cargo_type, $5)`,
    [load.pickup_lat, load.pickup_lng, radiusMiles, load.cargo_type, load.weight_lbs],
    userId,
  );

  if (trucks.length === 0) {
    return { loadId: req.loadId, candidates: [], radiusMiles, totalFound: 0, totalScored: 0 };
  }

  // 3. Bulk-fetch driver ratings for all candidate drivers
  const driverIds = trucks.map((t) => t.driver_id).filter(Boolean) as string[];
  const ratingMap = new Map<string, number>();

  if (driverIds.length > 0) {
    const ratings = await query<DriverRatingRow>(
      `SELECT a.driver_id,
              ROUND(AVG(a.shipper_rating), 2)::float AS avg_rating
         FROM logistics.assignments a
        WHERE a.driver_id = ANY($1)
          AND a.shipper_rating IS NOT NULL
          AND a.status = 'COMPLETED'
        GROUP BY a.driver_id`,
      [driverIds],
      userId,
    );
    for (const r of ratings) {
      ratingMap.set(r.driver_id, r.avg_rating);
    }
  }

  // 4. Compute load haul distance (use stored value or calculate)
  const loadDistanceMiles =
    load.distance_miles ??
    (await getLoadDistance(load.pickup_lat, load.pickup_lng, load.dropoff_lat, load.dropoff_lng));

  // 5. Score & rank candidates
  const candidates = trucks
    .map((t): MatchCandidate | null => {
      const deadheadRatio = loadDistanceMiles > 0 ? t.distance_miles / loadDistanceMiles : 1;
      if (deadheadRatio > config.deadheadMaxRatio) return null;

      const driverRating = t.driver_id ? (ratingMap.get(t.driver_id) ?? null) : null;

      //  Score:  base 100
      //   − distance penalty:  0–40 pts  (closer → lower penalty)
      //   − deadhead penalty:  0–30 pts  (lower ratio → lower penalty)
      //   + capacity bonus:    0–10 pts  (good fit)
      //   + rating bonus:      0–15 pts  (higher rated drivers)
      const distancePenalty = Math.min(t.distance_miles / radiusMiles, 1) * 40;
      const deadheadPenalty = deadheadRatio * 30;
      const capacityRatio = load.weight_lbs / t.payload_capacity_lbs;
      const capacityBonus = capacityRatio > 0.5 && capacityRatio <= 1.0 ? 10 : 0;
      const ratingBonus = driverRating !== null ? (driverRating / 5) * 15 : 0;

      const score = Math.round((100 - distancePenalty - deadheadPenalty + capacityBonus + ratingBonus) * 100) / 100;

      return {
        truckId: t.truck_id,
        organizationId: t.organization_id,
        cargoType: t.cargo_type,
        payloadCapacityLbs: t.payload_capacity_lbs,
        distanceMiles: Math.round(t.distance_miles * 100) / 100,
        driverId: t.driver_id,
        driverRating,
        deadheadRatio: Math.round(deadheadRatio * 1000) / 1000,
        score,
      };
    })
    .filter((c): c is MatchCandidate => c !== null)
    .sort((a, b) => b.score - a.score);

  logger.info(
    { loadId: req.loadId, totalFound: trucks.length, totalScored: candidates.length },
    'Matching completed',
  );

  return {
    loadId: req.loadId,
    candidates,
    radiusMiles,
    totalFound: trucks.length,
    totalScored: candidates.length,
  };
}

/**
 * Enqueue an async matching job for background processing.
 */
export async function enqueueMatchJob(loadId: string, userId: string): Promise<string> {
  const loads = await query<LoadRow>(
    `SELECT id, cargo_type, weight_lbs,
            ST_Y(pickup_location::geometry)  AS pickup_lat,
            ST_X(pickup_location::geometry)  AS pickup_lng,
            ST_Y(dropoff_location::geometry) AS dropoff_lat,
            ST_X(dropoff_location::geometry) AS dropoff_lng,
            distance_miles, status
       FROM logistics.loads
      WHERE id = $1`,
    [loadId],
    userId,
  );

  if (loads.length === 0) throw new AppError(404, 'Load not found');

  const load = loads[0];
  const job = await matchQueue.add('match', {
    loadId,
    cargoType: load.cargo_type,
    weightLbs: load.weight_lbs,
    pickupLat: load.pickup_lat,
    pickupLng: load.pickup_lng,
    dropoffLat: load.dropoff_lat,
    dropoffLng: load.dropoff_lng,
  });

  return job.id!;
}

// ── Helper: Haversine distance via PostGIS ──────────────────────────────────
async function getLoadDistance(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
): Promise<number> {
  const result = await query<{ distance_miles: number }>(
    `SELECT ST_Distance(
       ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
       ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
     ) / 1609.344 AS distance_miles`,
    [pickupLng, pickupLat, dropoffLng, dropoffLat],
  );
  return result[0]?.distance_miles ?? 0;
}

// Re-export from shared for backward compatibility
export { AppError } from '../../shared/app-error.js';
