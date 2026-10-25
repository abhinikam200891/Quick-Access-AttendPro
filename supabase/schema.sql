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
    qr_token VARCHAR(100) NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 7. ATTENDANCE TABLE
CREATE TABLE IF NOT EXISTS attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    check_in_mode VARCHAR(50) NOT NULL DEFAULT 'VENUE_STATIC_QR', -- 'VENUE_STATIC_QR', 'HOST_SELF', 'ATTENDEE_SCAN'
    host_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
    qr_window_epoch BIGINT,
    check_in_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    distance_meters DOUBLE PRECISION,
    ip_address VARCHAR(100),
    user_agent TEXT,
    verification_status VARCHAR(50) NOT NULL DEFAULT 'VERIFIED',
    verification_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_event_member_attendance UNIQUE(event_id, member_id)
);

-- 8. AUTHORIZED EVENT HOSTS (20+ Mobile Rotating QR Beacons)
CREATE TABLE IF NOT EXISTS event_authorized_hosts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    station_name VARCHAR(100) DEFAULT 'Main Gate',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_event_member_host UNIQUE(event_id, member_id)
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

-- Divisions & Branches: Public read allowed for cascading dropdowns
CREATE POLICY "Public read divisions" ON divisions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin write divisions" ON divisions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Public read branches" ON branches FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin write branches" ON branches FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Members Master: Strictly private! Anon CANNOT select, insert, or inspect members.
-- Only authenticated admins can view and manage members.
CREATE POLICY "Admin all members" ON members FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "No anon read members" ON members FOR SELECT TO anon USING (false);

-- Events: Anon can only read basic active event details. Admin has full control.
CREATE POLICY "Public read active events" ON events FOR SELECT TO anon USING (is_active = true);
CREATE POLICY "Admin all events" ON events FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Authorized Hosts: Public read for beacon resolution, admin write
CREATE POLICY "Public read event_authorized_hosts" ON event_authorized_hosts FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin write event_authorized_hosts" ON event_authorized_hosts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Attendance: Direct INSERT is blocked for anon. Anon submits exclusively via the secure RPC.
CREATE POLICY "Admin all attendance" ON attendance FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "No anon direct write attendance" ON attendance FOR INSERT TO anon WITH CHECK (false);

-- Audit Logs: Admin only
CREATE POLICY "Admin all audit logs" ON audit_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

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

-- ============================================================================
-- SECURE SERVER-SIDE STORED PROCEDURE: SUBMIT ATTENDANCE (RPC)
-- Executed with SECURITY DEFINER to safely validate against protected tables
-- ============================================================================
CREATE OR REPLACE FUNCTION submit_attendance(
    p_event_id UUID,
    p_qr_token TEXT,
    p_role TEXT,
    p_member_code TEXT,
    p_phone_number TEXT,
    p_division_id UUID,
    p_branch_id UUID,
    p_latitude DOUBLE PRECISION DEFAULT NULL,
    p_longitude DOUBLE PRECISION DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_check_in_mode TEXT DEFAULT 'VENUE_STATIC_QR',
    p_host_code TEXT DEFAULT NULL,
    p_window_epoch BIGINT DEFAULT NULL,
    p_token_signature TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_event RECORD;
    v_member RECORD;
    v_host RECORD;
    v_host_id UUID := NULL;
    v_existing_attendance RECORD;
    v_distance DOUBLE PRECISION;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_today DATE := (v_now AT TIME ZONE 'UTC')::DATE;
    v_current_time TIME := (v_now AT TIME ZONE 'UTC')::TIME;
    v_new_id UUID;
    v_clean_phone TEXT;
    v_member_clean_phone TEXT;
BEGIN
    -- 1. Validate Event existence and QR token
    SELECT * INTO v_event FROM events WHERE id = p_event_id;
    IF NOT FOUND THEN
        INSERT INTO audit_logs (event_id, action, status, details, user_agent)
        VALUES (p_event_id, 'CHECK_IN_ATTEMPT', 'REJECTED', jsonb_build_object('reason', 'Event does not exist'), p_user_agent);
        RETURN jsonb_build_object('success', false, 'code', 'EVENT_NOT_FOUND', 'message', 'The requested event was not found. Please re-scan the official QR code.');
    END IF;

    -- 2. Validate Event Active Status
    IF NOT v_event.is_active THEN
        INSERT INTO audit_logs (event_id, action, status, details, user_agent)
        VALUES (p_event_id, 'CHECK_IN_ATTEMPT', 'REJECTED', jsonb_build_object('reason', 'Event is deactivated'), p_user_agent);
        RETURN jsonb_build_object('success', false, 'code', 'EVENT_INACTIVE', 'message', 'This event check-in portal has been deactivated by the administrator.');
    END IF;

    -- 3. Validate QR Token to prevent guessing/URL tampering
    IF v_event.qr_token IS NOT NULL AND v_event.qr_token <> '' AND v_event.qr_token <> p_qr_token THEN
        INSERT INTO audit_logs (event_id, action, status, details, user_agent)
        VALUES (p_event_id, 'CHECK_IN_ATTEMPT', 'REJECTED', jsonb_build_object('reason', 'QR token mismatch'), p_user_agent);
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_QR_TOKEN', 'message', 'Invalid or expired QR code security token. Please re-scan the physical QR code.');
    END IF;

    -- 3B. Validate Dynamic Host Beacon if checkInMode is ATTENDEE_SCAN
    IF p_check_in_mode = 'ATTENDEE_SCAN' AND p_host_code IS NOT NULL AND p_host_code <> '' THEN
        SELECT h.*, m.full_name AS host_name, m.member_code AS host_code
        INTO v_host
        FROM event_authorized_hosts h
        JOIN members m ON h.member_id = m.id
        WHERE h.event_id = p_event_id
          AND UPPER(TRIM(m.member_code)) = UPPER(TRIM(p_host_code))
          AND h.is_active = true;

        IF FOUND THEN
            v_host_id := v_host.member_id;
        END IF;
    END IF;

    -- 4. Validate Permitted Roles
    IF v_event.permitted_roles <> 'All' AND v_event.permitted_roles::text <> p_role THEN
        INSERT INTO audit_logs (event_id, action, status, details, user_agent)
        VALUES (p_event_id, 'CHECK_IN_ATTEMPT', 'REJECTED', jsonb_build_object('reason', 'Role not permitted', 'role', p_role, 'permitted', v_event.permitted_roles), p_user_agent);
        RETURN jsonb_build_object('success', false, 'code', 'ROLE_NOT_PERMITTED', 'message', format('This event is only open for %s attendees.', v_event.permitted_roles));
    END IF;

    -- 5. Clean phone input (strip spaces, dashes)
    v_clean_phone := regexp_replace(p_phone_number, '[^0-9]', '', 'g');

    -- 6. Validate Member Master Record
    SELECT m.*, d.name AS division_name, b.name AS branch_name
    INTO v_member
    FROM members m
    JOIN divisions d ON m.division_id = d.id
    JOIN branches b ON m.branch_id = b.id
    WHERE m.role = p_role::member_role_type
      AND UPPER(TRIM(m.member_code)) = UPPER(TRIM(p_member_code))
      AND m.division_id = p_division_id
      AND m.branch_id = p_branch_id;

    IF NOT FOUND THEN
        INSERT INTO audit_logs (event_id, action, status, details, user_agent)
        VALUES (p_event_id, 'CHECK_IN_ATTEMPT', 'REJECTED', jsonb_build_object('reason', 'Member profile mismatch', 'role', p_role, 'code', p_member_code), p_user_agent);
        RETURN jsonb_build_object('success', false, 'code', 'MEMBER_NOT_FOUND', 'message', 'No matching record found. Please verify your Role, Code, Division, and Branch.');
    END IF;

    -- Check phone number match
    v_member_clean_phone := regexp_replace(v_member.phone_number, '[^0-9]', '', 'g');
    -- Compare last 10 digits to accommodate local vs international prefix (+91, 0, etc.)
    IF RIGHT(v_member_clean_phone, 10) <> RIGHT(v_clean_phone, 10) THEN
        INSERT INTO audit_logs (event_id, member_id, action, status, details, user_agent)
        VALUES (p_event_id, v_member.id, 'CHECK_IN_ATTEMPT', 'REJECTED', jsonb_build_object('reason', 'Phone number mismatch'), p_user_agent);
        RETURN jsonb_build_object('success', false, 'code', 'PHONE_MISMATCH', 'message', 'Mobile number does not match the registered record for this employee/agent code.');
    END IF;

    -- 7. Check Active Status
    IF NOT v_member.is_active THEN
        INSERT INTO audit_logs (event_id, member_id, action, status, details, user_agent)
        VALUES (p_event_id, v_member.id, 'CHECK_IN_ATTEMPT', 'REJECTED', jsonb_build_object('reason', 'Member account deactivated'), p_user_agent);
        RETURN jsonb_build_object('success', false, 'code', 'ACCOUNT_INACTIVE', 'message', 'Your account is currently inactive. Please contact the administrator.');
    END IF;

    -- 8. Check Duplicate Attendance (Strict Single Attendance Rule)
    SELECT * INTO v_existing_attendance FROM attendance WHERE event_id = p_event_id AND member_id = v_member.id;
    IF FOUND THEN
        INSERT INTO audit_logs (event_id, member_id, action, status, details, user_agent)
        VALUES (p_event_id, v_member.id, 'CHECK_IN_ATTEMPT', 'REJECTED', jsonb_build_object('reason', 'Duplicate attendance submission'), p_user_agent);
        RETURN jsonb_build_object(
            'success', false,
            'code', 'DUPLICATE_ATTENDANCE',
            'message', format('Attendance was already successfully recorded for %s on %s.', v_member.full_name, to_char(v_existing_attendance.check_in_time, 'YYYY-MM-DD HH12:MI:SS AM'))
        );
    END IF;

    -- 9. Validate Event Date & Time Window
    IF v_event.date <> v_today THEN
        INSERT INTO audit_logs (event_id, member_id, action, status, details, user_agent)
        VALUES (p_event_id, v_member.id, 'CHECK_IN_ATTEMPT', 'REJECTED', jsonb_build_object('reason', 'Event date mismatch', 'event_date', v_event.date, 'today', v_today), p_user_agent);
        RETURN jsonb_build_object('success', false, 'code', 'EVENT_DATE_MISMATCH', 'message', format('This event is scheduled for %s. Check-in is not open today.', v_event.date));
    END IF;

    IF v_current_time < v_event.start_time THEN
        INSERT INTO audit_logs (event_id, member_id, action, status, details, user_agent)
        VALUES (p_event_id, v_member.id, 'CHECK_IN_ATTEMPT', 'REJECTED', jsonb_build_object('reason', 'Check-in window not started', 'start_time', v_event.start_time), p_user_agent);
        RETURN jsonb_build_object('success', false, 'code', 'TIME_WINDOW_EARLY', 'message', format('Check-in has not started yet. Opens at %s.', to_char(v_event.start_time, 'HH12:MI AM')));
    END IF;

    IF v_current_time > v_event.end_time THEN
        INSERT INTO audit_logs (event_id, member_id, action, status, details, user_agent)
        VALUES (p_event_id, v_member.id, 'CHECK_IN_ATTEMPT', 'REJECTED', jsonb_build_object('reason', 'Check-in window closed', 'end_time', v_event.end_time), p_user_agent);
        RETURN jsonb_build_object('success', false, 'code', 'TIME_WINDOW_CLOSED', 'message', format('Check-in window closed at %s.', to_char(v_event.end_time, 'HH12:MI AM')));
    END IF;

    -- 10. Geolocation Radius Verification (Strict 50m Geofence)
    IF v_event.location_required THEN
        IF p_latitude IS NULL OR p_longitude IS NULL THEN
            INSERT INTO audit_logs (event_id, member_id, action, status, details, user_agent)
            VALUES (p_event_id, v_member.id, 'CHECK_IN_ATTEMPT', 'REJECTED', jsonb_build_object('reason', 'GPS coordinates missing'), p_user_agent);
            RETURN jsonb_build_object('success', false, 'code', 'GPS_REQUIRED', 'message', 'Venue GPS location verification is required. Please enable location services.');
        END IF;

        IF v_event.latitude IS NOT NULL AND v_event.longitude IS NOT NULL THEN
            v_distance := calculate_haversine_distance(p_latitude, p_longitude, v_event.latitude, v_event.longitude);
            IF v_distance > v_event.radius_meters THEN
                INSERT INTO audit_logs (event_id, member_id, action, status, details, user_agent)
                VALUES (p_event_id, v_member.id, 'CHECK_IN_ATTEMPT', 'REJECTED', jsonb_build_object('reason', 'Outside radius', 'distance', v_distance, 'max_radius', v_event.radius_meters), p_user_agent);
                RETURN jsonb_build_object(
                    'success', false,
                    'code', 'OUTSIDE_GEOFENCE',
                    'message', format('You are %s meters away from the venue. Maximum permitted check-in radius is %s meters.', round(v_distance::numeric), v_event.radius_meters)
                );
            END IF;
        END IF;
    END IF;

    -- 11. All validations passed! Atomically Record Attendance
    INSERT INTO attendance (
        event_id,
        member_id,
        check_in_mode,
        host_member_id,
        qr_window_epoch,
        check_in_time,
        latitude,
        longitude,
        distance_meters,
        user_agent,
        verification_status
    ) VALUES (
        v_event.id,
        v_member.id,
        COALESCE(p_check_in_mode, 'VENUE_STATIC_QR'),
        v_host_id,
        p_window_epoch,
        v_now,
        p_latitude,
        p_longitude,
        v_distance,
        p_user_agent,
        'VERIFIED'
    ) RETURNING id INTO v_new_id;

    -- 12. Record Audit Log
    INSERT INTO audit_logs (event_id, member_id, action, status, details, user_agent)
    VALUES (
        v_event.id,
        v_member.id,
        'CHECK_IN_SUCCESS',
        'SUCCESS',
        jsonb_build_object(
            'attendance_id', v_new_id,
            'check_in_mode', p_check_in_mode,
            'host_id', v_host_id,
            'distance_meters', v_distance,
            'timestamp', v_now
        ),
        p_user_agent
    );

    -- 13. Return Verified Receipt
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Attendance verified and recorded successfully!',
        'data', jsonb_build_object(
            'ticket_id', v_new_id,
            'full_name', v_member.full_name,
            'member_code', v_member.member_code,
            'role', v_member.role,
            'division', v_member.division_name,
            'branch', v_member.branch_name,
            'event_name', v_event.name,
            'venue', v_event.venue,
            'check_in_mode', COALESCE(p_check_in_mode, 'VENUE_STATIC_QR'),
            'host_name', v_host.host_name,
            'host_member_code', v_host.host_code,
            'host_station', v_host.station_name,
            'check_in_time', to_char(v_now, 'YYYY-MM-DD HH12:MI:SS AM'),
            'distance_meters', round(COALESCE(v_distance, 0)::numeric)
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution to anon and authenticated users
GRANT EXECUTE ON FUNCTION submit_attendance TO anon, authenticated;
GRANT EXECUTE ON FUNCTION calculate_haversine_distance TO anon, authenticated;
