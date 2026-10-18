import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import type { SyncResult } from './types';

/**
 * Offline support. Marks made without a connection wait in a queue on this device and are sent, in order, when the
 * connection is back. Each queued mark has its own id, so sending it twice never records it twice.
 */

export type QueueItem =
  | { owner: string; id: string; kind: 'tick'; at: string; label: string; list: string; entry: string; date: string; on: boolean }
  | { owner: string; id: string; kind: 'att'; at: string; label: string; list: string; person: string };
export interface Held { id: string; label: string; message: string; kind: 'approval' | 'error' }

const QKEY = 'offline.queue.v1';
const HKEY = 'offline.held.v1';
const listeners = new Set<() => void>();
let syncing = false;
let lastError = '';

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

let owner = '';
export const setOwner = (uid: string) => { owner = uid; emit(); };
let queue: QueueItem[] = read<QueueItem[]>(QKEY, []);
let held: Held[] = read<Held[]>(HKEY, []);
let snap = { queue: [] as QueueItem[], held, syncing, lastError };
const emit = () => { snap = { queue: queue.filter((q) => q.owner === owner), held, syncing, lastError }; listeners.forEach((l) => l()); };
const save = () => { write(QKEY, queue); write(HKEY, held); emit(); };

export const isNetworkError = (e: unknown) =>
  (typeof navigator !== 'undefined' && navigator.onLine === false) || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(e instanceof Error ? e.message : String(e));

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`);

type NewItem = QueueItem extends infer T ? (T extends QueueItem ? Omit<T, 'owner'> : never) : never;
export function enqueue(input: NewItem) {
  const item = { ...input, owner } as QueueItem;
  if (item.kind === 'tick') queue = queue.filter((q) => !(q.owner === owner && q.kind === 'tick' && q.entry === item.entry && q.date === item.date));   // the latest tap on a box wins
  else if (queue.some((q) => q.owner === owner && q.kind === 'att' && q.list === item.list && q.person === item.person)) return;
  queue = [...queue, item];
  save();
}
export const dismissHeld = (id: string) => { held = held.filter((h) => h.id !== id); save(); };
export const heldNow = () => held;
export const queued = () => queue.filter((q) => q.owner === owner);

/** Ticks still waiting for one list, in the order they were made. */
export const queuedTicks = (list: string) => queue.filter((q): q is Extract<QueueItem, { kind: 'tick' }> => q.owner === owner && q.kind === 'tick' && q.list === list);
export const queuedMarks = (list: string) => queue.filter((q): q is Extract<QueueItem, { kind: 'att' }> => q.owner === owner && q.kind === 'att' && q.list === list);

export async function flush(onDone?: () => void): Promise<void> {
  if (syncing || !owner || !queued().length) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  syncing = true; lastError = ''; emit();
  try {
    while (queued().length) {
      const batch = queued().slice(0, 100);
      const ticks = batch.filter((b) => b.kind === 'tick');
      const atts = batch.filter((b) => b.kind === 'att');
      const done = new Set<string>();
      const hold: Held[] = [];
      const check = (items: QueueItem[], res: SyncResult[]) => {
        items.forEach((it, i) => {
          const r = res[i];
          if (!r) return;
          if (r.status === 'error') {
            // Not a connection problem: the server refused it (no access, list archived...). Keep a note so it is not lost silently.
            hold.push({ id: it.id, label: it.label, message: r.message ?? 'Could not be saved.', kind: 'error' });
          } else if (r.status === 'needs_approval') {
            hold.push({ id: it.id, label: it.label, message: 'Made outside the time the list was open. An admin has to approve it.', kind: 'approval' });
          }
          done.add(it.id);
        });
      };
      if (ticks.length) check(ticks, await api.trackerSync(ticks.map((t) => (t.kind === 'tick' ? { entry: t.entry, date: t.date, on: t.on, at: t.at } : {}))));
      if (atts.length) check(atts, await api.attendanceSync(atts.map((t) => (t.kind === 'att' ? { client_id: t.id, list: t.list, person: t.person, at: t.at } : {}))));
      if (!done.size) break;   // nothing was accepted: stop here and try again later instead of looping
      queue = queue.filter((q) => !done.has(q.id));
      held = [...held, ...hold].slice(-30);
      save();
    }
    onDone?.();
  } catch (e) {
    // Network trouble: leave everything in the queue and try again later.
    lastError = isNetworkError(e) ? '' : e instanceof Error ? e.message : 'Could not sync.';
  } finally { syncing = false; emit(); }
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useOfflineState = () => useSyncExternalStore(subscribe, () => snap);

export function useOnline() {
  return useSyncExternalStore(
    (l) => { window.addEventListener('online', l); window.addEventListener('offline', l); return () => { window.removeEventListener('online', l); window.removeEventListener('offline', l); }; },
    () => navigator.onLine,
  );
}

/** Starts sending whenever the connection returns, and retries every 20 seconds while something is waiting. */
export function useAutoFlush(uid: string, onDone: () => void) {
  useEffect(() => {
    setOwner(uid);
    const go = () => { void flush(onDone); };
    window.addEventListener('online', go);
    const t = setInterval(() => { if (queued().length) go(); }, 20_000);
    go();
    return () => { window.removeEventListener('online', go); clearInterval(t); };
  }, [uid, onDone]);
}

// --- Remembering what was last seen, so lists can still be opened with no connection ---
const CPREFIX = 'offline.cache.';
export function remember(key: string, data: unknown) { try { localStorage.setItem(CPREFIX + key, JSON.stringify({ at: Date.now(), data })); } catch { /* full: skip */ } }
export function recall<T>(key: string): T | undefined {
  try { const v = localStorage.getItem(CPREFIX + key); return v ? (JSON.parse(v).data as T) : undefined; } catch { return undefined; }
}
/** Runs the request; stores a copy of the answer. With no connection it returns the last copy instead. */
export async function withCache<T>(key: string, run: () => Promise<T>): Promise<T> {
  try { const d = await run(); remember(key, d); return d; }
  catch (e) { const c = recall<T>(key); if (c !== undefined && isNetworkError(e)) return c; throw e; }
}
/** Forget everything kept on this device (used at sign-out). */
export function clearOffline() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(CPREFIX)).forEach((k) => localStorage.removeItem(k));
    held = []; localStorage.removeItem(HKEY); emit();
  } catch { /* ignore */ }
}
