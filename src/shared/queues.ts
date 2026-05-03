// ─────────────────────────────────────────────────────────────────────────────
// Shared BullMQ Queue Definitions
//
// Extracted to avoid circular dependencies between services and workers.
// Workers import from here; API services import from here.
// ─────────────────────────────────────────────────────────────────────────────
import { Queue } from 'bullmq';
import { createRedis } from './redis.js';

const connection = createRedis('bullmq-queues');

export const matchQueue = new Queue('match-load', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export const notificationQueue = new Queue('notifications', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 5000 },
    removeOnFail: { count: 10000 },
  },
});

export const payoutQueue = new Queue('payout-processing', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  },
});
