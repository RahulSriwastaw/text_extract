import { createClient, SupabaseClient } from '@supabase/supabase-js';

const env = (import.meta as any).env || {};

const supabaseUrl: string =
  env.VITE_SUPABASE_URL ||
  env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://xrvmrkjkukgyegztypwn.supabase.co';

const supabaseAnonKey: string =
  env.VITE_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env.SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_aMtkqhQW01OL2dY00lxGkg_inNMn_EI';

export const isSupabaseConfigured: boolean = !!(supabaseUrl && supabaseAnonKey);

let supabaseClient: SupabaseClient | null = null;

if (isSupabaseConfigured) {
  try {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } catch (err) {
    console.error('[supabase] Initialization failed:', err);
    supabaseClient = null;
  }
} else if (typeof window !== 'undefined') {
  console.warn('[supabase] VITE_SUPABASE_* env vars are missing. Login & cloud history will run in guest/local mode.');
}

export const supabase = supabaseClient;
