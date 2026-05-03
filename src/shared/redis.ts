// ─────────────────────────────────────────────────────────────────────────────
// Redis client factory — re-used by all services
// ─────────────────────────────────────────────────────────────────────────────
import Redis from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

export function createRedis(purpose = 'default'): Redis {
  const redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,       // required by BullMQ
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
  });

  redis.on('connect', () => logger.info({ purpose }, 'Redis connected'));
  redis.on('error', (err) => logger.error({ err, purpose }, 'Redis error'));

  return redis;
}

/** Shared singleton for general use */
export const redis = createRedis('shared');
