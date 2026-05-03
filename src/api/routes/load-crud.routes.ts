// ─────────────────────────────────────────────────────────────────────────────
// Load CRUD Routes — Create, list, get, update, post, cancel loads
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import * as loadService from '../services/load.service.js';

const CARGO_TYPES = [
  'DRY_VAN', 'REFRIGERATED', 'FLATBED', 'TANKER',
  'HAZMAT', 'OVERSIZED', 'INTERMODAL', 'CURTAIN_SIDE', 'LOWBOY',
] as const;

const LOAD_STATUSES = [
  'DRAFT', 'POSTED', 'BIDDING', 'CONFIRMED', 'ASSIGNED',
  'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'DISPUTED',
] as const;

const US_STATES = /^[A-Z]{2}$/;

const router = Router();

// ── Validation Schemas ──────────────────────────────────────────────────────

const createLoadSchema = z.object({
  cargoType: z.enum(CARGO_TYPES),
  commodity: z.string().min(1).max(200).trim(),
  weightLbs: z.number().positive().max(200_000),
  totalTrucksRequired: z.number().int().min(1).max(100).optional(),
  dimensions: z.object({
    lengthIn: z.number().positive(),
    widthIn: z.number().positive(),
    heightIn: z.number().positive(),
  }).optional(),
  pieceCount: z.number().int().positive().optional(),
  isHazmat: z.boolean().optional(),
  hazmatClass: z.string().max(5).optional(),
  hazmatUnNumber: z.string().max(10).optional(),
  temperatureMinF: z.number().optional(),
  temperatureMaxF: z.number().optional(),
  pickupAddress: z.string().min(1).max(500),
  pickupCity: z.string().min(1).max(100),
  pickupState: z.string().regex(US_STATES),
  pickupZip: z.string().min(5).max(10),
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  pickupEarliest: z.string().datetime(),
  pickupLatest: z.string().datetime(),
  pickupInstructions: z.string().max(1000).optional(),
  pickupContactName: z.string().max(100).optional(),
  pickupContactPhone: z.string().max(20).optional(),
  dropoffAddress: z.string().min(1).max(500),
  dropoffCity: z.string().min(1).max(100),
  dropoffState: z.string().regex(US_STATES),
  dropoffZip: z.string().min(5).max(10),
  dropoffLat: z.number().min(-90).max(90),
  dropoffLng: z.number().min(-180).max(180),
  dropoffEarliest: z.string().datetime(),
  dropoffLatest: z.string().datetime(),
  dropoffInstructions: z.string().max(1000).optional(),
  dropoffContactName: z.string().max(100).optional(),
  dropoffContactPhone: z.string().max(20).optional(),
  offeredRateUsd: z.number().positive().max(500_000).optional(),
  specialRequirements: z.array(z.string().max(100)).max(20).optional(),
}).refine(
  (d) => new Date(d.pickupLatest) > new Date(d.pickupEarliest),
  { message: 'pickupLatest must be after pickupEarliest' },
).refine(
  (d) => new Date(d.dropoffLatest) > new Date(d.dropoffEarliest),
  { message: 'dropoffLatest must be after dropoffEarliest' },
).refine(
  (d) => !d.isHazmat || d.hazmatClass,
  { message: 'hazmatClass required when isHazmat is true' },
);

const updateLoadSchema = z.object({
  commodity: z.string().min(1).max(200).trim().optional(),
  weightLbs: z.number().positive().max(200_000).optional(),
  offeredRateUsd: z.number().positive().max(500_000).optional(),
  pickupInstructions: z.string().max(1000).optional(),
  dropoffInstructions: z.string().max(1000).optional(),
  pickupContactName: z.string().max(100).optional(),
  pickupContactPhone: z.string().max(20).optional(),
  dropoffContactName: z.string().max(100).optional(),
  dropoffContactPhone: z.string().max(20).optional(),
  specialRequirements: z.array(z.string().max(100)).max(20).optional(),
  loadBoardVisible: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
});

const listQuerySchema = z.object({
  status: z.enum(LOAD_STATUSES).optional(),
  cargoType: z.enum(CARGO_TYPES).optional(),
  pickupState: z.string().regex(US_STATES).optional(),
  dropoffState: z.string().regex(US_STATES).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const cancelSchema = z.object({
  reason: z.string().min(1).max(500).trim(),
});

// ── POST /loads — Create a new load ─────────────────────────────────────────
router.post(
  '/',
  authenticate,
  requireRole('PLATFORM_ADMIN', 'ORG_ADMIN', 'DISPATCHER', 'SHIPPER_STAFF'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createLoadSchema.parse(req.body);
      const result = await loadService.createLoad(body, req.user!.sub, req.user!.orgId);
      res.status(201).json({ data: result });
    } catch (err) { next(err); }
  },
);

// ── GET /loads — List user's loads ──────────────────────────────────────────
router.get(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = listQuerySchema.parse(req.query);
      const result = await loadService.listLoads(q, req.user!.sub);
      res.json({ data: result.loads, meta: { total: result.total } });
    } catch (err) { next(err); }
  },
);

// ── GET /loads/board — Public load board ────────────────────────────────────
router.get(
  '/board',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = listQuerySchema.parse(req.query);
      const result = await loadService.listLoadBoard(q);
      res.json({ data: result.loads, meta: { total: result.total } });
    } catch (err) { next(err); }
  },
);

// ── GET /loads/:loadId — Get load details ───────────────────────────────────
router.get(
  '/:loadId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const load = await loadService.getLoad(req.params.loadId as string, req.user!.sub);
      res.json({ data: load });
    } catch (err) { next(err); }
  },
);

// ── PATCH /loads/:loadId — Update load ──────────────────────────────────────
router.patch(
  '/:loadId',
  authenticate,
  requireRole('PLATFORM_ADMIN', 'ORG_ADMIN', 'DISPATCHER', 'SHIPPER_STAFF'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateLoadSchema.parse(req.body);
      const load = await loadService.updateLoad(req.params.loadId as string, body, req.user!.sub);
      res.json({ data: load });
    } catch (err) { next(err); }
  },
);

// ── POST /loads/:loadId/post — Publish DRAFT → POSTED ──────────────────────
router.post(
  '/:loadId/post',
  authenticate,
  requireRole('PLATFORM_ADMIN', 'ORG_ADMIN', 'DISPATCHER', 'SHIPPER_STAFF'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const load = await loadService.postLoad(req.params.loadId as string, req.user!.sub);
      res.json({ data: load });
    } catch (err) { next(err); }
  },
);

// ── POST /loads/:loadId/cancel — Cancel load ────────────────────────────────
router.post(
  '/:loadId/cancel',
  authenticate,
  requireRole('PLATFORM_ADMIN', 'ORG_ADMIN', 'DISPATCHER', 'SHIPPER_STAFF'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = cancelSchema.parse(req.body);
      await loadService.cancelLoad(req.params.loadId as string, body.reason, req.user!.sub);
      res.json({ data: { message: 'Load cancelled' } });
    } catch (err) { next(err); }
  },
);

export { router as loadCrudRoutes };
