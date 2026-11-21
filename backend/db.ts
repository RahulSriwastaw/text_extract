/**
 * api/db.ts — Service-role Supabase client for server-side admin/usage tables.
 *
 * Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (server-only env vars).
 * If either is missing, `adminDb` is null and callers skip DB work
 * (AI routes keep working; usage for that period is lost).
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';

export const isAdminDbConfigured = !!(url && key);

let client: SupabaseClient | null = null;

if (isAdminDbConfigured) {
  try {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (err) {
    console.error('[db] Service-role Supabase client init failed:', err);
    client = null;
  }
} else {
  console.warn(
    '[db] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing. ' +
    'Usage logging and admin endpoints are disabled.'
  );
}

/** Service-role Supabase client. null when env vars are missing. */
export const adminDb = client;
