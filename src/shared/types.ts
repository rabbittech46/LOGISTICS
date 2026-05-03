// ─────────────────────────────────────────────────────────────────────────────
// Shared domain types — mirrors Postgres ENUMs and table shapes exactly
// ─────────────────────────────────────────────────────────────────────────────

export type OrgType = 'SHIPPER' | 'CARRIER';

export type UserRole =
  | 'PLATFORM_ADMIN'
  | 'ORG_ADMIN'
  | 'DISPATCHER'
  | 'DRIVER'
  | 'SHIPPER_STAFF';

export type TruckStatus = 'AVAILABLE' | 'BUSY' | 'MAINTENANCE' | 'DECOMMISSIONED';

export type CargoType =
  | 'DRY_VAN'
  | 'REFRIGERATED'
  | 'FLATBED'
  | 'TANKER'
  | 'HAZMAT'
  | 'OVERSIZED'
  | 'INTERMODAL'
  | 'CURTAIN_SIDE'
  | 'LOWBOY';

export type LoadStatus =
  | 'DRAFT'
  | 'POSTED'
  | 'BIDDING'
  | 'CONFIRMED'
  | 'ASSIGNED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'DISPUTED';

export type BidStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'COUNTERED'
  | 'EXPIRED';

export type AssignmentStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';

export type LedgerEntryDirection = 'DEBIT' | 'CREDIT';

// ── GPS Ping (driver → server) ──────────────────────────────────────────────
export interface GpsPing {
  truckId: string;
  driverId?: string;
  assignmentId?: string;
  lat: number;
  lng: number;
  speed_kmh?: number;
  heading_deg?: number;
  altitude_m?: number;
  accuracy_m?: number;
  engine_on?: boolean;
  fuel_level_pct?: number;
  odometer_km?: number;
  recorded_at: string; // ISO-8601 from device clock
}

// Batch upload from offline-buffered pings
export interface GpsPingBatch {
  pings: GpsPing[];
}

// ── JWT Payload ─────────────────────────────────────────────────────────────
export interface JwtPayload {
  sub: string;
  email: string;
  orgId: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

// ── Payment types ───────────────────────────────────────────────────────────
export type PaymentStatus = 'PENDING' | 'ESCROW_HELD' | 'PARTIALLY_RELEASED' | 'RELEASED' | 'FAILED' | 'REFUNDED' | 'DISPUTED';
export type PayoutStatus = 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type PricingStrategy = 'DISTANCE_BASED' | 'FLAT_RATE' | 'AUCTION' | 'CONTRACT';
export type NotificationChannel = 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP';
export type NotificationStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'READ';

// ── Driver Signal Status ────────────────────────────────────────────────────
export type SignalStatus = 'ONLINE' | 'DEGRADED_SIGNAL' | 'OFFLINE' | 'CRITICAL';

// ── Redis Hot-Store Keys ────────────────────────────────────────────────────
export const REDIS_KEYS = {
  /** GEO set: latest truck coordinates */
  TRUCK_POSITIONS: 'truck:positions',

  /** Hash: per-truck metadata */
  truckMeta: (truckId: string) => `truck:meta:${truckId}` as const,

  /** Sorted set: last-seen timestamps for offline detection */
  TRUCK_LAST_SEEN: 'truck:last_seen',

  /** Pub/Sub channel: per-truck updates */
  truckUpdate: (truckId: string) => `truck:update:${truckId}` as const,

  /** Pending telemetry batch list */
  TELEMETRY_BATCH: 'telemetry:batch',

  /** RBAC cache */
  rbacCache: (userId: string, orgId: string) => `rbac:${userId}:${orgId}` as const,

  /** Rate-limit key for GPS pings */
  pingRateLimit: (truckId: string) => `ratelimit:ping:${truckId}` as const,
} as const;
