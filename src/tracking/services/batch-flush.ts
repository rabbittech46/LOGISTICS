// ─────────────────────────────────────────────────────────────────────────────
// Batch Flush Worker
//
// Periodically drains GPS pings from the Redis batch list and writes them
// to PostgreSQL telemetry_logs using COPY for maximum throughput.
// ─────────────────────────────────────────────────────────────────────────────
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { PoolClient } from 'pg';
import { pool } from '../../shared/db.js';
import { config } from '../../shared/config.js';
import { logger } from '../../shared/logger.js';
import { drainBatch } from './gps-hot-store.js';
import type { GpsPing } from '../../shared/types.js';
import { from as copyFrom } from 'pg-copy-streams';

let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

function buildLatestByKey(pings: GpsPing[], key: 'truckId' | 'driverId'): Map<string, GpsPing> {
  const latest = new Map<string, GpsPing>();

  for (const ping of pings) {
    const entityId = ping[key];
    if (!entityId) {
      continue;
    }

    const existing = latest.get(entityId);
    if (!existing || new Date(ping.recorded_at).getTime() >= new Date(existing.recorded_at).getTime()) {
      latest.set(entityId, ping);
    }
  }

  return latest;
}

async function persistLatestTruckPositions(client: PoolClient, pings: GpsPing[]): Promise<void> {
  const latestTruckPings = [...buildLatestByKey(pings, 'truckId').values()];
  if (latestTruckPings.length === 0) {
    return;
  }

  await client.query(
    `WITH latest AS (
       SELECT *
         FROM UNNEST(
           $1::uuid[],
           $2::double precision[],
           $3::double precision[],
           $4::timestamptz[]
         ) AS t(truck_id, lng, lat, recorded_at)
     )
     UPDATE logistics.trucks AS trucks
        SET current_location = ST_SetSRID(ST_MakePoint(latest.lng, latest.lat), 4326)::geography,
            location_updated_at = latest.recorded_at
       FROM latest
      WHERE trucks.id = latest.truck_id
        AND (
          trucks.location_updated_at IS NULL
          OR latest.recorded_at >= trucks.location_updated_at
        )`,
    [
      latestTruckPings.map((ping) => ping.truckId),
      latestTruckPings.map((ping) => ping.lng),
      latestTruckPings.map((ping) => ping.lat),
      latestTruckPings.map((ping) => ping.recorded_at),
    ],
  );
}

async function persistLatestDriverPositions(client: PoolClient, pings: GpsPing[]): Promise<void> {
  const latestDriverPings = [...buildLatestByKey(pings, 'driverId').values()];
  if (latestDriverPings.length === 0) {
    return;
  }

  await client.query(
    `WITH latest AS (
       SELECT *
         FROM UNNEST(
           $1::uuid[],
           $2::double precision[],
           $3::double precision[],
           $4::timestamptz[]
         ) AS t(driver_id, lng, lat, recorded_at)
     )
     UPDATE logistics.driver_profiles AS drivers
        SET current_location = ST_SetSRID(ST_MakePoint(latest.lng, latest.lat), 4326)::geography,
            location_updated_at = latest.recorded_at
       FROM latest
      WHERE drivers.id = latest.driver_id
        AND (
          drivers.location_updated_at IS NULL
          OR latest.recorded_at >= drivers.location_updated_at
        )`,
    [
      latestDriverPings.map((ping) => ping.driverId as string),
      latestDriverPings.map((ping) => ping.lng),
      latestDriverPings.map((ping) => ping.lat),
      latestDriverPings.map((ping) => ping.recorded_at),
    ],
  );
}

/**
 * Flush buffered pings to Postgres via COPY for bulk efficiency.
 *
 * COPY writes bypass the standard INSERT path and produce significantly
 * less WAL volume — critical when ingesting 10k+ rows/minute.
 */
async function flushToPostgres(): Promise<void> {
  if (flushing) return; // prevent overlapping flushes
  flushing = true;

  try {
    const pings = await drainBatch(config.batchFlushSize);
    if (pings.length === 0) return;

    const client = await pool.connect();
    try {
      const copyStream = client.query(
        copyFrom(
          `COPY logistics.telemetry_logs (
            truck_id, driver_id, assignment_id,
            location, altitude_m, speed_kmh,
            heading_deg, accuracy_m, engine_on,
            fuel_level_pct, odometer_km,
            recorded_at, received_at
          ) FROM STDIN WITH (FORMAT csv, NULL '\\N')`,
        ),
      );

      const csvRows = pings.map(pingToCsvRow).join('');

      // Stream the CSV data into the COPY command
      await pipeline(
        async function* () {
          yield csvRows;
        },
        copyStream as unknown as Writable,
      );

      await persistLatestTruckPositions(client, pings);
      await persistLatestDriverPositions(client, pings);

      logger.info({ count: pings.length }, 'Telemetry batch flushed to PG');
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, 'Telemetry batch flush failed — pings remain in Redis for retry');
  } finally {
    flushing = false;
  }
}

/**
 * Convert a GPS ping to a CSV row for COPY.
 * PostGIS POINT is expressed as: SRID=4326;POINT(lng lat)
 */
function pingToCsvRow(ping: GpsPing): string {
  const point = `SRID=4326;POINT(${ping.lng} ${ping.lat})`;
  const fields = [
    ping.truckId,
    ping.driverId || '\\N',
    ping.assignmentId || '\\N',
    point,
    ping.altitude_m ?? '\\N',
    ping.speed_kmh ?? '\\N',
    ping.heading_deg ?? '\\N',
    ping.accuracy_m ?? '\\N',
    ping.engine_on ?? '\\N',
    ping.fuel_level_pct ?? '\\N',
    ping.odometer_km ?? '\\N',
    ping.recorded_at,
    new Date().toISOString(),
  ];
  return fields.join(',') + '\n';
}

/**
 * Start periodic batch flushes.
 */
export function startBatchFlushWorker(): void {
  logger.info(
    { intervalMs: config.batchFlushIntervalMs, batchSize: config.batchFlushSize },
    'Batch flush worker started',
  );
  flushTimer = setInterval(() => {
    flushToPostgres().catch((err) =>
      logger.error({ err }, 'Unhandled flush error'),
    );
  }, config.batchFlushIntervalMs);
}

/**
 * Drain remaining pings and stop the timer.
 */
export async function stopBatchFlushWorker(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  // Final flush
  await flushToPostgres();
  logger.info('Batch flush worker stopped');
}
