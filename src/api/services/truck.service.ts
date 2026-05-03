// ─────────────────────────────────────────────────────────────────────────────
// Truck Service — CRUD for fleet management
// ─────────────────────────────────────────────────────────────────────────────
import { query } from '../../shared/db.js';
import { logger } from '../../shared/logger.js';
import { AppError } from '../../shared/app-error.js';
import type { CargoType, TruckStatus } from '../../shared/types.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface CreateTruckRequest {
  vin: string;
  plateNumber: string;
  plateState: string;
  make: string;
  model: string;
  year: number;
  cargoType: CargoType;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  payloadCapacityLbs: number;
  grossVehicleWtLbs: number;
  assignedDriverId?: string;
  lastInspectionDate?: string;
  insuranceExpiry: string;
  registrationExpiry?: string;
  notes?: string;
}

export interface UpdateTruckRequest {
  plateNumber?: string;
  plateState?: string;
  assignedDriverId?: string | null;
  status?: TruckStatus;
  lastInspectionDate?: string;
  insuranceExpiry?: string;
  registrationExpiry?: string;
  notes?: string;
}

interface TruckRow {
  id: string;
  organization_id: string;
  assigned_driver_id: string | null;
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
  current_location: { type: 'Point'; coordinates: [number, number] } | null;
  location_updated_at: string | null;
  last_inspection_date: string | null;
  insurance_expiry: string;
  registration_expiry: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// createTruck
// ─────────────────────────────────────────────────────────────────────────────
export async function createTruck(
  req: CreateTruckRequest,
  userId: string,
  orgId: string,
): Promise<{ truckId: string }> {
  const result = await query<{ id: string }>(
    `INSERT INTO logistics.trucks (
      organization_id, vin, plate_number, plate_state,
      make, model, year, cargo_type,
      length_in, width_in, height_in,
      payload_capacity_lbs, gross_vehicle_wt_lbs,
      assigned_driver_id, last_inspection_date,
      insurance_expiry, registration_expiry, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    RETURNING id`,
    [
      orgId, req.vin, req.plateNumber, req.plateState,
      req.make, req.model, req.year, req.cargoType,
      req.lengthIn, req.widthIn, req.heightIn,
      req.payloadCapacityLbs, req.grossVehicleWtLbs,
      req.assignedDriverId ?? null, req.lastInspectionDate ?? null,
      req.insuranceExpiry, req.registrationExpiry ?? null, req.notes ?? null,
    ],
    userId,
  );

  logger.info({ truckId: result[0].id, orgId }, 'Truck created');
  return { truckId: result[0].id };
}

// ─────────────────────────────────────────────────────────────────────────────
// getTruck
// ─────────────────────────────────────────────────────────────────────────────
export async function getTruck(truckId: string, userId: string): Promise<TruckRow> {
  const rows = await query<TruckRow>(
    `SELECT id, organization_id, assigned_driver_id, vin, plate_number, plate_state,
            make, model, year, cargo_type, length_in, width_in, height_in,
            payload_capacity_lbs, gross_vehicle_wt_lbs, status,
            ST_AsGeoJSON(current_location)::json AS current_location,
            location_updated_at,
            last_inspection_date, insurance_expiry, registration_expiry,
            notes, created_at, updated_at
       FROM logistics.trucks WHERE id = $1`,
    [truckId],
    userId,
  );

  if (rows.length === 0) {
    throw new AppError(404, 'Truck not found');
  }
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// listTrucks — all trucks for the user's organization
// ─────────────────────────────────────────────────────────────────────────────
export async function listTrucks(
  userId: string,
  orgId: string,
  status?: TruckStatus,
  cargoType?: CargoType,
): Promise<TruckRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  conditions.push(`organization_id = $${idx++}`);
  params.push(orgId);
  if (status) { conditions.push(`status = $${idx++}`); params.push(status); }
  if (cargoType) { conditions.push(`cargo_type = $${idx++}`); params.push(cargoType); }

  const where = `WHERE ${conditions.join(' AND ')}`;

  return query<TruckRow>(
    `SELECT id, organization_id, assigned_driver_id, vin, plate_number, plate_state,
            make, model, year, cargo_type, length_in, width_in, height_in,
            payload_capacity_lbs, gross_vehicle_wt_lbs, status,
            ST_AsGeoJSON(current_location)::json AS current_location,
            location_updated_at,
            last_inspection_date, insurance_expiry, registration_expiry,
            notes, created_at, updated_at
       FROM logistics.trucks ${where}
       ORDER BY created_at DESC
       LIMIT 200`,
    params,
    userId,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// updateTruck
// ─────────────────────────────────────────────────────────────────────────────
export async function updateTruck(
  truckId: string,
  req: UpdateTruckRequest,
  userId: string,
): Promise<TruckRow> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (req.plateNumber !== undefined) { fields.push(`plate_number = $${idx++}`); values.push(req.plateNumber); }
  if (req.plateState !== undefined) { fields.push(`plate_state = $${idx++}`); values.push(req.plateState); }
  if (req.assignedDriverId !== undefined) { fields.push(`assigned_driver_id = $${idx++}`); values.push(req.assignedDriverId); }
  if (req.status !== undefined) { fields.push(`status = $${idx++}`); values.push(req.status); }
  if (req.lastInspectionDate !== undefined) { fields.push(`last_inspection_date = $${idx++}`); values.push(req.lastInspectionDate); }
  if (req.insuranceExpiry !== undefined) { fields.push(`insurance_expiry = $${idx++}`); values.push(req.insuranceExpiry); }
  if (req.registrationExpiry !== undefined) { fields.push(`registration_expiry = $${idx++}`); values.push(req.registrationExpiry); }
  if (req.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(req.notes); }

  if (fields.length === 0) {
    throw new AppError(400, 'No fields to update');
  }

  values.push(truckId);

  const rows = await query<TruckRow>(
    `UPDATE logistics.trucks SET ${fields.join(', ')}
     WHERE id = $${idx}
     RETURNING id, organization_id, assigned_driver_id, vin, plate_number, plate_state,
               make, model, year, cargo_type, length_in, width_in, height_in,
               payload_capacity_lbs, gross_vehicle_wt_lbs, status,
               ST_AsGeoJSON(current_location)::json AS current_location,
               location_updated_at,
               last_inspection_date, insurance_expiry, registration_expiry,
               notes, created_at, updated_at`,
    values,
    userId,
  );

  if (rows.length === 0) {
    throw new AppError(404, 'Truck not found');
  }

  logger.info({ truckId }, 'Truck updated');
  return rows[0];
}
