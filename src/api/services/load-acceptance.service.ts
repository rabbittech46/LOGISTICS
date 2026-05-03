// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Accept Load Transaction Service
//
// Atomic PostgreSQL transaction that:
//   1. Validates the bid belongs to the caller's org
//   2. Marks the bid ACCEPTED
//   3. Creates an assignment row (triggers fn_on_assignment_inserted which
//      cascades: load â†’ CONFIRMED, truck â†’ BUSY, other bids â†’ REJECTED)
//   4. Records in the audit log
//
// All within a single serializable-level transaction with RLS context.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { pool } from '../../shared/db.js';
import { logger } from '../../shared/logger.js';
import { AppError } from '../../shared/app-error.js';
import type { UserRole } from '../../shared/types.js';

export interface AcceptLoadRequest {
  loadId: string;
  bidId: string;
  driverId?: string;
  truckId?: string;
}

export interface AcceptLoadResult {
  assignmentId: string;
  loadId: string;
  status: 'CONFIRMED';
  agreedRateUsd: number;
  scheduledWindow: { start: string; end: string };
}

interface BidRow {
  id: string;
  load_id: string;
  carrier_org_id: string;
  bid_amount_usd: number;
  status: string;
  truck_id: string | null;
  bidding_driver_id: string | null;
}

interface LoadWindowRow {
  id: string;
  shipper_org_id: string;
  pickup_earliest: string;
  dropoff_latest: string;
}

interface AssignmentRow {
  id: string;
  load_id: string;
  start_ts: string;
  end_ts: string;
}

interface TruckRow {
  id: string;
  organization_id: string;
  assigned_driver_id: string | null;
}

interface DriverRow {
  id: string;
  organization_id: string;
}

interface DispatchAssignmentRow {
  id: string;
  load_id: string;
  carrier_org_id: string;
  status: string;
  dispatched_at: string | null;
}

interface DispatchLoadRow {
  id: string;
  status: string;
}

export async function acceptLoad(
  req: AcceptLoadRequest,
  userId: string,
  orgId: string,
  role: UserRole,
): Promise<AcceptLoadResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);

    const bidResult = await client.query<BidRow>(
      `SELECT id, load_id, carrier_org_id, bid_amount_usd, status, truck_id, bidding_driver_id
         FROM logistics.bids
        WHERE id = $1
          FOR UPDATE`,
      [req.bidId],
    );

    if (bidResult.rows.length === 0) {
      throw new AppError(404, 'Bid not found');
    }

    const bid = bidResult.rows[0];
    if (bid.status !== 'PENDING') {
      throw new AppError(409, `Bid is already ${bid.status}`);
    }

    const loadResult = await client.query<LoadWindowRow>(
      `SELECT id, shipper_org_id, pickup_earliest, dropoff_latest
         FROM logistics.loads
        WHERE id = $1
          AND status IN ('POSTED', 'BIDDING')
          FOR UPDATE`,
      [req.loadId],
    );

    if (loadResult.rows.length === 0) {
      throw new AppError(409, 'Load is no longer available for award');
    }

    const loadWindow = loadResult.rows[0];
    if (bid.load_id !== loadWindow.id) {
      throw new AppError(409, 'Bid does not belong to the requested load');
    }

    if (role !== 'PLATFORM_ADMIN' && loadWindow.shipper_org_id !== orgId) {
      throw new AppError(403, 'Only the shipper org can award this bid');
    }

    const resolvedTruckId = req.truckId ?? bid.truck_id;
    if (!resolvedTruckId) {
      throw new AppError(400, 'truckId is required to award this load');
    }

    const truckResult = await client.query<TruckRow>(
      `SELECT id, organization_id, assigned_driver_id
         FROM logistics.trucks
        WHERE id = $1
          FOR UPDATE`,
      [resolvedTruckId],
    );

    if (truckResult.rows.length === 0) {
      throw new AppError(404, 'Truck not found');
    }

    const truck = truckResult.rows[0];
    if (truck.organization_id !== bid.carrier_org_id) {
      throw new AppError(409, 'Selected truck does not belong to the awarded carrier');
    }

    const resolvedDriverId = req.driverId ?? bid.bidding_driver_id ?? truck.assigned_driver_id;
    if (!resolvedDriverId) {
      throw new AppError(400, 'driverId is required to award this load');
    }

    const driverResult = await client.query<DriverRow>(
      `SELECT id, organization_id
         FROM logistics.driver_profiles
        WHERE id = $1
          FOR UPDATE`,
      [resolvedDriverId],
    );

    if (driverResult.rows.length === 0) {
      throw new AppError(404, 'Driver not found');
    }

    const driver = driverResult.rows[0];
    if (driver.organization_id !== bid.carrier_org_id) {
      throw new AppError(409, 'Selected driver does not belong to the awarded carrier');
    }

    await client.query(
      `UPDATE logistics.bids
          SET status = 'ACCEPTED', responded_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [req.bidId],
    );

    const assignResult = await client.query<AssignmentRow>(
      `INSERT INTO logistics.assignments (
           id, load_id, bid_id, carrier_org_id,
           driver_id, truck_id, agreed_rate_usd,
           status
         )
         VALUES (
           gen_random_uuid(), $1, $2, $3,
           $4, $5, $6,
           'ACTIVE'
         )
         RETURNING id, load_id,
                   LOWER(scheduled_window)::text AS start_ts,
                   UPPER(scheduled_window)::text AS end_ts`,
      [
        bid.load_id,
        req.bidId,
        bid.carrier_org_id,
        resolvedDriverId,
        resolvedTruckId,
        bid.bid_amount_usd,
      ],
    );

    const assignment = assignResult.rows[0];

    await client.query('COMMIT');

    logger.info(
      { assignmentId: assignment.id, loadId: bid.load_id, bidId: req.bidId },
      'Bid awarded and assignment created',
    );

    return {
      assignmentId: assignment.id,
      loadId: bid.load_id,
      status: 'CONFIRMED',
      agreedRateUsd: bid.bid_amount_usd,
      scheduledWindow: {
        start: loadWindow.pickup_earliest,
        end: loadWindow.dropoff_latest,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});

    if ((err as any)?.code === '40001') {
      throw new AppError(409, 'Concurrent modification detected, please retry');
    }

    throw err;
  } finally {
    client.release();
  }
}

export async function dispatchLoad(
  loadId: string,
  assignmentId: string,
  userId: string,
  orgId: string,
  role: UserRole,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);

    const assignmentResult = await client.query<DispatchAssignmentRow>(
      `SELECT id, load_id, carrier_org_id, status, dispatched_at
         FROM logistics.assignments
        WHERE id = $1
          FOR UPDATE`,
      [assignmentId],
    );

    if (assignmentResult.rows.length === 0) {
      throw new AppError(404, 'Assignment not found');
    }

    const assignment = assignmentResult.rows[0];
    if (assignment.load_id !== loadId) {
      throw new AppError(409, 'Assignment does not belong to the requested load');
    }

    if (role !== 'PLATFORM_ADMIN' && assignment.carrier_org_id !== orgId) {
      throw new AppError(403, 'Only the assigned carrier can dispatch this load');
    }

    if (assignment.status !== 'ACTIVE') {
      throw new AppError(409, `Assignment is ${assignment.status}`);
    }

    if (assignment.dispatched_at) {
      throw new AppError(409, 'Assignment has already been dispatched');
    }

    const loadResult = await client.query<DispatchLoadRow>(
      `SELECT id, status
         FROM logistics.loads
        WHERE id = $1
          FOR UPDATE`,
      [loadId],
    );

    if (loadResult.rows.length === 0) {
      throw new AppError(404, 'Load not found');
    }

    if (loadResult.rows[0].status !== 'CONFIRMED') {
      throw new AppError(409, `Load is ${loadResult.rows[0].status}, expected CONFIRMED`);
    }

    await client.query(
      `UPDATE logistics.assignments
          SET dispatched_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [assignmentId],
    );

    await client.query(
      `UPDATE logistics.loads
          SET status = 'IN_TRANSIT', updated_at = NOW()
        WHERE id = $1`,
      [loadId],
    );

    await client.query('COMMIT');
    logger.info({ assignmentId, loadId }, 'Load dispatched');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
