// ─────────────────────────────────────────────────────────────────────────────
// Analytics Worker — Kafka consumer → Elasticsearch index + MV refresh
//
// Consumes domain events from all topics, indexes search-relevant data into
// Elasticsearch, and periodically refreshes PostgreSQL materialized views.
// ─────────────────────────────────────────────────────────────────────────────
import { createConsumer, TOPICS, type DomainEvent } from '../shared/kafka.js';
import { indexLoad, removeLoad } from '../shared/elasticsearch.js';
import { pool } from '../shared/db.js';
import { logger } from '../shared/logger.js';
import { redis } from '../shared/redis.js';

const CONSUMER_GROUP = 'analytics-worker';

// ── MV refresh lock (prevent concurrent refreshes across replicas) ──────────

const MV_REFRESH_INTERVAL_MS = 300_000; // 5 minutes
const MV_REFRESH_LOCK_TTL = 60;

async function refreshMaterializedViews(): Promise<void> {
  const lockKey = 'lock:mv_refresh';
  const acquired = await redis.set(lockKey, '1', 'EX', MV_REFRESH_LOCK_TTL, 'NX');
  if (!acquired) return;

  try {
    await pool.query(`SELECT logistics.fn_refresh_analytics_views()`);
    logger.info('Materialized views refreshed');
  } catch (err) {
    logger.error({ err }, 'Failed to refresh materialized views');
  }
}

// ── Event handlers ──────────────────────────────────────────────────────────

async function handleLoadEvent(event: DomainEvent<any>): Promise<void> {
  const { eventType, payload } = event;

  switch (eventType) {
    case 'load.created':
    case 'load.updated':
    case 'load.posted': {
      const rows = await pool.query(
        `SELECT l.id, l.shipper_org_id,
                l.cargo_type, l.commodity, l.weight_lbs, l.status,
                l.offered_rate_usd, l.rate_per_mile_usd, l.distance_miles,
                l.special_requirements, l.is_hazmat,
                ST_Y(l.pickup_location::geometry) AS pickup_lat,
                ST_X(l.pickup_location::geometry) AS pickup_lng,
                l.pickup_city, l.pickup_state, l.pickup_zip,
                ST_Y(l.dropoff_location::geometry) AS dropoff_lat,
                ST_X(l.dropoff_location::geometry) AS dropoff_lng,
                l.dropoff_city, l.dropoff_state, l.dropoff_zip,
                l.pickup_earliest, l.pickup_latest, l.dropoff_earliest, l.dropoff_latest,
                l.load_board_visible, l.created_at, l.updated_at
           FROM logistics.loads l
          WHERE l.id = $1`,
        [payload.loadId ?? event.aggregateId],
      );

      if (rows.rows.length > 0) {
        const r = rows.rows[0];
        await indexLoad({
          id: r.id,
          shipper_org_id: r.shipper_org_id,
          cargo_type: r.cargo_type,
          commodity: r.commodity,
          weight_lbs: parseFloat(r.weight_lbs),
          status: r.status,
          offered_rate_usd: r.offered_rate_usd ? parseFloat(r.offered_rate_usd) : null,
          rate_per_mile_usd: r.rate_per_mile_usd ? parseFloat(r.rate_per_mile_usd) : null,
          distance_miles: r.distance_miles ? parseFloat(r.distance_miles) : null,
          pickup_location: r.pickup_lat ? { lat: parseFloat(r.pickup_lat), lon: parseFloat(r.pickup_lng) } : null,
          pickup_city: r.pickup_city,
          pickup_state: r.pickup_state,
          pickup_zip: r.pickup_zip,
          dropoff_location: r.dropoff_lat ? { lat: parseFloat(r.dropoff_lat), lon: parseFloat(r.dropoff_lng) } : null,
          dropoff_city: r.dropoff_city,
          dropoff_state: r.dropoff_state,
          dropoff_zip: r.dropoff_zip,
          pickup_earliest: r.pickup_earliest,
          pickup_latest: r.pickup_latest,
          dropoff_earliest: r.dropoff_earliest,
          dropoff_latest: r.dropoff_latest,
          load_board_visible: r.load_board_visible,
          special_requirements: r.special_requirements,
          created_at: r.created_at,
          updated_at: r.updated_at,
        });
      }
      break;
    }

    case 'load.cancelled':
    case 'load.delivered': {
      await removeLoad(payload.loadId ?? event.aggregateId);
      break;
    }
  }
}

async function handlePaymentEvent(event: DomainEvent<any>): Promise<void> {
  logger.info({ eventType: event.eventType, aggregateId: event.aggregateId }, 'Payment event processed');
}

async function handleAssignmentEvent(event: DomainEvent<any>): Promise<void> {
  if (event.eventType === 'assignment.completed') {
    if (event.payload?.loadId) {
      await removeLoad(event.payload.loadId);
    }
  }
}

// ── Consumer setup ──────────────────────────────────────────────────────────

async function startAnalyticsWorker(): Promise<void> {
  await createConsumer({
    groupId: CONSUMER_GROUP,
    topics: [TOPICS.LOAD_EVENTS, TOPICS.PAYMENT_EVENTS, TOPICS.ASSIGNMENT_EVENTS, TOPICS.BID_EVENTS],
    handler: async (event: DomainEvent, topic: string) => {
      switch (topic) {
        case TOPICS.LOAD_EVENTS:
          await handleLoadEvent(event);
          break;
        case TOPICS.PAYMENT_EVENTS:
          await handlePaymentEvent(event);
          break;
        case TOPICS.ASSIGNMENT_EVENTS:
          await handleAssignmentEvent(event);
          break;
        default:
          logger.debug({ topic, eventType: event.eventType }, 'Unhandled analytics topic');
      }
    },
    concurrency: 3,
  });

  // Periodic MV refresh
  setInterval(refreshMaterializedViews, MV_REFRESH_INTERVAL_MS).unref();

  logger.info('Analytics worker started');
}

startAnalyticsWorker().catch((err) => {
  logger.fatal({ err }, 'Analytics worker failed to start');
  process.exit(1);
});
