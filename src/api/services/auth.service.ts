// ─────────────────────────────────────────────────────────────────────────────
// Auth Service — JWT issuance, refresh tokens, OAuth2, password management
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query, pool } from '../../shared/db.js';
import { redis } from '../../shared/redis.js';
import { config } from '../../shared/config.js';
import { logger } from '../../shared/logger.js';
import { AppError } from '../../shared/app-error.js';
import { signAccessToken } from '../../shared/jwt.js';
import type { JwtPayload, UserRole } from '../../shared/types.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  orgId?: string;   // If user has multiple org memberships
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizations: Array<{
    orgId: string;
    orgName: string;
    role: UserRole;
    orgType: string;
  }>;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  email_verified: boolean;
}

interface MembershipRow {
  organization_id: string;
  org_name: string;
  org_type: string;
  role: UserRole;
}

// ── Constants ───────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_TTL_DAYS = 30;
const REFRESH_TOKEN_TTL_SEC = REFRESH_TOKEN_TTL_DAYS * 24 * 3600;
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_LOCKOUT_SEC = 900; // 15 minutes

// ─────────────────────────────────────────────────────────────────────────────
// register — Create a new user account
// ─────────────────────────────────────────────────────────────────────────────
export async function register(req: RegisterRequest): Promise<{ userId: string }> {
  // Check if email already exists
  const existing = await query<{ id: string }>(`SELECT id FROM logistics.users WHERE email = $1`, [req.email]);
  if (existing.length > 0) {
    throw new AppError(409, 'An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(req.password, BCRYPT_ROUNDS);

  const result = await query<{ id: string }>(
    `INSERT INTO logistics.users (id, email, password_hash, first_name, last_name, phone)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
     RETURNING id`,
    [req.email, passwordHash, req.firstName, req.lastName, req.phone ?? null],
  );

  logger.info({ userId: result[0].id }, 'User registered');
  return { userId: result[0].id };
}

// ─────────────────────────────────────────────────────────────────────────────
// login — Authenticate user and issue JWT + refresh token
// ─────────────────────────────────────────────────────────────────────────────
export async function login(req: LoginRequest): Promise<AuthTokens & { user: UserProfile }> {
  // Check rate limiting for brute-force protection
  const rateLimitKey = `login:attempts:${createHash('sha256').update(req.email).digest('hex')}`;
  const attempts = await redis.incr(rateLimitKey);
  if (attempts === 1) {
    await redis.expire(rateLimitKey, LOGIN_LOCKOUT_SEC);
  }
  if (attempts > MAX_LOGIN_ATTEMPTS) {
    throw new AppError(429, 'Too many login attempts. Please try again later.');
  }

  // Fetch user
  const users = await query<UserRow>(
    `SELECT id, email, password_hash, first_name, last_name, is_active, email_verified
       FROM logistics.users WHERE email = $1`,
    [req.email],
  );

  if (users.length === 0) {
    throw new AppError(401, 'Invalid email or password');
  }

  const user = users[0];
  if (!user.is_active) {
    throw new AppError(403, 'Account is deactivated');
  }

  // Verify password using constant-time comparison
  const valid = await bcrypt.compare(req.password, user.password_hash);
  if (!valid) {
    throw new AppError(401, 'Invalid email or password');
  }

  // Clear rate limit on success
  await redis.del(rateLimitKey);

  // Fetch org memberships
  const memberships = await query<MembershipRow>(
    `SELECT om.organization_id, o.name AS org_name, o.org_type, om.role
       FROM logistics.organization_members om
       JOIN logistics.organizations o ON o.id = om.organization_id
      WHERE om.user_id = $1 AND om.is_active = TRUE AND o.is_active = TRUE`,
    [user.id],
  );

  if (memberships.length === 0) {
    throw new AppError(403, 'No active organization membership found');
  }

  // Select org context — explicit or first available
  const activeMembership = req.orgId
    ? memberships.find((m) => m.organization_id === req.orgId)
    : memberships[0];

  if (!activeMembership) {
    throw new AppError(403, 'You are not a member of the specified organization');
  }

  // Issue tokens
  const tokens = await issueTokens(user.id, user.email, activeMembership.organization_id, activeMembership.role);

  // Update last_login_at
  await pool.query(`UPDATE logistics.users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

  // Cache RBAC
  await redis.setex(
    `rbac:${user.id}:${activeMembership.organization_id}`,
    300,
    activeMembership.role,
  );

  return {
    ...tokens,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      organizations: memberships.map((m) => ({
        orgId: m.organization_id,
        orgName: m.org_name,
        role: m.role,
        orgType: m.org_type,
      })),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// refreshAccessToken — Rotate refresh token + issue new access token
// ─────────────────────────────────────────────────────────────────────────────
export async function refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
  const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
  const storedData = await redis.get(`refresh:${tokenHash}`);

  if (!storedData) {
    throw new AppError(401, 'Invalid or expired refresh token');
  }

  const { userId, email, orgId, role } = JSON.parse(storedData);

  // Revoke old token (one-time use)
  await redis.del(`refresh:${tokenHash}`);

  // Issue new token pair
  return issueTokens(userId, email, orgId, role);
}

// ─────────────────────────────────────────────────────────────────────────────
// logout — Revoke refresh token
// ─────────────────────────────────────────────────────────────────────────────
export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
  await redis.del(`refresh:${tokenHash}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// issueTokens — Internal token generation
// ─────────────────────────────────────────────────────────────────────────────
async function issueTokens(
  userId: string,
  email: string,
  orgId: string,
  role: UserRole,
): Promise<AuthTokens> {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: userId,
    email,
    orgId,
    role,
  };

  const accessToken = signAccessToken(payload);

  // Generate opaque refresh token
  const refreshToken = randomUUID() + randomUUID();
  const tokenHash = createHash('sha256').update(refreshToken).digest('hex');

  // Store refresh token hash in Redis
  await redis.setex(
    `refresh:${tokenHash}`,
    REFRESH_TOKEN_TTL_SEC,
    JSON.stringify({ userId, email, orgId, role }),
  );

  return {
    accessToken,
    refreshToken,
    expiresIn: 900, // 15 min in seconds
  };
}
