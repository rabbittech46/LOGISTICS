// ─────────────────────────────────────────────────────────────────────────────
// Reservation Expiration Worker
//
// Background process that runs on a fixed interval to:
//   1. Reclaim stale RESERVED slots (TTL expired) → AVAILABLE
//   2. Purge expired idempotency keys (>24h old)
//
// Concurrency safety:
//   - Uses pg_advisory_xact_lock to prevent multiple worker instances from
//     running expiration concurrently (exactly-once guarantee).
//   - The lock is scoped to the transaction and auto-released on COMMIT/ROLLBACK.
//
// Deployment:
//   - Run as WORKER_TYPE=reservation-expiry in the workers/entry.ts switch
//   - Or as a standalone cron job with: node -e "import('./src/workers/reservation-expiry.worker.js')"
//   - Can also be invoked as a BullMQ repeatable job
// ─────────────────────────────────────────────────────────────────────────────
import { Worker, Queue } from 'bullmq';
import { createRedis } from '../shared/redis.js';
import { logger } from '../shared/logger.js';
import { expireReservations, cleanupIdempotencyKeys } from '../api/services/slot-booking.service.js';
import { slotExpirations } from '../api/services/slot-booking.metrics.js';

const connection = createRedis('reservation-expiry-worker');

// ── BullMQ Queue for scheduled expiration runs ──────────────────────────────
export const reservationExpiryQueue = new Queue('reservation-expiry', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

// ── Worker: processes expiration jobs ───────────────────────────────────────
const worker = new Worker(
  'reservation-expiry',
  async (job) => {
    const startMs = Date.now();
    logger.info({ jobId: job.id }, 'Running reservation expiration cycle');

    try {
      // Phase 1: Expire stale reservations
      const expiredCount = await expireReservations();
      slotExpirations.inc(expiredCount);

      // Phase 2: Purge old idempotency keys
      const purgedKeys = await cleanupIdempotencyKeys();

      const durationMs = Date.now() - startMs;
      logger.info(
        { expiredCount, purgedKeys, durationMs, jobId: job.id },
        'Reservation expiration cycle complete',
      );

      return { expiredCount, purgedKeys, durationMs };
    } catch (err) {
      logger.error({ err, jobId: job.id }, 'Reservation expiration cycle failed');
      throw err;
    }
  },
  {
    connection,
    concurrency: 1, // Serial execution — advisory lock prevents parallel anyway
    limiter: { max: 1, duration: 10_000 }, // At most 1 run per 10 seconds
  },
);

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Reservation expiry job failed');
});

worker.on('error', (err) => {
  logger.error({ err }, 'Reservation expiry worker error');
});

// ── Schedule repeating job: runs every 30 seconds ───────────────────────────
async function scheduleRepeatingJob(): Promise<void> {
  // Remove existing repeatable if pattern changed
  const existing = await reservationExpiryQueue.getRepeatableJobs();
  for (const job of existing) {
    await reservationExpiryQueue.removeRepeatableByKey(job.key);
  }

  await reservationExpiryQueue.add(
    'expire-reservations',
    {},
    {
      repeat: { every: 30_000 }, // Every 30 seconds
      jobId: 'reservation-expiry-repeating',
    },
  );

  logger.info('Scheduled reservation expiration job (every 30s)');
}

scheduleRepeatingJob().catch((err) => {
  logger.error({ err }, 'Failed to schedule reservation expiration job');
});

// ── Graceful Shutdown ───────────────────────────────────────────────────────
async function shutdown(): Promise<void> {
  logger.info('Shutting down reservation expiry worker');
  await worker.close();
  await reservationExpiryQueue.close();
}

process.on('SIGTERM', () => shutdown().then(() => process.exit(0)));
process.on('SIGINT', () => shutdown().then(() => process.exit(0)));

logger.info('Reservation expiry worker started');

export { worker as reservationExpiryWorker };
