// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests — Organization Service
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockQuery = jest.fn();
const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};
const mockGetClient = jest.fn(async () => mockClient);

jest.unstable_mockModule('../../src/shared/db.js', () => ({
  query: mockQuery,
  getClient: mockGetClient,
}));

jest.unstable_mockModule('../../src/shared/kafka.js', () => ({
  publishEvent: jest.fn().mockResolvedValue(undefined),
  TOPICS: { ANALYTICS_EVENTS: 'logistics.analytics.events' },
}));

jest.unstable_mockModule('../../src/shared/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const {
  createOrganization, getOrganization, listUserOrganizations,
  updateOrganization, inviteMember, removeMember,
} = await import('../../src/api/services/organization.service.js');

describe('Organization Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
  });

  describe('createOrganization', () => {
    it('should create an org and add creator as admin', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'org-1',
            name: 'Test Corp',
            org_type: 'SHIPPER',
            ein: null,
            mc_number: null,
            dot_number: null,
            logo_url: null,
            contact_email: 'ops@test.example',
            contact_phone: null,
            billing_address: null,
            settings: {},
            is_active: true,
            verified_at: null,
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          }],
        })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const result = await createOrganization({
        name: 'Test Corp',
        orgType: 'SHIPPER',
        contactEmail: 'ops@test.example',
      }, 'user-1');

      expect(result.id).toBe('org-1');
      expect(mockGetClient).toHaveBeenCalledWith('user-1');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO logistics.organization_members'),
        ['org-1', 'user-1'],
      );
    });
  });

  describe('getOrganization', () => {
    it('should return an organization', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'org-1', name: 'Test Corp' }]);

      const result = await getOrganization('org-1', 'user-1');
      expect(result.name).toBe('Test Corp');
    });

    it('should throw 404 when not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await expect(getOrganization('missing', 'user-1')).rejects.toThrow('Organization not found');
    });
  });

  describe('updateOrganization', () => {
    it('should throw 400 with empty update', async () => {
      await expect(updateOrganization('org-1', {}, 'user-1')).rejects.toThrow('No fields to update');
    });

    it('should update org name', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'org-1', name: 'Updated Corp' }]);

      const result = await updateOrganization('org-1', { name: 'Updated Corp' }, 'user-1');
      expect(result.name).toBe('Updated Corp');
    });
  });

  describe('inviteMember', () => {
    it('should add a member to the organization', async () => {
      mockQuery
        .mockResolvedValueOnce([{ id: 'user-2' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'membership-1' }]);

      await inviteMember('org-1', { userId: 'user-2', role: 'DISPATCHER' }, 'user-1');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO logistics.organization_members'),
        expect.any(Array),
        'user-1',
      );
    });
  });

  describe('removeMember', () => {
    it('should remove a member from the organization', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'membership-1' }]);

      await removeMember('org-1', 'user-2', 'user-1');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE logistics.organization_members'),
        expect.any(Array),
        'user-1',
      );
    });
  });
});
