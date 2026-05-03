// ─────────────────────────────────────────────────────────────────────────────
// Truck Routes — CRUD for fleet management
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import * as truckSvc from '../services/truck.service.js';

const CARGO_TYPES = [
  'DRY_VAN', 'REFRIGERATED', 'FLATBED', 'TANKER', 'HAZMAT',
  'OVERSIZED', 'INTERMODAL', 'CURTAIN_SIDE', 'LOWBOY',
] as const;

const TRUCK_STATUSES = ['AVAILABLE', 'BUSY', 'MAINTENANCE', 'DECOMMISSIONED'] as const;

const createTruckSchema = z.object({
  vin: z.string().min(11).max(17),
  plateNumber: z.string().min(1).max(20),
  plateState: z.string().length(2),
  make: z.string().min(1).max(50),
  model: z.string().min(1).max(50),
  year: z.number().int().min(1980).max(new Date().getFullYear() + 2),
  cargoType: z.enum(CARGO_TYPES),
  lengthIn: z.number().positive(),
  widthIn: z.number().positive(),
  heightIn: z.number().positive(),
  payloadCapacityLbs: z.number().positive(),
  grossVehicleWtLbs: z.number().positive(),
  assignedDriverId: z.string().uuid().optional(),
  lastInspectionDate: z.string().date().optional(),
  insuranceExpiry: z.string().date(),
  registrationExpiry: z.string().date().optional(),
  notes: z.string().max(2000).optional(),
});

const updateTruckSchema = z.object({
  plateNumber: z.string().min(1).max(20).optional(),
  plateState: z.string().length(2).optional(),
  assignedDriverId: z.string().uuid().nullable().optional(),
  status: z.enum(TRUCK_STATUSES).optional(),
  lastInspectionDate: z.string().date().optional(),
  insuranceExpiry: z.string().date().optional(),
  registrationExpiry: z.string().date().optional(),
  notes: z.string().max(2000).optional(),
});

export const truckRoutes = Router();
truckRoutes.use(authenticate);

// POST /api/v1/trucks — Create truck
truckRoutes.post('/', async (req, res, next) => {
  try {
    const body = createTruckSchema.parse(req.body);
    const user = (req as any).user;
    const result = await truckSvc.createTruck(body, user.sub, user.orgId);
    res.status(201).json({ data: result });
  } catch (err) { next(err); }
});

// GET /api/v1/trucks — List trucks for current org
truckRoutes.get('/', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const status = req.query.status as string | undefined;
    const cargoType = req.query.cargoType as string | undefined;
    const trucks = await truckSvc.listTrucks(user.sub, user.orgId, status as any, cargoType as any);
    res.json({ data: trucks });
  } catch (err) { next(err); }
});

// GET /api/v1/trucks/:truckId — Get truck details
truckRoutes.get('/:truckId', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const truck = await truckSvc.getTruck(req.params.truckId, user.sub);
    res.json({ data: truck });
  } catch (err) { next(err); }
});

// PATCH /api/v1/trucks/:truckId — Update truck
truckRoutes.patch('/:truckId', async (req, res, next) => {
  try {
    const body = updateTruckSchema.parse(req.body);
    const user = (req as any).user;
    const truck = await truckSvc.updateTruck(req.params.truckId, body, user.sub);
    res.json({ data: truck });
  } catch (err) { next(err); }
});
