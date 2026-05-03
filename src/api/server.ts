// ─────────────────────────────────────────────────────────────────────────────
// API Service — Express Server
//
// Stateless REST API with JWT auth, RLS-aware DB queries, and Bull job dispatch.
// ─────────────────────────────────────────────────────────────────────────────
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import pinoHttp from 'pino-http';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';

import { config } from '../shared/config.js';
import { getFeatureFlagSnapshot } from '../shared/feature-flags.js';
import { logger } from '../shared/logger.js';
import { pool, shutdownPool } from '../shared/db.js';
import { shutdownKafka, getProducer } from '../shared/kafka.js';
import { redis } from '../shared/redis.js';
import { esClient, ensureIndices } from '../shared/elasticsearch.js';

import matchingRoutes from './routes/matching.routes.js';
import loadsRoutes from './routes/loads.routes.js';
import podRoutes from './routes/pod.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { paymentsRoutes } from './routes/payments.routes.js';
import { pricingRoutes } from './routes/pricing.routes.js';
import { organizationRoutes } from './routes/organization.routes.js';
import { userRoutes } from './routes/user.routes.js';
import { loadCrudRoutes } from './routes/load-crud.routes.js';
import { bidRoutes } from './routes/bid.routes.js';
import { truckRoutes } from './routes/truck.routes.js';
import { driverRoutes } from './routes/driver.routes.js';
import { assignmentRoutes } from './routes/assignment.routes.js';
import { searchRoutes } from './routes/search.routes.js';
import { slotBookingRoutes } from './routes/slot-booking.routes.js';
import { apiRateLimit, authRateLimit, webhookRateLimit } from './middleware/rate-limiter.js';
import { metricsMiddleware, metricsEndpoint } from './middleware/metrics.js';

const app = express();

// ── Global Middleware ────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: config.nodeEnv === 'production'
    ? (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean)
    : true,
  credentials: true,
}));
app.use(compression());

// CRITICAL: Stripe webhook MUST receive raw body for signature verification.
// Register express.raw() for the webhook path BEFORE express.json().
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Request correlation ID — propagated to logs, downstream calls, responses
app.use((req, res, next) => {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  req.headers['x-request-id'] = requestId;
  res.setHeader('x-request-id', requestId);
  (req as any).requestId = requestId;
  next();
});

app.use(pinoHttp({
  logger,
  autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/metrics' },
  customProps: (req) => ({ requestId: (req as any).requestId }),
}));

// Metrics instrumentation
app.use(metricsMiddleware);
app.get('/metrics', metricsEndpoint);

// ── Health Check ────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const checks: Record<string, 'ok' | 'fail'> = {};

  // Database
  try {
    await pool.query('SELECT 1');
    checks.database = 'ok';
  } catch { checks.database = 'fail'; }

  // Redis
  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch { checks.redis = 'fail'; }

  // Kafka (producer connectivity)
  try {
    await getProducer();
    checks.kafka = 'ok';
  } catch { checks.kafka = 'fail'; }

  // Elasticsearch
  try {
    await esClient.ping();
    checks.elasticsearch = 'ok';
  } catch { checks.elasticsearch = 'fail'; }

  const allHealthy = Object.values(checks).every((c) => c === 'ok');
  // Readiness: all deps must be healthy. Liveness: basic process check.
  const status = allHealthy ? 'ok' : 'degraded';
  res.status(allHealthy ? 200 : 503).json({
    status,
    service: 'api',
    uptime: process.uptime(),
    checks,
  });
});

app.get('/api/v1/status', (_req, res) => {
  res.json({
    version: '1.0.0',
    environment: config.nodeEnv,
    featureFlags: getFeatureFlagSnapshot(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (_req, res) => {
  res.json({
    service: 'RabbitTech Logistics API',
    version: '1.0.0',
    docs: '/api/v1/status',
  });
});

// ── Rate-limited Routes ─────────────────────────────────────────────────────
app.use('/api/v1/auth', authRateLimit, authRoutes);
app.use('/api/v1/organizations', apiRateLimit, organizationRoutes);
app.use('/api/v1/users', apiRateLimit, userRoutes);
app.use('/api/v1/loads', apiRateLimit, loadCrudRoutes);   // CRUD — mounted before lifecycle routes
app.use('/api/v1/loads', apiRateLimit, slotBookingRoutes); // Multi-truck slot booking
app.use('/api/v1/loads', apiRateLimit, matchingRoutes);
app.use('/api/v1/loads', apiRateLimit, loadsRoutes);
app.use('/api/v1/bids', apiRateLimit, bidRoutes);
app.use('/api/v1/trucks', apiRateLimit, truckRoutes);
app.use('/api/v1/drivers', apiRateLimit, driverRoutes);
app.use('/api/v1/assignments', apiRateLimit, assignmentRoutes);
app.use('/api/v1/search', apiRateLimit, searchRoutes);
app.use('/api/v1/pod', apiRateLimit, podRoutes);
app.use('/api/v1/pricing', apiRateLimit, pricingRoutes);

// Stripe webhook route — already has raw body from early middleware above
app.use('/api/v1/payments/webhook', webhookRateLimit);
app.use('/api/v1/payments', apiRateLimit, paymentsRoutes);

// ── 404 fallback ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Zod validation errors
  if (err.name === 'ZodError') {
    res.status(400).json({ error: 'Validation error', details: err.flatten?.() ?? err.issues });
    return;
  }
  // Application errors with status code
  if (err.statusCode && typeof err.statusCode === 'number') {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  logger.error({ err, requestId: (_req as any).requestId }, 'Unhandled API error');
  res.status(500).json({ error: 'Internal server error' });
});

// ── Startup ─────────────────────────────────────────────────────────────────
const server = app.listen(config.port, async () => {
  logger.info({ port: config.port }, 'API service listening');

  // Initialize Elasticsearch indices on startup (idempotent)
  try {
    await ensureIndices();
    logger.info('Elasticsearch indices initialized');
  } catch (err) {
    logger.warn({ err }, 'Elasticsearch index initialization failed — search may be degraded');
  }
});

// ── Graceful Shutdown ───────────────────────────────────────────────────────
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down API service');

  // Stop K8s sending traffic (preStop hook gives 5s)
  // Stop accepting new connections
  server.close();

  // Drain existing HTTP connections — wait up to 25s (leave 5s for K8s SIGKILL)
  const drainTimeout = parseInt(process.env.SHUTDOWN_DRAIN_MS ?? '25000', 10);
  await new Promise<void>((resolve) => setTimeout(resolve, drainTimeout));

  await Promise.allSettled([
    shutdownPool(),
    shutdownKafka(),
    redis.quit().catch(() => {}),
  ]);

  logger.info('API service shut down cleanly');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
