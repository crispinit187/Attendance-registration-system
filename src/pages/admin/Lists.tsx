import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/auth';
import { errMsg, fmtDateTime } from '../../lib/format';
import type { EventRow, ListRow } from '../../lib/types';
import { Alert, Badge, ConfirmDialog, Field, Icon, Loading, Modal, useToast } from '../../components/ui';

const statusKind = (s: string) => (s === 'open' ? 'ok' : s === 'draft' ? 'accent' : s === 'archived' ? 'warn' : '');

export function Lists() {
  const qc = useQueryClient();
  const toast = useToast();
  const events = useQuery({ queryKey: ['events'], queryFn: api.events, refetchInterval: 30_000 });
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists, refetchInterval: 30_000 });
  const [sp, setSp] = useSearchParams();
  const [showArchived, setShowArchived] = useState(false);
  const [newEvent, setNewEvent] = useState(false);
  const [rename, setRename] = useState<EventRow | null>(null);
  const [evAct, setEvAct] = useState<{ kind: 'archive' | 'delete'; event: EventRow; lists?: number } | null>(null);   // event being archived / deleted
  const [form, setForm] = useState<{ event: EventRow; list: ListRow | null } | null>(null);
  const [act, setAct] = useState<{ kind: 'open' | 'close' | 'archive' | 'delete'; list: ListRow } | null>(null);

  const reload = () => { void qc.invalidateQueries({ queryKey: ['lists'] }); void qc.invalidateQueries({ queryKey: ['events'] }); void qc.invalidateQueries({ queryKey: ['open-list'] }); };
  const byEvent = useMemo(() => {
    const m = new Map<string, ListRow[]>();
    for (const l of lists.data ?? []) { if (!showArchived && l.status === 'archived') continue; (m.get(l.event_id) ?? m.set(l.event_id, []).get(l.event_id)!).push(l); }
    return m;
  }, [lists.data, showArchived]);
  const openList = lists.data?.find((l) => l.status === 'open');
  const wantNew = sp.get('new');
  useEffect(() => {
    if (!wantNew || !events.data) return;
    const ev = events.data.find((e) => e.id === wantNew);
    if (ev) setForm({ event: ev, list: null });
    setSp({}, { replace: true });
  }, [wantNew, events.data]); // eslint-disable-line

  if (events.isLoading || lists.isLoading) return <div className="page wide"><Loading /></div>;
  const err = events.error ?? lists.error;
  return (
    <div className="page wide stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Events and lists</h1>
        <div className="row">
          <label className="check small"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>
          <button className="btn primary" onClick={() => setNewEvent(true)}><Icon name="plus" size={16} />New event</button>
        </div>
      </div>
      {err && <Alert>{errMsg(err)}</Alert>}
      {openList && <Alert kind="info">Registration is open for <b>{openList.title}</b>. Only one list can be open at a time.</Alert>}
      {!events.data?.length && <div className="card hero muted">No events yet. Create an event (for example “Annual Conference 2026”), then add lists to it.</div>}

      {events.data?.filter((ev) => showArchived || !ev.archived_at).map((ev) => {
        const ls = byEvent.get(ev.id) ?? [];
        const allLists = (lists.data ?? []).filter((l) => l.event_id === ev.id);
        return (
          <div className="card stack" key={ev.id}>
            <div className="row between">
              <h2 style={{ margin: 0 }}>{ev.name} {ev.archived_at && <Badge>archived</Badge>}</h2>
              <div className="row">
                <button className="btn small ghost" onClick={() => setRename(ev)}>Rename</button>
                {!ev.archived_at && <button className="btn small" onClick={() => setForm({ event: ev, list: null })}><Icon name="plus" size={14} />Add list</button>}
                {!ev.archived_at && <button className="btn small" onClick={() => setEvAct({ kind: 'archive', event: ev })}>Archive</button>}
                {ev.archived_at && (
                  <>
                    <button className="btn small" onClick={async () => { try { await api.unarchiveEvent(ev.id); toast('Event restored from the archive.'); reload(); } catch (e) { toast(errMsg(e)); } }}>Restore</button>
                    <button className="btn small danger" onClick={() => setEvAct({ kind: 'delete', event: ev, lists: allLists.length })}>Delete…</button>
                  </>
                )}
              </div>
            </div>
            {ls.length === 0 && <p className="muted small" style={{ margin: 0 }}>No lists in this event yet.</p>}
            {ls.map((l) => (
              <div className="item" key={l.id}>
                <div className="grow">
                  <Link to={`/admin/lists/${l.id}`} style={{ fontWeight: 700, textDecoration: 'none' }}>{l.title}</Link>{' '}
                  <Badge kind={statusKind(l.status)}>{l.status}</Badge>
                  <div className="muted small">
                    {l.opened_at ? `Opened ${fmtDateTime(l.opened_at)}` : `Created ${fmtDateTime(l.created_at)}`}
                    {l.rotating_qr ? ' · rotating QR' : ''}{l.location_check ? ` · within ${l.radius_m} m` : ''}
                    {l.allowed_area_ids.length ? ` · ${l.allowed_area_ids.length} area(s) only` : ''}
                  </div>
                </div>
                <div className="row">
                  {(l.status === 'draft' || l.status === 'closed') && <button className="btn small primary" onClick={() => setAct({ kind: 'open', list: l })}>{l.status === 'closed' ? 'Re-open' : 'Open'}</button>}
                  {l.status === 'open' && <button className="btn small danger" onClick={() => setAct({ kind: 'close', list: l })}>Close</button>}
                  {l.status !== 'archived' && l.status !== 'open' && <button className="btn small" onClick={() => setForm({ event: ev, list: l })}>Edit</button>}
                  {l.status === 'open' && <button className="btn small" onClick={() => setForm({ event: ev, list: l })}>Edit</button>}
                  {l.status === 'closed' && <button className="btn small" onClick={() => setAct({ kind: 'archive', list: l })}>Archive</button>}
                  {l.status === 'draft' && <button className="btn small" onClick={() => setAct({ kind: 'archive', list: l })}>Archive</button>}
                  {l.status === 'archived' && (
                    <>
                      <button className="btn small" onClick={async () => { try { await api.unarchiveList(l.id); toast('Restored from archive.'); reload(); } catch (e) { toast(errMsg(e)); } }}>Restore</button>
                      <button className="btn small danger" onClick={() => setAct({ kind: 'delete', list: l })}>Delete…</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {newEvent && <NameDialog title="New event" label="Event name" initial="" cta="Create event" onClose={() => setNewEvent(false)}
        onSave={async (n) => { await api.createEvent(n); reload(); }} />}
      {rename && <NameDialog title="Rename event" label="Event name" initial={rename.name} cta="Save" onClose={() => setRename(null)}
        onSave={async (n) => { await api.renameEvent(rename.id, n); reload(); }} />}
      {form && <ListForm event={form.event} list={form.list} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); toast('List saved.'); }} />}

      {act?.kind === 'open' && (
        <ConfirmDialog title={`Open “${act.list.title}”?`} confirmLabel="Open registration"
          body={<p>Members will be able to mark attendance straight away.{openList && <> <b>“{openList.title}” is open right now</b>, so opening this will be refused until that one is closed.</>}</p>}
          onClose={() => setAct(null)} onConfirm={async () => { await api.openListById(act.list.id); toast('Registration is open.'); reload(); }} />
      )}
      {act?.kind === 'close' && (
        <ConfirmDialog title={`Close “${act.list.title}”?`} danger confirmLabel="Close registration"
          body={<p>Nobody will be able to mark attendance for this list afterwards. You can re-open it later if needed.</p>}
          onClose={() => setAct(null)} onConfirm={async () => { await api.closeList(act.list.id); toast('Registration closed.'); reload(); }} />
      )}
      {act?.kind === 'archive' && (
        <ConfirmDialog title={`Archive “${act.list.title}”?`} confirmLabel="Archive"
          body={<p>The list moves out of the way (reviewers stop seeing it) but nothing is deleted. You can restore it any time.</p>}
          onClose={() => setAct(null)} onConfirm={async () => { await api.archiveList(act.list.id); toast('Archived.'); reload(); }} />
      )}
      {act?.kind === 'delete' && (
        <ConfirmDialog title="Delete this list for good?" danger confirmLabel="Delete forever" typeToConfirm={act.list.title}
          body={<><p><b>This cannot be undone.</b> The list and every attendance record in it will be permanently deleted. The deletion is written to the audit log.</p></>}
          onClose={() => setAct(null)} onConfirm={async () => { await api.deleteList(act.list.id, act.list.title); toast('List deleted.'); reload(); }} />
      )}
      {evAct?.kind === 'archive' && (
        <ConfirmDialog title={`Archive “${evAct.event.name}”?`} confirmLabel="Archive event"
          body={<p>The event is hidden from this page (tick “Show archived” to see it). Nothing is deleted, and you can restore it any time. An event with an open list cannot be archived.</p>}
          onClose={() => setEvAct(null)} onConfirm={async () => { await api.archiveEvent(evAct.event.id); toast('Event archived.'); reload(); }} />
      )}
      {evAct?.kind === 'delete' && (
        <ConfirmDialog title="Delete this event and everything in it?" danger confirmLabel="Delete everything" typeToConfirm={evAct.event.name}
          body={<>
            <Alert>
              <b>Warning: this cannot be undone.</b> Deleting “{evAct.event.name}” permanently deletes
              {' '}{evAct.lists ? <>its <b>{evAct.lists} list{evAct.lists === 1 ? '' : 's'}</b> and <b>every attendance record</b> in {evAct.lists === 1 ? 'it' : 'them'}</> : 'the event'},
              {' '}and any reviewer access given for it. Exports you already downloaded are not affected.
            </Alert>
            <p>The deletion is written to the audit log (with how many lists and records were removed). If you may need the data, export it first.</p>
          </>}
          onClose={() => setEvAct(null)} onConfirm={async () => { await api.deleteEvent(evAct.event.id, evAct.event.name); toast('Event deleted.'); reload(); }} />
      )}
    </div>
  );
}

function NameDialog({ title, label, initial, cta, onSave, onClose }: {
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

function ListForm({ event, list, onClose, onSaved }: { event: EventRow; list: ListRow | null; onClose: () => void; onSaved: () => void }) {
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
