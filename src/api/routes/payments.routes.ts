// ─────────────────────────────────────────────────────────────────────────────
// Payments Routes — Escrow, settlement, payouts, Stripe webhooks
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/app-error.js';
import { isFeatureEnabled } from '../../shared/feature-flags.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import * as paymentService from '../services/payment.service.js';

const router = Router();

router.use((_req: Request, _res: Response, next: NextFunction) => {
  if (!isFeatureEnabled('payments')) {
    next(new AppError(503, 'Payments feature is disabled'));
    return;
  }
  next();
});

// ── Validation Schemas ──────────────────────────────────────────────────────

const createEscrowSchema = z.object({
  loadId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  shipperOrgId: z.string().uuid(),
  carrierOrgId: z.string().uuid(),
  grossAmountCents: z.number().int().positive().max(50_000_00), // $50k max
  platformFeePct: z.number().min(0).max(30),
  advancePct: z.number().min(0).max(50).optional(),
});

const settleSchema = z.object({
  paymentId: z.string().uuid(),
  assignmentId: z.string().uuid(),
});

const paymentStatusSchema = z.enum([
  'PENDING',
  'ESCROW_HELD',
  'PARTIALLY_RELEASED',
  'RELEASED',
  'FAILED',
  'REFUNDED',
  'DISPUTED',
]);

const listPaymentsQuerySchema = z.object({
  assignmentId: z.string().uuid().optional(),
  loadId: z.string().uuid().optional(),
  status: paymentStatusSchema.optional(),
});

const paymentIdParamsSchema = z.object({
  paymentId: z.string().uuid(),
});

// ── GET /payments — List payments visible to the caller ─────────────────────
router.get('/', authenticate, requireRole('PLATFORM_ADMIN', 'ORG_ADMIN', 'DISPATCHER', 'SHIPPER_STAFF'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listPaymentsQuerySchema.parse(req.query);
    const payments = await paymentService.listPayments(req.user!.sub, req.user!.orgId, req.user!.role, query);
    res.json({ data: payments });
  } catch (err) { next(err); }
});

// ── GET /payments/:paymentId — Get payment detail ───────────────────────────
router.get('/:paymentId', authenticate, requireRole('PLATFORM_ADMIN', 'ORG_ADMIN', 'DISPATCHER', 'SHIPPER_STAFF'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { paymentId } = paymentIdParamsSchema.parse(req.params);
    const payment = await paymentService.getPaymentById(paymentId, req.user!.sub, req.user!.orgId, req.user!.role);
    res.json({ data: payment });
  } catch (err) { next(err); }
});

// ── GET /payments/:paymentId/checkout — Fetch Stripe client secret ──────────
router.get('/:paymentId/checkout', authenticate, requireRole('PLATFORM_ADMIN', 'ORG_ADMIN', 'DISPATCHER', 'SHIPPER_STAFF'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { paymentId } = paymentIdParamsSchema.parse(req.params);
    const session = await paymentService.getPaymentCheckoutSession(paymentId, req.user!.sub, req.user!.orgId, req.user!.role);
    res.json({ data: session });
  } catch (err) { next(err); }
});

// ── POST /payments/:paymentId/sync — Reconcile Stripe auth → escrow held ───
router.post('/:paymentId/sync', authenticate, requireRole('PLATFORM_ADMIN', 'ORG_ADMIN', 'DISPATCHER', 'SHIPPER_STAFF'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { paymentId } = paymentIdParamsSchema.parse(req.params);
    const result = await paymentService.syncEscrowStatus(paymentId, req.user!.sub, req.user!.orgId, req.user!.role);
    res.json({ data: result });
  } catch (err) { next(err); }
});

// ── POST /payments/escrow — Create escrow hold ──────────────────────────────
router.post('/escrow', authenticate, requireRole('PLATFORM_ADMIN', 'ORG_ADMIN', 'DISPATCHER', 'SHIPPER_STAFF'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createEscrowSchema.parse(req.body);
    const result = await paymentService.createEscrow(body, req.user!.sub);
    res.status(201).json({ data: result });
  } catch (err) { next(err); }
});

// ── POST /payments/settle — Release escrow on delivery ──────────────────────
router.post('/settle', authenticate, requireRole('PLATFORM_ADMIN', 'ORG_ADMIN', 'DISPATCHER', 'SHIPPER_STAFF'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = settleSchema.parse(req.body);
    await paymentService.settlePayment(body, req.user!.sub);
    res.json({ data: { message: 'Payment settled and carrier payout scheduled' } });
  } catch (err) { next(err); }
});

// ── POST /payments/process-payouts — Batch carrier payouts (internal/cron) ──
router.post('/process-payouts', authenticate, requireRole('PLATFORM_ADMIN'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const processed = await paymentService.processCarrierPayouts();
    res.json({ data: { processed } });
  } catch (err) { next(err); }
});

// ── POST /payments/webhook — Stripe webhook (no auth, signature verified) ───
router.post('/webhook', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sig = req.headers['stripe-signature'];
    if (!sig || typeof sig !== 'string') {
      res.status(400).json({ error: 'Missing Stripe signature' });
      return;
    }
    // req.body is raw Buffer (express.raw() registered in server.ts BEFORE express.json())
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    await paymentService.handleStripeWebhook(rawBody, sig);
    res.json({ received: true });
  } catch (err) { next(err); }
});

export { router as paymentsRoutes };
