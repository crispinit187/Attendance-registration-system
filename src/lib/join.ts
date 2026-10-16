// The public sign-up page uses its own Supabase client that never stores a login:
// a visitor gets a temporary anonymous session (after the human check) that lives
// only in this page's memory. It cannot touch the staff session in the same browser.
import { createClient } from '@supabase/supabase-js';
import { supabaseKey, supabaseUrl } from './supabase';
import type { JoinInfo, JoinResult } from './types';

const joinClient = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'join-anonymous' },
});

export interface JoinForm {
  title_id: string | null; title_specify: string; full_name: string; area_id: string | null;
  voice_part_id: string | null; district: string; contact: string;
}
export interface Position { lat: number; lng: number; accuracy: number }

export const joinApi = {
  info: async (code: string): Promise<JoinInfo> => {
    const { data, error } = await joinClient.rpc('signup_public_info', { p_code: code });
    if (error) throw new Error(error.message);
    return data as JoinInfo;
  },
  submit: async (code: string, f: JoinForm, captcha: string | null, pos: Position | null, force: boolean): Promise<JoinResult> => {
    const { data: s } = await joinClient.auth.getSession();
    if (!s.session) {
      const { error } = await joinClient.auth.signInAnonymously(captcha ? { options: { captchaToken: captcha } } : undefined);
      if (error) {
        if (/anonymous/i.test(error.message)) throw new Error('Sign-ups are not available right now. Please tell the organiser.');
        throw error;
      }
    }
    const { data, error } = await joinClient.rpc('signup_submit', {
      p_code: code, p_title_id: f.title_id, p_title_specify: f.title_specify || null, p_full_name: f.full_name,
      p_area_id: f.area_id, p_voice_part_id: f.voice_part_id, p_district: f.district, p_contact: f.contact || null,
      p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null, p_accuracy: pos?.accuracy ?? null, p_force: force,
    });
    if (error) throw new Error(error.message);
    return data as JoinResult;
  },
  hasSession: async () => Boolean((await joinClient.auth.getSession()).data.session),
};
