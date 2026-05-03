// ─────────────────────────────────────────────────────────────────────────────
// Offline Detection Service
//
// Periodically scans Redis sorted set `truck:last_seen` for trucks that
// haven't pinged within configurable thresholds, then emits alerts.
// ─────────────────────────────────────────────────────────────────────────────
import { config } from '../../shared/config.js';
import { logger } from '../../shared/logger.js';
import { getOfflineTrucks } from './gps-hot-store.js';
import type { SignalStatus } from '../../shared/types.js';

export interface OfflineAlert {
  truckId: string;
  status: SignalStatus;
  lastSeenAgo: number; // ms since last ping
}

type AlertCallback = (alerts: OfflineAlert[]) => void;

let scanTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic offline scans.
 *
 * @param onAlert - callback invoked with any trucks that crossed a threshold
 */
export function startOfflineDetection(onAlert: AlertCallback): void {
  const scanIntervalMs = 30_000; // check every 30 s

  scanTimer = setInterval(async () => {
    try {
      const alerts: OfflineAlert[] = [];

      // CRITICAL: > 10 min silence on active assignment
      const critical = await getOfflineTrucks(config.criticalThresholdMs);
      for (const truckId of critical) {
        alerts.push({
          truckId,
          status: 'CRITICAL',
          lastSeenAgo: config.criticalThresholdMs,
        });
      }

      // OFFLINE: 3–10 min
      const offline = await getOfflineTrucks(config.offlineThresholdMs);
      for (const truckId of offline) {
        if (critical.includes(truckId)) continue; // already covered
        alerts.push({
          truckId,
          status: 'OFFLINE',
          lastSeenAgo: config.offlineThresholdMs,
        });
      }

      // DEGRADED: 1–3 min
      const degraded = await getOfflineTrucks(config.degradedThresholdMs);
      for (const truckId of degraded) {
        if (critical.includes(truckId) || offline.includes(truckId)) continue;
        alerts.push({
          truckId,
          status: 'DEGRADED_SIGNAL',
          lastSeenAgo: config.degradedThresholdMs,
        });
      }

      if (alerts.length > 0) {
        logger.info(
          { critical: critical.length, offline: offline.length, degraded: degraded.length },
          'Offline detection scan complete',
        );
        onAlert(alerts);
      }
    } catch (err) {
      logger.error({ err }, 'Offline detection scan failed');
    }
  }, scanIntervalMs);

  logger.info('Offline detection started');
}

export function stopOfflineDetection(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  logger.info('Offline detection stopped');
}
