-- =============================================================================
--  UBER FOR TRUCKING — Production PostgreSQL Schema
--  Database: PostgreSQL 16+  |  Extensions: PostGIS 3.x, pgcrypto
--
--  Architecture Layers
--  ───────────────────
--  1. Extensions & Schema Bootstrap
--  2. Domain ENUMs
--  3. Multi-Tenant Identity  (organizations, users, memberships)
--  4. Asset Management       (trucks, driver_profiles)
--  5. Load Management        (loads)
--  6. Matching Engine        (bids, assignments)
--  7. Audit & Telemetry      (status_audit_log, telemetry_logs — partitioned)
--  8. GIST / B-Tree Indexes
--  9. PL/pgSQL Triggers & Functions
-- 10. Row-Level Security (RLS)
-- 11. Geospatial Utility Functions
-- 12. Partition Management Helper
--
--  Application Contract
--  ───────────────────
--  All app-layer DB connections MUST set the session variable before any DML:
--    SET LOCAL app.current_user_id = '<uuid>';
--  Triggers and RLS policies read this via:
--    current_setting('app.current_user_id', TRUE)::UUID
-- =============================================================================


-- =============================================================================
-- 1.  EXTENSIONS & SCHEMA BOOTSTRAP
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;       -- Geospatial types & operators
CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- gen_random_uuid(), crypt()
CREATE EXTENSION IF NOT EXISTS btree_gist;    -- GiST support for range exclusion

CREATE SCHEMA IF NOT EXISTS logistics;
SET search_path TO logistics, public;


-- =============================================================================
-- 2.  DOMAIN ENUMs
-- =============================================================================

-- Organization classification
CREATE TYPE org_type AS ENUM (
    'SHIPPER',          -- company that books freight
    'CARRIER'           -- company that owns trucks / employs drivers
);

-- User roles within an organization (fine-grained RBAC)
CREATE TYPE user_role AS ENUM (
    'PLATFORM_ADMIN',   -- SaaS super-admin
    'ORG_ADMIN',        -- owner/admin of a specific org
    'DISPATCHER',       -- carrier dispatcher managing drivers
    'DRIVER',           -- CDL driver operating a truck
    'SHIPPER_STAFF'     -- shipper employee creating loads
);

-- Physical truck availability
CREATE TYPE truck_status AS ENUM (
    'AVAILABLE',
    'BUSY',
    'MAINTENANCE',
    'DECOMMISSIONED'
);

-- Freight commodity categories matching FMCSA classifications
CREATE TYPE cargo_type AS ENUM (
    'DRY_VAN',
    'REFRIGERATED',
    'FLATBED',
    'TANKER',
    'HAZMAT',
    'OVERSIZED',
    'INTERMODAL',
    'CURTAIN_SIDE',
    'LOWBOY'
);

-- Load lifecycle state machine
-- Valid transitions:
--   DRAFT → POSTED → BIDDING → CONFIRMED → IN_TRANSIT → DELIVERED
--   Any non-terminal state → CANCELLED
--   DELIVERED / IN_TRANSIT → DISPUTED
CREATE TYPE load_status AS ENUM (
    'DRAFT',
    'POSTED',
    'BIDDING',
    'CONFIRMED',
    'IN_TRANSIT',
    'DELIVERED',
    'CANCELLED',
    'DISPUTED'
);

-- Bid negotiation state
CREATE TYPE bid_status AS ENUM (
    'PENDING',
    'ACCEPTED',
    'REJECTED',
    'WITHDRAWN',
    'COUNTERED',
    'EXPIRED'
);

-- Assignment lifecycle
CREATE TYPE assignment_status AS ENUM (
    'ACTIVE',
    'COMPLETED',
    'CANCELLED',
    'DISPUTED'
);

-- Double-entry ledger entry direction
CREATE TYPE ledger_entry_direction AS ENUM (
    'DEBIT',
    'CREDIT'
);


-- =============================================================================
-- 3.  MULTI-TENANT IDENTITY
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Organizations  (tenant root)
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    org_type        org_type    NOT NULL,

    -- Regulatory identifiers
    ein             TEXT        UNIQUE,                -- Employer Identification Number
    mc_number       TEXT        UNIQUE,                -- FMCSA Motor Carrier #  (carriers only)
    dot_number      TEXT        UNIQUE,                -- USDOT #                (carriers only)

    logo_url        TEXT,
    contact_email   TEXT        NOT NULL,
    contact_phone   TEXT,
    billing_address JSONB,                             -- {street, city, state, zip, country}

    -- Feature flags / tenant settings stored here to avoid wide schema changes
    settings        JSONB       NOT NULL DEFAULT '{}',

    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    verified_at     TIMESTAMPTZ,                       -- KYB/KYC verification timestamp
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Carriers must have an MC number before they can be verified
    CONSTRAINT chk_carrier_requires_mc
        CHECK (org_type != 'CARRIER' OR mc_number IS NOT NULL)
);

CREATE INDEX idx_org_type     ON organizations (org_type);
CREATE INDEX idx_org_active   ON organizations (is_active) WHERE is_active = TRUE;


-- ---------------------------------------------------------------------------
-- Users  (global; a person can belong to >1 org via memberships)
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT        NOT NULL UNIQUE,
    phone           TEXT        UNIQUE,

    -- Store bcrypt hash — never plaintext
    password_hash   TEXT        NOT NULL,

    first_name      TEXT        NOT NULL,
    last_name       TEXT        NOT NULL,
    avatar_url      TEXT,

    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    email_verified  BOOLEAN     NOT NULL DEFAULT FALSE,
    phone_verified  BOOLEAN     NOT NULL DEFAULT FALSE,
    last_login_at   TIMESTAMPTZ,

    -- Extensible: push notification tokens, preferences, etc.
    metadata        JSONB       NOT NULL DEFAULT '{}',

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email  ON users (email);
CREATE INDEX idx_users_active ON users (is_active) WHERE is_active = TRUE;


-- ---------------------------------------------------------------------------
-- Organization Memberships  (RBAC bridge — one row per user-per-org-per-role)
-- ---------------------------------------------------------------------------
CREATE TABLE organization_members (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    user_id         UUID        NOT NULL REFERENCES users (id)         ON DELETE CASCADE,

    role            user_role   NOT NULL,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    invited_by      UUID        REFERENCES users (id),
    joined_at       TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A user holds exactly one role per organization
    UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_org_members_user ON organization_members (user_id);
CREATE INDEX idx_org_members_org  ON organization_members (organization_id);
CREATE INDEX idx_org_members_role ON organization_members (role);


-- =============================================================================
-- 4.  ASSET MANAGEMENT
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Driver Profiles  (extends users with CDL / compliance attributes)
-- ---------------------------------------------------------------------------
CREATE TABLE driver_profiles (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL UNIQUE REFERENCES users (id)          ON DELETE CASCADE,
    organization_id     UUID        NOT NULL        REFERENCES organizations (id)  ON DELETE CASCADE,

    -- CDL details
    cdl_number          TEXT        NOT NULL UNIQUE,
    cdl_class           CHAR(1)     NOT NULL CHECK (cdl_class IN ('A', 'B', 'C')),
    cdl_state           CHAR(2)     NOT NULL,
    cdl_expiry          DATE        NOT NULL,

    -- Federal endorsements
    hazmat_endorsed     BOOLEAN     NOT NULL DEFAULT FALSE,
    tanker_endorsed     BOOLEAN     NOT NULL DEFAULT FALSE,
    doubles_triples     BOOLEAN     NOT NULL DEFAULT FALSE,
    passenger_endorsed  BOOLEAN     NOT NULL DEFAULT FALSE,

    is_available        BOOLEAN     NOT NULL DEFAULT TRUE,

    -- Real-time driver position (updated by mobile SDK)
    current_location    GEOGRAPHY(POINT, 4326),
    location_updated_at TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Supports composite FKs that validate a driver belongs to a carrier org
    UNIQUE (id, organization_id)
);

CREATE INDEX idx_driver_org      ON driver_profiles (organization_id);
CREATE INDEX idx_driver_location ON driver_profiles USING GIST (current_location);
CREATE INDEX idx_driver_avail    ON driver_profiles (is_available) WHERE is_available = TRUE;


-- ---------------------------------------------------------------------------
-- Trucks  (physical assets owned by carrier organizations)
-- ---------------------------------------------------------------------------
CREATE TABLE trucks (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       UUID          NOT NULL REFERENCES organizations (id)    ON DELETE CASCADE,
    assigned_driver_id    UUID          REFERENCES driver_profiles (id)            ON DELETE SET NULL,

    -- Regulatory identifiers
    vin                   TEXT          NOT NULL UNIQUE,
    plate_number          TEXT          NOT NULL,
    plate_state           CHAR(2)       NOT NULL,

    -- Physical description
    make                  TEXT          NOT NULL,
    model                 TEXT          NOT NULL,
    year                  SMALLINT      NOT NULL
        CHECK (year >= 1980 AND year <= EXTRACT(YEAR FROM NOW())::SMALLINT + 1),

    cargo_type            cargo_type    NOT NULL,

    -- Dimensions stored in US customary units (inches)
    length_in             NUMERIC(8,2)  NOT NULL CHECK (length_in  > 0),
    width_in              NUMERIC(8,2)  NOT NULL CHECK (width_in   > 0),
    height_in             NUMERIC(8,2)  NOT NULL CHECK (height_in  > 0),

    -- Weight capacity in pounds
    payload_capacity_lbs  NUMERIC(10,2) NOT NULL CHECK (payload_capacity_lbs > 0),
    gross_vehicle_wt_lbs  NUMERIC(10,2) NOT NULL CHECK (gross_vehicle_wt_lbs > 0),

    -- Operational state
    status                truck_status  NOT NULL DEFAULT 'AVAILABLE',

    -- Compliance
    last_inspection_date  DATE,
    insurance_expiry      DATE          NOT NULL,
    registration_expiry   DATE,

    -- Real-time position (updated by ELD / mobile SDK)
    current_location      GEOGRAPHY(POINT, 4326),
    location_updated_at   TIMESTAMPTZ,

    notes                 TEXT,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- Supports composite FKs that validate a truck belongs to a carrier org
    UNIQUE (id, organization_id),

    CONSTRAINT fk_trucks_assigned_driver_org
        FOREIGN KEY (assigned_driver_id, organization_id)
        REFERENCES driver_profiles (id, organization_id)
        DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX idx_trucks_org           ON trucks (organization_id);
CREATE INDEX idx_trucks_status        ON trucks (status);
CREATE INDEX idx_trucks_cargo         ON trucks (cargo_type);
CREATE INDEX idx_trucks_location      ON trucks USING GIST (current_location);
-- Covering index optimised for the matching engine hot path
CREATE INDEX idx_trucks_avail_cargo   ON trucks (cargo_type, payload_capacity_lbs)
    WHERE status = 'AVAILABLE';


-- =============================================================================
-- 5.  GEOSPATIAL LOAD MANAGEMENT
-- =============================================================================

CREATE TABLE loads (
    id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    shipper_org_id       UUID          NOT NULL REFERENCES organizations (id),
    posted_by            UUID          NOT NULL REFERENCES users (id),

    -- Human-readable reference for ops / customer support
    reference_number     TEXT          UNIQUE DEFAULT 'LD-' || UPPER(SUBSTRING(gen_random_uuid()::TEXT, 1, 8)),

    -- ── Cargo Details ──────────────────────────────────────────────────────
    cargo_type           cargo_type    NOT NULL,
    commodity            TEXT          NOT NULL,
    weight_lbs           NUMERIC(10,2) NOT NULL CHECK (weight_lbs > 0),
    dimensions           JSONB,                       -- {length_in, width_in, height_in}
    piece_count          INTEGER       CHECK (piece_count > 0),

    is_hazmat            BOOLEAN       NOT NULL DEFAULT FALSE,
    hazmat_class         TEXT,                        -- UN hazmat class (1-9)
    hazmat_un_number     TEXT,

    -- Required for REFRIGERATED cargo_type
    temperature_min_f    NUMERIC(6,2),
    temperature_max_f    NUMERIC(6,2),

    -- ── Pickup ─────────────────────────────────────────────────────────────
    pickup_location      GEOGRAPHY(POINT, 4326) NOT NULL,
    pickup_address       TEXT          NOT NULL,
    pickup_city          TEXT          NOT NULL,
    pickup_state         CHAR(2)       NOT NULL,
    pickup_zip           TEXT          NOT NULL,
    pickup_earliest      TIMESTAMPTZ   NOT NULL,
    pickup_latest        TIMESTAMPTZ   NOT NULL,
    pickup_instructions  TEXT,
    pickup_contact_name  TEXT,
    pickup_contact_phone TEXT,

    -- ── Delivery ───────────────────────────────────────────────────────────
    dropoff_location     GEOGRAPHY(POINT, 4326) NOT NULL,
    dropoff_address      TEXT          NOT NULL,
    dropoff_city         TEXT          NOT NULL,
    dropoff_state        CHAR(2)       NOT NULL,
    dropoff_zip          TEXT          NOT NULL,
    dropoff_earliest     TIMESTAMPTZ   NOT NULL,
    dropoff_latest       TIMESTAMPTZ   NOT NULL,
    dropoff_instructions TEXT,
    dropoff_contact_name  TEXT,
    dropoff_contact_phone TEXT,

    -- ── Logistics Metadata ─────────────────────────────────────────────────
    -- Populated by app on POST (via mapping API) or a trigger
    distance_miles       NUMERIC(8,2),

    -- ── Pricing ────────────────────────────────────────────────────────────
    offered_rate_usd     NUMERIC(12,2) CHECK (offered_rate_usd > 0),
    final_rate_usd       NUMERIC(12,2) CHECK (final_rate_usd   > 0),
    rate_per_mile_usd    NUMERIC(8,4)  CHECK (rate_per_mile_usd > 0),

    -- ── State Machine ──────────────────────────────────────────────────────
    status               load_status   NOT NULL DEFAULT 'DRAFT',

    -- Visibility control: only POSTED + visible loads show on the load board
    load_board_visible   BOOLEAN       NOT NULL DEFAULT FALSE,
    expires_at           TIMESTAMPTZ,

    special_requirements TEXT[],
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- Integrity guards
    CONSTRAINT chk_pickup_window
        CHECK (pickup_latest > pickup_earliest),
    CONSTRAINT chk_dropoff_window
        CHECK (dropoff_latest > dropoff_earliest),
    CONSTRAINT chk_hazmat_class
        CHECK (is_hazmat = FALSE OR hazmat_class IS NOT NULL),
    CONSTRAINT chk_temp_range
        CHECK (
            temperature_min_f IS NULL
            OR temperature_max_f IS NULL
            OR temperature_max_f >= temperature_min_f
        )
);

-- Geospatial indexes — power ST_DWithin radius queries in the matching engine
CREATE INDEX idx_loads_pickup_geo   ON loads USING GIST (pickup_location);
CREATE INDEX idx_loads_dropoff_geo  ON loads USING GIST (dropoff_location);

-- Range & filter indexes
CREATE INDEX idx_loads_status       ON loads (status);
CREATE INDEX idx_loads_shipper      ON loads (shipper_org_id);
CREATE INDEX idx_loads_cargo        ON loads (cargo_type);
CREATE INDEX idx_loads_pickup_win   ON loads (pickup_earliest, pickup_latest);

-- Hot-path index for the public load board query
CREATE INDEX idx_loads_board        ON loads (status, expires_at)
    WHERE status = 'POSTED' AND load_board_visible = TRUE;


-- =============================================================================
-- 6.  MATCHING ENGINE  — Bids & Assignments
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Bids  (carrier negotiates price with shipper)
-- ---------------------------------------------------------------------------
CREATE TABLE bids (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    load_id           UUID          NOT NULL REFERENCES loads (id)          ON DELETE CASCADE,
    carrier_org_id    UUID          NOT NULL REFERENCES organizations (id),
    bidding_driver_id UUID          REFERENCES driver_profiles (id),
    truck_id          UUID          REFERENCES trucks (id),

    bid_amount_usd    NUMERIC(12,2) NOT NULL CHECK (bid_amount_usd > 0),
    rate_per_mile_usd NUMERIC(8,4),
    pickup_eta        TIMESTAMPTZ,
    delivery_eta      TIMESTAMPTZ,

    notes             TEXT,

    -- Negotiation state
    status            bid_status    NOT NULL DEFAULT 'PENDING',
    counter_offer_usd NUMERIC(12,2) CHECK (counter_offer_usd > 0),
    responded_at      TIMESTAMPTZ,
    expires_at        TIMESTAMPTZ,

    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- One active bid slot per carrier per load
    UNIQUE (load_id, carrier_org_id),

    -- Supports composite assignment FK that guarantees bid/load/carrier consistency
    UNIQUE (id, load_id, carrier_org_id),

    CONSTRAINT fk_bids_driver_org
        FOREIGN KEY (bidding_driver_id, carrier_org_id)
        REFERENCES driver_profiles (id, organization_id)
        DEFERRABLE INITIALLY IMMEDIATE,

    CONSTRAINT fk_bids_truck_org
        FOREIGN KEY (truck_id, carrier_org_id)
        REFERENCES trucks (id, organization_id)
        DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX idx_bids_load    ON bids (load_id);
CREATE INDEX idx_bids_carrier ON bids (carrier_org_id);
CREATE INDEX idx_bids_status  ON bids (status);
CREATE INDEX idx_bids_driver  ON bids (bidding_driver_id);


-- ---------------------------------------------------------------------------
-- Bid Invitations  (matching engine → carrier dispatcher notifications)
-- ---------------------------------------------------------------------------
CREATE TABLE bid_invitations (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    load_id           UUID        NOT NULL REFERENCES loads (id)          ON DELETE CASCADE,
    truck_id          UUID        NOT NULL REFERENCES trucks (id)         ON DELETE CASCADE,
    carrier_org_id    UUID        NOT NULL REFERENCES organizations (id),
    driver_id         UUID        REFERENCES driver_profiles (id),
    distance_miles    NUMERIC(10,2),
    match_score       NUMERIC(6,2),
    status            TEXT        NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','VIEWED','BID_PLACED','DECLINED','EXPIRED')),
    viewed_at         TIMESTAMPTZ,
    responded_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One invitation per truck per load
    UNIQUE (load_id, truck_id)
);

CREATE INDEX idx_bid_inv_load    ON bid_invitations (load_id);
CREATE INDEX idx_bid_inv_carrier ON bid_invitations (carrier_org_id);
CREATE INDEX idx_bid_inv_status  ON bid_invitations (status) WHERE status = 'PENDING';


-- ---------------------------------------------------------------------------
-- Assignments  (accepted bid → binding assignment)
-- ---------------------------------------------------------------------------
CREATE TABLE assignments (
    id                UUID              PRIMARY KEY DEFAULT gen_random_uuid(),

    -- One load has exactly one active assignment
    load_id           UUID              NOT NULL UNIQUE REFERENCES loads (id),
    bid_id            UUID              NOT NULL UNIQUE,

    carrier_org_id    UUID              NOT NULL REFERENCES organizations   (id),
    driver_id         UUID              NOT NULL,
    truck_id          UUID              NOT NULL,

    -- Assignment window copied from the load for exclusion-based overlap safety
    scheduled_window  TSTZRANGE         NOT NULL,

    agreed_rate_usd   NUMERIC(12,2)     NOT NULL CHECK (agreed_rate_usd > 0),

    -- ── Milestone Timestamps ───────────────────────────────────────────────
    assigned_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    dispatched_at       TIMESTAMPTZ,
    pickup_arrived_at   TIMESTAMPTZ,
    picked_up_at        TIMESTAMPTZ,
    dropoff_arrived_at  TIMESTAMPTZ,
    delivered_at        TIMESTAMPTZ,

    status              assignment_status NOT NULL DEFAULT 'ACTIVE',

    -- ── Proof of Delivery ─────────────────────────────────────────────────
    pod_signature_url   TEXT,
    pod_photos          TEXT[],                  -- Array of S3/CDN URLs
    pod_notes           TEXT,

    -- ── Bilateral Ratings ─────────────────────────────────────────────────
    shipper_rating      SMALLINT        CHECK (shipper_rating BETWEEN 1 AND 5),
    carrier_rating      SMALLINT        CHECK (carrier_rating BETWEEN 1 AND 5),
    shipper_review      TEXT,
    carrier_review      TEXT,

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_assignments_bid_triplet
        FOREIGN KEY (bid_id, load_id, carrier_org_id)
        REFERENCES bids (id, load_id, carrier_org_id)
        DEFERRABLE INITIALLY IMMEDIATE,

    CONSTRAINT fk_assignments_driver_org
        FOREIGN KEY (driver_id, carrier_org_id)
        REFERENCES driver_profiles (id, organization_id)
        DEFERRABLE INITIALLY IMMEDIATE,

    CONSTRAINT fk_assignments_truck_org
        FOREIGN KEY (truck_id, carrier_org_id)
        REFERENCES trucks (id, organization_id)
        DEFERRABLE INITIALLY IMMEDIATE,

    -- Concurrency-safe guard: same driver cannot hold overlapping active windows
    CONSTRAINT ex_assignments_driver_active_window
        EXCLUDE USING GIST (
            driver_id WITH =,
            scheduled_window WITH &&
        )
        WHERE (status = 'ACTIVE')
);

CREATE INDEX idx_asgn_load           ON assignments (load_id);
CREATE INDEX idx_asgn_driver         ON assignments (driver_id);
CREATE INDEX idx_asgn_carrier        ON assignments (carrier_org_id);
CREATE INDEX idx_asgn_truck          ON assignments (truck_id);
CREATE INDEX idx_asgn_status         ON assignments (status);
-- Partial index: fast look-up to enforce the overlap guard
CREATE INDEX idx_asgn_active_driver  ON assignments (driver_id) WHERE status = 'ACTIVE';


-- =============================================================================
-- 6.5 FINANCIAL LEDGER (Double-Entry, Immutable Journal)
-- =============================================================================

CREATE TABLE ledger_accounts (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID        REFERENCES organizations (id),
    account_code    TEXT        NOT NULL,
    account_name    TEXT        NOT NULL,
    currency_code   CHAR(3)     NOT NULL DEFAULT 'USD',
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (organization_id, account_code)
);

CREATE TABLE ledger_journals (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key  TEXT        NOT NULL UNIQUE,
    load_id          UUID        REFERENCES loads (id),
    assignment_id    UUID        REFERENCES assignments (id),
    description      TEXT        NOT NULL,
    created_by       UUID        REFERENCES users (id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    posted_at        TIMESTAMPTZ
);

CREATE TABLE ledger_entries (
    id               BIGSERIAL   PRIMARY KEY,
    journal_id       UUID        NOT NULL REFERENCES ledger_journals (id) ON DELETE CASCADE,
    account_id       UUID        NOT NULL REFERENCES ledger_accounts (id),
    direction        ledger_entry_direction NOT NULL,
    amount_cents     BIGINT      NOT NULL CHECK (amount_cents > 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledger_entries_journal ON ledger_entries (journal_id);
CREATE INDEX idx_ledger_entries_account ON ledger_entries (account_id);

CREATE OR REPLACE FUNCTION fn_validate_balanced_journal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = logistics, public
AS $$
DECLARE
    v_journal_id UUID;
    v_debits     BIGINT;
    v_credits    BIGINT;
BEGIN
    v_journal_id := COALESCE(NEW.journal_id, OLD.journal_id);

    SELECT COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'DEBIT'), 0),
           COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'CREDIT'), 0)
      INTO v_debits, v_credits
      FROM ledger_entries
     WHERE journal_id = v_journal_id;

    IF v_debits <> v_credits THEN
        RAISE EXCEPTION
            'Unbalanced journal %: debits=% credits=%',
            v_journal_id,
            v_debits,
            v_credits
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER trg_validate_balanced_journal
    AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION fn_validate_balanced_journal();


-- =============================================================================
-- 6.8  NOTIFICATIONS & DEVICE TOKENS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- User Device Tokens  (FCM/APNs registration for push notifications)
-- ---------------------------------------------------------------------------
CREATE TABLE user_device_tokens (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    device_token  TEXT        NOT NULL,
    platform      TEXT        NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    active        BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (user_id, device_token)
);

CREATE INDEX idx_device_tokens_user ON user_device_tokens (user_id) WHERE active = TRUE;


-- =============================================================================
-- 7.  AUDIT & TELEMETRY
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Status Audit Log  (append-only; never UPDATE or DELETE rows here)
-- ---------------------------------------------------------------------------
CREATE TABLE status_audit_log (
    id          BIGSERIAL   PRIMARY KEY,
    entity_type TEXT        NOT NULL,   -- 'loads' | 'bids' | 'assignments' | 'trucks'
    entity_id   UUID        NOT NULL,
    old_status  TEXT,
    new_status  TEXT        NOT NULL,
    changed_by  UUID        REFERENCES users (id),
    change_reason TEXT,
    metadata    JSONB       NOT NULL DEFAULT '{}',
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_entity     ON status_audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_changed_at ON status_audit_log (changed_at DESC);
CREATE INDEX idx_audit_changed_by ON status_audit_log (changed_by);


-- ---------------------------------------------------------------------------
-- Telemetry Logs  (GPS pings from trucks/drivers — RANGE partitioned by month)
--
-- Partitioning rationale:
--   - High-volume inserts (up to ~100 pings/truck/minute at scale)
--   - Queries are almost always time-bounded ("last 24 h", "trip window")
--   - Old partitions can be dropped/archived without locking the parent table
-- ---------------------------------------------------------------------------
CREATE TABLE telemetry_logs (
    id              BIGSERIAL,
    truck_id        UUID          NOT NULL,          -- No FK on partitioned table for perf
    driver_id       UUID,
    assignment_id   UUID,

    -- PostGIS point (WGS-84)
    location        GEOGRAPHY(POINT, 4326) NOT NULL,
    altitude_m      NUMERIC(8,2),
    speed_kmh       NUMERIC(6,2)  CHECK (speed_kmh >= 0),
    heading_deg     NUMERIC(5,2)  CHECK (heading_deg >= 0 AND heading_deg < 360),
    accuracy_m      NUMERIC(6,2)  CHECK (accuracy_m >= 0),

    -- Engine telemetry (from ELD if available)
    engine_on       BOOLEAN,
    fuel_level_pct  NUMERIC(5,2)  CHECK (fuel_level_pct BETWEEN 0 AND 100),
    odometer_km     NUMERIC(12,2) CHECK (odometer_km >= 0),

    -- Raw payload for debugging / future re-processing
    raw_payload     JSONB,

    -- Times
    recorded_at     TIMESTAMPTZ   NOT NULL,          -- Device clock (partition key)
    received_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, recorded_at)   -- Partition key must be in PK
) PARTITION BY RANGE (recorded_at);

-- ── Global indexes on the partitioned table (PostgreSQL propagates to children)
CREATE INDEX idx_telem_truck      ON telemetry_logs (truck_id,      recorded_at DESC);
CREATE INDEX idx_telem_assignment ON telemetry_logs (assignment_id, recorded_at DESC)
    WHERE assignment_id IS NOT NULL;
CREATE INDEX idx_telem_location   ON telemetry_logs USING GIST (location);

-- ── Monthly partitions 2026 ────────────────────────────────────────────────
CREATE TABLE telemetry_logs_2026_01 PARTITION OF telemetry_logs
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE telemetry_logs_2026_02 PARTITION OF telemetry_logs
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE telemetry_logs_2026_03 PARTITION OF telemetry_logs
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE telemetry_logs_2026_04 PARTITION OF telemetry_logs
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE telemetry_logs_2026_05 PARTITION OF telemetry_logs
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE telemetry_logs_2026_06 PARTITION OF telemetry_logs
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE telemetry_logs_2026_07 PARTITION OF telemetry_logs
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE telemetry_logs_2026_08 PARTITION OF telemetry_logs
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE telemetry_logs_2026_09 PARTITION OF telemetry_logs
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE telemetry_logs_2026_10 PARTITION OF telemetry_logs
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE telemetry_logs_2026_11 PARTITION OF telemetry_logs
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE telemetry_logs_2026_12 PARTITION OF telemetry_logs
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- ── Monthly partitions 2027 (pre-created; use fn_create_telemetry_partition for future)
CREATE TABLE telemetry_logs_2027_01 PARTITION OF telemetry_logs
    FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE telemetry_logs_2027_02 PARTITION OF telemetry_logs
    FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE telemetry_logs_2027_03 PARTITION OF telemetry_logs
    FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');


-- =============================================================================
-- 8.  SHARED UTILITY: updated_at TRIGGER FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

-- Attach to every mutable table
CREATE TRIGGER trg_organizations_upd
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_users_upd
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_driver_profiles_upd
    BEFORE UPDATE ON driver_profiles
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_trucks_upd
    BEFORE UPDATE ON trucks
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_loads_upd
    BEFORE UPDATE ON loads
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_bids_upd
    BEFORE UPDATE ON bids
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_assignments_upd
    BEFORE UPDATE ON assignments
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- =============================================================================
-- 9.  PL/pgSQL TRIGGERS — Business Logic & Data Integrity
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TRIGGER 1: Status-change audit logger
--
-- Fires AFTER UPDATE on loads, bids, assignments, trucks whenever the status
-- column changes.  Writes an immutable row to status_audit_log.
--
-- The actor UUID is read from the session variable app.current_user_id, which
-- the application layer MUST set at the start of every transaction:
--   SET LOCAL app.current_user_id = '<uuid>';
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = logistics, pg_catalog
AS $$
DECLARE
    v_actor_id UUID;
BEGIN
    -- Silently accept missing session variable (background jobs, migrations)
    BEGIN
        v_actor_id := current_setting('app.current_user_id', TRUE)::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_actor_id := NULL;
    END;

    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO status_audit_log (
            entity_type,
            entity_id,
            old_status,
            new_status,
            changed_by,
            metadata
        ) VALUES (
            TG_TABLE_NAME,
            NEW.id,
            OLD.status::TEXT,
            NEW.status::TEXT,
            v_actor_id,
            jsonb_build_object(
                'schema',     TG_TABLE_SCHEMA,
                'table',      TG_TABLE_NAME,
                'op',         TG_OP,
                'changed_at', NOW()
            )
        );
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_loads_status_audit
    AFTER UPDATE ON loads
    FOR EACH ROW EXECUTE FUNCTION fn_audit_status_change();

CREATE TRIGGER trg_bids_status_audit
    AFTER UPDATE ON bids
    FOR EACH ROW EXECUTE FUNCTION fn_audit_status_change();

CREATE TRIGGER trg_assignments_status_audit
    AFTER UPDATE ON assignments
    FOR EACH ROW EXECUTE FUNCTION fn_audit_status_change();

CREATE TRIGGER trg_trucks_status_audit
    AFTER UPDATE ON trucks
    FOR EACH ROW EXECUTE FUNCTION fn_audit_status_change();

-- Hard block any mutation to audit rows after insert.
CREATE OR REPLACE FUNCTION fn_block_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'status_audit_log is immutable and does not allow % operations', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER trg_block_audit_updates
    BEFORE UPDATE ON status_audit_log
    FOR EACH ROW EXECUTE FUNCTION fn_block_audit_mutation();

CREATE TRIGGER trg_block_audit_deletes
    BEFORE DELETE ON status_audit_log
    FOR EACH ROW EXECUTE FUNCTION fn_block_audit_mutation();


-- ---------------------------------------------------------------------------
-- TRIGGER 1.5: Enforce legal load status transitions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_enforce_load_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = logistics, public
AS $$
BEGIN
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
        (OLD.status = 'DRAFT'      AND NEW.status IN ('POSTED', 'CANCELLED')) OR
        (OLD.status = 'POSTED'     AND NEW.status IN ('BIDDING', 'CANCELLED')) OR
        (OLD.status = 'BIDDING'    AND NEW.status IN ('CONFIRMED', 'CANCELLED')) OR
        (OLD.status = 'CONFIRMED'  AND NEW.status IN ('IN_TRANSIT', 'CANCELLED')) OR
        (OLD.status = 'IN_TRANSIT' AND NEW.status IN ('DELIVERED', 'DISPUTED', 'CANCELLED')) OR
        (OLD.status = 'DELIVERED'  AND NEW.status IN ('DISPUTED'))
    ) THEN
        RAISE EXCEPTION
            'Invalid load status transition: % -> % for load %',
            OLD.status,
            NEW.status,
            NEW.id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_load_status_transition
    BEFORE UPDATE OF status ON loads
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION fn_enforce_load_status_transition();


-- ---------------------------------------------------------------------------
-- TRIGGER 1.6: Derive assignment scheduling window from load time window
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_assignment_window()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = logistics, public
AS $$
DECLARE
    v_pickup_earliest TIMESTAMPTZ;
    v_dropoff_latest  TIMESTAMPTZ;
BEGIN
    SELECT pickup_earliest, dropoff_latest
      INTO v_pickup_earliest, v_dropoff_latest
      FROM loads
     WHERE id = NEW.load_id;

    IF v_pickup_earliest IS NULL OR v_dropoff_latest IS NULL THEN
        RAISE EXCEPTION 'Unable to derive scheduling window for load %', NEW.load_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    NEW.scheduled_window := tstzrange(v_pickup_earliest, v_dropoff_latest, '[)');
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assignments_set_window
    BEFORE INSERT OR UPDATE OF load_id ON assignments
    FOR EACH ROW EXECUTE FUNCTION fn_set_assignment_window();


-- ---------------------------------------------------------------------------
-- TRIGGER 2: Prevent overlapping driver assignments
--
-- Fires BEFORE INSERT OR UPDATE on assignments.
-- Uses the classic interval-overlap predicate:
--   A.start < B.end  AND  A.end > B.start
-- where the window is [pickup_earliest .. dropoff_latest] from loads.
--
-- Why BEFORE trigger:   we abort the INSERT/UPDATE before any row is written,
--                       avoiding ghost rows that leak through concurrent inserts.
-- Concurrency safety:   the UNIQUE constraint on assignments.load_id plus the
--                       partial index on (driver_id) WHERE status='ACTIVE' keeps
--                       concurrent admission to O(n) for a given driver.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prevent_driver_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = logistics, public
AS $$
DECLARE
    v_conflict_count   INTEGER;
BEGIN
    -- Serialize assignment checks for one driver to reduce race windows.
    PERFORM 1
      FROM driver_profiles
     WHERE id = NEW.driver_id
     FOR UPDATE;

    -- Count active assignments for this driver whose load window overlaps
    SELECT COUNT(*)
      INTO v_conflict_count
      FROM assignments a
     WHERE a.driver_id = NEW.driver_id
       AND a.status    = 'ACTIVE'
       AND a.id IS DISTINCT FROM NEW.id        -- allow self-update (no-op row updates)
       AND a.scheduled_window && NEW.scheduled_window;

    IF v_conflict_count > 0 THEN
        RAISE EXCEPTION
            'Scheduling conflict: driver % already has an active overlapping assignment.',
            NEW.driver_id
        USING ERRCODE = 'exclusion_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_driver_overlap
    BEFORE INSERT OR UPDATE ON assignments
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_driver_overlap();


-- ---------------------------------------------------------------------------
-- TRIGGER 3: On assignment creation — cascade status changes
--
-- When a new assignment row is INSERTed (bid accepted):
--   • Move the load from BIDDING/POSTED → CONFIRMED
--   • Set the truck status → BUSY
--   • REJECT all other PENDING bids for the same load
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_on_assignment_inserted()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = logistics, public
AS $$
BEGIN
    -- Advance load to CONFIRMED
    UPDATE loads
       SET status = 'CONFIRMED'
     WHERE id     = NEW.load_id
       AND status IN ('BIDDING', 'POSTED');

    -- Mark the truck as occupied
    UPDATE trucks
       SET status = 'BUSY'
     WHERE id     = NEW.truck_id;

    -- Auto-reject remaining bids so the load board is clean
    UPDATE bids
       SET status       = 'REJECTED',
           responded_at = NOW()
     WHERE load_id  = NEW.load_id
       AND id      != NEW.bid_id
       AND status   = 'PENDING';

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_assignment_inserted
    AFTER INSERT ON assignments
    FOR EACH ROW EXECUTE FUNCTION fn_on_assignment_inserted();


-- ---------------------------------------------------------------------------
-- TRIGGER 4: On assignment terminal state — release assets & close load
--
-- When an assignment moves to COMPLETED or CANCELLED:
--   • Set truck status → AVAILABLE
--   • Set load status  → DELIVERED (completed) or CANCELLED
--   • Mark driver as available again
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_on_assignment_closed()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = logistics, public
AS $$
BEGIN
    -- Only react when the assignment actually reaches a terminal state
    IF NEW.status IN ('COMPLETED', 'CANCELLED') AND OLD.status = 'ACTIVE' THEN

        -- Release the truck
        UPDATE trucks
           SET status = 'AVAILABLE'
         WHERE id     = NEW.truck_id
           AND status = 'BUSY';

        -- Free the driver
        UPDATE driver_profiles
           SET is_available = TRUE
         WHERE id = NEW.driver_id;

        -- Mirror status onto the load
        IF NEW.status = 'COMPLETED' THEN
            UPDATE loads SET status = 'DELIVERED'  WHERE id = NEW.load_id;
        ELSIF NEW.status = 'CANCELLED' THEN
            UPDATE loads SET status = 'CANCELLED'  WHERE id = NEW.load_id;
        END IF;

    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_assignment_closed
    AFTER UPDATE ON assignments
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION fn_on_assignment_closed();


-- ---------------------------------------------------------------------------
-- TRIGGER 5: Lock driver when assignment becomes ACTIVE
--
-- Marks the driver as unavailable the moment they are assigned,
-- so the matching engine cannot re-offer them to other shippers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_lock_driver_on_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = logistics, public
AS $$
BEGIN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status = 'ACTIVE' AND OLD.status != 'ACTIVE') THEN
        UPDATE driver_profiles
           SET is_available = FALSE
         WHERE id = NEW.driver_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lock_driver_on_assignment
    AFTER INSERT OR UPDATE ON assignments
    FOR EACH ROW EXECUTE FUNCTION fn_lock_driver_on_assignment();


-- =============================================================================
-- 10.  ROW-LEVEL SECURITY (RLS)
-- =============================================================================

-- Enable RLS on every tenant-scoped table
ALTER TABLE organizations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE trucks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE loads                ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_journals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries       ENABLE ROW LEVEL SECURITY;

ALTER TABLE organizations        FORCE ROW LEVEL SECURITY;
ALTER TABLE users                FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;
ALTER TABLE driver_profiles      FORCE ROW LEVEL SECURITY;
ALTER TABLE trucks               FORCE ROW LEVEL SECURITY;
ALTER TABLE loads                FORCE ROW LEVEL SECURITY;
ALTER TABLE bids                 FORCE ROW LEVEL SECURITY;
ALTER TABLE assignments          FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_accounts      FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_journals      FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries       FORCE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA logistics FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA logistics FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA logistics FROM PUBLIC;

-- The application database role bypasses RLS for trusted server-side operations.
-- Grant this role ONLY to the backend service account.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'logistics_service') THEN
        BEGIN
            CREATE ROLE logistics_service NOINHERIT;
        EXCEPTION
            WHEN insufficient_privilege THEN
                RAISE NOTICE 'Skipping logistics_service bootstrap: current role lacks CREATEROLE';
                RETURN;
        END;
    END IF;

    EXECUTE 'GRANT USAGE ON SCHEMA logistics TO logistics_service';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA logistics TO logistics_service';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA logistics TO logistics_service';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA logistics GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO logistics_service';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA logistics GRANT USAGE, SELECT ON SEQUENCES TO logistics_service';
END;
$$;
-- logistics_service uses SET ROLE logistics_service; BYPASS RLS via superuser or BYPASSRLS attribute.
-- Example: ALTER ROLE logistics_service BYPASSRLS;

-- ── Users: see only yourself ────────────────────────────────────────────────
CREATE POLICY pol_users_self
    ON users FOR ALL
    USING (id = current_setting('app.current_user_id', TRUE)::UUID);

-- ── Org Memberships: see only your own memberships ─────────────────────────
CREATE POLICY pol_org_members_self
    ON organization_members FOR ALL
    USING (user_id = current_setting('app.current_user_id', TRUE)::UUID);

-- ── Organizations: members of the org can read it ──────────────────────────
CREATE POLICY pol_organizations_member
    ON organizations FOR SELECT
    USING (
        id IN (
            SELECT organization_id
              FROM organization_members
             WHERE user_id   = current_setting('app.current_user_id', TRUE)::UUID
               AND is_active = TRUE
        )
    );

-- ── Trucks: carrier org members only ───────────────────────────────────────
CREATE POLICY pol_trucks_carrier_member
    ON trucks FOR ALL
    USING (
        organization_id IN (
            SELECT organization_id
              FROM organization_members
             WHERE user_id   = current_setting('app.current_user_id', TRUE)::UUID
               AND is_active = TRUE
        )
    );

-- ── Driver Profiles: own org members only ──────────────────────────────────
CREATE POLICY pol_driver_profiles_member
    ON driver_profiles FOR ALL
    USING (
        organization_id IN (
            SELECT organization_id
              FROM organization_members
             WHERE user_id   = current_setting('app.current_user_id', TRUE)::UUID
               AND is_active = TRUE
        )
    );

-- ── Loads: shippers own their loads; carriers browse the public board ──────
CREATE POLICY pol_loads_shipper_owns
    ON loads FOR ALL
    USING (
        shipper_org_id IN (
            SELECT organization_id
              FROM organization_members
             WHERE user_id   = current_setting('app.current_user_id', TRUE)::UUID
               AND is_active = TRUE
        )
    );

CREATE POLICY pol_loads_carrier_reads_board
    ON loads FOR SELECT
    USING (
        status = 'POSTED'
        AND load_board_visible = TRUE
    );

-- ── Bids: carriers own their bids; shippers see bids on their loads ────────
CREATE POLICY pol_bids_carrier_owns
    ON bids FOR ALL
    USING (
        carrier_org_id IN (
            SELECT organization_id
              FROM organization_members
             WHERE user_id   = current_setting('app.current_user_id', TRUE)::UUID
               AND is_active = TRUE
        )
    );

CREATE POLICY pol_bids_shipper_reads
    ON bids FOR SELECT
    USING (
        load_id IN (
            SELECT id FROM loads
             WHERE shipper_org_id IN (
                SELECT organization_id
                  FROM organization_members
                 WHERE user_id   = current_setting('app.current_user_id', TRUE)::UUID
                   AND is_active = TRUE
             )
        )
    );

-- ── Assignments: both parties can read; only service role writes ────────────
CREATE POLICY pol_assignments_party_reads
    ON assignments FOR SELECT
    USING (
        carrier_org_id IN (
            SELECT organization_id
              FROM organization_members
             WHERE user_id   = current_setting('app.current_user_id', TRUE)::UUID
               AND is_active = TRUE
        )
        OR
        load_id IN (
            SELECT id FROM loads
             WHERE shipper_org_id IN (
                SELECT organization_id
                  FROM organization_members
                 WHERE user_id   = current_setting('app.current_user_id', TRUE)::UUID
                   AND is_active = TRUE
             )
        )
    );

CREATE POLICY pol_ledger_accounts_member
    ON ledger_accounts FOR SELECT
    USING (
        organization_id IS NULL
        OR organization_id IN (
            SELECT organization_id
              FROM organization_members
             WHERE user_id   = current_setting('app.current_user_id', TRUE)::UUID
               AND is_active = TRUE
        )
    );

CREATE POLICY pol_ledger_journals_party_reads
    ON ledger_journals FOR SELECT
    USING (
        load_id IN (
            SELECT id FROM loads
             WHERE shipper_org_id IN (
                SELECT organization_id
                  FROM organization_members
                 WHERE user_id   = current_setting('app.current_user_id', TRUE)::UUID
                   AND is_active = TRUE
             )
        )
        OR
        assignment_id IN (
            SELECT id FROM assignments
             WHERE carrier_org_id IN (
                SELECT organization_id
                  FROM organization_members
                 WHERE user_id   = current_setting('app.current_user_id', TRUE)::UUID
                   AND is_active = TRUE
             )
        )
    );

CREATE POLICY pol_ledger_entries_party_reads
    ON ledger_entries FOR SELECT
    USING (
                EXISTS (
                        SELECT 1
                            FROM ledger_journals lj
                         WHERE lj.id = ledger_entries.journal_id
                             AND (
                                        lj.load_id IN (
                                                SELECT id FROM loads
                                                 WHERE shipper_org_id IN (
                                                        SELECT organization_id
                                                            FROM organization_members
                                                         WHERE user_id   = current_setting('app.current_user_id', TRUE)::UUID
                                                             AND is_active = TRUE
                                                 )
                                        )
                                        OR
                                        lj.assignment_id IN (
                                                SELECT id FROM assignments
                                                 WHERE carrier_org_id IN (
                                                        SELECT organization_id
                                                            FROM organization_members
                                                         WHERE user_id   = current_setting('app.current_user_id', TRUE)::UUID
                                                             AND is_active = TRUE
                                                 )
                                        )
                             )
                )
    );


-- =============================================================================
-- 11.  GEOSPATIAL UTILITY FUNCTIONS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- fn_find_trucks_near_pickup
--
-- Returns available trucks within p_radius_miles of a pickup coordinate,
-- optionally filtered by cargo type.  Results ordered nearest-first using
-- the PostGIS <-> (KNN) operator for index-friendly sorting.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_find_trucks_near_pickup(
    p_lat           DOUBLE PRECISION,
    p_lng           DOUBLE PRECISION,
    p_radius_miles  DOUBLE PRECISION,
    p_cargo_type    cargo_type DEFAULT NULL,
    p_min_payload   NUMERIC    DEFAULT NULL
)
RETURNS TABLE (
    truck_id              UUID,
    organization_id       UUID,
    cargo_type            cargo_type,
    payload_capacity_lbs  NUMERIC,
    distance_miles        DOUBLE PRECISION,
    driver_id             UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = logistics, public, pg_catalog
AS $$
DECLARE
    v_point   GEOGRAPHY;
    v_radius  DOUBLE PRECISION;
BEGIN
    v_point  := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::GEOGRAPHY;
    v_radius := p_radius_miles * 1609.344;   -- miles → metres

    RETURN QUERY
    SELECT  t.id                                                  AS truck_id,
            t.organization_id,
            t.cargo_type,
            t.payload_capacity_lbs,
            ST_Distance(t.current_location, v_point) / 1609.344  AS distance_miles,
            t.assigned_driver_id                                  AS driver_id
      FROM  trucks t
     WHERE  t.status             = 'AVAILABLE'
       AND  t.current_location   IS NOT NULL
       AND  ST_DWithin(t.current_location, v_point, v_radius)
       AND  (p_cargo_type IS NULL  OR t.cargo_type           =  p_cargo_type)
       AND  (p_min_payload IS NULL OR t.payload_capacity_lbs >= p_min_payload)
     ORDER BY t.current_location <-> v_point;  -- KNN traversal via GIST index
END;
$$;


-- ---------------------------------------------------------------------------
-- fn_get_load_route_telemetry
--
-- Returns ordered telemetry pings for a given assignment within its
-- load's actual pickup → delivery window.  Used for replay & analytics.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_get_load_route_telemetry(p_assignment_id UUID)
RETURNS TABLE (
    recorded_at   TIMESTAMPTZ,
    lat           DOUBLE PRECISION,
    lng           DOUBLE PRECISION,
    speed_kmh     NUMERIC,
    heading_deg   NUMERIC,
    altitude_m    NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = logistics, public, pg_catalog
AS $$
    SELECT  t.recorded_at,
            ST_Y(t.location::GEOMETRY)  AS lat,
            ST_X(t.location::GEOMETRY)  AS lng,
            t.speed_kmh,
            t.heading_deg,
            t.altitude_m
      FROM  telemetry_logs t
      JOIN  assignments    a ON a.id = t.assignment_id
     WHERE  t.assignment_id = p_assignment_id
       AND  t.recorded_at  >= COALESCE(a.picked_up_at, a.assigned_at)
       AND  t.recorded_at  <= COALESCE(a.delivered_at, NOW())
     ORDER BY t.recorded_at;
$$;


-- =============================================================================
-- 12.  PARTITION MANAGEMENT HELPER
--
-- Run monthly via pg_cron (or your scheduler of choice):
--   SELECT logistics.fn_create_telemetry_partition(DATE_TRUNC('month', NOW() + INTERVAL '1 month'));
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_create_telemetry_partition(p_month DATE)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    v_start  DATE;
    v_end    DATE;
    v_name   TEXT;
BEGIN
    v_start := DATE_TRUNC('month', p_month)::DATE;
    v_end   := (v_start + INTERVAL '1 month')::DATE;
    v_name  := 'telemetry_logs_' || TO_CHAR(v_start, 'YYYY_MM');

    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.relname = v_name AND n.nspname = 'logistics') THEN
        EXECUTE FORMAT(
            'CREATE TABLE logistics.%I PARTITION OF logistics.telemetry_logs '
            'FOR VALUES FROM (%L) TO (%L)',
            v_name, v_start, v_end
        );
        RAISE NOTICE 'Partition created: %', v_name;
    ELSE
        RAISE NOTICE 'Partition already exists: %', v_name;
    END IF;
END;
$$;


-- =============================================================================
-- 13.  PRICING ENGINE TABLES
-- =============================================================================

-- Rate models for dynamic pricing — versioned for A/B testing & rollback
CREATE TYPE pricing_strategy AS ENUM (
    'DISTANCE_BASED',       -- base_rate + ($/mile × distance)
    'FLAT_RATE',            -- fixed price per lane
    'AUCTION',              -- market-driven bidding
    'CONTRACTED'            -- pre-negotiated per customer
);

CREATE TABLE pricing_models (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT            NOT NULL,
    strategy            pricing_strategy NOT NULL,
    version             INTEGER         NOT NULL DEFAULT 1,
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,

    -- Base components (all in USD cents to avoid floating-point)
    base_rate_cents     BIGINT          NOT NULL DEFAULT 0,
    per_mile_cents      BIGINT          NOT NULL DEFAULT 0,
    per_lb_cents        BIGINT          NOT NULL DEFAULT 0,

    -- Multipliers stored as basis points (10000 = 1.0x)
    fuel_surcharge_bps  INTEGER         NOT NULL DEFAULT 0,
    hazmat_surcharge_bps INTEGER        NOT NULL DEFAULT 0,
    reefer_surcharge_bps INTEGER        NOT NULL DEFAULT 0,
    oversized_surcharge_bps INTEGER     NOT NULL DEFAULT 0,

    -- Demand/supply pricing
    surge_multiplier_bps INTEGER        NOT NULL DEFAULT 10000,  -- 1.0x default
    min_surge_bps       INTEGER         NOT NULL DEFAULT 8000,   -- 0.8x floor
    max_surge_bps       INTEGER         NOT NULL DEFAULT 25000,  -- 2.5x ceiling

    -- Time-based
    weekend_surcharge_bps INTEGER       NOT NULL DEFAULT 0,
    holiday_surcharge_bps INTEGER       NOT NULL DEFAULT 0,

    -- Lane-specific adjustments
    applies_to_origin_states   CHAR(2)[],     -- NULL = all states
    applies_to_dest_states     CHAR(2)[],
    applies_to_cargo_types     cargo_type[],  -- NULL = all types

    config              JSONB           NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    UNIQUE (name, version)
);

-- Lane rate overrides for contracted pricing
CREATE TABLE lane_rates (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    shipper_org_id      UUID            NOT NULL REFERENCES organizations (id),
    origin_city         TEXT,
    origin_state        CHAR(2)         NOT NULL,
    dest_city           TEXT,
    dest_state          CHAR(2)         NOT NULL,
    cargo_type          cargo_type,

    rate_cents          BIGINT          NOT NULL CHECK (rate_cents > 0),
    min_weight_lbs      NUMERIC(10,2),
    max_weight_lbs      NUMERIC(10,2),

    effective_from      DATE            NOT NULL,
    effective_until     DATE,
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lane_rates_shipper ON lane_rates (shipper_org_id);
CREATE INDEX idx_lane_rates_route   ON lane_rates (origin_state, dest_state, cargo_type);

-- Market rate snapshots for surge pricing calibration (fed by analytics pipeline)
CREATE TABLE market_rate_snapshots (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    origin_state        CHAR(2)         NOT NULL,
    dest_state          CHAR(2)         NOT NULL,
    cargo_type          cargo_type      NOT NULL,
    sample_date         DATE            NOT NULL,

    avg_rate_per_mile   NUMERIC(8,4)    NOT NULL,
    median_rate_per_mile NUMERIC(8,4),
    p25_rate_per_mile   NUMERIC(8,4),
    p75_rate_per_mile   NUMERIC(8,4),
    load_count          INTEGER         NOT NULL,
    truck_supply_count  INTEGER         NOT NULL,

    -- Supply/demand ratio: < 1.0 = undersupply (surge up), > 1.0 = oversupply
    supply_demand_ratio NUMERIC(6,4),

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    UNIQUE (origin_state, dest_state, cargo_type, sample_date)
);

CREATE INDEX idx_market_rates_date ON market_rate_snapshots (sample_date DESC);


-- =============================================================================
-- 14.  PAYMENT & ESCROW SYSTEM
-- =============================================================================

CREATE TYPE payment_status AS ENUM (
    'PENDING',          -- Payment initiated
    'ESCROW_HELD',      -- Funds locked in escrow
    'PARTIALLY_RELEASED', -- Advance paid to carrier
    'RELEASED',         -- Full payment to carrier
    'REFUNDED',         -- Refund issued to shipper
    'FAILED',           -- Payment processor returned failure
    'DISPUTED'          -- Under investigation
);

CREATE TYPE payment_method AS ENUM (
    'ACH',
    'WIRE',
    'CREDIT_CARD',
    'FACTORING'         -- Third-party factoring company
);

CREATE TYPE payout_status AS ENUM (
    'SCHEDULED',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
);

CREATE TABLE payments (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    load_id             UUID            NOT NULL REFERENCES loads (id),
    assignment_id       UUID            REFERENCES assignments (id),

    -- Parties
    shipper_org_id      UUID            NOT NULL REFERENCES organizations (id),
    carrier_org_id      UUID            REFERENCES organizations (id),

    -- Amounts (all in cents to avoid floating-point)
    gross_amount_cents  BIGINT          NOT NULL CHECK (gross_amount_cents > 0),
    platform_fee_cents  BIGINT          NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
    insurance_fee_cents BIGINT          NOT NULL DEFAULT 0 CHECK (insurance_fee_cents >= 0),
    net_carrier_cents   BIGINT          NOT NULL CHECK (net_carrier_cents > 0),

    -- Escrow tracking
    escrow_amount_cents BIGINT          NOT NULL DEFAULT 0,
    advance_pct         NUMERIC(5,2)    DEFAULT 0 CHECK (advance_pct BETWEEN 0 AND 100),
    advance_amount_cents BIGINT         DEFAULT 0,

    status              payment_status  NOT NULL DEFAULT 'PENDING',
    payment_method      payment_method,

    -- External processor references
    processor           TEXT,                       -- 'stripe' | 'adyen'
    processor_payment_id TEXT,                      -- Stripe PaymentIntent ID
    processor_transfer_id TEXT,                     -- Stripe Transfer ID
    processor_metadata  JSONB           NOT NULL DEFAULT '{}',

    -- Timestamps
    escrow_held_at      TIMESTAMPTZ,
    advance_paid_at     TIMESTAMPTZ,
    released_at         TIMESTAMPTZ,
    refunded_at         TIMESTAMPTZ,

    -- Idempotency
    idempotency_key     TEXT            NOT NULL UNIQUE,

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- Journal linkage for double-entry accounting
    journal_id          UUID            REFERENCES ledger_journals (id)
);

CREATE INDEX idx_payments_load      ON payments (load_id);
CREATE INDEX idx_payments_assignment ON payments (assignment_id);
CREATE INDEX idx_payments_shipper   ON payments (shipper_org_id);
CREATE INDEX idx_payments_carrier   ON payments (carrier_org_id);
CREATE INDEX idx_payments_status    ON payments (status);
CREATE INDEX idx_payments_processor ON payments (processor, processor_payment_id);

-- Carrier payout schedule (settlement runs)
CREATE TABLE carrier_payouts (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    carrier_org_id      UUID            NOT NULL REFERENCES organizations (id),
    payment_ids         UUID[]          NOT NULL,       -- References to payments table

    total_cents         BIGINT          NOT NULL CHECK (total_cents > 0),
    status              payout_status   NOT NULL DEFAULT 'SCHEDULED',

    processor           TEXT,
    processor_payout_id TEXT,
    processor_metadata  JSONB           NOT NULL DEFAULT '{}',

    -- Bank account details (reference to external vault, not stored here)
    bank_account_token  TEXT,

    scheduled_at        TIMESTAMPTZ     NOT NULL,
    processing_at       TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    failed_at           TIMESTAMPTZ,
    failure_reason      TEXT,

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payouts_status     ON carrier_payouts (status);

-- Fraud detection signals
CREATE TABLE fraud_signals (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type         TEXT            NOT NULL,   -- 'payment' | 'user' | 'organization'
    entity_id           UUID            NOT NULL,
    signal_type         TEXT            NOT NULL,   -- 'velocity_check' | 'geo_mismatch' | 'amount_anomaly'
    severity            TEXT            NOT NULL DEFAULT 'LOW',  -- LOW | MEDIUM | HIGH | CRITICAL
    details             JSONB           NOT NULL,
    resolved            BOOLEAN         NOT NULL DEFAULT FALSE,
    resolved_by         UUID            REFERENCES users (id),
    resolved_at         TIMESTAMPTZ,

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fraud_entity   ON fraud_signals (entity_type, entity_id);
CREATE INDEX idx_fraud_unresolved ON fraud_signals (severity, created_at DESC) WHERE resolved = FALSE;


-- =============================================================================
-- 15.  NOTIFICATIONS
-- =============================================================================

CREATE TYPE notification_channel AS ENUM ('PUSH', 'SMS', 'EMAIL', 'IN_APP', 'WEBHOOK');
CREATE TYPE notification_status  AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED');

CREATE TABLE notification_templates (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type          TEXT            NOT NULL UNIQUE,  -- 'load.confirmed' | 'bid.accepted' etc.
    channel             notification_channel NOT NULL,
    subject_template    TEXT,
    body_template       TEXT            NOT NULL,         -- Handlebars syntax
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE notifications (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID            NOT NULL REFERENCES users (id),
    channel             notification_channel NOT NULL,
    event_type          TEXT            NOT NULL,
    subject             TEXT,
    body                TEXT            NOT NULL,
    status              notification_status NOT NULL DEFAULT 'QUEUED',

    -- Delivery metadata
    processor_message_id TEXT,
    delivered_at        TIMESTAMPTZ,
    failed_at           TIMESTAMPTZ,
    failure_reason      TEXT,
    retry_count         SMALLINT        NOT NULL DEFAULT 0,

    -- Reference to source entity
    entity_type         TEXT,
    entity_id           UUID,

    read_at             TIMESTAMPTZ,

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user     ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_unread   ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_status   ON notifications (status) WHERE status IN ('QUEUED', 'FAILED');


-- =============================================================================
-- 16.  ROUTE OPTIMIZATION & GEOFENCING
-- =============================================================================

CREATE TABLE geofences (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT            NOT NULL,
    organization_id     UUID            REFERENCES organizations (id),
    fence_type          TEXT            NOT NULL DEFAULT 'CIRCULAR',  -- CIRCULAR | POLYGON
    center              GEOGRAPHY(POINT, 4326),
    radius_meters       NUMERIC(10,2),
    polygon             GEOGRAPHY(POLYGON, 4326),
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    metadata            JSONB           NOT NULL DEFAULT '{}',

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_geofences_center  ON geofences USING GIST (center);
CREATE INDEX idx_geofences_polygon ON geofences USING GIST (polygon);

-- ETA tracking per assignment checkpoint
CREATE TABLE eta_checkpoints (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id       UUID            NOT NULL REFERENCES assignments (id) ON DELETE CASCADE,
    checkpoint_type     TEXT            NOT NULL,  -- 'PICKUP' | 'DROPOFF' | 'WAYPOINT' | 'REST_STOP'
    location            GEOGRAPHY(POINT, 4326) NOT NULL,
    address             TEXT,

    estimated_arrival   TIMESTAMPTZ     NOT NULL,
    actual_arrival      TIMESTAMPTZ,
    geofence_entered_at TIMESTAMPTZ,
    geofence_exited_at  TIMESTAMPTZ,

    sequence_order      SMALLINT        NOT NULL,
    distance_remaining_miles NUMERIC(8,2),
    eta_confidence      NUMERIC(5,4),   -- 0.0 – 1.0

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_eta_assignment ON eta_checkpoints (assignment_id, sequence_order);


-- =============================================================================
-- 17.  ANALYTICS & REPORTING
-- =============================================================================

-- Materialized view for carrier performance scorecards (refreshed hourly)
CREATE MATERIALIZED VIEW mv_carrier_scorecard AS
SELECT
    a.carrier_org_id,
    o.name                                          AS carrier_name,
    COUNT(*)                                        AS total_assignments,
    COUNT(*) FILTER (WHERE a.status = 'COMPLETED')  AS completed_count,
    COUNT(*) FILTER (WHERE a.status = 'CANCELLED')  AS cancelled_count,
    ROUND(
        COUNT(*) FILTER (WHERE a.status = 'COMPLETED')::NUMERIC
        / NULLIF(COUNT(*), 0) * 100, 2
    )                                               AS completion_rate_pct,
    ROUND(AVG(a.shipper_rating), 2)                 AS avg_shipper_rating,
    ROUND(AVG(
        EXTRACT(EPOCH FROM (a.delivered_at - a.picked_up_at)) / 3600.0
    ), 2)                                           AS avg_transit_hours,
    ROUND(AVG(
        EXTRACT(EPOCH FROM (a.pickup_arrived_at - a.dispatched_at)) / 3600.0
    ), 2)                                           AS avg_response_hours,
    SUM(a.agreed_rate_usd)                          AS total_revenue_usd
FROM assignments a
JOIN organizations o ON o.id = a.carrier_org_id
WHERE a.created_at >= NOW() - INTERVAL '90 days'
GROUP BY a.carrier_org_id, o.name
WITH DATA;

CREATE UNIQUE INDEX idx_carrier_scorecard_id ON mv_carrier_scorecard (carrier_org_id);

-- Materialized view for lane analytics
CREATE MATERIALIZED VIEW mv_lane_analytics AS
SELECT
    l.pickup_state,
    l.dropoff_state,
    l.cargo_type,
    DATE_TRUNC('week', l.created_at)::DATE          AS week_start,
    COUNT(*)                                        AS load_count,
    COUNT(*) FILTER (WHERE l.status = 'DELIVERED')  AS delivered_count,
    ROUND(AVG(l.final_rate_usd), 2)                 AS avg_rate_usd,
    ROUND(AVG(l.rate_per_mile_usd), 4)              AS avg_rate_per_mile,
    ROUND(AVG(l.distance_miles), 2)                 AS avg_distance_miles,
    COUNT(DISTINCT b.carrier_org_id)                AS unique_bidders
FROM loads l
LEFT JOIN bids b ON b.load_id = l.id AND b.status != 'WITHDRAWN'
WHERE l.created_at >= NOW() - INTERVAL '365 days'
GROUP BY l.pickup_state, l.dropoff_state, l.cargo_type, DATE_TRUNC('week', l.created_at)
WITH DATA;

CREATE UNIQUE INDEX idx_lane_analytics ON mv_lane_analytics (pickup_state, dropoff_state, cargo_type, week_start);


-- Refresh function for analytics views
CREATE OR REPLACE FUNCTION fn_refresh_analytics_views()
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_carrier_scorecard;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_lane_analytics;
END;
$$;


-- =============================================================================
-- RLS for new tables
-- =============================================================================

ALTER TABLE payments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments               FORCE ROW LEVEL SECURITY;
ALTER TABLE carrier_payouts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_payouts        FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications          FORCE ROW LEVEL SECURITY;

CREATE POLICY pol_payments_party ON payments FOR SELECT
    USING (
        shipper_org_id IN (
            SELECT organization_id FROM organization_members
            WHERE user_id = current_setting('app.current_user_id', TRUE)::UUID AND is_active = TRUE
        )
        OR carrier_org_id IN (
            SELECT organization_id FROM organization_members
            WHERE user_id = current_setting('app.current_user_id', TRUE)::UUID AND is_active = TRUE
        )
    );

CREATE POLICY pol_payouts_carrier ON carrier_payouts FOR SELECT
    USING (
        carrier_org_id IN (
            SELECT organization_id FROM organization_members
            WHERE user_id = current_setting('app.current_user_id', TRUE)::UUID AND is_active = TRUE
        )
    );

CREATE POLICY pol_notifications_self ON notifications FOR ALL
    USING (user_id = current_setting('app.current_user_id', TRUE)::UUID);


-- Update default grants to cover new tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA logistics TO logistics_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA logistics TO logistics_service;


-- =============================================================================
-- 18.  SCHEMA HARDENING — Performance & Reliability Indexes
-- =============================================================================

-- ── BRIN index for time-series range scans on audit log ─────────────────────
-- status_audit_log is append-only and correlated with changed_at.
-- BRIN is 100-1000× smaller than B-tree for large time-series tables.
CREATE INDEX idx_audit_changed_at_brin ON status_audit_log USING BRIN (changed_at)
    WITH (pages_per_range = 32);

-- ── BRIN index on telemetry partitions for time range scans ─────────────────
-- recorded_at is the partition key and monotonically increasing per partition.
CREATE INDEX idx_telem_recorded_brin ON telemetry_logs USING BRIN (recorded_at)
    WITH (pages_per_range = 64);

-- ── GIN index on loads.special_requirements for array containment queries ───
-- Enables @> (contains) and && (overlaps) queries on the special_requirements array.
-- Critical for load board filtering: "show loads requiring HAZMAT + OVERSIZED"
CREATE INDEX idx_loads_special_reqs ON loads USING GIN (special_requirements)
    WHERE special_requirements IS NOT NULL;

-- ── Partial index for payment reconciliation — find stuck payments ──────────
-- The reconciliation worker needs to quickly find RELEASED payments that
-- might have failed Stripe capture (two-phase settlement pattern).
CREATE INDEX idx_payments_reconcile ON payments (released_at)
    WHERE status = 'RELEASED' AND released_at IS NOT NULL;

-- ── Partial index for scheduled payouts processing ──────────────────────────
CREATE INDEX idx_payouts_scheduled ON carrier_payouts (scheduled_at)
    WHERE status = 'SCHEDULED';

-- ── Index for carrier payout bank account lookups ───────────────────────────
CREATE INDEX idx_payouts_carrier ON carrier_payouts (carrier_org_id, status);

-- ── Connection & statement safety defaults ──────────────────────────────────
-- Prevent runaway queries from holding locks forever.
-- These apply per-session and can be overridden with SET LOCAL for batch jobs.
DO $$ BEGIN
    EXECUTE format('ALTER DATABASE %I SET statement_timeout = %L', current_database(), '30s');
    EXECUTE format('ALTER DATABASE %I SET lock_timeout = %L', current_database(), '10s');
    EXECUTE format('ALTER DATABASE %I SET idle_in_transaction_session_timeout = %L', current_database(), '60s');
END $$;

-- ── Session variable for RLS optimized org lookup ───────────────────────────
-- Instead of correlated subqueries in every RLS policy, the application layer
-- sets this variable once per session. RLS policies can reference it directly.
-- Usage: SET LOCAL app.current_org_ids = '{uuid1,uuid2}'
-- Then: current_setting('app.current_org_ids', TRUE)::UUID[]
-- NOTE: This requires updating getClient() to also set org IDs, and updating
-- RLS policies. Left as a documented optimization path.

-- ── Automated partition management function ─────────────────────────────────
-- Call monthly via pg_cron or application scheduler to pre-create next quarter's partitions.
CREATE OR REPLACE FUNCTION fn_ensure_telemetry_partitions(months_ahead INT DEFAULT 3)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    target_date DATE;
    partition_name TEXT;
    range_start DATE;
    range_end DATE;
BEGIN
    FOR i IN 0..months_ahead LOOP
        target_date := date_trunc('month', NOW()) + (i || ' months')::INTERVAL;
        partition_name := 'telemetry_logs_' || to_char(target_date, 'YYYY_MM');
        range_start := target_date;
        range_end := target_date + '1 month'::INTERVAL;

        IF NOT EXISTS (
            SELECT 1 FROM pg_class
            WHERE relname = partition_name
              AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'logistics')
        ) THEN
            EXECUTE format(
                'CREATE TABLE logistics.%I PARTITION OF logistics.telemetry_logs FOR VALUES FROM (%L) TO (%L)',
                partition_name, range_start, range_end
            );
            RAISE NOTICE 'Created partition: %', partition_name;
        END IF;
    END LOOP;
END;
$$;

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
