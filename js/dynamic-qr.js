/**
 * Dynamic Rotating QR Cryptographic Engine & Anti-Proxy Manager
 * Generates and validates time-windowed HMAC tokens (20s rotation).
 * Includes Screen Wake-Lock helper for mobile host displays.
 */

export const ROTATION_INTERVAL_SECONDS = 20;
export const DEFAULT_HOST_SECRET_SALT = 'attendpro_beacon_salt_2026';

/**
 * Returns the current time window epoch (e.g. 20-second bucket)
 */
export function getCurrentWindowEpoch(nowMs = Date.now()) {
  return Math.floor(nowMs / (ROTATION_INTERVAL_SECONDS * 1000));
}

/**
 * Returns seconds remaining until the next QR code rotation
 */
export function getSecondsRemainingInWindow(nowMs = Date.now()) {
  const secondsIntoInterval = Math.floor((nowMs / 1000) % ROTATION_INTERVAL_SECONDS);
  return ROTATION_INTERVAL_SECONDS - secondsIntoInterval;
}

/**
 * Compute HMAC-SHA256 signature using the Web Crypto API
 */
export async function generateHmacSha256(secretKey, message) {
  const enc = new TextEncoder();
  const keyData = enc.encode(secretKey);
  const msgData = enc.encode(message);

  const cryptoObj = window.crypto || window.msCrypto;
  if (!cryptoObj || !cryptoObj.subtle) {
    // Fallback simple hash for environments without SubtleCrypto
    return fallbackHash(secretKey + message);
  }

  try {
    const key = await cryptoObj.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await cryptoObj.subtle.sign('HMAC', key, msgData);
    const hashArray = Array.from(new Uint8Array(signature));
    // 16 hex characters (64-bit compact signature for clean QR URL payload)
    return hashArray.slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return fallbackHash(secretKey + message);
  }
}

function fallbackHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
}

/**
 * Generates a dynamic QR payload and query params for an authorized host
 */
export async function generateDynamicQrPayload(eventId, hostCode, secretKey = DEFAULT_HOST_SECRET_SALT, epoch = getCurrentWindowEpoch()) {
  const message = `${eventId}:${hostCode}:${epoch}`;
  const sig = await generateHmacSha256(secretKey, message);

  return {
    eventId,
    hostCode,
    epoch,
    sig,
    secondsRemaining: getSecondsRemainingInWindow()
  };
}

/**
 * Builds the complete check-in URL embedded into the host's rotating QR code
 */
export function buildHostCheckInUrl(baseUrl, eventId, hostCode, epoch, sig) {
  const url = new URL('/checkin.html', baseUrl || window.location.origin);
  url.searchParams.set('event', eventId);
  url.searchParams.set('host', hostCode);
  url.searchParams.set('w', String(epoch));
  url.searchParams.set('sig', sig);
  return url.toString();
}

/**
 * Validates a dynamic token submitted by an attendee
 * Permits current epoch window AND the immediately preceding epoch window (20-40s grace period)
 */
export async function verifyDynamicQrToken(eventId, hostCode, secretKey = DEFAULT_HOST_SECRET_SALT, submittedEpoch, submittedSig) {
  const currentEpoch = getCurrentWindowEpoch();
  const epochNum = Number(submittedEpoch);

  if (isNaN(epochNum)) {
    return {
      valid: false,
      code: 'INVALID_TOKEN_FORMAT',
      message: 'Invalid dynamic QR token parameters. Please re-scan the live QR code.'
    };
  }

  // Grace period: allow current window or previous window (to accommodate scanning latency)
  const isFresh = (epochNum === currentEpoch || epochNum === (currentEpoch - 1));
  if (!isFresh) {
    const ageSeconds = (currentEpoch - epochNum) * ROTATION_INTERVAL_SECONDS;
    return {
      valid: false,
      code: 'QR_EXPIRED',
      ageSeconds,
      message: 'This dynamic QR code has expired. Screenshots and shared codes are not permitted. Please scan the live screen on the authorized staff member\'s phone.'
    };
  }

  // Verify HMAC signature
  const expectedSig = await generateHmacSha256(secretKey, `${eventId}:${hostCode}:${epochNum}`);
  if (expectedSig !== submittedSig) {
    return {
      valid: false,
      code: 'INVALID_SIGNATURE',
      message: 'QR code verification failed. Tampered or counterfeit QR code detected.'
    };
  }

  return {
    valid: true,
    epoch: epochNum
  };
}

/**
 * Screen Wake Lock API helper to keep the mobile host's screen illuminated
 */
export async function requestScreenWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      const lock = await navigator.wakeLock.request('screen');
      return lock;
    } catch (err) {
      console.warn('Wake Lock request refused:', err);
    }
  }
  return null;
}
