import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/** Tables whose changes should refresh the screens. Supabase sends each person only the rows their role may see. */
const TABLES = ['attendance', 'signup_entries', 'signup_lists', 'lists', 'events', 'people', 'accounts', 'audit_log'];

/**
 * One live connection for the whole signed-in app. When anything changes, the data on screen is
 * reloaded a moment later, so nobody has to refresh. If the connection drops it reconnects by itself,
 * and the timers in the pages keep things fresh in the meantime.
 */
export function useLiveSync() {
  const qc = useQueryClient();
  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void qc.invalidateQueries(); }, 400);   // bundles a burst of changes into one reload
    };
    let ch = supabase.channel('app-live-' + Math.random().toString(36).slice(2));
    for (const table of TABLES) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
    ch.subscribe();
    return () => { window.clearTimeout(timer); void supabase.removeChannel(ch); };
  }, [qc]);
}

/** Older per-page helper, kept for pages that name the exact queries to refresh. */
export function useLiveAttendance(keys: string[][]) {
  const qc = useQueryClient();
  const sig = JSON.stringify(keys);
  useEffect(() => {
    const ch = supabase.channel('attendance-live-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => {
        for (const k of JSON.parse(sig) as string[][]) void qc.invalidateQueries({ queryKey: k });
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [qc, sig]);
}
