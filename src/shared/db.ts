// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL connection pool with per-request RLS session variable injection
//
// CRITICAL: SET LOCAL only works inside a transaction block. Every call that
// needs RLS MUST use BEGIN/SET LOCAL/…/COMMIT. getClient() wraps this.
// ─────────────────────────────────────────────────────────────────────────────
import { Pool, PoolClient, types } from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';
import { dbPoolSize } from './metrics.js';

// Normalize common Postgres scalar types so API responses match frontend contracts.
types.setTypeParser(20, (value) => Number.parseInt(value, 10));
types.setTypeParser(1700, (value) => Number.parseFloat(value));

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: parseInt(process.env.DB_POOL_MAX ?? '30', 10),
  min: parseInt(process.env.DB_POOL_MIN ?? '5', 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS ?? '30000', 10),
  idle_in_transaction_session_timeout: 60_000,
  application_name: config.serviceName,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PG pool error');
});

// Publish pool metrics every 5 seconds
setInterval(() => {
  dbPoolSize.set({ state: 'total' }, pool.totalCount);
  dbPoolSize.set({ state: 'idle' }, pool.idleCount);
  dbPoolSize.set({ state: 'waiting' }, pool.waitingCount);
}, 5_000).unref();

/**
 * Acquire a client with RLS context set INSIDE an active transaction.
 *
 * SET LOCAL only takes effect within a transaction block. The caller
 * is responsible for COMMIT/ROLLBACK and client.release().
 */
export async function getClient(userId?: string): Promise<PoolClient> {
  const client = await pool.connect();
  try {
    if (userId) {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);
    }
    return client;
  } catch (err) {
    client.release();
    throw err;
  }
}

/**
 * Run a single query inside an auto-released client with RLS context.
 * Always wraps in a transaction when userId is provided (SET LOCAL requirement).
 * Applies backpressure when too many clients are waiting for the pool.
 */
export async function query<T extends object>(
  text: string,
  params?: unknown[],
  userId?: string,
): Promise<T[]> {
  // Backpressure: reject immediately if pool is saturated
  if (pool.waitingCount > 20) {
    throw Object.assign(new Error('Database pool overloaded — try again later'), {
      statusCode: 503,
    });
  }

  const client = await pool.connect();
  try {
    if (userId) {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);
    }
    const result = await client.query<T>(text, params);
    if (userId) {
      await client.query('COMMIT');
    }
    return result.rows;
  } catch (err) {
    if (userId) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function shutdownPool(): Promise<void> {
  await pool.end();
  logger.info('PG pool shut down');
}
