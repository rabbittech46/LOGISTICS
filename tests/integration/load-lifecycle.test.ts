// ─────────────────────────────────────────────────────────────────────────────
// Integration Tests — Load Lifecycle (create → bid → accept → deliver)
//
// Uses real PostgreSQL via schema.sql and real Redis.
// In CI: uses GitHub Actions service containers
// Locally: provide DATABASE_URL / REDIS_URL for your test stack
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test_user:test_password@127.0.0.1:5432/logistics_test?schema=logistics';

let pool: Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });

  // Verify schema is loaded
  const result = await pool.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = 'logistics'`,
  );
  expect(parseInt(result.rows[0].cnt, 10)).toBeGreaterThan(10);
});

afterAll(async () => {
  await pool.end();
});

describe('Load Lifecycle Integration', () => {
  const shipperId = randomUUID();
  const carrierId = randomUUID();
  const shipperUserId = randomUUID();
  const carrierUserId = randomUUID();
  const driverProfileId = randomUUID();
  const truckId = randomUUID();
  const loadId = randomUUID();
  const bidId = randomUUID();
  const assignmentId = randomUUID();

  it('should create organizations', async () => {
    await pool.query(
      `INSERT INTO logistics.organizations (id, name, org_type, ein, contact_email)
       VALUES ($1, 'Test Shipper Inc', 'SHIPPER', 'EIN-1234567', 'shipper@test.example')`,
      [shipperId],
    );

    await pool.query(
      `INSERT INTO logistics.organizations (id, name, org_type, ein, dot_number, mc_number, contact_email)
       VALUES ($1, 'Test Carrier LLC', 'CARRIER', 'EIN-7654321', 'DOT-123456', 'MC-654321', 'carrier@test.example')`,
      [carrierId],
    );

    expect(shipperId).toBeDefined();
    expect(carrierId).toBeDefined();
  });

  it('should create users and memberships', async () => {
    await pool.query(
      `INSERT INTO logistics.users (id, email, password_hash, first_name, last_name)
       VALUES ($1, 'shipper@test.com', '$2a$12$test', 'Ship', 'Per')`,
      [shipperUserId],
    );

    await pool.query(
      `INSERT INTO logistics.users (id, email, password_hash, first_name, last_name)
       VALUES ($1, 'driver@test.com', '$2a$12$test', 'Driv', 'Er')`,
      [carrierUserId],
    );

    await pool.query(
      `INSERT INTO logistics.organization_members (organization_id, user_id, role, is_active, joined_at)
       VALUES ($1, $2, 'SHIPPER_STAFF', TRUE, NOW())`,
      [shipperId, shipperUserId],
    );

    await pool.query(
      `INSERT INTO logistics.organization_members (organization_id, user_id, role, is_active, joined_at)
       VALUES ($1, $2, 'DRIVER', TRUE, NOW())`,
      [carrierId, carrierUserId],
    );
  });

  it('should create driver profile and truck', async () => {
    await pool.query(
      `INSERT INTO logistics.driver_profiles (id, user_id, organization_id, cdl_number, cdl_class, cdl_state, cdl_expiry)
       VALUES ($1, $2, $3, 'CDL-123456', 'A', 'TX', CURRENT_DATE + INTERVAL '2 years')`,
      [driverProfileId, carrierUserId, carrierId],
    );

    await pool.query(
      `INSERT INTO logistics.trucks (
          id, organization_id, assigned_driver_id, vin, plate_number, plate_state,
          make, model, year, cargo_type, length_in, width_in, height_in,
          payload_capacity_lbs, gross_vehicle_wt_lbs, status, insurance_expiry, current_location
        ) VALUES (
          $1, $2, $3, 'VIN12345678901234', 'TX-ABC123', 'TX',
          'Freightliner', 'Cascadia', 2024, 'DRY_VAN', 636, 102, 162,
          45000, 80000, 'AVAILABLE', CURRENT_DATE + INTERVAL '1 year',
          ST_SetSRID(ST_MakePoint(-96.7970, 32.7767), 4326)::geography
        )`,
      [truckId, carrierId, driverProfileId],
    );
  });

  it('should create a load', async () => {
    await pool.query(
      `INSERT INTO logistics.loads (
          id, shipper_org_id, posted_by, cargo_type, commodity, weight_lbs,
          pickup_location, pickup_address, pickup_city, pickup_state, pickup_zip,
          pickup_earliest, pickup_latest,
          dropoff_location, dropoff_address, dropoff_city, dropoff_state, dropoff_zip,
          dropoff_earliest, dropoff_latest,
          offered_rate_usd, status, load_board_visible
        ) VALUES (
          $1, $2, $3, 'DRY_VAN', 'Consumer goods', 35000,
          ST_SetSRID(ST_MakePoint(-96.7970, 32.7767), 4326)::geography, '100 Pickup St', 'Dallas', 'TX', '75201',
          NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days',
          ST_SetSRID(ST_MakePoint(-95.3698, 29.7604), 4326)::geography, '200 Dropoff Ave', 'Houston', 'TX', '77001',
          NOW() + INTERVAL '2 days', NOW() + INTERVAL '3 days',
          2500.00, 'POSTED', TRUE
        )`,
      [loadId, shipperId, shipperUserId],
    );

    const load = await pool.query(
      `SELECT id, status FROM logistics.loads WHERE id = $1`,
      [loadId],
    );

    expect(load.rows[0].id).toBe(loadId);
    expect(load.rows[0].status).toBe('POSTED');
  });

  it('should create a bid on the load', async () => {
    await pool.query(
      `UPDATE logistics.loads SET status = 'BIDDING' WHERE id = $1`,
      [loadId],
    );

    await pool.query(
      `INSERT INTO logistics.bids (id, load_id, carrier_org_id, bidding_driver_id, truck_id, bid_amount_usd, status)
       VALUES ($1, $2, $3, $4, $5, 2450.00, 'PENDING')`,
      [bidId, loadId, carrierId, driverProfileId, truckId],
    );

    const bid = await pool.query(
      `SELECT id, status FROM logistics.bids WHERE id = $1`,
      [bidId],
    );

    expect(bid.rows[0].id).toBe(bidId);
    expect(bid.rows[0].status).toBe('PENDING');
  });

  it('should accept the bid and confirm the load on assignment insert', async () => {
    await pool.query(
      `UPDATE logistics.bids SET status = 'ACCEPTED', responded_at = NOW() WHERE id = $1`,
      [bidId],
    );

    await pool.query(
      `INSERT INTO logistics.assignments (id, load_id, bid_id, carrier_org_id, driver_id, truck_id, agreed_rate_usd)
       VALUES ($1, $2, $3, $4, $5, $6, 2450.00)`,
      [assignmentId, loadId, bidId, carrierId, driverProfileId, truckId],
    );

    const assignment = await pool.query(
      `SELECT id, status, scheduled_window IS NOT NULL AS has_window
         FROM logistics.assignments
        WHERE id = $1`,
      [assignmentId],
    );

    const load = await pool.query(
      `SELECT status FROM logistics.loads WHERE id = $1`,
      [loadId],
    );

    const truck = await pool.query(
      `SELECT status FROM logistics.trucks WHERE id = $1`,
      [truckId],
    );

    expect(assignment.rows).toHaveLength(1);
    expect(assignment.rows[0].status).toBe('ACTIVE');
    expect(assignment.rows[0].has_window).toBe(true);
    expect(load.rows[0].status).toBe('CONFIRMED');
    expect(truck.rows[0].status).toBe('BUSY');
  });

  it('should track status transitions in audit log', async () => {
    const loadAudit = await pool.query(
      `SELECT old_status, new_status
         FROM logistics.status_audit_log
        WHERE entity_type = 'loads' AND entity_id = $1
        ORDER BY changed_at`,
      [loadId],
    );

    const bidAudit = await pool.query(
      `SELECT old_status, new_status
         FROM logistics.status_audit_log
        WHERE entity_type = 'bids' AND entity_id = $1
        ORDER BY changed_at`,
      [bidId],
    );

    expect(loadAudit.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ old_status: 'POSTED', new_status: 'BIDDING' }),
        expect.objectContaining({ old_status: 'BIDDING', new_status: 'CONFIRMED' }),
      ]),
    );

    expect(bidAudit.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ old_status: 'PENDING', new_status: 'ACCEPTED' }),
      ]),
    );
  });

  it('should enforce load status state machine', async () => {
    await expect(
      pool.query(`UPDATE logistics.loads SET status = 'DRAFT' WHERE id = $1`, [loadId]),
    ).rejects.toThrow('Invalid load status transition');
  });

  it('should complete the delivery lifecycle', async () => {
    await pool.query(
      `UPDATE logistics.loads SET status = 'IN_TRANSIT' WHERE id = $1`,
      [loadId],
    );

    await pool.query(
      `UPDATE logistics.loads SET status = 'DELIVERED' WHERE id = $1`,
      [loadId],
    );

    const load = await pool.query(
      `SELECT status FROM logistics.loads WHERE id = $1`,
      [loadId],
    );

    expect(load.rows[0].status).toBe('DELIVERED');
  });
});
