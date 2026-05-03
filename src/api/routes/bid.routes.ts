// ─────────────────────────────────────────────────────────────────────────────
// Bid Routes — Create, list, withdraw, counter-offer
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import * as bidService from '../services/bid.service.js';

const router = Router();

// ── Validation Schemas ──────────────────────────────────────────────────────

const createBidSchema = z.object({
  loadId: z.string().uuid(),
  truckId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  bidAmountUsd: z.number().positive().max(500_000),
  ratePerMileUsd: z.number().positive().max(100).optional(),
  pickupEta: z.string().datetime().optional(),
  deliveryEta: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
  expiresAt: z.string().datetime().optional(),
});

const counterOfferSchema = z.object({
  counterOfferUsd: z.number().positive().max(500_000),
});

// ── POST /bids — Create a bid on a load ─────────────────────────────────────
router.post(
  '/',
  authenticate,
  requireRole('ORG_ADMIN', 'DISPATCHER'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createBidSchema.parse(req.body);
      const result = await bidService.createBid(body, req.user!.sub, req.user!.orgId);
      res.status(201).json({ data: { ...result, bidId: result.id } });
    } catch (err) { next(err); }
  },
);

// ── GET /bids — List carrier's own bids ─────────────────────────────────────
router.get(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const bids = await bidService.listCarrierBids(req.user!.sub, status);
      res.json({ data: bids });
    } catch (err) { next(err); }
  },
);

// ── GET /bids/load/:loadId — List all bids for a load ──────────────────────
router.get(
  '/load/:loadId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bids = await bidService.listBidsForLoad(req.params.loadId as string, req.user!.sub);
      res.json({ data: bids });
    } catch (err) { next(err); }
  },
);

// ── GET /bids/:bidId — Get bid details ──────────────────────────────────────
router.get(
  '/:bidId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bid = await bidService.getBid(req.params.bidId as string, req.user!.sub);
      res.json({ data: bid });
    } catch (err) { next(err); }
  },
);

// ── POST /bids/:bidId/withdraw — Carrier withdraws bid ─────────────────────
router.post(
  '/:bidId/withdraw',
  authenticate,
  requireRole('ORG_ADMIN', 'DISPATCHER'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await bidService.withdrawBid(req.params.bidId as string, req.user!.sub);
      res.json({ data: { message: 'Bid withdrawn' } });
    } catch (err) { next(err); }
  },
);

// ── POST /bids/:bidId/counter — Shipper counters bid ────────────────────────
router.post(
  '/:bidId/counter',
  authenticate,
  requireRole('PLATFORM_ADMIN', 'ORG_ADMIN', 'SHIPPER_STAFF'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = counterOfferSchema.parse(req.body);
      const bid = await bidService.counterOffer(req.params.bidId as string, body, req.user!.sub);
      res.json({ data: bid });
    } catch (err) { next(err); }
  },
);

export { router as bidRoutes };
