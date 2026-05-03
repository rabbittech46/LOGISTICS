// ─────────────────────────────────────────────────────────────────────────────
// Circuit Breaker — Prevents cascading failures across service boundaries
//
// States: CLOSED → OPEN → HALF_OPEN → CLOSED
// ─────────────────────────────────────────────────────────────────────────────
import { logger } from './logger.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Unique name for logging/metrics */
  name: string;
  /** Number of failures before opening (default: 5) */
  failureThreshold?: number;
  /** Milliseconds to wait before transitioning OPEN → HALF_OPEN (default: 30000) */
  resetTimeoutMs?: number;
  /** Number of successes in HALF_OPEN to fully close (default: 2) */
  halfOpenSuccessThreshold?: number;
  /** Per-call timeout in ms (default: 10000) */
  callTimeoutMs?: number;
  /** Custom function to determine if an error should count as a failure */
  isFailure?: (err: unknown) => boolean;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private nextAttemptTime = 0;

  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenSuccessThreshold: number;
  private readonly callTimeoutMs: number;
  private readonly isFailure: (err: unknown) => boolean;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 2;
    this.callTimeoutMs = options.callTimeoutMs ?? 10_000;
    this.isFailure = options.isFailure ?? (() => true);
  }

  getState(): CircuitState {
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() >= this.nextAttemptTime) {
        this.transitionTo('HALF_OPEN');
      } else {
        throw new CircuitOpenError(this.name, this.nextAttemptTime - Date.now());
      }
    }

    try {
      const result = await this.withTimeout(fn);
      this.onSuccess();
      return result;
    } catch (err) {
      if (this.isFailure(err)) {
        this.onFailure();
      }
      throw err;
    }
  }

  private async withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new CircuitTimeoutError(this.name, this.callTimeoutMs));
      }, this.callTimeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.transitionTo('CLOSED');
      }
    }
    if (this.state === 'CLOSED') {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
    } else if (this.failureCount >= this.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  private transitionTo(newState: CircuitState): void {
    const prev = this.state;
    this.state = newState;

    if (newState === 'OPEN') {
      this.nextAttemptTime = Date.now() + this.resetTimeoutMs;
      this.successCount = 0;
      logger.warn({ circuit: this.name, prev, next: newState, failures: this.failureCount }, 'Circuit opened');
    } else if (newState === 'HALF_OPEN') {
      this.successCount = 0;
      logger.info({ circuit: this.name, prev, next: newState }, 'Circuit half-open — testing');
    } else if (newState === 'CLOSED') {
      this.failureCount = 0;
      this.successCount = 0;
      logger.info({ circuit: this.name, prev, next: newState }, 'Circuit closed — healthy');
    }
  }

  reset(): void {
    this.transitionTo('CLOSED');
  }
}

export class CircuitOpenError extends Error {
  constructor(
    public readonly circuitName: string,
    public readonly retryAfterMs: number,
  ) {
    super(`Circuit breaker "${circuitName}" is OPEN. Retry after ${retryAfterMs}ms`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitTimeoutError extends Error {
  constructor(
    public readonly circuitName: string,
    public readonly timeoutMs: number,
  ) {
    super(`Circuit breaker "${circuitName}" call timed out after ${timeoutMs}ms`);
    this.name = 'CircuitTimeoutError';
  }
}

// ── Retry with exponential backoff ──────────────────────────────────────────

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitter?: boolean;
  retryOn?: (err: unknown, attempt: number) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 500,
    maxDelayMs = 30_000,
    backoffMultiplier = 2,
    jitter = true,
    retryOn = () => true,
  } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !retryOn(err, attempt)) {
        throw err;
      }

      let delay = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt - 1), maxDelayMs);
      if (jitter) {
        delay = delay * (0.5 + Math.random() * 0.5);
      }

      logger.warn({ attempt, maxAttempts, delayMs: Math.round(delay), err }, 'Retrying after failure');
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}
