/**
 * In-App Camera QR Scanner Controller
 * High-performance HTML5/WebRTC barcode & QR scanner with laser reticle,
 * camera flipping (front/back), torch toggle, gallery upload, and haptic feedback.
 */

import { Html5Qrcode } from 'html5-qrcode';
import '../css/scanner.css';
import { soundController } from './audio-chime.js';

let html5QrCode = null;
let currentFacingMode = 'environment'; // 'environment' (back) | 'user' (front)
let isTorchOn = false;
let isScanning = false;

const SCANNER_DOM_ID = 'inAppQrScannerReader';

/**
 * Ensure the scanner modal exists in DOM
 */
function ensureScannerModalDom() {
  let backdrop = document.getElementById('inAppScannerModalBackdrop');
  if (backdrop) return backdrop;

  backdrop = document.createElement('div');
  backdrop.id = 'inAppScannerModalBackdrop';
  backdrop.className = 'scanner-modal-backdrop';
  backdrop.innerHTML = `
    <div class="scanner-card">
      <div class="scanner-header">
        <div class="scanner-title-wrap">
          <div class="scanner-title" id="scannerModalTitle">In-App QR Scanner</div>
          <div class="scanner-sub" id="scannerModalSub">Align QR code inside the viewfinder frame</div>
        </div>
        <button type="button" class="scanner-close-btn" id="btnCloseInAppScanner" aria-label="Close scanner">&times;</button>
      </div>

      <div class="scanner-viewport-box">
        <div id="${SCANNER_DOM_ID}" style="width: 100%; height: 100%;"></div>

        <!-- Viewfinder Reticle Overlay -->
        <div class="scanner-reticle-overlay">
          <div class="reticle-corner top-left"></div>
          <div class="reticle-corner top-right"></div>
          <div class="reticle-corner bottom-left"></div>
          <div class="reticle-corner bottom-right"></div>
          <div class="scanner-laser-line"></div>
        </div>

        <div class="scanner-success-flash" id="scannerSuccessFlash"></div>
      </div>

      <!-- Controls Bar -->
      <div class="scanner-controls-bar">
        <button type="button" class="scanner-tool-btn" id="btnScannerFlipCamera" title="Switch between front and back cameras">
          <span class="scanner-tool-icon"><i data-lucide="refresh-cw"></i></span>
          <span>Flip Camera</span>
        </button>

        <button type="button" class="scanner-tool-btn" id="btnScannerToggleTorch" title="Toggle camera flashlight/torch">
          <span class="scanner-tool-icon"><i data-lucide="flashlight"></i></span>
          <span id="torchLabel">Torch</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  return backdrop;
}

/**
 * Open In-App Camera Scanner Modal
 * @param {Object} options 
 * @param {Function} options.onScanSuccess Callback on successful decode (text, rawResult)
 * @param {Function} [options.onScanError] Callback on errors
 * @param {string} [options.title] Custom modal title
 * @param {string} [options.subtitle] Custom modal subtitle
 * @param {boolean} [options.continuous] If true, keeps scanner running for batch scanning
 */
export async function openInAppScanner({
  onScanSuccess,
  onScanError = null,
  title = 'In-App QR Scanner',
  subtitle = 'Align QR code inside the viewfinder frame',
  continuous = false
}) {
  const backdrop = ensureScannerModalDom();
  const titleEl = document.getElementById('scannerModalTitle');
  const subEl = document.getElementById('scannerModalSub');
  const closeBtn = document.getElementById('btnCloseInAppScanner');
  const flipBtn = document.getElementById('btnScannerFlipCamera');
  const torchBtn = document.getElementById('btnScannerToggleTorch');
  const flashEl = document.getElementById('scannerSuccessFlash');

  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = subtitle;

  backdrop.classList.add('active');

  // Cleanup any old instance
  if (html5QrCode) {
    try {
      if (html5QrCode.isScanning) {
        await html5QrCode.stop();
      }
    } catch (e) {
      // Ignore
    }
  }

  html5QrCode = new Html5Qrcode(SCANNER_DOM_ID);

  const qrConfig = {
    fps: 15,
    qrbox: { width: 250, height: 250 },
    aspectRatio: 1.0
  };

  const handleScanSuccess = async (decodedText, decodedResult) => {
    // Audio chime feedback
    try {
      soundController.playDing();
    } catch (e) {
      // Audio optional
    }

    // Haptic vibration feedback
    if (navigator.vibrate) {
      try {
        navigator.vibrate([40, 50, 40]);
      } catch (e) {
        // Haptic optional
      }
    }

    // Emerald visual flash
    if (flashEl) {
      flashEl.classList.add('flash');
      setTimeout(() => flashEl.classList.remove('flash'), 350);
    }

    if (!continuous) {
      await stopInAppScanner();
    }

    if (onScanSuccess) {
      onScanSuccess(decodedText, decodedResult);
    }
  };

  // Start Camera
  try {
    await html5QrCode.start(
      { facingMode: currentFacingMode },
      qrConfig,
      handleScanSuccess,
      (err) => {
        if (onScanError) onScanError(err);
      }
    );
    isScanning = true;
  } catch (camErr) {
    console.error('Camera access failed:', camErr);
    alert('Unable to access camera: ' + camErr.message + '\nPlease check camera permissions in your browser.');
  }

  // Close button
  closeBtn.onclick = () => {
    stopInAppScanner();
  };

  // Flip Camera button
  flipBtn.onclick = async () => {
    if (!html5QrCode || !html5QrCode.isScanning) return;
    try {
      await html5QrCode.stop();
      currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
      await html5QrCode.start(
        { facingMode: currentFacingMode },
        qrConfig,
        handleScanSuccess,
        onScanError
      );
    } catch (flipErr) {
      console.warn('Failed to flip camera:', flipErr);
    }
  };

  // Toggle Torch button
  torchBtn.onclick = async () => {
    if (!html5QrCode || !html5QrCode.isScanning) return;
    try {
      isTorchOn = !isTorchOn;
      await html5QrCode.applyVideoConstraints({
        advanced: [{ torch: isTorchOn }]
      });
      torchBtn.classList.toggle('active', isTorchOn);
      document.getElementById('torchLabel').textContent = isTorchOn ? 'Torch ON' : 'Torch';
    } catch (torchErr) {
      console.warn('Torch not supported on this device/camera:', torchErr);
      alert('Torch is not supported by your current camera hardware.');
    }
  };
}

/**
 * Stop camera and close scanner modal
 */
export async function stopInAppScanner() {
  const backdrop = document.getElementById('inAppScannerModalBackdrop');
  if (backdrop) {
    backdrop.classList.remove('active');
  }

  if (html5QrCode) {
    try {
      if (html5QrCode.isScanning) {
        await html5QrCode.stop();
      }
      await html5QrCode.clear();
    } catch (e) {
      console.warn('Error clearing camera stream:', e);
    }
    html5QrCode = null;
  }

  isScanning = false;
  isTorchOn = false;
}
