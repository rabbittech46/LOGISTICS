// ─────────────────────────────────────────────────────────────────────────────
// Pricing Routes — Price quotes and pricing model management
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { calculatePrice } from '../services/pricing.service.js';

const router = Router();

const quoteSchema = z.object({
  cargoType: z.enum(['DRY_VAN', 'FLATBED', 'REFRIGERATED', 'TANKER', 'INTERMODAL', 'OVERSIZED']),
  weightLbs: z.number().positive().max(80_000),
  distanceMiles: z.number().positive().max(5_000),
  originState: z.string().length(2),
  destState: z.string().length(2),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  isHazmat: z.boolean().optional(),
  isOversized: z.boolean().optional(),
  shipperOrgId: z.string().uuid().optional(),
});

// ── POST /pricing/quote ─────────────────────────────────────────────────────
router.post('/quote', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = quoteSchema.parse(req.body);
    const quote = await calculatePrice(body);
    res.json({ data: quote });
  } catch (err) { next(err); }
});

export { router as pricingRoutes };
