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
 * Geofence rules shared by the check-in page and the demo engine.
 * They mirror submit_attendance in supabase/schema.sql, which makes the final decision.
 */
export const GEOFENCE_RULES = {
  maxAccuracyMeters: 150, // fixes worse than this are rejected
  maxToleranceMeters: 50, // at most this much of the reported accuracy is credited
  maxFixAgeMs: 120000 // fixes older than 2 minutes are rejected
};

/**
 * Accuracy-aware geofence decision.
 * @param {{latitude:number, longitude:number, radius_meters:number, location_required:boolean}} event
 * @param {{latitude?:number, longitude?:number, accuracy?:number, positionAgeMs?:number, gpsSuspicious?:boolean}} fix
 * @returns {{ok:boolean, code?:string, message?:string, distance:number|null, flags:string[]}}
 */
export function evaluateGeofence(event, fix = {}) {
  const flags = [];
  const hasFix = fix.latitude !== undefined && fix.latitude !== null && fix.longitude !== undefined && fix.longitude !== null;
  const hasVenue = event.latitude !== undefined && event.latitude !== null && event.latitude !== ''
    && event.longitude !== undefined && event.longitude !== null && event.longitude !== '';
  const distance = hasFix && hasVenue
    ? calculateDistanceMeters(fix.latitude, fix.longitude, Number(event.latitude), Number(event.longitude))
    : null;
  const radius = Number(event.radius_meters) || 50;
  const fail = (code, message) => ({ ok: false, code, message, distance, flags });

  if (event.location_required) {
    if (!hasVenue) {
      return fail('VENUE_NOT_CONFIGURED', 'The venue location for this event has not been set. Please inform the event administrator.');
    }
    if (!hasFix) {
      return fail('GPS_REQUIRED', 'Venue GPS location verification is required. Please enable location services.');
    }
    if (fix.accuracy === undefined || fix.accuracy === null || fix.accuracy > GEOFENCE_RULES.maxAccuracyMeters) {
      const acc = fix.accuracy === undefined || fix.accuracy === null ? 'unknown' : Math.round(fix.accuracy);
      return fail('GPS_INACCURATE', `Your location is only accurate to about ${acc} m. Turn on precise location, move near a window or outdoors, and try again.`);
    }
    if (fix.positionAgeMs !== undefined && fix.positionAgeMs !== null && fix.positionAgeMs > GEOFENCE_RULES.maxFixAgeMs) {
      return fail('GPS_STALE', 'Your location reading is out of date. Tap "Retry GPS" and submit again.');
    }

    // Credit the phone's reported accuracy so genuine attendees indoors are not rejected
    const tolerance = Math.min(Math.max(fix.accuracy, 0), GEOFENCE_RULES.maxToleranceMeters);
    if (distance - tolerance > radius) {
      return fail('OUTSIDE_GEOFENCE', `You are about ${Math.round(distance)} m from the venue. Check-in is allowed within ${radius} m.`);
    }
    if (distance > radius) {
      flags.push(`Inside radius only within GPS accuracy (${Math.round(distance)} m away, accuracy ${Math.round(fix.accuracy)} m)`);
    }
  }

  if (fix.gpsSuspicious) {
    flags.push('Phone GPS looked simulated or cached');
  }

  return { ok: true, distance, flags };
}

/**
 * Watches GPS for a few seconds and resolves with the most accurate fix.
 * Phones often report a coarse Wi-Fi fix first and a precise satellite fix shortly after.
 * @param {{durationMs?:number, targetAccuracy?:number}} options
 */
export function acquireBestPosition({ durationMs = 8000, targetAccuracy = 20 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser or device.'));
      return;
    }

    let best = null;
    let finished = false;
    let watchId = null;
    let timer = null;

    const finish = (err) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (best) resolve(best);
      else reject(err || new Error('Location request timed out. Please check your GPS signal and retry.'));
    };

    watchId = watchGpsPosition(
      (pos) => {
        if (!best || pos.accuracy < best.accuracy) best = pos;
        if (pos.accuracy <= targetAccuracy) finish();
      },
      (error) => {
        // Keep waiting for a fix unless permission is denied
        if (error && error.code === error.PERMISSION_DENIED) {
          finish(new Error('Location permission was denied. Please allow location access in your browser settings to verify event attendance.'));
        }
      },
      { maximumAge: 0, timeout: durationMs }
    );

    timer = setTimeout(() => finish(), durationMs);
  });
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

