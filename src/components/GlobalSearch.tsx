import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Icon } from './ui';

interface Hit { key: string; group: string; label: string; sub?: string; to: string }
interface Page { to: string; label: string }

const subs = new Set<() => void>();
let isOpen = false;
const setOpenState = (v: boolean) => { isOpen = v; subs.forEach((f) => f()); };
const useOpen = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => isOpen);

/** The button that opens the search. Any number of these can be on screen. */
export function SearchButton() {
  return <button className="iconbtn" onClick={() => setOpenState(true)} aria-label="Search everything (Ctrl+K)" title="Search (Ctrl+K)"><Icon name="search" /></button>;
}

/** Mounted once in the app shell: listens for Ctrl+K (or Cmd+K) and shows the search over pages, events, lists, trackers and, for admins, people. */
export function SearchHost({ pages }: { pages: Page[] }) {
  const open = useOpen();
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpenState(!isOpen); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return open ? <Palette pages={pages} onClose={() => setOpenState(false)} /> : null;
}

function Palette({ pages, onClose }: { pages: Page[]; onClose: () => void }) {
  const { account } = useAuth();
  const role = account?.role ?? 'member';
  const nav = useNavigate();
  const isAdmin = role === 'admin';
  const isStaff = isAdmin || role === 'manager' || role === 'list_manager';
  const base = isAdmin ? '/admin' : '/manage';
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const stale = 60_000;

  const events = useQuery({ queryKey: ['events'], queryFn: api.events, enabled: isStaff, staleTime: stale });
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists, enabled: isStaff, staleTime: stale });
  const people = useQuery({ queryKey: ['people'], queryFn: api.allPeople, enabled: isAdmin, staleTime: stale });
  const trackers = useQuery({ queryKey: ['tracker-overview'], queryFn: api.trackerOverview, enabled: role !== 'member', staleTime: stale });
  const signups = useQuery({ queryKey: ['signup-lists'], queryFn: api.signupLists, enabled: isStaff || role === 'registrar', staleTime: stale });

  const all = useMemo<Hit[]>(() => {
    const h: Hit[] = pages.map((p) => ({ key: `p${p.to}`, group: 'Go to', label: p.label, to: p.to }));
    for (const e of events.data ?? []) if (!e.archived_at) h.push({ key: `e${e.id}`, group: 'Events', label: e.name, to: `${base}/events/${e.id}` });
    const evName = new Map((events.data ?? []).map((e) => [e.id, e.name]));
    for (const l of lists.data ?? []) if (l.status !== 'archived') h.push({ key: `l${l.id}`, group: 'Lists', label: l.title, sub: `${evName.get(l.event_id) ?? ''} · ${l.status}`, to: `${base}/lists/${l.id}` });
    for (const t of trackers.data ?? []) for (const l of t.lists) h.push({ key: `t${l.id}`, group: 'Trackers', label: `${t.name}: ${l.title}`, to: `/trackers/${t.id}/lists/${l.id}` });
    for (const s of signups.data ?? []) h.push({ key: `s${s.id}`, group: 'Sign-ups', label: s.title, sub: `${s.entries} signed up`, to: `/signups/${s.id}` });
    for (const p of people.data ?? []) if (!p.archived && !p.merged_into) h.push({ key: `u${p.id}`, group: 'People', label: p.full_name, to: `/admin/people?q=${encodeURIComponent(p.full_name)}` });
    return h;
  }, [pages, events.data, lists.data, trackers.data, signups.data, people.data, base]);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return all.filter((h) => h.group === 'Go to').slice(0, 8);
    const words = s.split(/\s+/);
    const pool = all.filter((h) => words.every((w) => `${h.label} ${h.sub ?? ''}`.toLowerCase().includes(w)));
    pool.sort((a, b) => Number(b.label.toLowerCase().startsWith(s)) - Number(a.label.toLowerCase().startsWith(s)));
    const per = new Map<string, number>(); const out: Hit[] = [];
    for (const h of pool) { const n = per.get(h.group) ?? 0; if (n < 6) { per.set(h.group, n + 1); out.push(h); } }
    return out;
  }, [q, all]);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const go = (h: Hit | undefined) => { if (h) { nav(h.to); onClose(); } };
  let lastGroup = '';
  return (
    <div className="overlay" style={{ alignItems: 'start', paddingTop: '10dvh' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Search" style={{ maxWidth: 560, padding: 12 }}>
        <input ref={input} className="input" style={{ width: '100%', height: 48 }} placeholder={isAdmin ? 'Search pages, events, lists, trackers, people…' : 'Search pages and lists…'}
          value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" aria-label="Search"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); go(hits[sel]); }
          }} />
        <div className="stack" style={{ gap: 2, marginTop: 8, maxHeight: '55dvh', overflowY: 'auto' }}>
          {hits.map((h, i) => {
            const head = h.group !== lastGroup ? (lastGroup = h.group) : '';
            return (
              <div key={h.key}>
                {head && <div className="muted small" style={{ padding: '8px 8px 2px', fontWeight: 600 }}>{head}</div>}
                <button type="button" className="btn block" onMouseEnter={() => setSel(i)} onClick={() => go(h)}
                  style={{ justifyContent: 'space-between', textAlign: 'left', background: i === sel ? 'var(--accent-soft)' : 'transparent', border: 'none', height: 'auto', minHeight: 40, padding: '8px 10px' }}>
                  <span>{h.label}</span>{h.sub && <span className="muted small">{h.sub}</span>}
                </button>
              </div>
            );
          })}
          {!hits.length && <p className="muted center" style={{ margin: 16 }}>Nothing matches.</p>}
        </div>
        <p className="muted small" style={{ margin: '8px 4px 0' }}>Up and down to choose, Enter to open, Esc to close.</p>
      </div>
    </div>
  );
}
