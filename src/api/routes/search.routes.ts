// ─────────────────────────────────────────────────────────────────────────────
// Search Routes — Elasticsearch-powered load board search
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { z } from 'zod';
import { searchLoads, type LoadSearchParams } from '../../shared/elasticsearch.js';
import { authenticate } from '../middleware/auth.js';
import { logger } from '../../shared/logger.js';

const SORT_FIELDS = ['pickup_earliest', 'offered_rate_usd', 'distance_miles', 'created_at'] as const;
const SORT_ORDERS = ['asc', 'desc'] as const;

const searchSchema = z.object({
  query: z.string().max(200).optional(),
  cargoType: z.string().optional(),
  originState: z.string().length(2).optional(),
  destState: z.string().length(2).optional(),
  pickupAfter: z.string().datetime().optional(),
  pickupBefore: z.string().datetime().optional(),
  minWeight: z.coerce.number().positive().optional(),
  maxWeight: z.coerce.number().positive().optional(),
  minRate: z.coerce.number().positive().optional(),
  maxRate: z.coerce.number().positive().optional(),
  nearLat: z.coerce.number().min(-90).max(90).optional(),
  nearLng: z.coerce.number().min(-180).max(180).optional(),
  radiusMiles: z.coerce.number().positive().max(1000).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  sortBy: z.enum(SORT_FIELDS).optional(),
  sortOrder: z.enum(SORT_ORDERS).optional(),
});

export const searchRoutes = Router();
searchRoutes.use(authenticate);

// GET /api/v1/search/loads — Full-text + geo load board search
searchRoutes.get('/loads', async (req, res, next) => {
  try {
    const params: LoadSearchParams = searchSchema.parse(req.query);
    const results = await searchLoads(params);
    res.json(results);
  } catch (err) {
    // If Elasticsearch is down, return a graceful degradation message
    if ((err as any)?.name === 'ConnectionError' || (err as any)?.name === 'TimeoutError') {
      logger.warn({ err }, 'Elasticsearch unavailable — search degraded');
      res.status(503).json({ error: 'Search service temporarily unavailable' });
      return;
    }
    next(err);
  }
});
