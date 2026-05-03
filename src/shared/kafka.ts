// ─────────────────────────────────────────────────────────────────────────────
// Kafka Producer/Consumer Factory
//
// Wraps kafkajs with structured logging, schema registry awareness,
// idempotent producers, and consumer group management.
// ─────────────────────────────────────────────────────────────────────────────
import { Kafka, Producer, Consumer, Partitioners, logLevel as KafkaLogLevel, EachMessagePayload } from 'kafkajs';
import { config } from './config.js';
import { logger } from './logger.js';
import { randomUUID } from 'node:crypto';
import { createRedis } from './redis.js';

/** Dedicated Redis connection for Kafka fallback DLQ (lazy-initialized) */
let kafkaFallbackRedis: ReturnType<typeof createRedis> | null = null;
function getFallbackRedis() {
  if (!kafkaFallbackRedis) kafkaFallbackRedis = createRedis('kafka-fallback');
  return kafkaFallbackRedis;
}

const kafka = new Kafka({
  clientId: config.serviceName,
  brokers: config.kafkaBrokers,
  ssl: config.kafkaSsl ? true : undefined,
  sasl: config.kafkaSaslUsername
    ? {
        mechanism: 'scram-sha-256',
        username: config.kafkaSaslUsername,
        password: config.kafkaSaslPassword,
      }
    : undefined,
  connectionTimeout: 10_000,
  requestTimeout: 30_000,
  retry: { retries: 5, initialRetryTime: 300, maxRetryTime: 30_000 },
  logLevel: KafkaLogLevel.WARN,
  logCreator: () => ({ namespace, level, log }) => {
    const { message, ...extra } = log;
    const lvl = level === KafkaLogLevel.ERROR ? 'error' : level === KafkaLogLevel.WARN ? 'warn' : 'debug';
    logger[lvl]({ kafka: namespace, ...extra }, message);
  },
});

// ── Topics ──────────────────────────────────────────────────────────────────

export const TOPICS = {
  LOAD_EVENTS:        'logistics.load.events',
  BID_EVENTS:         'logistics.bid.events',
  ASSIGNMENT_EVENTS:  'logistics.assignment.events',
  PAYMENT_EVENTS:     'logistics.payment.events',
  TRACKING_EVENTS:    'logistics.tracking.events',
  NOTIFICATION_EVENTS:'logistics.notification.events',
  PRICING_EVENTS:     'logistics.pricing.events',
  ANALYTICS_EVENTS:   'logistics.analytics.events',
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

// ── Event envelope ──────────────────────────────────────────────────────────

export interface DomainEvent<T = unknown> {
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  timestamp: string;
  version: number;
  producedBy: string;
  payload: T;
  metadata?: Record<string, string>;
}

// ── Producer Singleton ──────────────────────────────────────────────────────

let producerInstance: Producer | null = null;

export async function getProducer(): Promise<Producer> {
  if (!producerInstance) {
    producerInstance = kafka.producer({
      createPartitioner: Partitioners.LegacyPartitioner,
      idempotent: true,
      maxInFlightRequests: 5,
      transactionTimeout: 30_000,
      retry: { retries: Number.MAX_SAFE_INTEGER },
    });
    await producerInstance.connect();
    logger.info('Kafka producer connected');
  }
  return producerInstance;
}

export async function publishEvent<T>(
  topic: TopicName,
  event: DomainEvent<T>,
  partitionKey?: string,
): Promise<void> {
  try {
    const producer = await getProducer();
    await producer.send({
      topic,
      messages: [
        {
          key: partitionKey ?? event.aggregateId,
          value: JSON.stringify(event),
          headers: {
            'event-type': event.eventType,
            'aggregate-type': event.aggregateType,
            'produced-by': event.producedBy,
          },
        },
      ],
    });
  } catch (err) {
    // Kafka is down — fallback: persist to Redis list for later replay
    logger.warn({ err, topic, eventId: event.eventId }, 'Kafka publish failed — buffering to Redis');
    try {
      const fallbackRedis = getFallbackRedis();
      await fallbackRedis.rpush(
        'kafka:fallback-buffer',
        JSON.stringify({ topic, event, partitionKey, bufferedAt: new Date().toISOString() }),
      );
    } catch (redisErr) {
      // Both Kafka and Redis are down — log and throw
      logger.fatal({ redisErr, topic, eventId: event.eventId }, 'Both Kafka and Redis fallback failed — event lost');
      throw err;
    }
  }
}

// ── Consumer Factory ────────────────────────────────────────────────────────

const MAX_HANDLER_RETRIES = 3;

export interface ConsumerConfig {
  groupId: string;
  topics: TopicName[];
  handler: (event: DomainEvent, topic: string) => Promise<void>;
  concurrency?: number;
}

/** Track all active consumers for graceful shutdown */
const activeConsumers: Consumer[] = [];

/**
 * Publish a failed message to the Dead Letter Queue.
 * DLQ topic = original topic + '.dlq'
 */
async function publishToDlq(
  originalTopic: string,
  message: EachMessagePayload['message'],
  error: unknown,
): Promise<void> {
  try {
    const producer = await getProducer();
    await producer.send({
      topic: `${originalTopic}.dlq`,
      messages: [
        {
          key: message.key,
          value: message.value,
          headers: {
            ...message.headers,
            'dlq-original-topic': originalTopic,
            'dlq-error': String(error instanceof Error ? error.message : error),
            'dlq-timestamp': new Date().toISOString(),
            'dlq-id': randomUUID(),
          },
        },
      ],
    });
  } catch (dlqErr) {
    logger.fatal({ dlqErr, originalTopic }, 'Failed to publish to DLQ — message lost');
  }
}

export async function createConsumer(cfg: ConsumerConfig): Promise<Consumer> {
  const consumer = kafka.consumer({
    groupId: cfg.groupId,
    sessionTimeout: 30_000,
    heartbeatInterval: 3_000,
    maxWaitTimeInMs: 5_000,
    retry: { retries: 10 },
  });

  await consumer.connect();
  activeConsumers.push(consumer);

  for (const topic of cfg.topics) {
    await consumer.subscribe({ topic, fromBeginning: false });
  }

  await consumer.run({
    partitionsConsumedConcurrently: cfg.concurrency ?? 3,
    eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
      if (!message.value) return;

      let lastErr: unknown;
      for (let attempt = 1; attempt <= MAX_HANDLER_RETRIES; attempt++) {
        try {
          const event = JSON.parse(message.value.toString()) as DomainEvent;
          await cfg.handler(event, topic);
          return; // success
        } catch (err) {
          lastErr = err;
          logger.warn(
            { err, topic, partition, offset: message.offset, attempt },
            'Kafka handler failed — retrying',
          );
        }
      }

      // All retries exhausted — send to DLQ
      logger.error(
        { topic, partition, offset: message.offset },
        `Handler failed after ${MAX_HANDLER_RETRIES} attempts — sending to DLQ`,
      );
      await publishToDlq(topic, message, lastErr);
    },
  });

  logger.info({ groupId: cfg.groupId, topics: cfg.topics }, 'Kafka consumer started');
  return consumer;
}

// ── Shutdown ────────────────────────────────────────────────────────────────

export async function shutdownKafka(): Promise<void> {
  // Disconnect all consumers first (stop processing)
  for (const consumer of activeConsumers) {
    try {
      await consumer.disconnect();
    } catch (err) {
      logger.warn({ err }, 'Error disconnecting Kafka consumer');
    }
  }
  activeConsumers.length = 0;

  if (producerInstance) {
    await producerInstance.disconnect();
    producerInstance = null;
  }
  logger.info('Kafka fully disconnected (producer + consumers)');
}
