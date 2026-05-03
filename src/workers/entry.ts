// ─────────────────────────────────────────────────────────────────────────────
// Worker Entry Point
//
// Reads WORKER_TYPE env var and starts the appropriate Bull worker.
// ─────────────────────────────────────────────────────────────────────────────
import { logger } from '../shared/logger.js';

const workerType = process.env.WORKER_TYPE;

(async () => {
  switch (workerType) {
    case 'matching':
      logger.info('Starting matching worker');
      await import('./matching.worker.js');
      break;
    case 'notification':
      logger.info('Starting notification worker');
      await import('./notification.worker.js');
      break;
    case 'analytics':
      logger.info('Starting analytics worker');
      await import('./analytics.worker.js');
      break;
    case 'payment':
      logger.info('Starting payment worker');
      await import('./payment.worker.js');
      break;
    case 'reservation-expiry':
      logger.info('Starting reservation expiry worker');
      await import('./reservation-expiry.worker.js');
      break;
    default:
      logger.fatal({ workerType }, 'Unknown WORKER_TYPE');
      process.exit(1);
  }
})();
