// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Assignment Service â€” Trip CRUD, milestone tracking, ratings
//
// Creation is handled by load-acceptance.service.ts (accept bid â†’ assignment).
// This service handles read operations, milestone updates, and ratings.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { query, pool } from '../../shared/db.js';
import { config } from '../../shared/config.js';
import { logger } from '../../shared/logger.js';
import { AppError } from '../../shared/app-error.js';
import type { AssignmentStatus, SignalStatus } from '../../shared/types.js';
import { getTruckPositions } from '../../tracking/services/gps-hot-store.js';

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface AssignmentRow {
  id: string;
  load_id: string;
  bid_id: string;
  carrier_org_id: string;
  driver_id: string;
  truck_id: string;
  scheduled_window: string;
  agreed_rate_usd: number;
  assigned_at: string;
  dispatched_at: string | null;
  pickup_arrived_at: string | null;
  picked_up_at: string | null;
  dropoff_arrived_at: string | null;
  delivered_at: string | null;
  status: AssignmentStatus;
  pod_signature_url: string | null;
  pod_photos: string[] | null;
  pod_notes: string | null;
  shipper_rating: number | null;
  carrier_rating: number | null;
  shipper_review: string | null;
  carrier_review: string | null;
  created_at: string;
  updated_at: string;
}

interface GeoPoint {
  type: 'Point';
  coordinates: [number, number];
}

interface PersistedTruckLocationRow {
  truck_id: string;
  current_location: GeoPoint | null;
  location_updated_at: string | null;
}

export interface AssignmentTrackingPosition {
  truckId: string;
  lat: number;
  lng: number;
  speed_kmh: number | null;
  heading_deg: number | null;
  recorded_at: string;
  assignmentId: string | null;
  driverId: string | null;
  signal_status: SignalStatus | 'ONLINE';
  last_seen_age_ms: number;
  source: 'redis' | 'postgres';
}

export interface AssignmentTrackingRow extends AssignmentRow {
  position: AssignmentTrackingPosition | null;
}

type Milestone =
  | 'pickup_arrived'
  | 'picked_up'
  | 'dropoff_arrived';

const MILESTONE_COLUMN: Record<Milestone, string> = {
  pickup_arrived: 'pickup_arrived_at',
  picked_up: 'picked_up_at',
  dropoff_arrived: 'dropoff_arrived_at',
};

// Milestones must be hit in order
const MILESTONE_ORDER: Milestone[] = [
  'pickup_arrived', 'picked_up', 'dropoff_arrived',
];

const ASSIGNMENT_COLUMNS = `
  id, load_id, bid_id, carrier_org_id, driver_id, truck_id,
  scheduled_window::text, agreed_rate_usd,
  assigned_at, dispatched_at, pickup_arrived_at, picked_up_at,
  dropoff_arrived_at, delivered_at,
  status, pod_signature_url, pod_photos, pod_notes,
  shipper_rating, carrier_rating, shipper_review, carrier_review,
  created_at, updated_at`;

function deriveSignalStatus(recordedAt: string): SignalStatus | 'ONLINE' {
  const ageMs = Date.now() - new Date(recordedAt).getTime();

  if (ageMs >= config.criticalThresholdMs) return 'CRITICAL';
  if (ageMs >= config.offlineThresholdMs) return 'OFFLINE';
  if (ageMs >= config.degradedThresholdMs) return 'DEGRADED_SIGNAL';
  return 'ONLINE';
}

function toTrackingPosition(snapshot: {
  truckId: string;
  lat: number;
  lng: number;
  speed_kmh?: number | null;
  heading_deg?: number | null;
  recorded_at: string;
  assignmentId?: string | null;
  driverId?: string | null;
  source: 'redis' | 'postgres';
}): AssignmentTrackingPosition {
  const lastSeenAgeMs = Math.max(0, Date.now() - new Date(snapshot.recorded_at).getTime());

  return {
    truckId: snapshot.truckId,
    lat: snapshot.lat,
    lng: snapshot.lng,
    speed_kmh: snapshot.speed_kmh ?? null,
    heading_deg: snapshot.heading_deg ?? null,
    recorded_at: snapshot.recorded_at,
    assignmentId: snapshot.assignmentId ?? null,
    driverId: snapshot.driverId ?? null,
    signal_status: deriveSignalStatus(snapshot.recorded_at),
    last_seen_age_ms: lastSeenAgeMs,
    source: snapshot.source,
  };
}

async function getPersistedTruckLocations(truckIds: string[], userId: string): Promise<Map<string, AssignmentTrackingPosition>> {
  if (truckIds.length === 0) {
    return new Map();
  }

  const rows = await query<PersistedTruckLocationRow>(
    `SELECT id AS truck_id,
            ST_AsGeoJSON(current_location)::json AS current_location,
            location_updated_at
       FROM logistics.trucks
      WHERE id = ANY($1::uuid[])
        AND current_location IS NOT NULL`,
    [truckIds],
    userId,
  ).catch(() => []);

  return new Map(
    rows
      .filter((row) => row.current_location && row.location_updated_at)
      .map((row) => [
        row.truck_id,
        toTrackingPosition({
          truckId: row.truck_id,
          lat: row.current_location!.coordinates[1],
          lng: row.current_location!.coordinates[0],
          recorded_at: row.location_updated_at!,
          source: 'postgres',
        }),
      ]),
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// getAssignment
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getAssignment(
  assignmentId: string,
  userId: string,
): Promise<AssignmentRow> {
  const rows = await query<AssignmentRow>(
    `SELECT ${ASSIGNMENT_COLUMNS}
       FROM logistics.assignments WHERE id = $1`,
    [assignmentId],
    userId,
  );

  if (rows.length === 0) {
    throw new AppError(404, 'Assignment not found');
  }
  return rows[0];
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// listAssignments â€” filtered list for the caller's org
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function listAssignments(
  userId: string,
  filters?: {
    status?: AssignmentStatus;
    driverId?: string;
    truckId?: string;
  },
): Promise<AssignmentRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters?.status) { conditions.push(`status = $${idx++}`); params.push(filters.status); }
  if (filters?.driverId) { conditions.push(`driver_id = $${idx++}`); params.push(filters.driverId); }
  if (filters?.truckId) { conditions.push(`truck_id = $${idx++}`); params.push(filters.truckId); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return query<AssignmentRow>(
    `SELECT ${ASSIGNMENT_COLUMNS}
       FROM logistics.assignments ${where}
       ORDER BY assigned_at DESC
       LIMIT 100`,
    params,
    userId,
  );
}

export async function listAssignmentTracking(
  userId: string,
  filters?: {
    status?: AssignmentStatus;
    driverId?: string;
    truckId?: string;
  },
): Promise<AssignmentTrackingRow[]> {
  const assignments = await listAssignments(userId, filters);
  if (assignments.length === 0) {
    return [];
  }

  const truckIds = [...new Set(assignments.map((assignment) => assignment.truck_id))];
  const livePositions = await getTruckPositions(truckIds);
  const persistedPositions = await getPersistedTruckLocations(truckIds, userId);

  return assignments.map((assignment) => {
    const livePosition = livePositions.get(assignment.truck_id);
    const position = livePosition
      ? toTrackingPosition(livePosition)
      : persistedPositions.get(assignment.truck_id) ?? null;

    return {
      ...assignment,
      position,
    };
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// recordMilestone â€” record in-transit milestones before POD completion
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function recordMilestone(
  assignmentId: string,
  milestone: Milestone,
  userId: string,
): Promise<AssignmentRow> {
  // Validate the milestone name
  if (!(milestone in MILESTONE_COLUMN)) {
    throw new AppError(400, `Invalid milestone: ${milestone}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);

    // Lock the assignment and check status
    const { rows } = await client.query<AssignmentRow>(
      `SELECT ${ASSIGNMENT_COLUMNS}
         FROM logistics.assignments
        WHERE id = $1
          FOR UPDATE`,
      [assignmentId],
    );

    if (rows.length === 0) {
      throw new AppError(404, 'Assignment not found');
    }

    const asgn = rows[0];

    if (asgn.status !== 'ACTIVE') {
      throw new AppError(409, `Assignment is ${asgn.status} â€” milestones can only be recorded on ACTIVE assignments`);
    }

    // Ensure dispatched_at is set before any milestone
    if (!asgn.dispatched_at) {
      throw new AppError(409, 'Assignment must be dispatched before recording milestones');
    }

    // Enforce milestone ordering: all prior milestones must exist
    const msIdx = MILESTONE_ORDER.indexOf(milestone);
    for (let i = 0; i < msIdx; i++) {
      const priorCol = MILESTONE_COLUMN[MILESTONE_ORDER[i]];
      if ((asgn as any)[priorCol] == null) {
        throw new AppError(409, `Must record "${MILESTONE_ORDER[i]}" before "${milestone}"`);
      }
    }

    // Already recorded?
    const col = MILESTONE_COLUMN[milestone];
    if ((asgn as any)[col] != null) {
      throw new AppError(409, `Milestone "${milestone}" already recorded`);
    }

    // Record the milestone
    const updateResult = await client.query<AssignmentRow>(
      `UPDATE logistics.assignments
          SET ${col} = NOW()
        WHERE id = $1
        RETURNING ${ASSIGNMENT_COLUMNS}`,
      [assignmentId],
    );

    await client.query('COMMIT');

    logger.info({ assignmentId, milestone }, 'Milestone recorded');
    return updateResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// submitRating â€” shipper or carrier rates the other party
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function submitRating(
  assignmentId: string,
  ratingType: 'shipper' | 'carrier',
  rating: number,
  review: string | undefined,
  userId: string,
): Promise<AssignmentRow> {
  if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    throw new AppError(400, 'Rating must be an integer between 1 and 5');
  }

  const ratingCol = ratingType === 'shipper' ? 'shipper_rating' : 'carrier_rating';
  const reviewCol = ratingType === 'shipper' ? 'shipper_review' : 'carrier_review';

  const rows = await query<AssignmentRow>(
    `UPDATE logistics.assignments
        SET ${ratingCol} = $1, ${reviewCol} = $2
      WHERE id = $3
        AND status IN ('COMPLETED', 'ACTIVE')
        AND ${ratingCol} IS NULL
      RETURNING ${ASSIGNMENT_COLUMNS}`,
    [rating, review ?? null, assignmentId],
    userId,
  );

  if (rows.length === 0) {
    throw new AppError(409, 'Assignment not found, already rated, or not in a ratable state');
  }

  logger.info({ assignmentId, ratingType, rating }, 'Rating submitted');
  return rows[0];
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// cancelAssignment â€” only before dispatch (no milestones recorded)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function cancelAssignment(
  assignmentId: string,
  userId: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);

    const { rows } = await client.query<{ id: string; load_id: string; truck_id: string; dispatched_at: string | null }>(
      `SELECT id, load_id, truck_id, dispatched_at
         FROM logistics.assignments
        WHERE id = $1 AND status = 'ACTIVE'
          FOR UPDATE`,
      [assignmentId],
    );

    if (rows.length === 0) {
      throw new AppError(404, 'Active assignment not found');
    }

    const asgn = rows[0];

    if (asgn.dispatched_at) {
      throw new AppError(409, 'Cannot cancel an assignment after dispatch â€” contact support for disputes');
    }

    // Cancel assignment
    await client.query(
      `UPDATE logistics.assignments SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`,
      [assignmentId],
    );

    // Release the truck
    await client.query(
      `UPDATE logistics.trucks SET status = 'AVAILABLE', updated_at = NOW() WHERE id = $1`,
      [asgn.truck_id],
    );

    // Revert load to POSTED so it can receive new bids
    await client.query(
      `UPDATE logistics.loads SET status = 'POSTED', updated_at = NOW() WHERE id = $1`,
      [asgn.load_id],
    );

    await client.query('COMMIT');
    logger.info({ assignmentId }, 'Assignment cancelled');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
