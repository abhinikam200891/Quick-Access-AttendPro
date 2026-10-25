/**
 * User Portal Check-In Controller (Mobile Browser)
 * Handles QR parameter extraction, dynamic branch cascades, GPS verification,
 * atomic check-in submission, error notifications, and the digital attendance pass.
 */

import confetti from 'canvas-confetti';
import { dbService } from './db-service.js';
import { calculateDistanceMeters, formatDistance, getCurrentPosition } from './haversine.js';
import { initAttendeeRadarMap } from './geo-map.js';
import { openInAppScanner } from './camera-scanner.js';
import { saveOfflineAttendance, setupOfflineSyncListener } from './offline-queue.js';
import { soundController } from './audio-chime.js';

// Controller State
const checkinState = {
  event: null,
  eventId: null,
  qrToken: null,
  hostCode: null,
  windowEpoch: null,
  tokenSignature: null,
  hostInfo: null,
  divisions: [],
  branchMembers: [], // Members loaded for currently selected branch and role
  selectedRole: 'Staff',
  currentPosition: null,
  radarMap: null,
  gpsStatus: 'idle', // 'idle' | 'locating' | 'verified' | 'warning' | 'error'
  isSubmitting: false
};

export async function initCheckInPortal() {
  setupDeviceViewToggle();
  parseQueryParams();
  setupRoleToggle();
  setupMemberSelectSync();
  setupFormListeners();
  setupScannerAction();
  setupOfflineSyncListener(dbService, () => {
    console.log('[Checkin] Offline attendance successfully synchronized.');
  });

  // If no eventId in query string, auto-load the single active event
  if (!checkinState.eventId) {
    try {
      const activeEvents = await dbService.getEvents({ isActive: true });
      if (activeEvents && activeEvents.length > 0) {
        checkinState.eventId = activeEvents[0].id;
        checkinState.qrToken = activeEvents[0].qr_token;
      } else {
        showNoActiveEventState();
        return;
      }
    } catch (err) {
      console.error('Failed to auto-load active event:', err);
      showNoActiveEventState();
      return;
    }
  }

  await loadEventAndBootstrap();
}

/**
 * Handle Desktop / Mobile view preview toggle on computer
 */
function setupDeviceViewToggle() {
  const toggleBtn = document.getElementById('btnToggleDeviceView');
  const iconEl = document.getElementById('viewToggleIcon');
  const labelEl = document.getElementById('viewToggleLabel');
  if (!toggleBtn) return;

  toggleBtn.onclick = () => {
    const isMobileSim = document.body.classList.toggle('force-mobile-view');
    if (isMobileSim) {
      if (iconEl) iconEl.textContent = '🖥️';
      if (labelEl) labelEl.textContent = 'Desktop View';
      toggleBtn.title = 'Switch back to wide desktop resolution view';
    } else {
      if (iconEl) iconEl.textContent = '📱';
      if (labelEl) labelEl.textContent = 'Phone View';
      toggleBtn.title = 'Preview as phone simulator on computer';
    }
  };
}

/**
 * Extract event_id, token, and dynamic host parameters from URL query string
 */
function parseQueryParams() {
  const urlParams = new URLSearchParams(window.location.search);
  checkinState.eventId = urlParams.get('event_id') || urlParams.get('event');
  checkinState.qrToken = urlParams.get('token');
  checkinState.hostCode = urlParams.get('host') || null;
  const epochParam = urlParams.get('w');
  checkinState.windowEpoch = epochParam ? parseInt(epochParam, 10) : null;
  checkinState.tokenSignature = urlParams.get('sig') || null;
}

/**
 * Show error if no active event is present in system
 */
function showNoActiveEventState() {
  const loadingOverlay = document.getElementById('loadingState');
  const errorCard = document.getElementById('errorBannerCard');
  const errorTitle = document.getElementById('errorBannerTitle');
  const errorMsg = document.getElementById('errorBannerMessage');

  if (loadingOverlay) {
    loadingOverlay.classList.add('is-hidden');
    loadingOverlay.style.display = 'none';
  }
  if (errorCard) {
    errorCard.classList.remove('is-hidden');
    errorCard.style.display = 'block';
    if (errorTitle) errorTitle.textContent = 'No Active Event';
    if (errorMsg) errorMsg.textContent = 'There is currently no active event scheduled. Please create or activate an event in the Admin Portal.';
  }
}

/**
 * Load event details and cascading divisions
 */
async function loadEventAndBootstrap() {
  const loadingOverlay = document.getElementById('loadingState');
  const checkinFormContainer = document.getElementById('checkinFormContainer');
  const errorCard = document.getElementById('errorBannerCard');

  try {
    const event = await dbService.getEventById(checkinState.eventId, checkinState.qrToken);
    if (!event) {
      throw new Error('Event not found or has been removed. Please scan a valid event QR code.');
    }

    checkinState.event = event;
    renderEventHeader(event);

    // Check if arriving via an Authorized Staff Host Beacon
    if (checkinState.hostCode) {
      try {
        const host = await dbService.getAuthorizedHostByCode(checkinState.eventId, checkinState.hostCode);
        if (host) {
          checkinState.hostInfo = host;
          const beaconBanner = document.getElementById('scannedBeaconBanner');
          const beaconDetails = document.getElementById('scannedBeaconHostDetails');
          if (beaconBanner) {
            beaconBanner.classList.remove('is-hidden');
            if (beaconDetails) {
              const hostName = host.full_name || host.member_name || 'Staff Beacon';
              beaconDetails.innerHTML = `<strong>${escapeHtml(hostName)}</strong> (${escapeHtml(host.member_code)}) &bull; ${escapeHtml(host.station_name || 'Staff Beacon')}`;
            }
          }
        }
      } catch (hostErr) {
        console.warn('Could not load host beacon info:', hostErr);
      }
    }

    // Load divisions
    checkinState.divisions = await dbService.getDivisions();
    populateDivisions(checkinState.divisions);

    // Initial GPS location request if location is required
    if (event.location_required) {
      triggerGpsCheck(false); // Non-blocking initial check
    } else {
      updateGpsIndicator('verified', 'GPS check optional for this event');
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
 * Render Header with Event Confirmation details
 */
function renderEventHeader(event) {
  const titleEl = document.getElementById('eventHeadingName');
  const venueEl = document.getElementById('eventVenueDisplay');
  const dateEl = document.getElementById('eventDateDisplay');
  const timeEl = document.getElementById('eventTimeDisplay');
  if (titleEl) titleEl.textContent = event.name;
  if (venueEl) venueEl.textContent = event.venue;
  if (dateEl) dateEl.textContent = event.date;
  if (timeEl) timeEl.textContent = `${event.start_time.slice(0, 5)} - ${event.end_time.slice(0, 5)}`;

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
  const codeLabel = document.getElementById('codeLabel');

  if (btnStaff) {
    btnStaff.onclick = () => selectRole('Staff');
  }
  if (btnAgent) {
    btnAgent.onclick = () => selectRole('Agent');
  }

  function selectRole(role) {
    checkinState.selectedRole = role;
    if (role === 'Staff') {
      btnStaff?.classList.add('active');
      btnAgent?.classList.remove('active');
      if (codeLabel) codeLabel.innerHTML = 'Select Employee Code <span class="required">*</span>';
    } else {
      btnAgent?.classList.add('active');
      btnStaff?.classList.remove('active');
      if (codeLabel) codeLabel.innerHTML = 'Select Agent Code <span class="required">*</span>';
    }

    // Refresh member dropdowns if branch is selected
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
 * Load Active Members as per Selected Branch and Role
 */
async function loadBranchMembers(branchId) {
  const nameSelect = document.getElementById('selectMemberName');
  const codeSelect = document.getElementById('selectMemberCode');
  const phoneInput = document.getElementById('inputPhoneNumber');
  const searchWrapper = document.getElementById('memberSearchWrapper');
  const searchInput = document.getElementById('inputMemberSearch');
  const matchCount = document.getElementById('memberSearchMatchCount');

  if (!nameSelect || !codeSelect) return;

  if (!branchId) {
    checkinState.branchMembers = [];
    nameSelect.innerHTML = '<option value="">-- Select Branch First --</option>';
    nameSelect.disabled = true;
    codeSelect.innerHTML = '<option value="">-- Select Branch First --</option>';
    codeSelect.disabled = true;
    if (phoneInput) phoneInput.value = '';
    if (searchWrapper) searchWrapper.classList.add('is-hidden');
    return;
  }

  nameSelect.disabled = true;
  codeSelect.disabled = true;
  nameSelect.innerHTML = '<option value="">Loading names...</option>';
  codeSelect.innerHTML = '<option value="">Loading codes...</option>';

  try {
    const role = checkinState.selectedRole;
    const members = await dbService.getMembers({
      branchId,
      role,
      isActive: true
    });

    checkinState.branchMembers = members || [];
    if (phoneInput) phoneInput.value = '';

    if (!members || members.length === 0) {
      const roleLabel = role === 'Staff' ? 'staff members' : 'agents';
      nameSelect.innerHTML = `<option value="">No active ${roleLabel} in this branch</option>`;
      codeSelect.innerHTML = `<option value="">No codes available</option>`;
      nameSelect.disabled = true;
      codeSelect.disabled = true;
      if (searchWrapper) searchWrapper.classList.add('is-hidden');
      return;
    }

    // Show search filter input
    if (searchWrapper) searchWrapper.classList.remove('is-hidden');
    if (searchInput) searchInput.value = '';
    if (matchCount) matchCount.textContent = `${members.length} Members`;

    // Sort names alphabetically
    const nameSorted = [...members].sort((a, b) => a.full_name.localeCompare(b.full_name));
    nameSelect.innerHTML = '<option value="">-- Select Your Name --</option>' +
      nameSorted.map((m) => `<option value="${m.id}">${escapeHtml(m.full_name)} (${escapeHtml(m.member_code)})</option>`).join('');

    // Sort codes alphabetically
    const codeSorted = [...members].sort((a, b) => a.member_code.localeCompare(b.member_code));
    const roleCodeTitle = role === 'Staff' ? 'Employee Code' : 'Agent Code';
    codeSelect.innerHTML = `<option value="">-- Select ${roleCodeTitle} --</option>` +
      codeSorted.map((m) => `<option value="${m.id}">${escapeHtml(m.member_code)} - ${escapeHtml(m.full_name)}</option>`).join('');

    nameSelect.disabled = false;
    codeSelect.disabled = false;
  } catch (err) {
    console.error('Failed to load branch members:', err);
    nameSelect.innerHTML = '<option value="">Failed to load members</option>';
    codeSelect.innerHTML = '<option value="">Failed to load codes</option>';
  }
}

/**
 * Setup Two-Way Synchronization Between Name and Code Dropdowns & Auto-fill Phone Number
 */
function setupMemberSelectSync() {
  const nameSelect = document.getElementById('selectMemberName');
  const codeSelect = document.getElementById('selectMemberCode');
  const phoneInput = document.getElementById('inputPhoneNumber');
  const searchInput = document.getElementById('inputMemberSearch');
  const matchCount = document.getElementById('memberSearchMatchCount');

  if (!nameSelect || !codeSelect) return;

  function syncSelection(memberId) {
    if (!memberId) {
      nameSelect.value = '';
      codeSelect.value = '';
      if (phoneInput) phoneInput.value = '';
      return;
    }

    const member = checkinState.branchMembers.find((m) => m.id === memberId);
    if (member) {
      nameSelect.value = member.id;
      codeSelect.value = member.id;
      if (phoneInput) {
        phoneInput.value = member.phone_number || '';
      }
    }
  }

  nameSelect.addEventListener('change', () => {
    syncSelection(nameSelect.value);
  });

  codeSelect.addEventListener('change', () => {
    syncSelection(codeSelect.value);
  });

  // Fast live autocomplete filter for large rosters
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.trim().toLowerCase();
      const allMembers = checkinState.branchMembers || [];
      const filtered = query
        ? allMembers.filter((m) =>
            m.full_name.toLowerCase().includes(query) ||
            m.member_code.toLowerCase().includes(query)
          )
        : allMembers;

      if (matchCount) {
        matchCount.textContent = query
          ? `${filtered.length} of ${allMembers.length} matches`
          : `${allMembers.length} Members`;
      }

      // Re-populate Name and Code dropdowns
      const nameSorted = [...filtered].sort((a, b) => a.full_name.localeCompare(b.full_name));
      nameSelect.innerHTML = '<option value="">-- Select Your Name --</option>' +
        nameSorted.map((m) => `<option value="${m.id}">${escapeHtml(m.full_name)} (${escapeHtml(m.member_code)})</option>`).join('');

      const codeSorted = [...filtered].sort((a, b) => a.member_code.localeCompare(b.member_code));
      const roleCodeTitle = checkinState.selectedRole === 'Staff' ? 'Employee Code' : 'Agent Code';
      codeSelect.innerHTML = `<option value="">-- Select ${roleCodeTitle} --</option>` +
        codeSorted.map((m) => `<option value="${m.id}">${escapeHtml(m.member_code)} - ${escapeHtml(m.full_name)}</option>`).join('');

      // Auto-select if exactly 1 match is found
      if (filtered.length === 1 && query.length >= 2) {
        syncSelection(filtered[0].id);
      }
    });
  }
}

/**
 * Geolocation Check Logic
 */
async function triggerGpsCheck(isManualClick = true) {
  const event = checkinState.event;
  if (!event || !event.location_required) return true;

  updateGpsIndicator('locating', 'Acquiring high-accuracy GPS coordinates...');

  try {
    const position = await getCurrentPosition();
    checkinState.currentPosition = position;

    if (event.latitude && event.longitude) {
      const distance = calculateDistanceMeters(
        position.latitude,
        position.longitude,
        event.latitude,
        event.longitude
      );

      const isInside = distance <= event.radius_meters;

      // Update / render Leaflet Geofence Radar Mini-Map
      const mapWrapper = document.getElementById('checkinRadarMapWrapper');
      const radarPill = document.getElementById('radarStatusPill');

      if (mapWrapper) mapWrapper.classList.remove('is-hidden');
      if (radarPill) {
        radarPill.className = `map-status-pill ${isInside ? 'inside' : 'outside'}`;
        radarPill.textContent = isInside
          ? `Inside Geofence (${Math.round(distance)}m)`
          : `Outside Geofence (${Math.round(distance)}m > ${event.radius_meters}m)`;
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

      if (isInside) {
        const spoofNote = position.isMockSuspicious ? ` • ⚠️ ${position.validationNote}` : '';
        updateGpsIndicator(
          'verified',
          `GPS Verified: At venue (${formatDistance(distance)} from center, radius ${event.radius_meters}m)${spoofNote}`
        );
        return true;
      } else {
        updateGpsIndicator(
          'warning',
          `Outside venue radius (${formatDistance(distance)} away, max allowed is ${event.radius_meters}m)`
        );
        return false;
      }
    } else {
      updateGpsIndicator('verified', 'GPS acquired (Coordinates locked)');
      return true;
    }
  } catch (err) {
    updateGpsIndicator('error', err.message);
    if (isManualClick) {
      alert(err.message);
    }
    return false;
  }
}

/**
 * Setup In-App Scanner Buttons
 */
function setupScannerAction() {
  const btnScan = document.getElementById('btnCheckinCameraScan');
  const btnErrorScan = document.getElementById('btnErrorScanQr');

  const openScanner = () => {
    openInAppScanner({
      title: 'Scan Event QR or Staff Beacon',
      subtitle: 'Align the physical QR code or staff phone screen in the viewfinder',
      onScanSuccess: (decodedText) => {
        try {
          if (decodedText.startsWith('http://') || decodedText.startsWith('https://') || decodedText.includes('/checkin.html')) {
            window.location.href = decodedText;
          } else if (decodedText.includes('token=') || decodedText.includes('event=')) {
            window.location.href = `/checkin.html?${decodedText.replace(/^\?/, '')}`;
          } else {
            window.location.href = `/checkin.html?token=${encodeURIComponent(decodedText)}`;
          }
        } catch (e) {
          window.location.reload();
        }
      }
    });
  };

  if (btnScan) btnScan.onclick = openScanner;
  if (btnErrorScan) btnErrorScan.onclick = openScanner;
}

function updateGpsIndicator(status, message) {
  const dot = document.getElementById('gpsRadarDot');
  const title = document.getElementById('gpsStatusTitle');
  const sub = document.getElementById('gpsStatusSub');

  if (!dot || !title || !sub) return;

  dot.className = `radar-dot ${status} ${status === 'locating' ? 'pulsing' : ''}`;

  if (status === 'locating') {
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

      const nameSelect = document.getElementById('selectMemberName');
      const codeSelect = document.getElementById('selectMemberCode');
      const phoneInput = document.getElementById('inputPhoneNumber');
      const divSelect = document.getElementById('selectDivision');
      const branchSelect = document.getElementById('selectBranch');
      const submitBtn = document.getElementById('btnSubmitCheckin');
      const submitBtnText = document.getElementById('submitBtnText');
      const submitBtnSpinner = document.getElementById('submitBtnSpinner');

      const divisionId = divSelect ? divSelect.value : '';
      const branchId = branchSelect ? branchSelect.value : '';
      const memberId = nameSelect?.value || codeSelect?.value || '';
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
        alert('Please select your Name or Code from the list.');
        nameSelect?.focus();
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

      // If location is required, ensure coordinates exist
      if (checkinState.event.location_required && !checkinState.currentPosition) {
        const gpsSuccess = await triggerGpsCheck(true);
        if (!gpsSuccess) {
          const proceed = confirm(
            'We could not verify that you are within the venue radius. Would you like to proceed with submission for server verification?'
          );
          if (!proceed) return;
        }
      }

      // Start submission
      checkinState.isSubmitting = true;
      submitBtn.disabled = true;
      submitBtnText.textContent = 'Verifying Attendance...';
      submitBtnSpinner.style.display = 'inline-block';

      const isHostScan = Boolean(checkinState.hostCode);
      const payload = {
        eventId: checkinState.eventId,
        qrToken: checkinState.qrToken,
        checkInMode: isHostScan ? 'ATTENDEE_SCAN' : 'VENUE_STATIC_QR',
        hostCode: checkinState.hostCode,
        windowEpoch: checkinState.windowEpoch,
        tokenSignature: checkinState.tokenSignature,
        role: checkinState.selectedRole,
        memberCode: selectedMember.member_code,
        phoneNumber: phoneNumber,
        divisionId: divisionId,
        branchId: branchId,
        latitude: checkinState.currentPosition ? checkinState.currentPosition.latitude : null,
        longitude: checkinState.currentPosition ? checkinState.currentPosition.longitude : null,
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

      // Check if user is offline
      if (!navigator.onLine) {
        console.warn('[Checkin] Device is offline. Stashing to local offline queue...');
        const provisional = saveOfflineAttendance(payload, eventContext);
        showAttendancePass(provisional);
        checkinState.isSubmitting = false;
        submitBtn.disabled = false;
        submitBtnText.textContent = 'Confirm & Mark Attendance';
        submitBtnSpinner.style.display = 'none';
        return;
      }

      try {
        const result = await dbService.submitAttendance(payload);

        if (result.success) {
          showAttendancePass(result.data);
        } else {
          showRejectionNotice(result.message || 'Validation failed. Please verify your details and retry.');
        }
      } catch (err) {
        console.warn('Network submission failed, saving to offline queue:', err);
        // Fallback to offline queue
        const provisional = saveOfflineAttendance(payload, eventContext);
        showAttendancePass(provisional);
      } finally {
        checkinState.isSubmitting = false;
        submitBtn.disabled = false;
        submitBtnText.textContent = 'Confirm & Mark Attendance';
        submitBtnSpinner.style.display = 'none';
      }
    };
  }
}

/**
 * Display Celebratory Success Ticket / Digital Pass
 */
function showAttendancePass(data) {
  const formCard = document.getElementById('checkinFormContainer');
  const passContainer = document.getElementById('passTicketContainer');

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
  document.getElementById('passTimestamp').textContent = data.check_in_time;
  document.getElementById('passTicketRef').textContent = `PASS-${data.ticket_id.slice(0, 8).toUpperCase()}`;

  const distEl = document.getElementById('passGpsDistance');
  if (distEl) {
    distEl.textContent = data.distance_meters !== null && data.distance_meters !== undefined
      ? `${Math.round(data.distance_meters)}m from venue`
      : 'Verified';
  }

  // Toggle offline sync badge
  const offlineBadge = document.getElementById('passOfflineBadge');
  if (offlineBadge) {
    if (data.is_offline) {
      offlineBadge.classList.remove('is-hidden');
    } else {
      offlineBadge.classList.add('is-hidden');
    }
  }

  const passHostField = document.getElementById('passHostField');
  const passVerifiedBy = document.getElementById('passVerifiedBy');
  if (passHostField && passVerifiedBy) {
    if (data.check_in_mode === 'HOST_SELF') {
      passHostField.style.display = 'block';
      passVerifiedBy.innerHTML = '⭐ <strong>Host Self-Verification</strong> (Authorized Staff Beacon)';
    } else if (data.host_name || data.host_member_code) {
      passHostField.style.display = 'block';
      passVerifiedBy.innerHTML = `📲 <strong>${escapeHtml(data.host_name || 'Staff Host')}</strong> (${escapeHtml(data.host_member_code || '')}) &bull; ${escapeHtml(data.host_station || 'Station')}`;
    } else {
      passHostField.style.display = 'block';
      passVerifiedBy.textContent = 'Official Venue Static QR';
    }
  }

  // Sound chime & haptic feedback
  try {
    soundController.playDing();
  } catch (e) {}
  if (navigator.vibrate) {
    try { navigator.vibrate([60, 40, 60]); } catch (e) {}
  }

  // Trigger celebration confetti
  try {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 }
    });
  } catch (e) {
    // Confetti is purely decorative
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

  // Print pass ticket button
  const btnPrint = document.getElementById('btnPrintPassTicket');
  if (btnPrint) {
    btnPrint.onclick = () => {
      window.print();
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
  ctx.fillText('Secured by Dynamic Geofence & Cryptographic Attendance Pass', 320, 815);

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

/**
 * Display Rejection Notice Modal / Banner
 */
function showRejectionNotice(errorMessage) {
  const modal = document.getElementById('rejectionModal');
  const msgEl = document.getElementById('rejectionMessageText');
  if (msgEl) msgEl.textContent = errorMessage;
  if (modal) modal.classList.add('active');

  const btnClose = document.getElementById('btnRejectionClose');
  if (btnClose) {
    btnClose.onclick = () => {
      modal.classList.remove('active');
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
