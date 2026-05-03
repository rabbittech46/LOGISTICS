// ─────────────────────────────────────────────────────────────────────────────
// Shared TypeScript types matching the backend API contracts
// ─────────────────────────────────────────────────────────────────────────────

// ── Auth ────────────────────────────────────────────────────────────────────
export type UserRole = 'PLATFORM_ADMIN' | 'ORG_ADMIN' | 'DISPATCHER' | 'DRIVER' | 'SHIPPER_STAFF';
export type OrgType = 'SHIPPER' | 'CARRIER';

export interface UserOrg {
  orgId: string;
  orgName: string;
  role: UserRole;
  orgType: OrgType;
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizations: UserOrg[];
}

export interface AuthTokenPayload {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
}

export interface LoginResponse {
  data: AuthTokenPayload & {
    user: User;
  };
}

export interface RefreshResponse {
  data: AuthTokenPayload;
}

// ── Loads ────────────────────────────────────────────────────────────────────
export type CargoType =
  | 'DRY_VAN' | 'REFRIGERATED' | 'FLATBED' | 'TANKER'
  | 'HAZMAT' | 'OVERSIZED' | 'INTERMODAL' | 'CURTAIN_SIDE' | 'LOWBOY';

export type LoadStatus =
  | 'DRAFT' | 'POSTED' | 'BIDDING' | 'CONFIRMED' | 'ASSIGNED'
  | 'IN_TRANSIT' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat]
}

export interface Dimensions {
  length_in: number;
  width_in: number;
  height_in: number;
}

export interface Load {
  id: string;
  reference_number: string;
  shipper_org_id: string;
  posted_by: string;
  cargo_type: CargoType;
  commodity: string;
  weight_lbs: number;
  dimensions: Dimensions | null;
  is_hazmat: boolean;
  hazmat_class?: string;
  hazmat_un_number?: string;
  temperature_min_f?: number;
  temperature_max_f?: number;

  pickup_location: GeoPoint;
  pickup_address: string;
  pickup_city: string;
  pickup_state: string;
  pickup_zip: string;
  pickup_earliest: string;
  pickup_latest: string;
  pickup_instructions?: string;
  pickup_contact_name?: string;
  pickup_contact_phone?: string;

  dropoff_location: GeoPoint;
  dropoff_address: string;
  dropoff_city: string;
  dropoff_state: string;
  dropoff_zip: string;
  dropoff_earliest: string;
  dropoff_latest: string;
  dropoff_instructions?: string;
  dropoff_contact_name?: string;
  dropoff_contact_phone?: string;

  distance_miles?: number;
  offered_rate_usd?: number;
  final_rate_usd?: number;
  rate_per_mile_usd?: number;
  status: LoadStatus;
  load_board_visible: boolean;
  expires_at?: string;
  special_requirements?: string[];
  total_trucks_required: number;
  created_at: string;
  updated_at: string;
}

// ── Slots & Bookings ────────────────────────────────────────────────────────
export type SlotStatus = 'AVAILABLE' | 'RESERVED' | 'BOOKED';

export interface LoadSlot {
  slotId: string;
  loadId: string;
  slotNumber: number;
  status: SlotStatus;
  reservationExpiresAt?: string;
  reserved_by?: string;
  booked_truck_id?: string;
  booked_driver_id?: string;
}

export interface SlotSummary {
  totalSlots: number;
  availableSlots: number;
  reservedSlots: number;
  bookedSlots: number;
}

export interface Booking {
  bookingId: string;
  slotId: string;
  loadId: string;
  status: string;
  confirmedAt: string;
}

// ── Trucks ───────────────────────────────────────────────────────────────────
export type TruckStatus = 'AVAILABLE' | 'BUSY' | 'MAINTENANCE' | 'DECOMMISSIONED';

export interface Truck {
  id: string;
  organization_id: string;
  assigned_driver_id?: string;
  vin: string;
  plate_number: string;
  plate_state: string;
  make: string;
  model: string;
  year: number;
  cargo_type: CargoType;
  length_in: number;
  width_in: number;
  height_in: number;
  payload_capacity_lbs: number;
  gross_vehicle_wt_lbs: number;
  status: TruckStatus;
  current_location?: GeoPoint;
  location_updated_at?: string;
  insurance_expiry: string;
  created_at: string;
  updated_at: string;
}

// ── Drivers ──────────────────────────────────────────────────────────────────
export type CDLClass = 'A' | 'B' | 'C';

export interface Driver {
  id: string;
  user_id: string;
  organization_id: string;
  cdl_number: string;
  cdl_class: CDLClass;
  cdl_state: string;
  cdl_expiry: string;
  hazmat_endorsed: boolean;
  tanker_endorsed: boolean;
  doubles_triples: boolean;
  passenger_endorsed: boolean;
  is_available: boolean;
  current_location?: GeoPoint;
  location_updated_at?: string;
  created_at: string;
  updated_at: string;
}

// ── Assignments ──────────────────────────────────────────────────────────────
export type AssignmentStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';

export interface Assignment {
  id: string;
  load_id: string;
  bid_id: string;
  carrier_org_id: string;
  driver_id: string;
  truck_id: string;
  agreed_rate_usd: number;
  status: AssignmentStatus;
  current_milestone?: string;
  assigned_at: string;
  dispatched_at?: string;
  pickup_arrived_at?: string;
  picked_up_at?: string;
  dropoff_arrived_at?: string;
  delivered_at?: string;
  created_at: string;
  updated_at: string;
}

// ── Bids ─────────────────────────────────────────────────────────────────────
export type BidStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'COUNTERED' | 'WITHDRAWN' | 'EXPIRED';

export interface Bid {
  id: string;
  load_id: string;
  carrier_org_id: string;
  truck_id?: string;
  driver_id?: string;
  bid_amount_usd: number;
  rate_per_mile_usd?: number;
  status: BidStatus;
  counter_offer_usd?: number;
  notes?: string;
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

// ── Organizations ────────────────────────────────────────────────────────────
export interface Organization {
  id: string;
  name: string;
  org_type: OrgType;
  contact_email: string;
  contact_phone?: string;
  mc_number?: string;
  dot_number?: string;
  is_active: boolean;
  verified_at?: string;
  created_at: string;
  updated_at: string;
}

// ── API Wrappers ─────────────────────────────────────────────────────────────
export interface ApiResponse<T> {
  data: T;
  meta?: { total?: number };
}

export interface ApiError {
  error: string;
  code?: string;
  statusCode: number;
}

// ── WebSocket Events ─────────────────────────────────────────────────────────
export interface TruckPosition {
  truckId: string;
  lat: number;
  lng: number;
  speed_kmh?: number;
  heading_deg?: number;
  recorded_at: string;
}

export type TruckSignalState =
  | 'ONLINE'
  | 'DEGRADED_SIGNAL'
  | 'OFFLINE'
  | 'CRITICAL'
  | 'RECONNECTING'
  | 'RECONNECTED';

export interface TruckTrackingPosition extends TruckPosition {
  assignmentId?: string | null;
  driverId?: string | null;
  signal_status?: TruckSignalState;
  last_seen_age_ms?: number;
  source?: 'redis' | 'postgres';
}

export interface AssignmentTracking extends Assignment {
  position: TruckTrackingPosition | null;
}

export interface TruckSignalStatus {
  truckId: string;
  status: TruckSignalState;
}
