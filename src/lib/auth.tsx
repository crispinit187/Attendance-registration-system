import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { api } from './api';
import type { Account, Person } from './types';

interface AuthState {
  loading: boolean;
  session: Session | null;
  account: Account | null;
  person: Person | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (s: Session | null) => {
    if (!s) { setAccount(null); setPerson(null); return; }
    const acc = await api.myAccount(s.user.id);
    setAccount(acc);
    setPerson(acc?.person_id ? await api.myPerson(acc.person_id) : null);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await load(data.session);
      if (alive) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Don't call Supabase from inside this callback; defer.
      if (event === 'SIGNED_OUT') { setAccount(null); setPerson(null); return; }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') setTimeout(() => { void load(s); }, 0);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [load]);

  const value = useMemo<AuthState>(() => ({
    loading, session, account, person,
    refresh: async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      await load(data.session);
    },
    signOut: async () => { await supabase.auth.signOut(); setAccount(null); setPerson(null); },
  }), [loading, session, account, person, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider missing');
  return v;
}

/** Does the member still need to complete their profile? */
export function needsDetails(account: Account | null, person: Person | null) {
  return !!account && account.role === 'member' && !person;
}

export function homeFor(role: string | undefined): string {
  switch (role) {
    case 'admin': return '/admin';
    case 'manager': return '/manage/lists';
    case 'list_manager': return '/trackers';
    case 'reviewer': return '/review';
    case 'registrar': return '/registrar';
    default: return '/app';
  }
}

export function useLookups() {
  const areas = useQuery({ queryKey: ['areas'], queryFn: api.areas, staleTime: 60_000 });
  const titles = useQuery({ queryKey: ['titles'], queryFn: api.titles, staleTime: 60_000 });
  const voices = useQuery({ queryKey: ['voices'], queryFn: api.voiceParts, staleTime: 60_000 });
  return {
    areas: areas.data ?? [], titles: titles.data ?? [], voices: voices.data ?? [],
    ready: !!(areas.data && titles.data && voices.data),
  };
}

/** Where the shared admin pages live for this person: admins use /admin, event managers /manage. */
export function useBase() {
  const r = useAuth().account?.role;
  return r === 'manager' ? '/manage' : '/admin';
}
