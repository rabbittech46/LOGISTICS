// ─────────────────────────────────────────────────────────────────────────────
// Metrics Middleware — Prometheus HTTP request instrumentation
//
// CRITICAL: Uses normalized route patterns, NOT raw paths.
// Raw paths like /loads/abc123/accept create unbounded cardinality
// that will OOM Prometheus at scale.
// ─────────────────────────────────────────────────────────────────────────────
import { Request, Response, NextFunction } from 'express';
import { httpRequestDuration, httpRequestTotal, registry } from '../../shared/metrics.js';

/**
 * Normalize express path to route pattern.
 * /api/v1/loads/abc-123-def/accept → /api/v1/loads/:id/accept
 * Falls back to route pattern from Express router if available.
 */
function normalizeRoute(req: Request): string {
  // Express sets req.route when a route handler matches
  if (req.route?.path) {
    return req.baseUrl + req.route.path;
  }
  // Fallback: collapse UUID/numeric path segments
  return req.path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const route = normalizeRoute(req);
    const method = req.method;
    const status = res.statusCode.toString();

    httpRequestDuration.observe({ method, route, status_code: status }, durationMs / 1000);
    httpRequestTotal.inc({ method, route, status_code: status });
  });

  next();
}

/** GET /metrics endpoint handler for Prometheus scraping */
export async function metricsEndpoint(_req: Request, res: Response): Promise<void> {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}
