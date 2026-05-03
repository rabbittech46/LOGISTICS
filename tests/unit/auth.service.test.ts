// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — Auth Service
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock dependencies
const mockQuery = jest.fn();
const mockPoolQuery = jest.fn();
const mockRedis = {
  incr: jest.fn(),
  expire: jest.fn(),
  del: jest.fn(),
  setex: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
};

jest.unstable_mockModule('../../src/shared/db.js', () => ({
  query: mockQuery,
  pool: { query: mockPoolQuery, connect: jest.fn() },
  shutdownPool: jest.fn(),
}));

jest.unstable_mockModule('../../src/shared/redis.js', () => ({
  redis: mockRedis,
}));

jest.unstable_mockModule('../../src/shared/config.js', () => ({
  config: {
    jwtPrivateKey: 'test-private-key',
    jwtAlgorithm: 'HS256',
    jwtExpiresIn: '15m',
  },
}));

jest.unstable_mockModule('../../src/shared/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { register, login } = await import('../../src/api/services/auth.service.js');

describe('Auth Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.del.mockResolvedValue(1);
    mockRedis.setex.mockResolvedValue('OK');
  });

  describe('register', () => {
    it('should create a new user', async () => {
      mockQuery
        .mockResolvedValueOnce([])  // no existing user
        .mockResolvedValueOnce([{ id: 'user-123' }]);  // insert result

      const result = await register({
        email: 'test@example.com',
        password: 'P@ssw0rd!23',
        firstName: 'John',
        lastName: 'Doe',
      });

      expect(result.userId).toBe('user-123');
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('should reject duplicate email', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'existing' }]); // user exists

      await expect(
        register({
          email: 'existing@example.com',
          password: 'P@ssw0rd!23',
          firstName: 'Jane',
          lastName: 'Doe',
        }),
      ).rejects.toThrow('already exists');
    });
  });

  describe('login', () => {
    it('should reject with invalid email', async () => {
      mockQuery.mockResolvedValueOnce([]); // no user found

      await expect(
        login({ email: 'nobody@example.com', password: 'whatever' }),
      ).rejects.toThrow('Invalid email or password');
    });

    it('should enforce rate limiting', async () => {
      mockRedis.incr.mockResolvedValueOnce(11); // Over limit

      await expect(
        login({ email: 'test@example.com', password: 'test' }),
      ).rejects.toThrow('Too many login attempts');
    });

    it('should reject deactivated accounts', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: 'user-1',
        email: 'test@example.com',
        password_hash: '$2a$12$dummy',
        first_name: 'Test',
        last_name: 'User',
        is_active: false,
        email_verified: false,
      }]);

      await expect(
        login({ email: 'test@example.com', password: 'test' }),
      ).rejects.toThrow('deactivated');
    });
  });
});
