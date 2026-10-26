/**
 * Admin Authentication Controller
 * Manages Supabase Auth session, email/password login, forgot password OTP verification,
 * and seamless fallback for demo/offline test modes.
 */

import { getSupabaseClient } from './supabase-config.js';

let authCallbacks = {
  onLoginSuccess: null,
  onLogout: null
};

let currentRecoveryEmail = '';

export async function initAdminAuth({ onLoginSuccess, onLogout }) {
  authCallbacks.onLoginSuccess = onLoginSuccess;
  authCallbacks.onLogout = onLogout;

  setupAuthEventListeners();

  // Live mode: admin accounts are granted in the database, so hide self-registration
  if (getSupabaseClient()) {
    document.getElementById('btnGoToRegister')?.closest('.auth-extra-links')?.classList.add('is-hidden');
  }

  // Check if an existing active session exists
  const activeUser = await getAdminSession();
  if (activeUser) {
    showAdminDashboard(activeUser);
  } else {
    showAuthScreen();
  }
}

/**
 * Returns true if the signed-in Supabase user is listed in the admins table
 */
async function isSupabaseAdmin(supabase) {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) {
    console.warn('is_admin check failed:', error);
    return false;
  }
  return data === true;
}

export async function getAdminSession() {
  const supabase = getSupabaseClient();
  if (supabase) {
    // Live mode never honours the local demo session
    try {
      const { data, error } = await supabase.auth.getSession();
      if (!error && data?.session?.user && await isSupabaseAdmin(supabase)) {
        return data.session.user;
      }
    } catch (e) {
      console.warn('Error checking Supabase session:', e);
    }
    return null;
  }

  // Demo fallback session
  if (localStorage.getItem('qa_demo_admin_session') === 'true') {
    return {
      email: localStorage.getItem('qa_demo_admin_email') || 'admin@attendpro.com',
      role: 'admin',
      isDemo: true
    };
  }

  return null;
}

export async function signInAdmin(email, password) {
  const supabase = getSupabaseClient();
  const cleanEmail = email.trim().toLowerCase();

  if (supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: password
    });
    if (error) {
      let msg = error.message || 'Authentication failed';
      if (msg.toLowerCase().includes('email not confirmed')) {
        msg = 'Email Not Confirmed Yet. In your Supabase Dashboard, go to Authentication → Users, click the three dots (...) next to your email, and select "Auto-confirm user" (or toggle off "Confirm email" in Auth → Providers → Email).';
      }
      return { success: false, error: msg };
    }
    if (!(await isSupabaseAdmin(supabase))) {
      await supabase.auth.signOut();
      return {
        success: false,
        error: 'This account does not have admin access. Ask an existing administrator to add it to the admins table.'
      };
    }
    return { success: true, user: data.user };
  }

  // Local Demo Mode Authentication
  const savedPwd = localStorage.getItem('qa_demo_admin_pwd') || 'admin123';
  if (cleanEmail === 'admin@attendpro.com' && password === savedPwd) {
    localStorage.setItem('qa_demo_admin_session', 'true');
    localStorage.setItem('qa_demo_admin_email', cleanEmail);
    return {
      success: true,
      user: { email: cleanEmail, role: 'admin', isDemo: true }
    };
  }

  return {
    success: false,
    error: 'Invalid email or password.'
  };
}

export async function registerAdmin(email, password) {
  const supabase = getSupabaseClient();
  const cleanEmail = email.trim().toLowerCase();

  if (supabase) {
    return {
      success: false,
      error: 'Self-registration is disabled. Ask an existing administrator to create your account.'
    };
  }

  // Demo mode registration
  localStorage.setItem('qa_demo_admin_email', cleanEmail);
  localStorage.setItem('qa_demo_admin_pwd', password);
  localStorage.setItem('qa_demo_admin_session', 'true');
  return {
    success: true,
    user: { email: cleanEmail, role: 'admin', isDemo: true },
    hasSession: true
  };
}

export async function sendPasswordResetOtp(email) {
  const supabase = getSupabaseClient();
  const cleanEmail = email.trim().toLowerCase();
  currentRecoveryEmail = cleanEmail;

  if (supabase) {
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail);
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  }

  // Demo fallback
  const demoOtp = '123456';
  sessionStorage.setItem('qa_demo_reset_otp', demoOtp);
  sessionStorage.setItem('qa_demo_reset_email', cleanEmail);
  return { success: true, isDemo: true, code: demoOtp };
}

export async function verifyOtpAndResetPassword(email, otp, newPassword) {
  const supabase = getSupabaseClient();
  const cleanEmail = (email || currentRecoveryEmail).trim().toLowerCase();

  if (supabase) {
    // 1. Verify OTP token for recovery
    const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: otp.trim(),
      type: 'recovery'
    });

    if (verifyError) {
      return { success: false, error: verifyError.message || 'Invalid or expired OTP code' };
    }

    // 2. Update user password
    const { data: updateData, error: updateError } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (updateError) {
      return { success: false, error: updateError.message || 'Failed to update password' };
    }

    // A password reset proves account ownership, not admin rights
    if (!(await isSupabaseAdmin(supabase))) {
      await supabase.auth.signOut();
      return {
        success: false,
        error: 'Password updated, but this account does not have admin access. Ask an existing administrator to add it to the admins table.'
      };
    }

    return { success: true, user: updateData.user || verifyData.user };
  }

  // Demo fallback verification
  const storedOtp = sessionStorage.getItem('qa_demo_reset_otp') || '123456';
  if (otp.trim() === storedOtp) {
    localStorage.setItem('qa_demo_admin_pwd', newPassword);
    localStorage.setItem('qa_demo_admin_session', 'true');
    localStorage.setItem('qa_demo_admin_email', cleanEmail);
    sessionStorage.removeItem('qa_demo_reset_otp');
    return {
      success: true,
      user: { email: cleanEmail, role: 'admin', isDemo: true }
    };
  }

  return { success: false, error: 'Incorrect verification code. Please check your email and try again.' };
}

export async function signOutAdmin() {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Supabase signOut error:', e);
    }
  }

  localStorage.removeItem('qa_demo_admin_session');
  showAuthScreen();

  if (typeof authCallbacks.onLogout === 'function') {
    authCallbacks.onLogout();
  }
}

// -----------------------------------------------------------------------------
// UI SCREEN SWITCHERS
// -----------------------------------------------------------------------------
export function showAuthScreen() {
  const authContainer = document.getElementById('adminAuthContainer');
  const mainNavbar = document.querySelector('.admin-navbar');
  const subnav = document.querySelector('.admin-subnav');
  const mainContainer = document.querySelector('.admin-container');

  if (authContainer) authContainer.classList.remove('is-hidden');
  if (mainNavbar) mainNavbar.classList.add('is-hidden');
  if (subnav) subnav.classList.add('is-hidden');
  if (mainContainer) mainContainer.classList.add('is-hidden');

  switchAuthTab('login');
}

export function showAdminDashboard(user) {
  const authContainer = document.getElementById('adminAuthContainer');
  const mainNavbar = document.querySelector('.admin-navbar');
  const subnav = document.querySelector('.admin-subnav');
  const mainContainer = document.querySelector('.admin-container');

  if (authContainer) authContainer.classList.add('is-hidden');
  if (mainNavbar) mainNavbar.classList.remove('is-hidden');
  if (subnav) subnav.classList.remove('is-hidden');
  if (mainContainer) mainContainer.classList.remove('is-hidden');

  // Update current user indicator
  const userIndicator = document.getElementById('adminUserIndicator');
  if (userIndicator && user?.email) {
    userIndicator.textContent = user.email;
    const menuEmail = document.getElementById('adminUserIndicatorMenu');
    if (menuEmail) menuEmail.textContent = user.email;
    const initial = document.getElementById('adminAvatarInitial');
    if (initial) initial.textContent = user.email.charAt(0).toUpperCase();
  }

  if (typeof authCallbacks.onLoginSuccess === 'function') {
    authCallbacks.onLoginSuccess(user);
  }
}

function switchAuthTab(tab) {
  const formLogin = document.getElementById('adminLoginForm');
  const formForgot = document.getElementById('adminForgotForm');
  const formReset = document.getElementById('adminResetForm');
  const formRegister = document.getElementById('adminRegisterForm');

  if (formLogin) formLogin.classList.toggle('is-hidden', tab !== 'login');
  if (formForgot) formForgot.classList.toggle('is-hidden', tab !== 'forgot');
  if (formReset) formReset.classList.toggle('is-hidden', tab !== 'reset');
  if (formRegister) formRegister.classList.toggle('is-hidden', tab !== 'register');

  clearAuthAlerts();
}

function showAuthAlert(formId, message, type = 'error') {
  const form = document.getElementById(formId);
  if (!form) return;
  const alertBox = form.querySelector('.auth-alert');
  if (!alertBox) return;

  alertBox.className = `auth-alert auth-alert-${type}`;
  alertBox.textContent = message;
  alertBox.classList.remove('is-hidden');
}

function clearAuthAlerts() {
  document.querySelectorAll('.auth-alert').forEach((el) => {
    el.classList.add('is-hidden');
    el.textContent = '';
  });
}

function setupAuthEventListeners() {
  // 1. Login Form Submit
  const formLogin = document.getElementById('adminLoginForm');
  if (formLogin) {
    formLogin.onsubmit = async (e) => {
      e.preventDefault();
      clearAuthAlerts();

      const email = document.getElementById('adminLoginEmail')?.value || '';
      const password = document.getElementById('adminLoginPassword')?.value || '';
      const btn = document.getElementById('btnAdminSignIn');
      const spinner = document.getElementById('loginSpinner');

      if (!email || !password) {
        showAuthAlert('adminLoginForm', 'Please enter your Admin Email and Password.');
        return;
      }

      if (btn) btn.disabled = true;
      if (spinner) spinner.classList.remove('spinner-hidden');

      try {
        const result = await signInAdmin(email, password);
        if (result.success) {
          showAdminDashboard(result.user);
        } else {
          showAuthAlert('adminLoginForm', result.error || 'Authentication failed');
        }
      } catch (err) {
        showAuthAlert('adminLoginForm', err.message || 'An unexpected error occurred');
      } finally {
        if (btn) btn.disabled = false;
        if (spinner) spinner.classList.add('spinner-hidden');
      }
    };
  }

  // 2. Navigation buttons within Auth Card
  document.getElementById('btnGoToForgotPassword')?.addEventListener('click', () => {
    switchAuthTab('forgot');
  });

  document.getElementById('btnBackToLoginFromForgot')?.addEventListener('click', () => {
    switchAuthTab('login');
  });

  document.getElementById('btnBackToLoginFromReset')?.addEventListener('click', () => {
    switchAuthTab('login');
  });

  document.getElementById('btnGoToRegister')?.addEventListener('click', () => {
    switchAuthTab('register');
  });

  document.getElementById('btnBackToLoginFromRegister')?.addEventListener('click', () => {
    switchAuthTab('login');
  });

  // 3. Password visibility toggles
  document.querySelectorAll('.btn-toggle-pwd').forEach((btn) => {
    btn.onclick = () => {
      const wrap = btn.closest('.password-wrap');
      const input = wrap?.querySelector('input');
      if (input) {
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.innerHTML = `<i data-lucide="${isPassword ? 'eye-off' : 'eye'}"></i>`;
      }
    };
  });

  // 4. Send Forgot Password OTP
  const formForgot = document.getElementById('adminForgotForm');
  if (formForgot) {
    formForgot.onsubmit = async (e) => {
      e.preventDefault();
      clearAuthAlerts();

      const email = document.getElementById('adminForgotEmail')?.value || '';
      const btn = document.getElementById('btnSendResetOtp');
      const spinner = document.getElementById('forgotSpinner');

      if (!email) {
        showAuthAlert('adminForgotForm', 'Please enter your registered email address.');
        return;
      }

      if (btn) btn.disabled = true;
      if (spinner) spinner.classList.remove('spinner-hidden');

      try {
        const result = await sendPasswordResetOtp(email);
        if (result.success) {
          const targetLabel = document.getElementById('resetTargetEmailLabel');
          if (targetLabel) targetLabel.textContent = email;

          switchAuthTab('reset');

          if (result.isDemo) {
            showAuthAlert('adminResetForm', `[Demo Mode] OTP sent! Use code: ${result.code}`, 'success');
          } else {
            showAuthAlert('adminResetForm', `Verification code sent to ${email}. Please check your inbox.`, 'success');
          }
        } else {
          showAuthAlert('adminForgotForm', result.error || 'Failed to send OTP code');
        }
      } catch (err) {
        showAuthAlert('adminForgotForm', err.message || 'Error sending OTP');
      } finally {
        if (btn) btn.disabled = false;
        if (spinner) spinner.classList.add('spinner-hidden');
      }
    };
  }

  // 5. Submit New Password with OTP
  const formReset = document.getElementById('adminResetForm');
  if (formReset) {
    formReset.onsubmit = async (e) => {
      e.preventDefault();
      clearAuthAlerts();

      const otp = document.getElementById('adminResetOtp')?.value || '';
      const newPassword = document.getElementById('adminNewPassword')?.value || '';
      const confirmPassword = document.getElementById('adminConfirmPassword')?.value || '';
      const email = document.getElementById('adminForgotEmail')?.value || currentRecoveryEmail;
      const btn = document.getElementById('btnSubmitNewPassword');
      const spinner = document.getElementById('resetSpinner');

      if (!otp) {
        showAuthAlert('adminResetForm', 'Please enter the 6-digit OTP code.');
        return;
      }

      if (newPassword.length < 6) {
        showAuthAlert('adminResetForm', 'New password must be at least 6 characters.');
        return;
      }

      if (newPassword !== confirmPassword) {
        showAuthAlert('adminResetForm', 'Passwords do not match. Please re-type.');
        return;
      }

      if (btn) btn.disabled = true;
      if (spinner) spinner.classList.remove('spinner-hidden');

      try {
        const result = await verifyOtpAndResetPassword(email, otp, newPassword);
        if (result.success) {
          showAdminDashboard(result.user);
        } else {
          showAuthAlert('adminResetForm', result.error || 'Password reset failed');
        }
      } catch (err) {
        showAuthAlert('adminResetForm', err.message || 'Error resetting password');
      } finally {
        if (btn) btn.disabled = false;
        if (spinner) spinner.classList.add('spinner-hidden');
      }
    };
  }

  // 6. Resend OTP Button
  document.getElementById('btnResendOtp')?.addEventListener('click', async () => {
    const email = document.getElementById('adminForgotEmail')?.value || currentRecoveryEmail;
    if (email) {
      const result = await sendPasswordResetOtp(email);
      if (result.success) {
        showAuthAlert('adminResetForm', 'A new verification code was sent to your email.', 'success');
      }
    }
  });

  // 7. Register Admin (First-time setup fallback)
  const formRegister = document.getElementById('adminRegisterForm');
  if (formRegister) {
    formRegister.onsubmit = async (e) => {
      e.preventDefault();
      clearAuthAlerts();

      const email = document.getElementById('adminRegisterEmail')?.value || '';
      const password = document.getElementById('adminRegisterPassword')?.value || '';
      const confirmPwd = document.getElementById('adminRegisterConfirmPassword')?.value || '';
      const btn = document.getElementById('btnSubmitRegister');
      const spinner = document.getElementById('registerSpinner');

      if (password.length < 6) {
        showAuthAlert('adminRegisterForm', 'Password must be at least 6 characters.');
        return;
      }

      if (password !== confirmPwd) {
        showAuthAlert('adminRegisterForm', 'Passwords do not match.');
        return;
      }

      if (btn) btn.disabled = true;
      if (spinner) spinner.classList.remove('spinner-hidden');

      try {
        const result = await registerAdmin(email, password);
        if (result.success) {
          if (result.hasSession) {
            showAdminDashboard(result.user);
          } else {
            showAuthAlert('adminLoginForm', 'Admin account registered! Check your email to confirm if required, then sign in.', 'success');
            switchAuthTab('login');
          }
        } else {
          showAuthAlert('adminRegisterForm', result.error || 'Registration failed');
        }
      } catch (err) {
        showAuthAlert('adminRegisterForm', err.message || 'Error registering');
      } finally {
        if (btn) btn.disabled = false;
        if (spinner) spinner.classList.add('spinner-hidden');
      }
    };
  }

  // 8. Sign Out Button in Admin Header
  document.getElementById('btnAdminSignOut')?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to sign out of the Admin Portal?')) {
      await signOutAdmin();
    }
  });
}
