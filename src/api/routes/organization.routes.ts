// ─────────────────────────────────────────────────────────────────────────────
// Organization Routes — CRUD + member management
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import * as orgService from '../services/organization.service.js';

const router = Router();

// ── Validation Schemas ──────────────────────────────────────────────────────

const createOrgSchema = z.object({
  name: z.string().min(2).max(200).trim(),
  orgType: z.enum(['SHIPPER', 'CARRIER']),
  contactEmail: z.string().email().max(255),
  contactPhone: z.string().max(20).optional(),
  ein: z.string().max(20).optional(),
  mcNumber: z.string().max(20).optional(),
  dotNumber: z.string().max(20).optional(),
  billingAddress: z.object({
    street: z.string().max(255),
    city: z.string().max(100),
    state: z.string().max(2),
    zip: z.string().max(10),
    country: z.string().max(2).default('US'),
  }).optional(),
});

const updateOrgSchema = z.object({
  name: z.string().min(2).max(200).trim().optional(),
  contactEmail: z.string().email().max(255).optional(),
  contactPhone: z.string().max(20).optional(),
  logoUrl: z.string().url().max(500).optional(),
  billingAddress: z.object({
    street: z.string().max(255),
    city: z.string().max(100),
    state: z.string().max(2),
    zip: z.string().max(10),
    country: z.string().max(2).default('US'),
  }).optional(),
  settings: z.record(z.unknown()).optional(),
});

const inviteMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['ORG_ADMIN', 'DISPATCHER', 'DRIVER', 'SHIPPER_STAFF']),
});

// ── POST /organizations — Create organization ───────────────────────────────
router.post(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createOrgSchema.parse(req.body);
      const result = await orgService.createOrganization(body, req.user!.sub);
      res.status(201).json({ data: { ...result, orgId: result.id } });
    } catch (err) { next(err); }
  },
);

// ── GET /organizations — List user's organizations ──────────────────────────
router.get(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgs = await orgService.listUserOrganizations(req.user!.sub);
      res.json({ data: orgs });
    } catch (err) { next(err); }
  },
);

// ── GET /organizations/:orgId — Get organization details ────────────────────
router.get(
  '/:orgId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const org = await orgService.getOrganization(req.params.orgId as string, req.user!.sub);
      res.json({ data: org });
    } catch (err) { next(err); }
  },
);

// ── PATCH /organizations/:orgId — Update organization ───────────────────────
router.patch(
  '/:orgId',
  authenticate,
  requireRole('PLATFORM_ADMIN', 'ORG_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateOrgSchema.parse(req.body);
      const org = await orgService.updateOrganization(req.params.orgId as string, body, req.user!.sub);
      res.json({ data: org });
    } catch (err) { next(err); }
  },
);

// ── GET /organizations/:orgId/members — List members ────────────────────────
router.get(
  '/:orgId/members',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const members = await orgService.listMembers(req.params.orgId as string, req.user!.sub);
      res.json({ data: members });
    } catch (err) { next(err); }
  },
);

// ── POST /organizations/:orgId/members — Invite member ──────────────────────
router.post(
  '/:orgId/members',
  authenticate,
  requireRole('PLATFORM_ADMIN', 'ORG_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = inviteMemberSchema.parse(req.body);
      const result = await orgService.inviteMember(req.params.orgId as string, body, req.user!.sub);
      res.status(201).json({ data: result });
    } catch (err) { next(err); }
  },
);

// ── DELETE /organizations/:orgId/members/:userId — Remove member ────────────
router.delete(
  '/:orgId/members/:userId',
  authenticate,
  requireRole('PLATFORM_ADMIN', 'ORG_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await orgService.removeMember(req.params.orgId as string, req.params.userId as string, req.user!.sub);
      res.json({ data: { message: 'Member removed' } });
    } catch (err) { next(err); }
  },
);

export { router as organizationRoutes };
