/**
 * QR Code Helper Utilities
 * Generates high-definition event QR codes, printable posters, and in-browser camera scanning.
 */

import QRCode from 'qrcode';

/**
 * Constructs the secure event check-in URL for mobile scanners
 */
export function buildEventCheckInUrl(eventId, qrToken) {
  const origin = window.location.origin;
  const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
  return `${origin}${basePath}checkin.html?event_id=${encodeURIComponent(eventId)}&token=${encodeURIComponent(qrToken)}`;
}

/**
 * Renders a QR code to a canvas element
 */
export async function renderQrToCanvas(canvasElement, url, options = {}) {
  const defaultOptions = {
    width: 320,
    margin: 2,
    color: {
      dark: '#0f172a',
      light: '#ffffff'
    },
    errorCorrectionLevel: 'H',
    ...options
  };

  try {
    await QRCode.toCanvas(canvasElement, url, defaultOptions);
  } catch (err) {
    console.error('QR Generation failed:', err);
    throw err;
  }
}

/**
 * Generates QR code as Data URL (PNG)
 */
export async function generateQrDataUrl(url, options = {}) {
  const defaultOptions = {
    width: 600,
    margin: 2,
    color: {
      dark: '#0f172a',
      light: '#ffffff'
    },
    errorCorrectionLevel: 'H',
    ...options
  };

  return await QRCode.toDataURL(url, defaultOptions);
}

/**
 * Triggers a download of the QR code image
 */
export async function downloadQrCode(url, filename = 'event-qr-code.png') {
  const dataUrl = await generateQrDataUrl(url);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Opens a print-optimized window for venue QR signage
 */
export async function printEventQrSignage(event) {
  const checkInUrl = buildEventCheckInUrl(event.id, event.qr_token);
  const qrDataUrl = await generateQrDataUrl(checkInUrl, { width: 500 });

  const printWindow = window.open('', '_blank', 'width=850,height=1000');
  if (!printWindow) {
    alert('Please allow popups to print the event QR code signage.');
    return;
  }

  const printHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Attendance QR Signage - ${event.name}</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 15mm;
        }
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
        }
        body {
          background: #fff;
          color: #0f172a;
          padding: 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 90vh;
        }
        .poster {
          border: 4px solid #0f172a;
          border-radius: 24px;
          padding: 40px 30px;
          width: 100%;
          max-width: 650px;
          text-align: center;
          background: #ffffff;
        }
        .badge {
          display: inline-block;
          background: #e0e7ff;
          color: #4338ca;
          font-weight: 700;
          font-size: 14px;
          padding: 6px 16px;
          border-radius: 9999px;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 20px;
        }
        h1 {
          font-size: 28px;
          color: #0f172a;
          margin-bottom: 12px;
          line-height: 1.25;
        }
        .meta-box {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 14px 20px;
          margin: 18px 0 24px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          text-align: left;
        }
        .meta-item strong {
          display: block;
          font-size: 11px;
          color: #64748b;
          text-transform: uppercase;
        }
        .meta-item span {
          font-size: 14px;
          color: #1e293b;
          font-weight: 600;
        }
        .qr-frame {
          background: #ffffff;
          padding: 20px;
          border: 2px dashed #cbd5e1;
          border-radius: 20px;
          display: inline-block;
          margin: 10px 0 20px;
        }
        .qr-image {
          width: 280px;
          height: 280px;
          display: block;
        }
        .instructions {
          font-size: 15px;
          color: #334155;
          line-height: 1.5;
          margin-top: 10px;
        }
        .instructions ol {
          text-align: left;
          display: inline-block;
          margin-top: 10px;
          padding-left: 20px;
        }
        .instructions li {
          margin-bottom: 6px;
        }
        .footer-note {
          margin-top: 24px;
          font-size: 11px;
          color: #94a3b8;
          border-top: 1px solid #f1f5f9;
          padding-top: 12px;
        }
      </style>
    </head>
    <body>
      <div class="poster">
        <div class="badge">Official Attendance Check-In</div>
        <h1>${event.name}</h1>
        <div class="meta-box">
          <div class="meta-item">
            <strong>Venue</strong>
            <span>${event.venue}</span>
          </div>
          <div class="meta-item">
            <strong>Date</strong>
            <span>${event.date}</span>
          </div>
          <div class="meta-item">
            <strong>Time Window</strong>
            <span>${event.start_time} - ${event.end_time}</span>
          </div>
          <div class="meta-item">
            <strong>Permitted Roles</strong>
            <span>${event.permitted_roles}</span>
          </div>
        </div>

        <div class="qr-frame">
          <img class="qr-image" src="${qrDataUrl}" alt="Event QR Code" />
        </div>

        <div class="instructions">
          <strong>How to Mark Attendance:</strong>
          <ol>
            <li>Open the camera or QR scanner on your smartphone.</li>
            <li>Scan this QR code to launch the check-in portal.</li>
            <li>Select your Role, Division, Branch & verify your code.</li>
            <li>Allow location access for venue verification.</li>
          </ol>
        </div>

        <div class="footer-note">
          Security Protected • Geofenced Verification • Code: ${event.event_code}
        </div>
      </div>
      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 300);
        };
      </script>
    </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(printHtml);
  printWindow.document.close();
}
