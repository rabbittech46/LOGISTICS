// ─────────────────────────────────────────────────────────────────────────────
// Bid Service — Carrier bid CRUD, counter-offers, withdrawal
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto';
import { query, getClient } from '../../shared/db.js';
import { logger } from '../../shared/logger.js';
import { AppError } from '../../shared/app-error.js';
import { publishEvent, TOPICS } from '../../shared/kafka.js';
import { bidsPlaced } from '../../shared/metrics.js';
import { config } from '../../shared/config.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface CreateBidRequest {
  loadId: string;
  truckId?: string;
  driverId?: string;
  bidAmountUsd: number;
  ratePerMileUsd?: number;
  pickupEta?: string;
  deliveryEta?: string;
  notes?: string;
  expiresAt?: string;
}

export interface CounterOfferRequest {
  counterOfferUsd: number;
}

interface BidRow {
  id: string;
  load_id: string;
  carrier_org_id: string;
  bidding_driver_id: string | null;
  truck_id: string | null;
  bid_amount_usd: number;
  rate_per_mile_usd: number | null;
  pickup_eta: string | null;
  delivery_eta: string | null;
  notes: string | null;
  status: string;
  counter_offer_usd: number | null;
  responded_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// createBid — carrier submits a bid on a load
// ─────────────────────────────────────────────────────────────────────────────
export async function createBid(
  req: CreateBidRequest,
  userId: string,
  carrierOrgId: string,
): Promise<BidRow> {
  // Verify load is in biddable status
  const loads = await query<{ id: string; status: string }>(
    `SELECT id, status FROM logistics.loads WHERE id = $1`,
    [req.loadId],
    userId,
  );

  if (loads.length === 0) {
    throw new AppError(404, 'Load not found');
  }

  const load = loads[0];
  if (load.status !== 'POSTED' && load.status !== 'BIDDING') {
    throw new AppError(409, `Cannot bid on load in ${load.status} status`);
  }

  if (req.truckId) {
    const trucks = await query<{ id: string }>(
      `SELECT id
         FROM logistics.trucks
        WHERE id = $1
          AND organization_id = $2`,
      [req.truckId, carrierOrgId],
      userId,
    );

    if (trucks.length === 0) {
      throw new AppError(400, 'Truck does not belong to your organization');
    }
  }

  const client = await getClient(userId);
  try {
    // Transition load to BIDDING if still POSTED
    if (load.status === 'POSTED') {
      await client.query(
        `UPDATE logistics.loads SET status = 'BIDDING' WHERE id = $1 AND status = 'POSTED'`,
        [req.loadId],
      );
    }

    const result = await client.query<BidRow>(
      `INSERT INTO logistics.bids (
        load_id, carrier_org_id, bidding_driver_id, truck_id,
        bid_amount_usd, rate_per_mile_usd, pickup_eta, delivery_eta,
        notes, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (load_id, carrier_org_id) DO NOTHING
      RETURNING id, load_id, carrier_org_id, bidding_driver_id, truck_id,
                bid_amount_usd, rate_per_mile_usd, pickup_eta, delivery_eta,
                notes, status, counter_offer_usd, responded_at, expires_at,
                created_at, updated_at`,
      [
        req.loadId, carrierOrgId,
        req.driverId ?? null, req.truckId ?? null,
        req.bidAmountUsd, req.ratePerMileUsd ?? null,
        req.pickupEta ?? null, req.deliveryEta ?? null,
        req.notes ?? null, req.expiresAt ?? null,
      ],
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK').catch(() => {});
      throw new AppError(409, 'Your organization already has a bid on this load');
    }

    await client.query('COMMIT');

    bidsPlaced.inc();

    await publishEvent(TOPICS.BID_EVENTS, {
      eventId: randomUUID(),
      eventType: 'bid.created',
      aggregateId: result.rows[0].id,
      aggregateType: 'bid',
      timestamp: new Date().toISOString(),
      version: 1,
      producedBy: config.serviceName,
      payload: { loadId: req.loadId, carrierOrgId, amount: req.bidAmountUsd },
    }).catch(() => {});

    logger.info({ bidId: result.rows[0].id, loadId: req.loadId }, 'Bid created');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getBid
// ─────────────────────────────────────────────────────────────────────────────
export async function getBid(bidId: string, userId: string): Promise<BidRow> {
  const rows = await query<BidRow>(
    `SELECT id, load_id, carrier_org_id, bidding_driver_id, truck_id,
            bid_amount_usd, rate_per_mile_usd, pickup_eta, delivery_eta,
            notes, status, counter_offer_usd, responded_at, expires_at,
            created_at, updated_at
       FROM logistics.bids WHERE id = $1`,
    [bidId],
    userId,
  );

  if (rows.length === 0) {
    throw new AppError(404, 'Bid not found');
  }
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// listBidsForLoad — all bids on a load (shipper sees these)
// ─────────────────────────────────────────────────────────────────────────────
export async function listBidsForLoad(
  loadId: string,
  userId: string,
): Promise<BidRow[]> {
  return query<BidRow>(
    `SELECT b.id, b.load_id, b.carrier_org_id, b.bidding_driver_id, b.truck_id,
            b.bid_amount_usd, b.rate_per_mile_usd, b.pickup_eta, b.delivery_eta,
            b.notes, b.status, b.counter_offer_usd, b.responded_at, b.expires_at,
            b.created_at, b.updated_at
       FROM logistics.bids b
      WHERE b.load_id = $1
      ORDER BY b.bid_amount_usd ASC`,
    [loadId],
    userId,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// listCarrierBids — all bids by the carrier org
// ─────────────────────────────────────────────────────────────────────────────
export async function listCarrierBids(
  userId: string,
  status?: string,
): Promise<BidRow[]> {
  const conditions = status ? `AND b.status = $1` : '';
  const params: unknown[] = status ? [status] : [];

  // RLS ensures only carrier's own bids are returned
  return query<BidRow>(
    `SELECT b.id, b.load_id, b.carrier_org_id, b.bidding_driver_id, b.truck_id,
            b.bid_amount_usd, b.rate_per_mile_usd, b.pickup_eta, b.delivery_eta,
            b.notes, b.status, b.counter_offer_usd, b.responded_at, b.expires_at,
            b.created_at, b.updated_at
       FROM logistics.bids b
      WHERE TRUE ${conditions}
      ORDER BY b.created_at DESC
      LIMIT 100`,
    params,
    userId,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// withdrawBid — carrier withdraws their bid
// ─────────────────────────────────────────────────────────────────────────────
export async function withdrawBid(bidId: string, userId: string): Promise<void> {
  const rows = await query<{ id: string }>(
    `UPDATE logistics.bids
     SET status = 'WITHDRAWN', responded_at = NOW()
     WHERE id = $1 AND status = 'PENDING'
     RETURNING id`,
    [bidId],
    userId,
  );

  if (rows.length === 0) {
    throw new AppError(409, 'Bid cannot be withdrawn (not PENDING or not found)');
  }

  await publishEvent(TOPICS.BID_EVENTS, {
    eventId: randomUUID(),
    eventType: 'bid.withdrawn',
    aggregateId: bidId,
    aggregateType: 'bid',
    timestamp: new Date().toISOString(),
    version: 1,
    producedBy: config.serviceName,
    payload: {},
  }).catch(() => {});

  logger.info({ bidId }, 'Bid withdrawn');
}

// ─────────────────────────────────────────────────────────────────────────────
// counterOffer — shipper counters a bid
// ─────────────────────────────────────────────────────────────────────────────
export async function counterOffer(
  bidId: string,
  req: CounterOfferRequest,
  userId: string,
): Promise<BidRow> {
  const rows = await query<BidRow>(
    `UPDATE logistics.bids
     SET status = 'COUNTERED', counter_offer_usd = $1, responded_at = NOW()
     WHERE id = $2 AND status = 'PENDING'
     RETURNING *`,
    [req.counterOfferUsd, bidId],
    userId,
  );

  if (rows.length === 0) {
    throw new AppError(409, 'Bid cannot be countered (not PENDING or not found)');
  }

  await publishEvent(TOPICS.BID_EVENTS, {
    eventId: randomUUID(),
    eventType: 'bid.countered',
    aggregateId: bidId,
    aggregateType: 'bid',
    timestamp: new Date().toISOString(),
    version: 1,
    producedBy: config.serviceName,
    payload: { counterOfferUsd: req.counterOfferUsd },
  }).catch(() => {});

  logger.info({ bidId, counterOfferUsd: req.counterOfferUsd }, 'Bid countered');
  return rows[0];
}
