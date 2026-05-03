// ─────────────────────────────────────────────────────────────────────────────
// Payment Worker — Scheduled payout processing + payment reconciliation
// ─────────────────────────────────────────────────────────────────────────────
import { Worker, Queue } from 'bullmq';
import { createRedis } from '../shared/redis.js';
import { isFeatureEnabled } from '../shared/feature-flags.js';
import { logger } from '../shared/logger.js';
import { processCarrierPayouts } from '../api/services/payment.service.js';
import { pool } from '../shared/db.js';
import Stripe from 'stripe';
import { config } from '../shared/config.js';

if (!isFeatureEnabled('payments')) {
  logger.warn('Payments feature is disabled; payment worker is running in idle mode');
  setInterval(() => {}, 60_000);
} else {
  const stripe = new Stripe(config.stripeSecretKey, { apiVersion: '2024-11-20.acacia' as any });
  const connection = createRedis('payment-worker');

  // ── Payout processing queue ─────────────────────────────────────────────────
  const payoutQueue = new Queue('payout-processing', { connection });

  // Schedule recurring payout runs (every 2 hours)
  payoutQueue.upsertJobScheduler(
    'carrier-payout-scheduler',
    { every: 7_200_000 },
    { name: 'process-payouts', data: {} },
  ).catch((err) => logger.error({ err }, 'Failed to create payout scheduler'));

  // Schedule reconciliation every 10 minutes
  payoutQueue.upsertJobScheduler(
    'payment-reconciliation',
    { every: 600_000 },
    { name: 'reconcile-payments', data: {} },
  ).catch((err) => logger.error({ err }, 'Failed to create reconciliation scheduler'));

  /**
   * Reconcile RELEASED payments whose Stripe PaymentIntent was never captured.
   *
   * The settlePayment() service uses a two-phase pattern:
   *   Phase 1: DB marks RELEASED + creates ledger entries (committed)
   *   Phase 2: Stripe capture (external, after commit)
   *
   * If Phase 2 fails, the payment shows as RELEASED in the DB but the
   * Stripe PaymentIntent is still in 'requires_capture' state.
   * This reconciler detects that discrepancy and retries the capture.
   */
  async function reconcilePayments(): Promise<number> {
    // Find RELEASED payments older than 5 minutes that might have missed Stripe capture
    const stalePayments = await pool.query(
      `SELECT id, processor_payment_id, gross_amount_cents
         FROM logistics.payments
        WHERE status = 'RELEASED'
          AND released_at < NOW() - INTERVAL '5 minutes'
          AND released_at > NOW() - INTERVAL '24 hours'
        ORDER BY released_at ASC
        LIMIT 50`,
    );

    let reconciled = 0;
    for (const row of stalePayments.rows) {
      try {
        const pi = await stripe.paymentIntents.retrieve(row.processor_payment_id);

        if (pi.status === 'requires_capture') {
          // Phase 2 never completed — retry capture
          await stripe.paymentIntents.capture(row.processor_payment_id, {
            amount_to_capture: row.gross_amount_cents,
          });
          logger.info({ paymentId: row.id }, 'Reconciler captured stale PaymentIntent');
          reconciled++;
        } else if (pi.status === 'canceled' || pi.status === 'requires_payment_method') {
          // Stripe PI is dead — mark payment as FAILED for manual review
          await pool.query(
            `UPDATE logistics.payments SET status = 'FAILED', updated_at = NOW() WHERE id = $1`,
            [row.id],
          );
          logger.error({ paymentId: row.id, stripeStatus: pi.status }, 'Reconciler found dead PI — marked FAILED');
        }
        // If pi.status === 'succeeded', capture already went through — no action needed
      } catch (err) {
        logger.error({ paymentId: row.id, err }, 'Reconciliation fetch/capture failed for payment');
      }
    }
    return reconciled;
  }

  const worker = new Worker(
    'payout-processing',
    async (job) => {
      switch (job.name) {
        case 'process-payouts': {
          const processed = await processCarrierPayouts();
          logger.info({ processed }, 'Payout batch completed');
          return { processed };
        }
        case 'reconcile-payments': {
          const reconciled = await reconcilePayments();
          logger.info({ reconciled }, 'Payment reconciliation completed');
          return { reconciled };
        }

        default:
          logger.warn({ jobName: job.name }, 'Unknown payment job type');
      }
    },
    {
      connection,
      concurrency: 1,          // Serial payout processing to avoid double-sends
      limiter: { max: 1, duration: 10_000 },
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err }, 'Payment job failed');
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, 'Payment job completed');
  });

  logger.info('Payment worker started');
}
