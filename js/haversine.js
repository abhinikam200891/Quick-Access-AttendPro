/**
 * Haversine Formula & Geolocation Utilities
 * Calculates accurate great-circle distance between two GPS coordinates in meters.
 */

const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculates distance in meters between two coordinates (lat1, lon1) and (lat2, lon2).
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} distance in meters rounded to 1 decimal place
 */
export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  if (
    lat1 === undefined || lat1 === null ||
    lon1 === undefined || lon1 === null ||
    lat2 === undefined || lat2 === null ||
    lon2 === undefined || lon2 === null
  ) {
    return null;
  }

  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = EARTH_RADIUS_METERS * c;

  return Math.round(distance * 10) / 10;
}

/**
 * Formats distance into human-readable string (e.g., '35 m', '1.4 km').
 * @param {number} meters 
 * @returns {string}
 */
export function formatDistance(meters) {
  if (meters === null || meters === undefined) return 'N/A';
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * Request device GPS position using HTML5 Geolocation API with high accuracy
 * @param {Object} options 
 * @returns {Promise<{latitude: number, longitude: number, accuracy: number}>}
 */
export function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser or device.'));
      return;
    }

    const defaultOptions = {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
      ...options
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const validation = validateGpsFix(position);
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          speed: position.coords.speed,
          timestamp: position.timestamp,
          isMockSuspicious: validation.isSuspicious,
          validationNote: validation.warningMessage
        });
      },
      (error) => {
        let msg = 'Unable to retrieve your location.';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            msg = 'Location permission was denied. Please allow location access in your browser settings to verify event attendance.';
            break;
          case error.POSITION_UNAVAILABLE:
            msg = 'Location information is unavailable. Please ensure GPS/Location is turned on.';
            break;
          case error.TIMEOUT:
            msg = 'Location request timed out. Please check your GPS signal and retry.';
            break;
        }
        reject(new Error(msg));
      },
      defaultOptions
    );
  });
}

/**
 * Validate GPS fix for anti-spoofing and accuracy sanity
 * @param {GeolocationPosition} position 
 * @returns {{isValid: boolean, isSuspicious: boolean, warningMessage: string | null}}
 */
export function validateGpsFix(position) {
  if (!position || !position.coords) {
    return { isValid: false, isSuspicious: true, warningMessage: 'Invalid GPS coordinate payload received.' };
  }

  const { latitude, longitude, accuracy } = position.coords;

  // Coordinate range check
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || isNaN(latitude) || isNaN(longitude)) {
    return { isValid: false, isSuspicious: true, warningMessage: 'Invalid latitude or longitude numbers.' };
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { isValid: false, isSuspicious: true, warningMessage: 'GPS coordinates out of geographic bounds.' };
  }

  // Null Island check (0,0)
  if (Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001) {
    return { isValid: false, isSuspicious: true, warningMessage: 'Coordinates pointing to Null Island (0,0). Possible GPS simulation.' };
  }

  // Accuracy zero check (typical fake GPS app / desktop emulator signature)
  if (accuracy === 0) {
    return { isValid: true, isSuspicious: true, warningMessage: 'GPS reported 0m precision. Possible location mocking tool detected.' };
  }

  // Excessive inaccuracy (> 250m indicates coarse IP/tower location, not true GPS)
  if (accuracy > 250) {
    return { isValid: false, isSuspicious: false, warningMessage: `GPS accuracy too low (±${Math.round(accuracy)}m). Please switch on high-accuracy GPS.` };
  }

  // Timestamp recency check (detect replayed position recordings)
  if (position.timestamp) {
    const ageMs = Date.now() - position.timestamp;
    if (ageMs > 90000) { // older than 90 seconds
      return { isValid: true, isSuspicious: true, warningMessage: 'Cached GPS fix detected (>90s old). Acquiring fresh satellite fix...' };
    }
  }

  return { isValid: true, isSuspicious: false, warningMessage: null };
}

/**
 * Watch GPS position continuously for real-time geofence tracking
 * @param {Function} onPosition 
 * @param {Function} onError 
 * @param {Object} options 
 * @returns {number} watchId
 */
export function watchGpsPosition(onPosition, onError, options = {}) {
  if (!navigator.geolocation) {
    if (onError) onError(new Error('Geolocation not supported.'));
    return null;
  }

  const defaultOptions = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 1000,
    ...options
  };

  return navigator.geolocation.watchPosition(
    (position) => {
      const validation = validateGpsFix(position);
      onPosition({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude,
        speed: position.coords.speed,
        timestamp: position.timestamp,
        isMockSuspicious: validation.isSuspicious,
        validationNote: validation.warningMessage
      });
    },
    (err) => {
      if (onError) onError(err);
    },
    defaultOptions
  );
}

/**
 * Clear an active GPS watch
 * @param {number} watchId 
 */
export function clearGpsWatch(watchId) {
  if (watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
  }
}

