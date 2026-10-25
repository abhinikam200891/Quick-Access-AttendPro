/**
 * Unified Database Service Layer
 * Supports both live Supabase backend and an exact local mock engine with atomic RPC validation.
 */

import { calculateDistanceMeters } from './haversine.js';
import { getSupabaseClient, getSupabaseConfig } from './supabase-config.js';
import { verifyDynamicQrToken, DEFAULT_HOST_SECRET_SALT } from './dynamic-qr.js';

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
class MockDatabase {
  constructor() {
    this.init();
  }

  init() {
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
    return JSON.parse(localStorage.getItem(`db_${table}`) || '[]');
  }

  save(table, data) {
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
      const { data, error } = await supabase.from('divisions').select('*').order('name');
      if (!error && data) return data;
      console.warn('Supabase getDivisions failed, fallback to local', error);
    }
    return mockDb.get('divisions');
  },

  async getBranches(divisionId = null) {
    const supabase = getSupabaseClient();
    if (supabase) {
      let query = supabase.from('branches').select('*').order('name');
      if (divisionId) query = query.eq('division_id', divisionId);
      const { data, error } = await query;
      if (!error && data) return data;
      console.warn('Supabase getBranches failed, fallback to local', error);
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
      if (!error && Array.isArray(data)) return data;
      console.warn('Supabase getEvents failed:', error);
      if (this.isUsingSupabase()) {
        return [];
      }
    }

    let events = mockDb.get('events');
    if (filters.isActive !== undefined) {
      events = events.filter((e) => e.is_active === filters.isActive);
    }
    return events;
  },

  async getEventById(eventId, token = null) {
    const supabase = getSupabaseClient();
    if (supabase) {
      let query = supabase.from('events').select('*').eq('id', eventId);
      const { data, error } = await query.single();
      if (!error && data) {
        if (token && data.qr_token && data.qr_token !== token) {
          throw new Error('Security token mismatch. Please re-scan QR code.');
        }
        return data;
      }
    }

    const events = mockDb.get('events');
    const event = events.find((e) => e.id === eventId);
    if (!event) return null;
    if (token && event.qr_token && event.qr_token !== token) {
      throw new Error('Security token mismatch. Please re-scan QR code.');
    }
    return event;
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
      qr_token: crypto.randomUUID().replace(/-/g, ''),
      is_active: eventData.is_active ?? true,
      created_at: new Date().toISOString()
    };

    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase.from('events').insert([newEvent]).select().single();
      if (!error && data) return data;
      console.warn('Supabase createEvent failed, saving locally', error);
    }

    const events = mockDb.get('events');
    events.unshift(newEvent);
    mockDb.save('events', events);
    return newEvent;
  },

  async updateEventStatus(eventId, isActive) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('events').update({ is_active: isActive }).eq('id', eventId);
      if (!error) return true;
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
      await supabase.from('events').delete().eq('id', eventId);
    }

    let events = mockDb.get('events');
    events = events.filter((e) => e.id !== eventId);
    mockDb.save('events', events);
    return true;
  },

  // 3. SECURE CHECK-IN SUBMISSION (Calls PostgreSQL RPC in Supabase or Local Replica)
  async submitAttendance(payload) {
    const {
      eventId,
      qrToken,
      role,
      memberCode,
      phoneNumber,
      divisionId,
      branchId,
      latitude,
      longitude,
      userAgent = navigator.userAgent,
      checkInMode = 'ATTENDEE_SCAN', // 'ATTENDEE_SCAN' | 'HOST_SELF' | 'VENUE_STATIC_QR'
      hostCode = null,
      windowEpoch = null,
      tokenSignature = null
    } = payload;

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('submit_attendance', {
          p_event_id: eventId,
          p_qr_token: qrToken || '',
          p_role: role,
          p_member_code: memberCode,
          p_phone_number: phoneNumber,
          p_division_id: divisionId,
          p_branch_id: branchId,
          p_latitude: latitude || null,
          p_longitude: longitude || null,
          p_user_agent: userAgent,
          p_check_in_mode: checkInMode,
          p_host_code: hostCode,
          p_window_epoch: windowEpoch ? Number(windowEpoch) : null,
          p_token_signature: tokenSignature
        });

        if (error) {
          return { success: false, code: 'RPC_ERROR', message: error.message };
        }
        return data;
      } catch (err) {
        console.warn('RPC invocation failed, falling back to local verification', err);
      }
    }

    // LOCAL SECURE REPLICA OF THE POSTGRESQL STORED PROCEDURE
    return await this.mockSubmitAttendanceRPC(payload);
  },

  // High-fidelity replica of the PostgreSQL stored procedure with dynamic QR rotation verification
  async mockSubmitAttendanceRPC(p) {
    const events = mockDb.get('events');
    const event = events.find((e) => e.id === p.eventId);
    const auditLogs = mockDb.get('audit_logs');
    const eventHosts = mockDb.get('event_hosts');

    const logAudit = (status, action, details) => {
      auditLogs.unshift({
        id: crypto.randomUUID(),
        event_id: p.eventId,
        action,
        status,
        details,
        user_agent: p.userAgent || navigator.userAgent,
        created_at: new Date().toISOString()
      });
      mockDb.save('audit_logs', auditLogs);
    };

    // 1. Event existence
    if (!event) {
      logAudit('REJECTED', 'CHECK_IN_ATTEMPT', { reason: 'Event does not exist' });
      return { success: false, code: 'EVENT_NOT_FOUND', message: 'The requested event was not found. Please re-scan the QR code.' };
    }

    // 2. Active status
    if (!event.is_active) {
      logAudit('REJECTED', 'CHECK_IN_ATTEMPT', { reason: 'Event deactivated' });
      return { success: false, code: 'EVENT_INACTIVE', message: 'This event check-in portal has been deactivated by the administrator.' };
    }

    // Determine Check-in Mode & Host
    let host = null;
    const checkInMode = p.checkInMode || (p.hostCode ? 'ATTENDEE_SCAN' : 'VENUE_STATIC_QR');

    // 3. Dynamic QR Token & Host Verification
    if (checkInMode === 'HOST_SELF') {
      // Host is marking their own attendance directly from the Beacon screen
      host = eventHosts.find(
        (h) => h.event_id === event.id &&
               h.member_code.toUpperCase() === String(p.memberCode).trim().toUpperCase() &&
               h.is_active
      );
      if (!host) {
        logAudit('REJECTED', 'CHECK_IN_ATTEMPT', { reason: 'Unauthorized host self check-in', code: p.memberCode });
        return {
          success: false,
          code: 'HOST_NOT_AUTHORIZED',
          message: 'You are not designated as an authorized QR display host for this event.'
        };
      }
    } else if (p.hostCode) {
      // Attendee scanned a dynamic host QR code on an authorized staff member's screen
      host = eventHosts.find(
        (h) => h.event_id === event.id &&
               h.member_code.toUpperCase() === String(p.hostCode).trim().toUpperCase() &&
               h.is_active
      );
      if (!host) {
        logAudit('REJECTED', 'CHECK_IN_ATTEMPT', { reason: 'Host not recognized', hostCode: p.hostCode });
        return {
          success: false,
          code: 'HOST_NOT_AUTHORIZED',
          message: 'The staff member displaying this QR code is not registered as an authorized beacon host for this event.'
        };
      }

      // Verify dynamic rotating token validity (max 20-30s age window)
      const secret = host.host_secret || DEFAULT_HOST_SECRET_SALT;
      const verifyRes = await verifyDynamicQrToken(event.id, p.hostCode, secret, p.windowEpoch, p.tokenSignature);
      if (!verifyRes.valid) {
        logAudit('REJECTED', 'CHECK_IN_ATTEMPT', { reason: verifyRes.message, code: verifyRes.code, hostCode: p.hostCode });
        return {
          success: false,
          code: verifyRes.code,
          message: verifyRes.message
        };
      }
    } else if (event.qr_token && p.qrToken && event.qr_token !== p.qrToken) {
      // Static QR code fallback
      logAudit('REJECTED', 'CHECK_IN_ATTEMPT', { reason: 'Token mismatch' });
      return { success: false, code: 'INVALID_QR_TOKEN', message: 'Invalid or expired QR code security token. Please re-scan the live QR code.' };
    }

    // 4. Role permission
    if (event.permitted_roles !== 'All' && event.permitted_roles !== p.role) {
      logAudit('REJECTED', 'CHECK_IN_ATTEMPT', { reason: 'Role not permitted', role: p.role, permitted: event.permitted_roles });
      return { success: false, code: 'ROLE_NOT_PERMITTED', message: `This event is only open for ${event.permitted_roles} attendees.` };
    }

    // 5. Member verification
    const members = mockDb.get('members');
    const divisions = mockDb.get('divisions');
    const branches = mockDb.get('branches');

    const cleanInputPhone = String(p.phoneNumber).replace(/\D/g, '');

    const member = members.find((m) => {
      const codeMatch = m.member_code.trim().toUpperCase() === String(p.memberCode).trim().toUpperCase();
      const roleMatch = m.role === p.role;
      const divMatch = m.division_id === p.divisionId;
      const branchMatch = m.branch_id === p.branchId;
      return codeMatch && roleMatch && divMatch && branchMatch;
    });

    if (!member) {
      logAudit('REJECTED', 'CHECK_IN_ATTEMPT', { reason: 'Member profile mismatch', role: p.role, code: p.memberCode });
      return { success: false, code: 'MEMBER_NOT_FOUND', message: 'No matching record found. Please verify your Role, Code, Division, and Branch.' };
    }

    // Verify phone number (last 10 digits match)
    const memberCleanPhone = String(member.phone_number).replace(/\D/g, '');
    if (memberCleanPhone.slice(-10) !== cleanInputPhone.slice(-10)) {
      logAudit('REJECTED', 'CHECK_IN_ATTEMPT', { reason: 'Phone mismatch' });
      return { success: false, code: 'PHONE_MISMATCH', message: 'Mobile number does not match the registered record for this employee/agent code.' };
    }

    // 6. Active member status
    if (!member.is_active) {
      logAudit('REJECTED', 'CHECK_IN_ATTEMPT', { reason: 'Member account deactivated' });
      return { success: false, code: 'ACCOUNT_INACTIVE', message: 'Your account is currently inactive. Please contact your system administrator.' };
    }

    // 7. Duplicate Check (Every employee can mark attendance only once per permitted session)
    const attendanceRecords = mockDb.get('attendance');
    const existing = attendanceRecords.find((a) => a.event_id === event.id && a.member_id === member.id);
    if (existing) {
      logAudit('REJECTED', 'CHECK_IN_ATTEMPT', { reason: 'Duplicate attendance' });
      const checkInDate = new Date(existing.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const roleNote = existing.check_in_mode === 'HOST_SELF' ? 'as an authorized host' : 'as an attendee';
      return {
        success: false,
        code: 'DUPLICATE_ATTENDANCE',
        message: `Attendance was already recorded ${roleNote} for ${member.full_name} at ${checkInDate}. Duplicate submissions are strictly prohibited.`
      };
    }

    // 8. Event Date & Time Window Validation
    const now = new Date();
    const todayStr = getTodayISODate();
    if (event.date !== todayStr) {
      logAudit('REJECTED', 'CHECK_IN_ATTEMPT', { reason: 'Date mismatch', eventDate: event.date, today: todayStr });
      return { success: false, code: 'EVENT_DATE_MISMATCH', message: `This event is scheduled for ${event.date}. Check-in is not open today.` };
    }

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = event.start_time.split(':').map(Number);
    const [endH, endM] = event.end_time.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (currentMinutes < startMinutes) {
      logAudit('REJECTED', 'CHECK_IN_ATTEMPT', { reason: 'Check-in window not started' });
      return { success: false, code: 'TIME_WINDOW_EARLY', message: `Check-in has not started yet. Opens at ${event.start_time}.` };
    }

    if (currentMinutes > endMinutes) {
      logAudit('REJECTED', 'CHECK_IN_ATTEMPT', { reason: 'Check-in window closed' });
      return { success: false, code: 'TIME_WINDOW_CLOSED', message: `Check-in window closed at ${event.end_time}.` };
    }

    // 9. Location & Strict 50-metre Geofence Radius Verification (Haversine calculation)
    let distance = null;
    const allowedRadius = event.radius_meters || 50;

    if (event.location_required) {
      if (p.latitude === undefined || p.latitude === null || p.longitude === undefined || p.longitude === null) {
        logAudit('REJECTED', 'CHECK_IN_ATTEMPT', { reason: 'GPS coordinates missing' });
        return { success: false, code: 'GPS_REQUIRED', message: 'Venue GPS location verification is required. Please grant location access.' };
      }

      if (event.latitude && event.longitude) {
        distance = calculateDistanceMeters(p.latitude, p.longitude, event.latitude, event.longitude);
        if (distance > allowedRadius) {
          logAudit('REJECTED', 'CHECK_IN_ATTEMPT', { reason: 'Outside radius', distance, radius: allowedRadius });
          return {
            success: false,
            code: 'OUTSIDE_GEOFENCE',
            message: `Geofence check failed: You are ${Math.round(distance)} meters away from the venue. Strict permitted radius is ${allowedRadius} meters.`
          };
        }
      }
    }

    // 10. Record Attendance Atomically with Distinct Attribution
    const divObj = divisions.find((d) => d.id === member.division_id);
    const branchObj = branches.find((b) => b.id === member.branch_id);
    const ticketId = crypto.randomUUID();
    const checkInTime = new Date().toISOString();

    const newAttendance = {
      id: ticketId,
      event_id: event.id,
      event_name: event.name,
      member_id: member.id,
      member_code: member.member_code,
      full_name: member.full_name,
      role: member.role,
      phone_number: member.phone_number,
      division_id: member.division_id,
      division_name: divObj ? divObj.name : 'Unknown',
      branch_id: member.branch_id,
      branch_name: branchObj ? branchObj.name : 'Unknown',
      check_in_time: checkInTime,
      latitude: p.latitude || null,
      longitude: p.longitude || null,
      distance_meters: distance,
      verification_status: 'VERIFIED',
      check_in_mode: checkInMode,
      host_member_id: host ? host.member_id : null,
      host_member_code: host ? host.member_code : null,
      host_name: host ? host.full_name : null,
      host_station: host ? host.station_name : null,
      qr_window_epoch: p.windowEpoch || null,
      created_at: checkInTime
    };

    attendanceRecords.unshift(newAttendance);
    mockDb.save('attendance', attendanceRecords);

    // Trigger local cross-tab storage event & live subscribers
    try {
      localStorage.setItem('attendpro_last_attendance_event', JSON.stringify({ time: Date.now(), record: newAttendance }));
    } catch (e) {}
    broadcastNewAttendance(newAttendance);

    // 11. Audit log
    logAudit('SUCCESS', 'CHECK_IN_SUCCESS', {
      attendance_id: ticketId,
      member_name: member.full_name,
      check_in_mode: checkInMode,
      host_code: host ? host.member_code : null,
      distance_meters: distance
    });

    const verifiedByText = checkInMode === 'HOST_SELF'
      ? 'Self Check-In (Authorized Host)'
      : (host ? `Beacon Host: ${host.full_name} (${host.member_code})` : 'Venue Official QR');

    return {
      success: true,
      message: checkInMode === 'HOST_SELF' 
        ? 'Host self-attendance verified and recorded successfully!' 
        : 'Attendance verified and recorded successfully via live host beacon!',
      data: {
        ticket_id: ticketId,
        full_name: member.full_name,
        member_code: member.member_code,
        role: member.role,
        division: divObj ? divObj.name : '',
        branch: branchObj ? branchObj.name : '',
        event_name: event.name,
        venue: event.venue,
        check_in_mode: checkInMode,
        verified_by: verifiedByText,
        check_in_time: new Date(checkInTime).toLocaleString([], {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }),
        distance_meters: distance !== null ? Math.round(distance) : null
      }
    };
  },

  // 4. ATTENDANCE QUERY & EXPORT
  async getAttendanceRecords(filters = {}) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const buildAttendanceQuery = () => {
          let q = supabase.from('attendance').select(`
            id,
            check_in_time,
            latitude,
            longitude,
            distance_meters,
            verification_status,
            events (id, name, venue, date),
            members (id, role, member_code, full_name, phone_number,
              divisions (id, name),
              branches (id, name)
            )
          `).order('check_in_time', { ascending: false });

          if (filters.eventId) q = q.eq('event_id', filters.eventId);
          return q;
        };

        let allRecords = [];
        let from = 0;
        const pageSize = 1000;

        while (true) {
          const { data, error } = await buildAttendanceQuery().range(from, from + pageSize - 1);
          if (error) {
            console.warn('Supabase getAttendanceRecords failed:', error);
            break;
          }
          if (!data || data.length === 0) break;
          allRecords.push(...data);
          if (data.length < pageSize) break;
          from += pageSize;
        }

        if (allRecords.length > 0) {
          // Normalize structure
          return allRecords.map((row) => ({
            id: row.id,
            event_id: row.events?.id,
            event_name: row.events?.name,
            venue: row.events?.venue,
            member_id: row.members?.id,
            member_code: row.members?.member_code,
            full_name: row.members?.full_name,
            role: row.members?.role,
            phone_number: row.members?.phone_number,
            division_id: row.members?.divisions?.id,
            division_name: row.members?.divisions?.name,
            branch_id: row.members?.branches?.id,
            branch_name: row.members?.branches?.name,
            check_in_time: row.check_in_time,
            distance_meters: row.distance_meters,
            verification_status: row.verification_status,
            check_in_mode: row.check_in_mode || 'ATTENDEE_SCAN',
            host_member_id: row.host_member_id || null,
            host_member_code: row.host_member_code || null,
            host_name: row.host_name || null
          }));
        }
      } catch (e) {
        console.warn('Supabase getAttendanceRecords failed:', e);
      }
      if (this.isUsingSupabase()) {
        return [];
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
    return records;
  },

  // 4B. EVENT AUTHORIZED HOSTS (MOBILE BEACONS WITH DEVICE-LOCK)
  async getEventAuthorizedHosts(eventId) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('event_authorized_hosts')
          .select('*, members (id, member_code, full_name, role, phone_number, division_id, branch_id)')
          .eq('event_id', eventId);
        if (!error && data) {
          return data.map((row) => ({
            id: row.id,
            event_id: row.event_id,
            member_id: row.member_id,
            member_code: row.members?.member_code || row.member_code,
            full_name: row.members?.full_name || row.full_name,
            station_name: row.station_name || 'Main Entrance',
            host_secret: row.host_secret || DEFAULT_HOST_SECRET_SALT,
            is_active: row.is_active ?? true,
            device_id: row.device_id || null,
            device_registered_at: row.device_registered_at || null
          }));
        }
      } catch (err) {}
    }
    const hosts = mockDb.get('event_hosts') || [];
    return hosts.filter((h) => h.event_id === eventId).map((h) => ({
      ...h,
      device_id: h.device_id || null,
      device_registered_at: h.device_registered_at || null
    }));
  },

  async getAuthorizedHostByCode(eventId, hostCode) {
    if (!hostCode) return null;
    const hosts = await this.getEventAuthorizedHosts(eventId);
    const codeStr = String(hostCode).trim().toUpperCase();
    return hosts.find((h) => h.member_code && String(h.member_code).trim().toUpperCase() === codeStr && h.is_active) || null;
  },

  async claimHostDeviceLock(eventId, hostCode, clientDeviceId) {
    if (!eventId || !hostCode || !clientDeviceId) {
      return { success: false, error: 'INVALID_PARAMS', message: 'Missing event ID, host code, or device ID.' };
    }

    const host = await this.getAuthorizedHostByCode(eventId, hostCode);
    if (!host) {
      return { success: false, error: 'NOT_FOUND', message: 'Authorized host not found for this event.' };
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

  async resetHostDeviceLock(eventId, memberId) {
    if (!eventId || !memberId) return false;
    await this.updateHostDevice(eventId, memberId, null, null);

    this.logAudit('SUCCESS', 'HOST_DEVICE_RESET', {
      eventId,
      memberId
    });

    return true;
  },

  async updateHostDevice(eventId, memberId, deviceId, registeredAt = null) {
    // 1. Update Mock DB
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

    // 2. Update Supabase if connected
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase
          .from('event_authorized_hosts')
          .update({
            device_id: deviceId,
            device_registered_at: registeredAt || (deviceId ? new Date().toISOString() : null)
          })
          .eq('event_id', eventId)
          .eq('member_id', memberId);
      } catch (err) {
        console.warn('Supabase updateHostDevice error:', err);
      }
    }
    return true;
  },

  async authorizeEventHosts(eventId, hostSelections) {
    const supabase = getSupabaseClient();
    const existing = mockDb.get('event_hosts') || [];
    const otherEvents = existing.filter((h) => h.event_id !== eventId);
    const currentEventHosts = existing.filter((h) => h.event_id === eventId);
    const existingHostMap = new Map(currentEventHosts.map((h) => [h.member_id, h]));

    const members = await this.getMembers();
    const memberMap = new Map(members.map((m) => [m.id, m]));

    const newHosts = hostSelections.map((sel, idx) => {
      const member = memberMap.get(sel.memberId);
      const code = sel.memberCode || member?.member_code || `STF-${idx + 1}`;
      const name = sel.fullName || member?.full_name || 'Staff Member';
      const cleanCode = String(code).toLowerCase().replace(/[^a-z0-9]/g, '');
      const prevHost = existingHostMap.get(sel.memberId);

      return {
        id: sel.id || prevHost?.id || crypto.randomUUID(),
        event_id: eventId,
        member_id: sel.memberId,
        member_code: code,
        full_name: name,
        station_name: sel.stationName || prevHost?.station_name || `Beacon Station #${idx + 1}`,
        host_secret: sel.hostSecret || prevHost?.host_secret || `sec_${cleanCode || 'host'}_${Date.now().toString(36)}`,
        is_active: sel.isActive !== undefined ? sel.isActive : true,
        device_id: prevHost?.device_id || null,
        device_registered_at: prevHost?.device_registered_at || null,
        created_at: prevHost?.created_at || new Date().toISOString()
      };
    });

    mockDb.save('event_hosts', [...otherEvents, ...newHosts]);

    if (supabase) {
      try {
        const { error: delError } = await supabase.from('event_authorized_hosts').delete().eq('event_id', eventId);
        if (delError) console.warn('Supabase delete event_authorized_hosts warning:', delError);

        if (newHosts.length > 0) {
          const insertPayload = newHosts.map((h) => ({
            event_id: h.event_id,
            member_id: h.member_id,
            station_name: h.station_name,
            is_active: h.is_active,
            device_id: h.device_id,
            device_registered_at: h.device_registered_at
          }));
          let { error: insError } = await supabase.from('event_authorized_hosts').insert(insertPayload);

          // Graceful fallback if device_id column has not been added to Supabase yet
          if (insError && (insError.message?.includes('device_id') || insError.details?.includes('device_id') || insError.code === 'PGRST204')) {
            console.warn('device_id column not detected in Supabase event_authorized_hosts. Retrying without device columns...');
            const fallbackPayload = newHosts.map((h) => ({
              event_id: h.event_id,
              member_id: h.member_id,
              station_name: h.station_name,
              is_active: h.is_active
            }));
            const retryRes = await supabase.from('event_authorized_hosts').insert(fallbackPayload);
            insError = retryRes.error;
          }

          if (insError) {
            console.error('Supabase authorizeEventHosts insert error:', insError);
            throw new Error(insError.message || 'Failed to save hosts in Supabase');
          }
        }
      } catch (e) {
        console.error('Supabase authorizeEventHosts error:', e);
        if (this.isUsingSupabase()) {
          throw e;
        }
      }
    }

    return newHosts;
  },

  async removeEventHost(eventId, memberId) {
    const supabase = getSupabaseClient();
    let hosts = mockDb.get('event_hosts') || [];
    hosts = hosts.filter((h) => !(h.event_id === eventId && h.member_id === memberId));
    mockDb.save('event_hosts', hosts);

    if (supabase) {
      try {
        await supabase
          .from('event_authorized_hosts')
          .delete()
          .eq('event_id', eventId)
          .eq('member_id', memberId);
      } catch (e) {}
    }
    return true;
  },

  // 5. MASTER MEMBERS MANAGEMENT
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
            console.error('[Supabase] Member query error:', error);
            break;
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
      }
      if (this.isUsingSupabase()) {
        return [];
      }
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
    if (supabase) {
      if (isEdit) {
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
    }

    const members = mockDb.get('members');
    let oldMember = null;
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

    // If an existing member was transferred to a different branch or division, write an audit log
    if (isEdit && oldMember && (oldMember.branch_id !== entry.branch_id || oldMember.division_id !== entry.division_id)) {
      try {
        const [divs, brs] = await Promise.all([this.getDivisions(), this.getBranches()]);
        const divMap = new Map(divs.map((d) => [d.id, d.name]));
        const brMap = new Map(brs.map((b) => [b.id, b.name]));
        const fromLoc = `${divMap.get(oldMember.division_id) || 'Unknown'} - ${brMap.get(oldMember.branch_id) || 'Unknown'}`;
        const toLoc = `${divMap.get(entry.division_id) || 'Unknown'} - ${brMap.get(entry.branch_id) || 'Unknown'}`;

        const auditLogs = mockDb.get('audit_logs');
        auditLogs.unshift({
          id: crypto.randomUUID(),
          action: 'BRANCH_TRANSFER',
          status: 'SUCCESS',
          details: {
            member_code: entry.member_code,
            full_name: entry.full_name,
            from: fromLoc,
            to: toLoc
          },
          user_agent: navigator.userAgent,
          created_at: new Date().toISOString()
        });
        mockDb.save('audit_logs', auditLogs);

        if (supabase) {
          await supabase.from('audit_logs').insert([{
            action: 'BRANCH_TRANSFER',
            status: 'SUCCESS',
            details: {
              member_code: entry.member_code,
              full_name: entry.full_name,
              from: fromLoc,
              to: toLoc
            },
            user_agent: navigator.userAgent
          }]);
        }
      } catch (auditErr) {
        console.warn('Branch transfer audit log write error:', auditErr);
      }
    }

    return entry;
  },

  async toggleMemberStatus(memberId) {
    const supabase = getSupabaseClient();
    const members = mockDb.get('members');
    const idx = members.findIndex((m) => m.id === memberId);
    let newStatus = true;
    if (idx !== -1) {
      newStatus = !members[idx].is_active;
      members[idx].is_active = newStatus;
      mockDb.save('members', members);
    }

    if (supabase) {
      await supabase.from('members').update({ is_active: newStatus }).eq('id', memberId);
    }
    return newStatus;
  },

  async deleteMember(memberId) {
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.from('members').delete().eq('id', memberId);
    }
    let members = mockDb.get('members');
    members = members.filter((m) => m.id !== memberId);
    mockDb.save('members', members);
    return true;
  },

  async bulkImportMembers(rows) {
    const supabase = getSupabaseClient();
    const existingDivisions = mockDb.get('divisions');
    const existingBranches = mockDb.get('branches');
    let members = mockDb.get('members');

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

    // Supabase sync if connected
    if (supabase) {
      try {
        if (newDivisions.length > 0) {
          await supabase.from('divisions').insert(newDivisions);
        }
        if (newBranches.length > 0) {
          await supabase.from('branches').insert(newBranches);
        }
        if (imported.length > 0) {
          await supabase.from('members').insert(imported);
        }
      } catch (err) {
        console.warn('Supabase bulkImport error:', err);
      }
    }

    // Audit Log
    const auditLogs = mockDb.get('audit_logs');
    auditLogs.unshift({
      id: crypto.randomUUID(),
      action: 'BULK_MEMBER_IMPORT',
      status: 'SUCCESS',
      details: {
        totalRows: rows.length,
        importedCount: imported.length,
        skippedCount: skipped,
        errorCount: errors.length
      },
      user_agent: navigator.userAgent,
      created_at: new Date().toISOString()
    });
    mockDb.save('audit_logs', auditLogs);

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
      if (!error && data) return data;
    }
    return mockDb.get('audit_logs').slice(0, limit);
  },

  // 7. REAL-TIME LIVE SUBSCRIPTION
  async getAttendanceRecordById(id) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase.from('attendance').select(`
          id, check_in_time, latitude, longitude, distance_meters, verification_status,
          events (id, name, venue, date),
          members (id, role, member_code, full_name, phone_number,
            divisions (id, name),
            branches (id, name)
          )
        `).eq('id', id).single();
        if (!error && data) {
          return {
            id: data.id,
            event_id: data.events?.id,
            event_name: data.events?.name,
            venue: data.events?.venue,
            member_id: data.members?.id,
            member_code: data.members?.member_code,
            full_name: data.members?.full_name,
            role: data.members?.role,
            phone_number: data.members?.phone_number,
            division_id: data.members?.divisions?.id,
            division_name: data.members?.divisions?.name,
            branch_id: data.members?.branches?.id,
            branch_name: data.members?.branches?.name,
            check_in_time: data.check_in_time,
            distance_meters: data.distance_meters,
            verification_status: data.verification_status
          };
        }
      } catch (e) {}
    }
    const records = mockDb.get('attendance');
    return records.find((r) => r.id === id) || null;
  },

  /**
   * Subscribe to new real-time attendance events (Supabase Realtime + local BroadcastChannel)
   */
  subscribeToAttendance(callback) {
    attendanceSubscribers.add(callback);

    if (realtimeBroadcast) {
      realtimeBroadcast.onmessage = (event) => {
        if (event.data?.type === 'NEW_ATTENDANCE' && event.data.record) {
          callback(event.data.record);
        }
      };
    }

    const storageListener = (e) => {
      if (e.key === 'attendpro_last_attendance_event' && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue);
          if (payload?.record) callback(payload.record);
        } catch (err) {}
      }
    };
    window.addEventListener('storage', storageListener);

    // Supabase Realtime channel subscription
    const supabase = getSupabaseClient();
    let supabaseChannel = null;
    if (supabase) {
      try {
        supabaseChannel = supabase
          .channel('attendance_live_stream')
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'attendance' },
            async (payload) => {
              const enriched = await this.getAttendanceRecordById(payload.new.id) || payload.new;
              callback(enriched);
            }
          )
          .subscribe();
      } catch (err) {
        console.warn('Supabase Realtime subscription error:', err);
      }
    }

    return () => {
      attendanceSubscribers.delete(callback);
      window.removeEventListener('storage', storageListener);
      if (supabase && supabaseChannel) {
        supabase.removeChannel(supabaseChannel);
      }
    };
  },

  /**
   * Simulates an instant verified check-in for real-time demo & testing
   */
  async simulateRandomCheckIn(targetEventId = null) {
    const events = await this.getEvents({ isActive: true });
    if (events.length === 0) {
      return { success: false, message: 'No active events found.' };
    }

    const event = targetEventId ? (events.find((e) => e.id === targetEventId) || events[0]) : events[0];
    const members = await this.getMembers({ isActive: true });
    const attendance = await this.getAttendanceRecords({ eventId: event.id });
    const attendedMemberIds = new Set(attendance.map((a) => a.member_id));

    // Find candidate members eligible for this event who haven't checked in yet
    const eligibleMembers = members.filter((m) => {
      if (attendedMemberIds.has(m.id)) return false;
      if (event.permitted_roles !== 'All' && m.role !== event.permitted_roles) return false;
      return true;
    });

    if (eligibleMembers.length === 0) {
      return { success: false, message: `All eligible members have already checked in for "${event.name}"!` };
    }

    // Pick a random eligible member
    const member = eligibleMembers[Math.floor(Math.random() * eligibleMembers.length)];
    const divisions = await this.getDivisions();
    const branches = await this.getBranches();
    const divObj = divisions.find((d) => d.id === member.division_id);
    const branchObj = branches.find((b) => b.id === member.branch_id);

    // Realistic distance within allowed radius
    const maxRadius = event.radius_meters || 50;
    const distance = Math.round((Math.random() * (maxRadius * 0.7) + 3) * 10) / 10;
    const now = new Date();
    const ticketId = crypto.randomUUID();

    const record = {
      id: ticketId,
      event_id: event.id,
      event_name: event.name,
      venue: event.venue,
      member_id: member.id,
      member_code: member.member_code,
      full_name: member.full_name,
      role: member.role,
      phone_number: member.phone_number,
      division_id: member.division_id,
      division_name: divObj ? divObj.name : 'Corporate Division',
      branch_id: member.branch_id,
      branch_name: branchObj ? branchObj.name : 'HQ Branch',
      check_in_time: now.toISOString(),
      latitude: event.latitude ? event.latitude + (Math.random() - 0.5) * 0.0002 : null,
      longitude: event.longitude ? event.longitude + (Math.random() - 0.5) * 0.0002 : null,
      distance_meters: distance,
      verification_status: 'VERIFIED',
      created_at: now.toISOString()
    };

    const attendanceRecords = mockDb.get('attendance');
    attendanceRecords.unshift(record);
    mockDb.save('attendance', attendanceRecords);

    const auditLogs = mockDb.get('audit_logs');
    auditLogs.unshift({
      id: crypto.randomUUID(),
      event_id: event.id,
      member_id: member.id,
      action: 'CHECK_IN_SUCCESS',
      status: 'SUCCESS',
      details: { attendance_id: ticketId, member_name: member.full_name, distance_meters: distance, simulated: true },
      user_agent: 'Simulated Live Stream',
      created_at: now.toISOString()
    });
    mockDb.save('audit_logs', auditLogs);

    try {
      localStorage.setItem('attendpro_last_attendance_event', JSON.stringify({ time: Date.now(), record }));
    } catch (e) {}

    broadcastNewAttendance(record);

    return {
      success: true,
      record,
      message: `${member.full_name} (${member.member_code}) checked in live!`
    };
  },

  // 8. RESET / SEED
  resetDemoData() {
    mockDb.reset();
  }
};
