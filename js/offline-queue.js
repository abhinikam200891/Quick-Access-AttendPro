/**
 * Offline Attendance Queue & Background Sync Controller
 * Stashes attendance submissions when connectivity is lost or spotty in venues/auditoriums,
 * displays provisional verified digital passes, and automatically synchronizes records to
 * Supabase/database when connection is restored.
 */

const OFFLINE_QUEUE_KEY = 'attendpro_offline_attendance_queue';

/**
 * Get all queued offline attendance submissions
 * @returns {Array<Object>}
 */
export function getOfflineQueue() {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to read offline attendance queue:', e);
    return [];
  }
}

/**
 * Save an attendance submission to offline queue
 * @param {Object} payload The attendance submission payload
 * @param {Object} eventMetadata Extra context (eventName, venue, etc.)
 * @returns {Object} Provisional attendance pass record
 */
export function saveOfflineAttendance(payload, eventMetadata = {}) {
  const queue = getOfflineQueue();
  const queueId = 'queue_' + crypto.randomUUID();
  const ticketId = 'OFFLINE-' + crypto.randomUUID().slice(0, 8).toUpperCase();
  const checkInTime = new Date().toISOString();

  const provisionalRecord = {
    ticket_id: ticketId,
    event_id: payload.eventId,
    event_name: eventMetadata.name || payload.eventName || 'Attendance Event',
    member_code: payload.memberCode,
    full_name: eventMetadata.memberName || payload.fullName || payload.memberCode,
    role: payload.role,
    phone_number: payload.phoneNumber,
    division: eventMetadata.divisionName || 'Offline Division',
    branch: eventMetadata.branchName || 'Offline Branch',
    venue: eventMetadata.venue || 'Event Venue',
    check_in_time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    check_in_date: new Date().toLocaleDateString(),
    distance_meters: payload.distanceMeters !== undefined ? payload.distanceMeters : null,
    check_in_mode: payload.checkInMode || (payload.hostCode ? 'ATTENDEE_SCAN' : 'VENUE_STATIC_QR'),
    host_name: payload.hostName || null,
    host_member_code: payload.hostCode || null,
    host_station: payload.hostStation || null,
    verification_status: 'QUEUED_OFFLINE',
    is_offline: true,
    created_at: checkInTime
  };

  const queueItem = {
    id: queueId,
    payload: {
      ...payload,
      isOfflineSubmission: true,
      offlineTimestamp: checkInTime
    },
    provisionalRecord,
    queuedAt: checkInTime,
    retryCount: 0
  };

  queue.push(queueItem);
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('Failed to persist offline attendance:', err);
  }

  notifyQueueChange();
  return provisionalRecord;
}

/**
 * Remove an item from the offline queue after successful server sync
 * @param {string} queueId 
 */
export function removeOfflineItem(queueId) {
  let queue = getOfflineQueue();
  queue = queue.filter(item => item.id !== queueId);
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('Failed to update offline queue:', err);
  }
  notifyQueueChange();
}

/**
 * Synchronize all pending offline attendance records
 * @param {Object} dbService
 * @returns {Promise<{synced: number, failed: number, remaining: number}>}
 */
export async function syncOfflineQueue(dbService) {
  const queue = getOfflineQueue();
  if (queue.length === 0) {
    return { synced: 0, failed: 0, remaining: 0 };
  }

  if (!navigator.onLine) {
    return { synced: 0, failed: 0, remaining: queue.length };
  }

  let synced = 0;
  let failed = 0;

  for (const item of queue) {
    try {
      const result = await dbService.submitAttendance(item.payload);
      if (result.success || result.code === 'DUPLICATE_ATTENDANCE' || result.alreadyCheckedIn) {
        removeOfflineItem(item.id);
        synced++;
      } else {
        item.retryCount = (item.retryCount || 0) + 1;
        failed++;
      }
    } catch (e) {
      console.warn('Sync failed for item', item.id, e);
      failed++;
    }
  }

  return { synced, failed, remaining: getOfflineQueue().length };
}

/**
 * Dispatch custom event for UI updates
 */
function notifyQueueChange() {
  window.dispatchEvent(new CustomEvent('attendpro_offline_queue_changed', {
    detail: { count: getOfflineQueue().length }
  }));
}

/**
 * Mount the offline sync listener & UI banner
 * @param {Object} dbService 
 * @param {Function} [onSyncSuccess] Callback when one or more items are synced
 */
export function setupOfflineSyncListener(dbService, onSyncSuccess = null) {
  const renderBanner = () => {
    const queue = getOfflineQueue();
    let banner = document.getElementById('offlineSyncBanner');

    if (queue.length === 0) {
      if (banner) banner.remove();
      return;
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'offlineSyncBanner';
      banner.className = 'offline-sync-banner';
      document.body.prepend(banner);
    }

    banner.innerHTML = `
      <div class="offline-banner-content">
        <span class="offline-banner-icon">📡</span>
        <div class="offline-banner-text">
          <strong>${queue.length} Offline Record${queue.length === 1 ? '' : 's'} Pending Sync</strong>
          <span>Saved locally. Will auto-upload when internet connection is restored.</span>
        </div>
        <button type="button" class="btn btn-sm btn-offline-sync" id="btnManualSyncOffline">
          🔄 Sync Now
        </button>
      </div>
    `;

    const btnManual = banner.querySelector('#btnManualSyncOffline');
    if (btnManual) {
      btnManual.onclick = async () => {
        btnManual.disabled = true;
        btnManual.textContent = 'Syncing...';
        const res = await syncOfflineQueue(dbService);
        btnManual.disabled = false;
        btnManual.textContent = '🔄 Sync Now';
        if (res.synced > 0 && onSyncSuccess) {
          onSyncSuccess(res);
        }
        renderBanner();
      };
    }
  };

  // Initial render & event listeners
  renderBanner();
  window.addEventListener('attendpro_offline_queue_changed', renderBanner);

  // Auto-sync when network returns
  window.addEventListener('online', async () => {
    console.log('[OfflineSync] Network restored, attempting auto-sync...');
    const res = await syncOfflineQueue(dbService);
    if (res.synced > 0 && onSyncSuccess) {
      onSyncSuccess(res);
    }
    renderBanner();
  });

  // Periodic retry if queue exists and online (every 45s)
  setInterval(async () => {
    if (navigator.onLine && getOfflineQueue().length > 0) {
      const res = await syncOfflineQueue(dbService);
      if (res.synced > 0 && onSyncSuccess) {
        onSyncSuccess(res);
      }
      renderBanner();
    }
  }, 45000);
}
