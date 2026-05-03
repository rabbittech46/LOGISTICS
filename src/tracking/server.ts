// ─────────────────────────────────────────────────────────────────────────────
// Tracking Service — Socket.IO Server
//
// Handles high-frequency GPS pings from driver apps, stores them in the
// Redis hot-store, and broadcasts position updates to dashboard consumers.
// ─────────────────────────────────────────────────────────────────────────────
import http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import express from 'express';
import { z } from 'zod';

import { config } from '../shared/config.js';
import { featureFlags, isFeatureEnabled } from '../shared/feature-flags.js';
import { verifyAccessToken } from '../shared/jwt.js';
import { logger } from '../shared/logger.js';
import { createRedis } from '../shared/redis.js';
import { storeGpsPing, checkPingRateLimit } from './services/gps-hot-store.js';
import { startBatchFlushWorker, stopBatchFlushWorker } from './services/batch-flush.js';
import { startOfflineDetection, stopOfflineDetection, type OfflineAlert } from './services/offline-detection.js';
import type { GpsPing, JwtPayload } from '../shared/types.js';

const realtimeTrackingEnabled = isFeatureEnabled('realtimeTracking');

// ── Zod Schemas for incoming payloads ───────────────────────────────────────
const gpsPingSchema = z.object({
  truckId: z.string().uuid(),
  driverId: z.string().uuid().optional(),
  assignmentId: z.string().uuid().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speed_kmh: z.number().min(0).optional(),
  heading_deg: z.number().min(0).max(360).optional(),
  altitude_m: z.number().optional(),
  accuracy_m: z.number().min(0).optional(),
  engine_on: z.boolean().optional(),
  fuel_level_pct: z.number().min(0).max(100).optional(),
  odometer_km: z.number().min(0).optional(),
  recorded_at: z.string().datetime(),
});

const gpsPingBatchSchema = z.object({
  pings: z.array(gpsPingSchema).min(1).max(10_000),
});

// ── Express health endpoint ─────────────────────────────────────────────────
const app = express();
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'tracking',
    uptime: process.uptime(),
    featureFlags,
  });
});

const httpServer = http.createServer(app);

// ── Socket.IO with Redis adapter for horizontal scaling ─────────────────────
const io = new SocketIOServer(httpServer, {
  path: '/ws/',
  cors: {
    origin: config.nodeEnv === 'development' ? '*' : undefined,
    methods: ['GET', 'POST'],
  },
  pingInterval: 25_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 1e6, // 1 MB max payload
  transports: ['websocket', 'polling'],
});

// Redis adapter: enables multi-instance room fanout without sticky sessions
const pubClient = createRedis('socketio-pub');
const subClient = createRedis('socketio-sub');
io.adapter(createAdapter(pubClient, subClient));

// ── JWT Authentication Middleware ────────────────────────────────────────────
io.use((socket, next) => {
  if (!realtimeTrackingEnabled) {
    return next(new Error('Real-time tracking is temporarily disabled'));
  }

  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const decoded = verifyAccessToken(token) as JwtPayload;
    socket.data.user = decoded;
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
});

// ── Connection Handler ──────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const user = socket.data.user as JwtPayload;
  logger.info({ userId: user.sub, orgId: user.orgId, role: user.role }, 'WS connected');

  // Auto-join org room for fleet-wide feed
  socket.join(`org:${user.orgId}`);

  // ── GPS Ping (single) ──────────────────────────────────────────────────
  socket.on('gps:ping', async (data: unknown, ack?: (resp: { ok: boolean; error?: string }) => void) => {
    const parsed = gpsPingSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, error: 'Invalid payload' });
      return;
    }

    const ping = parsed.data as GpsPing;

    // Rate-limit: max 1 ping per 3 seconds per truck
    const allowed = await checkPingRateLimit(ping.truckId);
    if (!allowed) {
      ack?.({ ok: false, error: 'Rate limited' });
      return;
    }

    await storeGpsPing(ping);

    // Broadcast to subscribers of this truck and the org fleet feed
    const update = {
      truckId: ping.truckId,
      lat: ping.lat,
      lng: ping.lng,
      speed_kmh: ping.speed_kmh,
      heading_deg: ping.heading_deg,
      recorded_at: ping.recorded_at,
    };
    socket.to(`truck:${ping.truckId}`).emit('truck:position', update);
    socket.to(`org:${user.orgId}`).emit('fleet:position', update);

    if (ping.assignmentId) {
      socket.to(`assignment:${ping.assignmentId}`).emit('assignment:position', update);
      socket.to(`load:${ping.assignmentId}`).emit('load:position', update);
    }

    ack?.({ ok: true });
  });

  // ── GPS Ping Batch (offline replay) ────────────────────────────────────
  socket.on('gps:ping_batch', async (data: unknown, ack?: (resp: { ok: boolean; processed: number }) => void) => {
    const parsed = gpsPingBatchSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ ok: false, processed: 0 });
      return;
    }

    let processed = 0;
    // Deduplicate by (truckId, secondBucket)
    const seen = new Set<string>();
    for (const ping of parsed.data.pings) {
      const bucket = `${ping.truckId}:${Math.floor(new Date(ping.recorded_at).getTime() / 1000)}`;
      if (seen.has(bucket)) continue;
      seen.add(bucket);

      await storeGpsPing(ping as GpsPing);
      processed++;
    }

    ack?.({ ok: true, processed });
    logger.info({ userId: user.sub, submitted: parsed.data.pings.length, processed }, 'Batch pings processed');
  });

  // ── Room subscriptions (dashboard consumers) ───────────────────────────
  socket.on('subscribe:truck', (truckId: string) => {
    if (typeof truckId === 'string' && truckId.length <= 36) {
      socket.join(`truck:${truckId}`);
    }
  });

  socket.on('unsubscribe:truck', (truckId: string) => {
    if (typeof truckId === 'string' && truckId.length <= 36) {
      socket.leave(`truck:${truckId}`);
    }
  });

  socket.on('subscribe:load', (loadId: string) => {
    if (typeof loadId === 'string' && loadId.length <= 36) {
      socket.join(`load:${loadId}`);
    }
  });

  socket.on('unsubscribe:load', (loadId: string) => {
    if (typeof loadId === 'string' && loadId.length <= 36) {
      socket.leave(`load:${loadId}`);
    }
  });

  socket.on('subscribe:assignment', (assignmentId: string) => {
    if (typeof assignmentId === 'string' && assignmentId.length <= 36) {
      socket.join(`assignment:${assignmentId}`);
    }
  });

  socket.on('unsubscribe:assignment', (assignmentId: string) => {
    if (typeof assignmentId === 'string' && assignmentId.length <= 36) {
      socket.leave(`assignment:${assignmentId}`);
    }
  });

  socket.on('disconnect', (reason) => {
    logger.debug({ userId: user.sub, reason }, 'WS disconnected');
  });
});

// ── Offline Alert Handler ───────────────────────────────────────────────────
function handleOfflineAlerts(alerts: OfflineAlert[]): void {
  for (const alert of alerts) {
    // Emit to the org fleet room for dashboard indicators
    io.to(`truck:${alert.truckId}`).emit('truck:signal_status', {
      truckId: alert.truckId,
      status: alert.status,
    });
    // In production: enqueue a Bull job to the notification service
    logger.warn({ truckId: alert.truckId, status: alert.status }, 'Driver signal alert');
  }
}

// ── Startup ─────────────────────────────────────────────────────────────────
httpServer.listen(config.port, () => {
  logger.info({ port: config.port, realtimeTrackingEnabled }, 'Tracking service listening');
  if (realtimeTrackingEnabled) {
    startBatchFlushWorker();
    startOfflineDetection(handleOfflineAlerts);
  } else {
    logger.warn('Realtime tracking feature flag is disabled; WebSocket connections will be rejected');
  }
});

// ── Graceful Shutdown ───────────────────────────────────────────────────────
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down tracking service');

  // 1. Stop accepting new connections
  httpServer.close();

  // 2. Stop background tasks
  if (realtimeTrackingEnabled) {
    stopOfflineDetection();
  }

  // 3. Flush any remaining GPS pings to Postgres before closing Redis
  if (realtimeTrackingEnabled) {
    await stopBatchFlushWorker();
  }

  // 4. Disconnect all Socket.IO clients gracefully (sends disconnect event)
  io.disconnectSockets(true);

  // 5. Close Socket.IO and Redis adapter connections
  io.close();
  await pubClient.quit().catch(() => {});
  await subClient.quit().catch(() => {});

  logger.info('Tracking service shut down cleanly');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
