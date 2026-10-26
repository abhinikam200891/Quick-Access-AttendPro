/**
 * Admin Portal Controller
 * Full management dashboard for Events, QR Codes, Live Attendance, Master Records, and Supabase Settings.
 */

import QRCode from 'qrcode';
import { dbService } from './db-service.js';
import { getCurrentPosition } from './haversine.js';
import { getSupabaseConfig, saveSupabaseConfig, setRunMode, testSupabaseConnection } from './supabase-config.js';
import { initVisualAnalytics, updateVisualAnalytics, populateAnalyticsEventFilter } from './admin-analytics.js';
import { soundController } from './audio-chime.js';
import { initAdminGeofencePicker } from './geo-map.js';
import { formatWindow, isOvernight, validateEventTimes } from './event-window.js';
import { initAdminAuth } from './admin-auth.js';

// Application State
const state = {
  currentTab: 'events',
  events: [],
  attendance: [],
  members: [],
  divisions: [],
  branches: [],
  auditLogs: [],
  selectedEventForHosts: null,
  attendanceView: 'present', // 'present' | 'pending'
  liveStatus: 'offline', // 'live' | 'offline' (polling)
  lastSyncAt: null, // ISO time of the newest change seen, for incremental polling
  pendingManualMark: null, // { eventId, memberId } while the manual-mark modal is open
  pendingReviewId: null, // attendance id while the review modal is open
  activeFilters: {
    eventId: '',
    checkInMode: 'All',
    status: 'All',
    role: 'All',
    divisionId: 'All',
    branchId: 'All',
    date: '',
    search: ''
  },
  memberFilters: {
    role: 'All',
    divisionId: 'All',
    branchId: 'All',
    status: 'All',
    memberId: 'All',
    search: ''
  }
};

// UI Notification Helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button style="background:none;border:none;color:currentColor;cursor:pointer;font-size:16px;">&times;</button>
  `;

  toast.querySelector('button').onclick = () => toast.remove();
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Formatters
function formatDate(isoDate) {
  if (!isoDate) return 'N/A';
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// -----------------------------------------------------------------------------
// INITIALIZATION WITH SECURE ADMIN AUTH
// -----------------------------------------------------------------------------
let isPortalInitialized = false;

export async function initAdminPortal() {
  setupAccountMenu();
  await initAdminAuth({
    onLoginSuccess: async (user) => {
      if (!isPortalInitialized) {
        setupTabs();
        setupEventListeners();
        isPortalInitialized = true;
      }
      updateEnvBadge();
      await refreshAllData();
      renderKpis();
      initVisualAnalytics(state);
      setupRealtimeFeed();
      setupLiveStreamControls();
    },
    onLogout: () => {
      stopRealtimeFeed();
    }
  });
}

/**
 * Account drop-down in the top bar (Settings, Install App, Sign Out)
 */
function setupAccountMenu() {
  const trigger = document.getElementById('btnAccountMenu');
  const menu = document.getElementById('accountMenu');
  if (!trigger || !menu) return;

  const setOpen = (open) => {
    menu.classList.toggle('is-hidden', !open);
    trigger.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('.account-menu-item')?.focus();
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(menu.classList.contains('is-hidden'));
  });
  // Any item closes the menu; its own click handler still runs
  menu.addEventListener('click', (e) => {
    if (e.target.closest('.account-menu-item')) setOpen(false);
  });
  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('is-hidden') && !e.target.closest('#accountMenuWrap')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.classList.contains('is-hidden')) {
      setOpen(false);
      trigger.focus();
    }
  });
}

function updateEnvBadge() {
  const config = getSupabaseConfig();
  const badge = document.getElementById('envBadge');
  const dot = document.getElementById('envDot');
  const label = document.getElementById('envLabel');

  if (!badge) return;

  // Short label for phones, same pattern as the tab labels
  const setLabel = (full, short) => {
    label.innerHTML = `<span class="env-label-full">${full}</span><span class="env-label-short">${short}</span>`;
    badge.title = full;
  };
  if (config.mode === 'supabase' && config.isConfigured) {
    dot.className = 'env-indicator-dot';
    setLabel('Supabase Connected', 'Live');
  } else {
    dot.className = 'env-indicator-dot demo';
    setLabel('Test Mode (Local Storage)', 'Test mode');
  }
}

// -----------------------------------------------------------------------------
// TAB NAVIGATION
// -----------------------------------------------------------------------------
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      state.currentTab = target;

      document.querySelectorAll('.tab-content-panel').forEach((panel) => {
        const isMatch = panel.id === `tab-${target}`;
        panel.classList.toggle('active', isMatch);
        panel.style.display = isMatch ? 'block' : 'none';
      });

      if (target === 'attendance') renderAttendanceTable();
      if (target === 'analytics') updateVisualAnalytics(state);
      if (target === 'events') renderEventsGrid();
      if (target === 'masters') renderMembersTable();
      if (target === 'audit') renderAuditLogsTable();
    });
  });

  // Ensure active tab panel is visible on initial page load
  const activeTabBtn = document.querySelector('.tab-btn.active') || tabs[0];
  const initialTarget = activeTabBtn?.dataset.tab || 'events';
  document.querySelectorAll('.tab-content-panel').forEach((panel) => {
    const isMatch = panel.id === `tab-${initialTarget}`;
    panel.classList.toggle('active', isMatch);
    panel.style.display = isMatch ? 'block' : 'none';
  });
}

// -----------------------------------------------------------------------------
// DATA LOADING
// -----------------------------------------------------------------------------
async function refreshAllData() {
  try {
    // Load in parallel; one failing source must not blank the whole dashboard
    const sources = [
      ['divisions', () => dbService.getDivisions()],
      ['branches', () => dbService.getBranches()],
      ['events', () => dbService.getEvents()],
      ['attendance', () => dbService.getAttendanceRecords()],
      ['members', () => dbService.getMembers()],
      ['auditLogs', () => dbService.getAuditLogs(100)]
    ];
    const results = await Promise.allSettled(sources.map(([, load]) => load()));
    const failures = [];
    results.forEach((result, idx) => {
      const [key] = sources[idx];
      if (result.status === 'fulfilled') {
        state[key] = result.value || [];
      } else {
        console.error(`Failed to load ${key}:`, result.reason);
        failures.push(result.reason?.message || key);
      }
    });
    if (failures.length > 0) {
      showToast(failures[0], 'error');
    }
    state.lastSyncAt = latestChangeTime(state.attendance);

    populateFilterDropdowns();
    populateMemberFilterDropdowns();
    populateAnalyticsEventFilter(state.events);
    renderKpis();
    renderEventsGrid();
    renderAttendanceTable();
    renderMembersTable();
    renderAuditLogsTable();
    updateVisualAnalytics(state);
  } catch (err) {
    console.error('Data refresh error:', err);
    showToast('Failed to load data. Please check network or settings.', 'error');
  }
}

function renderKpis() {
  const totalEventsEl = document.getElementById('kpiTotalEvents');
  const activeEventsEl = document.getElementById('kpiActiveEvents');
  const totalAttendanceEl = document.getElementById('kpiTotalAttendance');
  const totalMembersEl = document.getElementById('kpiTotalMembers');

  if (totalEventsEl) totalEventsEl.textContent = state.events.length;
  if (activeEventsEl) activeEventsEl.textContent = state.events.filter((e) => e.is_active).length;
  if (totalAttendanceEl) totalAttendanceEl.textContent = state.attendance.length;
  if (totalMembersEl) totalMembersEl.textContent = state.members.filter((m) => m.is_active).length;
}

// -----------------------------------------------------------------------------
// EVENT MANAGEMENT
// -----------------------------------------------------------------------------
function renderEventsGrid() {
  const container = document.getElementById('eventsGrid');
  if (!container) return;

  if (state.events.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon"><i data-lucide="calendar"></i></div>
        <div class="empty-state-title">No Events Created Yet</div>
        <p>Click "Create New Event" above to schedule your first QR-coded attendance session.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.events
    .map((event) => {
      const isPast = new Date(event.date + 'T23:59:59') < new Date();
      const statusBadge = event.is_active
        ? '<span class="badge badge-success">Active</span>'
        : '<span class="badge badge-neutral">Inactive</span>';
      const checkedIn = state.attendance.filter((a) => a.event_id === event.id).length;

      return `
      <div class="event-card ${!event.is_active ? 'inactive' : ''}">
        <div>
          <div class="event-card-header">
            <div>
              <h3 class="event-name">${escapeHtml(event.name)}</h3>
              <span class="event-code-pill">${event.event_code}</span>
            </div>
            ${statusBadge}
          </div>

          <div class="event-checkin-count">
            <strong>${checkedIn}</strong> checked in
          </div>

          <div class="event-meta">
            <div class="event-meta-row">
              <span><i data-lucide="map-pin"></i></span>
              <strong>${escapeHtml(event.venue)}</strong>
            </div>
            <div class="event-meta-row">
              <span><i data-lucide="calendar-days"></i></span>
              <span>${formatDate(event.date)} &bull; ${formatWindow(event)}</span>
            </div>
            <div class="event-meta-row">
              <span><i data-lucide="users"></i></span>
              <span>Permitted Attendees: <strong>${event.permitted_roles}</strong></span>
            </div>
            <div class="event-meta-row">
              <span><i data-lucide="crosshair"></i></span>
              <span>Radius: <strong>${event.radius_meters}m</strong> ${event.location_required ? '(GPS Enforced)' : '(GPS Optional)'}</span>
            </div>
            <div class="event-meta-row">
              <span><i data-lucide="alarm-clock"></i></span>
              <span>Late after <strong>${event.late_grace_minutes ?? 15} min</strong> &bull; Check-out ${event.checkout_enabled ? '<strong>on</strong>' : 'off'}</span>
            </div>
            ${event.location_required && !hasVenueCoordinates(event) ? `
            <div class="event-meta-row" style="color:var(--accent-rose);">
              <span><i data-lucide="triangle-alert"></i></span>
              <span>Venue GPS not set: check-ins will be rejected</span>
            </div>` : ''}
          </div>
        </div>

        <div class="event-card-actions">
          <button class="btn btn-primary btn-sm btn-manage-hosts" data-id="${event.id}" title="Assign staff members who will take attendance using mobile rotating QR beacons">
            <i data-lucide="users"></i> Attendance Takers
          </button>
          <button class="btn btn-secondary btn-sm btn-edit-event" data-id="${event.id}" title="Edit event date, time, venue, permitted roles, and GPS geofence radius">
            <i data-lucide="pencil"></i> Edit
          </button>
          <button class="btn btn-ghost btn-sm btn-toggle-status" data-id="${event.id}">
            ${event.is_active ? '<i data-lucide="pause"></i> Deactivate' : '<i data-lucide="play"></i> Activate'}
          </button>
        </div>
      </div>
    `;
    })
    .join('');

  // Attach card event listeners
  container.querySelectorAll('.btn-manage-hosts').forEach((btn) => {
    btn.onclick = () => openHostsModal(btn.dataset.id);
  });

  container.querySelectorAll('.btn-edit-event').forEach((btn) => {
    btn.onclick = () => openEventForm(btn.dataset.id);
  });

  container.querySelectorAll('.btn-toggle-status').forEach((btn) => {
    btn.onclick = async () => {
      const event = state.events.find((e) => e.id === btn.dataset.id);
      if (!event) return;
      const newStatus = !event.is_active;
      if (newStatus && event.location_required && !hasVenueCoordinates(event)) {
        showToast('Set the venue GPS location (Edit event) before activating: every check-in would be rejected without it.', 'error');
        return;
      }
      try {
        await dbService.updateEventStatus(event.id, newStatus);
      } catch (err) {
        showToast(err.message, 'error');
        return;
      }
      showToast(`Event status updated to ${newStatus ? 'Active' : 'Inactive'}`, 'success');
      await refreshAllData();
    };
  });
}

let pendingEventIdToDelete = null;

function openDeleteEventModal(eventId) {
  const event = state.events.find((e) => e.id === eventId);
  if (!event) return;

  pendingEventIdToDelete = event.id;
  const modal = document.getElementById('deleteEventConfirmModal');
  const nameEl = document.getElementById('deleteEventConfirmName');
  if (nameEl) nameEl.textContent = `"${event.name}"`;

  if (modal) modal.classList.add('active');
}

// Today's date in the admin's own timezone (toISOString would give the UTC date)
function localTodayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Shows under the time fields whether the window runs into the next day, or why it is invalid
 */
function updateEventWindowHint() {
  const hint = document.getElementById('eventWindowHint');
  if (!hint) return;
  const start = document.getElementById('editEventStartTime').value;
  const end = document.getElementById('editEventEndTime').value;
  const error = validateEventTimes(start, end);
  if (error) {
    hint.textContent = start && end ? `${error}` : '';
    hint.style.color = 'var(--accent-rose)';
  } else if (isOvernight({ start_time: start, end_time: end })) {
    hint.textContent = `Overnight event: check-in closes at ${end} on the next day.`;
    hint.style.color = 'var(--text-secondary)';
  } else {
    hint.textContent = '';
  }
}

/**
 * One form for creating (eventId = null) and editing events
 */
function openEventForm(eventId = null) {
  const event = eventId ? state.events.find((e) => e.id === eventId) : null;
  if (eventId && !event) return;

  const modal = document.getElementById('editEventModal');
  if (!modal) return;
  const isCreate = !event;

  document.getElementById('eventModalTitle').textContent = isCreate ? 'Create Attendance Event' : 'Edit Attendance Event';
  document.getElementById('btnSaveEditedEvent').textContent = isCreate ? 'Create Event' : 'Save Changes';
  document.getElementById('btnDeleteFromEditModal').classList.toggle('is-hidden', isCreate);

  document.getElementById('editEventId').value = event?.id || '';
  document.getElementById('editEventName').value = event?.name || '';
  document.getElementById('editEventVenue').value = event?.venue || '';
  document.getElementById('editEventDate').value = event?.date || localTodayISO();
  document.getElementById('editEventPermittedRoles').value = event?.permitted_roles || 'All';
  document.getElementById('editEventStartTime').value = (event?.start_time || '08:00').slice(0, 5);
  document.getElementById('editEventEndTime').value = (event?.end_time || '20:00').slice(0, 5);
  document.getElementById('editEventRadius').value = event?.radius_meters || 50;
  document.getElementById('editEventLocationRequired').checked = isCreate ? true : Boolean(event.location_required);
  document.getElementById('editEventLateGrace').value = event?.late_grace_minutes ?? 15;
  document.getElementById('editEventCheckoutEnabled').checked = Boolean(event?.checkout_enabled);
  updateEventWindowHint();

  const hasCoords = event && hasVenueCoordinates(event);
  const lat = hasCoords ? Number(event.latitude) : 28.6139;
  const lng = hasCoords ? Number(event.longitude) : 77.2090;
  document.getElementById('editEventLatitude').value = hasCoords ? event.latitude : '';
  document.getElementById('editEventLongitude').value = hasCoords ? event.longitude : '';

  modal.classList.add('active');

  setTimeout(() => {
    const latInput = document.getElementById('editEventLatitude');
    const lngInput = document.getElementById('editEventLongitude');
    const radInput = document.getElementById('editEventRadius');
    const radius = parseInt(radInput?.value, 10) || 50;

    if (!state.editGeofencePicker) {
      state.editGeofencePicker = initAdminGeofencePicker('editGeofenceMap', {
        latitude: lat,
        longitude: lng
      }, radius, (coords) => {
        if (latInput) latInput.value = coords.latitude.toFixed(6);
        if (lngInput) lngInput.value = coords.longitude.toFixed(6);
      });
    } else {
      state.editGeofencePicker.setCoordinates(lat, lng);
      state.editGeofencePicker.setRadius(radius);
      state.editGeofencePicker.invalidateSize();
      // Moving the pin fills the coordinate boxes; keep them empty when the venue is not set yet,
      // so the map's default position is never saved as the venue by accident
      if (!hasCoords) {
        latInput.value = '';
        lngInput.value = '';
      }
    }
  }, 150);
}

async function openHostLinkQr(link, name, station) {
  const modal = document.getElementById('hostLinkQrModal');
  document.getElementById('hostLinkQrName').textContent = name;
  document.getElementById('hostLinkQrStation').textContent = station || '';
  const linkInput = document.getElementById('hostLinkQrUrl');
  linkInput.value = link;
  try {
    await QRCode.toCanvas(document.getElementById('hostLinkQrCanvas'), link, {
      width: 260,
      margin: 2,
      errorCorrectionLevel: 'M'
    });
  } catch (err) {
    showToast('Could not draw the QR code. Copy the link instead.', 'error');
  }
  document.getElementById('btnCopyHostLinkQrUrl').onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      showToast('Private link copied.', 'info');
    } catch (err) {
      linkInput.select();
    }
  };
  modal.classList.add('active');
}

// Late grace is optional: an empty field means the 15-minute default, 0 means late right after start
function readLateGrace(inputId) {
  const raw = document.getElementById(inputId)?.value.trim();
  if (!raw) return 15;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes) : 15;
}

function hasVenueCoordinates(event) {
  const isSet = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));
  return isSet(event.latitude) && isSet(event.longitude);
}

// -----------------------------------------------------------------------------
// AUTHORIZED STAFF ROTATING QR BEACONS (MOBILE HOSTS)
// -----------------------------------------------------------------------------
async function openHostsModal(eventId) {
  const event = state.events.find((e) => e.id === eventId);
  if (!event) return;
  state.selectedEventForHosts = event;

  const modal = document.getElementById('hostsModal');
  const subtitleEl = document.getElementById('hostsModalEventSubtitle');
  const tbody = document.getElementById('hostsTableBody');
  const searchInput = document.getElementById('hostsSearchInput');
  const countBadge = document.getElementById('hostsSelectedCount');
  const btnFilterAuth = document.getElementById('btnFilterAuthorizedHosts');
  const btnFilterAll = document.getElementById('btnFilterAllHosts');
  const tabAuthBadge = document.getElementById('hostsAuthTabCount');
  const tabAllBadge = document.getElementById('hostsAllStaffTabCount');
  const btnSelectAll = document.getElementById('btnSelectAllHosts');
  const btnDeselectAll = document.getElementById('btnDeselectAllHosts');

  if (subtitleEl) {
    subtitleEl.textContent = `Event: ${event.name} (${event.venue}) • Choose who takes attendance with a staff QR`;
  }
  if (searchInput) searchInput.value = '';

  // Get currently authorized hosts and their private beacon keys for this event
  let authorizedHosts = [];
  let hostKeys = new Map();
  try {
    [authorizedHosts, hostKeys] = await Promise.all([
      dbService.getEventAuthorizedHosts(eventId),
      dbService.getEventHostKeys(eventId)
    ]);
  } catch (err) {
    showToast(err.message, 'error');
    return;
  }
  const authMap = new Map();
  authorizedHosts.forEach((h) => {
    authMap.set(h.member_id, h);
  });

  // Filter all staff members from state
  const staffMembers = state.members.filter((m) => m.role === 'Staff');

  // Maintain working state: memberId -> { isChecked, station, deviceId, deviceRegisteredAt }
  const workingState = new Map();
  staffMembers.forEach((m) => {
    const existing = authMap.get(m.id);
    workingState.set(m.id, {
      isChecked: existing ? existing.is_active !== false : false,
      station: existing?.station_name || 'Main Gate',
      deviceId: existing?.device_id || null,
      deviceRegisteredAt: existing?.device_registered_at || null
    });
  });

  const getAuthorizedCount = () => Array.from(workingState.values()).filter((v) => v.isChecked).length;

  // Initial view mode: if any staff are authorized, open to 'authorized' tab directly; else 'all'
  let currentMode = getAuthorizedCount() > 0 ? 'authorized' : 'all';

  function updateViewTabButtons() {
    if (btnFilterAuth) btnFilterAuth.classList.toggle('active', currentMode === 'authorized');
    if (btnFilterAll) btnFilterAll.classList.toggle('active', currentMode === 'all');
    if (btnSelectAll) btnSelectAll.style.display = currentMode === 'all' ? 'inline-flex' : 'none';
  }

  function updateAuthCount() {
    const totalChecked = getAuthorizedCount();
    if (countBadge) {
      countBadge.textContent = `${totalChecked} Authorized`;
      countBadge.className = totalChecked > 0 ? 'badge badge-success' : 'badge badge-neutral';
    }
    if (tabAuthBadge) tabAuthBadge.textContent = totalChecked;
    if (tabAllBadge) tabAllBadge.textContent = staffMembers.length;
  }

  function renderRows(filterText = '') {
    updateAuthCount();
    updateViewTabButtons();

    let staffList = staffMembers;
    if (currentMode === 'authorized') {
      staffList = staffMembers.filter((m) => workingState.get(m.id)?.isChecked);
    }

    const ft = filterText.toLowerCase().trim();
    const filteredStaff = staffList.filter((m) => {
      if (!ft) return true;
      const matchName = m.full_name && m.full_name.toLowerCase().includes(ft);
      const matchCode = m.member_code && String(m.member_code).toLowerCase().includes(ft);
      const matchDiv = m.division_name && m.division_name.toLowerCase().includes(ft);
      const matchBranch = m.branch_name && m.branch_name.toLowerCase().includes(ft);
      return Boolean(matchName || matchCode || matchDiv || matchBranch);
    });

    if (filteredStaff.length === 0) {
      if (currentMode === 'authorized') {
        const totalAuth = getAuthorizedCount();
        if (totalAuth === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="5" style="text-align:center; padding: 40px 16px;">
                <div style="font-size: 2.2rem; margin-bottom: 8px;"><i data-lucide="users"></i></div>
                <div style="font-weight: 700; font-size: 1rem; color: var(--text-primary); margin-bottom: 4px;">No Attendance Takers Assigned Yet</div>
                <p style="color: var(--text-secondary); max-width: 420px; margin: 0 auto 16px; font-size: 0.85rem;">
                  No staff members have been authorized for this event yet. Browse the full staff directory to assign staff members.
                </p>
                <button type="button" class="btn btn-primary btn-sm" id="btnEmptyBrowseAll">
                  <i data-lucide="users"></i> Browse All Staff Directory (${staffMembers.length})
                </button>
              </td>
            </tr>
          `;
          const btnBrowse = tbody.querySelector('#btnEmptyBrowseAll');
          if (btnBrowse) {
            btnBrowse.onclick = () => {
              currentMode = 'all';
              renderRows(searchInput.value);
            };
          }
        } else {
          tbody.innerHTML = `
            <tr>
              <td colspan="5" style="text-align:center; padding: 32px 16px; color: var(--text-secondary);">
                <i data-lucide="search"></i> No assigned attendance takers match "<strong>${escapeHtml(ft)}</strong>".
              </td>
            </tr>
          `;
        }
      } else {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align:center; padding: 32px 16px; color: var(--text-secondary);">
              <i data-lucide="search"></i> No staff members match "<strong>${escapeHtml(ft)}</strong>".
            </td>
          </tr>
        `;
      }
      return;
    }

    tbody.innerHTML = filteredStaff
      .map((m) => {
        const stateObj = workingState.get(m.id) || {};
        const isChecked = stateObj.isChecked;
        const station = stateObj.station || 'Main Gate';
        // The private beacon link carries the host's key; it exists only after the host is saved
        const hostKey = hostKeys.get(m.id);
        const hostLink = hostKey
          ? `${window.location.origin}/host.html?${new URLSearchParams({ event: event.id, host: m.member_code, key: hostKey }).toString()}`
          : null;
        const linkActions = hostLink
          ? `
              <button type="button" class="btn btn-secondary btn-sm btn-show-host-qr" data-link="${escapeHtml(hostLink)}" data-name="${escapeHtml(m.full_name)}" data-station="${escapeHtml(station)}" title="Show the private link as a QR for this attendance taker to scan with their own phone">
                <i data-lucide="smartphone"></i> Show QR
              </button>
              <button type="button" class="btn btn-ghost btn-sm btn-copy-host-link" data-link="${escapeHtml(hostLink)}" title="Copy the private link to send to this attendance taker only">
                <i data-lucide="copy"></i> Copy Link
              </button>`
          : (isChecked ? '<span class="badge badge-neutral" title="Save to create this host\'s private beacon link" style="font-size:0.7rem;">Save to get link</span>' : '');

        return `
          <tr data-member-id="${m.id}" data-member-code="${m.member_code}" data-member-name="${escapeHtml(m.full_name)}">
            <td style="text-align:center;">
              <input type="checkbox" class="host-auth-checkbox" ${isChecked ? 'checked' : ''} aria-label="Authorize ${escapeHtml(m.full_name)}" />
            </td>
            <td>
              <div class="host-name-cell">${escapeHtml(m.full_name)} <span class="host-code-tag">${m.member_code}</span></div>
              <div style="font-size:0.75rem; color:var(--text-muted);">${m.phone_number || ''}</div>
            </td>
            <td>
              <div>${escapeHtml(m.division_name || '')}</div>
              <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(m.branch_name || '')}</div>
            </td>
            <td>
              <input type="text" class="host-station-input" value="${escapeHtml(station)}" placeholder="e.g. Gate 1 / Registration Desk" />
            </td>
            <td class="host-actions-cell" style="text-align: right;">
              ${isChecked ? linkActions : ''}
              ${isChecked ? (stateObj.deviceId ? `
                <button type="button" class="btn btn-ghost btn-sm btn-reset-device-lock" data-member-id="${m.id}" data-member-name="${escapeHtml(m.full_name)}" title="Phone is currently locked to this beacon. Click to reset so staff can bind another phone.">
                  <i data-lucide="lock-open"></i> Reset Device Lock
                </button>
              ` : `
                <span class="badge badge-secondary" title="No phone bound yet" style="font-size:0.7rem; padding: 2px 6px;"><i data-lucide="hourglass"></i> Unbound</span>
              `) : ''}
              ${isChecked ? `
                <button type="button" class="btn btn-ghost btn-sm btn-quick-unassign" data-member-id="${m.id}" title="Remove this staff member from taking attendance" style="color:var(--accent-rose);">
                  <i data-lucide="circle-x"></i> Remove
                </button>
              ` : ''}
            </td>
          </tr>
        `;
      })
      .join('');

    // Attach copy button listeners
    tbody.querySelectorAll('.btn-copy-host-link').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.link);
          showToast('Private link copied. Send it only to this attendance taker: anyone with it can show their QR.', 'info');
        } catch (err) {
          showToast('Could not copy automatically. Use "Show QR" and copy the link shown there.', 'warning');
        }
      };
    });

    // Show the private link as a QR, so the attendance taker scans it with their own phone
    // (opening the link on the admin's computer would lock the beacon to that computer)
    tbody.querySelectorAll('.btn-show-host-qr').forEach((btn) => {
      btn.onclick = () => openHostLinkQr(btn.dataset.link, btn.dataset.name, btn.dataset.station);
    });

    // Attach quick unassign button listeners
    tbody.querySelectorAll('.btn-quick-unassign').forEach((btn) => {
      btn.onclick = () => {
        const memberId = btn.dataset.memberId;
        const stateObj = workingState.get(memberId);
        if (stateObj) {
          stateObj.isChecked = false;
          workingState.set(memberId, stateObj);
        }
        updateAuthCount();
        renderRows(searchInput.value);
        showToast('Staff unassigned from event hosts', 'info');
      };
    });

    // Attach Reset Device Lock button listeners
    tbody.querySelectorAll('.btn-reset-device-lock').forEach((btn) => {
      btn.onclick = async () => {
        const memberId = btn.dataset.memberId;
        const memberName = btn.dataset.memberName;
        if (!confirm(`Reset device lock for ${memberName}?\n\nThey will be able to bind a new mobile phone when opening the beacon link.`)) return;
        btn.disabled = true;
        btn.textContent = 'Resetting...';
        let cleared = false;
        try {
          cleared = await dbService.resetHostDeviceLock(event.id, memberId);
        } catch (err) {
          console.error('Reset device lock failed:', err);
        }
        if (!cleared) {
          // Leave the lock shown as it is: the phone is still bound
          btn.disabled = false;
          btn.textContent = 'Reset Device Lock';
          showToast(`Could not reset the device lock for ${memberName}. Check your connection and try again.`, 'error');
          return;
        }
        const stateObj = workingState.get(memberId);
        if (stateObj) {
          stateObj.deviceId = null;
          stateObj.deviceRegisteredAt = null;
          workingState.set(memberId, stateObj);
        }
        renderRows(searchInput.value);
        showToast(`Device lock reset for ${memberName}.`, 'success');
      };
    });
  }

  // View Filter Tab Switchers
  if (btnFilterAuth) {
    btnFilterAuth.onclick = () => {
      currentMode = 'authorized';
      renderRows(searchInput.value);
    };
  }
  if (btnFilterAll) {
    btnFilterAll.onclick = () => {
      currentMode = 'all';
      renderRows(searchInput.value);
    };
  }

  // Checkbox and Station Input listeners
  tbody.onchange = (e) => {
    if (e.target.classList.contains('host-auth-checkbox')) {
      const row = e.target.closest('tr');
      const memberId = row?.dataset.memberId;
      if (memberId) {
        const stateObj = workingState.get(memberId) || {};
        stateObj.isChecked = e.target.checked;
        workingState.set(memberId, stateObj);
        updateAuthCount();
        if (currentMode === 'authorized' && !e.target.checked) {
          renderRows(searchInput.value);
        }
      }
    }
  };

  tbody.oninput = (e) => {
    if (e.target.classList.contains('host-station-input')) {
      const row = e.target.closest('tr');
      const memberId = row?.dataset.memberId;
      if (memberId) {
        const stateObj = workingState.get(memberId) || {};
        stateObj.station = e.target.value.trim();
        workingState.set(memberId, stateObj);
      }
    }
  };

  // Search input
  if (searchInput) {
    searchInput.oninput = () => renderRows(searchInput.value);
  }

  // Select all / deselect all
  if (btnSelectAll) {
    btnSelectAll.onclick = () => {
      workingState.forEach((val) => {
        val.isChecked = true;
      });
      renderRows(searchInput.value);
      showToast('All staff members authorized', 'info');
    };
  }

  if (btnDeselectAll) {
    btnDeselectAll.onclick = () => {
      workingState.forEach((val) => {
        val.isChecked = false;
      });
      renderRows(searchInput.value);
      showToast('All staff de-authorized', 'info');
    };
  }

  // Save button
  const btnSave = document.getElementById('btnSaveAuthorizedHosts');
  if (btnSave) {
    btnSave.onclick = async () => {
      btnSave.disabled = true;
      btnSave.textContent = 'Saving...';
      try {
        const hostConfigs = [];
        workingState.forEach((val, memberId) => {
          if (val.isChecked) {
            const m = staffMembers.find((s) => s.id === memberId);
            hostConfigs.push({
              memberId,
              memberCode: m?.member_code || '',
              fullName: m?.full_name || '',
              stationName: val.station || 'Main Gate',
              deviceId: val.deviceId || null,
              deviceRegisteredAt: val.deviceRegisteredAt || null,
              isActive: true
            });
          }
        });

        await dbService.authorizeEventHosts(event.id, hostConfigs);
        showToast(`Saved ${hostConfigs.length} attendance taker${hostConfigs.length === 1 ? '' : 's'}.`, 'success');
        modal.classList.remove('active');
        await refreshAllData();
      } catch (err) {
        showToast('Failed to save authorized hosts: ' + err.message, 'error');
      } finally {
        btnSave.disabled = false;
        btnSave.textContent = 'Save Attendance Takers';
      }
    };
  }

  renderRows();
  modal.classList.add('active');
}

// -----------------------------------------------------------------------------
// LIVE ATTENDANCE TABLE & FILTERS
// -----------------------------------------------------------------------------
function populateFilterDropdowns() {
  const eventSelect = document.getElementById('filterEvent');
  const divSelect = document.getElementById('filterDivision');
  const branchSelect = document.getElementById('filterBranch');

  if (eventSelect) {
    eventSelect.innerHTML = '<option value="">All Events</option>' +
      state.events.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  }

  if (divSelect) {
    divSelect.innerHTML = '<option value="All">All Divisions</option>' +
      state.divisions.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
  }

  if (branchSelect) {
    branchSelect.innerHTML = '<option value="All">All Branches</option>' +
      state.branches.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  }

  // Keep the admin's current selections after a data refresh
  const keep = (select, value, fallback) => {
    if (!select) return;
    select.value = [...select.options].some((o) => o.value === value) ? value : fallback;
  };
  keep(eventSelect, state.activeFilters.eventId, '');
  keep(divSelect, state.activeFilters.divisionId, 'All');
  keep(branchSelect, state.activeFilters.branchId, 'All');
  state.activeFilters.eventId = eventSelect ? eventSelect.value : state.activeFilters.eventId;
}

// Local calendar date (YYYY-MM-DD) of an ISO timestamp, so the date filter matches what admins see
function localDateKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Applies the attendance tab filters to the in-memory records (no network round trip)
 */
function getFilteredAttendance() {
  const f = state.activeFilters;
  const searchTerm = f.search.trim().toLowerCase();
  return state.attendance.filter((r) => {
    if (f.eventId && r.event_id !== f.eventId) return false;
    if (f.checkInMode && f.checkInMode !== 'All' && r.check_in_mode !== f.checkInMode) return false;
    if (f.status && f.status !== 'All' && !matchesStatusFilter(r, f.status)) return false;
    if (f.role && f.role !== 'All' && r.role !== f.role) return false;
    if (f.divisionId && f.divisionId !== 'All' && r.division_id !== f.divisionId) return false;
    if (f.branchId && f.branchId !== 'All' && r.branch_id !== f.branchId) return false;
    if (f.date && localDateKey(r.check_in_time) !== f.date) return false;
    if (!searchTerm) return true;
    return (
      (r.full_name && r.full_name.toLowerCase().includes(searchTerm)) ||
      (r.member_code && r.member_code.toLowerCase().includes(searchTerm)) ||
      (r.event_name && r.event_name.toLowerCase().includes(searchTerm))
    );
  });
}

function checkInModeBadge(record) {
  if (record.check_in_mode === 'HOST_SELF') {
    return '<span class="badge badge-mode-self" title="Attendance taker marked their own attendance"><i data-lucide="star"></i> Attendance Taker (Self)</span>';
  }
  if (record.check_in_mode === 'ATTENDEE_SCAN') {
    const hName = escapeHtml(record.host_name || record.host_member_code || 'Staff');
    const hStation = record.host_station ? ` • ${escapeHtml(record.host_station)}` : '';
    return `<span class="badge badge-mode-scan" title="Scanned via Host: ${hName}"><i data-lucide="smartphone"></i> ${hName}${hStation}</span>`;
  }
  if (record.check_in_mode === 'ADMIN_MANUAL') {
    return '<span class="badge badge-neutral" title="Marked present by an administrator"><i data-lucide="pen-line"></i> Manual</span>';
  }
  return '<span class="badge badge-mode-venue">Legacy Static QR</span>';
}

function matchesStatusFilter(record, status) {
  if (status === 'LATE') return Boolean(record.is_late);
  if (status === 'CHECKED_OUT') return Boolean(record.check_out_time);
  return (record.verification_status || 'VERIFIED') === status;
}

function verificationBadges(record) {
  const notes = record.verification_notes ? ` title="${escapeHtml(record.verification_notes)}"` : '';
  let badge = '<span class="badge badge-success">VERIFIED</span>';
  if (record.verification_status === 'FLAGGED') {
    badge = `<span class="badge badge-warning"${notes}><i data-lucide="search-check"></i> FLAGGED</span>`
      + `<br /><button type="button" class="btn btn-secondary btn-sm btn-review-flagged" data-record-id="${escapeHtml(record.id)}">Review</button>`;
  } else if (record.verification_status === 'MANUAL') {
    badge = `<span class="badge badge-info"${notes}>MANUAL</span>`;
  }
  const late = record.is_late ? ' <span class="badge badge-danger">LATE</span>' : '';
  return badge + late;
}

function attendanceRowHtml(record, highlight = false) {
  const timeOpts = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
  const timeStr = new Date(record.check_in_time).toLocaleTimeString([], timeOpts);
  const dateStr = new Date(record.check_in_time).toLocaleDateString();
  const outStr = record.check_out_time
    ? `<div style="font-size:0.75rem;color:var(--text-secondary);">Out ${new Date(record.check_out_time).toLocaleTimeString([], timeOpts)}</div>`
    : '';
  const roleBadge = record.role === 'Staff'
    ? '<span class="badge badge-info">Staff</span>'
    : '<span class="badge badge-warning">Agent</span>';

  const accuracy = record.accuracy_meters !== null && record.accuracy_meters !== undefined
    ? ` title="GPS accuracy ±${Math.round(record.accuracy_meters)}m"`
    : '';
  const distanceBadge = record.distance_meters !== null && record.distance_meters !== undefined
    ? `<span class="badge badge-success"${accuracy}><i data-lucide="map-pin"></i> ${Math.round(record.distance_meters)}m</span>`
    : '<span class="badge badge-neutral">GPS N/A</span>';

  return `
    <tr data-record-id="${escapeHtml(record.id)}"${highlight ? ' class="row-live-highlight"' : ''}>
      <td>
        <div style="font-weight:700;color:var(--text-primary);">${escapeHtml(record.full_name || 'Unknown')}</div>
        <div style="font-size:0.75rem;font-family:monospace;color:var(--text-muted);">${escapeHtml(record.member_code)}</div>
      </td>
      <td>${roleBadge}</td>
      <td>
        <div style="font-weight:600;">${escapeHtml(record.division_name || 'N/A')}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(record.branch_name || 'N/A')}</div>
      </td>
      <td>
        <div style="font-weight:600;">${escapeHtml(record.event_name || 'Event')}</div>
      </td>
      <td>
        <div>${timeStr}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${dateStr}</div>
        ${outStr}
      </td>
      <td>${distanceBadge}</td>
      <td>${checkInModeBadge(record)}</td>
      <td>${verificationBadges(record)}</td>
    </tr>
  `;
}

function renderAttendanceTable({ highlightId = null } = {}) {
  const tbody = document.getElementById('attendanceTableBody');
  const countEl = document.getElementById('attendanceRecordCount');
  if (!tbody) return;

  const filtered = getFilteredAttendance();

  if (countEl) countEl.textContent = `${filtered.length} record${filtered.length === 1 ? '' : 's'}`;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">
          <div class="empty-state-icon"><i data-lucide="clipboard-list"></i></div>
          <div class="empty-state-title">No Attendance Records Found</div>
          <p>Attendees appear here when they scan a staff member's QR code. Adjust the filters if you expected records.</p>
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = filtered.map((record) => attendanceRowHtml(record, record.id === highlightId)).join('');
  }

  renderPendingTable();
}

/**
 * Members eligible for the selected event (active, permitted role, matching filters) who have not checked in
 */
function getPendingMembers(event) {
  const presentIds = new Set(state.attendance.filter((a) => a.event_id === event.id).map((a) => a.member_id));
  const f = state.activeFilters;
  const searchTerm = f.search.trim().toLowerCase();
  return state.members.filter((m) => {
    if (!m.is_active || presentIds.has(m.id)) return false;
    if (event.permitted_roles !== 'All' && m.role !== event.permitted_roles) return false;
    if (f.role && f.role !== 'All' && m.role !== f.role) return false;
    if (f.divisionId && f.divisionId !== 'All' && m.division_id !== f.divisionId) return false;
    if (f.branchId && f.branchId !== 'All' && m.branch_id !== f.branchId) return false;
    if (!searchTerm) return true;
    return m.full_name.toLowerCase().includes(searchTerm) || String(m.member_code).toLowerCase().includes(searchTerm);
  });
}

function renderPendingTable() {
  const tbody = document.getElementById('pendingTableBody');
  const badge = document.getElementById('pendingCountBadge');
  if (!tbody) return;

  const event = state.events.find((e) => e.id === state.activeFilters.eventId);
  if (!event) {
    if (badge) badge.textContent = '–';
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          <div class="empty-state-icon"><i data-lucide="crosshair"></i></div>
          <div class="empty-state-title">Select an event</div>
          <p>Choose an event in the first filter to see who has not checked in yet.</p>
        </td>
      </tr>
    `;
    return;
  }

  const pending = getPendingMembers(event);
  if (badge) badge.textContent = pending.length;

  if (pending.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          <div class="empty-state-icon"><i data-lucide="party-popper"></i></div>
          <div class="empty-state-title">Everyone is checked in</div>
          <p>No eligible members are pending for ${escapeHtml(event.name)} with the current filters.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = pending
    .map((m) => `
      <tr>
        <td>
          <div style="font-weight:700;color:var(--text-primary);">${escapeHtml(m.full_name)}</div>
          <div style="font-size:0.75rem;font-family:monospace;color:var(--text-muted);">${escapeHtml(m.member_code)}</div>
        </td>
        <td>${m.role === 'Staff' ? '<span class="badge badge-info">Staff</span>' : '<span class="badge badge-warning">Agent</span>'}</td>
        <td>
          <div style="font-weight:600;">${escapeHtml(m.division_name || 'N/A')}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(m.branch_name || 'N/A')}</div>
        </td>
        <td style="font-family:monospace;">${escapeHtml(m.phone_number || '')}</td>
        <td style="text-align:right;">
          <button type="button" class="btn btn-secondary btn-sm btn-manual-mark" data-member-id="${escapeHtml(m.id)}" data-member-name="${escapeHtml(m.full_name)}">
            <i data-lucide="pen-line"></i> Mark Present
          </button>
        </td>
      </tr>
    `)
    .join('');

  tbody.querySelectorAll('.btn-manual-mark').forEach((btn) => {
    btn.onclick = () => openManualMarkModal(event, btn.dataset.memberId, btn.dataset.memberName);
  });
}

function setAttendanceView(view) {
  state.attendanceView = view;
  document.getElementById('btnViewPresent')?.classList.toggle('active', view === 'present');
  document.getElementById('btnViewPending')?.classList.toggle('active', view === 'pending');
  document.getElementById('presentTableWrap')?.classList.toggle('is-hidden', view !== 'present');
  document.getElementById('pendingTableWrap')?.classList.toggle('is-hidden', view !== 'pending');
}

// -----------------------------------------------------------------------------
// DIVISIONS & BRANCHES MANAGER
// -----------------------------------------------------------------------------
let orgEditing = null; // { type: 'division' | 'branch', id } while a row is being renamed

function renderOrgStructure() {
  const list = document.getElementById('orgStructureList');
  if (!list) return;

  if (state.divisions.length === 0) {
    list.innerHTML = '<p class="org-empty">No divisions yet. Add the first one above.</p>';
    return;
  }

  const countBy = (key) => state.members.reduce((map, m) => map.set(m[key], (map.get(m[key]) || 0) + 1), new Map());
  const membersByDivision = countBy('division_id');
  const membersByBranch = countBy('branch_id');
  const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

  const nameCell = (type, item, meta) => {
    if (orgEditing && orgEditing.type === type && orgEditing.id === item.id) {
      return `
        <form class="org-add-row org-rename-form" data-type="${type}" data-id="${escapeHtml(item.id)}" style="margin:0; flex:1;">
          <input type="text" name="name" class="form-control" value="${escapeHtml(item.name)}" aria-label="${type} name" required />
          <input type="text" name="code" class="form-control org-code-input" value="${escapeHtml(item.code || '')}" aria-label="${type} code" />
          <button type="submit" class="btn btn-primary btn-sm">Save</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="cancel-rename">Cancel</button>
        </form>`;
    }
    return `
      <div class="org-name">
        <strong>${escapeHtml(item.name)}</strong><span class="org-code">${escapeHtml(item.code || '')}</span>
        <span class="org-meta">${meta}</span>
      </div>`;
  };

  const actions = (type, item, memberCount) => {
    if (orgEditing && orgEditing.type === type && orgEditing.id === item.id) return '';
    const blocked = memberCount > 0;
    return `
      <div class="org-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-action="rename" data-type="${type}" data-id="${escapeHtml(item.id)}">Rename</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="delete" data-type="${type}" data-id="${escapeHtml(item.id)}"
          ${blocked ? `disabled title="Move its ${plural(memberCount, 'member')} first"` : ''} style="color:var(--accent-rose);">Delete</button>
      </div>`;
  };

  list.innerHTML = state.divisions
    .map((division) => {
      const branches = state.branches.filter((b) => b.division_id === division.id);
      const divisionMembers = membersByDivision.get(division.id) || 0;
      const branchItems = branches.length
        ? branches.map((branch) => {
            const branchMembers = membersByBranch.get(branch.id) || 0;
            return `
              <li class="org-row">
                ${nameCell('branch', branch, plural(branchMembers, 'member'))}
                ${actions('branch', branch, branchMembers)}
              </li>`;
          }).join('')
        : '<li class="org-empty">No branches yet.</li>';

      return `
        <section class="org-division">
          <div class="org-row org-division-row">
            ${nameCell('division', division, `${plural(divisionMembers, 'member')} • ${plural(branches.length, 'branch', 'branches')}`)}
            ${actions('division', division, divisionMembers)}
          </div>
          <ul class="org-branches">${branchItems}</ul>
          <form class="org-add-row org-add-branch" data-division-id="${escapeHtml(division.id)}">
            <input type="text" name="name" class="form-control" placeholder="New branch name" aria-label="New branch name in ${escapeHtml(division.name)}" required />
            <input type="text" name="code" class="form-control org-code-input" placeholder="Code (optional)" aria-label="New branch code" />
            <button type="submit" class="btn btn-secondary btn-sm">+ Add Branch</button>
          </form>
        </section>`;
    })
    .join('');
}

/**
 * Reload divisions and branches after a change and refresh every dropdown that lists them
 */
async function reloadOrgStructure() {
  state.divisions = await dbService.getDivisions();
  state.branches = await dbService.getBranches();
  populateFilterDropdowns();
  populateMemberFilterDropdowns();
  renderOrgStructure();
}

async function runOrgChange(action, successMessage) {
  try {
    await action();
    orgEditing = null;
    await reloadOrgStructure();
    showToast(successMessage, 'success');
    return true;
  } catch (err) {
    showToast(err.message || 'Could not save the change.', 'error');
    return false;
  }
}

function setupOrgStructureManager() {
  const modal = document.getElementById('orgStructureModal');
  const list = document.getElementById('orgStructureList');
  const addDivisionForm = document.getElementById('addDivisionForm');

  document.getElementById('btnOpenOrgStructure')?.addEventListener('click', () => {
    orgEditing = null;
    renderOrgStructure();
    modal.classList.add('active');
  });

  addDivisionForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('newDivisionName').value.trim();
    const code = document.getElementById('newDivisionCode').value.trim();
    const ok = await runOrgChange(() => dbService.saveDivision({ name, code }), `Division "${name}" added.`);
    if (ok) addDivisionForm.reset();
  });

  list?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const name = form.elements.name.value.trim();
    const code = form.elements.code.value.trim();
    if (form.classList.contains('org-add-branch')) {
      await runOrgChange(() => dbService.saveBranch({ divisionId: form.dataset.divisionId, name, code }), `Branch "${name}" added.`);
    } else if (form.classList.contains('org-rename-form')) {
      const { type, id } = form.dataset;
      if (type === 'division') {
        await runOrgChange(() => dbService.saveDivision({ id, name, code }), 'Division renamed.');
      } else {
        const branch = state.branches.find((b) => b.id === id);
        await runOrgChange(() => dbService.saveBranch({ id, divisionId: branch?.division_id, name, code }), 'Branch renamed.');
      }
    }
  });

  list?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, type, id } = btn.dataset;

    if (action === 'rename') {
      orgEditing = { type, id };
      renderOrgStructure();
      list.querySelector('.org-rename-form input[name="name"]')?.focus();
    } else if (action === 'cancel-rename') {
      orgEditing = null;
      renderOrgStructure();
    } else if (action === 'delete') {
      const item = (type === 'division' ? state.divisions : state.branches).find((x) => x.id === id);
      const branchCount = type === 'division' ? state.branches.filter((b) => b.division_id === id).length : 0;
      const extra = branchCount > 0 ? ` Its ${branchCount} empty branch${branchCount === 1 ? '' : 'es'} will be deleted too.` : '';
      if (!confirm(`Delete the ${type} "${item?.name}"?${extra}`)) return;
      await runOrgChange(
        () => (type === 'division' ? dbService.deleteDivision(id) : dbService.deleteBranch(id)),
        `${type === 'division' ? 'Division' : 'Branch'} deleted.`
      );
    }
  });
}

function openReviewModal(recordId) {
  const record = state.attendance.find((r) => r.id === recordId);
  if (!record) return;
  state.pendingReviewId = recordId;

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '-');
  const rows = [
    ['Attendee', `${record.full_name} (${record.member_code})`],
    ['Event', record.event_name],
    ['Checked in', fmt(record.check_in_time)],
    ['Distance', record.distance_meters !== null && record.distance_meters !== undefined ? `${Math.round(record.distance_meters)} m from the venue` : 'Not recorded'],
    ['GPS accuracy', record.accuracy_meters !== null && record.accuracy_meters !== undefined ? `±${Math.round(record.accuracy_meters)} m` : 'Not recorded'],
    ['Attendance taker', record.host_name || record.host_member_code || '-'],
    ['Why flagged', record.verification_notes || '-']
  ];
  document.getElementById('reviewDetails').innerHTML = rows
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('');
  document.getElementById('reviewNote').value = '';
  document.getElementById('reviewAttendanceModal').classList.add('active');
  setTimeout(() => document.getElementById('reviewNote')?.focus(), 50);
}

function openManualMarkModal(event, memberId, memberName) {
  state.pendingManualMark = { eventId: event.id, memberId };
  document.getElementById('manualMarkMemberName').textContent = memberName;
  document.getElementById('manualMarkEventName').textContent = event.name;
  document.getElementById('manualMarkReason').value = '';
  document.getElementById('manualMarkModal').classList.add('active');
  setTimeout(() => document.getElementById('manualMarkReason')?.focus(), 50);
}

// -----------------------------------------------------------------------------
// CSV / EXCEL REPORT EXPORT
// -----------------------------------------------------------------------------
// Quotes a CSV cell and neutralises spreadsheet formulas (=, +, -, @) in user-entered text
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function exportAttendanceToCSV() {
  const records = getFilteredAttendance();
  if (records.length === 0) {
    showToast('No attendance records available to export.', 'warning');
    return;
  }

  const headers = [
    'Attendance ID',
    'Attendee Name',
    'Member Code',
    'Role',
    'Division',
    'Branch',
    'Event Name',
    'Venue',
    'Check-in Time',
    'Check-out Time',
    'Late',
    'Distance (Meters)',
    'GPS Accuracy (Meters)',
    'Check-in Mode',
    'Host Name',
    'Host Code',
    'Status',
    'Notes'
  ];

  const toLocal = (iso) => (iso ? new Date(iso).toLocaleString() : '');
  const rows = records.map((r) => [
    r.id,
    r.full_name,
    r.member_code,
    r.role,
    r.division_name,
    r.branch_name,
    r.event_name,
    r.venue,
    toLocal(r.check_in_time),
    toLocal(r.check_out_time),
    r.is_late ? 'Yes' : 'No',
    r.distance_meters !== null && r.distance_meters !== undefined ? Math.round(r.distance_meters) : '',
    r.accuracy_meters !== null && r.accuracy_meters !== undefined ? Math.round(r.accuracy_meters) : '',
    r.check_in_mode,
    r.host_name,
    r.host_member_code,
    r.verification_status || 'VERIFIED',
    r.verification_notes
  ].map(csvCell));

  // Excel opens UTF-8 CSV correctly only with a byte-order mark
  const csvContent = '﻿' + [headers.map(csvCell).join(','), ...rows.map((e) => e.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Attendance_Report_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Attendance report exported to CSV successfully!', 'success');
}

// -----------------------------------------------------------------------------
// USER MASTER DIRECTORY (Staff & Agents)
// -----------------------------------------------------------------------------
function populateMemberFilterDropdowns() {
  const memberDivSelect = document.getElementById('filterMemberDivision');

  if (memberDivSelect) {
    const currentDiv = state.memberFilters.divisionId || 'All';
    memberDivSelect.innerHTML = '<option value="All">All Divisions</option>' +
      state.divisions.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
    memberDivSelect.value = currentDiv;
  }

  updateMemberBranchDropdown();
  populateMemberSelectOptions();
}

async function updateMemberBranchDropdown() {
  const memberBranchSelect = document.getElementById('filterMemberBranch');
  if (!memberBranchSelect) return;

  const divId = state.memberFilters.divisionId;
  const branches = await dbService.getBranches(divId === 'All' ? null : divId);

  memberBranchSelect.innerHTML = '<option value="All">All Branches</option>' +
    branches.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');

  if ([...memberBranchSelect.options].some((o) => o.value === state.memberFilters.branchId)) {
    memberBranchSelect.value = state.memberFilters.branchId;
  } else {
    memberBranchSelect.value = 'All';
    state.memberFilters.branchId = 'All';
  }
}

function populateMemberSelectOptions() {
  const memberSelect = document.getElementById('filterMemberSelect');
  if (!memberSelect) return;

  const currentVal = state.memberFilters.memberId || 'All';
  const { role, divisionId, branchId } = state.memberFilters;

  // Filter candidate members matching the high-level role, division, branch
  const eligible = (state.members || []).filter((m) => {
    if (role && role !== 'All' && m.role !== role) return false;
    if (divisionId && divisionId !== 'All' && m.division_id !== divisionId) return false;
    if (branchId && branchId !== 'All' && m.branch_id !== branchId) return false;
    return true;
  });

  const roleText = role === 'Staff' ? 'Staff' : (role === 'Agent' ? 'Agents' : 'Staff & Agents');
  let html = `<option value="All">All ${roleText} (${eligible.length})</option>`;
  html += eligible.map((m) => {
    return `<option value="${m.id}">${escapeHtml(m.full_name)} (${m.member_code})</option>`;
  }).join('');

  memberSelect.innerHTML = html;
  if ([...memberSelect.options].some((o) => o.value === currentVal)) {
    memberSelect.value = currentVal;
  } else {
    memberSelect.value = 'All';
    state.memberFilters.memberId = 'All';
  }
}

async function renderMembersTable() {
  const tbody = document.getElementById('membersTableBody');
  const countEl = document.getElementById('memberRecordCount');
  if (!tbody) return;

  // state.members is loaded by refreshAllData; filtering here stays in memory

  populateMemberSelectOptions();

  const { role, divisionId, branchId, status, memberId, search } = state.memberFilters;
  const searchTerm = search.trim().toLowerCase();

  const filtered = state.members.filter((m) => {
    // 1. Direct Member ID select
    if (memberId && memberId !== 'All' && m.id !== memberId) {
      return false;
    }

    // 2. Role filter
    if (role && role !== 'All' && m.role !== role) {
      return false;
    }

    // 3. Division filter
    if (divisionId && divisionId !== 'All' && m.division_id !== divisionId) {
      return false;
    }

    // 4. Branch filter
    if (branchId && branchId !== 'All' && m.branch_id !== branchId) {
      return false;
    }

    // 5. Status filter
    if (status === 'active' && !m.is_active) return false;
    if (status === 'inactive' && m.is_active) return false;

    // 6. Text search
    if (searchTerm) {
      const matchName = m.full_name && m.full_name.toLowerCase().includes(searchTerm);
      const matchCode = m.member_code && m.member_code.toLowerCase().includes(searchTerm);
      const matchPhone = m.phone_number && m.phone_number.includes(searchTerm);
      const matchBranch = m.branch_name && m.branch_name.toLowerCase().includes(searchTerm);
      const matchDiv = m.division_name && m.division_name.toLowerCase().includes(searchTerm);
      if (!matchName && !matchCode && !matchPhone && !matchBranch && !matchDiv) {
        return false;
      }
    }

    return true;
  });

  if (countEl) {
    countEl.textContent = `${filtered.length} member${filtered.length === 1 ? '' : 's'}`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">
          <div class="empty-state-icon"><i data-lucide="users"></i></div>
          <div class="empty-state-title">No Matching Users Found</div>
          <p>No user matches the selected filter criteria. Try adjusting your filters or search terms.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered
    .map((member) => {
      const roleBadge = member.role === 'Staff'
        ? '<span class="badge badge-info">Staff</span>'
        : '<span class="badge badge-warning">Agent</span>';

      const statusBadge = member.is_active
        ? '<span class="badge badge-success">Active</span>'
        : '<span class="badge badge-danger">Inactive</span>';

      return `
      <tr>
        <td>
          <div style="font-weight:700;">${escapeHtml(member.full_name)}</div>
        </td>
        <td><span style="font-family:monospace;font-weight:600;">${member.member_code}</span></td>
        <td>${roleBadge}</td>
        <td>${escapeHtml(member.division_name || 'N/A')} &bull; ${escapeHtml(member.branch_name || 'N/A')}</td>
        <td><span style="font-family:monospace;">${member.phone_number}</span></td>
        <td>${statusBadge}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn-secondary btn-sm btn-transfer-member" data-id="${member.id}" title="Transfer staff to another branch or edit details">
              <i data-lucide="building-2"></i> Transfer / Edit
            </button>
            <button class="btn btn-ghost btn-sm btn-toggle-member" data-id="${member.id}">
              ${member.is_active ? '<i data-lucide="pause"></i> Deactivate' : '<i data-lucide="play"></i> Activate'}
            </button>
            <button class="btn btn-ghost btn-sm btn-delete-member" data-id="${member.id}" style="color:var(--accent-rose);" title="Delete member">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
    })
    .join('');

  tbody.querySelectorAll('.btn-transfer-member').forEach((btn) => {
    btn.onclick = () => {
      const member = state.members.find((m) => m.id === btn.dataset.id);
      if (member) {
        openEditMemberModal(member);
      }
    };
  });

  tbody.querySelectorAll('.btn-toggle-member').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await dbService.toggleMemberStatus(btn.dataset.id);
      } catch (err) {
        showToast(err.message, 'error');
        return;
      }
      showToast('Member status updated', 'success');
      await refreshAllData();
    };
  });

  tbody.querySelectorAll('.btn-delete-member').forEach((btn) => {
    btn.onclick = async () => {
      if (confirm('Delete this member? Their attendance history is deleted too.')) {
        try {
          await dbService.deleteMember(btn.dataset.id);
        } catch (err) {
          showToast(err.message, 'error');
          return;
        }
        showToast('Member deleted', 'success');
        await refreshAllData();
      }
    };
  });
}

async function openEditMemberModal(member) {
  const memberModal = document.getElementById('memberModal');
  const memberForm = document.getElementById('memberForm');
  const memberIdInput = document.getElementById('memberId');
  const memberRoleSelect = document.getElementById('memberRole');
  const memberCodeInput = document.getElementById('memberCode');
  const memberNameInput = document.getElementById('memberName');
  const memberPhoneInput = document.getElementById('memberPhone');
  const memberDivSelect = document.getElementById('memberDivision');
  const memberBranchSelect = document.getElementById('memberBranch');
  const memberIsActiveCheck = document.getElementById('memberIsActive');
  const titleEl = document.getElementById('memberModalTitle');
  const subtitleEl = document.getElementById('memberModalSubtitle');
  const bannerEl = document.getElementById('memberTransferBanner');
  const saveBtn = document.getElementById('btnSaveMember');

  if (!memberModal) return;

  if (memberForm) memberForm.reset();
  if (memberIdInput) memberIdInput.value = member.id;
  if (memberRoleSelect) memberRoleSelect.value = member.role;
  if (memberCodeInput) memberCodeInput.value = member.member_code;
  if (memberNameInput) memberNameInput.value = member.full_name;
  if (memberPhoneInput) memberPhoneInput.value = member.phone_number;
  if (memberIsActiveCheck) memberIsActiveCheck.checked = Boolean(member.is_active);

  if (titleEl) titleEl.textContent = 'Transfer Branch / Edit User';
  if (subtitleEl) {
    subtitleEl.textContent = `Reassign branch or update profile for ${member.full_name} (${member.member_code})`;
    subtitleEl.style.display = 'block';
  }
  if (bannerEl) {
    const staffNameEl = document.getElementById('transferStaffName');
    const staffCodeEl = document.getElementById('transferStaffCode');
    const currBranchEl = document.getElementById('currentBranchDisplay');
    if (staffNameEl) staffNameEl.textContent = member.full_name;
    if (staffCodeEl) staffCodeEl.textContent = member.member_code;
    if (currBranchEl) currBranchEl.textContent = `${member.division_name || 'N/A'} • ${member.branch_name || 'N/A'}`;
    bannerEl.style.display = 'block';
  }
  if (saveBtn) saveBtn.textContent = 'Save Changes & Transfer Branch';

  // Populate divisions
  if (memberDivSelect) {
    memberDivSelect.innerHTML = '<option value="">Select Division</option>' +
      state.divisions.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
    memberDivSelect.value = member.division_id || '';
  }

  // Populate branches for this member's division
  if (memberBranchSelect) {
    if (member.division_id) {
      const branches = await dbService.getBranches(member.division_id);
      memberBranchSelect.innerHTML = '<option value="">Select Branch</option>' +
        branches.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
      memberBranchSelect.value = member.branch_id || '';
    } else {
      memberBranchSelect.innerHTML = '<option value="">Select Division First</option>';
    }
  }

  memberModal.classList.add('active');
}

// -----------------------------------------------------------------------------
// AUDIT LOGS
// -----------------------------------------------------------------------------
async function renderAuditLogsTable() {
  const tbody = document.getElementById('auditLogsTableBody');
  if (!tbody) return;

  state.auditLogs = await dbService.getAuditLogs(100);

  if (state.auditLogs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          <div class="empty-state-icon"><i data-lucide="shield"></i></div>
          <div class="empty-state-title">No Audit Logs Yet</div>
          <p>Security validation attempts and system activities will appear here.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.auditLogs
    .map((log) => {
      const time = new Date(log.created_at).toLocaleString();
      let statusBadge = '<span class="badge badge-neutral">INFO</span>';
      if (log.status === 'SUCCESS') statusBadge = '<span class="badge badge-success">SUCCESS</span>';
      if (log.status === 'REJECTED') statusBadge = '<span class="badge badge-danger">REJECTED</span>';

      const detailsStr = log.details ? JSON.stringify(log.details) : '-';

      return `
      <tr>
        <td style="font-size:0.8125rem;color:var(--text-muted);">${time}</td>
        <td><strong>${escapeHtml(log.action)}</strong></td>
        <td>${statusBadge}</td>
        <td style="font-family:monospace;font-size:0.75rem;max-width:320px;word-break:break-all;">${escapeHtml(detailsStr)}</td>
        <td style="font-size:0.75rem;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${escapeHtml(log.user_agent || 'Browser')}
        </td>
      </tr>
    `;
    })
    .join('');
}

// -----------------------------------------------------------------------------
// EVENT LISTENERS & MODALS
// -----------------------------------------------------------------------------
function setupEventListeners() {
  setupOrgStructureManager();

  // Modal Close buttons
  document.querySelectorAll('.modal-close, .btn-modal-dismiss').forEach((btn) => {
    btn.onclick = (e) => {
      const modal = e.target.closest('.modal-backdrop');
      if (modal) modal.classList.remove('active');
    };
  });

  // Event form (create and edit share one form)
  const btnOpenCreate = document.getElementById('btnOpenCreateEvent');
  if (btnOpenCreate) btnOpenCreate.onclick = () => openEventForm(null);

  const editEventForm = document.getElementById('editEventForm');
  const editModal = document.getElementById('editEventModal');

  // Explain overnight windows and catch identical times while the admin types
  ['editEventStartTime', 'editEventEndTime'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', updateEventWindowHint);
  });

  const editRadiusInput = document.getElementById('editEventRadius');
  if (editRadiusInput) {
    editRadiusInput.addEventListener('input', (e) => {
      const rad = parseInt(e.target.value, 10) || 50;
      if (state.editGeofencePicker) {
        state.editGeofencePicker.setRadius(rad);
      }
    });
  }

  const syncEditCoordsToMap = () => {
    const lat = parseFloat(document.getElementById('editEventLatitude')?.value);
    const lng = parseFloat(document.getElementById('editEventLongitude')?.value);
    if (!isNaN(lat) && !isNaN(lng) && state.editGeofencePicker) {
      state.editGeofencePicker.setCoordinates(lat, lng);
    }
  };
  document.getElementById('editEventLatitude')?.addEventListener('change', syncEditCoordsToMap);
  document.getElementById('editEventLongitude')?.addEventListener('change', syncEditCoordsToMap);

  const btnDetectEditLocation = document.getElementById('btnDetectEditGps');
  if (btnDetectEditLocation) {
    btnDetectEditLocation.onclick = async () => {
      try {
        btnDetectEditLocation.disabled = true;
        btnDetectEditLocation.textContent = 'Detecting GPS...';
        const pos = await getCurrentPosition();
        document.getElementById('editEventLatitude').value = pos.latitude.toFixed(6);
        document.getElementById('editEventLongitude').value = pos.longitude.toFixed(6);
        if (state.editGeofencePicker) {
          state.editGeofencePicker.setCoordinates(pos.latitude, pos.longitude);
        }
        showToast(`Venue GPS locked: ${pos.latitude.toFixed(4)}, ${pos.longitude.toFixed(4)}`, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btnDetectEditLocation.disabled = false;
        btnDetectEditLocation.textContent = 'Use Current GPS Location';
      }
    };
  }

  if (editEventForm) {
    editEventForm.onsubmit = async (e) => {
      e.preventDefault();
      const eventId = document.getElementById('editEventId').value;
      const isCreate = !eventId;
      const withSeconds = (value) => (value.length === 5 ? `${value}:00` : value);

      const payload = {
        name: document.getElementById('editEventName').value.trim(),
        venue: document.getElementById('editEventVenue').value.trim(),
        date: document.getElementById('editEventDate').value,
        start_time: withSeconds(document.getElementById('editEventStartTime').value),
        end_time: withSeconds(document.getElementById('editEventEndTime').value),
        permitted_roles: document.getElementById('editEventPermittedRoles').value,
        latitude: document.getElementById('editEventLatitude').value ? Number(document.getElementById('editEventLatitude').value) : null,
        longitude: document.getElementById('editEventLongitude').value ? Number(document.getElementById('editEventLongitude').value) : null,
        radius_meters: Number(document.getElementById('editEventRadius').value) || 50,
        location_required: document.getElementById('editEventLocationRequired').checked,
        late_grace_minutes: readLateGrace('editEventLateGrace'),
        checkout_enabled: document.getElementById('editEventCheckoutEnabled').checked
      };

      const timeError = validateEventTimes(payload.start_time, payload.end_time);
      if (timeError) {
        showToast(timeError, 'error');
        document.getElementById('editEventEndTime')?.focus();
        return;
      }
      if (payload.location_required && !hasVenueCoordinates(payload)) {
        showToast('Set the venue location on the map (or untick "Enforce Geofence GPS Check") before saving.', 'error');
        return;
      }

      const submitBtn = document.getElementById('btnSaveEditedEvent');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = isCreate ? 'Creating Event...' : 'Saving Changes...';
      }

      try {
        if (isCreate) {
          await dbService.createEvent(payload);
        } else {
          await dbService.updateEvent(eventId, payload);
        }
        if (editModal) editModal.classList.remove('active');
        showToast(isCreate ? 'Event created.' : 'Event updated.', 'success');
        await refreshAllData();
      } catch (err) {
        console.error('Save event error:', err);
        showToast(err.message || 'Failed to save the event.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = isCreate ? 'Create Event' : 'Save Changes';
        }
      }
    };
  }

  const btnDeleteFromEdit = document.getElementById('btnDeleteFromEditModal');
  if (btnDeleteFromEdit) {
    btnDeleteFromEdit.onclick = () => {
      const eventId = document.getElementById('editEventId')?.value;
      if (eventId) {
        openDeleteEventModal(eventId);
      }
    };
  }

  const btnConfirmDelete = document.getElementById('btnConfirmDeleteEvent');
  if (btnConfirmDelete) {
    btnConfirmDelete.onclick = async () => {
      if (!pendingEventIdToDelete) return;
      const event = state.events.find((e) => e.id === pendingEventIdToDelete);
      const eventName = event ? event.name : 'Event';
      btnConfirmDelete.disabled = true;
      btnConfirmDelete.textContent = 'Deleting...';
      try {
        await dbService.deleteEvent(pendingEventIdToDelete);
        showToast(`Event "${eventName}" and all associated records deleted successfully.`, 'success');
        const deleteModal = document.getElementById('deleteEventConfirmModal');
        if (deleteModal) deleteModal.classList.remove('active');
        const editModal = document.getElementById('editEventModal');
        if (editModal) editModal.classList.remove('active');
        await refreshAllData();
      } catch (err) {
        showToast('Failed to delete event: ' + err.message, 'error');
      } finally {
        btnConfirmDelete.disabled = false;
        btnConfirmDelete.textContent = 'Yes, Delete Event';
        pendingEventIdToDelete = null;
      }
    };
  }

  // Filter Listeners
  const filterEvent = document.getElementById('filterEvent');
  const filterMode = document.getElementById('filterMode');
  const filterStatus = document.getElementById('filterStatus');
  const filterRole = document.getElementById('filterRole');
  const filterDivision = document.getElementById('filterDivision');
  const filterBranch = document.getElementById('filterBranch');
  const filterDate = document.getElementById('filterDate');
  const filterSearch = document.getElementById('filterSearch');

  const onFilterChange = () => {
    state.activeFilters.eventId = filterEvent.value;
    state.activeFilters.checkInMode = filterMode ? filterMode.value : 'All';
    state.activeFilters.status = filterStatus ? filterStatus.value : 'All';
    state.activeFilters.role = filterRole.value;
    state.activeFilters.divisionId = filterDivision.value;
    state.activeFilters.branchId = filterBranch.value;
    state.activeFilters.date = filterDate.value;
    state.activeFilters.search = filterSearch.value;
    renderAttendanceTable();
  };

  [filterEvent, filterMode, filterStatus, filterRole, filterDivision, filterBranch, filterDate].forEach((el) => {
    if (el) el.onchange = onFilterChange;
  });
  if (filterSearch) filterSearch.oninput = onFilterChange;

  // Review buttons are re-rendered with the table, so listen on the table body
  document.getElementById('attendanceTableBody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-review-flagged');
    if (btn) openReviewModal(btn.dataset.recordId);
  });

  const reviewNote = document.getElementById('reviewNote');
  const submitReview = async (decision) => {
    const recordId = state.pendingReviewId;
    const note = reviewNote.value.trim();
    if (!recordId) return;
    if (!note) {
      showToast('Enter a note explaining the decision.', 'error');
      reviewNote.focus();
      return;
    }
    const buttons = [document.getElementById('btnReviewApprove'), document.getElementById('btnReviewReject')];
    buttons.forEach((b) => { if (b) b.disabled = true; });
    try {
      const result = await dbService.reviewAttendance(recordId, decision, note);
      if (!result?.success) {
        showToast(result?.message || 'Could not save the review.', 'error');
        return;
      }
      if (decision === 'APPROVE') {
        applyLiveAttendance({
          ...state.attendance.find((r) => r.id === recordId),
          verification_status: 'VERIFIED',
          verification_notes: [state.attendance.find((r) => r.id === recordId)?.verification_notes, `Approved by admin: ${note}`].filter(Boolean).join('; ')
        }, { quiet: true });
      } else {
        applyLiveAttendance({ id: recordId, _deleted: true });
      }
      document.getElementById('reviewAttendanceModal').classList.remove('active');
      state.pendingReviewId = null;
      showToast(decision === 'APPROVE' ? 'Check-in approved.' : 'Check-in rejected and removed. The person can check in again.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      buttons.forEach((b) => { if (b) b.disabled = false; });
    }
  };
  document.getElementById('btnReviewApprove')?.addEventListener('click', () => submitReview('APPROVE'));
  document.getElementById('btnReviewReject')?.addEventListener('click', () => submitReview('REJECT'));
  document.getElementById('reviewAttendanceForm')?.addEventListener('submit', (e) => e.preventDefault());

  // Division select in filters cascades branch dropdown
  if (filterDivision) {
    filterDivision.addEventListener('change', async () => {
      const divId = filterDivision.value;
      const branches = await dbService.getBranches(divId === 'All' ? null : divId);
      filterBranch.innerHTML = '<option value="All">All Branches</option>' +
        branches.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    });
  }

  // User Master Filter Listeners
  const filterMemberSelect = document.getElementById('filterMemberSelect');
  const filterMemberRole = document.getElementById('filterMemberRole');
  const filterMemberDivision = document.getElementById('filterMemberDivision');
  const filterMemberBranch = document.getElementById('filterMemberBranch');
  const filterMemberStatus = document.getElementById('filterMemberStatus');
  const filterMemberSearch = document.getElementById('filterMemberSearch');
  const btnResetMemberFilters = document.getElementById('btnResetMemberFilters');

  if (filterMemberSelect) {
    filterMemberSelect.onchange = () => {
      state.memberFilters.memberId = filterMemberSelect.value;
      renderMembersTable();
    };
  }

  if (filterMemberRole) {
    filterMemberRole.onchange = () => {
      state.memberFilters.role = filterMemberRole.value;
      state.memberFilters.memberId = 'All';
      populateMemberSelectOptions();
      renderMembersTable();
    };
  }

  if (filterMemberDivision) {
    filterMemberDivision.onchange = async () => {
      state.memberFilters.divisionId = filterMemberDivision.value;
      state.memberFilters.branchId = 'All';
      state.memberFilters.memberId = 'All';
      await updateMemberBranchDropdown();
      populateMemberSelectOptions();
      renderMembersTable();
    };
  }

  if (filterMemberBranch) {
    filterMemberBranch.onchange = () => {
      state.memberFilters.branchId = filterMemberBranch.value;
      state.memberFilters.memberId = 'All';
      populateMemberSelectOptions();
      renderMembersTable();
    };
  }

  if (filterMemberStatus) {
    filterMemberStatus.onchange = () => {
      state.memberFilters.status = filterMemberStatus.value;
      renderMembersTable();
    };
  }

  if (filterMemberSearch) {
    filterMemberSearch.oninput = () => {
      state.memberFilters.search = filterMemberSearch.value;
      renderMembersTable();
    };
  }

  if (btnResetMemberFilters) {
    btnResetMemberFilters.onclick = async () => {
      state.memberFilters = {
        role: 'All',
        divisionId: 'All',
        branchId: 'All',
        status: 'All',
        memberId: 'All',
        search: ''
      };
      if (filterMemberRole) filterMemberRole.value = 'All';
      if (filterMemberDivision) filterMemberDivision.value = 'All';
      if (filterMemberBranch) filterMemberBranch.value = 'All';
      if (filterMemberStatus) filterMemberStatus.value = 'All';
      if (filterMemberSearch) filterMemberSearch.value = '';
      await updateMemberBranchDropdown();
      populateMemberSelectOptions();
      renderMembersTable();
    };
  }

  // Export CSV
  const btnExport = document.getElementById('btnExportCsv');
  if (btnExport) btnExport.onclick = () => exportAttendanceToCSV();

  // Present / Pending switch
  const btnViewPresent = document.getElementById('btnViewPresent');
  const btnViewPending = document.getElementById('btnViewPending');
  if (btnViewPresent) btnViewPresent.onclick = () => setAttendanceView('present');
  if (btnViewPending) btnViewPending.onclick = () => setAttendanceView('pending');

  // Manual attendance (admin marks a pending member present)
  const manualMarkForm = document.getElementById('manualMarkForm');
  if (manualMarkForm) {
    manualMarkForm.onsubmit = async (e) => {
      e.preventDefault();
      const pending = state.pendingManualMark;
      const reason = document.getElementById('manualMarkReason').value.trim();
      const btn = document.getElementById('btnConfirmManualMark');
      if (!pending || !reason) return;

      btn.disabled = true;
      try {
        const result = await dbService.adminMarkAttendance(pending.eventId, pending.memberId, reason);
        if (!result?.success) {
          showToast(result?.message || 'Could not mark attendance.', 'error');
          return;
        }
        document.getElementById('manualMarkModal').classList.remove('active');
        state.pendingManualMark = null;
        showToast(`${result.data.full_name} marked present (manual).`, 'success');
        await syncAttendanceSince();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    };
  }

  // Add Member Modal
  const btnOpenAddMember = document.getElementById('btnOpenAddMember');
  const memberModal = document.getElementById('memberModal');
  const memberForm = document.getElementById('memberForm');
  const memberDivSelect = document.getElementById('memberDivision');
  const memberBranchSelect = document.getElementById('memberBranch');

  if (btnOpenAddMember && memberModal) {
    btnOpenAddMember.onclick = async () => {
      memberForm.reset();
      const memberIdInput = document.getElementById('memberId');
      if (memberIdInput) memberIdInput.value = '';

      const titleEl = document.getElementById('memberModalTitle');
      const subtitleEl = document.getElementById('memberModalSubtitle');
      const bannerEl = document.getElementById('memberTransferBanner');
      const saveBtn = document.getElementById('btnSaveMember');

      if (titleEl) titleEl.textContent = 'Add Member';
      if (subtitleEl) subtitleEl.style.display = 'none';
      if (bannerEl) bannerEl.style.display = 'none';
      if (saveBtn) saveBtn.textContent = 'Save Member';

      // Populate divisions
      memberDivSelect.innerHTML = '<option value="">Select Division</option>' +
        state.divisions.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
      memberBranchSelect.innerHTML = '<option value="">Select Division first</option>';
      memberModal.classList.add('active');
    };
  }

  if (memberDivSelect) {
    memberDivSelect.onchange = async () => {
      const divId = memberDivSelect.value;
      if (!divId) {
        memberBranchSelect.innerHTML = '<option value="">Select Division first</option>';
        return;
      }
      const branches = await dbService.getBranches(divId);
      memberBranchSelect.innerHTML = '<option value="">Select Branch</option>' +
        branches.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    };
  }

  if (memberForm) {
    memberForm.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const memberId = document.getElementById('memberId')?.value || '';
        const payload = {
          id: memberId || undefined,
          role: document.getElementById('memberRole').value,
          member_code: document.getElementById('memberCode').value,
          full_name: document.getElementById('memberName').value,
          phone_number: document.getElementById('memberPhone').value,
          division_id: document.getElementById('memberDivision').value,
          branch_id: document.getElementById('memberBranch').value,
          is_active: document.getElementById('memberIsActive').checked
        };
        await dbService.saveMember(payload);
        memberModal.classList.remove('active');

        if (memberId) {
          const br = state.branches.find((b) => b.id === payload.branch_id);
          const brName = br ? br.name : 'new branch';
          showToast(`${payload.full_name} updated successfully! Allocated to ${brName}.`, 'success');
        } else {
          showToast('Member saved', 'success');
        }
        await refreshAllData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Bulk CSV Roster Import
  // ---------------------------------------------------------------------------
  const btnOpenBulkImport = document.getElementById('btnOpenBulkImport');
  const bulkImportModal = document.getElementById('bulkImportModal');
  const btnDownloadCsvSample = document.getElementById('btnDownloadCsvSample');
  const csvDropzone = document.getElementById('csvDropzone');
  const csvFileInput = document.getElementById('csvFileInput');
  const csvPreviewSection = document.getElementById('csvPreviewSection');
  const csvFileSummary = document.getElementById('csvFileSummary');
  const csvBadgeValid = document.getElementById('csvBadgeValid');
  const csvBadgeDuplicates = document.getElementById('csvBadgeDuplicates');
  const csvPreviewTableBody = document.getElementById('csvPreviewTableBody');
  const btnConfirmBulkImport = document.getElementById('btnConfirmBulkImport');

  let bulkImportParsedRows = [];

  function resetBulkImportState() {
    bulkImportParsedRows = [];
    if (csvFileInput) csvFileInput.value = '';
    if (csvPreviewSection) csvPreviewSection.style.display = 'none';
    if (csvPreviewTableBody) csvPreviewTableBody.innerHTML = '';
    if (btnConfirmBulkImport) {
      btnConfirmBulkImport.disabled = true;
      btnConfirmBulkImport.textContent = 'Confirm & Import Roster';
    }
  }

  if (btnOpenBulkImport && bulkImportModal) {
    btnOpenBulkImport.onclick = () => {
      resetBulkImportState();
      bulkImportModal.classList.add('active');
    };
  }

  if (btnDownloadCsvSample) {
    btnDownloadCsvSample.onclick = () => {
      const sampleCsv = [
        'FullName,MemberCode,Role,Division,Branch,PhoneNumber',
        'Sarah Jenkins,STF-1025,Staff,Corporate Division,Global Headquarters - Tower A,9811223344',
        'Marcus Brody,AGT-2010,Agent,Retail & Consumer Banking,Metro Plaza Premium Branch,9822334455',
        'Priya Nair,STF-1026,Staff,Corporate Division,Tech Innovation Campus - Sector 62,9833445566',
        'David O Connor,STF-1027,Staff,Agency & Field Distribution,North Zone Agency Network,9844556677'
      ].join('\r\n');

      const blob = new Blob([sampleCsv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'attendpro_roster_template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast('Sample CSV template downloaded', 'success');
    };
  }

  function parseRosterCsv(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const rawHeaders = lines[0].split(',').map((h) => h.replace(/^["']|["']$/g, '').trim().toLowerCase());
    
    const findIdx = (names) => rawHeaders.findIndex((h) => names.some((n) => h.includes(n)));
    const idxName = findIdx(['fullname', 'full name', 'name']);
    const idxCode = findIdx(['membercode', 'member code', 'code', 'emp id', 'employee']);
    const idxRole = findIdx(['role', 'type', 'designation']);
    const idxDiv = findIdx(['division', 'dept', 'department']);
    const idxBranch = findIdx(['branch', 'location', 'office']);
    const idxPhone = findIdx(['phone', 'mobile', 'contact', 'cell']);

    const existingCodes = new Set((state.members || []).map((m) => String(m.member_code).trim().toUpperCase()));
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const values = [];
      let current = '';
      let inQuotes = false;
      for (const char of lines[i]) {
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());

      const cleanVal = (idx) => (idx !== -1 && values[idx] ? values[idx].replace(/^["']|["']$/g, '').trim() : '');

      const fullName = cleanVal(idxName);
      const memberCode = cleanVal(idxCode).toUpperCase();
      const rawRole = cleanVal(idxRole);
      const role = rawRole.toLowerCase().includes('agent') ? 'Agent' : 'Staff';
      const divisionName = cleanVal(idxDiv) || 'Corporate Division';
      const branchName = cleanVal(idxBranch) || 'Global Headquarters - Tower A';
      const phoneNumber = cleanVal(idxPhone).replace(/\D/g, '') || '9800000000';

      if (!fullName && !memberCode) continue;

      const isDuplicate = existingCodes.has(memberCode);
      rows.push({
        fullName: fullName || 'Unnamed Member',
        memberCode: memberCode || `STF-${Date.now().toString(36).slice(-4).toUpperCase()}`,
        role,
        divisionName,
        branchName,
        phoneNumber,
        isDuplicate
      });
    }

    return rows;
  }

  function handleCsvFile(file) {
    if (!file) return;
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv' && file.type !== 'application/vnd.ms-excel') {
      showToast('Please select a valid .csv file', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      const rows = parseRosterCsv(content);
      if (rows.length === 0) {
        showToast('No valid member records found in CSV file', 'warning');
        return;
      }

      bulkImportParsedRows = rows;
      const validRows = rows.filter((r) => !r.isDuplicate);
      const duplicateCount = rows.filter((r) => r.isDuplicate).length;

      if (csvPreviewSection) csvPreviewSection.style.display = 'block';
      if (csvFileSummary) csvFileSummary.textContent = `${rows.length} total rows found in file`;
      if (csvBadgeValid) csvBadgeValid.textContent = `${validRows.length} ready to import`;
      if (csvBadgeDuplicates) csvBadgeDuplicates.textContent = `${duplicateCount} existing (skipped)`;

      if (csvPreviewTableBody) {
        csvPreviewTableBody.innerHTML = rows.slice(0, 50).map((r, i) => `
          <tr style="${r.isDuplicate ? 'opacity:0.6;background:rgba(239,68,68,0.06);' : ''}">
            <td>${i + 1}</td>
            <td><strong>${escapeHtml(r.fullName)}</strong></td>
            <td><code>${r.memberCode}</code></td>
            <td><span class="badge ${r.role === 'Staff' ? 'badge-info' : 'badge-warning'}">${r.role}</span></td>
            <td>${escapeHtml(r.divisionName)} &bull; ${escapeHtml(r.branchName)}</td>
            <td><code>${r.phoneNumber}</code></td>
            <td>
              ${r.isDuplicate
                ? '<span class="badge badge-neutral" title="Code already in database">Duplicate (Skip)</span>'
                : '<span class="badge badge-success">New</span>'}
            </td>
          </tr>
        `).join('');
      }

      if (btnConfirmBulkImport) {
        btnConfirmBulkImport.disabled = validRows.length === 0;
        btnConfirmBulkImport.textContent = `Import ${validRows.length} Members`;
      }
    };
    reader.onerror = () => showToast('Failed to read CSV file', 'error');
    reader.readAsText(file);
  }

  if (csvDropzone && csvFileInput) {
    csvDropzone.onclick = () => csvFileInput.click();
    csvFileInput.onchange = (e) => {
      if (e.target.files && e.target.files[0]) {
        handleCsvFile(e.target.files[0]);
      }
    };

    csvDropzone.ondragover = (e) => {
      e.preventDefault();
      csvDropzone.style.borderColor = 'var(--color-primary)';
      csvDropzone.style.background = 'rgba(79, 70, 229, 0.08)';
    };
    csvDropzone.ondragleave = () => {
      csvDropzone.style.borderColor = 'var(--color-border)';
      csvDropzone.style.background = 'var(--color-bg-secondary)';
    };
    csvDropzone.ondrop = (e) => {
      e.preventDefault();
      csvDropzone.style.borderColor = 'var(--color-border)';
      csvDropzone.style.background = 'var(--color-bg-secondary)';
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleCsvFile(e.dataTransfer.files[0]);
      }
    };
  }

  if (btnConfirmBulkImport) {
    btnConfirmBulkImport.onclick = async () => {
      const toImport = bulkImportParsedRows.filter((r) => !r.isDuplicate);
      if (toImport.length === 0) {
        showToast('No new members to import (all duplicate or empty)', 'warning');
        return;
      }

      try {
        btnConfirmBulkImport.disabled = true;
        btnConfirmBulkImport.textContent = 'Importing Roster...';

        const result = await dbService.bulkImportMembers(toImport);
        showToast(`Successfully imported ${result.imported} members! (${result.skipped} duplicates skipped)`, 'success');

        if (bulkImportModal) bulkImportModal.classList.remove('active');
        await refreshAllData();
      } catch (err) {
        showToast(err.message || 'Import failed', 'error');
        btnConfirmBulkImport.disabled = false;
        btnConfirmBulkImport.textContent = 'Try Import Again';
      }
    };
  }

  // Settings Modal & Supabase Configuration
  const btnSettings = document.getElementById('btnOpenSettings');
  const settingsModal = document.getElementById('settingsModal');
  const settingsForm = document.getElementById('supabaseConfigForm');
  const btnTestConn = document.getElementById('btnTestSupabase');
  const testConnStatus = document.getElementById('testConnStatus');

  if (btnSettings && settingsModal) {
    btnSettings.onclick = () => {
      const cfg = getSupabaseConfig();
      document.getElementById('supabaseUrl').value = cfg.url;
      document.getElementById('supabaseAnonKey').value = cfg.anonKey;
      document.getElementById('runModeSelect').value = cfg.mode;
      testConnStatus.textContent = '';
      settingsModal.classList.add('active');
    };
  }

  if (btnTestConn) {
    btnTestConn.onclick = async () => {
      const url = document.getElementById('supabaseUrl').value.trim();
      const key = document.getElementById('supabaseAnonKey').value.trim();
      if (!url || !key) {
        testConnStatus.innerHTML = '<span style="color:var(--accent-rose);">Please enter both URL and Anon Key.</span>';
        return;
      }
      testConnStatus.innerHTML = '<span class="spinner spinner-primary"></span> Testing connection...';
      const res = await testSupabaseConnection(url, key);
      if (res.success) {
        testConnStatus.innerHTML = `<span style="color:var(--accent-emerald);"><i data-lucide="circle-check"></i> ${res.message}</span>`;
      } else {
        testConnStatus.innerHTML = `<span style="color:var(--accent-rose);"><i data-lucide="circle-x"></i> ${res.message}</span>`;
      }
    };
  }

  if (settingsForm) {
    settingsForm.onsubmit = async (e) => {
      e.preventDefault();
      const url = document.getElementById('supabaseUrl').value.trim();
      const key = document.getElementById('supabaseAnonKey').value.trim();
      const mode = document.getElementById('runModeSelect').value;
      saveSupabaseConfig(url, key, mode);
      updateEnvBadge();
      settingsModal.classList.remove('active');
      showToast('Settings saved. Refreshing application state...', 'success');
      await refreshAllData();
    };
  }

  // Reset demo data button
  const btnResetDemo = document.getElementById('btnResetDemoData');
  if (btnResetDemo) {
    btnResetDemo.onclick = async () => {
      if (confirm('Reset local demo dataset to initial state? (Clears test check-ins and restores sample events).')) {
        dbService.resetDemoData();
        showToast('Demo data reset to clean state', 'info');
        await refreshAllData();
      }
    };
  }
}

// Live feed: Supabase Realtime pushes changes; while the socket is down, poll for changes since the
// newest record we have (never the whole table).
const FALLBACK_POLL_MS = 15000;
let realtimeUnsubscribe = null;
let fallbackPollInterval = null;

// Newest check-in or check-out time across records, as an ISO string
function latestChangeTime(records) {
  let latest = null;
  for (const r of records) {
    for (const t of [r.check_in_time, r.check_out_time]) {
      if (t && (!latest || t > latest)) latest = t;
    }
  }
  return latest;
}

function stopRealtimeFeed() {
  if (realtimeUnsubscribe) realtimeUnsubscribe();
  if (fallbackPollInterval) clearInterval(fallbackPollInterval);
  realtimeUnsubscribe = null;
  fallbackPollInterval = null;
}

function setupRealtimeFeed() {
  // Re-login must not stack a second subscription
  stopRealtimeFeed();

  realtimeUnsubscribe = dbService.subscribeToAttendance(
    (record) => applyLiveAttendance(record),
    { onStatus: (status) => setLiveStatus(status) }
  );

  fallbackPollInterval = setInterval(() => {
    if (state.liveStatus !== 'live' && document.visibilityState === 'visible') {
      syncAttendanceSince();
    }
  }, FALLBACK_POLL_MS);
}

function setLiveStatus(status) {
  state.liveStatus = status;
  const pill = document.querySelector('.live-status-pill');
  const text = document.querySelector('.live-status-text');
  if (pill) pill.classList.toggle('is-polling', status !== 'live');
  if (text) text.textContent = status === 'live' ? 'LIVE REALTIME FEED ACTIVE' : `RECONNECTING • CHECKING EVERY ${FALLBACK_POLL_MS / 1000}s`;
  // Catch up on anything missed while the socket was down
  if (status === 'live') syncAttendanceSince();
}

/**
 * Fetches only rows checked in or out since the last change we have
 */
async function syncAttendanceSince() {
  try {
    const changes = await dbService.getAttendanceRecords(state.lastSyncAt ? { since: state.lastSyncAt } : {});
    // Oldest first so the newest change ends up highlighted
    [...changes].reverse().forEach((record) => applyLiveAttendance(record, { quiet: changes.length > 5 }));
  } catch (err) {
    console.warn('Attendance sync failed:', err);
  }
}

/**
 * Inserts a new record or updates an existing one (check-out, manual edit).
 * Chimes and toasts only for check-ins this dashboard has not seen before.
 */
function applyLiveAttendance(record, { quiet = false } = {}) {
  if (!record || !record.id) return;

  // A rejected review removed the record (from this dashboard or another)
  if (record._deleted) {
    const before = state.attendance.length;
    state.attendance = state.attendance.filter((r) => r.id !== record.id);
    if (state.attendance.length !== before) {
      renderKpis();
      renderAttendanceTable();
      updateVisualAnalytics(state);
    }
    return;
  }

  const idx = state.attendance.findIndex((r) => r.id === record.id);
  const isNew = idx === -1;
  const previous = isNew ? null : state.attendance[idx];
  const isNewCheckOut = !isNew && record.check_out_time && !previous.check_out_time;

  if (isNew) {
    state.attendance.unshift(record);
  } else {
    state.attendance[idx] = { ...previous, ...record };
  }

  const changeTime = latestChangeTime([record]);
  if (changeTime && (!state.lastSyncAt || changeTime > state.lastSyncAt)) state.lastSyncAt = changeTime;

  if (!isNew && !isNewCheckOut) {
    // Same record seen again (another channel or poll overlap): refresh quietly
    renderAttendanceTable();
    return;
  }

  const tickerMsg = document.getElementById('tickerMessage');
  if (tickerMsg) {
    const verb = isNewCheckOut ? 'Just checked out' : 'Just checked in';
    const distText = record.distance_meters !== null && record.distance_meters !== undefined ? `(${Math.round(record.distance_meters)}m)` : '';
    tickerMsg.innerHTML = `<strong>${verb}:</strong> ${escapeHtml(record.full_name || 'Attendee')} • <span class="badge badge-info">${escapeHtml(record.role || 'Staff')}</span> • ${escapeHtml(record.event_name || 'Event')} ${distText}`;
  }

  renderKpis();
  renderAttendanceTable({ highlightId: record.id });
  updateVisualAnalytics(state);

  if (!quiet) {
    soundController.playDing();
    const label = isNewCheckOut ? 'Check-out' : 'Live check-in';
    const flag = record.verification_status === 'FLAGGED' ? ' • flagged for review' : '';
    showToast(`${label}: ${record.full_name || 'Attendee'} (${record.member_code || 'Code'})${flag}`, record.verification_status === 'FLAGGED' ? 'warning' : 'success');
  }
}

function setupLiveStreamControls() {
  const btnToggleSound = document.getElementById('btnToggleSound');
  const soundLabel = document.getElementById('soundToggleLabel');
  if (btnToggleSound && soundLabel) {
    const isEnabled = soundController.isEnabled();
    btnToggleSound.innerHTML = isEnabled ? '<i data-lucide="bell"></i> <span id="soundToggleLabel">Sound: ON</span>' : '<i data-lucide="bell-off"></i> <span id="soundToggleLabel">Sound: OFF</span>';
    btnToggleSound.onclick = () => {
      const active = soundController.toggle();
      btnToggleSound.innerHTML = active ? '<i data-lucide="bell"></i> <span id="soundToggleLabel">Sound: ON</span>' : '<i data-lucide="bell-off"></i> <span id="soundToggleLabel">Sound: OFF</span>';
      showToast(active ? 'Live audio chime enabled' : 'Live audio chime muted', 'info');
    };
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
