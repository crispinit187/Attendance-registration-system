import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/** Refreshes the given queries whenever attendance changes (Realtime). Polling in the pages is the fallback. */
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
