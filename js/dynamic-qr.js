/**
 * Dynamic Rotating QR Cryptographic Engine & Anti-Proxy Manager
 * Generates and validates time-windowed HMAC tokens (20s rotation).
 * Includes Screen Wake-Lock helper for mobile host displays.
 */

export const ROTATION_INTERVAL_SECONDS = 20;

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
 * Compute HMAC-SHA256 signature using the Web Crypto API.
 * Must match host_qr_signature() in supabase/schema.sql: first 16 hex chars of the digest.
 * Web Crypto only exists on HTTPS (or localhost), so the beacon must be served over HTTPS.
 */
export async function generateHmacSha256(secretKey, message) {
  const cryptoObj = window.crypto;
  if (!cryptoObj || !cryptoObj.subtle) {
    throw new Error('Secure QR signing needs HTTPS. Open the beacon link over https://.');
  }

  const enc = new TextEncoder();
  const key = await cryptoObj.subtle.importKey(
    'raw',
    enc.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await cryptoObj.subtle.sign('HMAC', key, enc.encode(message));
  const hashArray = Array.from(new Uint8Array(signature));
  // 16 hex characters (64-bit compact signature for clean QR URL payload)
  return hashArray.slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates a dynamic QR payload and query params for an authorized host
 */
export async function generateDynamicQrPayload(eventId, hostCode, secretKey, epoch = getCurrentWindowEpoch()) {
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

// Windows accepted either side of now (about 60s) for scan delay and clock drift. Matches redeem_host_scan.
const SCAN_GRACE_WINDOWS = 3;

/**
 * Validates a scanned rotating QR (used by the demo engine; live mode verifies in redeem_host_scan)
 */
export async function verifyDynamicQrToken(eventId, hostCode, secretKey, submittedEpoch, submittedSig) {
  const currentEpoch = getCurrentWindowEpoch();
  const epochNum = Number(submittedEpoch);

  if (isNaN(epochNum)) {
    return {
      valid: false,
      code: 'INVALID_TOKEN_FORMAT',
      message: 'Invalid dynamic QR token parameters. Please re-scan the live QR code.'
    };
  }

  const isFresh = Math.abs(currentEpoch - epochNum) <= SCAN_GRACE_WINDOWS;
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
