// ─────────────────────────────────────────────────────────────────────────────
// Load Service — Full CRUD for freight loads (shipments)
//
// Creates loads, manages lifecycle, provides list/search, cancellation.
// Integrates with Kafka for event publishing and Elasticsearch for indexing.
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto';
import { query, getClient } from '../../shared/db.js';
import { logger } from '../../shared/logger.js';
import { AppError } from '../../shared/app-error.js';
import { publishEvent, TOPICS } from '../../shared/kafka.js';
import { loadsCreated } from '../../shared/metrics.js';
import { config } from '../../shared/config.js';
import { indexLoad, removeLoad as esRemoveLoad } from '../../shared/elasticsearch.js';
import type { LoadStatus, CargoType } from '../../shared/types.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface CreateLoadRequest {
  cargoType: CargoType;
  commodity: string;
  weightLbs: number;
  totalTrucksRequired?: number;
  dimensions?: { lengthIn: number; widthIn: number; heightIn: number };
  pieceCount?: number;
  isHazmat?: boolean;
  hazmatClass?: string;
  hazmatUnNumber?: string;
  temperatureMinF?: number;
  temperatureMaxF?: number;
  pickupAddress: string;
  pickupCity: string;
  pickupState: string;
  pickupZip: string;
  pickupLat: number;
  pickupLng: number;
  pickupEarliest: string;
  pickupLatest: string;
  pickupInstructions?: string;
  pickupContactName?: string;
  pickupContactPhone?: string;
  dropoffAddress: string;
  dropoffCity: string;
  dropoffState: string;
  dropoffZip: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffEarliest: string;
  dropoffLatest: string;
  dropoffInstructions?: string;
  dropoffContactName?: string;
  dropoffContactPhone?: string;
  offeredRateUsd?: number;
  specialRequirements?: string[];
}

export interface UpdateLoadRequest {
  commodity?: string;
  weightLbs?: number;
  offeredRateUsd?: number;
  pickupInstructions?: string;
  dropoffInstructions?: string;
  pickupContactName?: string;
  pickupContactPhone?: string;
  dropoffContactName?: string;
  dropoffContactPhone?: string;
  specialRequirements?: string[];
  loadBoardVisible?: boolean;
  expiresAt?: string;
}

export interface LoadListQuery {
  status?: LoadStatus;
  cargoType?: CargoType;
  pickupState?: string;
  dropoffState?: string;
  limit?: number;
  offset?: number;
}

interface LoadRow {
  id: string;
  shipper_org_id: string;
  posted_by: string;
  reference_number: string;
  cargo_type: CargoType;
  commodity: string;
  weight_lbs: number;
  dimensions: { lengthIn: number; widthIn: number; heightIn: number } | null;
  piece_count: number | null;
  is_hazmat: boolean;
  hazmat_class: string | null;
  hazmat_un_number: string | null;
  temperature_min_f: number | null;
  temperature_max_f: number | null;
  pickup_address: string;
  pickup_city: string;
  pickup_state: string;
  pickup_zip: string;
  pickup_earliest: string;
  pickup_latest: string;
  pickup_instructions: string | null;
  pickup_contact_name: string | null;
  pickup_contact_phone: string | null;
  dropoff_address: string;
  dropoff_city: string;
  dropoff_state: string;
  dropoff_zip: string;
  dropoff_earliest: string;
  dropoff_latest: string;
  dropoff_instructions: string | null;
  dropoff_contact_name: string | null;
  dropoff_contact_phone: string | null;
  distance_miles: number | null;
  offered_rate_usd: number | null;
  final_rate_usd: number | null;
  rate_per_mile_usd: number | null;
  status: LoadStatus;
  load_board_visible: boolean;
  expires_at: string | null;
  special_requirements: string[] | null;
  total_trucks_required: number;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// createLoad
// ─────────────────────────────────────────────────────────────────────────────
export async function createLoad(
  req: CreateLoadRequest,
  userId: string,
  orgId: string,
): Promise<{ loadId: string; referenceNumber: string }> {
  const client = await getClient(userId);
  try {
    // Calculate approximate distance using PostGIS (straight-line)
    const distResult = await client.query<{ distance: number }>(
      `SELECT ST_Distance(
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
      ) / 1609.344 AS distance`,
      [req.pickupLng, req.pickupLat, req.dropoffLng, req.dropoffLat],
    );
    const distanceMiles = Math.round((distResult.rows[0]?.distance ?? 0) * 100) / 100;

    // Calculate rate per mile if offered rate is provided
    const ratePerMile = req.offeredRateUsd && distanceMiles > 0
      ? Math.round((req.offeredRateUsd / distanceMiles) * 10000) / 10000
      : null;

    const result = await client.query<{ id: string; reference_number: string }>(
      `INSERT INTO logistics.loads (
        shipper_org_id, posted_by, cargo_type, commodity, weight_lbs,
        dimensions, piece_count, is_hazmat, hazmat_class, hazmat_un_number,
        temperature_min_f, temperature_max_f,
        pickup_location, pickup_address, pickup_city, pickup_state, pickup_zip,
        pickup_earliest, pickup_latest, pickup_instructions,
        pickup_contact_name, pickup_contact_phone,
        dropoff_location, dropoff_address, dropoff_city, dropoff_state, dropoff_zip,
        dropoff_earliest, dropoff_latest, dropoff_instructions,
        dropoff_contact_name, dropoff_contact_phone,
        distance_miles, offered_rate_usd, rate_per_mile_usd,
        special_requirements, total_trucks_required, status
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12,
        ST_SetSRID(ST_MakePoint($13, $14), 4326)::geography,
        $15, $16, $17, $18,
        $19, $20, $21, $22, $23,
        ST_SetSRID(ST_MakePoint($24, $25), 4326)::geography,
        $26, $27, $28, $29,
        $30, $31, $32, $33,
        $34, $35, $36,
        $37, $38, $39, 'DRAFT'
      ) RETURNING id, reference_number`,
      [
        orgId, userId, req.cargoType, req.commodity, req.weightLbs,
        req.dimensions ? JSON.stringify(req.dimensions) : null,
        req.pieceCount ?? null, req.isHazmat ?? false,
        req.hazmatClass ?? null, req.hazmatUnNumber ?? null,
        req.temperatureMinF ?? null, req.temperatureMaxF ?? null,
        req.pickupLng, req.pickupLat,
        req.pickupAddress, req.pickupCity, req.pickupState, req.pickupZip,
        req.pickupEarliest, req.pickupLatest,
        req.pickupInstructions ?? null, req.pickupContactName ?? null, req.pickupContactPhone ?? null,
        req.dropoffLng, req.dropoffLat,
        req.dropoffAddress, req.dropoffCity, req.dropoffState, req.dropoffZip,
        req.dropoffEarliest, req.dropoffLatest,
        req.dropoffInstructions ?? null, req.dropoffContactName ?? null, req.dropoffContactPhone ?? null,
        distanceMiles, req.offeredRateUsd ?? null, ratePerMile,
        req.specialRequirements ?? null,
        req.totalTrucksRequired ?? 1,
      ],
    );

    await client.query('COMMIT');

    const loadId = result.rows[0].id;
    const referenceNumber = result.rows[0].reference_number;

    loadsCreated.inc();

    await publishEvent(TOPICS.LOAD_EVENTS, {
      eventId: randomUUID(),
      eventType: 'load.created',
      aggregateId: loadId,
      aggregateType: 'load',
      timestamp: new Date().toISOString(),
      version: 1,
      producedBy: config.serviceName,
      payload: { cargoType: req.cargoType, distanceMiles, orgId },
    }).catch(() => {});

    logger.info({ loadId, referenceNumber, orgId }, 'Load created');
    return { loadId, referenceNumber };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getLoad
// ─────────────────────────────────────────────────────────────────────────────
export async function getLoad(loadId: string, userId: string): Promise<LoadRow> {
  const rows = await query<LoadRow>(
    `SELECT id, shipper_org_id, posted_by, reference_number,
            cargo_type, commodity, weight_lbs, dimensions, piece_count,
            is_hazmat, hazmat_class, hazmat_un_number,
            temperature_min_f, temperature_max_f,
            pickup_address, pickup_city, pickup_state, pickup_zip,
            pickup_earliest, pickup_latest,
            pickup_instructions, pickup_contact_name, pickup_contact_phone,
            dropoff_address, dropoff_city, dropoff_state, dropoff_zip,
            dropoff_earliest, dropoff_latest,
            dropoff_instructions, dropoff_contact_name, dropoff_contact_phone,
            distance_miles, offered_rate_usd, final_rate_usd, rate_per_mile_usd,
            status, load_board_visible, expires_at, special_requirements,
            total_trucks_required, created_at, updated_at
       FROM logistics.loads WHERE id = $1`,
    [loadId],
    userId,
  );

  if (rows.length === 0) {
    throw new AppError(404, 'Load not found');
  }
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// listLoads — shipper's own loads or load board (POSTED + visible)
// ─────────────────────────────────────────────────────────────────────────────
export async function listLoads(
  q: LoadListQuery,
  userId: string,
): Promise<{ loads: LoadRow[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (q.status) {
    conditions.push(`status = $${idx++}`);
    params.push(q.status);
  }
  if (q.cargoType) {
    conditions.push(`cargo_type = $${idx++}`);
    params.push(q.cargoType);
  }
  if (q.pickupState) {
    conditions.push(`pickup_state = $${idx++}`);
    params.push(q.pickupState);
  }
  if (q.dropoffState) {
    conditions.push(`dropoff_state = $${idx++}`);
    params.push(q.dropoffState);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(q.limit ?? 50, 100);
  const offset = q.offset ?? 0;

  const [loadRows, countRows] = await Promise.all([
    query<LoadRow>(
      `SELECT id, shipper_org_id, posted_by, reference_number,
              cargo_type, commodity, weight_lbs, dimensions, piece_count,
              is_hazmat, hazmat_class, hazmat_un_number,
              temperature_min_f, temperature_max_f,
              pickup_address, pickup_city, pickup_state, pickup_zip,
              pickup_earliest, pickup_latest,
              pickup_instructions, pickup_contact_name, pickup_contact_phone,
              dropoff_address, dropoff_city, dropoff_state, dropoff_zip,
              dropoff_earliest, dropoff_latest,
              dropoff_instructions, dropoff_contact_name, dropoff_contact_phone,
              distance_miles, offered_rate_usd, final_rate_usd, rate_per_mile_usd,
              status, load_board_visible, expires_at, special_requirements,
              total_trucks_required, created_at, updated_at
         FROM logistics.loads ${where}
         ORDER BY created_at DESC
         LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset],
      userId,
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM logistics.loads ${where}`,
      params,
      userId,
    ),
  ]);

  return { loads: loadRows, total: parseInt(countRows[0]?.count ?? '0', 10) };
}

// ─────────────────────────────────────────────────────────────────────────────
// listLoadBoard — public load board (no RLS, only POSTED + visible)
// ─────────────────────────────────────────────────────────────────────────────
export async function listLoadBoard(
  q: LoadListQuery,
): Promise<{ loads: LoadRow[]; total: number }> {
  const conditions: string[] = [
    `status = 'POSTED'`,
    `load_board_visible = TRUE`,
    `(expires_at IS NULL OR expires_at > NOW())`,
  ];
  const params: unknown[] = [];
  let idx = 1;

  if (q.cargoType) {
    conditions.push(`cargo_type = $${idx++}`);
    params.push(q.cargoType);
  }
  if (q.pickupState) {
    conditions.push(`pickup_state = $${idx++}`);
    params.push(q.pickupState);
  }
  if (q.dropoffState) {
    conditions.push(`dropoff_state = $${idx++}`);
    params.push(q.dropoffState);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const limit = Math.min(q.limit ?? 50, 100);
  const offset = q.offset ?? 0;

  const [loadRows, countRows] = await Promise.all([
    query<LoadRow>(
      `SELECT id, shipper_org_id, reference_number,
              cargo_type, commodity, weight_lbs,
              is_hazmat,
              pickup_city, pickup_state,
              dropoff_city, dropoff_state,
              pickup_earliest, pickup_latest,
              dropoff_earliest, dropoff_latest,
              distance_miles, offered_rate_usd, rate_per_mile_usd,
              status, special_requirements, total_trucks_required,
              created_at
         FROM logistics.loads ${where}
         ORDER BY created_at DESC
         LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset],
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM logistics.loads ${where}`,
      params,
    ),
  ]);

  return { loads: loadRows, total: parseInt(countRows[0]?.count ?? '0', 10) };
}

// ─────────────────────────────────────────────────────────────────────────────
// updateLoad — only DRAFT loads can be fully updated
// ─────────────────────────────────────────────────────────────────────────────
export async function updateLoad(
  loadId: string,
  req: UpdateLoadRequest,
  userId: string,
): Promise<LoadRow> {
  // Check current status
  const current = await getLoad(loadId, userId);
  if (current.status !== 'DRAFT' && current.status !== 'POSTED') {
    throw new AppError(409, `Cannot update load in ${current.status} status`);
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (req.commodity !== undefined) { fields.push(`commodity = $${idx++}`); values.push(req.commodity); }
  if (req.weightLbs !== undefined) { fields.push(`weight_lbs = $${idx++}`); values.push(req.weightLbs); }
  if (req.offeredRateUsd !== undefined) { fields.push(`offered_rate_usd = $${idx++}`); values.push(req.offeredRateUsd); }
  if (req.pickupInstructions !== undefined) { fields.push(`pickup_instructions = $${idx++}`); values.push(req.pickupInstructions); }
  if (req.dropoffInstructions !== undefined) { fields.push(`dropoff_instructions = $${idx++}`); values.push(req.dropoffInstructions); }
  if (req.pickupContactName !== undefined) { fields.push(`pickup_contact_name = $${idx++}`); values.push(req.pickupContactName); }
  if (req.pickupContactPhone !== undefined) { fields.push(`pickup_contact_phone = $${idx++}`); values.push(req.pickupContactPhone); }
  if (req.dropoffContactName !== undefined) { fields.push(`dropoff_contact_name = $${idx++}`); values.push(req.dropoffContactName); }
  if (req.dropoffContactPhone !== undefined) { fields.push(`dropoff_contact_phone = $${idx++}`); values.push(req.dropoffContactPhone); }
  if (req.specialRequirements !== undefined) { fields.push(`special_requirements = $${idx++}`); values.push(req.specialRequirements); }
  if (req.loadBoardVisible !== undefined) { fields.push(`load_board_visible = $${idx++}`); values.push(req.loadBoardVisible); }
  if (req.expiresAt !== undefined) { fields.push(`expires_at = $${idx++}`); values.push(req.expiresAt); }

  if (fields.length === 0) {
    throw new AppError(400, 'No fields to update');
  }

  values.push(loadId);

  const rows = await query<LoadRow>(
    `UPDATE logistics.loads SET ${fields.join(', ')}
     WHERE id = $${idx}
     RETURNING id, shipper_org_id, posted_by, reference_number,
               cargo_type, commodity, weight_lbs, dimensions, piece_count,
               is_hazmat, pickup_address, pickup_city, pickup_state, pickup_zip,
               pickup_earliest, pickup_latest,
               dropoff_address, dropoff_city, dropoff_state, dropoff_zip,
               dropoff_earliest, dropoff_latest,
               distance_miles, offered_rate_usd, final_rate_usd, rate_per_mile_usd,
               status, load_board_visible, expires_at, special_requirements,
               created_at, updated_at`,
    values,
    userId,
  );

  if (rows.length === 0) {
    throw new AppError(404, 'Load not found');
  }

  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// postLoad — DRAFT → POSTED (publish to load board)
// ─────────────────────────────────────────────────────────────────────────────
export async function postLoad(loadId: string, userId: string): Promise<LoadRow> {
  const rows = await query<LoadRow>(
    `UPDATE logistics.loads
     SET status = 'POSTED', load_board_visible = TRUE
     WHERE id = $1 AND status = 'DRAFT'
     RETURNING *`,
    [loadId],
    userId,
  );

  if (rows.length === 0) {
    throw new AppError(409, 'Load must be in DRAFT status to post');
  }

  await publishEvent(TOPICS.LOAD_EVENTS, {
    eventId: randomUUID(),
    eventType: 'load.posted',
    aggregateId: loadId,
    aggregateType: 'load',
    timestamp: new Date().toISOString(),
    version: 1,
    producedBy: config.serviceName,
    payload: { cargoType: rows[0].cargo_type },
  }).catch(() => {});

  // Index in Elasticsearch for full-text/geo search
  await indexLoad({
    id: rows[0].id,
    shipper_org_id: rows[0].shipper_org_id,
    reference_number: rows[0].reference_number,
    cargo_type: rows[0].cargo_type,
    commodity: rows[0].commodity,
    weight_lbs: rows[0].weight_lbs,
    status: rows[0].status,
    pickup_city: rows[0].pickup_city,
    pickup_state: rows[0].pickup_state,
    pickup_zip: rows[0].pickup_zip,
    pickup_earliest: rows[0].pickup_earliest,
    pickup_latest: rows[0].pickup_latest,
    dropoff_city: rows[0].dropoff_city,
    dropoff_state: rows[0].dropoff_state,
    dropoff_zip: rows[0].dropoff_zip,
    dropoff_earliest: rows[0].dropoff_earliest,
    dropoff_latest: rows[0].dropoff_latest,
    distance_miles: rows[0].distance_miles,
    offered_rate_usd: rows[0].offered_rate_usd,
    rate_per_mile_usd: rows[0].rate_per_mile_usd,
    special_requirements: rows[0].special_requirements,
    load_board_visible: rows[0].load_board_visible,
    created_at: rows[0].created_at,
  }).catch((err) => logger.warn({ err, loadId }, 'ES indexing failed — search may be stale'));

  logger.info({ loadId }, 'Load posted to board');
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// cancelLoad — any non-terminal state → CANCELLED
// ─────────────────────────────────────────────────────────────────────────────
export async function cancelLoad(
  loadId: string,
  reason: string,
  userId: string,
): Promise<void> {
  const current = await getLoad(loadId, userId);
  if (current.status === 'DELIVERED' || current.status === 'CANCELLED') {
    throw new AppError(409, `Cannot cancel load in ${current.status} status`);
  }

  await query(
    `UPDATE logistics.loads SET status = 'CANCELLED' WHERE id = $1`,
    [loadId],
    userId,
  );

  await publishEvent(TOPICS.LOAD_EVENTS, {
    eventId: randomUUID(),
    eventType: 'load.cancelled',
    aggregateId: loadId,
    aggregateType: 'load',
    timestamp: new Date().toISOString(),
    version: 1,
    producedBy: config.serviceName,
    payload: { reason, previousStatus: current.status },
  }).catch(() => {});

  // Remove from ES search index
  await esRemoveLoad(loadId).catch(() => {});

  logger.info({ loadId, reason }, 'Load cancelled');
}
