// ─────────────────────────────────────────────────────────────────────────────
// Organization Service — CRUD, membership management, verification
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto';
import { query, getClient } from '../../shared/db.js';
import { logger } from '../../shared/logger.js';
import { AppError } from '../../shared/app-error.js';
import { publishEvent, TOPICS } from '../../shared/kafka.js';
import { config } from '../../shared/config.js';
import type { OrgType, UserRole } from '../../shared/types.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface CreateOrgRequest {
  name: string;
  orgType: OrgType;
  contactEmail: string;
  contactPhone?: string;
  ein?: string;
  mcNumber?: string;
  dotNumber?: string;
  billingAddress?: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
}

export interface UpdateOrgRequest {
  name?: string;
  contactEmail?: string;
  contactPhone?: string;
  logoUrl?: string;
  billingAddress?: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  settings?: Record<string, unknown>;
}

export interface InviteMemberRequest {
  userId: string;
  role: UserRole;
}

interface OrgRow {
  id: string;
  name: string;
  org_type: OrgType;
  ein: string | null;
  mc_number: string | null;
  dot_number: string | null;
  logo_url: string | null;
  contact_email: string;
  contact_phone: string | null;
  billing_address: Record<string, string> | null;
  settings: Record<string, unknown>;
  is_active: boolean;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  id: string;
  user_id: string;
  role: UserRole;
  is_active: boolean;
  joined_at: string | null;
  first_name: string;
  last_name: string;
  email: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// createOrganization
// ─────────────────────────────────────────────────────────────────────────────
export async function createOrganization(
  req: CreateOrgRequest,
  creatorUserId: string,
): Promise<OrgRow> {
  const client = await getClient(creatorUserId);
  try {
    // Carrier requires MC number (enforced by DB CHECK, but validate early)
    if (req.orgType === 'CARRIER' && !req.mcNumber) {
      throw new AppError(400, 'Carrier organizations require an MC number');
    }

    const result = await client.query<OrgRow>(
      `INSERT INTO logistics.organizations (
        name, org_type, contact_email, contact_phone, ein, mc_number, dot_number, billing_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, name, org_type, ein, mc_number, dot_number, logo_url,
                contact_email, contact_phone, billing_address, settings,
                is_active, verified_at, created_at, updated_at`,
      [
        req.name,
        req.orgType,
        req.contactEmail,
        req.contactPhone ?? null,
        req.ein ?? null,
        req.mcNumber ?? null,
        req.dotNumber ?? null,
        req.billingAddress ? JSON.stringify(req.billingAddress) : null,
      ],
    );

    const createdOrg = result.rows[0];
    const orgId = createdOrg.id;

    // Creator automatically becomes ORG_ADMIN
    await client.query(
      `INSERT INTO logistics.organization_members (organization_id, user_id, role, invited_by, joined_at)
       VALUES ($1, $2, 'ORG_ADMIN', $2, NOW())`,
      [orgId, creatorUserId],
    );

    await client.query('COMMIT');

    await publishEvent(TOPICS.ANALYTICS_EVENTS, {
      eventId: randomUUID(),
      eventType: 'organization.created',
      aggregateId: orgId,
      aggregateType: 'organization',
      timestamp: new Date().toISOString(),
      version: 1,
      producedBy: config.serviceName,
      payload: { orgType: req.orgType, name: req.name },
    }).catch(() => {});

    logger.info({ orgId, creatorUserId }, 'Organization created');
    return createdOrg;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getOrganization
// ─────────────────────────────────────────────────────────────────────────────
export async function getOrganization(orgId: string, userId: string): Promise<OrgRow> {
  const rows = await query<OrgRow>(
    `SELECT id, name, org_type, ein, mc_number, dot_number, logo_url,
            contact_email, contact_phone, billing_address, settings,
            is_active, verified_at, created_at, updated_at
       FROM logistics.organizations WHERE id = $1`,
    [orgId],
    userId,
  );

  if (rows.length === 0) {
    throw new AppError(404, 'Organization not found');
  }
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// listUserOrganizations — all orgs the user belongs to
// ─────────────────────────────────────────────────────────────────────────────
export async function listUserOrganizations(userId: string): Promise<Array<OrgRow & { role: UserRole }>> {
  const rows = await query<OrgRow & { role: UserRole }>(
    `SELECT o.id, o.name, o.org_type, o.ein, o.mc_number, o.dot_number,
            o.logo_url, o.contact_email, o.contact_phone, o.billing_address,
            o.settings, o.is_active, o.verified_at, o.created_at, o.updated_at,
            om.role
       FROM logistics.organizations o
       JOIN logistics.organization_members om ON om.organization_id = o.id
      WHERE om.user_id = $1 AND om.is_active = TRUE AND o.is_active = TRUE
      ORDER BY o.name`,
    [userId],
    userId,
  );
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// updateOrganization
// ─────────────────────────────────────────────────────────────────────────────
export async function updateOrganization(
  orgId: string,
  req: UpdateOrgRequest,
  userId: string,
): Promise<OrgRow> {
  // Build dynamic SET clause from provided fields
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (req.name !== undefined) { fields.push(`name = $${idx++}`); values.push(req.name); }
  if (req.contactEmail !== undefined) { fields.push(`contact_email = $${idx++}`); values.push(req.contactEmail); }
  if (req.contactPhone !== undefined) { fields.push(`contact_phone = $${idx++}`); values.push(req.contactPhone); }
  if (req.logoUrl !== undefined) { fields.push(`logo_url = $${idx++}`); values.push(req.logoUrl); }
  if (req.billingAddress !== undefined) { fields.push(`billing_address = $${idx++}`); values.push(JSON.stringify(req.billingAddress)); }
  if (req.settings !== undefined) { fields.push(`settings = settings || $${idx++}::jsonb`); values.push(JSON.stringify(req.settings)); }

  if (fields.length === 0) {
    throw new AppError(400, 'No fields to update');
  }

  values.push(orgId);

  const rows = await query<OrgRow>(
    `UPDATE logistics.organizations SET ${fields.join(', ')}
     WHERE id = $${idx} RETURNING *`,
    values,
    userId,
  );

  if (rows.length === 0) {
    throw new AppError(404, 'Organization not found');
  }

  logger.info({ orgId, userId }, 'Organization updated');
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// inviteMember — add a user to an organization
// ─────────────────────────────────────────────────────────────────────────────
export async function inviteMember(
  orgId: string,
  req: InviteMemberRequest,
  invitedBy: string,
): Promise<{ membershipId: string }> {
  // Verify target user exists
  const users = await query<{ id: string }>(
    `SELECT id FROM logistics.users WHERE id = $1 AND is_active = TRUE`,
    [req.userId],
  );
  if (users.length === 0) {
    throw new AppError(404, 'User not found');
  }

  // Check if already a member
  const existing = await query<{ id: string }>(
    `SELECT id FROM logistics.organization_members
     WHERE organization_id = $1 AND user_id = $2`,
    [orgId, req.userId],
  );
  if (existing.length > 0) {
    throw new AppError(409, 'User is already a member of this organization');
  }

  const result = await query<{ id: string }>(
    `INSERT INTO logistics.organization_members (organization_id, user_id, role, invited_by, joined_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING id`,
    [orgId, req.userId, req.role, invitedBy],
    invitedBy,
  );

  logger.info({ orgId, userId: req.userId, role: req.role }, 'Member invited');
  return { membershipId: result[0].id };
}

// ─────────────────────────────────────────────────────────────────────────────
// removeMember — deactivate a membership
// ─────────────────────────────────────────────────────────────────────────────
export async function removeMember(
  orgId: string,
  targetUserId: string,
  actorUserId: string,
): Promise<void> {
  const result = await query<{ id: string }>(
    `UPDATE logistics.organization_members
     SET is_active = FALSE
     WHERE organization_id = $1 AND user_id = $2 AND is_active = TRUE
     RETURNING id`,
    [orgId, targetUserId],
    actorUserId,
  );

  if (result.length === 0) {
    throw new AppError(404, 'Membership not found');
  }

  logger.info({ orgId, targetUserId, actorUserId }, 'Member removed');
}

// ─────────────────────────────────────────────────────────────────────────────
// listMembers — all members of an organization
// ─────────────────────────────────────────────────────────────────────────────
export async function listMembers(
  orgId: string,
  userId: string,
): Promise<MemberRow[]> {
  return query<MemberRow>(
    `SELECT om.id, om.user_id, om.role, om.is_active, om.joined_at,
            u.first_name, u.last_name, u.email
       FROM logistics.organization_members om
       JOIN logistics.users u ON u.id = om.user_id
      WHERE om.organization_id = $1 AND om.is_active = TRUE
      ORDER BY om.role, u.last_name`,
    [orgId],
    userId,
  );
}
