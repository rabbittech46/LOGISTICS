// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — Rate Limiter Middleware
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock Redis
const mockPipeline = {
  zremrangebyscore: jest.fn().mockReturnThis(),
  zcard: jest.fn().mockReturnThis(),
  zadd: jest.fn().mockReturnThis(),
  pexpire: jest.fn().mockReturnThis(),
  exec: jest.fn(),
};

const mockRedis = {
  pipeline: jest.fn(() => mockPipeline),
};

jest.unstable_mockModule('../../src/shared/redis.js', () => ({
  redis: mockRedis,
}));

jest.unstable_mockModule('../../src/shared/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { rateLimit } = await import('../../src/api/middleware/rate-limiter.js');

// Simple Express mock helpers
function mockReq(overrides: Record<string, any> = {}) {
  return { ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' }, ...overrides } as any;
}

function mockRes() {
  const res: any = { headers: {} };
  res.setHeader = jest.fn((k: string, v: any) => { res.headers[k] = v; });
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('Rate Limiter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should allow requests under the limit', async () => {
    mockPipeline.exec.mockResolvedValueOnce([
      [null, 0],  // zremrangebyscore
      [null, 5],  // zcard: 5 requests so far
      [null, 1],  // zadd
      [null, 1],  // pexpire
    ]);

    const middleware = rateLimit({ windowMs: 60000, maxRequests: 100 });
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.headers['X-RateLimit-Remaining']).toBe(94);
  });

  it('should block requests over the limit', async () => {
    mockPipeline.exec.mockResolvedValueOnce([
      [null, 0],
      [null, 100], // at limit
      [null, 1],
      [null, 1],
    ]);

    const middleware = rateLimit({ windowMs: 60000, maxRequests: 100 });
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('should fail open on Redis error', async () => {
    mockPipeline.exec.mockRejectedValueOnce(new Error('Redis down'));

    const middleware = rateLimit({ windowMs: 60000, maxRequests: 100 });
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled(); // fail-open
  });
});
