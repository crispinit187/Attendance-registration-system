import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key && url.startsWith('http'));
export const turnstileSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || '';

// detectSessionInUrl is off because the site uses #/ routes; email links are
// handled by the /auth/confirm page, which verifies the token itself.
export const supabaseUrl = url || 'http://localhost:54321';
export const supabaseKey = key || 'missing-key';
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
});
