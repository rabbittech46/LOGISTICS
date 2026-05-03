-- =============================================================================
--  MULTI-TRUCK BOOKING SYSTEM — Slot-Based Capacity Model
--
--  Extends the existing logistics schema with:
--    1. load_slots          — One row per required truck (N capacity = N rows)
--    2. bookings            — Confirmed load-slot-driver binding record
--    3. idempotency_keys    — Prevents duplicate API requests under retries
--
--  Concurrency Control Strategy:
--    SELECT ... FOR UPDATE SKIP LOCKED atomically claims a single slot
--    without blocking other concurrent booking attempts. This gives us
--    maximum throughput under contention while guaranteeing no overbooking.
-- =============================================================================

SET search_path TO logistics, public;

-- =============================================================================
-- 1. DOMAIN ENUMs
-- =============================================================================

CREATE TYPE slot_status AS ENUM ('AVAILABLE', 'RESERVED', 'BOOKED', 'EXPIRED');
CREATE TYPE booking_status AS ENUM ('CONFIRMED', 'CANCELLED', 'COMPLETED');

-- =============================================================================
-- 2. LOAD EXTENSION — Multi-Truck Capacity
-- =============================================================================

-- Add multi-truck fields to existing loads table.
-- total_trucks_required defaults to 1 for backward compatibility with
-- single-truck loads that already exist in the system.
ALTER TABLE loads
  ADD COLUMN IF NOT EXISTS total_trucks_required INTEGER NOT NULL DEFAULT 1
    CHECK (total_trucks_required >= 1 AND total_trucks_required <= 200);


-- =============================================================================
-- 3. LOAD SLOTS — One row per truck capacity unit (CRITICAL TABLE)
--
-- Design rationale:
--   A load requiring N trucks gets N rows in this table.
--   Each row is an independently lockable unit. Under concurrency,
--   SELECT ... FOR UPDATE SKIP LOCKED picks the *first unlocked available*
--   slot, atomically locking it for the current transaction.
--
--   This means 10,000 concurrent drivers hitting 100 slots will each
--   try to lock a different row — no contention, no deadlocks, no overbooking.
--
-- State machine:
--   AVAILABLE → RESERVED (driver claims, 5-minute TTL)
--   RESERVED  → BOOKED   (driver confirms payment/intent)
--   RESERVED  → AVAILABLE (expiration worker reclaims)
--   RESERVED  → AVAILABLE (driver cancels)
--   BOOKED    → (terminal: cannot revert without cancellation flow)
-- =============================================================================

CREATE TABLE load_slots (
    id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    load_id                 UUID          NOT NULL REFERENCES loads (id) ON DELETE CASCADE,
    slot_number             INTEGER       NOT NULL CHECK (slot_number >= 1),

    -- State machine
    status                  slot_status   NOT NULL DEFAULT 'AVAILABLE',

    -- Reservation fields (populated when RESERVED)
    reserved_by             UUID          REFERENCES users (id),
    reserved_by_org_id      UUID          REFERENCES organizations (id),
    reservation_expires_at  TIMESTAMPTZ,

    -- Booking fields (populated when BOOKED)
    booked_by               UUID          REFERENCES users (id),
    booked_by_org_id        UUID          REFERENCES organizations (id),
    booked_truck_id         UUID          REFERENCES trucks (id),
    booked_driver_id        UUID          REFERENCES driver_profiles (id),

    -- Optimistic locking fallback for non-SELECT-FOR-UPDATE paths
    version                 INTEGER       NOT NULL DEFAULT 1,

    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- Each load gets exactly N numbered slots
    UNIQUE (load_id, slot_number),

    -- A driver can only hold ONE active reservation/booking per load
    CONSTRAINT uq_load_slots_reserved_by
        EXCLUDE USING GIST (
            load_id WITH =,
            reserved_by WITH =
        )
        WHERE (reserved_by IS NOT NULL AND status IN ('RESERVED', 'BOOKED'))
);

-- ── Indexes for hot-path queries ────────────────────────────────────────────

-- PRIMARY: reservation acquisition query — FOR UPDATE SKIP LOCKED scans this
CREATE INDEX idx_load_slots_available
    ON load_slots (load_id, status)
    WHERE status = 'AVAILABLE';

-- Expiration worker scans for stale reservations
CREATE INDEX idx_load_slots_expiring
    ON load_slots (reservation_expires_at)
    WHERE status = 'RESERVED' AND reservation_expires_at IS NOT NULL;

-- Admin dashboard: slot occupancy per load
CREATE INDEX idx_load_slots_load
    ON load_slots (load_id);

-- User's active reservations
CREATE INDEX idx_load_slots_reserved_by
    ON load_slots (reserved_by)
    WHERE reserved_by IS NOT NULL AND status = 'RESERVED';

-- Auto-update updated_at
CREATE TRIGGER trg_load_slots_upd
    BEFORE UPDATE ON load_slots
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Audit trail for slot status changes
CREATE TRIGGER trg_load_slots_status_audit
    AFTER UPDATE ON load_slots
    FOR EACH ROW EXECUTE FUNCTION fn_audit_status_change();


-- =============================================================================
-- 4. BOOKINGS — Confirmed load-slot-driver binding (immutable receipt)
--
-- This table serves as a permanent record of all confirmed bookings.
-- The load_slots table tracks real-time state; this table is the
-- authoritative audit trail for billing, disputes, and analytics.
-- =============================================================================

CREATE TABLE bookings (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    load_id             UUID            NOT NULL REFERENCES loads (id),
    slot_id             UUID            NOT NULL REFERENCES load_slots (id),
    driver_id           UUID            NOT NULL REFERENCES users (id),
    carrier_org_id      UUID            NOT NULL REFERENCES organizations (id),
    truck_id            UUID            REFERENCES trucks (id),

    status              booking_status  NOT NULL DEFAULT 'CONFIRMED',
    agreed_rate_usd     NUMERIC(12,2)   CHECK (agreed_rate_usd > 0),

    -- Idempotency: prevents duplicate bookings from retried confirms
    idempotency_key     TEXT            NOT NULL UNIQUE,

    confirmed_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    cancelled_at        TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- Each slot can have exactly one active booking
    UNIQUE (slot_id),

    -- A driver can only have one confirmed booking per load
    UNIQUE (load_id, driver_id)
);

CREATE INDEX idx_bookings_load     ON bookings (load_id);
CREATE INDEX idx_bookings_driver   ON bookings (driver_id);
CREATE INDEX idx_bookings_carrier  ON bookings (carrier_org_id);
CREATE INDEX idx_bookings_status   ON bookings (status) WHERE status = 'CONFIRMED';

CREATE TRIGGER trg_bookings_upd
    BEFORE UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- =============================================================================
-- 5. IDEMPOTENCY KEYS — Replay protection for booking API requests
--
-- Stores a hash of {userId, loadId, action} to detect duplicate requests.
-- Entries auto-expire after 24 hours via the expiration worker.
-- =============================================================================

CREATE TABLE idempotency_keys (
    key             TEXT            PRIMARY KEY,
    user_id         UUID            NOT NULL REFERENCES users (id),
    request_path    TEXT            NOT NULL,
    response_code   INTEGER         NOT NULL,
    response_body   JSONB           NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX idx_idempotency_expires
    ON idempotency_keys (expires_at)
    WHERE expires_at IS NOT NULL;


-- =============================================================================
-- 6. TRIGGER: Auto-generate N slots when a load is posted with trucks > 1
--
-- When a load transitions to POSTED status and has total_trucks_required > 0,
-- this trigger generates the required number of slot rows.
-- Idempotent: only generates slots if none exist yet.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_generate_load_slots()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    -- Only fire when load first becomes POSTED (or if we're creating with POSTED)
    IF NEW.status = 'POSTED' AND (TG_OP = 'INSERT' OR OLD.status != 'POSTED') THEN
        -- Idempotent: skip if slots already exist
        IF NOT EXISTS (SELECT 1 FROM logistics.load_slots WHERE load_id = NEW.id LIMIT 1) THEN
            INSERT INTO logistics.load_slots (load_id, slot_number)
            SELECT NEW.id, generate_series(1, NEW.total_trucks_required);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_generate_load_slots
    AFTER INSERT OR UPDATE OF status ON loads
    FOR EACH ROW
    WHEN (NEW.status = 'POSTED')
    EXECUTE FUNCTION fn_generate_load_slots();


-- =============================================================================
-- 7. TRIGGER: When all slots are BOOKED, advance load to CONFIRMED
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_check_load_fully_booked()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_total       INTEGER;
    v_booked      INTEGER;
BEGIN
    IF NEW.status = 'BOOKED' AND OLD.status != 'BOOKED' THEN
        SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'BOOKED')
          INTO v_total, v_booked
          FROM logistics.load_slots
         WHERE load_id = NEW.load_id;

        IF v_total > 0 AND v_total = v_booked THEN
            -- All slots filled — advance load to CONFIRMED
            UPDATE logistics.loads
               SET status = 'CONFIRMED'
             WHERE id = NEW.load_id
               AND status IN ('POSTED', 'BIDDING');
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_load_fully_booked
    AFTER UPDATE OF status ON load_slots
    FOR EACH ROW
    WHEN (NEW.status = 'BOOKED')
    EXECUTE FUNCTION fn_check_load_fully_booked();


-- =============================================================================
-- 8. FUNCTION: Slot availability summary for a load
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_load_slot_summary(p_load_id UUID)
RETURNS TABLE (
    total_slots     INTEGER,
    available_slots INTEGER,
    reserved_slots  INTEGER,
    booked_slots    INTEGER
)
LANGUAGE sql STABLE AS $$
    SELECT
        COUNT(*)::INTEGER                                         AS total_slots,
        COUNT(*) FILTER (WHERE status = 'AVAILABLE')::INTEGER     AS available_slots,
        COUNT(*) FILTER (WHERE status = 'RESERVED')::INTEGER      AS reserved_slots,
        COUNT(*) FILTER (WHERE status = 'BOOKED')::INTEGER        AS booked_slots
    FROM logistics.load_slots
    WHERE load_id = p_load_id;
$$;
