-- =============================================================================
--  SEED DATA — Test users, organizations, trucks, loads for dev/staging
--  All passwords: "Password123!" (bcrypt via pgcrypto crypt())
-- =============================================================================

SET search_path TO logistics, public;

-- =============================================================================
-- 1. ORGANIZATIONS
-- =============================================================================

-- Shipper org
INSERT INTO organizations (id, name, org_type, ein, contact_email, contact_phone, is_active, verified_at, settings)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'Acme Freight Corp',
    'SHIPPER',
    '12-3456789',
    'ops@acmefreight.test',
    '+1-555-100-0001',
    TRUE,
    NOW(),
    '{"timezone": "America/Chicago"}'
) ON CONFLICT DO NOTHING;

-- Carrier org 1
INSERT INTO organizations (id, name, org_type, ein, mc_number, dot_number, contact_email, contact_phone, is_active, verified_at, settings)
VALUES (
    'b0000000-0000-0000-0000-000000000001',
    'RoadRunner Logistics',
    'CARRIER',
    '98-7654321',
    'MC-123456',
    'DOT-789012',
    'dispatch@roadrunner.test',
    '+1-555-200-0001',
    TRUE,
    NOW(),
    '{"timezone": "America/Denver"}'
) ON CONFLICT DO NOTHING;

-- Carrier org 2
INSERT INTO organizations (id, name, org_type, ein, mc_number, dot_number, contact_email, contact_phone, is_active, verified_at, settings)
VALUES (
    'b0000000-0000-0000-0000-000000000002',
    'Swift Haulers Inc',
    'CARRIER',
    '55-1234567',
    'MC-654321',
    'DOT-345678',
    'ops@swifthaulers.test',
    '+1-555-200-0002',
    TRUE,
    NOW(),
    '{"timezone": "America/New_York"}'
) ON CONFLICT DO NOTHING;


-- =============================================================================
-- 2. USERS  (password = "Password123!" for all)
-- =============================================================================

-- Platform Admin
INSERT INTO users (id, email, phone, password_hash, first_name, last_name, is_active, email_verified)
VALUES (
    'c0000000-0000-0000-0000-000000000001',
    'admin@rabbittech.test',
    '+1-555-000-0001',
    crypt('Password123!', gen_salt('bf', 12)),
    'Platform',
    'Admin',
    TRUE, TRUE
) ON CONFLICT (email) DO NOTHING;

-- Shipper Org Admin
INSERT INTO users (id, email, phone, password_hash, first_name, last_name, is_active, email_verified)
VALUES (
    'c0000000-0000-0000-0000-000000000002',
    'alice@acmefreight.test',
    '+1-555-100-0002',
    crypt('Password123!', gen_salt('bf', 12)),
    'Alice',
    'Morgan',
    TRUE, TRUE
) ON CONFLICT (email) DO NOTHING;

-- Shipper Staff
INSERT INTO users (id, email, phone, password_hash, first_name, last_name, is_active, email_verified)
VALUES (
    'c0000000-0000-0000-0000-000000000003',
    'bob@acmefreight.test',
    '+1-555-100-0003',
    crypt('Password123!', gen_salt('bf', 12)),
    'Bob',
    'Chen',
    TRUE, TRUE
) ON CONFLICT (email) DO NOTHING;

-- Carrier 1 — Org Admin (owner)
INSERT INTO users (id, email, phone, password_hash, first_name, last_name, is_active, email_verified)
VALUES (
    'c0000000-0000-0000-0000-000000000004',
    'charlie@roadrunner.test',
    '+1-555-200-0004',
    crypt('Password123!', gen_salt('bf', 12)),
    'Charlie',
    'Vega',
    TRUE, TRUE
) ON CONFLICT (email) DO NOTHING;

-- Carrier 1 — Dispatcher
INSERT INTO users (id, email, phone, password_hash, first_name, last_name, is_active, email_verified)
VALUES (
    'c0000000-0000-0000-0000-000000000005',
    'diana@roadrunner.test',
    '+1-555-200-0005',
    crypt('Password123!', gen_salt('bf', 12)),
    'Diana',
    'Patel',
    TRUE, TRUE
) ON CONFLICT (email) DO NOTHING;

-- Carrier 1 — Driver 1
INSERT INTO users (id, email, phone, password_hash, first_name, last_name, is_active, email_verified)
VALUES (
    'c0000000-0000-0000-0000-000000000006',
    'eddie@roadrunner.test',
    '+1-555-200-0006',
    crypt('Password123!', gen_salt('bf', 12)),
    'Eddie',
    'Reyes',
    TRUE, TRUE
) ON CONFLICT (email) DO NOTHING;

-- Carrier 1 — Driver 2
INSERT INTO users (id, email, phone, password_hash, first_name, last_name, is_active, email_verified)
VALUES (
    'c0000000-0000-0000-0000-000000000007',
    'fiona@roadrunner.test',
    '+1-555-200-0007',
    crypt('Password123!', gen_salt('bf', 12)),
    'Fiona',
    'Kim',
    TRUE, TRUE
) ON CONFLICT (email) DO NOTHING;

-- Carrier 2 — Org Admin
INSERT INTO users (id, email, phone, password_hash, first_name, last_name, is_active, email_verified)
VALUES (
    'c0000000-0000-0000-0000-000000000008',
    'george@swifthaulers.test',
    '+1-555-300-0008',
    crypt('Password123!', gen_salt('bf', 12)),
    'George',
    'Santos',
    TRUE, TRUE
) ON CONFLICT (email) DO NOTHING;

-- Carrier 2 — Driver
INSERT INTO users (id, email, phone, password_hash, first_name, last_name, is_active, email_verified)
VALUES (
    'c0000000-0000-0000-0000-000000000009',
    'hannah@swifthaulers.test',
    '+1-555-300-0009',
    crypt('Password123!', gen_salt('bf', 12)),
    'Hannah',
    'Okonkwo',
    TRUE, TRUE
) ON CONFLICT (email) DO NOTHING;


-- =============================================================================
-- 3. ORGANIZATION MEMBERSHIPS (RBAC)
-- =============================================================================

-- Platform Admin — technically org-less, but give them a membership for completeness
INSERT INTO organization_members (organization_id, user_id, role, is_active, joined_at)
VALUES
    ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'PLATFORM_ADMIN', TRUE, NOW())
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- Acme Freight (Shipper) members
INSERT INTO organization_members (organization_id, user_id, role, is_active, joined_at)
VALUES
    ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'ORG_ADMIN',      TRUE, NOW()),
    ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'SHIPPER_STAFF',  TRUE, NOW())
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- RoadRunner Logistics (Carrier 1) members
INSERT INTO organization_members (organization_id, user_id, role, is_active, joined_at)
VALUES
    ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', 'ORG_ADMIN',    TRUE, NOW()),
    ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'DISPATCHER',   TRUE, NOW()),
    ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000006', 'DRIVER',       TRUE, NOW()),
    ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000007', 'DRIVER',       TRUE, NOW())
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- Swift Haulers (Carrier 2) members
INSERT INTO organization_members (organization_id, user_id, role, is_active, joined_at)
VALUES
    ('b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000008', 'ORG_ADMIN',  TRUE, NOW()),
    ('b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000009', 'DRIVER',     TRUE, NOW())
ON CONFLICT (organization_id, user_id) DO NOTHING;


-- =============================================================================
-- 4. DRIVER PROFILES
-- =============================================================================

-- Eddie Reyes — RoadRunner Driver 1 (Denver area)
INSERT INTO driver_profiles (id, user_id, organization_id, cdl_number, cdl_class, cdl_state, cdl_expiry, hazmat_endorsed, tanker_endorsed, is_available, current_location)
VALUES (
    'd0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000006',
    'b0000000-0000-0000-0000-000000000001',
    'CDL-CO-100001', 'A', 'CO', '2028-06-15', TRUE, FALSE, TRUE,
    ST_SetSRID(ST_MakePoint(-104.9903, 39.7392), 4326)::geography
) ON CONFLICT DO NOTHING;

-- Fiona Kim — RoadRunner Driver 2 (Salt Lake City area)
INSERT INTO driver_profiles (id, user_id, organization_id, cdl_number, cdl_class, cdl_state, cdl_expiry, hazmat_endorsed, tanker_endorsed, is_available, current_location)
VALUES (
    'd0000000-0000-0000-0000-000000000002',
    'c0000000-0000-0000-0000-000000000007',
    'b0000000-0000-0000-0000-000000000001',
    'CDL-UT-200002', 'A', 'UT', '2027-11-30', FALSE, TRUE, TRUE,
    ST_SetSRID(ST_MakePoint(-111.8910, 40.7608), 4326)::geography
) ON CONFLICT DO NOTHING;

-- Hannah Okonkwo — Swift Haulers Driver (Atlanta area)
INSERT INTO driver_profiles (id, user_id, organization_id, cdl_number, cdl_class, cdl_state, cdl_expiry, hazmat_endorsed, tanker_endorsed, is_available, current_location)
VALUES (
    'd0000000-0000-0000-0000-000000000003',
    'c0000000-0000-0000-0000-000000000009',
    'b0000000-0000-0000-0000-000000000002',
    'CDL-GA-300003', 'A', 'GA', '2028-03-01', TRUE, TRUE, TRUE,
    ST_SetSRID(ST_MakePoint(-84.3880, 33.7490), 4326)::geography
) ON CONFLICT DO NOTHING;


-- =============================================================================
-- 5. TRUCKS
-- =============================================================================

-- RoadRunner Truck 1 — Dry Van (Denver)
INSERT INTO trucks (id, organization_id, assigned_driver_id, vin, plate_number, plate_state, make, model, year, cargo_type, length_in, width_in, height_in, payload_capacity_lbs, gross_vehicle_wt_lbs, status, insurance_expiry, current_location)
VALUES (
    'e0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'd0000000-0000-0000-0000-000000000001',
    '1HGCM82633A004352', 'CO-TRUCK1', 'CO',
    'Freightliner', 'Cascadia', 2023, 'DRY_VAN',
    636, 102, 110, 44000, 80000,
    'AVAILABLE', '2027-01-15',
    ST_SetSRID(ST_MakePoint(-104.9903, 39.7392), 4326)::geography
) ON CONFLICT DO NOTHING;

-- RoadRunner Truck 2 — Refrigerated (Salt Lake City)
INSERT INTO trucks (id, organization_id, assigned_driver_id, vin, plate_number, plate_state, make, model, year, cargo_type, length_in, width_in, height_in, payload_capacity_lbs, gross_vehicle_wt_lbs, status, insurance_expiry, current_location)
VALUES (
    'e0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000001',
    'd0000000-0000-0000-0000-000000000002',
    '2HGCM82633A005789', 'UT-TRUCK2', 'UT',
    'Kenworth', 'T680', 2024, 'REFRIGERATED',
    636, 102, 110, 42000, 80000,
    'AVAILABLE', '2027-03-20',
    ST_SetSRID(ST_MakePoint(-111.8910, 40.7608), 4326)::geography
) ON CONFLICT DO NOTHING;

-- RoadRunner Truck 3 — Flatbed (unassigned, available)
INSERT INTO trucks (id, organization_id, assigned_driver_id, vin, plate_number, plate_state, make, model, year, cargo_type, length_in, width_in, height_in, payload_capacity_lbs, gross_vehicle_wt_lbs, status, insurance_expiry, current_location)
VALUES (
    'e0000000-0000-0000-0000-000000000003',
    'b0000000-0000-0000-0000-000000000001',
    NULL,
    '3HGCM82633A006123', 'CO-TRUCK3', 'CO',
    'Peterbilt', '579', 2022, 'FLATBED',
    576, 102, 60, 48000, 80000,
    'AVAILABLE', '2027-06-10',
    ST_SetSRID(ST_MakePoint(-105.0844, 40.5853), 4326)::geography
) ON CONFLICT DO NOTHING;

-- Swift Haulers Truck 1 — Tanker (Atlanta)
INSERT INTO trucks (id, organization_id, assigned_driver_id, vin, plate_number, plate_state, make, model, year, cargo_type, length_in, width_in, height_in, payload_capacity_lbs, gross_vehicle_wt_lbs, status, insurance_expiry, current_location)
VALUES (
    'e0000000-0000-0000-0000-000000000004',
    'b0000000-0000-0000-0000-000000000002',
    'd0000000-0000-0000-0000-000000000003',
    '4HGCM82633A007456', 'GA-TRUCK1', 'GA',
    'Mack', 'Anthem', 2023, 'TANKER',
    504, 102, 96, 43000, 80000,
    'AVAILABLE', '2027-02-28',
    ST_SetSRID(ST_MakePoint(-84.3880, 33.7490), 4326)::geography
) ON CONFLICT DO NOTHING;

-- Swift Haulers Truck 2 — Dry Van (Atlanta, unassigned)
INSERT INTO trucks (id, organization_id, assigned_driver_id, vin, plate_number, plate_state, make, model, year, cargo_type, length_in, width_in, height_in, payload_capacity_lbs, gross_vehicle_wt_lbs, status, insurance_expiry, current_location)
VALUES (
    'e0000000-0000-0000-0000-000000000005',
    'b0000000-0000-0000-0000-000000000002',
    NULL,
    '5HGCM82633A008789', 'GA-TRUCK2', 'GA',
    'Volvo', 'VNL 860', 2024, 'DRY_VAN',
    636, 102, 110, 44000, 80000,
    'AVAILABLE', '2027-08-15',
    ST_SetSRID(ST_MakePoint(-84.4227, 33.6846), 4326)::geography
) ON CONFLICT DO NOTHING;


-- =============================================================================
-- 6. SAMPLE LOADS
-- =============================================================================

-- Load 1: Dry Van — Chicago → Dallas (POSTED, on load board)
INSERT INTO loads (id, shipper_org_id, posted_by, cargo_type, commodity, weight_lbs, piece_count,
    pickup_location, pickup_address, pickup_city, pickup_state, pickup_zip, pickup_earliest, pickup_latest,
    dropoff_location, dropoff_address, dropoff_city, dropoff_state, dropoff_zip, dropoff_earliest, dropoff_latest,
    distance_miles, offered_rate_usd, rate_per_mile_usd, status, load_board_visible, total_trucks_required)
VALUES (
    'f0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000003',
    'DRY_VAN', 'Electronics — palletized', 32000, 24,
    ST_SetSRID(ST_MakePoint(-87.6298, 41.8781), 4326)::geography,
    '1400 S Lake Shore Dr', 'Chicago', 'IL', '60605',
    NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 day 6 hours',
    ST_SetSRID(ST_MakePoint(-96.7970, 32.7767), 4326)::geography,
    '2500 Victory Ave', 'Dallas', 'TX', '75219',
    NOW() + INTERVAL '3 days', NOW() + INTERVAL '3 days 6 hours',
    920, 2760.00, 3.00,
    'POSTED', TRUE, 1
) ON CONFLICT DO NOTHING;

-- Load 2: Refrigerated — Denver → Phoenix (POSTED, on load board)
INSERT INTO loads (id, shipper_org_id, posted_by, cargo_type, commodity, weight_lbs, piece_count,
    pickup_location, pickup_address, pickup_city, pickup_state, pickup_zip, pickup_earliest, pickup_latest,
    dropoff_location, dropoff_address, dropoff_city, dropoff_state, dropoff_zip, dropoff_earliest, dropoff_latest,
    distance_miles, offered_rate_usd, rate_per_mile_usd, status, load_board_visible, temperature_min_f, temperature_max_f, total_trucks_required)
VALUES (
    'f0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000002',
    'REFRIGERATED', 'Frozen seafood', 28000, 18,
    ST_SetSRID(ST_MakePoint(-104.9903, 39.7392), 4326)::geography,
    '4700 Brighton Blvd', 'Denver', 'CO', '80216',
    NOW() + INTERVAL '2 days', NOW() + INTERVAL '2 days 4 hours',
    ST_SetSRID(ST_MakePoint(-112.0740, 33.4484), 4326)::geography,
    '3030 N Central Ave', 'Phoenix', 'AZ', '85012',
    NOW() + INTERVAL '4 days', NOW() + INTERVAL '4 days 4 hours',
    602, 2408.00, 4.00,
    'POSTED', TRUE, -10, 0, 1
) ON CONFLICT DO NOTHING;

-- Load 3: Flatbed — Los Angeles → Seattle (POSTED, 2 trucks needed)
INSERT INTO loads (id, shipper_org_id, posted_by, cargo_type, commodity, weight_lbs, piece_count,
    pickup_location, pickup_address, pickup_city, pickup_state, pickup_zip, pickup_earliest, pickup_latest,
    dropoff_location, dropoff_address, dropoff_city, dropoff_state, dropoff_zip, dropoff_earliest, dropoff_latest,
    distance_miles, offered_rate_usd, rate_per_mile_usd, status, load_board_visible, total_trucks_required)
VALUES (
    'f0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000003',
    'FLATBED', 'Steel beams — oversized', 88000, 4,
    ST_SetSRID(ST_MakePoint(-118.2437, 34.0522), 4326)::geography,
    '500 Mateo St', 'Los Angeles', 'CA', '90013',
    NOW() + INTERVAL '3 days', NOW() + INTERVAL '3 days 8 hours',
    ST_SetSRID(ST_MakePoint(-122.3321, 47.6062), 4326)::geography,
    '1001 4th Ave', 'Seattle', 'WA', '98154',
    NOW() + INTERVAL '5 days', NOW() + INTERVAL '5 days 8 hours',
    1135, 4540.00, 4.00,
    'POSTED', TRUE, 2
) ON CONFLICT DO NOTHING;

-- Load 4: Tanker HAZMAT — Houston → Atlanta (DRAFT, not public yet)
INSERT INTO loads (id, shipper_org_id, posted_by, cargo_type, commodity, weight_lbs,
    is_hazmat, hazmat_class, hazmat_un_number,
    pickup_location, pickup_address, pickup_city, pickup_state, pickup_zip, pickup_earliest, pickup_latest,
    dropoff_location, dropoff_address, dropoff_city, dropoff_state, dropoff_zip, dropoff_earliest, dropoff_latest,
    distance_miles, offered_rate_usd, rate_per_mile_usd, status, load_board_visible, total_trucks_required)
VALUES (
    'f0000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000002',
    'TANKER', 'Industrial solvents', 40000,
    TRUE, '3', 'UN1993',
    ST_SetSRID(ST_MakePoint(-95.3698, 29.7604), 4326)::geography,
    '8700 Manchester St', 'Houston', 'TX', '77012',
    NOW() + INTERVAL '5 days', NOW() + INTERVAL '5 days 4 hours',
    ST_SetSRID(ST_MakePoint(-84.3880, 33.7490), 4326)::geography,
    '200 Peachtree St NW', 'Atlanta', 'GA', '30303',
    NOW() + INTERVAL '7 days', NOW() + INTERVAL '7 days 4 hours',
    790, 3950.00, 5.00,
    'DRAFT', FALSE, 1
) ON CONFLICT DO NOTHING;


-- =============================================================================
-- 7. LOAD SLOTS (for multi-truck loads)
-- =============================================================================

-- Load 1 — single slot
INSERT INTO load_slots (load_id, slot_number, status) VALUES
    ('f0000000-0000-0000-0000-000000000001', 1, 'AVAILABLE')
ON CONFLICT DO NOTHING;

-- Load 2 — single slot
INSERT INTO load_slots (load_id, slot_number, status) VALUES
    ('f0000000-0000-0000-0000-000000000002', 1, 'AVAILABLE')
ON CONFLICT DO NOTHING;

-- Load 3 — two slots (needs 2 trucks)
INSERT INTO load_slots (load_id, slot_number, status) VALUES
    ('f0000000-0000-0000-0000-000000000003', 1, 'AVAILABLE'),
    ('f0000000-0000-0000-0000-000000000003', 2, 'AVAILABLE')
ON CONFLICT DO NOTHING;

-- Load 4 — single slot
INSERT INTO load_slots (load_id, slot_number, status) VALUES
    ('f0000000-0000-0000-0000-000000000004', 1, 'AVAILABLE')
ON CONFLICT DO NOTHING;


-- =============================================================================
-- DONE — Print summary
-- =============================================================================
DO $$
BEGIN
    RAISE NOTICE '══════════════════════════════════════════════════════';
    RAISE NOTICE '  SEED DATA LOADED SUCCESSFULLY';
    RAISE NOTICE '══════════════════════════════════════════════════════';
    RAISE NOTICE '  Organizations : 3 (1 shipper, 2 carriers)';
    RAISE NOTICE '  Users         : 9';
    RAISE NOTICE '  Drivers       : 3';
    RAISE NOTICE '  Trucks        : 5';
    RAISE NOTICE '  Loads         : 4 (3 POSTED, 1 DRAFT)';
    RAISE NOTICE '  Load Slots    : 5';
    RAISE NOTICE '══════════════════════════════════════════════════════';
    RAISE NOTICE '  ALL PASSWORDS : Password123!';
    RAISE NOTICE '══════════════════════════════════════════════════════';
    RAISE NOTICE '  Login accounts:';
    RAISE NOTICE '    admin@rabbittech.test    (PLATFORM_ADMIN)';
    RAISE NOTICE '    alice@acmefreight.test   (ORG_ADMIN - shipper)';
    RAISE NOTICE '    bob@acmefreight.test     (SHIPPER_STAFF)';
    RAISE NOTICE '    charlie@roadrunner.test  (ORG_ADMIN - carrier)';
    RAISE NOTICE '    diana@roadrunner.test    (DISPATCHER)';
    RAISE NOTICE '    eddie@roadrunner.test    (DRIVER)';
    RAISE NOTICE '    fiona@roadrunner.test    (DRIVER)';
    RAISE NOTICE '    george@swifthaulers.test (ORG_ADMIN - carrier)';
    RAISE NOTICE '    hannah@swifthaulers.test (DRIVER)';
    RAISE NOTICE '══════════════════════════════════════════════════════';
END;
$$;
