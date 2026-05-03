// ─────────────────────────────────────────────────────────────────────────────
// Matching Routes — POST /api/v1/loads/:loadId/match
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { findMatchingTrucks, enqueueMatchJob } from '../services/matching.service.js';
import { AppError } from '../../shared/app-error.js';

const router = Router();

const matchQuerySchema = z.object({
  radiusMiles: z.coerce.number().min(1).max(500).optional(),
  async: z.enum(['true', 'false']).optional(),
});

/**
 * POST /api/v1/loads/:loadId/match
 *
 * Synchronous (default): returns scored truck candidates immediately.
 * Async (?async=true): enqueues a BullMQ job and returns jobId.
 *
 * Roles: PLATFORM_ADMIN, ORG_ADMIN, DISPATCHER, SHIPPER_STAFF
 */
router.post(
  '/:loadId/match',
  authenticate,
  requireRole('PLATFORM_ADMIN', 'ORG_ADMIN', 'DISPATCHER', 'SHIPPER_STAFF'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const loadId = req.params.loadId as string;
      const parsed = matchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
        return;
      }

      const user = req.user!;
      const { radiusMiles } = parsed.data;
      const isAsync = parsed.data.async === 'true';

      if (isAsync) {
        const jobId = await enqueueMatchJob(loadId, user.sub);
        res.status(202).json({ jobId, message: 'Match job enqueued' });
        return;
      }

      const result = await findMatchingTrucks({ loadId, radiusMiles }, user.sub);
      res.json(result);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      next(err);
    }
  },
);

export default router;
