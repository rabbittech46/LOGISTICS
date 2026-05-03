// ─────────────────────────────────────────────────────────────────────────────
// Driver Profile Service — CRUD for CDL-endorsed driver management
// ─────────────────────────────────────────────────────────────────────────────
import { query } from '../../shared/db.js';
import { logger } from '../../shared/logger.js';
import { AppError } from '../../shared/app-error.js';

// ── Types ───────────────────────────────────────────────────────────────────

type CdlClass = 'A' | 'B' | 'C';

export interface CreateDriverProfileRequest {
  userId: string;
  cdlNumber: string;
  cdlClass: CdlClass;
  cdlState: string;
  cdlExpiry: string;
  hazmatEndorsed?: boolean;
  tankerEndorsed?: boolean;
  doublesTriples?: boolean;
  passengerEndorsed?: boolean;
}

export interface UpdateDriverProfileRequest {
  cdlClass?: CdlClass;
  cdlState?: string;
  cdlExpiry?: string;
  hazmatEndorsed?: boolean;
  tankerEndorsed?: boolean;
  doublesTriples?: boolean;
  passengerEndorsed?: boolean;
  isAvailable?: boolean;
}

interface DriverProfileRow {
  id: string;
  user_id: string;
  organization_id: string;
  cdl_number: string;
  cdl_class: string;
  cdl_state: string;
  cdl_expiry: string;
  hazmat_endorsed: boolean;
  tanker_endorsed: boolean;
  doubles_triples: boolean;
  passenger_endorsed: boolean;
  is_available: boolean;
  current_location: { type: 'Point'; coordinates: [number, number] } | null;
  location_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

const DRIVER_COLUMNS = `
  id, user_id, organization_id, cdl_number, cdl_class, cdl_state, cdl_expiry,
  hazmat_endorsed, tanker_endorsed, doubles_triples, passenger_endorsed,
  is_available, ST_AsGeoJSON(current_location)::json AS current_location,
  location_updated_at, created_at, updated_at`;

// ─────────────────────────────────────────────────────────────────────────────
// createDriverProfile
// ─────────────────────────────────────────────────────────────────────────────
export async function createDriverProfile(
  req: CreateDriverProfileRequest,
  orgId: string,
  callerUserId: string,
): Promise<{ driverProfileId: string }> {
  const result = await query<{ id: string }>(
    `INSERT INTO logistics.driver_profiles (
      user_id, organization_id,
      cdl_number, cdl_class, cdl_state, cdl_expiry,
      hazmat_endorsed, tanker_endorsed, doubles_triples, passenger_endorsed
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id`,
    [
      req.userId, orgId,
      req.cdlNumber, req.cdlClass, req.cdlState, req.cdlExpiry,
      req.hazmatEndorsed ?? false, req.tankerEndorsed ?? false,
      req.doublesTriples ?? false, req.passengerEndorsed ?? false,
    ],
    callerUserId,
  );

  logger.info({ driverProfileId: result[0].id, orgId }, 'Driver profile created');
  return { driverProfileId: result[0].id };
}

// ─────────────────────────────────────────────────────────────────────────────
// getDriverProfile
// ─────────────────────────────────────────────────────────────────────────────
export async function getDriverProfile(
  driverId: string,
  callerUserId: string,
): Promise<DriverProfileRow> {
  const rows = await query<DriverProfileRow>(
    `SELECT ${DRIVER_COLUMNS} FROM logistics.driver_profiles WHERE id = $1`,
    [driverId],
    callerUserId,
  );

  if (rows.length === 0) {
    throw new AppError(404, 'Driver profile not found');
  }
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// getDriverProfileByUserId — useful for "my profile" lookups
// ─────────────────────────────────────────────────────────────────────────────
export async function getDriverProfileByUserId(
  userId: string,
): Promise<DriverProfileRow> {
  const rows = await query<DriverProfileRow>(
    `SELECT ${DRIVER_COLUMNS} FROM logistics.driver_profiles WHERE user_id = $1`,
    [userId],
    userId,
  );

  if (rows.length === 0) {
    throw new AppError(404, 'Driver profile not found');
  }
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// listDrivers — all drivers in the caller's org
// ─────────────────────────────────────────────────────────────────────────────
export async function listDrivers(
  callerUserId: string,
  availableOnly?: boolean,
): Promise<DriverProfileRow[]> {
  const condition = availableOnly ? 'WHERE is_available = TRUE' : '';

  return query<DriverProfileRow>(
    `SELECT ${DRIVER_COLUMNS}
       FROM logistics.driver_profiles ${condition}
       ORDER BY created_at DESC
       LIMIT 200`,
    [],
    callerUserId,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// updateDriverProfile
// ─────────────────────────────────────────────────────────────────────────────
export async function updateDriverProfile(
  driverId: string,
  req: UpdateDriverProfileRequest,
  callerUserId: string,
): Promise<DriverProfileRow> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (req.cdlClass !== undefined) { fields.push(`cdl_class = $${idx++}`); values.push(req.cdlClass); }
  if (req.cdlState !== undefined) { fields.push(`cdl_state = $${idx++}`); values.push(req.cdlState); }
  if (req.cdlExpiry !== undefined) { fields.push(`cdl_expiry = $${idx++}`); values.push(req.cdlExpiry); }
  if (req.hazmatEndorsed !== undefined) { fields.push(`hazmat_endorsed = $${idx++}`); values.push(req.hazmatEndorsed); }
  if (req.tankerEndorsed !== undefined) { fields.push(`tanker_endorsed = $${idx++}`); values.push(req.tankerEndorsed); }
  if (req.doublesTriples !== undefined) { fields.push(`doubles_triples = $${idx++}`); values.push(req.doublesTriples); }
  if (req.passengerEndorsed !== undefined) { fields.push(`passenger_endorsed = $${idx++}`); values.push(req.passengerEndorsed); }
  if (req.isAvailable !== undefined) { fields.push(`is_available = $${idx++}`); values.push(req.isAvailable); }

  if (fields.length === 0) {
    throw new AppError(400, 'No fields to update');
  }

  values.push(driverId);

  const rows = await query<DriverProfileRow>(
    `UPDATE logistics.driver_profiles SET ${fields.join(', ')}
     WHERE id = $${idx}
     RETURNING ${DRIVER_COLUMNS}`,
    values,
    callerUserId,
  );

  if (rows.length === 0) {
    throw new AppError(404, 'Driver profile not found');
  }

  logger.info({ driverId }, 'Driver profile updated');
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// toggleAvailability — quick toggle for driver going on/off duty
// ─────────────────────────────────────────────────────────────────────────────
export async function toggleAvailability(
  driverId: string,
  available: boolean,
  callerUserId: string,
): Promise<{ is_available: boolean }> {
  const rows = await query<{ is_available: boolean }>(
    `UPDATE logistics.driver_profiles SET is_available = $1
     WHERE id = $2
     RETURNING is_available`,
    [available, driverId],
    callerUserId,
  );

  if (rows.length === 0) {
    throw new AppError(404, 'Driver profile not found');
  }

  return rows[0];
}
