/**
 * User Portal Check-In Controller (Mobile Browser)
 * Handles QR parameter extraction, dynamic branch cascades, GPS verification,
 * atomic check-in submission, error notifications, and the digital attendance pass.
 */

import confetti from 'canvas-confetti';
import { dbService } from './db-service.js';
import { acquireBestPosition, evaluateGeofence, formatDistance } from './haversine.js';
import { formatWindow } from './event-window.js';
import { initAttendeeRadarMap } from './geo-map.js';
import { openInAppScanner } from './camera-scanner.js';
import { soundController } from './audio-chime.js';

// A GPS fix older than this is refreshed before submitting
const GPS_REFRESH_AFTER_MS = 60000;

// Controller State
const checkinState = {
  event: null,
  eventId: null,
  hostCode: null,
  windowEpoch: null,
  tokenSignature: null,
  scanTicket: null, // { id, expiresAt } from redeemHostScan
  hostInfo: null,
  divisions: [],
  branchMembers: [], // Members loaded for currently selected branch and role
  selectedMemberId: null, // Person picked in the search field
  selectedRole: 'Staff',
  action: 'CHECK_IN', // 'CHECK_IN' | 'CHECK_OUT'
  currentPosition: null,
  radarMap: null,
  gpsStatus: 'idle', // 'idle' | 'locating' | 'verified' | 'warning' | 'error'
  isSubmitting: false
};

export async function initCheckInPortal() {
  parseQueryParams();
  setupActionToggle();
  setupRoleToggle();
  setupPersonPicker();
  setupFormListeners();
  setupScannerAction();

  // Check-in is only possible by scanning a staff member's rotating QR (no static venue QR)
  if (!checkinState.eventId || !checkinState.hostCode) {
    showErrorState(
      'Scan a Staff QR Code',
      'To mark attendance, scan the live QR code shown on an authorized staff member\'s phone at the venue.'
    );
    return;
  }

  const ticketOk = await ensureScanTicket();
  if (!ticketOk) return;

  await loadEventAndBootstrap();
}

/**
 * Turns the scanned QR (event, host, window, signature) into a one-time ticket on the server.
 * The ticket is kept for this browser tab so a reload does not need a new scan.
 */
async function ensureScanTicket() {
  const storageKey = `attendpro_scan_ticket:${checkinState.eventId}`;
  const now = Date.now();

  // Fresh scan in the URL wins over a stored ticket
  if (checkinState.windowEpoch !== null && checkinState.tokenSignature) {
    const result = await dbService.redeemHostScan({
      eventId: checkinState.eventId,
      hostCode: checkinState.hostCode,
      windowEpoch: checkinState.windowEpoch,
      signature: checkinState.tokenSignature
    });

    // Drop the one-time QR values from the address bar so sharing or reloading this page cannot reuse them
    const cleanParams = new URLSearchParams({ event: checkinState.eventId, host: checkinState.hostCode });
    history.replaceState(null, '', `${window.location.pathname}?${cleanParams.toString()}`);

    if (!result?.success) {
      showErrorState('QR Code Not Accepted', result?.message || 'This QR code could not be verified. Scan the live code on the staff member\'s phone.');
      return false;
    }

    checkinState.scanTicket = { id: result.ticket, expiresAt: new Date(result.expires_at).getTime() };
    checkinState.hostInfo = {
      full_name: result.host_name,
      member_code: result.host_member_code,
      station_name: result.host_station
    };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ ...checkinState.scanTicket, host: checkinState.hostInfo }));
    } catch (e) {}
    return true;
  }

  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (stored && stored.expiresAt > now) {
      checkinState.scanTicket = { id: stored.id, expiresAt: stored.expiresAt };
      checkinState.hostInfo = stored.host || null;
      return true;
    }
  } catch (e) {}

  showErrorState('Scan Again', 'Your scan has expired. Scan the live QR code on the staff member\'s phone again.');
  return false;
}


/**
 * Extract event_id, token, and dynamic host parameters from URL query string
 */
function parseQueryParams() {
  const urlParams = new URLSearchParams(window.location.search);
  checkinState.eventId = urlParams.get('event_id') || urlParams.get('event');
  checkinState.hostCode = urlParams.get('host') || null;
  const epochParam = urlParams.get('w');
  checkinState.windowEpoch = epochParam ? parseInt(epochParam, 10) : null;
  checkinState.tokenSignature = urlParams.get('sig') || null;
}

/**
 * Replace the loading state with an error card (the card offers a camera scan button)
 */
function showErrorState(title, message) {
  const loadingOverlay = document.getElementById('loadingState');
  const formContainer = document.getElementById('checkinFormContainer');
  const errorCard = document.getElementById('errorBannerCard');
  const errorTitle = document.getElementById('errorBannerTitle');
  const errorMsg = document.getElementById('errorBannerMessage');

  if (loadingOverlay) {
    loadingOverlay.classList.add('is-hidden');
    loadingOverlay.style.display = 'none';
  }
  if (formContainer) {
    formContainer.classList.add('is-hidden');
    formContainer.style.display = 'none';
  }
  if (errorCard) {
    errorCard.classList.remove('is-hidden');
    errorCard.style.display = 'block';
    if (errorTitle) errorTitle.textContent = title;
    if (errorMsg) errorMsg.textContent = message;
  }
}

/**
 * Check In / Check Out switch, shown only for events with check-out enabled
 */
function setupActionToggle() {
  const btnIn = document.getElementById('actionBtnCheckIn');
  const btnOut = document.getElementById('actionBtnCheckOut');
  const submitBtnText = document.getElementById('submitBtnText');

  const select = (action) => {
    checkinState.action = action;
    btnIn?.classList.toggle('active', action === 'CHECK_IN');
    btnOut?.classList.toggle('active', action === 'CHECK_OUT');
    if (submitBtnText) submitBtnText.textContent = submitLabel();
  };

  if (btnIn) btnIn.onclick = () => select('CHECK_IN');
  if (btnOut) btnOut.onclick = () => select('CHECK_OUT');
}

function submitLabel() {
  return checkinState.action === 'CHECK_OUT' ? 'Confirm & Check Out' : 'Confirm & Mark Attendance';
}

/**
 * Load event details and cascading divisions
 */
async function loadEventAndBootstrap() {
  const loadingOverlay = document.getElementById('loadingState');
  const checkinFormContainer = document.getElementById('checkinFormContainer');
  const errorCard = document.getElementById('errorBannerCard');

  try {
    const event = await dbService.getEventById(checkinState.eventId);
    if (!event) {
      throw new Error('Event not found or no longer active. Please scan the live QR code on a staff member\'s phone.');
    }

    checkinState.event = event;
    renderEventHeader(event);

    if (event.checkout_enabled) {
      document.getElementById('actionToggleGroup')?.classList.remove('is-hidden');
    }

    // Verified host from the scan ticket
    const host = checkinState.hostInfo;
    const beaconBanner = document.getElementById('scannedBeaconBanner');
    const beaconDetails = document.getElementById('scannedBeaconHostDetails');
    if (host && beaconBanner) {
      beaconBanner.classList.remove('is-hidden');
      if (beaconDetails) {
        const validUntil = new Date(checkinState.scanTicket.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        beaconDetails.innerHTML = `<strong>${escapeHtml(host.full_name || 'Attendance taker')}</strong> (${escapeHtml(host.member_code)}) &bull; ${escapeHtml(host.station_name || 'Station')} &bull; Submit before ${escapeHtml(validUntil)}`;
      }
    }

    // Load divisions
    checkinState.divisions = await dbService.getDivisions();
    populateDivisions(checkinState.divisions);

    // Initial GPS location request if location is required
    if (event.location_required) {
      triggerGpsCheck(false); // Non-blocking initial check
    } else {
      updateGpsIndicator('not-required', 'This event does not check your location.');
      document.getElementById('btnRetryGps')?.classList.add('is-hidden');
    }

    if (loadingOverlay) {
      loadingOverlay.classList.add('is-hidden');
      loadingOverlay.style.display = 'none';
    }
    if (checkinFormContainer) {
      checkinFormContainer.classList.remove('is-hidden');
      checkinFormContainer.style.display = 'block';
    }
  } catch (err) {
    if (loadingOverlay) {
      loadingOverlay.classList.add('is-hidden');
      loadingOverlay.style.display = 'none';
    }
    if (errorCard) {
      errorCard.classList.remove('is-hidden');
      errorCard.style.display = 'block';
      document.getElementById('errorBannerTitle').textContent = 'Event Validation Failed';
      document.getElementById('errorBannerMessage').textContent = err.message;
    }
  }
}

/**
 * "2026-10-26" -> "Mon, 26 Oct 2026" (parsed as a local date, not UTC midnight)
 */
function formatEventDate(isoDate) {
  const [y, m, d] = String(isoDate || '').split('-').map(Number);
  if (!y || !m || !d) return isoDate || '';
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Render Header with Event Confirmation details
 */
function renderEventHeader(event) {
  const titleEl = document.getElementById('eventHeadingName');
  const venueEl = document.getElementById('eventVenueDisplay');
  const dateEl = document.getElementById('eventDateDisplay');
  const timeEl = document.getElementById('eventTimeDisplay');
  if (titleEl) titleEl.textContent = event.name;
  if (venueEl) venueEl.textContent = event.venue;
  if (dateEl) dateEl.textContent = formatEventDate(event.date);
  if (timeEl) timeEl.textContent = formatWindow(event);

  // Pre-select role if event is single-role
  if (event.permitted_roles === 'Agent') {
    selectRole('Agent');
    const staffBtn = document.getElementById('roleBtnStaff');
    if (staffBtn) staffBtn.style.display = 'none';
  } else if (event.permitted_roles === 'Staff') {
    selectRole('Staff');
    const agentBtn = document.getElementById('roleBtnAgent');
    if (agentBtn) agentBtn.style.display = 'none';
  }
}

/**
 * Setup Role Segmented Toggle (Staff vs Agent)
 */
function setupRoleToggle() {
  const btnStaff = document.getElementById('roleBtnStaff');
  const btnAgent = document.getElementById('roleBtnAgent');
  const personLabel = document.getElementById('personLabel');

  if (btnStaff) {
    btnStaff.onclick = () => selectRole('Staff');
  }
  if (btnAgent) {
    btnAgent.onclick = () => selectRole('Agent');
  }

  function selectRole(role) {
    checkinState.selectedRole = role;
    btnStaff?.classList.toggle('active', role === 'Staff');
    btnAgent?.classList.toggle('active', role === 'Agent');
    if (personLabel) {
      const codeName = role === 'Staff' ? 'Employee Code' : 'Agent Code';
      personLabel.innerHTML = `Your Name or ${codeName} <span class="required">*</span>`;
    }

    // Reload the person list for this role if a branch is selected
    const branchSelect = document.getElementById('selectBranch');
    if (branchSelect && branchSelect.value) {
      loadBranchMembers(branchSelect.value);
    } else {
      loadBranchMembers('');
    }
  }

  window.selectRole = selectRole;
}

/**
 * Populate Division Dropdown and Setup Cascade to Branch
 */
function populateDivisions(divisions) {
  const divSelect = document.getElementById('selectDivision');
  const branchSelect = document.getElementById('selectBranch');
  if (!divSelect) return;

  divSelect.innerHTML = '<option value="">-- Select Division --</option>' +
    divisions.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');

  divSelect.onchange = async () => {
    const divisionId = divSelect.value;
    loadBranchMembers('');

    if (!divisionId) {
      branchSelect.innerHTML = '<option value="">-- Select Division First --</option>';
      branchSelect.disabled = true;
      return;
    }

    branchSelect.disabled = true;
    branchSelect.innerHTML = '<option value="">Loading branches...</option>';

    try {
      const branches = await dbService.getBranches(divisionId);
      if (branches.length === 0) {
        branchSelect.innerHTML = '<option value="">No branches under this division</option>';
      } else if (branches.length === 1) {
        branchSelect.innerHTML = `<option value="${branches[0].id}">${escapeHtml(branches[0].name)}</option>`;
        branchSelect.value = branches[0].id;
        branchSelect.disabled = false;
        loadBranchMembers(branches[0].id);
      } else {
        branchSelect.innerHTML = '<option value="">-- Select Branch --</option>' +
          branches.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
        branchSelect.disabled = false;
      }
    } catch (err) {
      branchSelect.innerHTML = '<option value="">Failed to load branches</option>';
    }
  };

  if (branchSelect) {
    branchSelect.onchange = () => {
      loadBranchMembers(branchSelect.value);
    };
  }
}

/**
 * Load active members for the selected branch and role into the person search
 */
async function loadBranchMembers(branchId) {
  const input = document.getElementById('inputPersonSearch');
  const helper = document.getElementById('personHelper');
  if (!input) return;

  clearPersonSelection();
  checkinState.branchMembers = [];

  if (!branchId) {
    input.disabled = true;
    input.placeholder = 'Select your branch first';
    if (helper) helper.textContent = 'Pick your branch, then type part of your name or code.';
    return;
  }

  input.disabled = true;
  input.placeholder = 'Loading names...';

  try {
    const role = checkinState.selectedRole;
    // Only id, name and code are returned; the attendee must type their own mobile number
    const members = await dbService.getBranchMembersForCheckin(branchId, role);
    checkinState.branchMembers = (members || []).slice().sort((a, b) => a.full_name.localeCompare(b.full_name));

    if (checkinState.branchMembers.length === 0) {
      const roleLabel = role === 'Staff' ? 'staff members' : 'agents';
      input.placeholder = `No active ${roleLabel} in this branch`;
      if (helper) helper.textContent = 'Check that you picked the right division, branch and role.';
      return;
    }

    input.disabled = false;
    input.placeholder = 'Type your name or code';
    if (helper) helper.textContent = `${checkinState.branchMembers.length} people in this branch. Type part of your name or code, then pick yourself.`;
  } catch (err) {
    console.error('Failed to load branch members:', err);
    input.placeholder = 'Could not load names';
    if (helper) helper.textContent = 'Check your connection and select the branch again.';
  }
}

// Show at most this many matches; small branches list everyone on focus
const PERSON_RESULT_LIMIT = 8;
const PERSON_SHOW_ALL_UP_TO = 12;
let personActiveIndex = -1;
let personMatches = [];

function findPeople(query) {
  const all = checkinState.branchMembers || [];
  const q = query.trim().toLowerCase();
  if (!q) return all.length <= PERSON_SHOW_ALL_UP_TO ? all : [];

  const scored = [];
  for (const m of all) {
    const name = m.full_name.toLowerCase();
    const code = String(m.member_code).toLowerCase();
    let score = -1;
    if (code === q) score = 0;
    else if (code.startsWith(q) || name.startsWith(q)) score = 1;
    else if (name.split(/\s+/).some((part) => part.startsWith(q))) score = 2;
    else if (name.includes(q) || code.includes(q)) score = 3;
    if (score >= 0) scored.push({ m, score });
  }
  scored.sort((a, b) => a.score - b.score || a.m.full_name.localeCompare(b.m.full_name));
  return scored.slice(0, PERSON_RESULT_LIMIT).map((s) => s.m);
}

function renderPersonResults(query) {
  const input = document.getElementById('inputPersonSearch');
  const list = document.getElementById('personResults');
  if (!input || !list) return;

  personMatches = findPeople(query);
  personActiveIndex = personMatches.length > 0 ? 0 : -1;

  if (personMatches.length === 0) {
    if (!query.trim()) {
      closePersonResults();
      return;
    }
    list.innerHTML = '<li class="person-results-empty" role="option" aria-disabled="true">No match in this branch. Check the spelling, or your division and branch.</li>';
  } else {
    list.innerHTML = personMatches
      .map((m, idx) => `
        <li id="personOption-${idx}" role="option" data-index="${idx}" aria-selected="${idx === personActiveIndex}">
          <span>${escapeHtml(m.full_name)}</span>
          <span class="person-result-code">${escapeHtml(m.member_code)}</span>
        </li>`)
      .join('');
  }

  list.classList.remove('is-hidden');
  input.setAttribute('aria-expanded', 'true');
  updatePersonActiveOption();
}

function updatePersonActiveOption() {
  const input = document.getElementById('inputPersonSearch');
  const list = document.getElementById('personResults');
  list.querySelectorAll('li[data-index]').forEach((li) => {
    const isActive = Number(li.dataset.index) === personActiveIndex;
    li.setAttribute('aria-selected', String(isActive));
    if (isActive) li.scrollIntoView({ block: 'nearest' });
  });
  if (personActiveIndex >= 0) input.setAttribute('aria-activedescendant', `personOption-${personActiveIndex}`);
  else input.removeAttribute('aria-activedescendant');
}

function closePersonResults() {
  const input = document.getElementById('inputPersonSearch');
  const list = document.getElementById('personResults');
  list?.classList.add('is-hidden');
  input?.setAttribute('aria-expanded', 'false');
  input?.removeAttribute('aria-activedescendant');
  personActiveIndex = -1;
}

function selectPerson(member) {
  checkinState.selectedMemberId = member.id;
  closePersonResults();
  document.getElementById('personCombobox')?.classList.add('is-hidden');
  document.getElementById('personSelected')?.classList.remove('is-hidden');
  document.getElementById('personSelectedText').textContent = `${member.full_name} (${member.member_code})`;
  document.getElementById('inputPhoneNumber')?.focus();
}

function clearPersonSelection() {
  checkinState.selectedMemberId = null;
  const input = document.getElementById('inputPersonSearch');
  if (input) input.value = '';
  closePersonResults();
  document.getElementById('personCombobox')?.classList.remove('is-hidden');
  document.getElementById('personSelected')?.classList.add('is-hidden');
}

/**
 * One searchable field picks the attendee by name or code.
 * The phone number is never filled in: it is the attendee's proof of identity.
 */
function setupPersonPicker() {
  const input = document.getElementById('inputPersonSearch');
  const list = document.getElementById('personResults');
  const btnChange = document.getElementById('btnPersonChange');
  if (!input || !list) return;

  input.addEventListener('input', () => renderPersonResults(input.value));
  input.addEventListener('focus', () => renderPersonResults(input.value));

  input.addEventListener('keydown', (e) => {
    const isOpen = !list.classList.contains('is-hidden');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) renderPersonResults(input.value);
      else if (personMatches.length > 0) personActiveIndex = (personActiveIndex + 1) % personMatches.length;
      updatePersonActiveOption();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (personMatches.length > 0) personActiveIndex = (personActiveIndex - 1 + personMatches.length) % personMatches.length;
      updatePersonActiveOption();
    } else if (e.key === 'Enter') {
      // Enter picks the highlighted person instead of submitting the form
      if (isOpen && personActiveIndex >= 0) {
        e.preventDefault();
        selectPerson(personMatches[personActiveIndex]);
      }
    } else if (e.key === 'Escape') {
      closePersonResults();
    }
  });

  // pointerdown fires before the input's blur, so the tap is not lost when the list closes
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li[data-index]');
    if (!li) return;
    e.preventDefault();
    selectPerson(personMatches[Number(li.dataset.index)]);
  });

  input.addEventListener('blur', () => setTimeout(closePersonResults, 150));

  if (btnChange) {
    btnChange.onclick = () => {
      clearPersonSelection();
      input.focus();
    };
  }
}

/**
 * Geolocation Check Logic
 */
/**
 * Reads the best GPS fix over a few seconds and previews the server's geofence decision.
 * @returns {Promise<{ok:boolean, message?:string}>}
 */
async function triggerGpsCheck(isManualClick = true) {
  const event = checkinState.event;
  if (!event || !event.location_required) return { ok: true };

  updateGpsIndicator('locating', 'Acquiring high-accuracy GPS coordinates (up to 8 seconds)...');

  try {
    const position = await acquireBestPosition({ durationMs: 8000 });
    checkinState.currentPosition = position;

    const geo = evaluateGeofence(event, gpsFixForSubmit(position));
    const accuracyText = `accuracy ±${Math.round(position.accuracy)}m`;

    if (geo.distance !== null) {
      const mapWrapper = document.getElementById('checkinRadarMapWrapper');
      const radarPill = document.getElementById('radarStatusPill');
      const isInside = geo.ok;

      if (mapWrapper) mapWrapper.classList.remove('is-hidden');
      if (radarPill) {
        radarPill.className = `map-status-pill ${isInside ? 'inside' : 'outside'}`;
        radarPill.textContent = isInside
          ? `Inside Geofence (${Math.round(geo.distance)}m, ${accuracyText})`
          : `Outside Geofence (${Math.round(geo.distance)}m > ${event.radius_meters}m)`;
      }

      if (!checkinState.radarMap) {
        checkinState.radarMap = initAttendeeRadarMap(
          'checkinRadarMap',
          { latitude: event.latitude, longitude: event.longitude },
          event.radius_meters,
          position
        );
      } else {
        checkinState.radarMap.updateUserLocation(position);
      }
    }

    if (!geo.ok) {
      updateGpsIndicator(geo.code === 'OUTSIDE_GEOFENCE' ? 'warning' : 'error', geo.message);
      if (isManualClick) alert(geo.message);
      return { ok: false, message: geo.message, code: geo.code };
    }

    const note = geo.flags.length > 0 ? ' • Will be flagged for admin review' : '';
    updateGpsIndicator(
      'verified',
      `GPS Verified: At venue (${formatDistance(geo.distance)} from center, ${accuracyText}, radius ${event.radius_meters}m)${note}`
    );
    return { ok: true };
  } catch (err) {
    updateGpsIndicator('error', err.message);
    if (isManualClick) {
      alert(err.message);
    }
    return { ok: false, message: err.message, code: 'GPS_REQUIRED' };
  }
}

/**
 * GPS fields sent to the server (and used for the local preview)
 */
function gpsFixForSubmit(position) {
  if (!position) return {};
  return {
    latitude: position.latitude,
    longitude: position.longitude,
    accuracy: position.accuracy,
    positionAgeMs: position.timestamp ? Math.max(0, Date.now() - position.timestamp) : null,
    gpsSuspicious: Boolean(position.isMockSuspicious)
  };
}

/**
 * Opens the in-app camera for a staff QR code
 */
function openStaffQrScanner() {
  openInAppScanner({
    title: 'Scan Staff QR Code',
    subtitle: 'Align the physical QR code or staff phone screen in the viewfinder',
    onScanSuccess: (decodedText) => {
      // Only staff beacon QR codes (checkin.html links with host, window and signature) are accepted
      try {
        const url = new URL(decodedText, window.location.origin);
        if (url.pathname.endsWith('/checkin.html') && url.searchParams.get('host') && url.searchParams.get('sig')) {
          window.location.href = `/checkin.html${url.search}`;
          return;
        }
      } catch (e) {}
      showErrorState('Not a Staff QR Code', 'This is not an attendance QR code. Scan the live QR code shown on an authorized staff member\'s phone.');
    }
  });
}

/**
 * Setup In-App Scanner Buttons
 */
function setupScannerAction() {
  const btnScan = document.getElementById('btnCheckinCameraScan');
  const btnErrorScan = document.getElementById('btnErrorScanQr');

  if (btnScan) btnScan.onclick = openStaffQrScanner;
  if (btnErrorScan) btnErrorScan.onclick = openStaffQrScanner;
}

function updateGpsIndicator(status, message) {
  const dot = document.getElementById('gpsRadarDot');
  const title = document.getElementById('gpsStatusTitle');
  const sub = document.getElementById('gpsStatusSub');

  if (!dot || !title || !sub) return;

  dot.className = `radar-dot ${status === 'not-required' ? 'verified' : status} ${status === 'locating' ? 'pulsing' : ''}`;

  if (status === 'not-required') {
    title.textContent = 'Location Not Needed';
    sub.textContent = message;
  } else if (status === 'locating') {
    title.textContent = 'Verifying Location...';
    sub.textContent = message;
  } else if (status === 'verified') {
    title.textContent = 'Location Verified';
    sub.textContent = message;
  } else if (status === 'warning') {
    title.textContent = 'Location Warning';
    sub.textContent = message;
  } else if (status === 'error') {
    title.textContent = 'Location Blocked';
    sub.textContent = message;
  }
}

/**
 * Setup Form Submission & Validation Flow
 */
function setupFormListeners() {
  const form = document.getElementById('userCheckinForm');
  const btnRetryLocation = document.getElementById('btnRetryGps');

  if (btnRetryLocation) {
    btnRetryLocation.onclick = () => triggerGpsCheck(true);
  }

  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (checkinState.isSubmitting) return;

      const personInput = document.getElementById('inputPersonSearch');
      const phoneInput = document.getElementById('inputPhoneNumber');
      const divSelect = document.getElementById('selectDivision');
      const branchSelect = document.getElementById('selectBranch');
      const submitBtn = document.getElementById('btnSubmitCheckin');
      const submitBtnText = document.getElementById('submitBtnText');
      const submitBtnSpinner = document.getElementById('submitBtnSpinner');

      const divisionId = divSelect ? divSelect.value : '';
      const branchId = branchSelect ? branchSelect.value : '';
      const memberId = checkinState.selectedMemberId || '';
      const phoneNumber = phoneInput ? phoneInput.value.trim() : '';

      // Basic client-side checks
      if (!divisionId) {
        alert('Please select your Division.');
        divSelect?.focus();
        return;
      }

      if (!branchId) {
        alert('Please select your Branch.');
        branchSelect?.focus();
        return;
      }

      if (!memberId) {
        alert('Type part of your name or code, then pick yourself from the list.');
        personInput?.focus();
        return;
      }

      const selectedMember = checkinState.branchMembers.find((m) => m.id === memberId);
      if (!selectedMember) {
        alert('Selected member profile could not be found. Please re-select from the list.');
        return;
      }

      const cleanPhone = phoneNumber.replace(/\D/g, '');
      if (cleanPhone.length < 10) {
        alert('Please enter a valid 10-digit mobile number.');
        phoneInput?.focus();
        return;
      }

      if (!checkinState.scanTicket || checkinState.scanTicket.expiresAt < Date.now()) {
        showRejectionNotice('More than 10 minutes passed since you scanned. Scan the staff member\'s QR code again.', 'TICKET_EXPIRED');
        return;
      }

      // Start submission; the flag and disabled button stop double taps while GPS and the request run
      checkinState.isSubmitting = true;
      submitBtn.disabled = true;
      submitBtnSpinner.style.display = 'inline-block';

      const resetSubmitButton = () => {
        checkinState.isSubmitting = false;
        submitBtn.disabled = false;
        submitBtnText.textContent = submitLabel();
        submitBtnSpinner.style.display = 'none';
      };

      // Use a fresh GPS fix: the one from page load may be minutes old
      if (checkinState.event.location_required) {
        const position = checkinState.currentPosition;
        const isStale = !position || !position.timestamp || Date.now() - position.timestamp > GPS_REFRESH_AFTER_MS;
        if (isStale) {
          submitBtnText.textContent = 'Checking Your Location...';
          const gps = await triggerGpsCheck(false);
          if (!gps.ok) {
            showRejectionNotice(gps.message || 'We could not verify your location. Tap "Retry GPS" and try again.', gps.code || 'GPS_REQUIRED');
            resetSubmitButton();
            return;
          }
        } else {
          const geo = evaluateGeofence(checkinState.event, gpsFixForSubmit(position));
          if (!geo.ok) {
            showRejectionNotice(geo.message, geo.code);
            resetSubmitButton();
            return;
          }
        }
      }

      submitBtnText.textContent = checkinState.action === 'CHECK_OUT' ? 'Recording Check-Out...' : 'Verifying Attendance...';

      const payload = {
        eventId: checkinState.eventId,
        checkInMode: 'ATTENDEE_SCAN',
        scanTicket: checkinState.scanTicket.id,
        action: checkinState.action,
        role: checkinState.selectedRole,
        memberCode: selectedMember.member_code,
        phoneNumber: phoneNumber,
        divisionId: divisionId,
        branchId: branchId,
        ...gpsFixForSubmit(checkinState.currentPosition),
        userAgent: navigator.userAgent
      };

      const divObj = checkinState.divisions.find((d) => d.id === divisionId);
      const branchName = branchSelect?.options[branchSelect.selectedIndex]?.text || '';

      const eventContext = {
        name: checkinState.event?.name || 'Attendance Event',
        venue: checkinState.event?.venue || 'Event Venue',
        memberName: selectedMember.full_name,
        divisionName: divObj ? divObj.name : '',
        branchName: branchName
      };

      // Require live internet connection - strictly online attendance only
      if (!navigator.onLine) {
        showRejectionNotice('Live internet connection required to record attendance. Please connect to mobile data or Wi-Fi and retry.');
        resetSubmitButton();
        return;
      }

      try {
        const result = await dbService.submitAttendance(payload);

        if (result.success) {
          // The scan ticket is now used; a later visit needs a new scan
          try {
            sessionStorage.removeItem(`attendpro_scan_ticket:${checkinState.eventId}`);
          } catch (e) {}
          showAttendancePass(result.data, { alreadyRecorded: Boolean(result.already_recorded) });
        } else if (ALREADY_RECORDED_CODES.has(result.code)) {
          showAlreadyRecordedNotice(result.message, result.code);
        } else {
          showRejectionNotice(result.message || 'Validation failed. Please verify your details and retry.', result.code);
        }
      } catch (err) {
        console.error('Online attendance submission failed:', err);
        showRejectionNotice(err.message || 'Attendance recording failed. A stable live internet connection is required.');
      } finally {
        resetSubmitButton();
      }
    };
  }
}

/**
 * Display Celebratory Success Ticket / Digital Pass
 */
function showAttendancePass(data, { alreadyRecorded = false } = {}) {
  const formCard = document.getElementById('checkinFormContainer');
  const passContainer = document.getElementById('passTicketContainer');
  const isCheckOut = data.action === 'CHECK_OUT';

  const titleEl = document.getElementById('passVerifiedTitle');
  const subtitleEl = document.getElementById('passVerifiedSubtitle');
  if (titleEl) {
    if (alreadyRecorded) titleEl.textContent = isCheckOut ? 'You\'re Already Checked Out' : 'You\'re Already Checked In';
    else titleEl.textContent = isCheckOut ? 'Check-Out Recorded!' : 'Attendance Verified!';
  }
  if (subtitleEl) {
    const recordedAt = isCheckOut ? data.check_out_time : data.check_in_time;
    subtitleEl.textContent = alreadyRecorded
      ? `Nothing more to do. Recorded at ${recordedAt}. This is your existing pass.`
      : 'Official Digital Receipt Recorded';
  }
  passContainer?.classList.toggle('is-already-recorded', alreadyRecorded);

  // Late arrival / flagged-for-review note
  const notes = [];
  if (data.is_late && !isCheckOut) notes.push('Marked late');
  if (data.verification_status === 'FLAGGED') notes.push('Location will be reviewed by the admin');
  const noteEl = document.getElementById('passStatusNote');
  if (noteEl) {
    noteEl.textContent = notes.join(' • ');
    noteEl.classList.toggle('is-hidden', notes.length === 0);
  }

  if (formCard) {
    formCard.classList.add('is-hidden');
    formCard.style.display = 'none';
  }
  if (passContainer) {
    passContainer.classList.remove('is-hidden');
    passContainer.style.display = 'block';
  }

  document.getElementById('passMemberName').textContent = data.full_name;
  document.getElementById('passMemberCode').textContent = data.member_code;
  document.getElementById('passRoleBadge').textContent = data.role;
  document.getElementById('passDivision').textContent = data.division || data.division_name || '';
  document.getElementById('passBranch').textContent = data.branch || data.branch_name || '';
  document.getElementById('passEventName').textContent = data.event_name;
  document.getElementById('passVenue').textContent = data.venue;
  document.getElementById('passTimestamp').textContent = isCheckOut
    ? `In: ${data.check_in_time} • Out: ${data.check_out_time}`
    : data.check_in_time;
  document.getElementById('passTicketRef').textContent = `PASS-${data.ticket_id.slice(0, 8).toUpperCase()}`;

  const distEl = document.getElementById('passGpsDistance');
  if (distEl) {
    distEl.textContent = data.distance_meters !== null && data.distance_meters !== undefined
      ? `${Math.round(data.distance_meters)}m from venue`
      : 'Verified';
  }


  const passHostField = document.getElementById('passHostField');
  const passVerifiedBy = document.getElementById('passVerifiedBy');
  if (passHostField && passVerifiedBy) {
    if (data.check_in_mode === 'HOST_SELF') {
      passHostField.style.display = 'block';
      passVerifiedBy.innerHTML = '<i data-lucide="star"></i> <strong>Attendance taker</strong> (self check-in)';
    } else if (data.host_name || data.host_member_code) {
      passHostField.style.display = 'block';
      passVerifiedBy.innerHTML = `<i data-lucide="smartphone"></i> <strong>${escapeHtml(data.host_name || 'Attendance taker')}</strong> (${escapeHtml(data.host_member_code || '')}) &bull; ${escapeHtml(data.host_station || 'Station')}`;
    } else {
      passHostField.style.display = 'block';
      passVerifiedBy.textContent = data.check_in_mode === 'ADMIN_MANUAL' ? 'Manual entry by administrator' : 'Verified';
    }
  }

  // Sound chime & haptic feedback
  try {
    soundController.playDing();
  } catch (e) {}
  if (navigator.vibrate) {
    try { navigator.vibrate([60, 40, 60]); } catch (e) {}
  }

  // Trigger celebration confetti (only for a new record)
  if (!alreadyRecorded) {
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 }
      });
    } catch (e) {
      // Confetti is purely decorative
    }
  }

  // Save / Download Pass as Image (Canvas PNG)
  const btnDownload = document.getElementById('btnDownloadPassImage');
  if (btnDownload) {
    btnDownload.onclick = () => {
      downloadPassImage(data);
    };
  }

  // Share Pass via Web Share API or WhatsApp
  const btnShare = document.getElementById('btnSharePassTicket');
  if (btnShare) {
    btnShare.onclick = () => {
      sharePassTicket(data);
    };
  }
}

/**
 * Render Digital Attendance Pass as high-res PNG image & trigger download
 */
function downloadPassImage(data) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 840;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 640, 840);

  // Top header green gradient
  const grad = ctx.createLinearGradient(0, 0, 640, 240);
  grad.addColorStop(0, '#065f46');
  grad.addColorStop(1, '#059669');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 640, 240);

  // Header Title & Subtitle
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('✓ ATTENDANCE VERIFIED', 320, 85);

  ctx.font = '15px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#d1fae5';
  ctx.fillText('Official Digital Receipt • Quick Access AttendPro', 320, 120);

  const refId = data.ticket_id ? `PASS-${data.ticket_id.slice(0, 8).toUpperCase()}` : 'PASS-VERIFIED';
  ctx.fillStyle = '#a7f3d0';
  ctx.font = 'bold 18px monospace';
  ctx.fillText(refId, 320, 160);

  // Card Body Background
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.roundRect(40, 210, 560, 580, 16);
  ctx.fill();
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Field renderer helper
  const drawField = (label, val, x, y, valColor = '#ffffff') => {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText(label.toUpperCase(), x, y);
    ctx.fillStyle = valColor;
    ctx.font = 'bold 19px system-ui, -apple-system, sans-serif';
    ctx.fillText(String(val || '-'), x, y + 24);
  };

  drawField('Attendee Name', data.full_name, 70, 255);
  drawField('Role & Code', `${data.role} • ${data.member_code}`, 70, 335, '#38bdf8');
  drawField('Division / Branch', `${data.division || data.division_name || ''} • ${data.branch || data.branch_name || ''}`, 70, 415);
  drawField('Event Name', data.event_name, 70, 495);
  drawField('Venue Location', data.venue, 70, 575);
  drawField('Verified Timestamp', data.check_in_time, 70, 655);
  drawField('GPS Distance', data.distance_meters !== null && data.distance_meters !== undefined ? `${Math.round(data.distance_meters)}m from venue center` : 'GPS Verified', 70, 735, '#34d399');

  // Watermark/footer
  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '12px system-ui, -apple-system, sans-serif';
  ctx.fillText('Quick Access AttendPro', 320, 815);

  // Trigger download
  const link = document.createElement('a');
  link.download = `Attendance_Pass_${data.member_code}_${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Share pass via Web Share API or WhatsApp
 */
async function sharePassTicket(data) {
  const refId = data.ticket_id ? `PASS-${data.ticket_id.slice(0, 8).toUpperCase()}` : 'PASS-VERIFIED';
  const textToShare = `✅ Attendance Verified!\n` +
    `👤 Name: ${data.full_name} (${data.member_code})\n` +
    `👔 Role: ${data.role}\n` +
    `🏢 ${data.division || data.division_name || ''} / ${data.branch || data.branch_name || ''}\n` +
    `📅 Event: ${data.event_name} (${data.venue})\n` +
    `⏰ Time: ${data.check_in_time}\n` +
    `🛡️ Ref: ${refId}`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: `Attendance Verified - ${data.event_name}`,
        text: textToShare,
        url: window.location.href
      });
      return;
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.warn('Web Share failed, fallback to WhatsApp:', e);
      } else {
        return;
      }
    }
  }

  // WhatsApp fallback
  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(textToShare)}`;
  window.open(waUrl, '_blank');
}

// Rejection codes a fresh staff QR scan fixes, and ones a new GPS reading can fix
const SCAN_AGAIN_CODES = new Set([
  'QR_EXPIRED', 'INVALID_SIGNATURE', 'SCAN_REQUIRED', 'INVALID_TICKET', 'TICKET_USED', 'TICKET_EXPIRED', 'HOST_NOT_AUTHORIZED'
]);
const RETRY_GPS_CODES = new Set(['GPS_REQUIRED', 'GPS_INACCURATE', 'GPS_STALE', 'OUTSIDE_GEOFENCE']);

/**
 * Display Rejection Notice Modal, with the action that fixes the problem when there is one
 * @param {string} errorMessage
 * @param {string} [code] rejection code from the server or the local GPS check
 */
function showRejectionNotice(errorMessage, code = null) {
  const modal = document.getElementById('rejectionModal');
  const msgEl = document.getElementById('rejectionMessageText');
  const btnClose = document.getElementById('btnRejectionClose');
  const btnScan = document.getElementById('btnRejectionScanAgain');
  const btnGps = document.getElementById('btnRejectionRetryGps');
  if (msgEl) msgEl.textContent = errorMessage;
  setNoticeStyle('error');

  const offerScan = SCAN_AGAIN_CODES.has(code);
  const offerGps = RETRY_GPS_CODES.has(code);
  btnScan?.classList.toggle('is-hidden', !offerScan);
  btnGps?.classList.toggle('is-hidden', !offerGps);

  const close = () => modal.classList.remove('active');
  if (btnClose) btnClose.onclick = close;
  if (btnScan) {
    btnScan.onclick = () => {
      close();
      openStaffQrScanner();
    };
  }
  if (btnGps) {
    btnGps.onclick = () => {
      close();
      triggerGpsCheck(true);
    };
  }

  if (modal) modal.classList.add('active');
}

// Older servers answer a repeat submission with these codes instead of the existing pass
const ALREADY_RECORDED_CODES = new Set(['DUPLICATE_ATTENDANCE', 'ALREADY_CHECKED_OUT']);

/**
 * The notice modal is shared by errors and the "already recorded" confirmation
 * @param {'error'|'success'} kind
 */
function setNoticeStyle(kind, title) {
  const card = document.querySelector('#rejectionModal .rejection-card');
  const iconEl = document.getElementById('rejectionIcon');
  const titleEl = document.getElementById('rejectionTitle');
  const btnClose = document.getElementById('btnRejectionClose');
  const isSuccess = kind === 'success';
  card?.classList.toggle('is-success', isSuccess);
  if (iconEl) iconEl.innerHTML = `<i data-lucide="${isSuccess ? 'check' : 'x'}"></i>`;
  if (titleEl) titleEl.textContent = title || 'Couldn\'t Record Your Attendance';
  if (btnClose) btnClose.textContent = isSuccess ? 'Done' : 'Review & Try Again';
}

/**
 * Friendly confirmation for someone who is already checked in (or out)
 */
function showAlreadyRecordedNotice(message, code) {
  const modal = document.getElementById('rejectionModal');
  const msgEl = document.getElementById('rejectionMessageText');
  const isCheckOut = code === 'ALREADY_CHECKED_OUT';
  setNoticeStyle('success', isCheckOut ? 'You\'re Already Checked Out' : 'You\'re Already Checked In');
  if (msgEl) msgEl.textContent = `${message || ''} Nothing more to do.`.trim();
  document.getElementById('btnRejectionScanAgain')?.classList.add('is-hidden');
  document.getElementById('btnRejectionRetryGps')?.classList.add('is-hidden');
  const btnClose = document.getElementById('btnRejectionClose');
  if (btnClose) btnClose.onclick = () => modal.classList.remove('active');
  if (modal) modal.classList.add('active');
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
