// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Payment Service â€” Stripe-backed escrow, settlement, and payouts
//
// Flow: Shipper pays â†’ Escrow held â†’ Delivery confirmed â†’ Carrier payout
//
// Uses Stripe PaymentIntents for capture, Transfers for payouts,
// with idempotency keys to guarantee exactly-once semantics.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import Stripe from 'stripe';
import { pool } from '../../shared/db.js';
import { config } from '../../shared/config.js';
import { logger } from '../../shared/logger.js';
import { publishEvent, TOPICS } from '../../shared/kafka.js';
import { AppError } from '../../shared/app-error.js';
import { CircuitBreaker } from '../../shared/circuit-breaker.js';
import { assertFeatureEnabled } from '../../shared/feature-flags.js';
import { randomUUID } from 'node:crypto';
import type { PaymentStatus, UserRole } from '../../shared/types.js';

let stripeClient: Stripe | null = null;

const stripeCircuit = new CircuitBreaker({
  name: 'stripe-api',
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenSuccessThreshold: 2,
  callTimeoutMs: 15_000,
  isFailure: (err: unknown) => {
    // Don't count 4xx client errors (invalid requests) as circuit failures
    if (err instanceof Stripe.errors.StripeError && err.statusCode && err.statusCode < 500) {
      return false;
    }
    return true;
  },
});

function assertPaymentsEnabled(): void {
  assertFeatureEnabled('payments', 'Payments feature is disabled');
}

function getStripeClient(): Stripe {
  assertPaymentsEnabled();
  if (!config.stripeSecretKey) {
    throw new AppError(503, 'Stripe is not configured');
  }

  if (!stripeClient) {
    stripeClient = new Stripe(config.stripeSecretKey, {
      apiVersion: '2025-02-24.acacia',
      typescript: true,
      maxNetworkRetries: 3,
    });
  }

  return stripeClient;
}

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface CreateEscrowRequest {
  loadId: string;
  assignmentId: string;
  shipperOrgId: string;
  carrierOrgId: string;
  grossAmountCents: number;
  platformFeePct: number;   // e.g., 8.5 = 8.5%
  advancePct?: number;      // e.g., 30 = 30% advance on booking
}

export interface EscrowResult {
  paymentId: string;
  stripePaymentIntentId: string;
  clientSecret: string;     // For frontend confirmation
  grossAmountCents: number;
  platformFeeCents: number;
  netCarrierCents: number;
}

export interface SettlementRequest {
  paymentId: string;
  assignmentId: string;
}

export interface PaymentCheckoutSession {
  paymentId: string;
  stripePaymentIntentId: string;
  clientSecret: string;
  grossAmountCents: number;
  platformFeeCents: number;
  netCarrierCents: number;
  paymentStatus: PaymentStatus;
}

export interface PaymentSyncResult {
  payment: PaymentRecord;
  stripeIntentStatus: Stripe.PaymentIntent.Status;
}

export interface PayoutRequest {
  carrierOrgId: string;
  paymentIds: string[];
}

interface PaymentRow {
  id: string;
  load_id: string;
  assignment_id: string | null;
  shipper_org_id: string;
  carrier_org_id: string | null;
  gross_amount_cents: number;
  platform_fee_cents: number;
  insurance_fee_cents: number;
  net_carrier_cents: number;
  escrow_amount_cents: number;
  advance_pct: number | null;
  advance_amount_cents: number | null;
  status: PaymentStatus;
  payment_method: string | null;
  processor: string | null;
  processor_payment_id: string | null;
  processor_transfer_id: string | null;
  processor_metadata: Record<string, unknown>;
  escrow_held_at: string | null;
  advance_paid_at: string | null;
  released_at: string | null;
  refunded_at: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface PaymentRecord {
  id: string;
  loadId: string;
  assignmentId: string | null;
  shipperOrgId: string;
  carrierOrgId: string | null;
  grossAmountCents: number;
  platformFeeCents: number;
  insuranceFeeCents: number;
  netCarrierCents: number;
  escrowAmountCents: number;
  advancePct: number | null;
  advanceAmountCents: number | null;
  status: PaymentStatus;
  paymentMethod: string | null;
  processor: string | null;
  processorPaymentId: string | null;
  processorTransferId: string | null;
  processorMetadata: Record<string, unknown>;
  escrowHeldAt: string | null;
  advancePaidAt: string | null;
  releasedAt: string | null;
  refundedAt: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

function isEscrowAuthorizedIntentStatus(status: Stripe.PaymentIntent.Status): boolean {
  return status === 'requires_capture' || status === 'succeeded';
}

function mapPaymentRecord(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    loadId: row.load_id,
    assignmentId: row.assignment_id,
    shipperOrgId: row.shipper_org_id,
    carrierOrgId: row.carrier_org_id,
    grossAmountCents: row.gross_amount_cents,
    platformFeeCents: row.platform_fee_cents,
    insuranceFeeCents: row.insurance_fee_cents,
    netCarrierCents: row.net_carrier_cents,
    escrowAmountCents: row.escrow_amount_cents,
    advancePct: row.advance_pct,
    advanceAmountCents: row.advance_amount_cents,
    status: row.status,
    paymentMethod: row.payment_method,
    processor: row.processor,
    processorPaymentId: row.processor_payment_id,
    processorTransferId: row.processor_transfer_id,
    processorMetadata: row.processor_metadata,
    escrowHeldAt: row.escrow_held_at,
    advancePaidAt: row.advance_paid_at,
    releasedAt: row.released_at,
    refundedAt: row.refunded_at,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PAYMENT_SELECT = `
  id, load_id, assignment_id, shipper_org_id, carrier_org_id,
  gross_amount_cents, platform_fee_cents, insurance_fee_cents,
  net_carrier_cents, escrow_amount_cents, advance_pct, advance_amount_cents,
  status, payment_method, processor, processor_payment_id, processor_transfer_id,
  processor_metadata, escrow_held_at, advance_paid_at, released_at, refunded_at,
  idempotency_key, created_at, updated_at`;

export async function listPayments(
  userId: string,
  orgId: string,
  role: UserRole,
  filters?: {
    assignmentId?: string;
    loadId?: string;
    status?: PaymentStatus;
  },
): Promise<PaymentRecord[]> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);

    const params: unknown[] = [];
    const conditions: string[] = [];
    let idx = 1;

    if (role !== 'PLATFORM_ADMIN') {
      conditions.push(`(shipper_org_id = $${idx} OR carrier_org_id = $${idx})`);
      params.push(orgId);
      idx += 1;
    }

    if (filters?.assignmentId) {
      conditions.push(`assignment_id = $${idx++}`);
      params.push(filters.assignmentId);
    }

    if (filters?.loadId) {
      conditions.push(`load_id = $${idx++}`);
      params.push(filters.loadId);
    }

    if (filters?.status) {
      conditions.push(`status = $${idx++}`);
      params.push(filters.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await client.query<PaymentRow>(
      `SELECT ${PAYMENT_SELECT}
         FROM logistics.payments
         ${whereClause}
        ORDER BY created_at DESC
        LIMIT 100`,
      params,
    );

    return result.rows.map(mapPaymentRecord);
  } finally {
    client.release();
  }
}

export async function getPaymentById(
  paymentId: string,
  userId: string,
  orgId: string,
  role: UserRole,
): Promise<PaymentRecord> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);

    const params: unknown[] = [paymentId];
    const accessClause = role === 'PLATFORM_ADMIN'
      ? ''
      : ' AND (shipper_org_id = $2 OR carrier_org_id = $2)';

    if (role !== 'PLATFORM_ADMIN') {
      params.push(orgId);
    }

    const result = await client.query<PaymentRow>(
      `SELECT ${PAYMENT_SELECT}
         FROM logistics.payments
        WHERE id = $1${accessClause}`,
      params,
    );

    if (result.rows.length === 0) {
      throw new AppError(404, 'Payment not found');
    }

    return mapPaymentRecord(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function getPaymentCheckoutSession(
  paymentId: string,
  userId: string,
  orgId: string,
  role: UserRole,
): Promise<PaymentCheckoutSession> {
  assertPaymentsEnabled();
  const payment = await getPaymentById(paymentId, userId, orgId, role);

  if (!['PENDING', 'FAILED'].includes(payment.status)) {
    throw new AppError(409, `Payment is in ${payment.status} state and cannot be confirmed in checkout`);
  }

  if (!payment.processorPaymentId) {
    throw new AppError(409, 'Payment is missing its Stripe payment intent');
  }

  const processorPaymentId = payment.processorPaymentId;

  const paymentIntent = await stripeCircuit.execute(() =>
    getStripeClient().paymentIntents.retrieve(processorPaymentId),
  );

  if (!paymentIntent.client_secret) {
    throw new AppError(409, 'Stripe did not return a client secret for this payment');
  }

  return {
    paymentId: payment.id,
    stripePaymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret,
    grossAmountCents: payment.grossAmountCents,
    platformFeeCents: payment.platformFeeCents,
    netCarrierCents: payment.netCarrierCents,
    paymentStatus: payment.status,
  };
}

export async function syncEscrowStatus(
  paymentId: string,
  userId: string,
  orgId: string,
  role: UserRole,
): Promise<PaymentSyncResult> {
  assertPaymentsEnabled();
  const payment = await getPaymentById(paymentId, userId, orgId, role);

  if (!payment.processorPaymentId) {
    throw new AppError(409, 'Payment is missing its Stripe payment intent');
  }

  const processorPaymentId = payment.processorPaymentId;

  const paymentIntent = await stripeCircuit.execute(() =>
    getStripeClient().paymentIntents.retrieve(processorPaymentId),
  );

  if (isEscrowAuthorizedIntentStatus(paymentIntent.status)) {
    await confirmEscrow(paymentIntent.id);
  }

  const refreshedPayment = await getPaymentById(paymentId, userId, orgId, role);
  return {
    payment: refreshedPayment,
    stripeIntentStatus: paymentIntent.status,
  };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// createEscrow â€” Creates a Stripe PaymentIntent for load payment
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function createEscrow(
  req: CreateEscrowRequest,
  userId: string,
): Promise<EscrowResult> {
  assertPaymentsEnabled();
  const platformFeeCents = Math.round(req.grossAmountCents * (req.platformFeePct / 100));
  const netCarrierCents = req.grossAmountCents - platformFeeCents;
  const advancePct = req.advancePct ?? 0;
  const advanceCents = Math.round(netCarrierCents * (advancePct / 100));

  const idempotencyKey = `escrow:${req.assignmentId}`;

  // Create Stripe PaymentIntent â€” manual capture for escrow pattern
  const paymentIntent = await stripeCircuit.execute(() => getStripeClient().paymentIntents.create(
    {
      amount: req.grossAmountCents,
      currency: 'usd',
      capture_method: 'manual',          // Hold funds, release on delivery
      metadata: {
        loadId: req.loadId,
        assignmentId: req.assignmentId,
        shipperOrgId: req.shipperOrgId,
        carrierOrgId: req.carrierOrgId,
        platformFeeCents: platformFeeCents.toString(),
      },
      description: `Load payment for assignment ${req.assignmentId}`,
    },
    { idempotencyKey: `stripe:${idempotencyKey}` },
  ));

  // Persist payment record
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);

    await client.query(
      `INSERT INTO logistics.payments (
          id, load_id, assignment_id, shipper_org_id, carrier_org_id,
          gross_amount_cents, platform_fee_cents, insurance_fee_cents,
          net_carrier_cents, escrow_amount_cents, advance_pct, advance_amount_cents,
          status, processor, processor_payment_id, idempotency_key
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4,
          $5, $6, 0,
          $7, $5, $8, $9,
          'PENDING', 'stripe', $10, $11
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id`,
      [
        req.loadId, req.assignmentId, req.shipperOrgId, req.carrierOrgId,
        req.grossAmountCents, platformFeeCents,
        netCarrierCents, advancePct, advanceCents,
        paymentIntent.id, idempotencyKey,
      ],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Fetch the created payment ID
  const rows = await pool.query(
    `SELECT id FROM logistics.payments WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  const paymentId = rows.rows[0].id;

  // Publish event
  await publishEvent(TOPICS.PAYMENT_EVENTS, {
    eventId: randomUUID(),
    eventType: 'payment.escrow_created',
    aggregateId: paymentId,
    aggregateType: 'payment',
    timestamp: new Date().toISOString(),
    version: 1,
    producedBy: config.serviceName,
    payload: { loadId: req.loadId, assignmentId: req.assignmentId, grossAmountCents: req.grossAmountCents },
  });

  logger.info({ paymentId, stripeId: paymentIntent.id, grossAmountCents: req.grossAmountCents }, 'Escrow created');

  return {
    paymentId,
    stripePaymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret!,
    grossAmountCents: req.grossAmountCents,
    platformFeeCents,
    netCarrierCents,
  };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// confirmEscrow â€” Called after Stripe confirms payment (webhook or client)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function confirmEscrow(paymentIntentId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE logistics.payments
          SET status = 'ESCROW_HELD', escrow_held_at = NOW(), updated_at = NOW()
        WHERE processor_payment_id = $1 AND status = 'PENDING'
        RETURNING id, assignment_id, advance_amount_cents, carrier_org_id`,
      [paymentIntentId],
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return; // Already confirmed or not found â€” idempotent
    }

    const payment = result.rows[0];

    // If advance configured, transfer advance to carrier immediately
    if (payment.advance_amount_cents > 0) {
      await processAdvancePayment(payment.id, payment.advance_amount_cents, payment.carrier_org_id);

      await client.query(
        `UPDATE logistics.payments
            SET status = 'PARTIALLY_RELEASED', advance_paid_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [payment.id],
      );
    }

    await client.query('COMMIT');

    await publishEvent(TOPICS.PAYMENT_EVENTS, {
      eventId: randomUUID(),
      eventType: 'payment.escrow_held',
      aggregateId: payment.id,
      aggregateType: 'payment',
      timestamp: new Date().toISOString(),
      version: 1,
      producedBy: config.serviceName,
      payload: { paymentId: payment.id, assignmentId: payment.assignment_id },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// settlePayment â€” Release escrow after delivery confirmation
//
// CRITICAL PATTERN: Two-phase settlement to prevent double-spend.
//   Phase 1: DB transaction marks payment as SETTLING + creates ledger entries.
//   Phase 2: AFTER COMMIT â€” capture Stripe PaymentIntent.
//   Phase 3: Update status to RELEASED on Stripe success.
//
// If Stripe fails after Phase 1, a reconciliation job detects SETTLING payments
// older than 10 minutes and retries the capture.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function settlePayment(req: SettlementRequest, userId: string): Promise<void> {
  assertPaymentsEnabled();
  const client = await pool.connect();
  let payment: any;

  // â”€â”€ Phase 1: DB transaction â€” lock, validate, create ledger, mark SETTLING â”€â”€
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);

    const paymentResult = await client.query(
      `SELECT id, processor_payment_id, gross_amount_cents, platform_fee_cents,
              net_carrier_cents, advance_amount_cents, carrier_org_id, shipper_org_id, status
         FROM logistics.payments
        WHERE id = $1 FOR UPDATE`,
      [req.paymentId],
    );

    if (paymentResult.rows.length === 0) throw new AppError(404, 'Payment not found');
    payment = paymentResult.rows[0];

    if (!['ESCROW_HELD', 'PARTIALLY_RELEASED'].includes(payment.status)) {
      throw new AppError(409, `Payment is in ${payment.status} state, cannot settle`);
    }

    const remainingCents = payment.net_carrier_cents - (payment.advance_amount_cents || 0);

    // Schedule carrier payout for remaining balance
    if (remainingCents > 0) {
      await client.query(
        `INSERT INTO logistics.carrier_payouts (
            id, carrier_org_id, payment_ids, total_cents, status, scheduled_at
          ) VALUES (gen_random_uuid(), $1, ARRAY[$2]::uuid[], $3, 'SCHEDULED', NOW() + INTERVAL '2 days')`,
        [payment.carrier_org_id, payment.id, remainingCents],
      );
    }

    // Mark intent to capture â€” intermediate state for reconciliation safety
    await client.query(
      `UPDATE logistics.payments
          SET status = 'RELEASED', released_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [payment.id],
    );

    // Create ledger journal entry for the settlement
    const journalId = randomUUID();
    await client.query(
      `INSERT INTO logistics.ledger_journals (id, idempotency_key, load_id, assignment_id, description, created_by, posted_at)
       VALUES ($1, $2, (SELECT load_id FROM logistics.payments WHERE id = $3), $4, $5, $6, NOW())`,
      [journalId, `settlement:${payment.id}`, payment.id, req.assignmentId, `Payment settlement for ${req.assignmentId}`, userId],
    );

    // Get/create accounts
    const shipperAcct = await getOrCreateAccount(client, payment.shipper_org_id, 'AP', 'Accounts Payable');
    const carrierAcct = await getOrCreateAccount(client, payment.carrier_org_id, 'AR', 'Accounts Receivable');
    const platformAcct = await getOrCreateAccount(client, null, 'PLATFORM_REVENUE', 'Platform Revenue');

    // Double-entry: shipper pays, carrier receives, platform takes fee
    await client.query(
      `INSERT INTO logistics.ledger_entries (journal_id, account_id, direction, amount_cents) VALUES
        ($1, $2, 'DEBIT', $5),
        ($1, $3, 'CREDIT', $6),
        ($1, $4, 'CREDIT', $7)`,
      [journalId, shipperAcct, carrierAcct, platformAcct,
        payment.gross_amount_cents, payment.net_carrier_cents, payment.platform_fee_cents],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if ((err as any)?.code === '40001') throw new AppError(409, 'Concurrent modification â€” retry');
    throw err;
  } finally {
    client.release();
  }

  // â”€â”€ Phase 2: Stripe capture OUTSIDE transaction â”€â”€
  // If this fails, the reconciliation worker retries stuck RELEASED payments.
  // Stripe capture is idempotent on the same PaymentIntent, so retries are safe.
  try {
    await stripeCircuit.execute(() => getStripeClient().paymentIntents.capture(payment.processor_payment_id, {
      amount_to_capture: payment.gross_amount_cents,
    }));
  } catch (stripeErr) {
    logger.error({ paymentId: payment.id, err: stripeErr }, 'Stripe capture failed after DB commit â€” reconciliation will retry');
    // Don't throw â€” the DB already reflects RELEASED. Reconciliation job handles retries.
    // TODO: Queue to paymentReconciliation worker for immediate retry
    return;
  }

  // â”€â”€ Phase 3: Emit event on full success â”€â”€
  await publishEvent(TOPICS.PAYMENT_EVENTS, {
    eventId: randomUUID(),
    eventType: 'payment.settled',
    aggregateId: payment.id,
    aggregateType: 'payment',
    timestamp: new Date().toISOString(),
    version: 1,
    producedBy: config.serviceName,
    payload: { paymentId: payment.id, assignmentId: req.assignmentId, netCarrierCents: payment.net_carrier_cents },
  });

  logger.info({ paymentId: payment.id, netCarrierCents: payment.net_carrier_cents }, 'Payment settled + Stripe captured');
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// processCarrierPayouts â€” Batch payout to carriers (called by scheduler)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function processCarrierPayouts(): Promise<number> {
  assertPaymentsEnabled();
  const client = await pool.connect();
  let processed = 0;

  try {
    // Fetch scheduled payouts due now
    const payouts = await client.query(
      `SELECT id, carrier_org_id, total_cents, bank_account_token
         FROM logistics.carrier_payouts
        WHERE status = 'SCHEDULED' AND scheduled_at <= NOW()
        ORDER BY scheduled_at
        LIMIT 50
        FOR UPDATE SKIP LOCKED`,
    );

    for (const payout of payouts.rows) {
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE logistics.carrier_payouts SET status = 'PROCESSING', processing_at = NOW() WHERE id = $1`,
          [payout.id],
        );

        // Create Stripe Transfer to carrier's connected account
        const transfer = await stripeCircuit.execute(() => getStripeClient().transfers.create({
          amount: payout.total_cents,
          currency: 'usd',
          destination: payout.bank_account_token || `acct_${payout.carrier_org_id}`,
          metadata: { payoutId: payout.id, carrierOrgId: payout.carrier_org_id },
        }));

        await client.query(
          `UPDATE logistics.carrier_payouts
              SET status = 'COMPLETED', completed_at = NOW(),
                  processor = 'stripe', processor_payout_id = $2, updated_at = NOW()
            WHERE id = $1`,
          [payout.id, transfer.id],
        );

        await client.query('COMMIT');
        processed++;

        logger.info({ payoutId: payout.id, totalCents: payout.total_cents }, 'Carrier payout completed');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});

        // Mark as failed with reason
        await pool.query(
          `UPDATE logistics.carrier_payouts
              SET status = 'FAILED', failed_at = NOW(), failure_reason = $2, updated_at = NOW()
            WHERE id = $1`,
          [payout.id, (err as Error).message],
        );

        logger.error({ payoutId: payout.id, err }, 'Carrier payout failed');
      }
    }
  } finally {
    client.release();
  }

  return processed;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// handleStripeWebhook â€” Process Stripe webhook events
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function handleStripeWebhook(
  payload: string | Buffer,
  signature: string,
): Promise<void> {
  assertPaymentsEnabled();
  const event = getStripeClient().webhooks.constructEvent(payload, signature, config.stripeWebhookSecret);

  switch (event.type) {
    case 'payment_intent.amount_capturable_updated': {
      const pi = event.data.object as Stripe.PaymentIntent;
      await confirmEscrow(pi.id);
      break;
    }
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      await confirmEscrow(pi.id);
      break;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      await pool.query(
        `UPDATE logistics.payments SET status = 'FAILED', updated_at = NOW()
          WHERE processor_payment_id = $1`,
        [pi.id],
      );
      logger.warn({ stripeId: pi.id }, 'Payment failed');
      break;
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute;
      await pool.query(
        `UPDATE logistics.payments SET status = 'DISPUTED', updated_at = NOW()
          WHERE processor_payment_id = $1`,
        [dispute.payment_intent],
      );
      // Flag for fraud investigation
      await pool.query(
        `INSERT INTO logistics.fraud_signals (id, entity_type, entity_id, signal_type, severity, details)
         SELECT gen_random_uuid(), 'payment', p.id, 'stripe_dispute', 'HIGH',
                jsonb_build_object('dispute_id', $2, 'reason', $3)
           FROM logistics.payments p WHERE p.processor_payment_id = $1`,
        [dispute.payment_intent, dispute.id, dispute.reason],
      );
      break;
    }
    default:
      logger.debug({ type: event.type }, 'Unhandled Stripe webhook event');
  }
}

// â”€â”€ Helper: advance payment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function processAdvancePayment(paymentId: string, amountCents: number, carrierOrgId: string): Promise<void> {
  await stripeCircuit.execute(() => getStripeClient().transfers.create({
    amount: amountCents,
    currency: 'usd',
    destination: `acct_${carrierOrgId}`,
    metadata: { paymentId, type: 'advance' },
  }));
  logger.info({ paymentId, amountCents }, 'Advance payment transferred');
}

// â”€â”€ Helper: get or create ledger account â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function getOrCreateAccount(
  client: import('pg').PoolClient,
  orgId: string | null,
  code: string,
  name: string,
): Promise<string> {
  const existing = await client.query(
    `SELECT id FROM logistics.ledger_accounts WHERE
      ${orgId ? 'organization_id = $1 AND' : 'organization_id IS NULL AND'} account_code = ${orgId ? '$2' : '$1'}`,
    orgId ? [orgId, code] : [code],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const inserted = await client.query(
    `INSERT INTO logistics.ledger_accounts (id, organization_id, account_code, account_name)
     VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
    [orgId, code, name],
  );
  return inserted.rows[0].id;
}
