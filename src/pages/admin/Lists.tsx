import { useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth, useBase, useLookups } from '../../lib/auth';
import { errMsg } from '../../lib/format';
import type { EventRow, ListRow } from '../../lib/types';
import { Alert, Badge, Field, Icon, Loading, Modal, useToast } from '../../components/ui';

export const statusKind = (s: string) => (s === 'open' ? 'ok' : s === 'draft' ? 'accent' : s === 'archived' ? 'warn' : '');

export function Lists() {
  const qc = useQueryClient();
  const toast = useToast();
  const role = useAuth().account?.role;
  const isAdmin = role === 'admin';   // event managers work inside their events but cannot create or change events
  const base = useBase();
  const events = useQuery({ queryKey: ['events'], queryFn: api.events, refetchInterval: 30_000 });
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists, refetchInterval: 30_000 });
  const [sp] = useSearchParams();
  const [showArchived, setShowArchived] = useState(false);
  const [newEvent, setNewEvent] = useState(false);
  const reload = () => { void qc.invalidateQueries({ queryKey: ['lists'] }); void qc.invalidateQueries({ queryKey: ['events'] }); };
  const wantNew = sp.get('new');
  const byEvent = useMemo(() => {
    const m = new Map<string, ListRow[]>();
    for (const l of lists.data ?? []) { if (l.status === 'archived') continue; (m.get(l.event_id) ?? m.set(l.event_id, []).get(l.event_id)!).push(l); }
    return m;
  }, [lists.data]);

  if (wantNew) return <Navigate to={`${base}/events/${wantNew}?new=1`} replace />;
  if (events.isLoading || lists.isLoading) return <div className="page wide"><Loading /></div>;
  const err = events.error ?? lists.error;
  const shown = (events.data ?? []).filter((ev) => showArchived || !ev.archived_at);
  // Someone who works on exactly one list goes straight to it
  const all = events.data ?? [];
  const only = all.length === 1 ? byEvent.get(all[0]!.id) ?? [] : [];
  if (!isAdmin && role !== 'manager' && only.length === 1) return <Navigate to={`${base}/lists/${only[0]!.id}`} replace />;
  return (
    <div className="page wide stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Events</h1>
        <div className="row">
          <label className="check small"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>
          {isAdmin && <button className="btn primary" onClick={() => setNewEvent(true)}><Icon name="plus" size={16} />New event</button>}
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>Open an event to see its lists, who manages it, and its analytics.</p>
      {err && <Alert>{errMsg(err)}</Alert>}
      {!shown.length && <div className="card hero muted">{isAdmin ? 'No events yet. Create an event (for example “Annual Conference 2026”), then add lists to it.' : 'No event has been given to you yet. Ask an admin to assign you one.'}</div>}
      <div className="grid c2">
        {shown.map((ev) => {
          const ls = byEvent.get(ev.id) ?? [];
          const open = ls.filter((l) => l.status === 'open').length;
          return (
            <Link key={ev.id} to={`${base}/events/${ev.id}`} className="card stack" style={{ textDecoration: 'none', color: 'inherit', gap: 6 }}>
              <h2 style={{ margin: 0 }}>{ev.name} {ev.archived_at && <Badge kind="warn">archived</Badge>}</h2>
              <div className="muted small">{ls.length} {ls.length === 1 ? 'list' : 'lists'}{open ? ` · ${open} open now` : ''}</div>
              <div className="row" style={{ gap: 6 }}>{ls.slice(0, 5).map((l) => <Badge key={l.id} kind={statusKind(l.status)}>{l.title}</Badge>)}</div>
            </Link>
          );
        })}
      </div>
      {newEvent && <NameDialog title="New event" label="Event name" initial="" cta="Create event" onClose={() => setNewEvent(false)}
        onSave={async (n) => { await api.createEvent(n); reload(); toast('Event created.'); }} />}
    </div>
  );
}

export function NameDialog({ title, label, initial, cta, onSave, onClose }: {
  title: string; label: string; initial: string; cta: string; onSave: (n: string) => Promise<void>; onClose: () => void;
}) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault(); setErr(''); setBusy(true);
        try { await onSave(v.trim()); onClose(); } catch (x) { setErr(errMsg(x)); setBusy(false); }
      }}>
        <Field label={label}><input className="input" value={v} onChange={(e) => setV(e.target.value)} maxLength={80} autoFocus /></Field>
        {err && <Alert>{err}</Alert>}
        <button className="btn primary block" disabled={busy || v.trim().length < 2}>{cta}</button>
      </form>
    </Modal>
  );
}

export function ListForm({ event, list, onClose, onSaved }: { event: EventRow; list: ListRow | null; onClose: () => void; onSaved: () => void }) {
  const { areas } = useLookups();
  const [title, setTitle] = useState(list?.title ?? '');
  const [allowed, setAllowed] = useState<string[]>(list?.allowed_area_ids ?? []);
  const [loc, setLoc] = useState(list?.location_check ?? false);
  const [lat, setLat] = useState(list?.venue_lat?.toString() ?? '');
  const [lng, setLng] = useState(list?.venue_lng?.toString() ?? '');
  const [radius, setRadius] = useState(String(list?.radius_m ?? 200));
  const [rot, setRot] = useState(list?.rotating_qr ?? false);
  const [secs, setSecs] = useState(String(list?.rotation_seconds ?? 30));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const here = () => {
    if (!navigator.geolocation) return setErr('This browser cannot share its location.');
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)); setErr(''); },
      () => setErr('Could not get this device\'s location. Type the coordinates instead.'),
      { enableHighAccuracy: true, timeout: 15000 });
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    if (title.trim().length < 2) return setErr('Please enter a list title.');
    const la = lat.trim() === '' ? null : Number(lat), ln = lng.trim() === '' ? null : Number(lng);
    if (loc && (la === null || ln === null || Number.isNaN(la) || Number.isNaN(ln))) return setErr('Set the venue location (use “Use my location now” while at the venue), or turn the location check off.');
    const r = Number(radius), s = Number(secs);
    if (!(r >= 20 && r <= 5000)) return setErr('Radius must be between 20 and 5000 metres.');
    if (rot && !(s >= 10 && s <= 300)) return setErr('The code can change every 10 to 300 seconds.');
    setBusy(true);
    try {
      await api.saveList({ id: list?.id ?? null, event: event.id, title: title.trim(), allowed, location: loc, lat: loc ? la : null, lng: loc ? ln : null, radius: r, rotating: rot, rotation: s || 30 });
      onSaved();
    } catch (x) { setErr(errMsg(x)); setBusy(false); }
  };
  const toggle = (id: string) => setAllowed((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  return (
    <Modal title={list ? 'Edit list' : `New list in ${event.name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="List title" hint="For example “Saturday morning” or “Day 1 session”."><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} autoFocus /></Field>
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">Who can register</b>
          <label className="check"><input type="checkbox" checked={allowed.length === 0} onChange={() => setAllowed([])} />Every area</label>
          {areas.filter((a) => a.active).map((a) => <label className="check" key={a.id}><input type="checkbox" checked={allowed.includes(a.id)} onChange={() => toggle(a.id)} />{a.name} only</label>)}
          <span className="hint">Tick specific areas to limit this list to them.</span>
        </div>
        <label className="check"><input type="checkbox" checked={rot} onChange={(e) => setRot(e.target.checked)} />
          <span><b>Rotating QR code</b><br /><span className="hint">The code changes constantly, so a photo of it stops working. Best for preventing sharing.</span></span></label>
        {rot && <Field label="Change the code every (seconds)"><input className="input" inputMode="numeric" value={secs} onChange={(e) => setSecs(e.target.value.replace(/\D/g, ''))} /></Field>}
        <label className="check"><input type="checkbox" checked={loc} onChange={(e) => setLoc(e.target.checked)} />
          <span><b>Location check</b><br /><span className="hint">Members must be near the venue when they scan.</span></span></label>
        {loc && (
          <div className="stack">
            <button type="button" className="btn small" onClick={here}><Icon name="pin" size={16} />Use my location now</button>
            <div className="grid c2">
              <Field label="Latitude"><input className="input" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} /></Field>
              <Field label="Longitude"><input className="input" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} /></Field>
            </div>
            <Field label="Allowed distance from the venue (metres)"><input className="input" inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value.replace(/\D/g, ''))} /></Field>
            <span className="hint">Tip: stand at the venue and tap “Use my location now”. Phones are usually accurate to within a few tens of metres.</span>
          </div>
        )}
        {err && <Alert>{err}</Alert>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Saving…' : 'Save list'}</button>
      </form>
    </Modal>
  );
}
