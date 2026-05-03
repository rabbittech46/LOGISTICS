// ─────────────────────────────────────────────────────────────────────────────
// Centralised config — reads environment with safe defaults
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { featureFlags } from './feature-flags.js';

function readOptionalSecret(envVar: string, filePath?: string): string | undefined {
  if (filePath && existsSync(filePath)) {
    const fileValue = readFileSync(filePath, 'utf-8').trim();
    return fileValue || undefined;
  }
  const envValue = process.env[envVar]?.trim();
  return envValue || undefined;
}

function readSecret(envVar: string, filePath?: string): string {
  return readOptionalSecret(envVar, filePath) ?? '';
}

function parseJsonSecretMap(raw: string | undefined, name: string): Record<string, string> {
  if (!raw) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`FATAL: Invalid ${name} JSON: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`FATAL: Invalid ${name} JSON: expected an object map`);
  }

  const normalized: Record<string, string> = {};
  for (const [keyId, keyValue] of Object.entries(parsed)) {
    if (typeof keyValue !== 'string' || !keyValue.trim()) {
      throw new Error(`FATAL: Invalid ${name} entry for key id ${keyId}`);
    }
    normalized[keyId] = keyValue.trim();
  }

  return normalized;
}

function buildKeyMap(legacyKey: string | undefined, keyedSecrets: Record<string, string>): Record<string, string> {
  const merged = { ...keyedSecrets };
  if (legacyKey) {
    merged['legacy-default'] = legacyKey;
  }
  return merged;
}

const legacyJwtPublicKey = readOptionalSecret('JWT_PUBLIC_KEY', process.env.JWT_PUBLIC_KEY_PATH);
const legacyJwtPrivateKey = readOptionalSecret('JWT_PRIVATE_KEY', process.env.JWT_PRIVATE_KEY_PATH);
const jwtVerificationKeys = buildKeyMap(
  legacyJwtPublicKey,
  parseJsonSecretMap(readOptionalSecret('JWT_PUBLIC_KEYS', process.env.JWT_PUBLIC_KEYS_PATH), 'JWT_PUBLIC_KEYS'),
);
const jwtSigningKeys = buildKeyMap(
  legacyJwtPrivateKey,
  parseJsonSecretMap(readOptionalSecret('JWT_PRIVATE_KEYS', process.env.JWT_PRIVATE_KEYS_PATH), 'JWT_PRIVATE_KEYS'),
);
const configuredJwtActiveKid = process.env.JWT_ACTIVE_KID?.trim();
const jwtActiveKid = configuredJwtActiveKid ?? Object.keys(jwtSigningKeys)[0] ?? 'legacy-default';

if (configuredJwtActiveKid && !jwtSigningKeys[configuredJwtActiveKid]) {
  throw new Error(`FATAL: JWT_ACTIVE_KID is set to ${configuredJwtActiveKid}, but no matching private key is configured`);
}

if (jwtSigningKeys[jwtActiveKid] && !jwtVerificationKeys[jwtActiveKid]) {
  throw new Error(`FATAL: Missing public verification key for active JWT key id ${jwtActiveKid}`);
}

const jwtDefaultVerificationKey = legacyJwtPublicKey
  ?? jwtVerificationKeys[jwtActiveKid]
  ?? Object.values(jwtVerificationKeys)[0]
  ?? '';
const jwtDefaultSigningKey = jwtSigningKeys[jwtActiveKid] ?? legacyJwtPrivateKey ?? '';

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),

  // ── Database ────────────────────────────────────────────────────────────
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/logistics',

  // ── Redis ───────────────────────────────────────────────────────────────
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379/0',

  // ── JWT ─────────────────────────────────────────────────────────────────
  jwtPublicKey: jwtDefaultVerificationKey,
  jwtPrivateKey: jwtDefaultSigningKey,
  jwtDefaultVerificationKey,
  jwtVerificationKeys,
  jwtSigningKeys,
  jwtActiveKid,
  jwtAlgorithm: 'RS256' as const,
  jwtExpiresIn: '15m',

  // ── Tracking ────────────────────────────────────────────────────────────
  batchFlushIntervalMs: parseInt(process.env.BATCH_FLUSH_INTERVAL_MS ?? '30000', 10),
  batchFlushSize: parseInt(process.env.BATCH_FLUSH_SIZE ?? '500', 10),
  pingRateLimitMs: 3000, // min 3 s between pings per truck

  // ── Offline Detection ──────────────────────────────────────────────────
  offlineThresholdMs: parseInt(process.env.OFFLINE_THRESHOLD_MS ?? '180000', 10),   // 3 min
  degradedThresholdMs: 60_000,  // 1 min
  criticalThresholdMs: 600_000, // 10 min

  // ── Matching ────────────────────────────────────────────────────────────
  matchRadiusMiles: parseFloat(process.env.MATCH_RADIUS_MILES ?? '150'),
  deadheadMaxRatio: parseFloat(process.env.DEADHEAD_MAX_RATIO ?? '0.50'),

  // ── AWS / S3 ────────────────────────────────────────────────────────────
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  s3PodBucket: process.env.S3_POD_BUCKET ?? 'rabbittech-logistics-pod',

  // ── Kafka ────────────────────────────────────────────────────────────────
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  kafkaSsl: process.env.KAFKA_SSL === 'true',
  kafkaSaslUsername: process.env.KAFKA_SASL_USERNAME ?? '',
  kafkaSaslPassword: readSecret('KAFKA_SASL_PASSWORD', process.env.KAFKA_SASL_PASSWORD_PATH),

  // ── Elasticsearch ──────────────────────────────────────────────────────
  elasticsearchUrl: process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200',
  elasticsearchApiKey: readSecret('ELASTICSEARCH_API_KEY', process.env.ELASTICSEARCH_API_KEY_PATH),

  // ── Stripe ─────────────────────────────────────────────────────────────
  stripeSecretKey: readSecret('STRIPE_SECRET_KEY', process.env.STRIPE_SECRET_KEY_PATH),
  stripeWebhookSecret: readSecret('STRIPE_WEBHOOK_SECRET', process.env.STRIPE_WEBHOOK_SECRET_PATH),

  // ── Twilio (SMS) ───────────────────────────────────────────────────────
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
  twilioAuthToken: readSecret('TWILIO_AUTH_TOKEN', process.env.TWILIO_AUTH_TOKEN_PATH),
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER ?? '',

  // ── FCM (Push Notifications) ──────────────────────────────────────────
  fcmProjectId: process.env.FCM_PROJECT_ID ?? '',
  fcmServiceAccountKeyPath: process.env.FCM_SERVICE_ACCOUNT_KEY_PATH ?? '',

  // ── AWS SES (Email) ───────────────────────────────────────────────────
  sesFromEmail: process.env.SES_FROM_EMAIL ?? 'noreply@rabbittech.io',
  sesRegion: process.env.SES_REGION ?? process.env.AWS_REGION ?? 'us-east-1',

  // ── Service Identity ───────────────────────────────────────────────────
  serviceName: process.env.SERVICE_NAME ?? 'logistics-api',

  // ── Logging ─────────────────────────────────────────────────────────────
  logLevel: process.env.LOG_LEVEL ?? 'info',
} as const;

// ── Startup validation — fail fast on missing critical secrets ──────────────
if (config.nodeEnv === 'production') {
  const svc = config.serviceName;

  // Core secrets required by all services
  const required: Array<[string, unknown]> = [
    ['databaseUrl', config.databaseUrl],
  ];

  // HTTP-serving services need JWT keys
  if (svc === 'api' || svc === 'tracking') {
    required.push(['jwtVerificationKeys', Object.keys(config.jwtVerificationKeys).length]);
  }

  // API needs signing key + Stripe
  if (svc === 'api') {
    required.push(['jwtSigningKeys', Object.keys(config.jwtSigningKeys).length]);

    if (featureFlags.payments) {
      required.push(
        ['stripeSecretKey', config.stripeSecretKey],
        ['stripeWebhookSecret', config.stripeWebhookSecret],
      );
    }
  }

  for (const [name, value] of required) {
    if (!value) {
      throw new Error(`FATAL: Missing required config: ${name}. Cannot start in production.`);
    }
  }
}
