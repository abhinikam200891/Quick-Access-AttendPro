/**
 * Offline Attendance Queue - DISABLED
 * The application is configured for live online attendance only.
 */

export function getOfflineQueue() {
  return [];
}

export function saveOfflineAttendance() {
  throw new Error('Offline attendance is disabled. Live internet connection required.');
}

export function removeOfflineItem() {
  return [];
}

export async function syncOfflineQueue() {
  return { synced: 0, failed: 0, remaining: 0 };
}

export function setupOfflineSyncListener() {
  // Offline sync listener disabled - online attendance only
}
