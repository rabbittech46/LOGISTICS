// ─────────────────────────────────────────────────────────────────────────────
// Load Award and Dispatch Routes
//
// POST /api/v1/loads/:loadId/award     — Award bid → create assignment
// POST /api/v1/loads/:loadId/accept    — Backward-compatible alias for award
// POST /api/v1/loads/:loadId/dispatch  — Carrier dispatch → IN_TRANSIT
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { acceptLoad, dispatchLoad } from '../services/load-acceptance.service.js';
import { AppError } from '../../shared/app-error.js';

const router = Router();

const acceptBodySchema = z.object({
  bidId: z.string().uuid(),
  driverId: z.string().uuid().optional(),
  truckId: z.string().uuid().optional(),
});

async function handleAward(req: Request, res: Response, next: NextFunction) {
  try {
    const loadId = req.params.loadId as string;
    const parsed = acceptBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
      return;
    }

    const user = req.user!;
    const result = await acceptLoad(
      { ...parsed.data, loadId },
      user.sub,
      user.orgId,
      user.role,
    );
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    next(err);
  }
}

/**
 * POST /api/v1/loads/:loadId/award
 *
 * Shipper or platform awards a carrier bid, creating an assignment.
 * Atomic transaction: bid → ACCEPTED, load → CONFIRMED, truck → BUSY.
 */
router.post(
  '/:loadId/award',
  authenticate,
  requireRole('PLATFORM_ADMIN', 'ORG_ADMIN', 'SHIPPER_STAFF'),
  handleAward,
);

/**
 * POST /api/v1/loads/:loadId/accept
 *
 * Backward-compatible alias for the award workflow.
 */
router.post(
  '/:loadId/accept',
  authenticate,
  requireRole('PLATFORM_ADMIN', 'ORG_ADMIN', 'SHIPPER_STAFF'),
  handleAward,
);

const dispatchBodySchema = z.object({
  assignmentId: z.string().uuid(),
});

/**
 * POST /api/v1/loads/:loadId/dispatch
 *
 * Carrier dispatches the awarded assignment and transitions the load to IN_TRANSIT.
 */
router.post(
  '/:loadId/dispatch',
  authenticate,
  requireRole('PLATFORM_ADMIN', 'ORG_ADMIN', 'DISPATCHER'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const loadId = req.params.loadId as string;
      const parsed = dispatchBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
        return;
      }

      const user = req.user!;
      await dispatchLoad(loadId, parsed.data.assignmentId, user.sub, user.orgId, user.role);
      res.json({ message: 'Load dispatched successfully' });
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
