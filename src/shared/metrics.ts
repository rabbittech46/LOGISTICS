// ─────────────────────────────────────────────────────────────────────────────
// Prometheus Metrics — Custom application metrics for observability
// ─────────────────────────────────────────────────────────────────────────────
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

// Collect Node.js default metrics (GC, event loop, memory, CPU)
collectDefaultMetrics({ register: registry, prefix: 'logistics_' });

// ── HTTP Request Metrics ────────────────────────────────────────────────────

export const httpRequestDuration = new Histogram({
  name: 'logistics_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpRequestTotal = new Counter({
  name: 'logistics_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});

// ── Business Metrics ────────────────────────────────────────────────────────

export const loadsCreated = new Counter({
  name: 'logistics_loads_created_total',
  help: 'Total loads posted on the platform',
  labelNames: ['cargo_type', 'origin_state'] as const,
  registers: [registry],
});

export const loadsMatched = new Counter({
  name: 'logistics_loads_matched_total',
  help: 'Total loads matched with a carrier',
  registers: [registry],
});

export const bidsPlaced = new Counter({
  name: 'logistics_bids_placed_total',
  help: 'Total bids submitted',
  registers: [registry],
});

export const assignmentsCompleted = new Counter({
  name: 'logistics_assignments_completed_total',
  help: 'Total assignments completed (delivered)',
  registers: [registry],
});

export const matchingDuration = new Histogram({
  name: 'logistics_matching_duration_seconds',
  help: 'Time to compute a load-truck match',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const matchCandidateCount = new Histogram({
  name: 'logistics_match_candidates_count',
  help: 'Number of truck candidates returned per match',
  buckets: [0, 1, 5, 10, 25, 50, 100, 250],
  registers: [registry],
});

// ── GPS / Tracking Metrics ──────────────────────────────────────────────────

export const gpsPingsIngested = new Counter({
  name: 'logistics_gps_pings_ingested_total',
  help: 'Total GPS pings received from driver apps',
  registers: [registry],
});

export const gpsBatchFlushDuration = new Histogram({
  name: 'logistics_gps_batch_flush_duration_seconds',
  help: 'Time to flush a telemetry batch to PostgreSQL',
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export const gpsBatchFlushSize = new Histogram({
  name: 'logistics_gps_batch_flush_size',
  help: 'Number of pings per batch flush',
  buckets: [10, 50, 100, 250, 500, 1000, 5000],
  registers: [registry],
});

export const activeTruckConnections = new Gauge({
  name: 'logistics_active_truck_connections',
  help: 'Number of trucks currently connected via WebSocket',
  registers: [registry],
});

export const activeWebSocketConnections = new Gauge({
  name: 'logistics_active_websocket_connections',
  help: 'Total active WebSocket connections',
  registers: [registry],
});

// ── Payment Metrics ─────────────────────────────────────────────────────────

export const paymentProcessed = new Counter({
  name: 'logistics_payments_processed_total',
  help: 'Total payments processed',
  labelNames: ['status', 'method'] as const,
  registers: [registry],
});

export const paymentAmountCents = new Histogram({
  name: 'logistics_payment_amount_cents',
  help: 'Distribution of payment amounts in cents',
  buckets: [10000, 50000, 100000, 250000, 500000, 1000000, 5000000],
  registers: [registry],
});

// ── Queue Metrics ───────────────────────────────────────────────────────────

export const jobQueueDepth = new Gauge({
  name: 'logistics_job_queue_depth',
  help: 'Number of jobs waiting in a BullMQ queue',
  labelNames: ['queue'] as const,
  registers: [registry],
});

export const jobProcessingDuration = new Histogram({
  name: 'logistics_job_processing_duration_seconds',
  help: 'Time to process a BullMQ job',
  labelNames: ['queue'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry],
});

// ── Circuit Breaker Metrics ─────────────────────────────────────────────────

export const circuitBreakerState = new Gauge({
  name: 'logistics_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half_open, 2=open)',
  labelNames: ['circuit'] as const,
  registers: [registry],
});

// ── Database Metrics ────────────────────────────────────────────────────────

export const dbQueryDuration = new Histogram({
  name: 'logistics_db_query_duration_seconds',
  help: 'PostgreSQL query execution time',
  labelNames: ['operation'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [registry],
});

export const dbPoolSize = new Gauge({
  name: 'logistics_db_pool_size',
  help: 'Current database pool metrics',
  labelNames: ['state'] as const,  // 'total' | 'idle' | 'waiting'
  registers: [registry],
});
