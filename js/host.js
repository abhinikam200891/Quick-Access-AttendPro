/**
 * Host QR Beacon Mobile Portal Controller
 * Displays continuously auto-rotating dynamic QR codes with 20s HMAC tokens,
 * keeps mobile screen illuminated via Screen Wake Lock API, and provides
 * host self-attendance check-in with GPS geofence validation.
 *
 * Access: each host opens a private link (host.html?event=..&host=..&key=..) sent by the admin.
 * The key signs the rotating QR and proves the host's identity to the server; it is kept in
 * this phone's storage and removed from the address bar.
 */

import QRCode from 'qrcode';
import { dbService } from './db-service.js';
import { acquireBestPosition } from './haversine.js';
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
const STATS_POLL_MS = 10000;

const hostState = {
  event: null,
  host: null,
  hostKey: null,
  wakeLock: null,
  currentEpoch: null,
  timerInterval: null,
  statsInterval: null,
  scannedCount: null,
  isHostCheckedIn: false,
  storedBeacons: [] // { event, host } for every personal link this phone holds
};

// UI Notification Toast
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const text = document.createElement('span');
  text.textContent = message;
  const close = document.createElement('button');
  close.style.cssText = 'background:none;border:none;color:currentColor;cursor:pointer;font-size:16px;';
  close.innerHTML = '&times;';
  close.onclick = () => toast.remove();
  toast.append(text, close);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

document.addEventListener('DOMContentLoaded', async () => {
  initWakeLock();
  await bootstrapBeacon();
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

    // The browser releases the lock whenever the page is hidden; take it again on return
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
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
 * Beacon keys are stored per event + host on this phone
 */
const BEACON_KEY_PREFIX = 'attendpro_beacon_key:';

function beaconKeyStorageKey(eventId, hostCode) {
  return `${BEACON_KEY_PREFIX}${eventId}:${String(hostCode).trim().toUpperCase()}`;
}

function rememberBeaconKey(eventId, hostCode, key) {
  try {
    localStorage.setItem(beaconKeyStorageKey(eventId, hostCode), key);
  } catch (e) {}
}

function recallBeaconKey(eventId, hostCode) {
  try {
    return localStorage.getItem(beaconKeyStorageKey(eventId, hostCode));
  } catch (e) {
    return null;
  }
}

/**
 * Every { eventId, hostCode } this phone holds a personal link for
 */
function listStoredBeacons() {
  const stored = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(BEACON_KEY_PREFIX)) continue;
      const rest = key.slice(BEACON_KEY_PREFIX.length);
      const sep = rest.indexOf(':');
      if (sep > 0) stored.push({ eventId: rest.slice(0, sep), hostCode: rest.slice(sep + 1) });
    }
  } catch (e) {}
  return stored;
}

/**
 * Bootstrap Beacon from the private link, or from the beacons this phone has opened before
 */
async function bootstrapBeacon() {
  const urlParams = new URLSearchParams(window.location.search);
  const eventIdParam = urlParams.get('event');
  const hostCodeParam = urlParams.get('host');
  const keyParam = urlParams.get('key');

  // Keep the key out of the address bar, history and screenshots
  if (keyParam && eventIdParam && hostCodeParam) {
    rememberBeaconKey(eventIdParam, hostCodeParam, keyParam);
    urlParams.delete('key');
    const cleanQuery = urlParams.toString();
    history.replaceState(null, '', `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`);
  }

  let events = [];
  try {
    events = await dbService.getEvents({ isActive: true });
  } catch (err) {
    console.error('Failed to load events:', err);
    showToast(err.message, 'error');
  }

  // Only beacons this phone has a key for, on events that are still active
  const beacons = [];
  for (const stored of listStoredBeacons()) {
    const event = events.find((e) => e.id === stored.eventId);
    if (!event) continue;
    try {
      const hosts = await dbService.getEventAuthorizedHosts(event.id);
      const host = hosts.find((h) => h.is_active && String(h.member_code).trim().toUpperCase() === stored.hostCode);
      if (host) beacons.push({ event, host });
    } catch (err) {
      console.warn('Could not load hosts for stored beacon:', err);
    }
  }
  hostState.storedBeacons = beacons;
  renderStoredBeaconPicker(beacons);

  // Open straight away from a link, or when this phone holds exactly one beacon
  const fromLink = eventIdParam && hostCodeParam
    ? beacons.find((b) => b.event.id === eventIdParam && b.host.member_code.toUpperCase() === hostCodeParam.toUpperCase())
    : null;
  const target = fromLink || (beacons.length === 1 ? beacons[0] : null);
  if (target) {
    await launchBeacon(target.event, target.host);
  } else if (eventIdParam && hostCodeParam && keyParam) {
    showToast('This beacon link is for an event that is not active, or you are no longer an attendance taker for it.', 'error');
  }
}

function renderStoredBeaconPicker(beacons) {
  const picker = document.getElementById('storedBeaconPicker');
  const emptyMsg = document.getElementById('noStoredBeaconMsg');
  const select = document.getElementById('selectStoredBeacon');
  const btnLaunch = document.getElementById('btnLaunchBeacon');

  if (beacons.length === 0) {
    picker?.classList.add('is-hidden');
    if (emptyMsg) {
      emptyMsg.classList.remove('is-hidden');
      emptyMsg.textContent = 'Open the personal link your administrator sent you. It sets up your attendance QR on this phone.';
    }
    return;
  }

  emptyMsg?.classList.add('is-hidden');
  picker?.classList.remove('is-hidden');
  select.innerHTML = beacons
    .map((b, idx) => `<option value="${idx}">${escapeHtml(b.event.name)} (${escapeHtml(b.event.date)}) - ${escapeHtml(b.host.full_name)}, ${escapeHtml(b.host.station_name)}</option>`)
    .join('');

  btnLaunch.onclick = async () => {
    const beacon = beacons[Number(select.value)];
    if (beacon) await launchBeacon(beacon.event, beacon.host);
  };
}

function getOrCreateLocalDeviceId() {
  const STORAGE_KEY = 'attendpro_beacon_device_id';
  let deviceId = null;
  try {
    deviceId = localStorage.getItem(STORAGE_KEY);
    if (!deviceId) {
      deviceId = 'dev_' + crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, deviceId);
    }
  } catch (e) {
    deviceId = deviceId || 'dev_' + crypto.randomUUID();
  }
  return deviceId;
}

function hideBeaconPanels() {
  if (hostState.timerInterval) clearInterval(hostState.timerInterval);
  if (hostState.statsInterval) clearInterval(hostState.statsInterval);
  ['hostProfileCard', 'hostMetricsBar', 'qrStageCard', 'hostSelfCard', 'hostSwitchWrap'].forEach((id) => {
    document.getElementById(id)?.classList.add('is-hidden');
  });
}

function showDeviceLockScreen(event, host) {
  hideBeaconPanels();
  document.getElementById('hostSelectorCard')?.classList.add('is-hidden');

  const card = document.getElementById('deviceLockCard');
  if (card) {
    document.getElementById('lockedHostName').textContent = host.full_name || 'Attendance taker';
    document.getElementById('lockedHostCode').textContent = host.member_code || '-';
    document.getElementById('lockedStationName').textContent = host.station_name || 'Station #1';
    card.classList.remove('is-hidden');

    const btnRetry = document.getElementById('btnRetryDeviceLock');
    if (btnRetry) {
      btnRetry.onclick = async () => {
        btnRetry.disabled = true;
        btnRetry.textContent = 'Checking Status...';
        try {
          const recheck = await dbService.claimHostDeviceLock(event.id, host.member_code, hostState.hostKey, getOrCreateLocalDeviceId());
          if (recheck.success) {
            card.classList.add('is-hidden');
            showToast('Device lock confirmed! Welcome.', 'success');
            await launchBeacon(event, host);
            return;
          }
          showToast('Still locked to another phone. Ask your Admin to reset the device lock in Event Management.', 'warning');
        } catch (err) {
          showToast(err.message, 'error');
        }
        btnRetry.disabled = false;
        btnRetry.textContent = '🔄 Check Again';
      };
    }
  }
}

/**
 * Launches the Active Rotating QR Beacon Display
 */
async function launchBeacon(event, host) {
  const hostKey = recallBeaconKey(event.id, host.member_code);
  if (!hostKey) {
    showToast('Open the personal beacon link your administrator sent you. This phone does not have your beacon key yet.', 'error');
    return;
  }
  hostState.hostKey = hostKey;

  // Device Lock Protection: verified and stored on the server
  let lockResult;
  try {
    lockResult = await dbService.claimHostDeviceLock(event.id, host.member_code, hostKey, getOrCreateLocalDeviceId());
  } catch (err) {
    showToast(err.message, 'error');
    return;
  }

  if (!lockResult.success) {
    if (lockResult.error === 'DEVICE_LOCKED') {
      showDeviceLockScreen(event, host);
    } else {
      showToast(lockResult.message || 'This beacon link is not valid. Ask your administrator for a new link.', 'error');
    }
    return;
  }

  document.getElementById('deviceLockCard')?.classList.add('is-hidden');

  hostState.event = event;
  hostState.host = host;
  hostState.scannedCount = null;

  // Hide selector, show beacon panels
  document.getElementById('hostSelectorCard').classList.add('is-hidden');
  ['hostProfileCard', 'hostMetricsBar', 'qrStageCard', 'hostSelfCard', 'hostSwitchWrap'].forEach((id) => {
    document.getElementById(id).classList.remove('is-hidden');
  });

  // Populate Banner
  document.getElementById('hostDisplayName').textContent = host.full_name;
  document.getElementById('hostCodeBadge').textContent = host.member_code;
  document.getElementById('hostEventName').textContent = event.name;
  document.getElementById('hostStationBadge').textContent = host.station_name || 'Station #1';

  const badgeText = document.getElementById('qrSecurityBadgeText');
  if (badgeText) {
    const gpsNote = event.location_required ? ` • GPS within ${event.radius_meters || 50} m` : '';
    badgeText.textContent = `Screenshots don't work • Code changes every ${ROTATION_INTERVAL_SECONDS} seconds${gpsNote}`;
  }

  const pill = document.getElementById('hostDeviceLockPill');
  if (pill) {
    pill.textContent = '🔒 Bound to this Phone';
  }

  if (lockResult.isNewLock) {
    showToast('This phone is now securely bound to this attendance station.', 'success');
  }

  // Switching only makes sense when this phone holds more than one personal link
  document.getElementById('hostSwitchWrap').classList.toggle('is-hidden', hostState.storedBeacons.length < 2);
  document.getElementById('btnSwitchHost').onclick = () => {
    hideBeaconPanels();
    document.getElementById('hostSelectorCard').classList.remove('is-hidden');
    document.getElementById('deviceLockCard')?.classList.add('is-hidden');
  };

  updateWindowStatus();

  setupHostSelfCheckinButton();
  await refreshHostStats();
  if (hostState.statsInterval) clearInterval(hostState.statsInterval);
  hostState.statsInterval = setInterval(refreshHostStats, STATS_POLL_MS);

  await updateRotatingQrCode();
  startRotationTimer();
}

/**
 * Current date (YYYY-MM-DD) and minutes since midnight in the event's timezone,
 * the same clock the server uses to accept or reject check-ins
 */
function nowInZone(timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date());
  } catch (e) {
    // Unknown timezone name: fall back to the phone's own clock
    return nowInZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute'))
  };
}

function toMinutes(time) {
  const [h, m] = String(time || '0:0').split(':').map(Number);
  return h * 60 + m;
}

function clockLabel(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Shows whether check-in is open right now, and covers the QR when it is not,
 * so attendees are not sent to a check-in the server will reject
 */
function updateWindowStatus() {
  const event = hostState.event;
  if (!event) return;

  const now = nowInZone(event.timezone || 'Asia/Kolkata');
  const start = toMinutes(event.start_time);
  const end = toMinutes(event.end_time);

  let state;
  let value;
  let label;
  let overlayTitle = '';
  if (now.date < event.date || (now.date === event.date && now.minutes < start)) {
    state = 'waiting';
    value = 'Not open';
    label = now.date < event.date ? `Opens ${event.date} at ${clockLabel(start)}` : `Opens at ${clockLabel(start)}`;
    overlayTitle = 'Check-in not open yet';
  } else if (now.date > event.date || now.minutes > end) {
    state = 'closed';
    value = 'Closed';
    label = now.date > event.date ? `Ended on ${event.date}` : `Closed at ${clockLabel(end)}`;
    overlayTitle = 'Check-in has closed';
  } else {
    state = 'open';
    value = 'Open';
    label = `Until ${clockLabel(end)}`;
  }

  const box = document.getElementById('windowStatusBox');
  if (box) {
    box.classList.toggle('is-open', state === 'open');
    box.classList.toggle('is-waiting', state === 'waiting');
    box.classList.toggle('is-closed', state === 'closed');
  }
  const valueEl = document.getElementById('windowStatusValue');
  const labelEl = document.getElementById('windowStatusLabel');
  if (valueEl) valueEl.textContent = value;
  if (labelEl) labelEl.textContent = label;

  const overlay = document.getElementById('qrClosedOverlay');
  if (overlay) {
    overlay.classList.toggle('is-hidden', state === 'open');
    document.getElementById('qrClosedTitle').textContent = overlayTitle;
    document.getElementById('qrClosedText').textContent = label;
  }
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

    updateWindowStatus();

    if (currentEpoch !== hostState.currentEpoch) {
      await updateRotatingQrCode();
    }
  }, 1000);
}

/**
 * Regenerates the Dynamic QR Code, signed with this host's beacon key for the current 20s window
 */
async function updateRotatingQrCode() {
  if (!hostState.event || !hostState.host || !hostState.hostKey) return;

  const canvas = document.getElementById('rotatingQrCanvas');
  if (!canvas) return;

  const epoch = getCurrentWindowEpoch();
  hostState.currentEpoch = epoch;

  try {
    const payload = await generateDynamicQrPayload(
      hostState.event.id,
      hostState.host.member_code,
      hostState.hostKey,
      epoch
    );

    const checkinUrl = buildHostCheckInUrl(
      window.location.origin,
      payload.eventId,
      payload.hostCode,
      payload.epoch,
      payload.sig
    );

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
    console.error('QR render error:', err);
    if (hostState.timerInterval) clearInterval(hostState.timerInterval);
    showToast(err.message || 'Could not generate the QR code.', 'error');
  }
}

/**
 * Host's own attendance status and the count of attendees scanned through this beacon.
 * Polled because the beacon page has no admin session for realtime.
 */
async function refreshHostStats() {
  if (!hostState.event || !hostState.host) return;

  let stats;
  try {
    stats = await dbService.getHostStats(hostState.event.id, hostState.host.member_code, hostState.hostKey);
  } catch (err) {
    console.warn('Could not load beacon stats:', err);
    return;
  }
  if (!stats?.success) return;

  const unmarkedDiv = document.getElementById('hostSelfUnmarked');
  const markedDiv = document.getElementById('hostSelfMarked');
  const timestampEl = document.getElementById('hostVerifiedTimestamp');

  hostState.isHostCheckedIn = stats.self_checked_in;
  if (stats.self_checked_in) {
    unmarkedDiv.classList.add('is-hidden');
    markedDiv.classList.remove('is-hidden');
    const timeStr = new Date(stats.self_check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const distStr = stats.self_distance_meters !== null && stats.self_distance_meters !== undefined
      ? ` • 📍 ${Math.round(stats.self_distance_meters)}m away`
      : '';
    timestampEl.textContent = `Recorded at ${timeStr} • Verified ${stats.self_check_in_mode === 'HOST_SELF' ? 'as Host' : 'via scan'}${distStr}`;
  } else {
    unmarkedDiv.classList.remove('is-hidden');
    markedDiv.classList.add('is-hidden');
  }

  const count = Number(stats.scanned_count) || 0;
  if (hostState.scannedCount !== null && count > hostState.scannedCount) {
    const added = count - hostState.scannedCount;
    soundController.playDing();
    showToast(`🎉 ${added} new check-in${added === 1 ? '' : 's'} via your beacon`, 'success');
  }
  hostState.scannedCount = count;
  const countEl = document.getElementById('beaconAttendeeCount');
  if (countEl) countEl.textContent = count;
}

/**
 * Host Self Attendance Check-In Button
 */
function setupHostSelfCheckinButton() {
  const btn = document.getElementById('btnHostSelfCheckin');
  const spinner = document.getElementById('hostSelfSpinner');
  if (!btn) return;

  btn.onclick = async () => {
    if (!navigator.onLine) {
      alert('Live internet connection required to record attendance. Please reconnect to mobile data or Wi-Fi.');
      return;
    }

    const phoneInput = document.getElementById('hostSelfPhone');
    const phoneNumber = phoneInput ? phoneInput.value.trim() : '';
    if (phoneNumber.replace(/\D/g, '').length < 10) {
      alert('Please enter your registered 10-digit mobile number.');
      phoneInput?.focus();
      return;
    }

    btn.disabled = true;
    spinner.classList.remove('spinner-hidden');

    try {
      // 1. Best GPS fix over a few seconds
      let position = null;
      try {
        position = await acquireBestPosition({ durationMs: 6000 });
      } catch (gpsErr) {
        if (hostState.event.location_required) {
          alert(gpsErr.message || 'GPS location permission is required to verify you are at the venue.');
          return;
        }
      }

      // 2. Host profile (role, division, branch) comes from get_event_hosts
      const profile = hostState.host;

      // 3. Submit as HOST_SELF, proven by this host's beacon key
      const payload = {
        eventId: hostState.event.id,
        role: profile.role || 'Staff',
        memberCode: profile.member_code,
        phoneNumber: phoneNumber,
        divisionId: profile.division_id,
        branchId: profile.branch_id,
        checkInMode: 'HOST_SELF',
        hostKey: hostState.hostKey,
        latitude: position ? position.latitude : null,
        longitude: position ? position.longitude : null,
        accuracy: position ? position.accuracy : null,
        positionAgeMs: position ? Date.now() - position.timestamp : null,
        gpsSuspicious: position ? position.isMockSuspicious : false,
        userAgent: navigator.userAgent
      };

      const result = await dbService.submitAttendance(payload);

      if (result.success) {
        soundController.playDing();
        showToast('✓ Your host attendance is verified and recorded!', 'success');
        await refreshHostStats();
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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
