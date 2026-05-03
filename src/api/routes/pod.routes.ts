// ─────────────────────────────────────────────────────────────────────────────
// Proof-of-Delivery Routes
//
// POST /api/v1/pod/:assignmentId/upload-urls  — Get presigned S3 upload URLs
// POST /api/v1/pod/:assignmentId/confirm      — Confirm delivery + settle
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { generateUploadUrls, confirmDelivery } from '../services/pod.service.js';
import { AppError } from '../../shared/app-error.js';

const router = Router();

const uploadUrlsSchema = z.object({
  fileCount: z.number().int().min(1).max(10),
});

/**
 * POST /api/v1/pod/:assignmentId/upload-urls
 *
 * Driver requests presigned S3 PUT URLs for POD photo uploads.
 */
router.post(
  '/:assignmentId/upload-urls',
  authenticate,
  requireRole('DRIVER'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const assignmentId = req.params.assignmentId as string;
      const parsed = uploadUrlsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
        return;
      }

      const urls = await generateUploadUrls(
        { assignmentId, fileCount: parsed.data.fileCount },
        req.user!.sub,
      );
      res.json({ urls });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      next(err);
    }
  },
);

const confirmSchema = z.object({
  podPhotoKeys: z.array(z.string().min(1)).min(1).max(10),
  podSignatureUrl: z.string().url().optional(),
  podNotes: z.string().max(2000).optional(),
});

/**
 * POST /api/v1/pod/:assignmentId/confirm
 *
 * Driver confirms delivery: stores POD data, marks DELIVERED,
 * and triggers the Stripe-backed payment settlement flow.
 */
router.post(
  '/:assignmentId/confirm',
  authenticate,
  requireRole('PLATFORM_ADMIN', 'DRIVER', 'DISPATCHER', 'ORG_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const assignmentId = req.params.assignmentId as string;
      const parsed = confirmSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
        return;
      }

      const result = await confirmDelivery(
        { assignmentId, ...parsed.data },
        req.user!.sub,
        req.user!.orgId,
        req.user!.role,
      );
      res.status(200).json(result);
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
