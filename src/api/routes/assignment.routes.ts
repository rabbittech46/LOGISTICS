// ─────────────────────────────────────────────────────────────────────────────
// Assignment Routes — Trip management, milestones, ratings
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import * as assignmentSvc from '../services/assignment.service.js';

const MILESTONES = ['pickup_arrived', 'picked_up', 'dropoff_arrived'] as const;

export const assignmentRoutes = Router();
assignmentRoutes.use(authenticate);

// GET /api/v1/assignments/tracking — List active assignments with latest truck position snapshots
assignmentRoutes.get('/tracking', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const filters: any = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.driverId) filters.driverId = req.query.driverId;
    if (req.query.truckId) filters.truckId = req.query.truckId;
    const assignments = await assignmentSvc.listAssignmentTracking(user.sub, filters);
    res.json({ data: assignments });
  } catch (err) { next(err); }
});

// GET /api/v1/assignments — List assignments for caller's org
assignmentRoutes.get('/', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const filters: any = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.driverId) filters.driverId = req.query.driverId;
    if (req.query.truckId) filters.truckId = req.query.truckId;
    const assignments = await assignmentSvc.listAssignments(user.sub, filters);
    res.json({ data: assignments });
  } catch (err) { next(err); }
});

// GET /api/v1/assignments/:assignmentId — Get assignment details
assignmentRoutes.get('/:assignmentId', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const assignment = await assignmentSvc.getAssignment(req.params.assignmentId, user.sub);
    res.json({ data: assignment });
  } catch (err) { next(err); }
});

// POST /api/v1/assignments/:assignmentId/milestones — Record delivery milestone
assignmentRoutes.post('/:assignmentId/milestones', requireRole('PLATFORM_ADMIN', 'ORG_ADMIN', 'DISPATCHER', 'DRIVER'), async (req, res, next) => {
  try {
    const { milestone } = z.object({ milestone: z.enum(MILESTONES) }).parse(req.body);
    const user = (req as any).user;
    const updated = await assignmentSvc.recordMilestone(req.params.assignmentId as string, milestone, user.sub);
    res.json({ data: updated });
  } catch (err) { next(err); }
});

// POST /api/v1/assignments/:assignmentId/rate — Submit rating
assignmentRoutes.post('/:assignmentId/rate', async (req, res, next) => {
  try {
    const { type, rating, review } = z.object({
      type: z.enum(['shipper', 'carrier']),
      rating: z.number().int().min(1).max(5),
      review: z.string().max(2000).optional(),
    }).parse(req.body);
    const user = (req as any).user;
    const updated = await assignmentSvc.submitRating(
      req.params.assignmentId, type, rating, review, user.sub,
    );
    res.json({ data: updated });
  } catch (err) { next(err); }
});

// POST /api/v1/assignments/:assignmentId/cancel — Cancel (pre-dispatch only)
assignmentRoutes.post('/:assignmentId/cancel', async (req, res, next) => {
  try {
    const user = (req as any).user;
    await assignmentSvc.cancelAssignment(req.params.assignmentId, user.sub);
    res.status(204).end();
  } catch (err) { next(err); }
});
