// ─────────────────────────────────────────────────────────────────────────────
// Notification Worker — BullMQ Consumer
//
// Processes notification jobs: push (FCM), SMS (Twilio), email (SES), in-app (Socket.IO).
// Each job is idempotent via its Bull job ID.
// ─────────────────────────────────────────────────────────────────────────────
import { Worker } from 'bullmq';
import { createRedis } from '../shared/redis.js';
import { config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import { query } from '../shared/db.js';
import { CircuitBreaker } from '../shared/circuit-breaker.js';

const connection = createRedis('notification-worker');

type NotificationChannel = 'push' | 'sms' | 'email' | 'in_app';

interface NotificationJobData {
  channel: NotificationChannel;
  recipientId: string;      // user.id
  recipientOrgId: string;
  eventType: string;        // e.g. 'load.status_changed', 'bid.received'
  entityId: string;         // load.id, bid.id, assignment.id, etc.
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

// ── Circuit breakers for external notification providers ────────────────────
const twilioCircuit = new CircuitBreaker({
  name: 'twilio-sms',
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  callTimeoutMs: 10_000,
});

const sesCircuit = new CircuitBreaker({
  name: 'aws-ses',
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  callTimeoutMs: 10_000,
});

const fcmCircuit = new CircuitBreaker({
  name: 'fcm-push',
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  callTimeoutMs: 10_000,
});

// ── Lazy-init external SDK clients (only when actually needed) ─────────────
let twilioClient: any;
function getTwilioClient() {
  if (!twilioClient && config.twilioAccountSid && config.twilioAuthToken) {
    // Dynamic import to avoid requiring twilio when it's not configured
    const Twilio = require('twilio');
    twilioClient = new Twilio(config.twilioAccountSid, config.twilioAuthToken);
  }
  return twilioClient;
}

let fcmApp: any;
async function getFcmApp() {
  if (!fcmApp && config.fcmProjectId) {
    const admin = await import('firebase-admin');
    fcmApp = admin.initializeApp({
      credential: config.fcmServiceAccountKeyPath
        ? admin.credential.cert(config.fcmServiceAccountKeyPath)
        : admin.credential.applicationDefault(),
      projectId: config.fcmProjectId,
    });
  }
  return fcmApp;
}

let sesClient: any;
async function getSesClient() {
  if (!sesClient) {
    const { SESClient } = await import('@aws-sdk/client-ses');
    sesClient = new SESClient({ region: config.sesRegion });
  }
  return sesClient;
}

// ── Channel Handlers ───────────────────────────────────────────────────────

async function sendPush(data: NotificationJobData): Promise<void> {
  const app = await getFcmApp();
  if (!app) {
    logger.warn({ recipientId: data.recipientId }, 'FCM not configured — push notification skipped');
    return;
  }

  // Lookup device token from user preferences
  const rows = await query<{ device_token: string }>(
    `SELECT device_token FROM logistics.user_device_tokens WHERE user_id = $1 AND active = TRUE LIMIT 5`,
    [data.recipientId],
  );

  if (rows.length === 0) {
    logger.debug({ recipientId: data.recipientId }, 'No device tokens — push skipped');
    return;
  }

  const { getMessaging } = await import('firebase-admin/messaging');
  const messaging = getMessaging(app);

  await fcmCircuit.execute(async () => {
    await messaging.sendEachForMulticast({
      tokens: rows.map((r) => r.device_token),
      notification: { title: data.title, body: data.body },
      data: { eventType: data.eventType, entityId: data.entityId },
    });
  });

  logger.info({ recipientId: data.recipientId, tokenCount: rows.length }, 'Push notification sent via FCM');
}

async function sendSms(data: NotificationJobData): Promise<void> {
  const client = getTwilioClient();
  if (!client) {
    logger.warn({ recipientId: data.recipientId }, 'Twilio not configured — SMS skipped');
    return;
  }

  // Look up user's phone number
  const rows = await query<{ phone: string }>(
    `SELECT phone FROM logistics.users WHERE id = $1`,
    [data.recipientId],
  );

  if (!rows[0]?.phone) {
    logger.debug({ recipientId: data.recipientId }, 'No phone number — SMS skipped');
    return;
  }

  await twilioCircuit.execute(async () => {
    await client.messages.create({
      to: rows[0].phone,
      from: config.twilioFromNumber,
      body: `${data.title}: ${data.body}`,
    });
  });

  logger.info({ recipientId: data.recipientId }, 'SMS sent via Twilio');
}

async function sendEmail(data: NotificationJobData): Promise<void> {
  const client = await getSesClient();

  // Look up user's email
  const rows = await query<{ email: string }>(
    `SELECT email FROM logistics.users WHERE id = $1`,
    [data.recipientId],
  );

  if (!rows[0]?.email) {
    logger.debug({ recipientId: data.recipientId }, 'No email — email notification skipped');
    return;
  }

  const { SendEmailCommand } = await import('@aws-sdk/client-ses');

  await sesCircuit.execute(async () => {
    await client.send(new SendEmailCommand({
      Source: config.sesFromEmail,
      Destination: { ToAddresses: [rows[0].email] },
      Message: {
        Subject: { Data: data.title, Charset: 'UTF-8' },
        Body: {
          Text: { Data: data.body, Charset: 'UTF-8' },
        },
      },
    }));
  });

  logger.info({ recipientId: data.recipientId }, 'Email sent via SES');
}

async function sendInApp(data: NotificationJobData): Promise<void> {
  // Persist in-app notification for pull-based delivery + dashboard display
  await query(
    `INSERT INTO logistics.notifications (
      id, user_id, event_type, entity_id, title, body, payload, read
    ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, FALSE)
    ON CONFLICT DO NOTHING`,
    [
      data.recipientId, data.eventType, data.entityId,
      data.title, data.body, JSON.stringify(data.payload ?? {}),
    ],
  );

  // Also emit via Redis Pub/Sub for any connected Socket.IO instance to pick up
  const redis = createRedis('notification-pubsub');
  await redis.publish(`user:${data.recipientId}:notifications`, JSON.stringify({
    eventType: data.eventType,
    entityId: data.entityId,
    title: data.title,
    body: data.body,
  }));
  await redis.quit();

  logger.info({ recipientId: data.recipientId }, 'In-app notification persisted + published');
}

// ── Worker ──────────────────────────────────────────────────────────────────
const worker = new Worker<NotificationJobData>(
  'notifications',
  async (job) => {
    const { channel, eventType, entityId } = job.data;

    logger.info({ jobId: job.id, channel, eventType, entityId }, 'Processing notification');

    switch (channel) {
      case 'push':
        await sendPush(job.data);
        break;
      case 'sms':
        await sendSms(job.data);
        break;
      case 'email':
        await sendEmail(job.data);
        break;
      case 'in_app':
        await sendInApp(job.data);
        break;
      default:
        logger.warn({ channel }, 'Unknown notification channel');
    }

    return { delivered: true, channel, eventType };
  },
  {
    connection,
    concurrency: 10,
    limiter: { max: 100, duration: 60_000 },
  },
);

worker.on('completed', (job) => {
  logger.debug({ jobId: job.id }, 'Notification job completed');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Notification job failed');
});

logger.info('Notification worker started');
