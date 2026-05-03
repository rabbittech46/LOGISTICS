// ─────────────────────────────────────────────────────────────────────────────
// Pino structured logger
// ─────────────────────────────────────────────────────────────────────────────
import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.logLevel,
  ...(config.nodeEnv === 'development'
    ? { transport: { target: 'pino/file', options: { destination: 1 } } }
    : {}),
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: process.env.SERVICE_NAME ?? 'logistics' },
});
