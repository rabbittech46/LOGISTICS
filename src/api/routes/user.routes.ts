// ─────────────────────────────────────────────────────────────────────────────
// User Routes — Profile management, password change
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import * as userService from '../services/user.service.js';

const router = Router();

// ── Validation Schemas ──────────────────────────────────────────────────────

const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(100).trim().optional(),
  lastName: z.string().min(1).max(100).trim().optional(),
  phone: z.string().max(20).optional(),
  avatarUrl: z.string().url().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128)
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[a-z]/, 'Must contain lowercase letter')
    .regex(/[0-9]/, 'Must contain digit')
    .regex(/[^A-Za-z0-9]/, 'Must contain special character'),
});

const searchUsersQuerySchema = z.object({
  q: z.string().min(2).max(255).trim(),
});

// ── GET /users/me — Get current user's profile ──────────────────────────────
router.get(
  '/me',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await userService.getProfile(req.user!.sub);
      res.json({ data: profile });
    } catch (err) { next(err); }
  },
);

// ── PATCH /users/me — Update current user's profile ─────────────────────────
router.patch(
  '/me',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateProfileSchema.parse(req.body);
      const user = await userService.updateProfile(req.user!.sub, body);
      res.json({ data: user });
    } catch (err) { next(err); }
  },
);

// ── POST /users/me/change-password — Change password ────────────────────────
router.post(
  '/me/change-password',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = changePasswordSchema.parse(req.body);
      await userService.changePassword(req.user!.sub, body);
      res.json({ data: { message: 'Password changed successfully' } });
    } catch (err) { next(err); }
  },
);

// ── GET /users/:userId — Admin: get user by ID ─────────────────────────────
router.get(
  '/search',
  authenticate,
  requireRole('PLATFORM_ADMIN', 'ORG_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = searchUsersQuerySchema.parse(req.query);
      const users = await userService.searchUsers(query.q, req.user!.sub);
      res.json({ data: users });
    } catch (err) { next(err); }
  },
);

// ── GET /users/:userId — Admin: get user by ID ─────────────────────────────
router.get(
  '/:userId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await userService.getUserById(req.params.userId as string, req.user!.sub);
      res.json({ data: user });
    } catch (err) { next(err); }
  },
);

export { router as userRoutes };
