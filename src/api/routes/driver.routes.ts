// ─────────────────────────────────────────────────────────────────────────────
// Driver Profile Routes — CRUD for CDL-endorsed driver management
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import * as driverSvc from '../services/driver.service.js';

const CDL_CLASSES = ['A', 'B', 'C'] as const;

const createDriverSchema = z.object({
  userId: z.string().uuid(),
  cdlNumber: z.string().min(4).max(30),
  cdlClass: z.enum(CDL_CLASSES),
  cdlState: z.string().length(2),
  cdlExpiry: z.string().date(),
  hazmatEndorsed: z.boolean().optional(),
  tankerEndorsed: z.boolean().optional(),
  doublesTriples: z.boolean().optional(),
  passengerEndorsed: z.boolean().optional(),
});

const updateDriverSchema = z.object({
  cdlClass: z.enum(CDL_CLASSES).optional(),
  cdlState: z.string().length(2).optional(),
  cdlExpiry: z.string().date().optional(),
  hazmatEndorsed: z.boolean().optional(),
  tankerEndorsed: z.boolean().optional(),
  doublesTriples: z.boolean().optional(),
  passengerEndorsed: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
});

export const driverRoutes = Router();
driverRoutes.use(authenticate);

// POST /api/v1/drivers — Create driver profile (admin/dispatcher)
driverRoutes.post('/', async (req, res, next) => {
  try {
    const body = createDriverSchema.parse(req.body);
    const user = (req as any).user;
    const result = await driverSvc.createDriverProfile(body, user.orgId, user.sub);
    res.status(201).json({ data: result });
  } catch (err) { next(err); }
});

// GET /api/v1/drivers — List drivers in org
driverRoutes.get('/', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const availableOnly = req.query.available === 'true';
    const drivers = await driverSvc.listDrivers(user.sub, availableOnly || undefined);
    res.json({ data: drivers });
  } catch (err) { next(err); }
});

// GET /api/v1/drivers/me — Current user's driver profile
driverRoutes.get('/me', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const profile = await driverSvc.getDriverProfileByUserId(user.sub);
    res.json({ data: profile });
  } catch (err) { next(err); }
});

// GET /api/v1/drivers/:driverId — Get driver profile by ID
driverRoutes.get('/:driverId', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const profile = await driverSvc.getDriverProfile(req.params.driverId, user.sub);
    res.json({ data: profile });
  } catch (err) { next(err); }
});

// PATCH /api/v1/drivers/:driverId — Update driver profile
driverRoutes.patch('/:driverId', async (req, res, next) => {
  try {
    const body = updateDriverSchema.parse(req.body);
    const user = (req as any).user;
    const profile = await driverSvc.updateDriverProfile(req.params.driverId, body, user.sub);
    res.json({ data: profile });
  } catch (err) { next(err); }
});

// POST /api/v1/drivers/:driverId/availability — Toggle on/off duty
driverRoutes.post('/:driverId/availability', async (req, res, next) => {
  try {
    const { available } = z.object({ available: z.boolean() }).parse(req.body);
    const user = (req as any).user;
    const result = await driverSvc.toggleAvailability(req.params.driverId, available, user.sub);
    res.json({ data: result });
  } catch (err) { next(err); }
});
