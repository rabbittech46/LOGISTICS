// ─────────────────────────────────────────────────────────────────────────────
// Matching Worker — BullMQ Consumer
//
// Processes `match:load` jobs: finds nearby trucks via PostGIS + Redis,
// scores candidates, and creates match candidates for carrier dispatchers.
// ─────────────────────────────────────────────────────────────────────────────
import { Worker, Queue } from 'bullmq';
import { createRedis } from '../shared/redis.js';
import { query } from '../shared/db.js';
import { config } from '../shared/config.js';
import { logger } from '../shared/logger.js';

const connection = createRedis('matching-worker');
const notificationQueue = new Queue('notifications', { connection: createRedis('matching-notify') });

interface MatchJobData {
  loadId: string;
  cargoType: string;
  weightLbs: number;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
}

interface TruckCandidate {
  truck_id: string;
  organization_id: string;
  distance_miles: number;
  payload_capacity_lbs: number;
  driver_id: string | null;
}

const worker = new Worker<MatchJobData>(
  'match-load',
  async (job) => {
    const { loadId, cargoType, weightLbs, pickupLat, pickupLng, dropoffLat, dropoffLng } = job.data;
    logger.info({ loadId, cargoType }, 'Processing match job');

    // 1. Find nearby available trucks via PostGIS function
    const candidates = await query<TruckCandidate>(
      `SELECT * FROM logistics.fn_find_trucks_near_pickup($1, $2, $3, $4::logistics.cargo_type, $5)`,
      [pickupLat, pickupLng, config.matchRadiusMiles, cargoType, weightLbs],
    );

    if (candidates.length === 0) {
      logger.info({ loadId }, 'No truck candidates found within radius');
      return { matched: 0 };
    }

    // 2. Calculate deadhead ratio and score each candidate
    const loadDistanceMiles = await getLoadDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);

    const scored = candidates
      .map((c) => {
        const deadheadRatio = loadDistanceMiles > 0 ? c.distance_miles / loadDistanceMiles : 1;
        // Exclude candidates exceeding max deadhead ratio
        if (deadheadRatio > config.deadheadMaxRatio) return null;

        // Scoring function:
        //   base 100
        //   - distance penalty: closer trucks score higher
        //   - deadhead penalty: lower ratio = better
        //   - capacity bonus: exact fit > oversized
        const distancePenalty = Math.min(c.distance_miles / config.matchRadiusMiles, 1) * 40;
        const deadheadPenalty = deadheadRatio * 30;
        const capacityRatio = weightLbs / c.payload_capacity_lbs;
        const capacityBonus = capacityRatio > 0.5 && capacityRatio <= 1.0 ? 10 : 0;

        const score = 100 - distancePenalty - deadheadPenalty + capacityBonus;

        return { ...c, deadheadRatio, score };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => b.score - a.score);

    logger.info(
      { loadId, totalCandidates: candidates.length, scoredCandidates: scored.length },
      'Matching scored',
    );

    // 3. Persist match candidates and notify carrier dispatchers
    const topCandidates = scored.slice(0, 10);

    for (const candidate of topCandidates) {
      // Persist bid invitation record for the carrier dispatcher to see
      await query(
        `INSERT INTO logistics.bid_invitations (
            id, load_id, truck_id, carrier_org_id, driver_id,
            distance_miles, match_score, status
          ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'PENDING')
          ON CONFLICT (load_id, truck_id) DO NOTHING`,
        [
          loadId, candidate.truck_id, candidate.organization_id,
          candidate.driver_id, candidate.distance_miles,
          Math.round(candidate.score * 100) / 100,
        ],
      );

      // Enqueue push notification to the carrier's dispatchers
      await notificationQueue.add('bid-invitation', {
        channel: 'push' as const,
        recipientId: candidate.driver_id ?? candidate.organization_id,
        recipientOrgId: candidate.organization_id,
        eventType: 'matching.bid_invitation',
        entityId: loadId,
        title: 'New load match',
        body: `A load matching your truck has been found — ${candidate.distance_miles.toFixed(0)} mi away`,
      }, {
        jobId: `bid-invite:${loadId}:${candidate.truck_id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });

      logger.info(
        {
          loadId,
          truckId: candidate.truck_id,
          score: candidate.score.toFixed(1),
          deadhead: candidate.deadheadRatio.toFixed(2),
          distanceMiles: candidate.distance_miles.toFixed(1),
        },
        'Match candidate persisted + notified',
      );
    }

    return { matched: scored.length, topScore: scored[0]?.score };
  },
  {
    connection,
    concurrency: 5,
    limiter: { max: 50, duration: 60_000 },
  },
);

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

worker.on('completed', (job) => {
  logger.debug({ jobId: job.id }, 'Match job completed');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Match job failed');
});

logger.info('Matching worker started');
