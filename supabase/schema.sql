-- ============================================================================
-- QR CODE ATTENDANCE MANAGEMENT SYSTEM - SUPABASE POSTGRESQL SCHEMA
-- Designed for enterprise security, Row Level Security (RLS), and atomic check-ins
-- ============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. ENUMS & DOMAINS (Drop if exists for clean idempotence)
DO $$ BEGIN
    CREATE TYPE member_role_type AS ENUM ('Staff', 'Agent');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE event_permitted_roles AS ENUM ('Staff', 'Agent', 'All');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. DIVISIONS TABLE
CREATE TABLE IF NOT EXISTS divisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. BRANCHES TABLE (Cascaded under Divisions)
CREATE TABLE IF NOT EXISTS branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
    division_name VARCHAR(255),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_division_branch_code UNIQUE(division_id, code)
);

-- 5. MEMBERS TABLE (Master records for Staff and Agents)
CREATE TABLE IF NOT EXISTS members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role member_role_type NOT NULL,
    member_code VARCHAR(50) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone_number VARCHAR(30) NOT NULL,
    division_id UUID NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_role_member_code UNIQUE(role, member_code)
);

-- 6. EVENTS TABLE
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    venue VARCHAR(255) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    permitted_roles event_permitted_roles NOT NULL DEFAULT 'All',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    radius_meters INTEGER NOT NULL DEFAULT 50,
    location_required BOOLEAN NOT NULL DEFAULT true,
    qr_token VARCHAR(100) NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'), -- legacy static QR, no longer accepted
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata', -- IANA zone that date/start_time/end_time are expressed in
    late_grace_minutes INTEGER NOT NULL DEFAULT 15,       -- check-ins after start_time + grace are marked late
    checkout_enabled BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Idempotent column additions for existing deployments:
ALTER TABLE events ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata';
ALTER TABLE events ADD COLUMN IF NOT EXISTS late_grace_minutes INTEGER NOT NULL DEFAULT 15;
ALTER TABLE events ADD COLUMN IF NOT EXISTS checkout_enabled BOOLEAN NOT NULL DEFAULT false;

-- 7. ATTENDANCE TABLE
CREATE TABLE IF NOT EXISTS attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    check_in_mode VARCHAR(50) NOT NULL DEFAULT 'ATTENDEE_SCAN', -- 'ATTENDEE_SCAN', 'HOST_SELF', 'ADMIN_MANUAL' (legacy: 'VENUE_STATIC_QR')
    host_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
    qr_window_epoch BIGINT,
    check_in_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    accuracy_meters DOUBLE PRECISION,
    distance_meters DOUBLE PRECISION,
    is_late BOOLEAN NOT NULL DEFAULT false,
    check_out_time TIMESTAMPTZ,
    check_out_distance_meters DOUBLE PRECISION,
    ip_address VARCHAR(100),
    user_agent TEXT,
    verification_status VARCHAR(50) NOT NULL DEFAULT 'VERIFIED', -- 'VERIFIED', 'FLAGGED', 'MANUAL'
    verification_notes TEXT,
    marked_by UUID, -- admin user id for manual entries
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_event_member_attendance UNIQUE(event_id, member_id)
);

ALTER TABLE attendance ALTER COLUMN check_in_mode SET DEFAULT 'ATTENDEE_SCAN';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS accuracy_meters DOUBLE PRECISION;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS is_late BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_time TIMESTAMPTZ;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_distance_meters DOUBLE PRECISION;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS marked_by UUID;

-- 8. AUTHORIZED EVENT HOSTS (20+ Mobile Rotating QR Beacons with Device-Lock)
CREATE TABLE IF NOT EXISTS event_authorized_hosts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    station_name VARCHAR(100) DEFAULT 'Main Gate',
    is_active BOOLEAN NOT NULL DEFAULT true,
    device_id VARCHAR(100) DEFAULT NULL,
    device_registered_at TIMESTAMPTZ DEFAULT NULL,
    -- Secret delivered only inside the host's beacon link. The host phone signs each rotating QR
    -- with it and the server verifies the signature. Never readable by anon.
    host_secret VARCHAR(64) NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_event_member_host UNIQUE(event_id, member_id)
);

-- Idempotent column additions for existing deployments:
ALTER TABLE event_authorized_hosts ADD COLUMN IF NOT EXISTS device_id VARCHAR(100) DEFAULT NULL;
ALTER TABLE event_authorized_hosts ADD COLUMN IF NOT EXISTS device_registered_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE event_authorized_hosts ADD COLUMN IF NOT EXISTS host_secret VARCHAR(64) NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex');
UPDATE event_authorized_hosts SET host_secret = encode(gen_random_bytes(32), 'hex') WHERE host_secret IS NULL OR host_secret = '';

-- 8B. SCAN TICKETS: a verified scan of a host's rotating QR, redeemable once within 10 minutes.
-- Lets the attendee fill the form after scanning while keeping the QR itself valid for only ~60s.
CREATE TABLE IF NOT EXISTS scan_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    host_member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    window_epoch BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    used_by_member_id UUID REFERENCES members(id) ON DELETE SET NULL
);

-- 9. AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id) ON DELETE SET NULL,
    member_id UUID REFERENCES members(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL, -- 'SUCCESS', 'REJECTED', 'FLAGGED'
    details JSONB,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 9B. ADMINS (only users listed here get admin rights; signing up alone grants nothing)
-- Bootstrap the first admin in the SQL Editor:
--   INSERT INTO admins (user_id) SELECT id FROM auth.users WHERE email = 'you@example.com';
CREATE TABLE IF NOT EXISTS admins (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid());
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION is_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

-- 10. INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_branches_division_id ON branches(division_id);
CREATE INDEX IF NOT EXISTS idx_members_role_code ON members(role, member_code);
CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone_number);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_attendance_event ON attendance(event_id);
CREATE INDEX IF NOT EXISTS idx_attendance_member ON attendance(member_id);
CREATE INDEX IF NOT EXISTS idx_attendance_mode ON attendance(check_in_mode);
CREATE INDEX IF NOT EXISTS idx_attendance_host ON attendance(host_member_id);
CREATE INDEX IF NOT EXISTS idx_hosts_event ON event_authorized_hosts(event_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_check_in_time ON attendance(check_in_time DESC);
CREATE INDEX IF NOT EXISTS idx_scan_tickets_expires ON scan_tickets(expires_at);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
ALTER TABLE divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_authorized_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_tickets ENABLE ROW LEVEL SECURITY; -- no policies: only reachable through SECURITY DEFINER functions

-- Drop old policies first so this file can be re-run on an existing project.
DROP POLICY IF EXISTS "Public read divisions" ON divisions;
DROP POLICY IF EXISTS "Admin write divisions" ON divisions;
DROP POLICY IF EXISTS "Public read branches" ON branches;
DROP POLICY IF EXISTS "Admin write branches" ON branches;
DROP POLICY IF EXISTS "Public full access members" ON members;
DROP POLICY IF EXISTS "Admin all members" ON members;
DROP POLICY IF EXISTS "Public read active events" ON events;
DROP POLICY IF EXISTS "Admin all events" ON events;
DROP POLICY IF EXISTS "Public read event_authorized_hosts" ON event_authorized_hosts;
DROP POLICY IF EXISTS "Admin write event_authorized_hosts" ON event_authorized_hosts;
DROP POLICY IF EXISTS "Admin all attendance" ON attendance;
DROP POLICY IF EXISTS "No anon direct write attendance" ON attendance;
DROP POLICY IF EXISTS "Admin all audit logs" ON audit_logs;
DROP POLICY IF EXISTS "Admins read admins" ON admins;

-- Divisions & Branches: Public read allowed for cascading dropdowns
CREATE POLICY "Public read divisions" ON divisions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin write divisions" ON divisions FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Public read branches" ON branches FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin write branches" ON branches FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Members Master: Strictly private! Anon has NO access. Check-in dropdowns use list_branch_members(),
-- which returns only id, name and code (never phone numbers).
CREATE POLICY "Admin all members" ON members FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Events: Anon can only read basic active event details. Admin has full control.
CREATE POLICY "Public read active events" ON events FOR SELECT TO anon USING (is_active = true);
CREATE POLICY "Admin all events" ON events FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Authorized Hosts: admin only (the table holds host_secret). Public pages use get_event_hosts().
CREATE POLICY "Admin write event_authorized_hosts" ON event_authorized_hosts FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Attendance: Direct INSERT is blocked for anon. Anon submits exclusively via the secure RPC.
CREATE POLICY "Admin all attendance" ON attendance FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "No anon direct write attendance" ON attendance FOR INSERT TO anon WITH CHECK (false);

-- Audit Logs: Admin only
CREATE POLICY "Admin all audit logs" ON audit_logs FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Admins: an admin can see the admin list; changes are made in the SQL Editor
CREATE POLICY "Admins read admins" ON admins FOR SELECT TO authenticated USING (is_admin());

-- ============================================================================
-- PUBLIC READ RPCs (return only non-sensitive columns from protected tables)
-- ============================================================================
CREATE OR REPLACE FUNCTION list_branch_members(p_branch_id UUID, p_role TEXT)
RETURNS TABLE (id UUID, full_name VARCHAR, member_code VARCHAR) AS $$
    SELECT m.id, m.full_name, m.member_code
    FROM members m
    WHERE m.branch_id = p_branch_id
      AND m.role::text = p_role
      AND m.is_active = true
    ORDER BY m.full_name;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_event_hosts(p_event_id UUID)
RETURNS TABLE (
    id UUID,
    event_id UUID,
    member_id UUID,
    member_code VARCHAR,
    full_name VARCHAR,
    role member_role_type,
    division_id UUID,
    branch_id UUID,
    station_name VARCHAR,
    is_active BOOLEAN,
    device_id VARCHAR,
    device_registered_at TIMESTAMPTZ
) AS $$
    SELECT h.id, h.event_id, h.member_id, m.member_code, m.full_name, m.role, m.division_id, m.branch_id,
           h.station_name, h.is_active, h.device_id, h.device_registered_at
    FROM event_authorized_hosts h
    JOIN members m ON m.id = h.member_id
    WHERE h.event_id = p_event_id
    ORDER BY h.station_name;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION list_branch_members(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_event_hosts(UUID) TO anon, authenticated;

-- ============================================================================
-- HAVERSINE DISTANCE HELPER FUNCTION (IN METERS)
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_haversine_distance(
    lat1 DOUBLE PRECISION,
    lon1 DOUBLE PRECISION,
    lat2 DOUBLE PRECISION,
    lon2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION AS $$
DECLARE
    r CONSTANT DOUBLE PRECISION := 6371000.0; -- Earth's mean radius in meters
    phi1 DOUBLE PRECISION;
    phi2 DOUBLE PRECISION;
    delta_phi DOUBLE PRECISION;
    delta_lambda DOUBLE PRECISION;
    a DOUBLE PRECISION;
    c DOUBLE PRECISION;
BEGIN
    IF lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN
        RETURN NULL;
    END IF;

    phi1 := radians(lat1);
    phi2 := radians(lat2);
    delta_phi := radians(lat2 - lat1);
    delta_lambda := radians(lon2 - lon1);

    a := sin(delta_phi / 2.0)^2 + cos(phi1) * cos(phi2) * sin(delta_lambda / 2.0)^2;
    c := 2.0 * atan2(sqrt(a), sqrt(1.0 - a));

    RETURN round((r * c)::numeric, 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to keep division_name on branches automatically synchronized
CREATE OR REPLACE FUNCTION sync_branch_division_name()
RETURNS TRIGGER AS $$
BEGIN
    SELECT name INTO NEW.division_name 
    FROM divisions 
    WHERE id = NEW.division_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_branch_division_name ON branches;
CREATE TRIGGER trg_sync_branch_division_name
BEFORE INSERT OR UPDATE ON branches
FOR EACH ROW
EXECUTE FUNCTION sync_branch_division_name();

-- ============================================================================
-- ROTATING HOST QR: SIGNATURE CHECK AND SCAN TICKETS
-- QR windows are 20 seconds. The host phone signs "<event_id>:<host_code>:<epoch>" with
-- HMAC-SHA256 using host_secret and puts the first 16 hex chars in the QR (js/dynamic-qr.js).
-- ============================================================================
CREATE OR REPLACE FUNCTION host_qr_signature(p_event_id UUID, p_host_code TEXT, p_epoch BIGINT, p_secret TEXT)
RETURNS TEXT AS $$
    SELECT left(encode(hmac(p_event_id::text || ':' || p_host_code || ':' || p_epoch::text, p_secret, 'sha256'), 'hex'), 16);
$$ LANGUAGE sql IMMUTABLE SET search_path = public, extensions;

-- Exchanges a fresh, correctly signed host QR for a one-time ticket valid for 10 minutes.
-- The QR itself is only accepted for about 60 seconds, so screenshots shared later fail.
CREATE OR REPLACE FUNCTION redeem_host_scan(
    p_event_id UUID,
    p_host_code TEXT,
    p_window_epoch BIGINT,
    p_signature TEXT,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_event RECORD;
    v_host RECORD;
    v_server_epoch BIGINT := floor(extract(epoch FROM clock_timestamp()) / 20)::BIGINT;
    v_expires TIMESTAMPTZ := clock_timestamp() + interval '10 minutes';
    v_ticket_id UUID;
BEGIN
    SELECT * INTO v_event FROM events WHERE id = p_event_id;
    IF NOT FOUND OR NOT v_event.is_active THEN
        RETURN jsonb_build_object('success', false, 'code', 'EVENT_INACTIVE', 'message', 'This event is not accepting check-ins.');
    END IF;

    SELECT h.member_id, h.host_secret, h.station_name, m.full_name, m.member_code
    INTO v_host
    FROM event_authorized_hosts h
    JOIN members m ON m.id = h.member_id
    WHERE h.event_id = p_event_id
      AND h.is_active = true
      AND UPPER(TRIM(m.member_code)) = UPPER(TRIM(p_host_code));

    IF NOT FOUND THEN
        INSERT INTO audit_logs (event_id, action, status, details, user_agent)
        VALUES (p_event_id, 'QR_SCAN', 'REJECTED', jsonb_build_object('reason', 'Host not recognized', 'host_code', p_host_code), p_user_agent);
        RETURN jsonb_build_object('success', false, 'code', 'HOST_NOT_AUTHORIZED', 'message', 'This QR code does not belong to an authorized attendance taker for this event.');
    END IF;

    -- Allow 3 windows (about 60s) for scan delay and phone clock drift
    IF p_window_epoch IS NULL OR abs(v_server_epoch - p_window_epoch) > 3 THEN
        INSERT INTO audit_logs (event_id, member_id, action, status, details, user_agent)
        VALUES (p_event_id, v_host.member_id, 'QR_SCAN', 'REJECTED', jsonb_build_object('reason', 'Rotating QR expired', 'window_epoch', p_window_epoch, 'server_epoch', v_server_epoch), p_user_agent);
        RETURN jsonb_build_object('success', false, 'code', 'QR_EXPIRED', 'message', 'This QR code has expired. Scan the live code on the staff member''s phone again. Screenshots do not work.');
    END IF;

    IF p_signature IS NULL OR p_signature <> host_qr_signature(p_event_id, p_host_code, p_window_epoch, v_host.host_secret) THEN
        INSERT INTO audit_logs (event_id, member_id, action, status, details, user_agent)
        VALUES (p_event_id, v_host.member_id, 'QR_SCAN', 'REJECTED', jsonb_build_object('reason', 'Invalid QR signature'), p_user_agent);
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_SIGNATURE', 'message', 'This QR code could not be verified. Scan the live code on the staff member''s phone.');
    END IF;

    INSERT INTO scan_tickets (event_id, host_member_id, window_epoch, expires_at)
    VALUES (p_event_id, v_host.member_id, p_window_epoch, v_expires)
    RETURNING id INTO v_ticket_id;

    DELETE FROM scan_tickets WHERE expires_at < clock_timestamp() - interval '1 day';

    RETURN jsonb_build_object(
        'success', true,
        'ticket', v_ticket_id,
        'expires_at', v_expires,
        'host_name', v_host.full_name,
        'host_member_code', v_host.member_code,
        'host_station', v_host.station_name
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

-- ============================================================================
-- HOST BEACON: device lock and live stats, authenticated by the host's beacon key
-- ============================================================================
CREATE OR REPLACE FUNCTION host_claim_device(p_event_id UUID, p_host_code TEXT, p_host_key TEXT, p_device_id TEXT)
RETURNS JSONB AS $$
DECLARE
    v_host RECORD;
BEGIN
    SELECT h.id, h.member_id, h.device_id
    INTO v_host
    FROM event_authorized_hosts h
    JOIN members m ON m.id = h.member_id
    WHERE h.event_id = p_event_id
      AND h.is_active = true
      AND UPPER(TRIM(m.member_code)) = UPPER(TRIM(p_host_code))
      AND p_host_key IS NOT NULL
      AND h.host_secret = p_host_key
    FOR UPDATE OF h;

    IF NOT FOUND THEN
        INSERT INTO audit_logs (event_id, action, status, details)
        VALUES (p_event_id, 'HOST_BEACON_OPEN', 'REJECTED', jsonb_build_object('reason', 'Invalid beacon key', 'host_code', p_host_code));
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_KEY', 'message', 'This beacon link is not valid. Ask your administrator for a new link.');
    END IF;

    IF v_host.device_id IS NULL THEN
        UPDATE event_authorized_hosts SET device_id = p_device_id, device_registered_at = now(), updated_at = now() WHERE id = v_host.id;
        INSERT INTO audit_logs (event_id, member_id, action, status, details)
        VALUES (p_event_id, v_host.member_id, 'HOST_DEVICE_BOUND', 'SUCCESS', jsonb_build_object('device', left(p_device_id, 16)));
        RETURN jsonb_build_object('success', true, 'is_new_lock', true);
    END IF;

    IF v_host.device_id = p_device_id THEN
        RETURN jsonb_build_object('success', true, 'is_new_lock', false);
    END IF;

    INSERT INTO audit_logs (event_id, member_id, action, status, details)
    VALUES (p_event_id, v_host.member_id, 'HOST_DEVICE_MISMATCH', 'REJECTED', jsonb_build_object('attempted_device', left(p_device_id, 16)));
    RETURN jsonb_build_object('success', false, 'error', 'DEVICE_LOCKED', 'message', 'This beacon is locked to another phone. Ask your administrator to reset the device lock.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION host_stats(p_event_id UUID, p_host_code TEXT, p_host_key TEXT)
RETURNS JSONB AS $$
DECLARE
    v_host_member_id UUID;
    v_self RECORD;
    v_count INTEGER;
BEGIN
    SELECT h.member_id INTO v_host_member_id
    FROM event_authorized_hosts h
    JOIN members m ON m.id = h.member_id
    WHERE h.event_id = p_event_id
      AND UPPER(TRIM(m.member_code)) = UPPER(TRIM(p_host_code))
      AND p_host_key IS NOT NULL
      AND h.host_secret = p_host_key;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invalid beacon key.');
    END IF;

    SELECT a.check_in_time, a.check_in_mode, a.distance_meters INTO v_self
    FROM attendance a WHERE a.event_id = p_event_id AND a.member_id = v_host_member_id;

    SELECT count(*) INTO v_count
    FROM attendance a
    WHERE a.event_id = p_event_id AND a.host_member_id = v_host_member_id AND a.check_in_mode = 'ATTENDEE_SCAN';

    RETURN jsonb_build_object(
        'success', true,
        'self_checked_in', v_self.check_in_time IS NOT NULL,
        'self_check_in_time', v_self.check_in_time,
        'self_check_in_mode', v_self.check_in_mode,
        'self_distance_meters', v_self.distance_meters,
        'scanned_count', v_count
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ============================================================================
-- CHECK-IN HELPERS
-- ============================================================================
-- Logs a rejected attempt and returns the error payload sent to the phone
CREATE OR REPLACE FUNCTION attendance_reject(
    p_event_id UUID,
    p_member_id UUID,
    p_code TEXT,
    p_message TEXT,
    p_details JSONB,
    p_user_agent TEXT
)
RETURNS JSONB AS $$
BEGIN
    INSERT INTO audit_logs (event_id, member_id, action, status, details, user_agent)
    VALUES (p_event_id, p_member_id, 'CHECK_IN_ATTEMPT', 'REJECTED',
            COALESCE(p_details, '{}'::jsonb) || jsonb_build_object('code', p_code, 'reason', p_message), p_user_agent);
    RETURN jsonb_build_object('success', false, 'code', p_code, 'message', p_message);
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Builds the digital pass returned after a check-in, check-out or manual entry
CREATE OR REPLACE FUNCTION attendance_receipt(p_attendance_id UUID, p_action TEXT, p_already_recorded BOOLEAN)
RETURNS JSONB AS $$
    SELECT jsonb_build_object(
        'success', true,
        'already_recorded', p_already_recorded,
        'message', CASE WHEN p_action = 'CHECK_OUT' THEN 'Check-out recorded successfully!' ELSE 'Attendance verified and recorded successfully!' END,
        'data', jsonb_build_object(
            'ticket_id', a.id,
            'action', p_action,
            'full_name', m.full_name,
            'member_code', m.member_code,
            'role', m.role,
            'division', d.name,
            'branch', b.name,
            'event_name', e.name,
            'venue', e.venue,
            'check_in_mode', a.check_in_mode,
            'host_name', h.full_name,
            'host_member_code', h.member_code,
            'host_station', eh.station_name,
            'check_in_time', to_char(a.check_in_time AT TIME ZONE e.timezone, 'YYYY-MM-DD HH12:MI:SS AM'),
            'check_out_time', to_char(a.check_out_time AT TIME ZONE e.timezone, 'YYYY-MM-DD HH12:MI:SS AM'),
            'is_late', a.is_late,
            'verification_status', a.verification_status,
            'distance_meters', round((CASE WHEN p_action = 'CHECK_OUT' THEN a.check_out_distance_meters ELSE a.distance_meters END)::numeric)
        )
    )
    FROM attendance a
    JOIN events e ON e.id = a.event_id
    JOIN members m ON m.id = a.member_id
    LEFT JOIN divisions d ON d.id = m.division_id
    LEFT JOIN branches b ON b.id = m.branch_id
    LEFT JOIN members h ON h.id = a.host_member_id
    LEFT JOIN event_authorized_hosts eh ON eh.event_id = a.event_id AND eh.member_id = a.host_member_id
    WHERE a.id = p_attendance_id;
$$ LANGUAGE sql STABLE SET search_path = public;

-- ============================================================================
-- SECURE SERVER-SIDE STORED PROCEDURE: SUBMIT ATTENDANCE (RPC)
-- Executed with SECURITY DEFINER to safely validate against protected tables.
-- Proof of presence is either a scan ticket from redeem_host_scan() (ATTENDEE_SCAN)
-- or the host's own beacon key (HOST_SELF). The old static venue QR is no longer accepted.
-- ============================================================================
-- Remove the previous signature (static QR token parameters) before creating the new one
DROP FUNCTION IF EXISTS submit_attendance(UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, BIGINT, TEXT);

CREATE OR REPLACE FUNCTION submit_attendance(
    p_event_id UUID,
    p_role TEXT,
    p_member_code TEXT,
    p_phone_number TEXT,
    p_division_id UUID,
    p_branch_id UUID,
    p_check_in_mode TEXT,                       -- 'ATTENDEE_SCAN' or 'HOST_SELF'
    p_scan_ticket UUID DEFAULT NULL,            -- ATTENDEE_SCAN: ticket from redeem_host_scan()
    p_host_key TEXT DEFAULT NULL,               -- HOST_SELF: the host's beacon key
    p_latitude DOUBLE PRECISION DEFAULT NULL,
    p_longitude DOUBLE PRECISION DEFAULT NULL,
    p_accuracy DOUBLE PRECISION DEFAULT NULL,   -- metres, from the phone's GPS fix
    p_position_age_ms BIGINT DEFAULT NULL,      -- age of the GPS fix when submitted
    p_gps_suspicious BOOLEAN DEFAULT false,     -- client heuristics (0 m accuracy, stale fix...)
    p_action TEXT DEFAULT 'CHECK_IN',           -- 'CHECK_IN' or 'CHECK_OUT'
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_event RECORD;
    v_member RECORD;
    v_ticket RECORD;
    v_existing RECORD;
    v_host_id UUID := NULL;
    v_window_epoch BIGINT := NULL;
    v_distance DOUBLE PRECISION := NULL;
    v_tolerance DOUBLE PRECISION;
    v_flags TEXT[] := ARRAY[]::TEXT[];
    v_status TEXT := 'VERIFIED';
    v_is_late BOOLEAN := false;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_tz TEXT;
    v_start_ts TIMESTAMPTZ;        -- check-in opens
    v_end_ts TIMESTAMPTZ;          -- check-in closes (next day when end_time < start_time)
    v_checkout_until TIMESTAMPTZ;  -- check-out allowed until the end of the day the event ends
    v_mode TEXT := UPPER(COALESCE(p_check_in_mode, ''));
    v_action TEXT := UPPER(COALESCE(p_action, 'CHECK_IN'));
    v_clean_phone TEXT := regexp_replace(COALESCE(p_phone_number, ''), '[^0-9]', '', 'g');
    v_new_id UUID;
    c_max_accuracy CONSTANT DOUBLE PRECISION := 150;   -- worse fixes are rejected
    c_max_tolerance CONSTANT DOUBLE PRECISION := 50;   -- at most this much accuracy is credited
    c_max_age_ms CONSTANT BIGINT := 120000;            -- GPS fixes older than 2 minutes are rejected
    c_retry_window CONSTANT INTERVAL := interval '2 minutes';
BEGIN
    -- 1. Event
    SELECT * INTO v_event FROM events WHERE id = p_event_id;
    IF NOT FOUND THEN
        RETURN attendance_reject(NULL, NULL, 'EVENT_NOT_FOUND', 'This event was not found. Scan the QR code on a staff member''s phone again.', jsonb_build_object('event_id', p_event_id), p_user_agent);
    END IF;
    IF NOT v_event.is_active THEN
        RETURN attendance_reject(p_event_id, NULL, 'EVENT_INACTIVE', 'This event is not accepting check-ins.', NULL, p_user_agent);
    END IF;
    IF v_action NOT IN ('CHECK_IN', 'CHECK_OUT') THEN
        RETURN attendance_reject(p_event_id, NULL, 'INVALID_ACTION', 'Unknown attendance action.', NULL, p_user_agent);
    END IF;
    IF v_action = 'CHECK_OUT' AND NOT v_event.checkout_enabled THEN
        RETURN attendance_reject(p_event_id, NULL, 'CHECKOUT_DISABLED', 'Check-out is not enabled for this event.', NULL, p_user_agent);
    END IF;

    -- Event times are local to the event's timezone, not UTC.
    -- An end time earlier than the start time means the event runs past midnight.
    v_tz := COALESCE(NULLIF(v_event.timezone, ''), 'Asia/Kolkata');
    v_start_ts := (v_event.date + v_event.start_time) AT TIME ZONE v_tz;
    v_end_ts := (v_event.date + v_event.end_time
                 + CASE WHEN v_event.end_time < v_event.start_time THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE v_tz;
    v_checkout_until := (((v_end_ts AT TIME ZONE v_tz)::DATE + 1)::TIMESTAMP) AT TIME ZONE v_tz;

    -- 2. Role
    IF v_event.permitted_roles <> 'All' AND v_event.permitted_roles::text <> p_role THEN
        RETURN attendance_reject(p_event_id, NULL, 'ROLE_NOT_PERMITTED', format('This event is only open for %s attendees.', v_event.permitted_roles), jsonb_build_object('role', p_role), p_user_agent);
    END IF;

    -- 3. Member, mobile number and status
    SELECT m.*, d.name AS division_name, b.name AS branch_name
    INTO v_member
    FROM members m
    JOIN divisions d ON m.division_id = d.id
    JOIN branches b ON m.branch_id = b.id
    WHERE m.role::text = p_role
      AND UPPER(TRIM(m.member_code)) = UPPER(TRIM(p_member_code))
      AND m.division_id = p_division_id
      AND m.branch_id = p_branch_id;

    IF NOT FOUND THEN
        RETURN attendance_reject(p_event_id, NULL, 'MEMBER_NOT_FOUND', 'No matching record found. Please verify your Role, Code, Division, and Branch.', jsonb_build_object('role', p_role, 'member_code', p_member_code), p_user_agent);
    END IF;

    -- Compare the last 10 digits to accommodate +91 / 0 prefixes
    IF length(v_clean_phone) < 10 OR RIGHT(regexp_replace(v_member.phone_number, '[^0-9]', '', 'g'), 10) <> RIGHT(v_clean_phone, 10) THEN
        RETURN attendance_reject(p_event_id, v_member.id, 'PHONE_MISMATCH', 'Mobile number does not match the registered record for this employee/agent code.', NULL, p_user_agent);
    END IF;

    IF NOT v_member.is_active THEN
        RETURN attendance_reject(p_event_id, v_member.id, 'ACCOUNT_INACTIVE', 'Your account is currently inactive. Please contact the administrator.', NULL, p_user_agent);
    END IF;

    -- 4. Proof of presence
    IF v_mode = 'ATTENDEE_SCAN' THEN
        IF p_scan_ticket IS NULL THEN
            RETURN attendance_reject(p_event_id, v_member.id, 'SCAN_REQUIRED', 'Scan the QR code shown on a staff member''s phone to check in.', NULL, p_user_agent);
        END IF;

        -- Row lock serializes double taps that share one ticket
        SELECT t.*, m.full_name AS host_name, m.member_code AS host_code
        INTO v_ticket
        FROM scan_tickets t
        JOIN members m ON m.id = t.host_member_id
        WHERE t.id = p_scan_ticket AND t.event_id = p_event_id
        FOR UPDATE OF t;

        IF NOT FOUND THEN
            RETURN attendance_reject(p_event_id, v_member.id, 'INVALID_TICKET', 'Your scan could not be verified. Scan the staff member''s QR code again.', NULL, p_user_agent);
        END IF;
        -- A used ticket is only accepted again as a retry by the same person moments later
        IF v_ticket.used_at IS NOT NULL
           AND (v_ticket.used_by_member_id IS DISTINCT FROM v_member.id OR v_ticket.used_at < v_now - c_retry_window) THEN
            RETURN attendance_reject(p_event_id, v_member.id, 'TICKET_USED', 'This scan was already used. Scan the live QR code on the staff member''s phone yourself.', NULL, p_user_agent);
        END IF;
        IF v_ticket.used_at IS NULL AND v_ticket.expires_at < v_now THEN
            RETURN attendance_reject(p_event_id, v_member.id, 'TICKET_EXPIRED', 'More than 10 minutes passed since you scanned. Scan the staff member''s QR code again.', NULL, p_user_agent);
        END IF;

        v_host_id := v_ticket.host_member_id;
        v_window_epoch := v_ticket.window_epoch;
    ELSIF v_mode = 'HOST_SELF' THEN
        PERFORM 1
        FROM event_authorized_hosts h
        WHERE h.event_id = p_event_id
          AND h.member_id = v_member.id
          AND h.is_active = true
          AND p_host_key IS NOT NULL
          AND h.host_secret = p_host_key;

        IF NOT FOUND THEN
            RETURN attendance_reject(p_event_id, v_member.id, 'HOST_NOT_AUTHORIZED', 'Host self check-in needs a valid beacon link for your own staff profile.', NULL, p_user_agent);
        END IF;
        v_host_id := v_member.id;
    ELSE
        RETURN attendance_reject(p_event_id, v_member.id, 'SCAN_REQUIRED', 'Scan the QR code shown on a staff member''s phone to check in.', jsonb_build_object('mode', p_check_in_mode), p_user_agent);
    END IF;

    -- 5. Time window, duplicates
    SELECT * INTO v_existing FROM attendance WHERE event_id = p_event_id AND member_id = v_member.id;

    IF v_action = 'CHECK_IN' THEN
        IF v_existing.id IS NOT NULL THEN
            -- Already checked in: hand back the existing pass instead of an error.
            -- Repeats after the retry window are still logged as rejected attempts.
            IF v_existing.check_in_time <= v_now - c_retry_window THEN
                PERFORM attendance_reject(p_event_id, v_member.id, 'DUPLICATE_ATTENDANCE', 'Already checked in; existing pass shown.', NULL, p_user_agent);
            END IF;
            RETURN attendance_receipt(v_existing.id, 'CHECK_IN', true);
        END IF;

        IF v_now < v_start_ts THEN
            RETURN attendance_reject(p_event_id, v_member.id, 'TIME_WINDOW_EARLY',
                format('Check-in has not started yet. Opens at %s on %s.', to_char(v_event.start_time, 'HH12:MI AM'), to_char(v_event.date, 'DD Mon YYYY')),
                NULL, p_user_agent);
        END IF;
        IF v_now > v_end_ts THEN
            RETURN attendance_reject(p_event_id, v_member.id, 'TIME_WINDOW_CLOSED',
                format('Check-in closed at %s on %s.', to_char(v_end_ts AT TIME ZONE v_tz, 'HH12:MI AM'), to_char(v_end_ts AT TIME ZONE v_tz, 'DD Mon YYYY')),
                NULL, p_user_agent);
        END IF;

        v_is_late := v_now > v_start_ts + make_interval(mins => v_event.late_grace_minutes);
    ELSE
        IF v_existing.id IS NULL THEN
            RETURN attendance_reject(p_event_id, v_member.id, 'NOT_CHECKED_IN', 'You have not checked in to this event yet, so there is nothing to check out from.', NULL, p_user_agent);
        END IF;
        IF v_now > v_checkout_until THEN
            RETURN attendance_reject(p_event_id, v_member.id, 'CHECKOUT_CLOSED', 'Check-out for this event has closed.', NULL, p_user_agent);
        END IF;
        IF v_existing.check_out_time IS NOT NULL THEN
            IF v_existing.check_out_time <= v_now - c_retry_window THEN
                PERFORM attendance_reject(p_event_id, v_member.id, 'ALREADY_CHECKED_OUT', 'Already checked out; existing pass shown.', NULL, p_user_agent);
            END IF;
            RETURN attendance_receipt(v_existing.id, 'CHECK_OUT', true);
        END IF;
    END IF;

    -- 6. Accuracy-aware geofence
    IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL AND v_event.latitude IS NOT NULL AND v_event.longitude IS NOT NULL THEN
        v_distance := calculate_haversine_distance(p_latitude, p_longitude, v_event.latitude, v_event.longitude);
    END IF;

    IF v_event.location_required THEN
        IF v_event.latitude IS NULL OR v_event.longitude IS NULL THEN
            RETURN attendance_reject(p_event_id, v_member.id, 'VENUE_NOT_CONFIGURED', 'The venue location for this event has not been set. Please inform the event administrator.', NULL, p_user_agent);
        END IF;
        IF p_latitude IS NULL OR p_longitude IS NULL THEN
            RETURN attendance_reject(p_event_id, v_member.id, 'GPS_REQUIRED', 'Venue GPS location verification is required. Please enable location services.', NULL, p_user_agent);
        END IF;
        IF p_accuracy IS NULL OR p_accuracy > c_max_accuracy THEN
            RETURN attendance_reject(p_event_id, v_member.id, 'GPS_INACCURATE',
                format('Your location is only accurate to about %s m. Turn on precise location, move near a window or outdoors, and try again.', COALESCE(round(p_accuracy)::text, 'unknown')),
                jsonb_build_object('accuracy', p_accuracy), p_user_agent);
        END IF;
        IF p_position_age_ms IS NOT NULL AND p_position_age_ms > c_max_age_ms THEN
            RETURN attendance_reject(p_event_id, v_member.id, 'GPS_STALE', 'Your location reading is out of date. Tap "Retry GPS" and submit again.', jsonb_build_object('age_ms', p_position_age_ms), p_user_agent);
        END IF;

        -- Credit the phone's reported accuracy (up to 50 m) so genuine attendees indoors are not rejected
        v_tolerance := LEAST(GREATEST(p_accuracy, 0), c_max_tolerance);
        IF v_distance - v_tolerance > v_event.radius_meters THEN
            RETURN attendance_reject(p_event_id, v_member.id, 'OUTSIDE_GEOFENCE',
                format('You are about %s m from the venue. Check-in is allowed within %s m.', round(v_distance), v_event.radius_meters),
                jsonb_build_object('distance', v_distance, 'accuracy', p_accuracy, 'max_radius', v_event.radius_meters), p_user_agent);
        END IF;
        IF v_distance > v_event.radius_meters THEN
            v_flags := array_append(v_flags, format('Inside radius only within GPS accuracy (%s m away, accuracy %s m)', round(v_distance), round(p_accuracy)));
        END IF;
    END IF;

    IF COALESCE(p_gps_suspicious, false) THEN
        v_flags := array_append(v_flags, 'Phone GPS looked simulated or cached');
    END IF;
    IF array_length(v_flags, 1) > 0 THEN
        v_status := 'FLAGGED';
    END IF;

    -- 7A. Check-out
    IF v_action = 'CHECK_OUT' THEN
        UPDATE attendance
        SET check_out_time = v_now,
            check_out_distance_meters = v_distance,
            verification_notes = CASE WHEN array_length(v_flags, 1) > 0
                THEN concat_ws('; ', verification_notes, 'Check-out: ' || array_to_string(v_flags, '; '))
                ELSE verification_notes END
        WHERE id = v_existing.id;

        IF v_mode = 'ATTENDEE_SCAN' THEN
            UPDATE scan_tickets SET used_at = v_now, used_by_member_id = v_member.id WHERE id = p_scan_ticket AND used_at IS NULL;
        END IF;

        INSERT INTO audit_logs (event_id, member_id, action, status, details, user_agent)
        VALUES (p_event_id, v_member.id, 'CHECK_OUT_SUCCESS', CASE WHEN v_status = 'FLAGGED' THEN 'FLAGGED' ELSE 'SUCCESS' END,
                jsonb_build_object('attendance_id', v_existing.id, 'distance_meters', v_distance, 'accuracy', p_accuracy, 'flags', to_jsonb(v_flags)), p_user_agent);

        RETURN attendance_receipt(v_existing.id, 'CHECK_OUT', false);
    END IF;

    -- 7B. Check-in. ON CONFLICT covers two simultaneous submissions by the same person.
    INSERT INTO attendance (
        event_id, member_id, check_in_mode, host_member_id, qr_window_epoch, check_in_time,
        latitude, longitude, accuracy_meters, distance_meters, is_late, user_agent,
        verification_status, verification_notes
    ) VALUES (
        v_event.id, v_member.id, v_mode, v_host_id, v_window_epoch, v_now,
        p_latitude, p_longitude, p_accuracy, v_distance, v_is_late, p_user_agent,
        v_status, NULLIF(array_to_string(v_flags, '; '), '')
    )
    ON CONFLICT (event_id, member_id) DO NOTHING
    RETURNING id INTO v_new_id;

    IF v_new_id IS NULL THEN
        SELECT id INTO v_new_id FROM attendance WHERE event_id = p_event_id AND member_id = v_member.id;
        RETURN attendance_receipt(v_new_id, 'CHECK_IN', true);
    END IF;

    IF v_mode = 'ATTENDEE_SCAN' THEN
        UPDATE scan_tickets SET used_at = v_now, used_by_member_id = v_member.id WHERE id = p_scan_ticket AND used_at IS NULL;
    END IF;

    INSERT INTO audit_logs (event_id, member_id, action, status, details, user_agent)
    VALUES (v_event.id, v_member.id, 'CHECK_IN_SUCCESS', CASE WHEN v_status = 'FLAGGED' THEN 'FLAGGED' ELSE 'SUCCESS' END,
            jsonb_build_object(
                'attendance_id', v_new_id,
                'check_in_mode', v_mode,
                'host_id', v_host_id,
                'distance_meters', v_distance,
                'accuracy', p_accuracy,
                'is_late', v_is_late,
                'flags', to_jsonb(v_flags)
            ), p_user_agent);

    RETURN attendance_receipt(v_new_id, 'CHECK_IN', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================================
-- ADMIN: MANUAL ATTENDANCE (e.g. phone dead or GPS unavailable), always audited
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_mark_attendance(p_event_id UUID, p_member_id UUID, p_reason TEXT)
RETURNS JSONB AS $$
DECLARE
    v_new_id UUID;
BEGIN
    IF NOT is_admin() THEN
        RETURN jsonb_build_object('success', false, 'code', 'NOT_ADMIN', 'message', 'Only administrators can mark attendance manually.');
    END IF;
    IF COALESCE(TRIM(p_reason), '') = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED', 'message', 'Enter a reason for the manual entry.');
    END IF;

    INSERT INTO attendance (event_id, member_id, check_in_mode, check_in_time, verification_status, verification_notes, marked_by)
    VALUES (p_event_id, p_member_id, 'ADMIN_MANUAL', clock_timestamp(), 'MANUAL', TRIM(p_reason), auth.uid())
    ON CONFLICT (event_id, member_id) DO NOTHING
    RETURNING id INTO v_new_id;

    IF v_new_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'ALREADY_PRESENT', 'message', 'This person is already marked present for the event.');
    END IF;

    INSERT INTO audit_logs (event_id, member_id, action, status, details)
    VALUES (p_event_id, p_member_id, 'ADMIN_MANUAL_ATTENDANCE', 'SUCCESS', jsonb_build_object('attendance_id', v_new_id, 'reason', TRIM(p_reason), 'admin', auth.uid()));

    RETURN attendance_receipt(v_new_id, 'CHECK_IN', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================================
-- ADMIN: REVIEW A CHECK-IN (usually a FLAGGED one)
-- APPROVE marks it verified; REJECT removes it so the person can check in again properly.
-- Both need a note, and the audit log keeps a copy of the record.
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_review_attendance(p_attendance_id UUID, p_decision TEXT, p_note TEXT)
RETURNS JSONB AS $$
DECLARE
    v_row attendance%ROWTYPE;
    v_decision TEXT := UPPER(COALESCE(p_decision, ''));
    v_note TEXT := TRIM(COALESCE(p_note, ''));
BEGIN
    IF NOT is_admin() THEN
        RETURN jsonb_build_object('success', false, 'code', 'NOT_ADMIN', 'message', 'Only administrators can review attendance.');
    END IF;
    IF v_decision NOT IN ('APPROVE', 'REJECT') THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_DECISION', 'message', 'Choose Approve or Reject.');
    END IF;
    IF v_note = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'NOTE_REQUIRED', 'message', 'Enter a note explaining the decision.');
    END IF;

    SELECT * INTO v_row FROM attendance WHERE id = p_attendance_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'message', 'This attendance record no longer exists.');
    END IF;

    IF v_decision = 'APPROVE' THEN
        UPDATE attendance
        SET verification_status = 'VERIFIED',
            verification_notes = concat_ws('; ', verification_notes, 'Approved by admin: ' || v_note)
        WHERE id = p_attendance_id;
    ELSE
        DELETE FROM attendance WHERE id = p_attendance_id;
    END IF;

    INSERT INTO audit_logs (event_id, member_id, action, status, details)
    VALUES (v_row.event_id, v_row.member_id, 'ADMIN_REVIEW_' || v_decision, 'SUCCESS',
            jsonb_build_object('attendance_id', v_row.id, 'note', v_note, 'admin', auth.uid(), 'record', to_jsonb(v_row)));

    RETURN jsonb_build_object('success', true, 'decision', v_decision);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Internal helpers are not callable from the API
REVOKE EXECUTE ON FUNCTION host_qr_signature(UUID, TEXT, BIGINT, TEXT) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION attendance_reject(UUID, UUID, TEXT, TEXT, JSONB, TEXT) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION attendance_receipt(UUID, TEXT, BOOLEAN) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_mark_attendance(UUID, UUID, TEXT) FROM public, anon;
REVOKE EXECUTE ON FUNCTION admin_review_attendance(UUID, TEXT, TEXT) FROM public, anon;

-- Grant execution to anon and authenticated users
GRANT EXECUTE ON FUNCTION submit_attendance(UUID, TEXT, TEXT, TEXT, UUID, UUID, TEXT, UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, BIGINT, BOOLEAN, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION redeem_host_scan(UUID, TEXT, BIGINT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION host_claim_device(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION host_stats(UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_mark_attendance(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_review_attendance(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_haversine_distance TO anon, authenticated;

-- ============================================================================
-- HUMAN-READABLE LIVE ATTENDANCE VIEW (EASY TO READ & EXPORT DIRECTLY IN SUPABASE)
-- ============================================================================
-- security_invoker makes the view obey the caller's RLS (otherwise it would run as its owner
-- and expose every attendee's phone number to the anon key).
CREATE OR REPLACE VIEW live_attendance_view WITH (security_invoker = true) AS
SELECT
    a.id AS attendance_id,
    e.name AS event_name,
    e.date AS event_date,
    m.full_name AS attendee_name,
    m.member_code AS attendee_code,
    m.role AS attendee_role,
    m.phone_number AS attendee_phone,
    d.name AS division_name,
    b.name AS branch_name,
    a.check_in_time,
    ROUND(a.distance_meters::numeric, 1) AS distance_meters,
    a.check_in_mode,
    h.full_name AS host_staff_name,
    a.verification_status,
    a.is_late,
    a.check_out_time,
    a.verification_notes
FROM attendance a
JOIN events e ON a.event_id = e.id
JOIN members m ON a.member_id = m.id
LEFT JOIN divisions d ON m.division_id = d.id
LEFT JOIN branches b ON m.branch_id = b.id
LEFT JOIN members h ON a.host_member_id = h.id
ORDER BY a.check_in_time DESC;

-- ============================================================================
-- REALTIME: stream attendance INSERTs to the admin dashboard
-- ============================================================================
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'attendance'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE attendance;
    END IF;
END $$;
-- Check-outs and manual edits arrive as UPDATEs; ship the full row so the dashboard can apply them
ALTER TABLE attendance REPLICA IDENTITY FULL;
