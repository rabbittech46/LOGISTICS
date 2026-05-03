// ─────────────────────────────────────────────────────────────────────────────
// Slot Booking Metrics — Prometheus counters and histograms
// ─────────────────────────────────────────────────────────────────────────────
import { Counter, Histogram } from 'prom-client';
import { registry } from '../../shared/metrics.js';

export const slotsReserved = new Counter({
  name: 'logistics_slots_reserved_total',
  help: 'Total slot reservations made',
  labelNames: ['load_id'] as const,
  registers: [registry],
});

export const slotsBooked = new Counter({
  name: 'logistics_slots_booked_total',
  help: 'Total slot bookings confirmed',
  labelNames: ['load_id'] as const,
  registers: [registry],
});

export const slotReservationDuration = new Histogram({
  name: 'logistics_slot_reservation_duration_seconds',
  help: 'Time to complete a slot reservation',
  labelNames: ['status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

export const slotContentionRate = new Counter({
  name: 'logistics_slot_contention_total',
  help: 'Failed reservation attempts due to no available slots (contention indicator)',
  labelNames: ['load_id'] as const,
  registers: [registry],
});

export const slotExpirations = new Counter({
  name: 'logistics_slot_expirations_total',
  help: 'Total reservations reclaimed by the expiration worker',
  registers: [registry],
});
