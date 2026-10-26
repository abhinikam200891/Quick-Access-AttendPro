/**
 * Unified Database Service Layer
 * Supports both live Supabase backend and an exact local mock engine with atomic RPC validation.
 */

import { evaluateGeofence } from './haversine.js';
import { clockLabel, getEventWindow, nowInZone } from './event-window.js';
import { getSupabaseClient, getSupabaseConfig } from './supabase-config.js';
import { verifyDynamicQrToken } from './dynamic-qr.js';

// Default Seed Data for local testing / demo mode
const INITIAL_DIVISIONS = [
  { id: '11111111-1111-1111-1111-111111111111', code: 'DIV-CORP', name: 'Corporate Division' },
  { id: '22222222-2222-2222-2222-222222222222', code: 'DIV-RETAIL', name: 'Retail & Consumer Banking' },
  { id: '33333333-3333-3333-3333-333333333333', code: 'DIV-AGENCY', name: 'Agency & Field Distribution' }
];

const INITIAL_BRANCHES = [
  { id: 'aa111111-1111-1111-1111-111111111111', division_id: '11111111-1111-1111-1111-111111111111', code: 'BR-HQ', name: 'Global Headquarters - Tower A' },
  { id: 'aa111111-1111-1111-1111-222222222222', division_id: '11111111-1111-1111-1111-111111111111', code: 'BR-TECH', name: 'Tech Innovation Campus - Sector 62' },
  { id: 'bb222222-2222-2222-2222-111111111111', division_id: '22222222-2222-2222-2222-222222222222', code: 'BR-CENTRAL', name: 'Central Business District Branch' },
  { id: 'bb222222-2222-2222-2222-222222222222', division_id: '22222222-2222-2222-2222-222222222222', code: 'BR-METRO', name: 'Metro Plaza Premium Branch' },
  { id: 'bb222222-2222-2222-2222-333333333333', division_id: '22222222-2222-2222-2222-222222222222', code: 'BR-WEST', name: 'West Coast Hub' },
  { id: 'cc333333-3333-3333-3333-111111111111', division_id: '33333333-3333-3333-3333-333333333333', code: 'BR-NORTH-AG', name: 'North Zone Agency Network' },
  { id: 'cc333333-3333-3333-3333-222222222222', division_id: '33333333-3333-3333-3333-333333333333', code: 'BR-SOUTH-AG', name: 'South Zone Regional Agency' }
];

const INITIAL_MEMBERS = [
  // Tower A (Div 1)
  {
    id: 'm1111111-1111-1111-1111-111111111111',
    role: 'Staff',
    member_code: 'STF-1001',
    full_name: 'Alexander Wright',
    phone_number: '9876543210',
    division_id: '11111111-1111-1111-1111-111111111111',
    branch_id: 'aa111111-1111-1111-1111-111111111111',
    is_active: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'm1111111-1111-1111-1111-111111111112',
    role: 'Staff',
    member_code: 'STF-1004',
    full_name: 'Rachel Green',
    phone_number: '9811223344',
    division_id: '11111111-1111-1111-1111-111111111111',
    branch_id: 'aa111111-1111-1111-1111-111111111111',
    is_active: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'm2222222-2222-2222-2222-111111111114',
    role: 'Agent',
    member_code: 'AGT-2004',
    full_name: 'Rajesh Patel',
    phone_number: '9822334455',
    division_id: '11111111-1111-1111-1111-111111111111',
    branch_id: 'aa111111-1111-1111-1111-111111111111',
    is_active: true,
    created_at: new Date().toISOString()
  },
  // Tech Innovation Campus (Div 1)
  {
    id: 'm1111111-1111-1111-1111-222222222222',
    role: 'Staff',
    member_code: 'STF-1002',
    full_name: 'Sophia Chen',
    phone_number: '9812345678',
    division_id: '11111111-1111-1111-1111-111111111111',
    branch_id: 'aa111111-1111-1111-1111-222222222222',
    is_active: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'm2222222-2222-2222-2222-222222222225',
    role: 'Agent',
    member_code: 'AGT-2005',
    full_name: 'Amina Al-Mansoor',
    phone_number: '9833445566',
    division_id: '11111111-1111-1111-1111-111111111111',
    branch_id: 'aa111111-1111-1111-1111-222222222222',
    is_active: true,
    created_at: new Date().toISOString()
  },
  // Central Business District Branch (Div 2)
  {
    id: 'm1111111-1111-1111-1111-333333333333',
    role: 'Staff',
    member_code: 'STF-1003',
    full_name: 'Vikram Malhotra',
    phone_number: '9711223344',
    division_id: '22222222-2222-2222-2222-222222222222',
    branch_id: 'bb222222-2222-2222-2222-111111111111',
    is_active: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'm2222222-2222-2222-2222-333333333336',
    role: 'Agent',
    member_code: 'AGT-2006',
    full_name: 'Carlos Mendez',
    phone_number: '9844556677',
    division_id: '22222222-2222-2222-2222-222222222222',
    branch_id: 'bb222222-2222-2222-2222-111111111111',
    is_active: true,
    created_at: new Date().toISOString()
  },
  // Metro Plaza Premium Branch (Div 2)
  {
    id: 'm1111111-1111-1111-1111-444444444444',
    role: 'Staff',
    member_code: 'STF-9999',
    full_name: 'Marcus Vance (Deactivated)',
    phone_number: '9655443322',
    division_id: '22222222-2222-2222-2222-222222222222',
    branch_id: 'bb222222-2222-2222-2222-222222222222',
    is_active: false,
    created_at: new Date().toISOString()
  },
  {
    id: 'm1111111-1111-1111-1111-444444444445',
    role: 'Staff',
    member_code: 'STF-1007',
    full_name: 'Rohan Mehta',
    phone_number: '9855667788',
    division_id: '22222222-2222-2222-2222-222222222222',
    branch_id: 'bb222222-2222-2222-2222-222222222222',
    is_active: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'm2222222-2222-2222-2222-444444444447',
    role: 'Agent',
    member_code: 'AGT-2007',
    full_name: 'Kavita Iyer',
    phone_number: '9866778899',
    division_id: '22222222-2222-2222-2222-222222222222',
    branch_id: 'bb222222-2222-2222-2222-222222222222',
    is_active: true,
    created_at: new Date().toISOString()
  },
  // West Coast Hub (Div 2)
  {
    id: 'm1111111-1111-1111-1111-555555555558',
    role: 'Staff',
    member_code: 'STF-1008',
    full_name: 'Nathan Scott',
    phone_number: '9877889900',
    division_id: '22222222-2222-2222-2222-222222222222',
    branch_id: 'bb222222-2222-2222-2222-333333333333',
    is_active: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'm2222222-2222-2222-2222-333333333333',
    role: 'Agent',
    member_code: 'AGT-2003',
    full_name: 'Elena Rostova',
    phone_number: '9911223344',
    division_id: '22222222-2222-2222-2222-222222222222',
    branch_id: 'bb222222-2222-2222-2222-333333333333',
    is_active: true,
    created_at: new Date().toISOString()
  },
  // North Zone Agency Network (Div 3)
  {
    id: 'm1111111-1111-1111-1111-666666666669',
    role: 'Staff',
    member_code: 'STF-1009',
    full_name: 'Sunil Verma',
    phone_number: '9888990011',
    division_id: '33333333-3333-3333-3333-333333333333',
    branch_id: 'cc333333-3333-3333-3333-111111111111',
    is_active: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'm2222222-2222-2222-2222-111111111111',
    role: 'Agent',
    member_code: 'AGT-2001',
    full_name: 'Priya Sharma',
    phone_number: '9899887766',
    division_id: '33333333-3333-3333-3333-333333333333',
    branch_id: 'cc333333-3333-3333-3333-111111111111',
    is_active: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'm2222222-2222-2222-2222-111111111118',
    role: 'Agent',
    member_code: 'AGT-2008',
    full_name: 'Arjun Kapoor',
    phone_number: '9899001122',
    division_id: '33333333-3333-3333-3333-333333333333',
    branch_id: 'cc333333-3333-3333-3333-111111111111',
    is_active: true,
    created_at: new Date().toISOString()
  },
  // South Zone Regional Agency (Div 3)
  {
    id: 'm1111111-1111-1111-1111-777777777770',
    role: 'Staff',
    member_code: 'STF-1010',
    full_name: 'Lakshmi Raman',
    phone_number: '9800112233',
    division_id: '33333333-3333-3333-3333-333333333333',
    branch_id: 'cc333333-3333-3333-3333-222222222222',
    is_active: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'm2222222-2222-2222-2222-222222222222',
    role: 'Agent',
    member_code: 'AGT-2002',
    full_name: 'David Kim',
    phone_number: '9788776655',
    division_id: '33333333-3333-3333-3333-333333333333',
    branch_id: 'cc333333-3333-3333-3333-222222222222',
    is_active: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'm2222222-2222-2222-2222-222222222229',
    role: 'Agent',
    member_code: 'AGT-2009',
    full_name: 'Sneha Reddy',
    phone_number: '9811002233',
    division_id: '33333333-3333-3333-3333-333333333333',
    branch_id: 'cc333333-3333-3333-3333-222222222222',
    is_active: true,
    created_at: new Date().toISOString()
  },
  // Additional 20 Authorized Staff Members for QR Beacons & Rosters
  { id: 'm1111111-1111-1111-1111-000000001005', role: 'Staff', member_code: 'STF-1005', full_name: 'Daniel Craig', phone_number: '9811223305', division_id: '11111111-1111-1111-1111-111111111111', branch_id: 'aa111111-1111-1111-1111-111111111111', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001006', role: 'Staff', member_code: 'STF-1006', full_name: 'Emma Watson', phone_number: '9811223306', division_id: '11111111-1111-1111-1111-111111111111', branch_id: 'aa111111-1111-1111-1111-111111111111', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001007', role: 'Staff', member_code: 'STF-1007', full_name: 'Michael Scott', phone_number: '9811223307', division_id: '11111111-1111-1111-1111-111111111111', branch_id: 'aa111111-1111-1111-1111-222222222222', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001008', role: 'Staff', member_code: 'STF-1008', full_name: 'Jim Halpert', phone_number: '9811223308', division_id: '11111111-1111-1111-1111-111111111111', branch_id: 'aa111111-1111-1111-1111-222222222222', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001011', role: 'Staff', member_code: 'STF-1011', full_name: 'Dwight Schrute', phone_number: '9811223311', division_id: '22222222-2222-2222-2222-222222222222', branch_id: 'bb222222-2222-2222-2222-111111111111', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001012', role: 'Staff', member_code: 'STF-1012', full_name: 'Pam Beesly', phone_number: '9811223312', division_id: '22222222-2222-2222-2222-222222222222', branch_id: 'bb222222-2222-2222-2222-111111111111', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001013', role: 'Staff', member_code: 'STF-1013', full_name: 'Stanley Hudson', phone_number: '9811223313', division_id: '22222222-2222-2222-2222-222222222222', branch_id: 'bb222222-2222-2222-2222-222222222222', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001014', role: 'Staff', member_code: 'STF-1014', full_name: 'Phyllis Vance', phone_number: '9811223314', division_id: '22222222-2222-2222-2222-222222222222', branch_id: 'bb222222-2222-2222-2222-222222222222', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001015', role: 'Staff', member_code: 'STF-1015', full_name: 'Angela Martin', phone_number: '9811223315', division_id: '22222222-2222-2222-2222-222222222222', branch_id: 'bb222222-2222-2222-2222-333333333333', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001016', role: 'Staff', member_code: 'STF-1016', full_name: 'Oscar Martinez', phone_number: '9811223316', division_id: '22222222-2222-2222-2222-222222222222', branch_id: 'bb222222-2222-2222-2222-333333333333', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001017', role: 'Staff', member_code: 'STF-1017', full_name: 'Kevin Malone', phone_number: '9811223317', division_id: '33333333-3333-3333-3333-333333333333', branch_id: 'cc333333-3333-3333-3333-111111111111', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001018', role: 'Staff', member_code: 'STF-1018', full_name: 'Toby Flenderson', phone_number: '9811223318', division_id: '33333333-3333-3333-3333-333333333333', branch_id: 'cc333333-3333-3333-3333-111111111111', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001019', role: 'Staff', member_code: 'STF-1019', full_name: 'Kelly Kapoor', phone_number: '9811223319', division_id: '33333333-3333-3333-3333-333333333333', branch_id: 'cc333333-3333-3333-3333-222222222222', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001020', role: 'Staff', member_code: 'STF-1020', full_name: 'Ryan Howard', phone_number: '9811223320', division_id: '33333333-3333-3333-3333-333333333333', branch_id: 'cc333333-3333-3333-3333-222222222222', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001021', role: 'Staff', member_code: 'STF-1021', full_name: 'Meredith Palmer', phone_number: '9811223321', division_id: '11111111-1111-1111-1111-111111111111', branch_id: 'aa111111-1111-1111-1111-111111111111', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001022', role: 'Staff', member_code: 'STF-1022', full_name: 'Creed Bratton', phone_number: '9811223322', division_id: '11111111-1111-1111-1111-111111111111', branch_id: 'aa111111-1111-1111-1111-222222222222', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001023', role: 'Staff', member_code: 'STF-1023', full_name: 'Andy Bernard', phone_number: '9811223323', division_id: '22222222-2222-2222-2222-222222222222', branch_id: 'bb222222-2222-2222-2222-111111111111', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001024', role: 'Staff', member_code: 'STF-1024', full_name: 'Erin Hannon', phone_number: '9811223324', division_id: '22222222-2222-2222-2222-222222222222', branch_id: 'bb222222-2222-2222-2222-222222222222', is_active: true, created_at: new Date().toISOString() },
  { id: 'm1111111-1111-1111-1111-000000001025', role: 'Staff', member_code: 'STF-1025', full_name: 'Robert California', phone_number: '9811223325', division_id: '22222222-2222-2222-2222-222222222222', branch_id: 'bb222222-2222-2222-2222-333333333333', is_active: true, created_at: new Date().toISOString() }
];

// Initial pre-authorized hosts for events
const INITIAL_EVENT_HOSTS = [
  { id: 'eh-0001', event_id: 'ee111111-1111-1111-1111-111111111111', member_id: 'm1111111-1111-1111-1111-111111111111', member_code: 'STF-1001', full_name: 'Alexander Wright', station_name: 'Gate 1 - North Concourse', host_secret: 'sec_stf_1001_xyz', is_active: true },
  { id: 'eh-0002', event_id: 'ee111111-1111-1111-1111-111111111111', member_id: 'm1111111-1111-1111-1111-222222222222', member_code: 'STF-1002', full_name: 'Sophia Chen', station_name: 'Gate 2 - East Wing', host_secret: 'sec_stf_1002_xyz', is_active: true },
  { id: 'eh-0003', event_id: 'ee111111-1111-1111-1111-111111111111', member_id: 'm1111111-1111-1111-1111-333333333333', member_code: 'STF-1003', full_name: 'Vikram Malhotra', station_name: 'VIP Reception Counter', host_secret: 'sec_stf_1003_xyz', is_active: true },
  { id: 'eh-0004', event_id: 'ee111111-1111-1111-1111-111111111112', member_id: 'm1111111-1111-1111-1111-111111111112', member_code: 'STF-1004', full_name: 'Rachel Green', station_name: 'Registration Desk B', host_secret: 'sec_stf_1004_xyz', is_active: true },
  { id: 'eh-0005', event_id: 'ee111111-1111-1111-1111-111111111111', member_id: 'm1111111-1111-1111-1111-666666666669', member_code: 'STF-1009', full_name: 'Sunil Verma', station_name: 'Auditorium Floor Marshal', host_secret: 'sec_stf_1009_xyz', is_active: true }
];

function getTodayISODate() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const INITIAL_EVENTS = [
  {
    id: 'ee111111-1111-1111-1111-111111111111',
    event_code: 'EVT-2026-TOWNHALL',
    name: 'Annual Leadership & Strategy Summit 2026',
    date: getTodayISODate(),
    venue: 'Grand Ballroom, Grand Hyatt Convention Centre',
    start_time: '00:00:00',
    end_time: '23:59:59',
    permitted_roles: 'All',
    latitude: 28.6139,
    longitude: 77.2090,
    radius_meters: 100,
    location_required: false, // relaxed for initial easy testing anywhere
    qr_token: 'token-th-2026-xyz',
    late_grace_minutes: 15,
    checkout_enabled: true,
    is_active: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'ee222222-2222-2222-2222-222222222222',
    event_code: 'EVT-2026-AGENCY',
    name: 'National Agency Excellence Conclave',
    date: getTodayISODate(),
    venue: 'Auditorium B, Metropolis Tech Park',
    start_time: '08:00:00',
    end_time: '22:00:00',
    permitted_roles: 'Agent',
    latitude: 12.9716,
    longitude: 77.5946,
    radius_meters: 50,
    location_required: true,
    qr_token: 'token-ag-2026-abc',
    late_grace_minutes: 15,
    checkout_enabled: false,
    is_active: true,
    created_at: new Date().toISOString()
  }
];

// Realistic seed attendance generator for demo / testing
function generateSeedAttendance() {
  const today = getTodayISODate();
  const event1 = INITIAL_EVENTS[0];
  const event2 = INITIAL_EVENTS[1];

  return [
    {
      id: 'att-1111-0001',
      event_id: event1.id,
      event_name: event1.name,
      venue: event1.venue,
      member_id: 'm1111111-1111-1111-1111-111111111111',
      member_code: 'STF-1001',
      full_name: 'Alexander Wright',
      role: 'Staff',
      phone_number: '9876543210',
      division_id: '11111111-1111-1111-1111-111111111111',
      division_name: 'Corporate Division',
      branch_id: 'aa111111-1111-1111-1111-111111111111',
      branch_name: 'Global Headquarters - Tower A',
      check_in_time: `${today}T08:22:15.000Z`,
      latitude: 28.6141,
      longitude: 77.2092,
      distance_meters: 6.2,
      verification_status: 'VERIFIED',
      created_at: `${today}T08:22:15.000Z`
    },
    {
      id: 'att-1111-0002',
      event_id: event1.id,
      event_name: event1.name,
      venue: event1.venue,
      member_id: 'm1111111-1111-1111-1111-222222222222',
      member_code: 'STF-1002',
      full_name: 'Sophia Chen',
      role: 'Staff',
      phone_number: '9812345678',
      division_id: '11111111-1111-1111-1111-111111111111',
      division_name: 'Corporate Division',
      branch_id: 'aa111111-1111-1111-1111-222222222222',
      branch_name: 'Tech Innovation Campus - Sector 62',
      check_in_time: `${today}T08:35:40.000Z`,
      latitude: 28.6143,
      longitude: 77.2088,
      distance_meters: 14.5,
      verification_status: 'VERIFIED',
      created_at: `${today}T08:35:40.000Z`
    },
    {
      id: 'att-1111-0003',
      event_id: event1.id,
      event_name: event1.name,
      venue: event1.venue,
      member_id: 'm1111111-1111-1111-1111-333333333333',
      member_code: 'STF-1003',
      full_name: 'Vikram Malhotra',
      role: 'Staff',
      phone_number: '9711223344',
      division_id: '22222222-2222-2222-2222-222222222222',
      division_name: 'Retail & Consumer Banking',
      branch_id: 'bb222222-2222-2222-2222-111111111111',
      branch_name: 'Central Business District Branch',
      check_in_time: `${today}T08:52:10.000Z`,
      latitude: 28.6138,
      longitude: 77.2094,
      distance_meters: 18.1,
      verification_status: 'VERIFIED',
      created_at: `${today}T08:52:10.000Z`
    },
    {
      id: 'att-1111-0004',
      event_id: event1.id,
      event_name: event1.name,
      venue: event1.venue,
      member_id: 'm2222222-2222-2222-2222-111111111114',
      member_code: 'AGT-2004',
      full_name: 'Rajesh Patel',
      role: 'Agent',
      phone_number: '9822334455',
      division_id: '11111111-1111-1111-1111-111111111111',
      division_name: 'Corporate Division',
      branch_id: 'aa111111-1111-1111-1111-111111111111',
      branch_name: 'Global Headquarters - Tower A',
      check_in_time: `${today}T09:05:22.000Z`,
      latitude: 28.6139,
      longitude: 77.2089,
      distance_meters: 9.8,
      verification_status: 'VERIFIED',
      created_at: `${today}T09:05:22.000Z`
    },
    {
      id: 'att-1111-0005',
      event_id: event1.id,
      event_name: event1.name,
      venue: event1.venue,
      member_id: 'm2222222-2222-2222-2222-222222222225',
      member_code: 'AGT-2005',
      full_name: 'Amina Al-Mansoor',
      role: 'Agent',
      phone_number: '9833445566',
      division_id: '11111111-1111-1111-1111-111111111111',
      division_name: 'Corporate Division',
      branch_id: 'aa111111-1111-1111-1111-222222222222',
      branch_name: 'Tech Innovation Campus - Sector 62',
      check_in_time: `${today}T09:16:45.000Z`,
      latitude: 28.6140,
      longitude: 77.2091,
      distance_meters: 12.0,
      verification_status: 'VERIFIED',
      created_at: `${today}T09:16:45.000Z`
    },
    {
      id: 'att-1111-0006',
      event_id: event1.id,
      event_name: event1.name,
      venue: event1.venue,
      member_id: 'm2222222-2222-2222-2222-111111111111',
      member_code: 'AGT-2001',
      full_name: 'Priya Sharma',
      role: 'Agent',
      phone_number: '9899887766',
      division_id: '33333333-3333-3333-3333-333333333333',
      division_name: 'Agency & Field Distribution',
      branch_id: 'cc333333-3333-3333-3333-111111111111',
      branch_name: 'North Zone Agency Network',
      check_in_time: `${today}T09:30:18.000Z`,
      latitude: 28.6144,
      longitude: 77.2095,
      distance_meters: 24.3,
      verification_status: 'VERIFIED',
      created_at: `${today}T09:30:18.000Z`
    },
    {
      id: 'att-1111-0007',
      event_id: event1.id,
      event_name: event1.name,
      venue: event1.venue,
      member_id: 'm1111111-1111-1111-1111-666666666669',
      member_code: 'STF-1009',
      full_name: 'Sunil Verma',
      role: 'Staff',
      phone_number: '9888990011',
      division_id: '33333333-3333-3333-3333-333333333333',
      division_name: 'Agency & Field Distribution',
      branch_id: 'cc333333-3333-3333-3333-111111111111',
      branch_name: 'North Zone Agency Network',
      check_in_time: `${today}T09:48:30.000Z`,
      latitude: 28.6137,
      longitude: 77.2088,
      distance_meters: 11.7,
      verification_status: 'VERIFIED',
      created_at: `${today}T09:48:30.000Z`
    },
    {
      id: 'att-1111-0008',
      event_id: event1.id,
      event_name: event1.name,
      venue: event1.venue,
      member_id: 'm2222222-2222-2222-2222-222222222222',
      member_code: 'AGT-2002',
      full_name: 'David Kim',
      role: 'Agent',
      phone_number: '9788776655',
      division_id: '33333333-3333-3333-3333-333333333333',
      division_name: 'Agency & Field Distribution',
      branch_id: 'cc333333-3333-3333-3333-222222222222',
      branch_name: 'South Zone Regional Agency',
      check_in_time: `${today}T10:15:05.000Z`,
      latitude: 28.6146,
      longitude: 77.2096,
      distance_meters: 28.4,
      verification_status: 'VERIFIED',
      created_at: `${today}T10:15:05.000Z`
    },
    // Event 2 Check-ins
    {
      id: 'att-2222-0001',
      event_id: event2.id,
      event_name: event2.name,
      venue: event2.venue,
      member_id: 'm2222222-2222-2222-2222-333333333336',
      member_code: 'AGT-2006',
      full_name: 'Carlos Mendez',
      role: 'Agent',
      phone_number: '9844556677',
      division_id: '22222222-2222-2222-2222-222222222222',
      division_name: 'Retail & Consumer Banking',
      branch_id: 'bb222222-2222-2222-2222-111111111111',
      branch_name: 'Central Business District Branch',
      check_in_time: `${today}T08:45:10.000Z`,
      latitude: 12.9717,
      longitude: 77.5947,
      distance_meters: 15.2,
      verification_status: 'VERIFIED',
      created_at: `${today}T08:45:10.000Z`
    },
    {
      id: 'att-2222-0002',
      event_id: event2.id,
      event_name: event2.name,
      venue: event2.venue,
      member_id: 'm2222222-2222-2222-2222-111111111118',
      member_code: 'AGT-2008',
      full_name: 'Arjun Kapoor',
      role: 'Agent',
      phone_number: '9899001122',
      division_id: '33333333-3333-3333-3333-333333333333',
      division_name: 'Agency & Field Distribution',
      branch_id: 'cc333333-3333-3333-3333-111111111111',
      branch_name: 'North Zone Agency Network',
      check_in_time: `${today}T09:12:30.000Z`,
      latitude: 12.9715,
      longitude: 77.5945,
      distance_meters: 8.7,
      verification_status: 'VERIFIED',
      created_at: `${today}T09:12:30.000Z`
    },
    {
      id: 'att-2222-0003',
      event_id: event2.id,
      event_name: event2.name,
      venue: event2.venue,
      member_id: 'm2222222-2222-2222-2222-222222222229',
      member_code: 'AGT-2009',
      full_name: 'Sneha Reddy',
      role: 'Agent',
      phone_number: '9811002233',
      division_id: '33333333-3333-3333-3333-333333333333',
      division_name: 'Agency & Field Distribution',
      branch_id: 'cc333333-3333-3333-3333-222222222222',
      branch_name: 'South Zone Regional Agency',
      check_in_time: `${today}T09:40:50.000Z`,
      latitude: 12.9718,
      longitude: 77.5949,
      distance_meters: 21.6,
      verification_status: 'VERIFIED',
      created_at: `${today}T09:40:50.000Z`
    }
  ];
}

// Real-time Event Broadcaster across tabs & listeners
const realtimeBroadcast = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('attendpro_attendance_feed') : null;
const attendanceSubscribers = new Set();

function broadcastNewAttendance(record) {
  if (realtimeBroadcast) {
    try {
      realtimeBroadcast.postMessage({ type: 'NEW_ATTENDANCE', record });
    } catch (e) {
      console.warn('BroadcastChannel error:', e);
    }
  }
  attendanceSubscribers.forEach((cb) => {
    try {
      cb(record);
    } catch (err) {
      console.error('Attendance subscriber error:', err);
    }
  });
}

// Helper to manage localStorage Mock DB
// Seeding is lazy so devices running against live Supabase never get demo data.
class MockDatabase {
  constructor() {
    this.initialized = false;
  }

  ensureInit() {
    if (!this.initialized) this.init();
  }

  init() {
    this.initialized = true;
    if (!localStorage.getItem('db_divisions')) {
      localStorage.setItem('db_divisions', JSON.stringify(INITIAL_DIVISIONS));
    }
    if (!localStorage.getItem('db_branches')) {
      localStorage.setItem('db_branches', JSON.stringify(INITIAL_BRANCHES));
    }
    if (!localStorage.getItem('db_members')) {
      localStorage.setItem('db_members', JSON.stringify(INITIAL_MEMBERS));
    } else {
      try {
        const existingMembers = JSON.parse(localStorage.getItem('db_members') || '[]');
        const existingIds = new Set(existingMembers.map((m) => m.id));
        const missing = INITIAL_MEMBERS.filter((m) => !existingIds.has(m.id));
        if (missing.length > 0) {
          localStorage.setItem('db_members', JSON.stringify([...existingMembers, ...missing]));
        }
      } catch (e) {
        localStorage.setItem('db_members', JSON.stringify(INITIAL_MEMBERS));
      }
    }
    if (!localStorage.getItem('db_events')) {
      localStorage.setItem('db_events', JSON.stringify(INITIAL_EVENTS));
    }
    if (!localStorage.getItem('db_attendance') || JSON.parse(localStorage.getItem('db_attendance') || '[]').length === 0) {
      localStorage.setItem('db_attendance', JSON.stringify(generateSeedAttendance()));
    }
    if (!localStorage.getItem('db_event_hosts')) {
      localStorage.setItem('db_event_hosts', JSON.stringify(INITIAL_EVENT_HOSTS));
    }
    if (!localStorage.getItem('db_audit_logs')) {
      localStorage.setItem('db_audit_logs', JSON.stringify([]));
    }
  }

  get(table) {
    this.ensureInit();
    return JSON.parse(localStorage.getItem(`db_${table}`) || '[]');
  }

  save(table, data) {
    this.ensureInit();
    localStorage.setItem(`db_${table}`, JSON.stringify(data));
  }

  reset() {
    localStorage.removeItem('db_divisions');
    localStorage.removeItem('db_branches');
    localStorage.removeItem('db_members');
    localStorage.removeItem('db_events');
    localStorage.removeItem('db_event_hosts');
    localStorage.removeItem('db_attendance');
    localStorage.removeItem('db_audit_logs');
    this.init();
  }
}

const mockDb = new MockDatabase();

// In live Supabase mode a failed call must surface as an error, never fall back to local demo data
function liveError(action, error) {
  const detail = error?.message || String(error || 'Unknown error');
  return new Error(`Could not ${action}: ${detail}`);
}

// Single select for attendance rows; host details come through the host_member_id foreign key
const ATTENDANCE_SELECT = `
  id,
  event_id,
  member_id,
  check_in_time,
  latitude,
  longitude,
  accuracy_meters,
  distance_meters,
  is_late,
  check_out_time,
  check_out_distance_meters,
  verification_status,
  verification_notes,
  check_in_mode,
  host_member_id,
  events (id, name, venue, date),
  members:members!attendance_member_id_fkey (
    id, role, member_code, full_name, phone_number, division_id, branch_id
  ),
  host:members!attendance_host_member_id_fkey (member_code, full_name)
`;

function normalizeAttendanceRow(row, divMap, branchMap) {
  const mem = row.members || {};
  return {
    id: row.id,
    event_id: row.events?.id || row.event_id,
    event_name: row.events?.name || 'Event',
    venue: row.events?.venue || '',
    member_id: mem.id || row.member_id,
    member_code: mem.member_code || '',
    full_name: mem.full_name || 'Attendee',
    role: mem.role || 'Staff',
    phone_number: mem.phone_number || '',
    division_id: mem.division_id || '',
    division_name: divMap.get(mem.division_id) || 'Division',
    branch_id: mem.branch_id || '',
    branch_name: branchMap.get(mem.branch_id) || 'Branch',
    check_in_time: row.check_in_time,
    accuracy_meters: row.accuracy_meters ?? null,
    distance_meters: row.distance_meters,
    is_late: Boolean(row.is_late),
    check_out_time: row.check_out_time || null,
    check_out_distance_meters: row.check_out_distance_meters ?? null,
    verification_status: row.verification_status,
    verification_notes: row.verification_notes || null,
    check_in_mode: row.check_in_mode || 'ATTENDEE_SCAN',
    host_member_id: row.host_member_id || null,
    host_member_code: row.host?.member_code || null,
    host_name: row.host?.full_name || null
  };
}

// Divisions and branches rarely change; cache them per page load so live updates
// and attendance refreshes do not refetch them every time
const lookupCache = { divisions: null, branches: null };

function invalidateLookupCache() {
  lookupCache.divisions = null;
  lookupCache.branches = null;
}

// Division and branch codes: use the admin's code, or derive one from the name
function cleanLookupCode(code, prefix, name) {
  const typed = String(code || '').trim().toUpperCase().replace(/\s+/g, '-');
  if (typed) return typed.slice(0, 50);
  const slug = String(name || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  return `${prefix}-${slug || 'NEW'}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function lookupWriteError(kind, error) {
  if (error?.code === '23505') {
    return new Error(kind === 'branch'
      ? 'A branch with this code already exists in this division.'
      : 'A division with this code already exists.');
  }
  if (error?.code === '23503') {
    return new Error(`This ${kind} still has members linked to it. Move them first.`);
  }
  return liveError(`save the ${kind}`, error);
}

// DB SERVICE
export const dbService = {
  // Check if live Supabase is active
  isUsingSupabase() {
    const config = getSupabaseConfig();
    return config.mode === 'supabase' && config.isConfigured;
  },

  // 1. DIVISIONS & BRANCHES
  async getDivisions() {
    const supabase = getSupabaseClient();
    if (supabase) {
      if (!lookupCache.divisions) {
        const { data, error } = await supabase.from('divisions').select('*').order('name');
        if (error) throw liveError('load divisions', error);
        lookupCache.divisions = data || [];
      }
      return lookupCache.divisions;
    }
    return mockDb.get('divisions');
  },

  async getBranches(divisionId = null) {
    const supabase = getSupabaseClient();
    if (supabase) {
      if (!lookupCache.branches) {
        const { data, error } = await supabase.from('branches').select('*').order('name');
        if (error) throw liveError('load branches', error);
        lookupCache.branches = data || [];
      }
      return divisionId
        ? lookupCache.branches.filter((b) => b.division_id === divisionId)
        : lookupCache.branches;
    }

    const branches = mockDb.get('branches');
    if (divisionId) {
      return branches.filter((b) => b.division_id === divisionId);
    }
    return branches;
  },

  // 2. EVENTS
  async getEvents(filters = {}) {
    const supabase = getSupabaseClient();
    if (supabase) {
      let query = supabase.from('events').select('*').order('date', { ascending: false });
      if (filters.isActive !== undefined) {
        query = query.eq('is_active', filters.isActive);
      }
      const { data, error } = await query;
      if (error) throw liveError('load events', error);
      return data || [];
    }

    let events = mockDb.get('events');
    if (filters.isActive !== undefined) {
      events = events.filter((e) => e.is_active === filters.isActive);
    }
    return events;
  },

  async getEventById(eventId) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle();
      if (error) throw liveError('load the event', error);
      return data || null;
    }

    return mockDb.get('events').find((e) => e.id === eventId) || null;
  },

  async createEvent(eventData) {
    const newEvent = {
      id: crypto.randomUUID(),
      event_code: eventData.event_code || `EVT-${Date.now().toString(36).toUpperCase()}`,
      name: eventData.name,
      date: eventData.date,
      venue: eventData.venue,
      start_time: eventData.start_time,
      end_time: eventData.end_time,
      permitted_roles: eventData.permitted_roles || 'All',
      latitude: eventData.latitude ? Number(eventData.latitude) : null,
      longitude: eventData.longitude ? Number(eventData.longitude) : null,
      radius_meters: Number(eventData.radius_meters) || 50,
      location_required: eventData.location_required ?? true,
      // Event date and times are local to the admin's timezone; the server checks the window in this zone
      timezone: eventData.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
      late_grace_minutes: Number.isFinite(Number(eventData.late_grace_minutes)) ? Number(eventData.late_grace_minutes) : 15,
      checkout_enabled: Boolean(eventData.checkout_enabled),
      is_active: eventData.is_active ?? true,
      created_at: new Date().toISOString()
    };

    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase.from('events').insert([newEvent]).select().single();
      if (error) throw liveError('create the event', error);
      return data;
    }

    const events = mockDb.get('events');
    events.unshift(newEvent);
    mockDb.save('events', events);
    return newEvent;
  },

  async updateEvent(eventId, eventData) {
    const updatePayload = {};
    if (eventData.name !== undefined) updatePayload.name = eventData.name;
    if (eventData.date !== undefined) updatePayload.date = eventData.date;
    if (eventData.venue !== undefined) updatePayload.venue = eventData.venue;
    if (eventData.start_time !== undefined) updatePayload.start_time = eventData.start_time;
    if (eventData.end_time !== undefined) updatePayload.end_time = eventData.end_time;
    if (eventData.permitted_roles !== undefined) updatePayload.permitted_roles = eventData.permitted_roles;
    if (eventData.latitude !== undefined) updatePayload.latitude = eventData.latitude !== null && eventData.latitude !== '' ? Number(eventData.latitude) : null;
    if (eventData.longitude !== undefined) updatePayload.longitude = eventData.longitude !== null && eventData.longitude !== '' ? Number(eventData.longitude) : null;
    if (eventData.radius_meters !== undefined) updatePayload.radius_meters = Number(eventData.radius_meters) || 50;
    if (eventData.location_required !== undefined) updatePayload.location_required = Boolean(eventData.location_required);
    if (eventData.late_grace_minutes !== undefined) updatePayload.late_grace_minutes = Number(eventData.late_grace_minutes) || 0;
    if (eventData.checkout_enabled !== undefined) updatePayload.checkout_enabled = Boolean(eventData.checkout_enabled);
    if (eventData.is_active !== undefined) updatePayload.is_active = Boolean(eventData.is_active);
    updatePayload.updated_at = new Date().toISOString();

    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('events')
        .update(updatePayload)
        .eq('id', eventId)
        .select()
        .single();
      if (error) throw liveError('update the event', error);
      return data;
    }

    const events = mockDb.get('events');
    const idx = events.findIndex((e) => e.id === eventId);
    if (idx !== -1) {
      events[idx] = { ...events[idx], ...updatePayload };
      mockDb.save('events', events);
      return events[idx];
    }
    return null;
  },

  async updateEventStatus(eventId, isActive) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('events').update({ is_active: isActive }).eq('id', eventId);
      if (error) throw liveError('change the event status', error);
      return true;
    }

    const events = mockDb.get('events');
    const idx = events.findIndex((e) => e.id === eventId);
    if (idx !== -1) {
      events[idx].is_active = isActive;
      mockDb.save('events', events);
      return true;
    }
    return false;
  },

  async deleteEvent(eventId) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.from('event_authorized_hosts').delete().eq('event_id', eventId);
      } catch (e) {}
      try {
        await supabase.from('attendance').delete().eq('event_id', eventId);
      } catch (e) {}

      const { error } = await supabase.from('events').delete().eq('id', eventId);
      if (error) {
        console.error('Supabase deleteEvent error:', error);
        throw new Error(error.message || 'Failed to delete event from database');
      }
      return true;
    }

    let events = mockDb.get('events');
    events = events.filter((e) => e.id !== eventId);
    mockDb.save('events', events);
    return true;
  },

  // 3. SECURE CHECK-IN SUBMISSION (Calls PostgreSQL RPC in Supabase or Local Replica)
  /**
   * Exchanges a scanned rotating host QR for a one-time scan ticket (valid 10 minutes).
   * The QR itself is accepted for about 60 seconds only, so screenshots shared later fail.
   */
  async redeemHostScan({ eventId, hostCode, windowEpoch, signature }) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase.rpc('redeem_host_scan', {
        p_event_id: eventId,
        p_host_code: hostCode,
        p_window_epoch: windowEpoch,
        p_signature: signature,
        p_user_agent: navigator.userAgent
      });
      if (error) {
        console.error('redeem_host_scan failed:', error);
        return { success: false, code: 'NETWORK_ERROR', message: 'Could not verify the QR code. Check your internet connection and scan again.' };
      }
      return data;
    }
    return this.mockRedeemHostScan({ eventId, hostCode, windowEpoch, signature });
  },

  async submitAttendance(payload) {
    const {
      eventId,
      role,
      memberCode,
      phoneNumber,
      divisionId,
      branchId,
      checkInMode, // 'ATTENDEE_SCAN' | 'HOST_SELF'
      scanTicket = null,
      hostKey = null,
      latitude = null,
      longitude = null,
      accuracy = null,
      positionAgeMs = null,
      gpsSuspicious = false,
      action = 'CHECK_IN', // 'CHECK_IN' | 'CHECK_OUT'
      userAgent = navigator.userAgent
    } = payload;

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('submit_attendance', {
          p_event_id: eventId,
          p_role: role,
          p_member_code: memberCode,
          p_phone_number: phoneNumber,
          p_division_id: divisionId,
          p_branch_id: branchId,
          p_check_in_mode: checkInMode,
          p_scan_ticket: scanTicket,
          p_host_key: hostKey,
          p_latitude: latitude ?? null,
          p_longitude: longitude ?? null,
          p_accuracy: accuracy ?? null,
          p_position_age_ms: positionAgeMs === null || positionAgeMs === undefined ? null : Math.round(positionAgeMs),
          p_gps_suspicious: Boolean(gpsSuspicious),
          p_action: action,
          p_user_agent: userAgent
        });

        if (error) {
          return { success: false, code: 'RPC_ERROR', message: error.message };
        }
        if (data && data.success && data.data?.ticket_id && !data.already_recorded) {
          this.getAttendanceRecordById(data.data.ticket_id).then((fullRec) => {
            if (fullRec) broadcastNewAttendance(fullRec);
          }).catch(() => {});
        }
        return data;
      } catch (err) {
        // Never fall back to the local engine here: that would show a pass for attendance the server never recorded
        console.error('submit_attendance RPC failed:', err);
        return {
          success: false,
          code: 'NETWORK_ERROR',
          message: 'Your attendance could not be sent to the server. Check your internet connection and try again.'
        };
      }
    }

    // LOCAL SECURE REPLICA OF THE POSTGRESQL STORED PROCEDURE
    return await this.mockSubmitAttendanceRPC(payload);
  },

  /**
   * Admin: mark a member present by hand (phone dead, GPS unavailable). Always audited.
   */
  async adminMarkAttendance(eventId, memberId, reason) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase.rpc('admin_mark_attendance', {
        p_event_id: eventId,
        p_member_id: memberId,
        p_reason: reason
      });
      if (error) throw liveError('mark attendance', error);
      return data;
    }

    const event = mockDb.get('events').find((e) => e.id === eventId);
    const members = await this.getMembers();
    const member = members.find((m) => m.id === memberId);
    if (!event || !member) return { success: false, code: 'NOT_FOUND', message: 'Event or member not found.' };
    if (!String(reason || '').trim()) return { success: false, code: 'REASON_REQUIRED', message: 'Enter a reason for the manual entry.' };

    const attendanceRecords = mockDb.get('attendance');
    if (attendanceRecords.some((a) => a.event_id === eventId && a.member_id === memberId)) {
      return { success: false, code: 'ALREADY_PRESENT', message: 'This person is already marked present for the event.' };
    }

    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      event_id: event.id,
      event_name: event.name,
      venue: event.venue,
      member_id: member.id,
      member_code: member.member_code,
      full_name: member.full_name,
      role: member.role,
      phone_number: member.phone_number,
      division_id: member.division_id,
      division_name: member.division_name,
      branch_id: member.branch_id,
      branch_name: member.branch_name,
      check_in_time: now,
      distance_meters: null,
      is_late: false,
      check_out_time: null,
      verification_status: 'MANUAL',
      verification_notes: String(reason).trim(),
      check_in_mode: 'ADMIN_MANUAL',
      created_at: now
    };
    attendanceRecords.unshift(record);
    mockDb.save('attendance', attendanceRecords);
    await this.logAudit('SUCCESS', 'ADMIN_MANUAL_ATTENDANCE', { eventId, memberId, reason: record.verification_notes });
    broadcastNewAttendance(record);
    return this.mockReceipt(record, 'CHECK_IN', false);
  },

  async mockRedeemHostScan({ eventId, hostCode, windowEpoch, signature }) {
    const event = mockDb.get('events').find((e) => e.id === eventId);
    if (!event || !event.is_active) {
      return { success: false, code: 'EVENT_INACTIVE', message: 'This event is not accepting check-ins.' };
    }
    const code = String(hostCode || '').trim().toUpperCase();
    const host = mockDb.get('event_hosts').find(
      (h) => h.event_id === eventId && h.is_active && String(h.member_code).trim().toUpperCase() === code
    );
    if (!host) {
      return { success: false, code: 'HOST_NOT_AUTHORIZED', message: 'This QR code does not belong to an authorized attendance taker for this event.' };
    }
    const verify = await verifyDynamicQrToken(eventId, hostCode, host.host_secret, windowEpoch, signature);
    if (!verify.valid) {
      return { success: false, code: verify.code, message: verify.message };
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const tickets = mockDb.get('scan_tickets').filter((t) => new Date(t.expires_at) > new Date(Date.now() - 86400000));
    const ticket = {
      id: crypto.randomUUID(),
      event_id: eventId,
      host_member_id: host.member_id,
      window_epoch: Number(windowEpoch),
      expires_at: expiresAt,
      used_at: null,
      used_by_member_id: null
    };
    tickets.push(ticket);
    mockDb.save('scan_tickets', tickets);

    return {
      success: true,
      ticket: ticket.id,
      expires_at: expiresAt,
      host_name: host.full_name,
      host_member_code: host.member_code,
      host_station: host.station_name
    };
  },

  // Replica of submit_attendance in supabase/schema.sql for demo mode
  async mockSubmitAttendanceRPC(p) {
    const now = new Date();
    const retryWindowMs = 2 * 60 * 1000;
    const action = String(p.action || 'CHECK_IN').toUpperCase();
    const mode = String(p.checkInMode || '').toUpperCase();
    const event = mockDb.get('events').find((e) => e.id === p.eventId);
    const auditLogs = mockDb.get('audit_logs');

    const reject = (code, message, memberId = null, details = {}) => {
      auditLogs.unshift({
        id: crypto.randomUUID(),
        event_id: event ? event.id : null,
        member_id: memberId,
        action: 'CHECK_IN_ATTEMPT',
        status: 'REJECTED',
        details: { ...details, code, reason: message },
        user_agent: p.userAgent || navigator.userAgent,
        created_at: now.toISOString()
      });
      mockDb.save('audit_logs', auditLogs);
      return { success: false, code, message };
    };

    // 1. Event
    if (!event) return reject('EVENT_NOT_FOUND', 'This event was not found. Scan the QR code on a staff member\'s phone again.');
    if (!event.is_active) return reject('EVENT_INACTIVE', 'This event is not accepting check-ins.');
    if (!['CHECK_IN', 'CHECK_OUT'].includes(action)) return reject('INVALID_ACTION', 'Unknown attendance action.');
    if (action === 'CHECK_OUT' && !event.checkout_enabled) return reject('CHECKOUT_DISABLED', 'Check-out is not enabled for this event.');

    // 2. Role
    if (event.permitted_roles !== 'All' && event.permitted_roles !== p.role) {
      return reject('ROLE_NOT_PERMITTED', `This event is only open for ${event.permitted_roles} attendees.`);
    }

    // 3. Member, mobile number and status
    const members = await this.getMembers();
    const member = members.find((m) =>
      m.member_code.trim().toUpperCase() === String(p.memberCode).trim().toUpperCase() &&
      m.role === p.role &&
      m.division_id === p.divisionId &&
      m.branch_id === p.branchId
    );
    if (!member) return reject('MEMBER_NOT_FOUND', 'No matching record found. Please verify your Role, Code, Division, and Branch.');

    const cleanPhone = String(p.phoneNumber || '').replace(/\D/g, '');
    if (cleanPhone.length < 10 || String(member.phone_number).replace(/\D/g, '').slice(-10) !== cleanPhone.slice(-10)) {
      return reject('PHONE_MISMATCH', 'Mobile number does not match the registered record for this employee/agent code.', member.id);
    }
    if (!member.is_active) return reject('ACCOUNT_INACTIVE', 'Your account is currently inactive. Please contact the administrator.', member.id);

    // 4. Proof of presence
    const hosts = mockDb.get('event_hosts');
    const tickets = mockDb.get('scan_tickets');
    let host = null;
    let ticket = null;
    if (mode === 'ATTENDEE_SCAN') {
      if (!p.scanTicket) return reject('SCAN_REQUIRED', 'Scan the QR code shown on a staff member\'s phone to check in.', member.id);
      ticket = tickets.find((t) => t.id === p.scanTicket && t.event_id === event.id);
      if (!ticket) return reject('INVALID_TICKET', 'Your scan could not be verified. Scan the staff member\'s QR code again.', member.id);
      if (ticket.used_at && (ticket.used_by_member_id !== member.id || now - new Date(ticket.used_at) > retryWindowMs)) {
        return reject('TICKET_USED', 'This scan was already used. Scan the live QR code on the staff member\'s phone yourself.', member.id);
      }
      if (!ticket.used_at && new Date(ticket.expires_at) < now) {
        return reject('TICKET_EXPIRED', 'More than 10 minutes passed since you scanned. Scan the staff member\'s QR code again.', member.id);
      }
      host = hosts.find((h) => h.event_id === event.id && h.member_id === ticket.host_member_id) || null;
    } else if (mode === 'HOST_SELF') {
      host = hosts.find((h) => h.event_id === event.id && h.member_id === member.id && h.is_active && p.hostKey && h.host_secret === p.hostKey);
      if (!host) return reject('HOST_NOT_AUTHORIZED', 'Host self check-in needs a valid beacon link for your own staff profile.', member.id);
    } else {
      return reject('SCAN_REQUIRED', 'Scan the QR code shown on a staff member\'s phone to check in.', member.id);
    }

    // 5. Time window (may run past midnight), duplicates
    const attendanceRecords = mockDb.get('attendance');
    const existing = attendanceRecords.find((a) => a.event_id === event.id && a.member_id === member.id);
    const checkinWindow = getEventWindow(event, now);
    let isLate = false;

    if (action === 'CHECK_IN') {
      if (existing) {
        // Already checked in: hand back the existing pass instead of an error
        if (now - new Date(existing.check_in_time) >= retryWindowMs) {
          reject('DUPLICATE_ATTENDANCE', 'Already checked in; existing pass shown.', member.id);
        }
        return this.mockReceipt(existing, 'CHECK_IN', true);
      }
      if (checkinWindow.state === 'waiting') {
        return reject('TIME_WINDOW_EARLY', `Check-in has not started yet. Opens at ${clockLabel(checkinWindow.start)} on ${event.date}.`, member.id);
      }
      if (checkinWindow.state === 'closed') {
        return reject('TIME_WINDOW_CLOSED', `Check-in closed at ${clockLabel(checkinWindow.end)} on ${checkinWindow.endDate}.`, member.id);
      }
      isLate = checkinWindow.isLate;
    } else {
      if (!existing) {
        return reject('NOT_CHECKED_IN', 'You have not checked in to this event yet, so there is nothing to check out from.', member.id);
      }
      // Check-out is allowed until the end of the day the event ends
      if (nowInZone(event.timezone || 'Asia/Kolkata', now).date > checkinWindow.endDate) {
        return reject('CHECKOUT_CLOSED', 'Check-out for this event has closed.', member.id);
      }
      if (existing.check_out_time) {
        if (now - new Date(existing.check_out_time) >= retryWindowMs) {
          reject('ALREADY_CHECKED_OUT', 'Already checked out; existing pass shown.', member.id);
        }
        return this.mockReceipt(existing, 'CHECK_OUT', true);
      }
    }

    // 6. Accuracy-aware geofence
    const geo = evaluateGeofence(event, p);
    if (!geo.ok) return reject(geo.code, geo.message, member.id, { distance: geo.distance, accuracy: p.accuracy });
    const status = geo.flags.length > 0 ? 'FLAGGED' : 'VERIFIED';

    const markTicketUsed = () => {
      if (ticket && !ticket.used_at) {
        ticket.used_at = now.toISOString();
        ticket.used_by_member_id = member.id;
        mockDb.save('scan_tickets', tickets);
      }
    };
    const logSuccess = (auditAction, details) => {
      auditLogs.unshift({
        id: crypto.randomUUID(),
        event_id: event.id,
        member_id: member.id,
        action: auditAction,
        status: status === 'FLAGGED' ? 'FLAGGED' : 'SUCCESS',
        details,
        user_agent: p.userAgent || navigator.userAgent,
        created_at: now.toISOString()
      });
      mockDb.save('audit_logs', auditLogs);
    };

    // 7A. Check-out
    if (action === 'CHECK_OUT') {
      existing.check_out_time = now.toISOString();
      existing.check_out_distance_meters = geo.distance;
      if (geo.flags.length > 0) {
        existing.verification_notes = [existing.verification_notes, `Check-out: ${geo.flags.join('; ')}`].filter(Boolean).join('; ');
      }
      mockDb.save('attendance', attendanceRecords);
      markTicketUsed();
      logSuccess('CHECK_OUT_SUCCESS', { attendance_id: existing.id, distance_meters: geo.distance, flags: geo.flags });
      broadcastNewAttendance(existing);
      return this.mockReceipt(existing, 'CHECK_OUT', false);
    }

    // 7B. Check-in
    const checkInTime = now.toISOString();
    const newAttendance = {
      id: crypto.randomUUID(),
      event_id: event.id,
      event_name: event.name,
      venue: event.venue,
      member_id: member.id,
      member_code: member.member_code,
      full_name: member.full_name,
      role: member.role,
      phone_number: member.phone_number,
      division_id: member.division_id,
      division_name: member.division_name,
      branch_id: member.branch_id,
      branch_name: member.branch_name,
      check_in_time: checkInTime,
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
      accuracy_meters: p.accuracy ?? null,
      distance_meters: geo.distance,
      is_late: isLate,
      check_out_time: null,
      verification_status: status,
      verification_notes: geo.flags.join('; ') || null,
      check_in_mode: mode,
      host_member_id: host ? host.member_id : null,
      host_member_code: host ? host.member_code : null,
      host_name: host ? host.full_name : null,
      host_station: host ? host.station_name : null,
      qr_window_epoch: ticket ? ticket.window_epoch : null,
      created_at: checkInTime
    };

    attendanceRecords.unshift(newAttendance);
    mockDb.save('attendance', attendanceRecords);
    markTicketUsed();
    logSuccess('CHECK_IN_SUCCESS', {
      attendance_id: newAttendance.id,
      check_in_mode: mode,
      host_code: host ? host.member_code : null,
      distance_meters: geo.distance,
      accuracy: p.accuracy ?? null,
      is_late: isLate,
      flags: geo.flags
    });
    broadcastNewAttendance(newAttendance);

    return this.mockReceipt(newAttendance, 'CHECK_IN', false);
  },

  // Same shape as attendance_receipt() in supabase/schema.sql
  mockReceipt(record, action, alreadyRecorded) {
    const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }) : null);
    const distance = action === 'CHECK_OUT' ? record.check_out_distance_meters : record.distance_meters;

    return {
      success: true,
      already_recorded: alreadyRecorded,
      message: action === 'CHECK_OUT' ? 'Check-out recorded successfully!' : 'Attendance verified and recorded successfully!',
      data: {
        ticket_id: record.id,
        action,
        full_name: record.full_name,
        member_code: record.member_code,
        role: record.role,
        division: record.division_name || '',
        branch: record.branch_name || '',
        event_name: record.event_name,
        venue: record.venue || '',
        check_in_mode: record.check_in_mode,
        host_name: record.host_name || null,
        host_member_code: record.host_member_code || null,
        host_station: record.host_station || null,
        check_in_time: fmt(record.check_in_time),
        check_out_time: fmt(record.check_out_time),
        is_late: Boolean(record.is_late),
        verification_status: record.verification_status || 'VERIFIED',
        distance_meters: distance === null || distance === undefined ? null : Math.round(distance)
      }
    };
  },

  // 4. ATTENDANCE QUERY & EXPORT
  async getAttendanceRecords(filters = {}) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const [divs, branches] = await Promise.all([
          this.getDivisions(),
          this.getBranches()
        ]);
        const divMap = new Map((divs || []).map((d) => [d.id, d.name]));
        const branchMap = new Map((branches || []).map((b) => [b.id, b.name]));

        const buildAttendanceQuery = () => {
          let q = supabase.from('attendance').select(ATTENDANCE_SELECT).order('check_in_time', { ascending: false });

          if (filters.eventId) q = q.eq('event_id', filters.eventId);
          // Incremental refresh: only rows checked in or checked out after the given time
          if (filters.since) q = q.or(`check_in_time.gt.${filters.since},check_out_time.gt.${filters.since}`);
          return q;
        };

        let allRecords = [];
        let from = 0;
        const pageSize = 1000;

        while (true) {
          const { data, error } = await buildAttendanceQuery().range(from, from + pageSize - 1);
          if (error) throw liveError('load attendance records', error);
          if (!data || data.length === 0) break;
          allRecords.push(...data);
          if (data.length < pageSize) break;
          from += pageSize;
        }

        // Normalize structure with enriched division and branch names
        let normalized = allRecords.map((row) => normalizeAttendanceRow(row, divMap, branchMap));

        // Apply filters in JS for role, division, branch, date, mode
        if (filters.role && filters.role !== 'All') {
          normalized = normalized.filter((r) => r.role === filters.role);
        }
        if (filters.divisionId && filters.divisionId !== 'All') {
          normalized = normalized.filter((r) => r.division_id === filters.divisionId);
        }
        if (filters.branchId && filters.branchId !== 'All') {
          normalized = normalized.filter((r) => r.branch_id === filters.branchId);
        }
        if (filters.date) {
          normalized = normalized.filter((r) => r.check_in_time && r.check_in_time.startsWith(filters.date));
        }
        if (filters.hostCode && filters.hostCode !== 'All') {
          normalized = normalized.filter((r) => r.host_member_code === filters.hostCode);
        }
        if (filters.checkInMode && filters.checkInMode !== 'All') {
          normalized = normalized.filter((r) => r.check_in_mode === filters.checkInMode);
        }

        return normalized;
      } catch (e) {
        console.error('Supabase getAttendanceRecords failed:', e);
        throw e;
      }
    }

    let records = mockDb.get('attendance');
    if (filters.eventId) {
      records = records.filter((r) => r.event_id === filters.eventId);
    }
    if (filters.role && filters.role !== 'All') {
      records = records.filter((r) => r.role === filters.role);
    }
    if (filters.divisionId && filters.divisionId !== 'All') {
      records = records.filter((r) => r.division_id === filters.divisionId);
    }
    if (filters.branchId && filters.branchId !== 'All') {
      records = records.filter((r) => r.branch_id === filters.branchId);
    }
    if (filters.date) {
      records = records.filter((r) => r.check_in_time.startsWith(filters.date));
    }
    if (filters.hostCode && filters.hostCode !== 'All') {
      records = records.filter((r) => r.host_member_code === filters.hostCode);
    }
    if (filters.checkInMode && filters.checkInMode !== 'All') {
      records = records.filter((r) => r.check_in_mode === filters.checkInMode);
    }
    if (filters.since) {
      records = records.filter((r) => r.check_in_time > filters.since || (r.check_out_time && r.check_out_time > filters.since));
    }
    return records;
  },

  async getAttendanceRecordById(id) {
    if (!id) return null;
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const [divs, branches] = await Promise.all([
          this.getDivisions(),
          this.getBranches()
        ]);
        const divMap = new Map((divs || []).map((d) => [d.id, d.name]));
        const branchMap = new Map((branches || []).map((b) => [b.id, b.name]));

        const { data, error } = await supabase
          .from('attendance')
          .select(ATTENDANCE_SELECT)
          .eq('id', id)
          .maybeSingle();

        if (error) {
          console.warn('getAttendanceRecordById Supabase error:', error);
          return null;
        }
        return data ? normalizeAttendanceRow(data, divMap, branchMap) : null;
      } catch (err) {
        console.warn('getAttendanceRecordById error:', err);
        return null;
      }
    }
    const local = mockDb.get('attendance') || [];
    return local.find((r) => r.id === id) || null;
  },

  // 4B. EVENT AUTHORIZED HOSTS (MOBILE BEACONS WITH DEVICE-LOCK)
  async getEventAuthorizedHosts(eventId) {
    const supabase = getSupabaseClient();
    if (supabase) {
      // RPC: anon cannot read members directly, so host names come from a SECURITY DEFINER function
      const { data, error } = await supabase.rpc('get_event_hosts', { p_event_id: eventId });
      if (error) throw liveError('load event hosts', error);
      return (data || []).map((row) => ({
        id: row.id,
        event_id: row.event_id,
        member_id: row.member_id,
        member_code: row.member_code,
        full_name: row.full_name,
        role: row.role,
        division_id: row.division_id,
        branch_id: row.branch_id,
        station_name: row.station_name || 'Main Entrance',
        is_active: row.is_active ?? true,
        device_id: row.device_id || null,
        device_registered_at: row.device_registered_at || null
      }));
    }
    const hosts = mockDb.get('event_hosts') || [];
    const members = mockDb.get('members');
    // Mirrors get_event_hosts: never expose host_secret on public pages
    return hosts.filter((h) => h.event_id === eventId).map(({ host_secret, ...h }) => {
      const m = members.find((mem) => mem.id === h.member_id) || {};
      return {
        ...h,
        role: m.role,
        division_id: m.division_id,
        branch_id: m.branch_id,
        device_id: h.device_id || null,
        device_registered_at: h.device_registered_at || null
      };
    });
  },

  /**
   * Admin only: beacon keys per host member, used to build each host's private beacon link
   * @returns {Promise<Map<string, string>>} member_id -> host_secret
   */
  async getEventHostKeys(eventId) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('event_authorized_hosts')
        .select('member_id, host_secret')
        .eq('event_id', eventId);
      if (error) throw liveError('load beacon links', error);
      return new Map((data || []).map((row) => [row.member_id, row.host_secret]));
    }
    const hosts = (mockDb.get('event_hosts') || []).filter((h) => h.event_id === eventId);
    return new Map(hosts.map((h) => [h.member_id, h.host_secret]));
  },

  /**
   * Binds the beacon to this phone on first use; later opens must come from the same phone.
   * The beacon key from the host's private link proves who is opening it.
   */
  async claimHostDeviceLock(eventId, hostCode, hostKey, clientDeviceId) {
    if (!eventId || !hostCode || !clientDeviceId) {
      return { success: false, error: 'INVALID_PARAMS', message: 'Missing event ID, host code, or device ID.' };
    }

    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase.rpc('host_claim_device', {
        p_event_id: eventId,
        p_host_code: hostCode,
        p_host_key: hostKey || null,
        p_device_id: clientDeviceId
      });
      if (error) throw liveError('verify this beacon', error);
      return { success: data.success, isNewLock: Boolean(data.is_new_lock), error: data.error, message: data.message };
    }

    const codeStr = String(hostCode).trim().toUpperCase();
    const host = (mockDb.get('event_hosts') || []).find(
      (h) => h.event_id === eventId && h.is_active && String(h.member_code).trim().toUpperCase() === codeStr
    );
    if (!host || !hostKey || host.host_secret !== hostKey) {
      return { success: false, error: 'INVALID_KEY', message: 'This beacon link is not valid. Ask your administrator for a new link.' };
    }

    // 1. If host has no device locked yet -> Bind this device!
    if (!host.device_id) {
      const registeredAt = new Date().toISOString();
      await this.updateHostDevice(eventId, host.member_id, clientDeviceId, registeredAt);
      host.device_id = clientDeviceId;
      host.device_registered_at = registeredAt;

      this.logAudit('SUCCESS', 'HOST_DEVICE_BOUND', {
        eventId,
        memberId: host.member_id,
        memberCode: host.member_code,
        deviceId: clientDeviceId.slice(0, 16) + '...'
      });

      return { success: true, isNewLock: true, host };
    }

    // 2. If already bound to THIS device -> Allow access
    if (host.device_id === clientDeviceId) {
      return { success: true, isNewLock: false, host };
    }

    // 3. Mismatch: Locked to another phone
    this.logAudit('REJECTED', 'HOST_DEVICE_MISMATCH', {
      eventId,
      memberId: host.member_id,
      memberCode: host.member_code,
      attemptedDevice: clientDeviceId.slice(0, 16) + '...',
      lockedDevice: host.device_id.slice(0, 16) + '...'
    });

    return {
      success: false,
      error: 'DEVICE_LOCKED',
      message: 'This attendance beacon is locked to another mobile device. If you switched phones or need to transfer this station, please contact your Administrator to unlock it.',
      host
    };
  },

  /**
   * Host's own attendance status and how many attendees checked in through this beacon
   */
  async getHostStats(eventId, hostCode, hostKey) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase.rpc('host_stats', {
        p_event_id: eventId,
        p_host_code: hostCode,
        p_host_key: hostKey || null
      });
      if (error) throw liveError('load beacon stats', error);
      return data;
    }

    const codeStr = String(hostCode).trim().toUpperCase();
    const host = (mockDb.get('event_hosts') || []).find(
      (h) => h.event_id === eventId && String(h.member_code).trim().toUpperCase() === codeStr
    );
    if (!host || host.host_secret !== hostKey) return { success: false, message: 'Invalid beacon key.' };
    const records = mockDb.get('attendance').filter((a) => a.event_id === eventId);
    const self = records.find((a) => a.member_id === host.member_id);
    return {
      success: true,
      self_checked_in: Boolean(self),
      self_check_in_time: self?.check_in_time || null,
      self_check_in_mode: self?.check_in_mode || null,
      self_distance_meters: self?.distance_meters ?? null,
      scanned_count: records.filter((a) => a.host_member_id === host.member_id && a.check_in_mode === 'ATTENDEE_SCAN').length
    };
  },

  /**
   * @returns {Promise<boolean>} true only when the lock was actually cleared
   */
  async resetHostDeviceLock(eventId, memberId) {
    if (!eventId || !memberId) return false;
    const cleared = await this.updateHostDevice(eventId, memberId, null, null);
    if (!cleared) return false;

    await this.logAudit('SUCCESS', 'HOST_DEVICE_RESET', {
      eventId,
      memberId
    });

    return true;
  },

  async updateHostDevice(eventId, memberId, deviceId, registeredAt = null) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase
        .from('event_authorized_hosts')
        .update({
          device_id: deviceId,
          device_registered_at: registeredAt || (deviceId ? new Date().toISOString() : null)
        })
        .eq('event_id', eventId)
        .eq('member_id', memberId);
      if (error) console.warn('Supabase updateHostDevice error:', error);
      return !error;
    }

    const hosts = mockDb.get('event_hosts') || [];
    const updated = hosts.map((h) => {
      if (h.event_id === eventId && h.member_id === memberId) {
        return {
          ...h,
          device_id: deviceId,
          device_registered_at: registeredAt || (deviceId ? new Date().toISOString() : null)
        };
      }
      return h;
    });
    mockDb.save('event_hosts', updated);
    return true;
  },

  async authorizeEventHosts(eventId, hostSelections) {
    const supabase = getSupabaseClient();
    const existing = supabase ? [] : (mockDb.get('event_hosts') || []);
    const otherEvents = existing.filter((h) => h.event_id !== eventId);
    const currentEventHosts = supabase
      ? await this.getEventAuthorizedHosts(eventId)
      : existing.filter((h) => h.event_id === eventId);
    const existingHostMap = new Map(currentEventHosts.map((h) => [h.member_id, h]));

    const members = await this.getMembers();
    const memberMap = new Map(members.map((m) => [m.id, m]));

    let existingKeyMap = new Map();
    try {
      existingKeyMap = await this.getEventHostKeys(eventId);
    } catch (e) {
      console.warn('Could not pre-fetch existing host keys:', e);
    }

    const newHosts = hostSelections.map((sel, idx) => {
      const member = memberMap.get(sel.memberId);
      const code = sel.memberCode || member?.member_code || `STF-${idx + 1}`;
      const name = sel.fullName || member?.full_name || 'Staff Member';
      const prevHost = existingHostMap.get(sel.memberId);
      const randomSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
      const hostSecret = existingKeyMap.get(sel.memberId) || prevHost?.host_secret || randomSecret;

      return {
        id: sel.id || prevHost?.id || crypto.randomUUID(),
        event_id: eventId,
        member_id: sel.memberId,
        member_code: code,
        full_name: name,
        station_name: sel.stationName || prevHost?.station_name || `Beacon Station #${idx + 1}`,
        host_secret: hostSecret,
        is_active: sel.isActive !== undefined ? sel.isActive : true,
        device_id: prevHost?.device_id || null,
        device_registered_at: prevHost?.device_registered_at || null,
        created_at: prevHost?.created_at || new Date().toISOString()
      };
    });

    if (!supabase) {
      mockDb.save('event_hosts', [...otherEvents, ...newHosts]);
    }

    if (supabase) {
      // Upsert saves station, active status, and guarantees host_secret is never NULL
      if (newHosts.length > 0) {
        const upsertPayload = newHosts.map((h) => ({
          event_id: h.event_id,
          member_id: h.member_id,
          station_name: h.station_name,
          host_secret: h.host_secret,
          is_active: h.is_active,
          updated_at: new Date().toISOString()
        }));
        const { error: upsertError } = await supabase
          .from('event_authorized_hosts')
          .upsert(upsertPayload, { onConflict: 'event_id,member_id' });
        if (upsertError) throw liveError('save event hosts', upsertError);
      }

      const keepIds = new Set(newHosts.map((h) => h.member_id));
      const removedIds = currentEventHosts.map((h) => h.member_id).filter((id) => !keepIds.has(id));
      if (removedIds.length > 0) {
        const { error: delError } = await supabase
          .from('event_authorized_hosts')
          .delete()
          .eq('event_id', eventId)
          .in('member_id', removedIds);
        if (delError) throw liveError('remove event hosts', delError);
      }
    }

    return newHosts;
  },

  /**
   * Admin review of a check-in (usually a FLAGGED one).
   * APPROVE marks it verified; REJECT removes it so the person can check in again properly.
   */
  async reviewAttendance(attendanceId, decision, note) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase.rpc('admin_review_attendance', {
        p_attendance_id: attendanceId,
        p_decision: decision,
        p_note: note
      });
      if (error) throw liveError('save the review', error);
      return data;
    }

    const cleanNote = String(note || '').trim();
    if (!cleanNote) return { success: false, code: 'NOTE_REQUIRED', message: 'Enter a note explaining the decision.' };
    const records = mockDb.get('attendance');
    const idx = records.findIndex((r) => r.id === attendanceId);
    if (idx === -1) return { success: false, code: 'NOT_FOUND', message: 'This attendance record no longer exists.' };

    const record = records[idx];
    if (decision === 'APPROVE') {
      record.verification_status = 'VERIFIED';
      record.verification_notes = [record.verification_notes, `Approved by admin: ${cleanNote}`].filter(Boolean).join('; ');
      broadcastNewAttendance(record);
    } else {
      records.splice(idx, 1);
      broadcastNewAttendance({ id: attendanceId, _deleted: true });
    }
    mockDb.save('attendance', records);
    await this.logAudit('SUCCESS', `ADMIN_REVIEW_${decision}`, { eventId: record.event_id, memberId: record.member_id, attendance_id: attendanceId, note: cleanNote });
    return { success: true, decision };
  },

  // 4C. DIVISIONS & BRANCHES MANAGEMENT (admin)
  async saveDivision({ id = null, code = '', name }) {
    const entry = { code: cleanLookupCode(code, 'DIV', name), name: String(name || '').trim() };
    if (!entry.name) throw new Error('Enter a division name.');

    const supabase = getSupabaseClient();
    if (supabase) {
      const query = id
        ? supabase.from('divisions').update(entry).eq('id', id)
        : supabase.from('divisions').insert([entry]);
      const { error } = await query;
      if (error) throw lookupWriteError('division', error);
      invalidateLookupCache();
      return true;
    }

    const divisions = mockDb.get('divisions');
    if (divisions.some((d) => d.code === entry.code && d.id !== id)) throw new Error('A division with this code already exists.');
    if (id) {
      const idx = divisions.findIndex((d) => d.id === id);
      if (idx !== -1) divisions[idx] = { ...divisions[idx], ...entry };
    } else {
      divisions.push({ id: crypto.randomUUID(), ...entry });
    }
    mockDb.save('divisions', divisions);
    return true;
  },

  async deleteDivision(id) {
    // Members are linked with ON DELETE RESTRICT; check first so the admin gets a clear message
    const memberCount = await this.countMembersIn('division_id', id);
    if (memberCount > 0) {
      throw new Error(`This division still has ${memberCount} member${memberCount === 1 ? '' : 's'}. Move them to another division first.`);
    }

    const supabase = getSupabaseClient();
    if (supabase) {
      // Its branches are removed with it (ON DELETE CASCADE)
      const { error } = await supabase.from('divisions').delete().eq('id', id);
      if (error) throw lookupWriteError('division', error);
      invalidateLookupCache();
      return true;
    }

    mockDb.save('divisions', mockDb.get('divisions').filter((d) => d.id !== id));
    mockDb.save('branches', mockDb.get('branches').filter((b) => b.division_id !== id));
    return true;
  },

  async saveBranch({ id = null, divisionId, code = '', name }) {
    const entry = { division_id: divisionId, code: cleanLookupCode(code, 'BR', name), name: String(name || '').trim() };
    if (!entry.division_id) throw new Error('Choose the division this branch belongs to.');
    if (!entry.name) throw new Error('Enter a branch name.');

    const supabase = getSupabaseClient();
    if (supabase) {
      const query = id
        ? supabase.from('branches').update(entry).eq('id', id)
        : supabase.from('branches').insert([entry]);
      const { error } = await query;
      if (error) throw lookupWriteError('branch', error);
      invalidateLookupCache();
      return true;
    }

    const branches = mockDb.get('branches');
    if (branches.some((b) => b.division_id === entry.division_id && b.code === entry.code && b.id !== id)) {
      throw new Error('A branch with this code already exists in this division.');
    }
    if (id) {
      const idx = branches.findIndex((b) => b.id === id);
      if (idx !== -1) branches[idx] = { ...branches[idx], ...entry };
    } else {
      branches.push({ id: crypto.randomUUID(), ...entry });
    }
    mockDb.save('branches', branches);
    return true;
  },

  async deleteBranch(id) {
    const memberCount = await this.countMembersIn('branch_id', id);
    if (memberCount > 0) {
      throw new Error(`This branch still has ${memberCount} member${memberCount === 1 ? '' : 's'}. Move them to another branch first.`);
    }

    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('branches').delete().eq('id', id);
      if (error) throw lookupWriteError('branch', error);
      invalidateLookupCache();
      return true;
    }

    mockDb.save('branches', mockDb.get('branches').filter((b) => b.id !== id));
    return true;
  },

  /**
   * Number of members (active or not) linked to a division or branch
   */
  async countMembersIn(column, id) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { count, error } = await supabase
        .from('members')
        .select('id', { count: 'exact', head: true })
        .eq(column, id);
      if (error) throw liveError('count members', error);
      return count || 0;
    }
    return mockDb.get('members').filter((m) => m[column] === id).length;
  },

  // 5. MASTER MEMBERS MANAGEMENT
  /**
   * Public roster for the check-in dropdowns: id, name and code only (no phone numbers)
   */
  async getBranchMembersForCheckin(branchId, role) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase.rpc('list_branch_members', { p_branch_id: branchId, p_role: role });
      if (error) throw liveError('load the member list', error);
      return data || [];
    }

    const members = await this.getMembers({ branchId, role, isActive: true });
    return members.map(({ id, full_name, member_code }) => ({ id, full_name, member_code }));
  },

  async getMembers(filters = {}) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const buildBaseQuery = (isNested = true) => {
          let q = supabase.from('members').select(isNested ? `
            id, role, member_code, full_name, phone_number, division_id, branch_id, is_active, created_at,
            divisions (id, name),
            branches (id, name)
          ` : `
            id, role, member_code, full_name, phone_number, division_id, branch_id, is_active, created_at
          `).order('full_name');

          if (filters.branchId && filters.branchId !== 'All') {
            q = q.eq('branch_id', filters.branchId);
          }
          if (filters.divisionId && filters.divisionId !== 'All') {
            q = q.eq('division_id', filters.divisionId);
          }
          if (filters.role && filters.role !== 'All') {
            q = q.eq('role', filters.role);
          }
          if (filters.isActive !== undefined) {
            q = q.eq('is_active', filters.isActive);
          }
          return q;
        };

        // Fetch all records across 1000-row PostgREST pages
        let allRecords = [];
        let from = 0;
        const pageSize = 1000;
        let useNested = true;

        while (true) {
          const { data, error } = await buildBaseQuery(useNested).range(from, from + pageSize - 1);
          if (error) {
            if (useNested) {
              console.warn('Nested query failed on page, falling back to flat query:', error);
              useNested = false;
              allRecords = [];
              from = 0;
              continue;
            }
            throw liveError('load members', error);
          }

          if (!data || data.length === 0) break;
          allRecords.push(...data);
          if (data.length < pageSize) break;
          from += pageSize;
        }

        if (allRecords.length > 0) {
          if (useNested) {
            return allRecords.map((m) => ({
              id: m.id,
              role: m.role,
              member_code: m.member_code,
              full_name: m.full_name,
              phone_number: m.phone_number,
              division_id: m.divisions?.id || m.division_id,
              division_name: m.divisions?.name || 'Unknown',
              branch_id: m.branches?.id || m.branch_id,
              branch_name: m.branches?.name || 'Unknown',
              is_active: m.is_active,
              created_at: m.created_at
            }));
          } else {
            const [divs, brs] = await Promise.all([this.getDivisions(), this.getBranches()]);
            const divMap = new Map(divs.map((d) => [d.id, d.name]));
            const brMap = new Map(brs.map((b) => [b.id, b.name]));
            return allRecords.map((m) => ({
              id: m.id,
              role: m.role,
              member_code: m.member_code,
              full_name: m.full_name,
              phone_number: m.phone_number,
              division_id: m.division_id,
              division_name: divMap.get(m.division_id) || 'Unknown',
              branch_id: m.branch_id,
              branch_name: brMap.get(m.branch_id) || 'Unknown',
              is_active: m.is_active,
              created_at: m.created_at
            }));
          }
        }
      } catch (e) {
        console.error('Supabase getMembers error:', e);
        throw e;
      }
      return [];
    }

    let members = mockDb.get('members');
    if (filters.branchId && filters.branchId !== 'All') {
      members = members.filter((m) => m.branch_id === filters.branchId);
    }
    if (filters.divisionId && filters.divisionId !== 'All') {
      members = members.filter((m) => m.division_id === filters.divisionId);
    }
    if (filters.role && filters.role !== 'All') {
      members = members.filter((m) => m.role === filters.role);
    }
    if (filters.isActive !== undefined) {
      members = members.filter((m) => m.is_active === filters.isActive);
    }

    const divisions = mockDb.get('divisions');
    const branches = mockDb.get('branches');

    return members.map((m) => {
      const d = divisions.find((div) => div.id === m.division_id);
      const b = branches.find((br) => br.id === m.branch_id);
      return {
        ...m,
        division_name: d ? d.name : 'Unknown',
        branch_name: b ? b.name : 'Unknown'
      };
    }).sort((a, b) => a.full_name.localeCompare(b.full_name));
  },

  async saveMember(memberData) {
    const isEdit = Boolean(memberData.id);
    const id = memberData.id || crypto.randomUUID();
    const entry = {
      id,
      role: memberData.role,
      member_code: memberData.member_code.trim().toUpperCase(),
      full_name: memberData.full_name.trim(),
      phone_number: memberData.phone_number.trim(),
      division_id: memberData.division_id,
      branch_id: memberData.branch_id,
      is_active: memberData.is_active ?? true,
      updated_at: new Date().toISOString()
    };

    const supabase = getSupabaseClient();
    let oldMember = null;
    if (supabase) {
      if (isEdit) {
        const { data: oldRow } = await supabase
          .from('members')
          .select('division_id, branch_id')
          .eq('id', id)
          .maybeSingle();
        oldMember = oldRow;

        const updatePayload = {
          role: entry.role,
          member_code: entry.member_code,
          full_name: entry.full_name,
          phone_number: entry.phone_number,
          division_id: entry.division_id,
          branch_id: entry.branch_id,
          is_active: entry.is_active,
          updated_at: entry.updated_at
        };
        const { error } = await supabase.from('members').update(updatePayload).eq('id', id);
        if (error) {
          console.error('[Supabase] Member update failed:', error);
          throw new Error('Database update failed: ' + error.message);
        }
      } else {
        const { error } = await supabase.from('members').insert([{ ...entry, created_at: new Date().toISOString() }]);
        if (error) {
          console.error('[Supabase] Member insert failed:', error);
          throw new Error('Database insert failed: ' + error.message);
        }
      }
    } else {
      const members = mockDb.get('members');
      if (isEdit) {
        const idx = members.findIndex((m) => m.id === id);
        if (idx !== -1) {
          oldMember = { ...members[idx] };
          members[idx] = { ...members[idx], ...entry };
        }
      } else {
        members.unshift({ ...entry, created_at: new Date().toISOString() });
      }
      mockDb.save('members', members);
    }

    // If an existing member was transferred to a different branch or division, write an audit log
    if (isEdit && oldMember && (oldMember.branch_id !== entry.branch_id || oldMember.division_id !== entry.division_id)) {
      try {
        const [divs, brs] = await Promise.all([this.getDivisions(), this.getBranches()]);
        const divMap = new Map(divs.map((d) => [d.id, d.name]));
        const brMap = new Map(brs.map((b) => [b.id, b.name]));
        const fromLoc = `${divMap.get(oldMember.division_id) || 'Unknown'} - ${brMap.get(oldMember.branch_id) || 'Unknown'}`;
        const toLoc = `${divMap.get(entry.division_id) || 'Unknown'} - ${brMap.get(entry.branch_id) || 'Unknown'}`;

        await this.logAudit('SUCCESS', 'BRANCH_TRANSFER', {
          member_code: entry.member_code,
          full_name: entry.full_name,
          from: fromLoc,
          to: toLoc
        });
      } catch (auditErr) {
        console.warn('Branch transfer audit log write error:', auditErr);
      }
    }

    return entry;
  },

  async toggleMemberStatus(memberId) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data: current, error: readError } = await supabase
        .from('members')
        .select('is_active')
        .eq('id', memberId)
        .single();
      if (readError) throw liveError('read the member status', readError);
      const nextStatus = !current.is_active;
      const { error } = await supabase.from('members').update({ is_active: nextStatus }).eq('id', memberId);
      if (error) throw liveError('change the member status', error);
      return nextStatus;
    }

    const members = mockDb.get('members');
    const idx = members.findIndex((m) => m.id === memberId);
    let newStatus = true;
    if (idx !== -1) {
      newStatus = !members[idx].is_active;
      members[idx].is_active = newStatus;
      mockDb.save('members', members);
    }
    return newStatus;
  },

  async deleteMember(memberId) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('members').delete().eq('id', memberId);
      if (error) throw liveError('delete the member', error);
      return true;
    }
    let members = mockDb.get('members');
    members = members.filter((m) => m.id !== memberId);
    mockDb.save('members', members);
    return true;
  },

  async bulkImportMembers(rows) {
    const supabase = getSupabaseClient();
    // Deduplicate against the real database in live mode, not the browser's demo copy
    const [existingDivisions, existingBranches, existingMembers] = supabase
      ? await Promise.all([this.getDivisions(), this.getBranches(), this.getMembers()])
      : [mockDb.get('divisions'), mockDb.get('branches'), mockDb.get('members')];
    let members = existingMembers;

    const existingCodes = new Set(members.map((m) => String(m.member_code).trim().toUpperCase()));
    const existingDivisionNames = new Map(existingDivisions.map((d) => [d.name.trim().toLowerCase(), d]));
    const existingBranchNames = new Map(existingBranches.map((b) => [`${b.division_id}::${b.name.trim().toLowerCase()}`, b]));

    const imported = [];
    let skipped = 0;
    const errors = [];
    const newDivisions = [];
    const newBranches = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const fullName = (row.fullName || row.full_name || row.name || '').trim();
      const memberCode = (row.memberCode || row.member_code || row.code || '').trim().toUpperCase();
      const role = (row.role || 'Staff').trim();
      const divisionName = (row.divisionName || row.division_name || row.division || 'Corporate Division').trim();
      const branchName = (row.branchName || row.branch_name || row.branch || 'Global Headquarters - Tower A').trim();
      const phoneNumber = String(row.phoneNumber || row.phone_number || row.phone || '').trim().replace(/\D/g, '');

      if (!fullName || !memberCode) {
        errors.push(`Row ${i + 1}: Missing Full Name or Member Code`);
        continue;
      }

      if (existingCodes.has(memberCode)) {
        skipped++;
        continue; // duplicate skip
      }

      // Division lookup or create
      let div = existingDivisionNames.get(divisionName.toLowerCase());
      if (!div) {
        div = {
          id: crypto.randomUUID(),
          code: `DIV-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`,
          name: divisionName
        };
        existingDivisions.push(div);
        newDivisions.push(div);
        existingDivisionNames.set(divisionName.toLowerCase(), div);
      }

      // Branch lookup or create
      const branchKey = `${div.id}::${branchName.toLowerCase()}`;
      let br = existingBranchNames.get(branchKey);
      if (!br) {
        br = {
          id: crypto.randomUUID(),
          division_id: div.id,
          code: `BR-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`,
          name: branchName
        };
        existingBranches.push(br);
        newBranches.push(br);
        existingBranchNames.set(branchKey, br);
      }

      const newMember = {
        id: crypto.randomUUID(),
        role: ['Staff', 'Agent'].includes(role) ? role : 'Staff',
        member_code: memberCode,
        full_name: fullName,
        phone_number: phoneNumber || '9800000000',
        division_id: div.id,
        branch_id: br.id,
        is_active: true,
        created_at: new Date().toISOString()
      };

      existingCodes.add(memberCode);
      imported.push(newMember);
    }

    if (supabase) {
      if (newDivisions.length > 0) {
        const { error } = await supabase.from('divisions').insert(newDivisions);
        if (error) throw liveError('import divisions', error);
      }
      if (newBranches.length > 0) {
        const { error } = await supabase.from('branches').insert(newBranches);
        if (error) throw liveError('import branches', error);
      }
      if (imported.length > 0) {
        const { error } = await supabase.from('members').insert(imported);
        if (error) throw liveError('import members', error);
      }
      invalidateLookupCache();
    } else {
      if (newDivisions.length > 0) {
        mockDb.save('divisions', existingDivisions);
      }
      if (newBranches.length > 0) {
        mockDb.save('branches', existingBranches);
      }
      if (imported.length > 0) {
        members = [...imported, ...members];
        mockDb.save('members', members);
      }
    }

    await this.logAudit('SUCCESS', 'BULK_MEMBER_IMPORT', {
      totalRows: rows.length,
      importedCount: imported.length,
      skippedCount: skipped,
      errorCount: errors.length
    });

    return {
      success: true,
      total: rows.length,
      imported: imported.length,
      skipped,
      errors
    };
  },

  // 6. AUDIT LOGS
  async getAuditLogs(limit = 100) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit);
      if (error) throw liveError('load audit logs', error);
      return data || [];
    }
    return mockDb.get('audit_logs').slice(0, limit);
  },

  /**
   * Best-effort audit entry. In live mode only admins can write audit_logs, so writes
   * from public pages (e.g. the host beacon) are skipped by RLS without breaking the flow.
   */
  async logAudit(status, action, details = {}) {
    const entry = {
      event_id: details.eventId || null,
      member_id: details.memberId || null,
      action,
      status,
      details,
      user_agent: navigator.userAgent
    };

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { error } = await supabase.from('audit_logs').insert([entry]);
        if (error) console.warn(`Audit log "${action}" not written:`, error.message);
      } catch (err) {
        console.warn(`Audit log "${action}" not written:`, err);
      }
      return;
    }

    const auditLogs = mockDb.get('audit_logs');
    auditLogs.unshift({ id: crypto.randomUUID(), ...entry, created_at: new Date().toISOString() });
    mockDb.save('audit_logs', auditLogs);
  },

  // 7. REAL-TIME LIVE SUBSCRIPTION
  /**
   * Subscribe to attendance inserts and updates (check-outs, manual edits).
   * Live mode: Supabase Realtime. Demo mode: in-page subscribers plus BroadcastChannel across tabs.
   * @param {(record: object) => void} callback receives the full, normalized attendance record
   * @param {{onStatus?: (status: 'live'|'offline') => void}} options
   * @returns {() => void} unsubscribe
   */
  subscribeToAttendance(callback, { onStatus } = {}) {
    const supabase = getSupabaseClient();

    if (!supabase) {
      attendanceSubscribers.add(callback);
      const onBroadcast = (event) => {
        if (event.data?.type === 'NEW_ATTENDANCE' && event.data.record) callback(event.data.record);
      };
      realtimeBroadcast?.addEventListener('message', onBroadcast);
      onStatus?.('live');
      return () => {
        attendanceSubscribers.delete(callback);
        realtimeBroadcast?.removeEventListener('message', onBroadcast);
      };
    }

    const handleChange = async (payload) => {
      try {
        const enriched = await this.getAttendanceRecordById(payload.new?.id);
        if (enriched) callback(enriched);
      } catch (e) {
        console.warn('Realtime attendance enrichment error:', e);
      }
    };
    // Rejected reviews delete the record; REPLICA IDENTITY FULL makes payload.old carry its id
    const handleDelete = (payload) => {
      if (payload.old?.id) callback({ id: payload.old.id, _deleted: true });
    };

    let channel = null;
    try {
      channel = supabase
        .channel(`attendance_live_stream_${crypto.randomUUID()}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, handleChange)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'attendance' }, handleChange)
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'attendance' }, handleDelete)
        .subscribe((status) => {
          onStatus?.(status === 'SUBSCRIBED' ? 'live' : 'offline');
        });
    } catch (err) {
      console.warn('Supabase Realtime subscription error:', err);
      onStatus?.('offline');
    }

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  },

  // 8. RESET / SEED
  resetDemoData() {
    mockDb.reset();
  }
};
