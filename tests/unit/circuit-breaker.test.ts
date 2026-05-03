// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — Circuit Breaker
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/shared/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { CircuitBreaker, CircuitOpenError, withRetry } = await import('../../src/shared/circuit-breaker.js');

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({
      name: 'test-circuit',
      failureThreshold: 3,
      resetTimeoutMs: 200,
      halfOpenSuccessThreshold: 2,
      callTimeoutMs: 500,
    });
  });

  it('starts in CLOSED state', () => {
    expect(cb.getState()).toBe('CLOSED');
  });

  it('allows calls to pass through in CLOSED state', async () => {
    const result = await cb.execute(async () => 42);
    expect(result).toBe(42);
  });

  it('opens after reaching failure threshold', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }
    expect(cb.getState()).toBe('OPEN');
  });

  it('rejects calls immediately in OPEN state', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }
    await expect(cb.execute(async () => 42)).rejects.toThrowError(CircuitOpenError);
  });

  it('transitions to HALF_OPEN after reset timeout', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }
    expect(cb.getState()).toBe('OPEN');

    await new Promise((r) => setTimeout(r, 250));
    // Next call attempts in HALF_OPEN
    const result = await cb.execute(async () => 99);
    expect(result).toBe(99);
    expect(cb.getState()).toBe('HALF_OPEN');
  });

  it('closes after sufficient successes in HALF_OPEN', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }

    await new Promise((r) => setTimeout(r, 250));

    await cb.execute(async () => 1);
    await cb.execute(async () => 2);
    expect(cb.getState()).toBe('CLOSED');
  });

  it('returns to OPEN on failure in HALF_OPEN', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }

    await new Promise((r) => setTimeout(r, 250));

    await cb.execute(async () => { throw new Error('still broken'); }).catch(() => {});
    expect(cb.getState()).toBe('OPEN');
  });
});

describe('withRetry', () => {
  it('returns on first success', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return 42;
    }, { maxAttempts: 3 });

    expect(result).toBe(42);
    expect(calls).toBe(1);
  });

  it('retries up to maxRetries on failure then throws', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('boom');
        },
        { maxAttempts: 3, initialDelayMs: 10 },
      ),
    ).rejects.toThrow('boom');

    expect(calls).toBe(3);
  });

  it('succeeds after transient failures', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('transient');
        return 'ok';
      },
      { maxAttempts: 5, initialDelayMs: 10 },
    );

    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });
});
