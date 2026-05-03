// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas for form validation  (Zod v4 API)
// ─────────────────────────────────────────────────────────────────────────────
import { z } from 'zod';

// ── Auth ────────────────────────────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginFormData = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[a-z]/, 'Must contain a lowercase letter')
    .regex(/[0-9]/, 'Must contain a digit')
    .regex(/[^A-Za-z0-9]/, 'Must contain a special character'),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  phone: z.string().max(20).optional(),
});
export type RegisterFormData = z.infer<typeof registerSchema>;

// ── Create Load ─────────────────────────────────────────────────────────────
export const cargoTypes = [
  'DRY_VAN', 'REFRIGERATED', 'FLATBED', 'TANKER', 'HAZMAT',
  'OVERSIZED', 'INTERMODAL', 'CURTAIN_SIDE', 'LOWBOY',
] as const;

export const createLoadSchema = z.object({
  cargoType: z.enum(cargoTypes, { message: 'Cargo type is required' }),
  commodity: z.string().min(1, 'Commodity is required').max(200),
  weightLbs: z.coerce.number().positive('Weight must be positive').max(200000),
  totalTrucksRequired: z.coerce.number().int().min(1).max(100).default(1),
  offeredRateUsd: z.coerce.number().positive().max(500000).optional(),

  pickupAddress: z.string().min(1, 'Pickup address is required'),
  pickupCity: z.string().min(1, 'Pickup city is required'),
  pickupState: z.string().min(2).max(2),
  pickupZip: z.string().min(5).max(10),
  pickupLat: z.coerce.number().min(-90).max(90),
  pickupLng: z.coerce.number().min(-180).max(180),
  pickupEarliest: z.string().min(1, 'Pickup earliest is required'),
  pickupLatest: z.string().min(1, 'Pickup latest is required'),
  pickupInstructions: z.string().max(500).optional(),
  pickupContactName: z.string().max(100).optional(),
  pickupContactPhone: z.string().max(20).optional(),

  dropoffAddress: z.string().min(1, 'Dropoff address is required'),
  dropoffCity: z.string().min(1, 'Dropoff city is required'),
  dropoffState: z.string().min(2).max(2),
  dropoffZip: z.string().min(5).max(10),
  dropoffLat: z.coerce.number().min(-90).max(90),
  dropoffLng: z.coerce.number().min(-180).max(180),
  dropoffEarliest: z.string().min(1, 'Dropoff earliest is required'),
  dropoffLatest: z.string().min(1, 'Dropoff latest is required'),
  dropoffInstructions: z.string().max(500).optional(),
  dropoffContactName: z.string().max(100).optional(),
  dropoffContactPhone: z.string().max(20).optional(),

  specialRequirements: z.array(z.string()).max(20).optional(),
  isHazmat: z.boolean().default(false),
  hazmatClass: z.string().optional(),
});
export type CreateLoadFormData = z.infer<typeof createLoadSchema>;

// ── Confirm Booking ─────────────────────────────────────────────────────────
export const confirmBookingSchema = z.object({
  slotId: z.string().uuid('Invalid slot ID'),
  truckId: z.string().uuid('Select a truck'),
  driverId: z.string().uuid().optional(),
  agreedRateUsd: z.coerce.number().positive().max(500000).optional(),
});
export type ConfirmBookingFormData = z.infer<typeof confirmBookingSchema>;

// ── Organization ────────────────────────────────────────────────────────────
export const createOrgSchema = z.object({
  name: z.string().min(2).max(200),
  orgType: z.enum(['SHIPPER', 'CARRIER']),
  contactEmail: z.string().email(),
  contactPhone: z.string().max(20).optional(),
  mcNumber: z.string().optional(),
  dotNumber: z.string().optional(),
});
export type CreateOrgFormData = z.infer<typeof createOrgSchema>;
