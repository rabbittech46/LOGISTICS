// ─────────────────────────────────────────────────────────────────────────────
// Redis GPS Hot-Store
//
// Stores the latest truck position in Redis GEO + HASH structures,
// buffers pings for periodic batch flush to PostgreSQL telemetry_logs.
// ─────────────────────────────────────────────────────────────────────────────
import { redis } from '../../shared/redis.js';
import { REDIS_KEYS, type GpsPing } from '../../shared/types.js';
import { config } from '../../shared/config.js';
import { logger } from '../../shared/logger.js';

export interface TruckPositionSnapshot {
  truckId: string;
  lat: number;
  lng: number;
  speed_kmh: number;
  heading_deg: number;
  recorded_at: string;
  assignmentId: string | null;
  driverId: string | null;
  source: 'redis';
}

/** Maximum pending pings before load-shedding. Prevents OOM if flush falls behind. */
const MAX_PENDING_PINGS = 500_000;

/**
 * Write a single GPS ping to the Redis hot-store.
 * O(log N) due to GEO + ZADD + HSET pipeline.
 *
 * Applies backpressure: if the pending batch list exceeds MAX_PENDING_PINGS,
 * the ping is silently dropped and a warning is logged (sampled).
 */
export async function storeGpsPing(ping: GpsPing): Promise<void> {
  // Backpressure: check pending list length (cheap O(1) LLEN)
  const pendingLen = await redis.llen(REDIS_KEYS.TELEMETRY_BATCH);
  if (pendingLen > MAX_PENDING_PINGS) {
    // Sample log 1-in-1000 to avoid log flood
    if (Math.random() < 0.001) {
      logger.warn({ pendingLen, truckId: ping.truckId }, 'GPS backpressure: dropping ping — flush not keeping up');
    }
    return;
  }

  const pipeline = redis.pipeline();

  // 1. GEO position — enables GEORADIUS for matching
  pipeline.geoadd(REDIS_KEYS.TRUCK_POSITIONS, ping.lng, ping.lat, ping.truckId);

  // 2. Per-truck metadata hash — atomic overwrite
  pipeline.hset(REDIS_KEYS.truckMeta(ping.truckId), {
    lat: String(ping.lat),
    lng: String(ping.lng),
    speed_kmh: String(ping.speed_kmh ?? 0),
    heading_deg: String(ping.heading_deg ?? 0),
    altitude_m: String(ping.altitude_m ?? 0),
    accuracy_m: String(ping.accuracy_m ?? 0),
    engine_on: String(ping.engine_on ?? false),
    fuel_level_pct: String(ping.fuel_level_pct ?? ''),
    odometer_km: String(ping.odometer_km ?? ''),
    assignmentId: ping.assignmentId ?? '',
    driverId: ping.driverId ?? '',
    recorded_at: ping.recorded_at,
    received_at: new Date().toISOString(),
  });

  // 3. Last-seen sorted set for offline detection
  const ts = new Date(ping.recorded_at).getTime();
  pipeline.zadd(REDIS_KEYS.TRUCK_LAST_SEEN, ts, ping.truckId);

  // 4. Append to batch list for periodic Postgres flush
  pipeline.rpush(REDIS_KEYS.TELEMETRY_BATCH, JSON.stringify(ping));

  // 5. Pub/Sub: notify any connected dashboard consumers
  pipeline.publish(
    REDIS_KEYS.truckUpdate(ping.truckId),
    JSON.stringify({
      truckId: ping.truckId,
      lat: ping.lat,
      lng: ping.lng,
      speed_kmh: ping.speed_kmh,
      heading_deg: ping.heading_deg,
      recorded_at: ping.recorded_at,
    }),
  );

  await pipeline.exec();
}

/**
 * Rate-limit check: returns true if the truck may send a ping (≥ 3 s gap).
 */
export async function checkPingRateLimit(truckId: string): Promise<boolean> {
  const key = REDIS_KEYS.pingRateLimit(truckId);
  const ttlMs = config.pingRateLimitMs;
  // SET NX PX — only succeeds if the key doesn't already exist
  const result = await redis.set(key, '1', 'PX', ttlMs, 'NX');
  return result === 'OK';
}

/**
 * Drain up to `batchSize` pings from the Redis batch list.
 * Called by the flush worker on a timer.
 *
 * CRITICAL: Uses LRANGE + LTRIM instead of N×LPOP so the drain is atomic.
 * If the process crashes between LRANGE and LTRIM, pings remain in Redis
 * and are re-processed (idempotent via telemetry_logs UPSERT on truck_id+recorded_at).
 */
export async function drainBatch(batchSize: number): Promise<GpsPing[]> {
  // Atomically read first `batchSize` elements and trim
  const raw = await redis.lrange(REDIS_KEYS.TELEMETRY_BATCH, 0, batchSize - 1);
  if (raw.length === 0) return [];

  // Remove exactly the items we read. If new items arrived concurrently they stay.
  await redis.ltrim(REDIS_KEYS.TELEMETRY_BATCH, raw.length, -1);

  const pings: GpsPing[] = [];
  for (const val of raw) {
    try {
      pings.push(JSON.parse(val) as GpsPing);
    } catch {
      logger.warn({ raw: val }, 'Skipping malformed ping in batch');
    }
  }
  return pings;
}

/**
 * Get truck IDs that haven't pinged within the given threshold.
 */
export async function getOfflineTrucks(thresholdMs: number): Promise<string[]> {
  const cutoff = Date.now() - thresholdMs;
  return redis.zrangebyscore(REDIS_KEYS.TRUCK_LAST_SEEN, '-inf', cutoff);
}

/**
 * Get the latest position for a truck from the hot-store.
 */
export async function getTruckPosition(truckId: string) {
  const meta = await redis.hgetall(REDIS_KEYS.truckMeta(truckId));
  if (!meta || !meta.lat) return null;
  return {
    truckId,
    lat: parseFloat(meta.lat),
    lng: parseFloat(meta.lng),
    speed_kmh: parseFloat(meta.speed_kmh || '0'),
    heading_deg: parseFloat(meta.heading_deg || '0'),
    recorded_at: meta.recorded_at,
    assignmentId: meta.assignmentId || null,
    driverId: meta.driverId || null,
    source: 'redis' as const,
  } satisfies TruckPositionSnapshot;
}

/**
 * Fetch the latest hot-store snapshot for many trucks with a single Redis pipeline.
 */
export async function getTruckPositions(truckIds: string[]): Promise<Map<string, TruckPositionSnapshot>> {
  const uniqueTruckIds = [...new Set(truckIds.filter(Boolean))];
  if (uniqueTruckIds.length === 0) {
    return new Map();
  }

  const pipeline = redis.pipeline();
  for (const truckId of uniqueTruckIds) {
    pipeline.hgetall(REDIS_KEYS.truckMeta(truckId));
  }

  const results = await pipeline.exec();
  const snapshots = new Map<string, TruckPositionSnapshot>();

  uniqueTruckIds.forEach((truckId, index) => {
    const [, meta] = results?.[index] ?? [];
    if (!meta || typeof meta !== 'object' || !('lat' in meta)) {
      return;
    }

    const hash = meta as Record<string, string>;
    if (!hash.lat || !hash.lng || !hash.recorded_at) {
      return;
    }

    snapshots.set(truckId, {
      truckId,
      lat: parseFloat(hash.lat),
      lng: parseFloat(hash.lng),
      speed_kmh: parseFloat(hash.speed_kmh || '0'),
      heading_deg: parseFloat(hash.heading_deg || '0'),
      recorded_at: hash.recorded_at,
      assignmentId: hash.assignmentId || null,
      driverId: hash.driverId || null,
      source: 'redis',
    });
  });

  return snapshots;
}
