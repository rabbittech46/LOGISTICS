import { AppError } from './app-error.js';

const defaultFeatureFlags = {
  payments: true,
  realtimeTracking: true,
} as const;

export type FeatureFlagName = keyof typeof defaultFeatureFlags;

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false;
    default:
      return fallback;
  }
}

function parseFeatureFlagJson(): Partial<Record<FeatureFlagName, boolean>> {
  const raw = process.env.FEATURE_FLAGS_JSON?.trim();
  if (!raw) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid FEATURE_FLAGS_JSON: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid FEATURE_FLAGS_JSON: expected a JSON object');
  }

  const overrides: Partial<Record<FeatureFlagName, boolean>> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (!(name in defaultFeatureFlags) || typeof value !== 'boolean') {
      continue;
    }
    overrides[name as FeatureFlagName] = value;
  }

  return overrides;
}

function buildFeatureFlags(): Record<FeatureFlagName, boolean> {
  const jsonOverrides = parseFeatureFlagJson();

  return {
    payments: parseBooleanFlag(process.env.FF_PAYMENTS_ENABLED, jsonOverrides.payments ?? defaultFeatureFlags.payments),
    realtimeTracking: parseBooleanFlag(
      process.env.FF_REALTIME_TRACKING_ENABLED,
      jsonOverrides.realtimeTracking ?? defaultFeatureFlags.realtimeTracking,
    ),
  };
}

export const featureFlags = buildFeatureFlags();

export function isFeatureEnabled(name: FeatureFlagName): boolean {
  return featureFlags[name];
}

export function assertFeatureEnabled(name: FeatureFlagName, message?: string): void {
  if (!isFeatureEnabled(name)) {
    throw new AppError(503, message ?? `Feature \"${name}\" is disabled`);
  }
}

export function getFeatureFlagSnapshot(): Record<FeatureFlagName, boolean> {
  return { ...featureFlags };
}