// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — User Service
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockQuery = jest.fn();

jest.unstable_mockModule('../../src/shared/db.js', () => ({
  query: mockQuery,
}));

jest.unstable_mockModule('../../src/shared/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.unstable_mockModule('bcryptjs', () => ({
  default: {
    compare: jest.fn(),
    hash: jest.fn().mockResolvedValue('$2a$12$newhash'),
  },
}));

const { getProfile, updateProfile, changePassword, getUserById } = await import(
  '../../src/api/services/user.service.js'
);

describe('User Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getProfile', () => {
    it('should return user with org memberships', async () => {
      mockQuery
        .mockResolvedValueOnce([{
          id: 'user-1', email: 'test@example.com', first_name: 'John',
        }])
        .mockResolvedValueOnce([
          { organization_id: 'org-1', name: 'Test Corp', role: 'ORG_ADMIN' },
        ]);

      const result = await getProfile('user-1');
      expect(result.user.email).toBe('test@example.com');
      expect(result.organizations).toHaveLength(1);
    });

    it('should throw 404 when user not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await expect(getProfile('missing')).rejects.toThrow('User not found');
    });
  });

  describe('updateProfile', () => {
    it('should update first name', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: 'user-1', first_name: 'Jane',
      }]);

      const result = await updateProfile('user-1', { firstName: 'Jane' });
      expect(result.first_name).toBe('Jane');
    });

    it('should throw 400 with empty update', async () => {
      await expect(updateProfile('user-1', {})).rejects.toThrow('No fields to update');
    });
  });

  describe('changePassword', () => {
    it('should reject wrong current password', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: 'user-1', password_hash: '$2a$12$oldhash',
      }]);

      const bcryptjs = (await import('bcryptjs')).default;
      (bcryptjs.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        changePassword('user-1', 'wrongpassword', 'Newp@ss123'),
      ).rejects.toThrow('Current password is incorrect');
    });
  });

  describe('getUserById', () => {
    it('should look up a user by ID', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: 'user-1', email: 'test@example.com', first_name: 'John',
      }]);

      const result = await getUserById('user-1', 'admin-1');
      expect(result.email).toBe('test@example.com');
    });

    it('should throw 404 when user not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await expect(getUserById('missing', 'admin-1')).rejects.toThrow('User not found');
    });
  });
});
