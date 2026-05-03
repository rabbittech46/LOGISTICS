// ─────────────────────────────────────────────────────────────────────────────
// User Service — Profile management, password change, user lookup
// ─────────────────────────────────────────────────────────────────────────────
import bcrypt from 'bcryptjs';
import { query } from '../../shared/db.js';
import { logger } from '../../shared/logger.js';
import { AppError } from '../../shared/app-error.js';
import type { UserRole } from '../../shared/types.js';

const BCRYPT_ROUNDS = 12;

// ── Types ───────────────────────────────────────────────────────────────────

interface UserProfileRow {
  id: string;
  email: string;
  phone: string | null;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  is_active: boolean;
  email_verified: boolean;
  phone_verified: boolean;
  last_login_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UpdateProfileRequest {
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface UserSearchResult {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatarUrl: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// getProfile — Get current user's profile with org memberships
// ─────────────────────────────────────────────────────────────────────────────
export async function getProfile(userId: string): Promise<{
  user: UserProfileRow;
  organizations: Array<{ orgId: string; orgName: string; orgType: string; role: UserRole }>;
}> {
  const users = await query<UserProfileRow>(
    `SELECT id, email, phone, first_name, last_name, avatar_url,
            is_active, email_verified, phone_verified, last_login_at,
            metadata, created_at, updated_at
       FROM logistics.users WHERE id = $1`,
    [userId],
    userId,
  );

  if (users.length === 0) {
    throw new AppError(404, 'User not found');
  }

  const orgs = await query<{ org_id: string; org_name: string; org_type: string; role: UserRole }>(
    `SELECT o.id AS org_id, o.name AS org_name, o.org_type, om.role
       FROM logistics.organization_members om
       JOIN logistics.organizations o ON o.id = om.organization_id
      WHERE om.user_id = $1 AND om.is_active = TRUE AND o.is_active = TRUE
      ORDER BY o.name`,
    [userId],
    userId,
  );

  return {
    user: users[0],
    organizations: orgs.map((r) => ({
      orgId: r.org_id,
      orgName: r.org_name,
      orgType: r.org_type,
      role: r.role,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// updateProfile
// ─────────────────────────────────────────────────────────────────────────────
export async function updateProfile(
  userId: string,
  req: UpdateProfileRequest,
): Promise<UserProfileRow> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (req.firstName !== undefined) { fields.push(`first_name = $${idx++}`); values.push(req.firstName); }
  if (req.lastName !== undefined) { fields.push(`last_name = $${idx++}`); values.push(req.lastName); }
  if (req.phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(req.phone); }
  if (req.avatarUrl !== undefined) { fields.push(`avatar_url = $${idx++}`); values.push(req.avatarUrl); }
  if (req.metadata !== undefined) { fields.push(`metadata = metadata || $${idx++}::jsonb`); values.push(JSON.stringify(req.metadata)); }

  if (fields.length === 0) {
    throw new AppError(400, 'No fields to update');
  }

  values.push(userId);

  const rows = await query<UserProfileRow>(
    `UPDATE logistics.users SET ${fields.join(', ')}
     WHERE id = $${idx} AND is_active = TRUE
     RETURNING id, email, phone, first_name, last_name, avatar_url,
               is_active, email_verified, phone_verified, last_login_at,
               metadata, created_at, updated_at`,
    values,
    userId,
  );

  if (rows.length === 0) {
    throw new AppError(404, 'User not found');
  }

  logger.info({ userId }, 'Profile updated');
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// changePassword
// ─────────────────────────────────────────────────────────────────────────────
export async function changePassword(
  userId: string,
  req: ChangePasswordRequest,
): Promise<void> {
  const rows = await query<{ password_hash: string }>(
    `SELECT password_hash FROM logistics.users WHERE id = $1 AND is_active = TRUE`,
    [userId],
    userId,
  );

  if (rows.length === 0) {
    throw new AppError(404, 'User not found');
  }

  const valid = await bcrypt.compare(req.currentPassword, rows[0].password_hash);
  if (!valid) {
    throw new AppError(401, 'Current password is incorrect');
  }

  const newHash = await bcrypt.hash(req.newPassword, BCRYPT_ROUNDS);

  await query(
    `UPDATE logistics.users SET password_hash = $1 WHERE id = $2`,
    [newHash, userId],
    userId,
  );

  logger.info({ userId }, 'Password changed');
}

// ─────────────────────────────────────────────────────────────────────────────
// getUserById — admin lookup
// ─────────────────────────────────────────────────────────────────────────────
export async function getUserById(targetUserId: string, actorUserId: string): Promise<UserProfileRow> {
  const rows = await query<UserProfileRow>(
    `SELECT id, email, phone, first_name, last_name, avatar_url,
            is_active, email_verified, phone_verified, last_login_at,
            metadata, created_at, updated_at
       FROM logistics.users WHERE id = $1`,
    [targetUserId],
    actorUserId,
  );

  if (rows.length === 0) {
    throw new AppError(404, 'User not found');
  }
  return rows[0];
}

export async function searchUsers(searchTerm: string, actorUserId: string): Promise<UserSearchResult[]> {
  const normalized = searchTerm.trim();
  if (normalized.length < 2) {
    throw new AppError(400, 'Search term must be at least 2 characters');
  }

  const likePattern = `%${normalized}%`;
  const rows = await query<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    phone: string | null;
    avatar_url: string | null;
  }>(
    `SELECT id, email, first_name, last_name, phone, avatar_url
       FROM logistics.users
      WHERE is_active = TRUE
        AND (
          email ILIKE $1 OR
          first_name ILIKE $1 OR
          last_name ILIKE $1 OR
          CONCAT(first_name, ' ', last_name) ILIKE $1
        )
      ORDER BY first_name, last_name, email
      LIMIT 25`,
    [likePattern],
    actorUserId,
  );

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    avatarUrl: row.avatar_url,
  }));
}
