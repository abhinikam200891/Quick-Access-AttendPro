-- ============================================================================
-- QR CODE ATTENDANCE MANAGEMENT SYSTEM - SEED DATA
-- Pre-populates Divisions, Branches, Staff & Agents, and a Sample Live Event
-- ============================================================================

-- 1. Insert Divisions
INSERT INTO divisions (id, code, name) VALUES
('11111111-1111-1111-1111-111111111111', 'DIV-CORP', 'Corporate Division'),
('22222222-2222-2222-2222-222222222222', 'DIV-RETAIL', 'Retail & Consumer Banking'),
('33333333-3333-3333-3333-333333333333', 'DIV-AGENCY', 'Agency & Field Distribution')
ON CONFLICT (code) DO NOTHING;

-- 2. Insert Branches under Divisions
-- Corporate Branches
INSERT INTO branches (id, division_id, code, name) VALUES
('aa111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'BR-HQ', 'Global Headquarters - Tower A'),
('aa111111-1111-1111-1111-222222222222', '11111111-1111-1111-1111-111111111111', 'BR-TECH', 'Tech Innovation Campus - Sector 62')
ON CONFLICT (division_id, code) DO NOTHING;

-- Retail Branches
INSERT INTO branches (id, division_id, code, name) VALUES
('bb222222-2222-2222-2222-111111111111', '22222222-2222-2222-2222-222222222222', 'BR-CENTRAL', 'Central Business District Branch'),
('bb222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'BR-METRO', 'Metro Plaza Premium Branch'),
('bb222222-2222-2222-2222-333333333333', '22222222-2222-2222-2222-222222222222', 'BR-WEST', 'West Coast Hub')
ON CONFLICT (division_id, code) DO NOTHING;

-- Agency Branches
INSERT INTO branches (id, division_id, code, name) VALUES
('cc333333-3333-3333-3333-111111111111', '33333333-3333-3333-3333-333333333333', 'BR-NORTH-AG', 'North Zone Agency Network'),
('cc333333-3333-3333-3333-222222222222', '33333333-3333-3333-3333-333333333333', 'BR-SOUTH-AG', 'South Zone Regional Agency')
ON CONFLICT (division_id, code) DO NOTHING;

-- 3. Insert Master Members (Staff & Agents)
-- Active Staff
INSERT INTO members (id, role, member_code, full_name, phone_number, division_id, branch_id, is_active) VALUES
('m1111111-1111-1111-1111-111111111111', 'Staff', 'STF-1001', 'Alexander Wright', '9876543210', '11111111-1111-1111-1111-111111111111', 'aa111111-1111-1111-1111-111111111111', true),
('m1111111-1111-1111-1111-222222222222', 'Staff', 'STF-1002', 'Sophia Chen', '9812345678', '11111111-1111-1111-1111-111111111111', 'aa111111-1111-1111-1111-222222222222', true),
('m1111111-1111-1111-1111-333333333333', 'Staff', 'STF-1003', 'Vikram Malhotra', '9711223344', '22222222-2222-2222-2222-222222222222', 'bb222222-2222-2222-2222-111111111111', true),
-- Inactive Staff (for testing inactive rejection)
('m1111111-1111-1111-1111-444444444444', 'Staff', 'STF-9999', 'Marcus Vance (Deactivated)', '9655443322', '22222222-2222-2222-2222-222222222222', 'bb222222-2222-2222-2222-222222222222', false)
ON CONFLICT (role, member_code) DO NOTHING;

-- Active Agents
INSERT INTO members (id, role, member_code, full_name, phone_number, division_id, branch_id, is_active) VALUES
('m2222222-2222-2222-2222-111111111111', 'Agent', 'AGT-2001', 'Priya Sharma', '9899887766', '33333333-3333-3333-3333-333333333333', 'cc333333-3333-3333-3333-111111111111', true),
('m2222222-2222-2222-2222-222222222222', 'Agent', 'AGT-2002', 'David Kim', '9788776655', '33333333-3333-3333-3333-333333333333', 'cc333333-3333-3333-3333-222222222222', true),
('m2222222-2222-2222-2222-333333333333', 'Agent', 'AGT-2003', 'Elena Rostova', '9911223344', '22222222-2222-2222-2222-222222222222', 'bb222222-2222-2222-2222-333333333333', true)
ON CONFLICT (role, member_code) DO NOTHING;

-- 4. Insert Sample Events
-- Event 1: Today's Active Annual Strategy Townhall (Window 00:00 to 23:59 for easy testing)
INSERT INTO events (
    id,
    event_code,
    name,
    date,
    venue,
    start_time,
    end_time,
    permitted_roles,
    latitude,
    longitude,
    radius_meters,
    location_required,
    qr_token,
    is_active
) VALUES (
    'ee111111-1111-1111-1111-111111111111',
    'EVT-2026-TOWNHALL',
    'Annual Leadership & Strategy Summit 2026',
    CURRENT_DATE,
    'Grand Ballroom, Grand Hyatt Convention Centre',
    '00:00:00',
    '23:59:59',
    'All',
    28.6139, -- Example venue latitude (or matches demo location)
    77.2090, -- Example venue longitude
    100,     -- 100 meters geofence radius
    false,   -- Set false in seed for immediate testing anywhere, or toggle true in UI!
    'token-th-2026-xyz',
    true
) ON CONFLICT (event_code) DO UPDATE SET date = CURRENT_DATE, is_active = true;

-- Event 2: Agent Only Regional Conference (With strict GPS radius 50m)
INSERT INTO events (
    id,
    event_code,
    name,
    date,
    venue,
    start_time,
    end_time,
    permitted_roles,
    latitude,
    longitude,
    radius_meters,
    location_required,
    qr_token,
    is_active
) VALUES (
    'ee222222-2222-2222-2222-222222222222',
    'EVT-2026-AGENCY',
    'National Agency Excellence Conclave',
    CURRENT_DATE,
    'Auditorium B, Metropolis Tech Park',
    '08:00:00',
    '22:00:00',
    'Agent',
    12.9716,
    77.5946,
    50,
    true,
    'token-ag-2026-abc',
    true
) ON CONFLICT (event_code) DO UPDATE SET date = CURRENT_DATE, is_active = true;
