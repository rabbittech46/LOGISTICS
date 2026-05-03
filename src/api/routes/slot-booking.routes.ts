// ─────────────────────────────────────────────────────────────────────────────
// Slot Booking Routes — Multi-Truck Capacity Reservation API
//
// Endpoints:
//   POST   /api/v1/loads/:loadId/reserve   — Reserve one available slot
//   POST   /api/v1/loads/:loadId/confirm   — Confirm reservation → booking
//   POST   /api/v1/loads/:loadId/cancel    — Cancel an active reservation
//   GET    /api/v1/loads/:loadId/slots     — Slot availability summary
//   GET    /api/v1/loads/:loadId/my-slot   — User's reservation on this load
//
// All mutating endpoints require:
//   - Authentication (Bearer JWT)
//   - RBAC role check (ORG_ADMIN, DISPATCHER, or DRIVER)
//   - Idempotency-Key header (prevents duplicate processing on retries)
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  requireIdempotencyKey,
  checkIdempotency,
  storeIdempotencyResult,
} from '../middleware/idempotency.js';
import * as slotService from '../services/slot-booking.service.js';

const router = Router();

// ── Validation Schemas ──────────────────────────────────────────────────────

const confirmBookingSchema = z.object({
  slotId: z.string().uuid(),
  truckId: z.string().uuid(),
  driverId: z.string().uuid().optional(),
  agreedRateUsd: z.number().positive().max(999_999).optional(),
});

const cancelReservationSchema = z.object({
  slotId: z.string().uuid(),
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /loads/:loadId/reserve — Reserve one available slot on a multi-truck load
//
// Headers required: Authorization, Idempotency-Key
//
// Response 201: { data: { slotId, loadId, slotNumber, status, reservationExpiresAt } }
// Response 409: No available slots / already reserved
// Response 429: Too many active reservations
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/:loadId/reserve',
  authenticate,
  requireRole('ORG_ADMIN', 'DISPATCHER', 'DRIVER'),
  requireIdempotencyKey,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const loadId = req.params.loadId as string;
      const userId = req.user!.sub;
      const orgId = req.user!.orgId;
      const idempotencyKey = (req as any).idempotencyKey as string;

      // ── Idempotency check: replay cached response if key seen before ────
      const cached = await checkIdempotency(idempotencyKey, userId);
      if (cached) {
        res.status(cached.responseCode).json(cached.responseBody);
        return;
      }

      const result = await slotService.reserveSlot(
        { loadId, idempotencyKey },
        userId,
        orgId,
      );

      const responseBody = { data: result };

      // Store response for idempotency replay
      await storeIdempotencyResult(
        idempotencyKey,
        userId,
        `POST /loads/${loadId}/reserve`,
        201,
        responseBody,
      );

      res.status(201).json(responseBody);
    } catch (err) {
      next(err);
    }
  },
);


// ─────────────────────────────────────────────────────────────────────────────
// POST /loads/:loadId/confirm — Confirm a reservation → create binding booking
//
// Body: { slotId: UUID, truckId: UUID, driverId?: UUID, agreedRateUsd?: number }
// Headers required: Authorization, Idempotency-Key
//
// Response 200: { data: { bookingId, slotId, loadId, status, confirmedAt } }
// Response 409: Slot not reserved / expired / wrong status
// Response 410: Reservation expired
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/:loadId/confirm',
  authenticate,
  requireRole('ORG_ADMIN', 'DISPATCHER', 'DRIVER'),
  requireIdempotencyKey,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const loadId = req.params.loadId as string;
      const userId = req.user!.sub;
      const orgId = req.user!.orgId;
      const idempotencyKey = (req as any).idempotencyKey as string;

      // ── Idempotency check ───────────────────────────────────────────────
      const cached = await checkIdempotency(idempotencyKey, userId);
      if (cached) {
        res.status(cached.responseCode).json(cached.responseBody);
        return;
      }

      const body = confirmBookingSchema.parse(req.body);

      const result = await slotService.confirmBooking(
        {
          loadId,
          slotId: body.slotId,
          truckId: body.truckId,
          driverId: body.driverId,
          agreedRateUsd: body.agreedRateUsd,
          idempotencyKey,
        },
        userId,
        orgId,
      );

      const responseBody = { data: result };

      await storeIdempotencyResult(
        idempotencyKey,
        userId,
        `POST /loads/${loadId}/confirm`,
        200,
        responseBody,
      );

      res.status(200).json(responseBody);
    } catch (err) {
      next(err);
    }
  },
);


// ─────────────────────────────────────────────────────────────────────────────
// POST /loads/:loadId/cancel-reservation — Release a RESERVED slot
//
// Body: { slotId: UUID }
// Headers required: Authorization, Idempotency-Key
//
// Response 200: { data: { slotId, status: 'AVAILABLE' } }
// Response 409: Slot is BOOKED (use booking cancellation flow instead)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/:loadId/cancel-reservation',
  authenticate,
  requireRole('ORG_ADMIN', 'DISPATCHER', 'DRIVER'),
  requireIdempotencyKey,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const loadId = req.params.loadId as string;
      const userId = req.user!.sub;
      const idempotencyKey = (req as any).idempotencyKey as string;

      const cached = await checkIdempotency(idempotencyKey, userId);
      if (cached) {
        res.status(cached.responseCode).json(cached.responseBody);
        return;
      }

      const body = cancelReservationSchema.parse(req.body);

      const result = await slotService.cancelReservation(
        { loadId, slotId: body.slotId, idempotencyKey },
        userId,
      );

      const responseBody = { data: result };

      await storeIdempotencyResult(
        idempotencyKey,
        userId,
        `POST /loads/${loadId}/cancel-reservation`,
        200,
        responseBody,
      );

      res.status(200).json(responseBody);
    } catch (err) {
      next(err);
    }
  },
);


// ─────────────────────────────────────────────────────────────────────────────
// GET /loads/:loadId/slots — Slot availability summary (public for load board)
//
// Response 200: { data: { totalSlots, availableSlots, reservedSlots, bookedSlots } }
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/:loadId/slots',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const loadId = req.params.loadId as string;
      const summary = await slotService.getSlotSummary(loadId, req.user!.sub);
      res.json({ data: summary });
    } catch (err) {
      next(err);
    }
  },
);


// ─────────────────────────────────────────────────────────────────────────────
// GET /loads/:loadId/my-slot — Check user's active reservation/booking on load
//
// Response 200: { data: slot } or { data: null }
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/:loadId/my-slot',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const loadId = req.params.loadId as string;
      const slot = await slotService.getMyReservation(loadId, req.user!.sub);
      res.json({
        data: slot
          ? {
            slotId: slot.id,
            loadId: slot.load_id,
            slotNumber: slot.slot_number,
            status: slot.status,
            reservationExpiresAt: slot.reservation_expires_at ?? undefined,
          }
          : null,
      });
    } catch (err) {
      next(err);
    }
  },
);


export { router as slotBookingRoutes };
