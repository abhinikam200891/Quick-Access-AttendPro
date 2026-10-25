/**
 * Host QR Beacon Mobile Portal Controller
 * Displays continuously auto-rotating dynamic QR codes with 20s HMAC tokens,
 * keeps mobile screen illuminated via Screen Wake Lock API, and provides
 * host self-attendance check-in with GPS geofence validation.
 */

import QRCode from 'qrcode';
import { dbService } from './db-service.js';
import { getCurrentPosition } from './haversine.js';
import {
  generateDynamicQrPayload,
  buildHostCheckInUrl,
  getSecondsRemainingInWindow,
  getCurrentWindowEpoch,
  requestScreenWakeLock,
  ROTATION_INTERVAL_SECONDS
} from './dynamic-qr.js';
import { soundController } from './audio-chime.js';

const CIRCUMFERENCE = 2 * Math.PI * 18; // approx 113.1

const hostState = {
  event: null,
  host: null,
  wakeLock: null,
  currentEpoch: null,
  timerInterval: null,
  scannedCount: 0,
  isHostCheckedIn: false
};

// UI Notification Toast
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

document.addEventListener('DOMContentLoaded', async () => {
  initWakeLock();
  await bootstrapBeacon();
  setupRealtimeBeaconListener();
});

/**
 * Screen Wake Lock
 */
async function initWakeLock() {
  const pill = document.getElementById('wakeLockStatus');
  const label = document.getElementById('wakeLockLabel');

  try {
    hostState.wakeLock = await requestScreenWakeLock();
    if (hostState.wakeLock && label) {
      label.textContent = 'Keep-Alive Active';
      pill.style.background = 'rgba(16, 185, 129, 0.2)';
    }

    // Re-acquire on visibility change
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && !hostState.wakeLock) {
        hostState.wakeLock = await requestScreenWakeLock();
      }
    });
  } catch (e) {
    if (label) label.textContent = 'WakeLock N/A';
  }

  if (pill) {
    pill.addEventListener('click', async () => {
      hostState.wakeLock = await requestScreenWakeLock();
      showToast(hostState.wakeLock ? 'Screen Keep-Alive enabled' : 'Could not activate Screen Lock', 'info');
    });
  }
}

/**
 * Bootstrap Beacon from URL parameters or Dropdown Selection
 */
async function bootstrapBeacon() {
  const urlParams = new URLSearchParams(window.location.search);
  const eventIdParam = urlParams.get('event');
  const hostCodeParam = urlParams.get('host');

  const events = await dbService.getEvents({ isActive: true });
  populateEventDropdown(events);

  if (eventIdParam && hostCodeParam) {
    const matchedEvent = events.find((e) => e.id === eventIdParam) || await dbService.getEventById(eventIdParam);
    if (matchedEvent) {
      const hosts = await dbService.getEventAuthorizedHosts(matchedEvent.id);
      const matchedHost = hosts.find((h) => h.member_code.toUpperCase() === hostCodeParam.toUpperCase() && h.is_active);

      if (matchedHost) {
        launchBeacon(matchedEvent, matchedHost);
        return;
      }
    }
  }

  // Otherwise, user picks manually from dropdown
  setupSelectorListeners(events);
}

function populateEventDropdown(events) {
  const select = document.getElementById('selectBeaconEvent');
  if (!select) return;

  if (events.length === 0) {
    select.innerHTML = '<option value="">No active events found</option>';
    return;
  }

  select.innerHTML = '<option value="">-- Choose Attendance Event --</option>' +
    events.map((e) => `<option value="${e.id}">${escapeHtml(e.name)} (${e.date})</option>`).join('');
}

function setupSelectorListeners(events) {
  const eventSelect = document.getElementById('selectBeaconEvent');
  const hostSelect = document.getElementById('selectBeaconHost');
  const btnLaunch = document.getElementById('btnLaunchBeacon');

  eventSelect.addEventListener('change', async () => {
    const eventId = eventSelect.value;
    if (!eventId) {
      hostSelect.innerHTML = '<option value="">Select Event First</option>';
      hostSelect.disabled = true;
      btnLaunch.disabled = true;
      return;
    }

    hostSelect.innerHTML = '<option value="">Loading authorized hosts...</option>';
    hostSelect.disabled = true;

    const hosts = await dbService.getEventAuthorizedHosts(eventId);
    if (hosts.length === 0) {
      hostSelect.innerHTML = '<option value="">No authorized staff hosts assigned to this event</option>';
      btnLaunch.disabled = true;
      return;
    }

    hostSelect.innerHTML = '<option value="">-- Select Your Staff Profile --</option>' +
      hosts.map((h) => `<option value="${h.member_code}">${escapeHtml(h.full_name)} (${h.member_code}) - ${escapeHtml(h.station_name)}</option>`).join('');
    hostSelect.disabled = false;
  });

  hostSelect.addEventListener('change', () => {
    btnLaunch.disabled = !hostSelect.value;
  });

  btnLaunch.addEventListener('click', async () => {
    const eventId = eventSelect.value;
    const hostCode = hostSelect.value;
    const matchedEvent = events.find((e) => e.id === eventId);
    const hosts = await dbService.getEventAuthorizedHosts(eventId);
    const matchedHost = hosts.find((h) => h.member_code === hostCode);

    if (matchedEvent && matchedHost) {
      launchBeacon(matchedEvent, matchedHost);
    }
  });
}

/**
 * Launches the Active Rotating QR Beacon Display
 */
async function launchBeacon(event, host) {
  hostState.event = event;
  hostState.host = host;

  // Hide selector, show beacon panels
  document.getElementById('hostSelectorCard').classList.add('is-hidden');
  document.getElementById('hostProfileCard').classList.remove('is-hidden');
  document.getElementById('hostMetricsBar').classList.remove('is-hidden');
  document.getElementById('qrStageCard').classList.remove('is-hidden');
  document.getElementById('hostSelfCard').classList.remove('is-hidden');
  document.getElementById('hostSwitchWrap').classList.remove('is-hidden');

  // Populate Banner
  document.getElementById('hostDisplayName').textContent = host.full_name;
  document.getElementById('hostCodeBadge').textContent = host.member_code;
  document.getElementById('hostEventName').textContent = event.name;
  document.getElementById('hostStationBadge').textContent = host.station_name || 'Station #1';

  // Setup Switch button
  document.getElementById('btnSwitchHost').onclick = async () => {
    clearInterval(hostState.timerInterval);
    document.getElementById('hostSelectorCard').classList.remove('is-hidden');
    document.getElementById('hostProfileCard').classList.add('is-hidden');
    document.getElementById('hostMetricsBar').classList.add('is-hidden');
    document.getElementById('qrStageCard').classList.add('is-hidden');
    document.getElementById('hostSelfCard').classList.add('is-hidden');
    document.getElementById('hostSwitchWrap').classList.add('is-hidden');
  };

  // Check Host Self Attendance Status
  await checkHostSelfAttendanceStatus();

  // Setup Host Self Check-in Button
  setupHostSelfCheckinButton();

  // Initial QR Render & Start Timer Loop
  await updateRotatingQrCode();
  startRotationTimer();
}

/**
 * Timer Loop: updates circular countdown every second and triggers rotation
 */
function startRotationTimer() {
  if (hostState.timerInterval) clearInterval(hostState.timerInterval);

  const circle = document.getElementById('timerProgressCircle');
  const secondsText = document.getElementById('timerSecondsText');
  const subText = document.getElementById('timerSubText');

  hostState.timerInterval = setInterval(async () => {
    const secondsRemaining = getSecondsRemainingInWindow();
    const currentEpoch = getCurrentWindowEpoch();

    // Update Circular Ring
    if (circle) {
      const offset = CIRCUMFERENCE * (1 - secondsRemaining / ROTATION_INTERVAL_SECONDS);
      circle.style.strokeDasharray = `${CIRCUMFERENCE}`;
      circle.style.strokeDashoffset = `${offset}`;

      if (secondsRemaining <= 4) {
        circle.setAttribute('class', 'timer-progress-circle danger');
      } else if (secondsRemaining <= 8) {
        circle.setAttribute('class', 'timer-progress-circle warning');
      } else {
        circle.setAttribute('class', 'timer-progress-circle');
      }
    }

    if (secondsText) secondsText.textContent = `${secondsRemaining}s`;
    if (subText) subText.textContent = `Refreshes in ${secondsRemaining} second${secondsRemaining === 1 ? '' : 's'}`;

    // Rotate when epoch changes
    if (currentEpoch !== hostState.currentEpoch) {
      await updateRotatingQrCode();
    }
  }, 1000);
}

/**
 * Regenerates the Dynamic QR Code with current 20s token
 */
async function updateRotatingQrCode() {
  if (!hostState.event || !hostState.host) return;

  const canvas = document.getElementById('rotatingQrCanvas');
  if (!canvas) return;

  const epoch = getCurrentWindowEpoch();
  hostState.currentEpoch = epoch;

  const payload = await generateDynamicQrPayload(
    hostState.event.id,
    hostState.host.member_code,
    hostState.host.host_secret,
    epoch
  );

  const checkinUrl = buildHostCheckInUrl(
    window.location.origin,
    payload.eventId,
    payload.hostCode,
    payload.epoch,
    payload.sig
  );

  try {
    await QRCode.toCanvas(canvas, checkinUrl, {
      width: 250,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      },
      errorCorrectionLevel: 'M'
    });
  } catch (err) {
    console.error('QR Canvas render error:', err);
  }
}

/**
 * Checks if this host has already recorded their own attendance today
 */
async function checkHostSelfAttendanceStatus() {
  const attendance = await dbService.getAttendanceRecords({ eventId: hostState.event.id });
  const hostAttendance = attendance.find((a) => a.member_code === hostState.host.member_code);

  const unmarkedDiv = document.getElementById('hostSelfUnmarked');
  const markedDiv = document.getElementById('hostSelfMarked');
  const timestampEl = document.getElementById('hostVerifiedTimestamp');

  if (hostAttendance) {
    hostState.isHostCheckedIn = true;
    unmarkedDiv.classList.add('is-hidden');
    markedDiv.classList.remove('is-hidden');
    const timeStr = new Date(hostAttendance.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const distStr = hostAttendance.distance_meters !== null ? ` • 📍 ${Math.round(hostAttendance.distance_meters)}m away` : '';
    timestampEl.textContent = `Recorded at ${timeStr} • Verified ${hostAttendance.check_in_mode === 'HOST_SELF' ? 'as Host' : 'via scan'}${distStr}`;
  } else {
    hostState.isHostCheckedIn = false;
    unmarkedDiv.classList.remove('is-hidden');
    markedDiv.classList.add('is-hidden');
  }

  // Count attendees scanned via this beacon
  const scannedByThisHost = attendance.filter((a) => a.host_member_code === hostState.host.member_code);
  const countEl = document.getElementById('beaconAttendeeCount');
  if (countEl) countEl.textContent = scannedByThisHost.length;
}

/**
 * Host Self Attendance Check-In Button
 */
function setupHostSelfCheckinButton() {
  const btn = document.getElementById('btnHostSelfCheckin');
  const spinner = document.getElementById('hostSelfSpinner');
  if (!btn) return;

  btn.onclick = async () => {
    btn.disabled = true;
    spinner.classList.remove('spinner-hidden');

    try {
      // 1. Get GPS Position
      let position = null;
      try {
        position = await getCurrentPosition(6000);
      } catch (gpsErr) {
        if (hostState.event.location_required) {
          alert('GPS location permission is required to verify you are within the strict 50m venue boundary.');
          btn.disabled = false;
          spinner.classList.add('spinner-hidden');
          return;
        }
      }

      // 2. Fetch full member record
      const members = await dbService.getMembers();
      const memberRecord = members.find((m) => m.member_code === hostState.host.member_code);
      if (!memberRecord) {
        alert('Could not find matching member profile.');
        return;
      }

      // 3. Submit as HOST_SELF
      const payload = {
        eventId: hostState.event.id,
        role: memberRecord.role || 'Staff',
        memberCode: memberRecord.member_code,
        phoneNumber: memberRecord.phone_number,
        divisionId: memberRecord.division_id,
        branchId: memberRecord.branch_id,
        latitude: position ? position.latitude : null,
        longitude: position ? position.longitude : null,
        checkInMode: 'HOST_SELF',
        userAgent: navigator.userAgent
      };

      const result = await dbService.submitAttendance(payload);

      if (result.success) {
        soundController.playDing();
        showToast('✓ Your host attendance is verified and recorded!', 'success');
        await checkHostSelfAttendanceStatus();
      } else {
        alert(`Check-in rejected: ${result.message}`);
      }
    } catch (err) {
      alert(`Error submitting host attendance: ${err.message}`);
    } finally {
      btn.disabled = false;
      spinner.classList.add('spinner-hidden');
    }
  };
}

/**
 * Real-time listener: increments the beacon counter when an attendee scans this host's code
 */
function setupRealtimeBeaconListener() {
  dbService.subscribeToAttendance((record) => {
    if (!hostState.host) return;

    if (record.host_member_code === hostState.host.member_code) {
      hostState.scannedCount++;
      const countEl = document.getElementById('beaconAttendeeCount');
      if (countEl) countEl.textContent = hostState.scannedCount;

      soundController.playDing();
      showToast(`🎉 ${record.full_name} (${record.member_code}) checked in via your beacon!`, 'success');
    }
  });
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
