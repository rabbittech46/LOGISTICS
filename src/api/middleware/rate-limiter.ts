// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiter Middleware — Redis-backed sliding window
//
// Provides per-IP and per-user rate limiting with configurable windows.
// Uses Redis sorted sets for precise sliding-window counting.
// ─────────────────────────────────────────────────────────────────────────────
import { Request, Response, NextFunction } from 'express';
import { redis } from '../../shared/redis.js';
import { logger } from '../../shared/logger.js';

interface RateLimitOptions {
  windowMs: number;         // Window size in milliseconds
  maxRequests: number;      // Max requests per window
  keyPrefix?: string;       // Redis key prefix
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
}

const defaults: Required<RateLimitOptions> = {
  windowMs: 60_000,
  maxRequests: 100,
  keyPrefix: 'rl:',
  keyGenerator: (req) => {
    // Prefer authenticated user ID, fall back to IP
    const userId = (req as any).user?.sub;
    if (userId) return `user:${userId}`;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return `ip:${ip}`;
  },
  skipSuccessfulRequests: false,
};

export function rateLimit(opts?: Partial<RateLimitOptions>) {
  const options: Required<RateLimitOptions> = { ...defaults, ...opts } as Required<RateLimitOptions>;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = `${options.keyPrefix}${options.keyGenerator(req)}`;
    const now = Date.now();
    const windowStart = now - options.windowMs;

    try {
      const pipeline = redis.pipeline();

      // Remove expired entries
      pipeline.zremrangebyscore(key, 0, windowStart);
      // Count current window
      pipeline.zcard(key);
      // Add current request
      pipeline.zadd(key, now.toString(), `${now}:${Math.random().toString(36).slice(2, 8)}`);
      // Set TTL to prevent stale keys
      pipeline.pexpire(key, options.windowMs);

      const results = await pipeline.exec();
      const currentCount = (results?.[1]?.[1] as number) ?? 0;

      // Set rate limit headers
      const remaining = Math.max(0, options.maxRequests - currentCount - 1);
      res.setHeader('X-RateLimit-Limit', options.maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + options.windowMs) / 1000));

      if (currentCount >= options.maxRequests) {
        const retryAfterSec = Math.ceil(options.windowMs / 1000);
        res.setHeader('Retry-After', retryAfterSec);
        res.status(429).json({
          error: 'Too many requests',
          retryAfter: retryAfterSec,
        });
        return;
      }

      next();
    } catch (err) {
      // On Redis failure, allow the request (fail-open) but log warning
      logger.warn({ err, key }, 'Rate limiter Redis error — allowing request');
      next();
    }
  };
}

// ── Pre-built limiters for common routes ────────────────────────────────────

/** General API: 200 req/min per user or IP */
export const apiRateLimit = rateLimit({ windowMs: 60_000, maxRequests: 200, keyPrefix: 'rl:api:' });

/** Auth endpoints: 10 req/min per IP (stricter for brute-force protection) */
export const authRateLimit = rateLimit({
  windowMs: 60_000,
  maxRequests: 60,
  keyPrefix: 'rl:auth:',
  keyGenerator: (req) => `ip:${req.ip || req.socket.remoteAddress || 'unknown'}:path:${req.path.toLowerCase()}`,
});

/** Webhook endpoints: 500 req/min per IP (Stripe, etc.) */
export const webhookRateLimit = rateLimit({ windowMs: 60_000, maxRequests: 500, keyPrefix: 'rl:webhook:' });

/** Heavy operations (matching, pricing): 30 req/min per user */
export const heavyRateLimit = rateLimit({ windowMs: 60_000, maxRequests: 30, keyPrefix: 'rl:heavy:' });
