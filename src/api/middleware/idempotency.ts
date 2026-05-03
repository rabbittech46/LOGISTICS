// ─────────────────────────────────────────────────────────────────────────────
// Idempotency Middleware — Prevents duplicate request processing
//
// Uses the Idempotency-Key header (RFC draft) to detect and replay
// previous responses for POST/PUT requests. This is critical for
// the booking system where network timeouts after a successful booking
// would otherwise cause the client to retry and potentially double-book.
//
// Storage: PostgreSQL idempotency_keys table (24h TTL, auto-purged by worker)
// ─────────────────────────────────────────────────────────────────────────────
import { Request, Response, NextFunction } from 'express';
import { pool } from '../../shared/db.js';
import { logger } from '../../shared/logger.js';

interface IdempotencyRow {
  response_code: number;
  response_body: unknown;
}

/**
 * Express middleware that enforces request-level idempotency.
 *
 * Requires the `Idempotency-Key` header on POST requests.
 * If the key has been seen before, returns the cached response.
 * If not, captures the response and stores it for future replays.
 */
export function requireIdempotencyKey(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const key = req.headers['idempotency-key'];

  if (!key || typeof key !== 'string') {
    res.status(400).json({
      error: 'Missing Idempotency-Key header',
      detail: 'POST requests to this endpoint require a unique Idempotency-Key header (UUID v4 recommended)',
    });
    return;
  }

  // Validate format: must be a non-empty string, max 128 chars
  if (key.length > 128 || key.length === 0) {
    res.status(400).json({ error: 'Idempotency-Key must be 1-128 characters' });
    return;
  }

  // Store for later use by the route handler
  (req as any).idempotencyKey = key;
  next();
}

/**
 * Check idempotency cache. Returns cached response if key exists.
 * Returns null if this is a new request.
 */
export async function checkIdempotency(
  key: string,
  userId: string,
): Promise<{ responseCode: number; responseBody: unknown } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<IdempotencyRow>(
      `SELECT response_code, response_body
         FROM logistics.idempotency_keys
        WHERE key = $1
          AND user_id = $2
          AND expires_at > NOW()`,
      [key, userId],
    );
    await client.query('COMMIT');

    if (result.rows.length > 0) {
      return {
        responseCode: result.rows[0].response_code,
        responseBody: result.rows[0].response_body,
      };
    }
    return null;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // Non-critical: if cache lookup fails, proceed as new request
    logger.warn({ err, key }, 'Idempotency cache lookup failed — treating as new request');
    return null;
  } finally {
    client.release();
  }
}

/**
 * Store the response for an idempotency key.
 * Fire-and-forget: failures here don't affect the main response.
 */
export async function storeIdempotencyResult(
  key: string,
  userId: string,
  requestPath: string,
  responseCode: number,
  responseBody: unknown,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO logistics.idempotency_keys (key, user_id, request_path, response_code, response_body)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO NOTHING`,
      [key, userId, requestPath, responseCode, JSON.stringify(responseBody)],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.warn({ err, key }, 'Failed to store idempotency result');
  } finally {
    client.release();
  }
}
