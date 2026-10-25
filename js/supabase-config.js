/**
 * Supabase Client Configuration & State Manager
 * Handles Supabase initialization, local credential persistence, and connection testing.
 */

import { createClient } from '@supabase/supabase-js';

const STORAGE_KEY_URL = 'qr_attendance_supabase_url';
const STORAGE_KEY_KEY = 'qr_attendance_supabase_anon_key';
const STORAGE_KEY_MODE = 'qr_attendance_run_mode'; // 'supabase' | 'demo'

// Pre-configured environment variables or stored settings
let supabaseClient = null;

export function getSupabaseConfig() {
  const envUrl = import.meta.env?.VITE_SUPABASE_URL || '';
  const envKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';

  const storedUrl = localStorage.getItem(STORAGE_KEY_URL) || envUrl;
  const storedKey = localStorage.getItem(STORAGE_KEY_KEY) || envKey;
  const mode = localStorage.getItem(STORAGE_KEY_MODE) || (storedUrl && storedKey ? 'supabase' : 'demo');

  return {
    url: storedUrl.trim(),
    anonKey: storedKey.trim(),
    mode: mode,
    isConfigured: Boolean(storedUrl.trim() && storedKey.trim() && storedUrl.includes('supabase.co'))
  };
}

export function saveSupabaseConfig(url, anonKey, mode = 'supabase') {
  localStorage.setItem(STORAGE_KEY_URL, url.trim());
  localStorage.setItem(STORAGE_KEY_KEY, anonKey.trim());
  localStorage.setItem(STORAGE_KEY_MODE, mode);
  supabaseClient = null; // reset client instance
}

export function setRunMode(mode) {
  localStorage.setItem(STORAGE_KEY_MODE, mode);
}

export function getSupabaseClient() {
  const config = getSupabaseConfig();
  if (config.mode !== 'supabase' || !config.isConfigured) {
    return null;
  }

  if (!supabaseClient) {
    try {
      supabaseClient = createClient(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true
        }
      });
    } catch (e) {
      console.error('Failed to initialize Supabase client:', e);
      return null;
    }
  }

  return supabaseClient;
}

/**
 * Test connectivity with configured Supabase endpoint
 */
export async function testSupabaseConnection(url, key) {
  try {
    const testClient = createClient(url.trim(), key.trim());
    // Attempt a light read on divisions
    const { data, error } = await testClient.from('divisions').select('id').limit(1);
    if (error) {
      // If table doesn't exist yet, but credentials work, still report specific status
      if (error.code === '42P01') {
        return {
          success: true,
          connected: true,
          tablesMissing: true,
          message: 'Connected to Supabase! Schema tables not detected yet. Please run supabase/schema.sql in the Supabase SQL Editor.'
        };
      }
      return {
        success: false,
        message: error.message || 'Failed to authenticate with Supabase.'
      };
    }
    return {
      success: true,
      connected: true,
      tablesMissing: false,
      message: 'Successfully connected to Supabase database!'
    };
  } catch (err) {
    return {
      success: false,
      message: err.message || 'Network error while contacting Supabase.'
    };
  }
}
