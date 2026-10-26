/**
 * PWA & Desktop App Installation Controller
 * Enables standalone desktop installation of Quick Access AttendPro
 * Supports Chrome, Edge, Brave, Windows Store PWA, and desktop browsers.
 */

let deferredPrompt = null;

// Register Service Worker
export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          // SW registered successfully
        })
        .catch((err) => {
          console.warn('Service Worker registration skipped:', err);
        });
    });
  }
}

// Initialize PWA Desktop Install listeners
export function initDesktopInstall() {
  registerServiceWorker();

  // Listen for native beforeinstallprompt event
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    markInstallButtonsReady();
  });

  // Listen for successful installation
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    markInstallButtonsInstalled();
  });

  // Wire all install buttons present in DOM
  wireInstallButtons();

  // Check if currently running in standalone desktop mode
  if (isStandaloneMode()) {
    markInstallButtonsInstalled();
  }
}

function isStandaloneMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://')
  );
}

function markInstallButtonsReady() {
  const buttons = document.querySelectorAll('.btn-install-app');
  buttons.forEach((btn) => {
    btn.classList.add('ready');
    if (!btn.dataset.originalText) {
      btn.dataset.originalText = btn.innerHTML;
    }
  });
}

function markInstallButtonsInstalled() {
  const buttons = document.querySelectorAll('.btn-install-app');
  buttons.forEach((btn) => {
    btn.innerHTML = '<i data-lucide="circle-check"></i> Desktop App';
    btn.disabled = true;
    btn.title = 'Quick Access AttendPro is installed as desktop application';
  });
}

function wireInstallButtons() {
  const buttons = document.querySelectorAll(
    '.btn-install-app, #btnInstallApp, #btnAdminInstallApp, #btnCheckinInstallApp, #btnHeroInstall'
  );
  buttons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      promptDesktopInstall();
    });
  });
}

/**
 * Triggers native prompt or opens guided install modal
 */
export async function promptDesktopInstall() {
  if (isStandaloneMode()) {
    showInstallModal(true);
    return;
  }

  if (deferredPrompt) {
    try {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        deferredPrompt = null;
        markInstallButtonsInstalled();
      }
      return;
    } catch (err) {
      console.warn('Native prompt failed, falling back to guided modal:', err);
    }
  }

  // Fallback guided modal for Chrome, Edge, and other desktop browsers
  showInstallModal(false);
}

/**
 * Renders the Desktop Installation Guide Modal
 */
function showInstallModal(alreadyInstalled = false) {
  let modal = document.getElementById('desktopInstallModal');
  if (!modal) {
    modal = createInstallModal();
    document.body.appendChild(modal);
  }

  const modalBody = modal.querySelector('.install-modal-content');
  if (alreadyInstalled) {
    modalBody.innerHTML = `
      <div style="text-align:center;padding:24px;">
        <img src="/assets/logo.png" alt="Quick Access AttendPro Logo" style="width:72px;height:72px;object-fit:contain;margin-bottom:12px;filter:drop-shadow(0 4px 12px rgba(79,70,229,0.35));" />
        <h3 style="font-size:1.25rem;font-weight:700;margin-bottom:8px;color:#0f172a;">Application Already Installed!</h3>
        <p style="font-size:0.9375rem;color:#475569;margin-bottom:20px;line-height:1.5;">
          Quick Access AttendPro is already installed on your system. You can launch it directly from your Desktop shortcut, Windows Start Menu, or Mac Applications.
        </p>
        <button type="button" class="btn btn-primary btn-block btn-close-install-modal">Got it, Close</button>
      </div>
    `;
  } else {
    modalBody.innerHTML = `
      <div style="text-align:center;padding:10px 0 20px;">
        <img src="/assets/logo.png" alt="Quick Access AttendPro Logo" style="width:68px;height:68px;object-fit:contain;margin-bottom:12px;filter:drop-shadow(0 4px 12px rgba(79,70,229,0.35));" />
        <h3 style="font-size:1.25rem;font-weight:700;margin-bottom:6px;color:#0f172a;">Install as Desktop Application</h3>
        <p style="font-size:0.875rem;color:#475569;margin-bottom:20px;line-height:1.5;">
          Run <strong>Quick Access AttendPro</strong> in its own dedicated, high-performance desktop window without browser tabs or address bar clutter.
        </p>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:20px;">
        <div style="font-size:0.8125rem;font-weight:700;color:#0f172a;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px;">
          Easy Installation Steps:
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;font-size:0.875rem;color:#334155;">
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <span style="background:#e0e7ff;color:#4338ca;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.75rem;flex-shrink:0;">1</span>
            <div>
              Look for the <strong>Install App icon (<i data-lucide="monitor"></i> or <i data-lucide="plus"></i>)</strong> on the right side of your browser address bar.
            </div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <span style="background:#e0e7ff;color:#4338ca;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.75rem;flex-shrink:0;">2</span>
            <div>
              Or open the browser menu (<strong>⋮</strong> or <strong>…</strong>) &rarr; select <strong>"Install Quick Access AttendPro..."</strong>
            </div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <span style="background:#e0e7ff;color:#4338ca;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.75rem;flex-shrink:0;">3</span>
            <div>
              Click <strong>"Install"</strong> to add an icon to your Desktop, Taskbar, and Start Menu.
            </div>
          </div>
        </div>
      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button type="button" class="btn btn-secondary btn-close-install-modal">Close</button>
        <button type="button" class="btn btn-primary" id="btnTriggerNativeInstall">
          <i data-lucide="zap"></i> Try One-Click Install
        </button>
      </div>
    `;
  }

  // Wire close buttons
  modal.querySelectorAll('.btn-close-install-modal, .modal-close').forEach((btn) => {
    btn.onclick = () => modal.classList.remove('active');
  });

  const btnTry = modal.querySelector('#btnTriggerNativeInstall');
  if (btnTry) {
    btnTry.onclick = async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          deferredPrompt = null;
          modal.classList.remove('active');
          markInstallButtonsInstalled();
        }
      } else {
        alert('Please click the Install icon in your browser address bar or browser menu (⋮) -> "Install Quick Access AttendPro".');
      }
    };
  }

  modal.classList.add('active');
}

function createInstallModal() {
  const backdrop = document.createElement('div');
  backdrop.id = 'desktopInstallModal';
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width: 520px;">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px;">
          <img src="/assets/logo.png" alt="Logo" style="width:28px;height:28px;object-fit:contain;" />
          <h3 class="modal-title">Desktop Application Setup</h3>
        </div>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body install-modal-content"></div>
    </div>
  `;

  // Close when clicking backdrop
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      backdrop.classList.remove('active');
    }
  });

  return backdrop;
}
