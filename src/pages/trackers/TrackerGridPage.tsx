import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth, useLookups } from '../../lib/auth';
import { contactOk, errMsg, formatContactInput } from '../../lib/format';
import { fmtD, fmtShort } from '../../lib/trackerStats';
import type { TrackerCard, TrackerDate, TrackerGrid, TrackerPersonInput, TrackerRow } from '../../lib/types';
import { Alert, Badge, Field, Icon, Loading, Modal, useToast } from '../../components/ui';
import { DistrictInput } from '../../components/DistrictInput';
import { TrackerAnalytics } from '../../components/TrackerAnalytics';
import { ImportDialog } from './ImportDialog';
import { FollowUpDialog } from '../../components/FollowUp';
import { enqueue, flush, isNetworkError, newId, queued, queuedTicks, withCache } from '../../lib/offline';

const gridKey = (list: string) => ['tracker-grid', list];
const shown = (r: { title: string | null; title_specify: string | null; name: string }) =>
  [r.title, r.title_specify ? `(${r.title_specify})` : '', r.name].filter(Boolean).join(' ');

/** Turn a tick on or off in the cached grid without reloading it, so the screen stays exactly where it is. */
function patch(g: TrackerGrid, entry: string, date: string, on: boolean): TrackerGrid {
  return {
    ...g,
    rows: g.rows.map((r) => {
      if (r.entry_id !== entry) return r;
      const has = r.marks.includes(date);
      if (on === has) return r;
      return { ...r, marks: on ? [...r.marks, date] : r.marks.filter((d) => d !== date) };
    }),
  };
}

export function TrackerGridPage() {
  const { eventId = '', listId = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { account } = useAuth();
  const role = account?.role ?? 'member';
  const canImport = role === 'admin' || role === 'manager' || role === 'list_manager';
  const canExport = canImport || role === 'reviewer';
  const pending = useRef(new Map<string, boolean>());   // ticks sent but not yet confirmed: key entry|date -> on

  const q = useQuery({
    queryKey: gridKey(listId),
    queryFn: async () => {
      let g = await withCache(`grid:${listId}`, () => api.trackerGrid(listId));   // with no connection, the last copy is shown
      for (const t of queuedTicks(listId)) g = patch(g, t.entry, t.date, t.on);   // ticks saved on this device, not sent yet
      for (const [k, on] of pending.current) { const [e, d] = k.split('|'); g = patch(g, e!, d!, on); }   // keep ticks that are still being saved
      return g;
    },
    refetchInterval: 30_000,
  });
  const evq = useQuery({ queryKey: ['tracker-event', eventId], queryFn: () => api.trackerEvent(eventId) });

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [showRemoved, setShowRemoved] = useState(false);
  const [pick, setPick] = useState<Set<string> | null>(null);   // dates to tick for a new person; null = latest date only
  const [dlg, setDlg] = useState<null | 'date' | 'import' | 'create' | 'export' | 'followup'>(null);
  const [rowDlg, setRowDlg] = useState<TrackerRow | null>(null);
  const [dateDlg, setDateDlg] = useState<TrackerDate | null>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 250); return () => clearTimeout(t); }, [search]);

  const g = q.data;
  const perms = g?.perms ?? { mark: false, manage: false, contact: false };
  const dates = useMemo(() => (g?.dates ?? []).filter((d) => showRemoved || !d.removed), [g, showRemoved]);
  const liveDates = useMemo(() => (g?.dates ?? []).filter((d) => !d.removed), [g]);
  const latest = liveDates.length ? liveDates[liveDates.length - 1]!.id : null;
  const chosen = pick ?? new Set(latest ? [latest] : []);

  const search2 = useQuery({
    queryKey: ['tracker-search', listId, debounced],
    queryFn: () => api.trackerSearch(listId, debounced),
    enabled: perms.mark && debounced.length >= 2,
    placeholderData: (p) => p,
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (g?.rows ?? []).filter((r) => (showRemoved || !r.removed) && (!s || r.name.toLowerCase().includes(s)));
  }, [g, search, showRemoved]);

  const toggle = async (row: TrackerRow, date: TrackerDate, on: boolean) => {
    const k = `${row.entry_id}|${date.id}`;
    pending.current.set(k, on);
    qc.setQueryData<TrackerGrid>(gridKey(listId), (old) => (old ? patch(old, row.entry_id, date.id, on) : old));
    const hold = () => {
      enqueue({ id: newId(), kind: 'tick', at: new Date().toISOString(), label: `${on ? 'Ticked' : 'Unticked'} ${row.name} on ${fmtD(date.on_date)}`, list: listId, entry: row.entry_id, date: date.id, on });
      pending.current.delete(k);
      void flush(reload);
    };
    // If anything is already waiting to be sent, join the queue so ticks are applied in the order they were made.
    if (queued().length || !navigator.onLine) { hold(); return; }
    try { await api.trackerMark(row.entry_id, date.id, on); }
    catch (e) {
      if (isNetworkError(e)) { hold(); return; }
      pending.current.delete(k);
      qc.setQueryData<TrackerGrid>(gridKey(listId), (old) => (old ? patch(old, row.entry_id, date.id, !on) : old));
      toast(errMsg(e));
      return;
    }
    if (pending.current.get(k) === on) pending.current.delete(k);
  };

  const reload = () => { void qc.invalidateQueries({ queryKey: gridKey(listId) }); void qc.invalidateQueries({ queryKey: ['tracker-event', eventId] }); void qc.invalidateQueries({ queryKey: ['tracker-overview'] }); void qc.invalidateQueries({ queryKey: ['tracker-analytics'] }); };

  const addExisting = async (c: TrackerCard) => {
    try {
      const r = await api.trackerAddEntry(listId, c.id, [...chosen]);
      toast(r.status === 'already' ? `${c.name} is already on this list.` : r.status === 'restored' ? `${c.name} was brought back.` : `${c.name} added.`);
      setSearch(''); reload();
    } catch (e) { toast(errMsg(e)); }
  };

  if (q.isLoading) return <div className="page wide"><Loading /></div>;
  if (q.error || !g) return <div className="page wide"><Alert>{errMsg(q.error)}</Alert><Link to="/trackers">← Trackers</Link></div>;

  const totals = dates.map((d) => (g.rows.filter((r) => !r.removed && r.marks.includes(d.id)).length));
  const active = g.rows.filter((r) => !r.removed);
  const results = (search2.data ?? []).filter((c) => !c.in_list);
  const typed = search.trim();

  return (
    <div className="page wide stack">
      <div className="stack" style={{ gap: 4 }}>
        <div className="small"><Link to="/trackers">Trackers</Link> / <Link to={`/trackers/${eventId}`}>{g.list.event_name}</Link></div>
        <div className="row between">
          <h1 style={{ margin: 0 }}>{g.list.title} {g.list.archived && <Badge kind="warn">archived</Badge>}</h1>
          <div className="row">
            {perms.manage && <button className="btn" onClick={() => setDlg('date')}><Icon name="plus" size={16} />Add date</button>}
            {canImport && !g.list.archived && <button className="btn" onClick={() => setDlg('import')}><Icon name="down" size={16} />Import</button>}
            {g.dates.some((d) => !d.removed) && <button className="btn" onClick={() => setDlg('followup')}><Icon name="phone" size={16} />Absent</button>}
            {canExport && <button className="btn" onClick={() => setDlg('export')}>Export</button>}
          </div>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {active.length} {active.length === 1 ? 'person' : 'people'} · {liveDates.length} {liveDates.length === 1 ? 'date' : 'dates'}
          {!perms.mark && ' · view only'}
        </p>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="row">
          <div className="grow" style={{ position: 'relative' }}>
            <input className="input" style={{ width: '100%' }} placeholder={perms.mark ? 'Search a name, or add someone new…' : 'Search a name…'} value={search}
              onChange={(e) => setSearch(e.target.value)} autoComplete="off" aria-label="Search names" />
          </div>
          {perms.manage && <label className="check small"><input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />Show removed</label>}
        </div>

        {perms.mark && typed.length >= 2 && (
          <div className="card flat stack" style={{ gap: 10 }}>
            {liveDates.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <span className="small muted">Tick a new person for:</span>
                <DateChips dates={liveDates} value={chosen} onChange={setPick} />
              </div>
            )}
            {results.map((c) => (
              <div className="item" key={c.id}>
                <div className="grow">
                  <b>{shown(c)}</b>
                  <div className="muted small">{[c.voice, c.area, c.district, c.congregation].filter(Boolean).join(' · ') || 'No other details'}{c.was_removed ? ' · was removed from this list' : ''}</div>
                </div>
                <button className="btn small primary" onClick={() => void addExisting(c)}>{c.was_removed ? 'Bring back' : 'Add to list'}</button>
              </div>
            ))}
            {!results.length && !search2.isFetching && <p className="muted small" style={{ margin: 0 }}>{rows.length ? 'No one else in the people register matches.' : 'Not found anywhere yet.'}</p>}
            <button className="btn" onClick={() => setDlg('create')}><Icon name="plus" size={16} />Add “{typed}” as a new person</button>
          </div>
        )}
      </div>

      <div className="tgrid-wrap" role="region" aria-label="Attendance grid" tabIndex={0}>
        <table className="tgrid">
          <thead>
            <tr>
              <th className="sticky1">Name</th>
              <th className="hide-sm">Voice</th><th className="hide-sm">Area</th><th className="hide-sm">District</th><th className="hide-sm">Congregation</th>
              {perms.contact && <th className="hide-sm">Phone</th>}
              {dates.map((d) => (
                <th key={d.id} className="dcol" title={d.title ?? undefined} style={d.removed ? { opacity: .5 } : undefined}>
                  {perms.manage
                    ? <button className="namebtn" style={{ color: 'var(--muted)', fontSize: 'inherit', fontWeight: 600, textAlign: 'center' }} onClick={() => setDateDlg(d)}>{fmtShort(d.on_date)}{d.title ? <><br /><span style={{ fontWeight: 400 }}>{d.title.length > 12 ? d.title.slice(0, 11) + '…' : d.title}</span></> : null}</button>
                    : <>{fmtShort(d.on_date)}{d.title ? <><br /><span style={{ fontWeight: 400 }}>{d.title.length > 12 ? d.title.slice(0, 11) + '…' : d.title}</span></> : null}</>}
                </th>
              ))}
              <th className="dcol">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const n = dates.filter((d) => !d.removed && r.marks.includes(d.id)).length;
              return (
                <tr key={r.entry_id} className={r.removed ? 'gone' : undefined}>
                  <td className="sticky1">
                    <button className="namebtn" onClick={() => setRowDlg(r)} title="Open">{shown(r)}</button>
                    {r.removed && <> <Badge kind="warn">removed</Badge></>}
                  </td>
                  <td className="hide-sm">{r.voice}</td><td className="hide-sm">{r.area}</td><td className="hide-sm">{r.district}</td><td className="hide-sm">{r.congregation}</td>
                  {perms.contact && <td className="hide-sm">{r.contact}</td>}
                  {dates.map((d) => (
                    <td key={d.id} className="dcol">
                      <label className="tick">
                        <input type="checkbox" checked={r.marks.includes(d.id)} disabled={!perms.mark || r.removed || d.removed}
                          onChange={(e) => void toggle(r, d, e.target.checked)} aria-label={`${r.name} on ${fmtD(d.on_date)}`} />
                      </label>
                    </td>
                  ))}
                  <td className="dcol"><b>{n}</b></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td className="muted" colSpan={6 + dates.length + (perms.contact ? 1 : 0)}>{g.rows.length ? 'No one matches that name.' : perms.mark ? 'Nobody on this list yet. Search a name above to add the first person, or import a spreadsheet.' : 'Nobody on this list yet.'}</td></tr>}
          </tbody>
          {dates.length > 0 && rows.length > 0 && (
            <tfoot>
              <tr>
                <td className="sticky1">Present</td><td className="hide-sm" /><td className="hide-sm" /><td className="hide-sm" /><td className="hide-sm" />{perms.contact && <td className="hide-sm" />}
                {dates.map((d, i) => <td key={d.id} className="dcol">{totals[i]}</td>)}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {!liveDates.length && perms.manage && <Alert kind="info">There are no dates yet. Use “Add date” to create the first column, then tick people as they arrive.</Alert>}
      {!liveDates.length && !perms.manage && <Alert kind="info">No dates have been added to this list yet. A list manager adds them.</Alert>}

      <TrackerAnalytics eventId={eventId} listId={listId} />

      {dlg === 'date' && <DateDialog listId={listId} multi={(evq.data?.lists.length ?? 1) > 1} onClose={() => setDlg(null)} onDone={reload} />}
      {dlg === 'import' && <ImportDialog eventId={eventId} listId={listId} eventName={g.list.event_name} dates={liveDates} onClose={() => setDlg(null)} onDone={reload} />}
      {dlg === 'followup' && <FollowUpDialog grid={g} onClose={() => setDlg(null)} />}
      {dlg === 'export' && <ExportDialog eventId={eventId} listId={listId} eventName={g.list.event_name} canContact={perms.contact} grid={g} onClose={() => setDlg(null)} />}
      {dlg === 'create' && <CreateDialog listId={listId} name={typed} dates={liveDates} chosen={chosen} onClose={() => setDlg(null)}
        onDone={() => { setSearch(''); setDlg(null); reload(); }} />}
      {rowDlg && <RowDialog row={g.rows.find((r) => r.entry_id === rowDlg.entry_id) ?? rowDlg} perms={perms} onClose={() => setRowDlg(null)} onDone={reload} />}
      {dateDlg && <EditDateDialog d={g.dates.find((x) => x.id === dateDlg.id) ?? dateDlg} onClose={() => setDateDlg(null)} onDone={reload} />}
    </div>
  );
}

function DateChips({ dates, value, onChange }: { dates: TrackerDate[]; value: Set<string>; onChange: (s: Set<string>) => void }) {
  return (
    <div className="chips">
      {dates.map((d) => (
        <button type="button" key={d.id} className={`chip ${value.has(d.id) ? 'on' : ''}`} aria-pressed={value.has(d.id)}
          onClick={() => { const n = new Set(value); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); onChange(n); }}>
          {fmtShort(d.on_date)}{d.title ? ` · ${d.title}` : ''}
        </button>
      ))}
    </div>
  );
}

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function DateDialog({ listId, multi, onClose, onDone }: { listId: string; multi: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [on, setOn] = useState(today());
  const [title, setTitle] = useState('');
  const [all, setAll] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Add a date" onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault(); setErr(''); setBusy(true);
        try { const r = await api.trackerAddDate(listId, on, title.trim(), all); toast(r.added > 1 ? `Date added to ${r.added} lists.` : 'Date added.'); onDone(); onClose(); }
        catch (x) { setErr(errMsg(x)); setBusy(false); }
      }}>
        <Field label="Date"><input className="input" type="date" value={on} onChange={(e) => setOn(e.target.value)} required /></Field>
        <Field label="Title (optional)" hint="For example “Male choir practice”."><input className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} /></Field>
        {multi && <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /><span>Add this date to every list in the event<br /><span className="hint">Only lists you can manage get it.</span></span></label>}
        {err && <Alert>{err}</Alert>}
        <button className="btn primary block" disabled={busy || !on}>{busy ? 'Adding…' : 'Add date'}</button>
      </form>
    </Modal>
  );
}

function EditDateDialog({ d, onClose, onDone }: { d: TrackerDate; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [on, setOn] = useState(d.on_date);
  const [title, setTitle] = useState(d.title ?? '');
  const [err, setErr] = useState('');
  const run = async (f: () => Promise<unknown>, msg: string) => { try { await f(); toast(msg); onDone(); onClose(); } catch (e) { setErr(errMsg(e)); } };
  return (
    <Modal title={d.removed ? 'Removed date' : 'Edit date'} onClose={onClose}>
      <div className="stack">
        {d.removed && <Alert kind="warn">This date is removed. Its ticks are kept, and come back if you restore it.</Alert>}
        <Field label="Date"><input className="input" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
        <Field label="Title (optional)"><input className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} /></Field>
        {err && <Alert>{err}</Alert>}
        <button className="btn primary block" onClick={() => void run(() => api.trackerUpdateDate(d.id, on, title.trim()), 'Saved.')}>Save</button>
        {d.removed
          ? <button className="btn block" onClick={() => void run(() => api.trackerRestoreDate(d.id), 'Date restored.')}>Restore this date</button>
          : <button className="btn danger block" onClick={() => void run(() => api.trackerRemoveDate(d.id), 'Date removed.')}>Remove this date</button>}
      </div>
    </Modal>
  );
}

function RowDialog({ row, perms, onClose, onDone }: { row: TrackerRow; perms: { mark: boolean; manage: boolean; contact: boolean }; onClose: () => void; onDone: () => void }) {
  const { titles } = useLookups();
  const toast = useToast();
  const [title, setTitle] = useState(row.title_id ?? '');
  const [spec, setSpec] = useState(row.title_specify ?? '');
  const [err, setErr] = useState('');
  const t = titles.find((x) => x.id === title);
  const run = async (f: () => Promise<unknown>, msg: string) => { try { await f(); toast(msg); onDone(); onClose(); } catch (e) { setErr(errMsg(e)); } };
  return (
    <Modal title={row.name} onClose={onClose}>
      <div className="stack">
        <div className="small stack" style={{ gap: 3 }}>
          {[['Voice', row.voice], ['Area', row.area], ['District', row.district], ['Congregation', row.congregation], ...(perms.contact ? [['Phone', row.contact]] : [])].map(([k, v]) => (
            <div key={k}><span className="muted">{k}: </span>{v || <span className="muted">—</span>}</div>
          ))}
        </div>
        {perms.mark && !row.removed && (
          <>
            <Field label="Title (optional)">
              <select className="input" value={title} onChange={(e) => setTitle(e.target.value)}>
                <option value="">No title</option>
                {titles.filter((x) => x.active || x.id === row.title_id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
            {t?.needs_specify && <Field label={`Specify ${t.name.toLowerCase()}`}><input className="input" value={spec} maxLength={60} onChange={(e) => setSpec(e.target.value)} /></Field>}
            <button className="btn primary block" onClick={() => void run(() => api.trackerSetTitle(row.person_id, title || null, spec), 'Saved.')}>Save title</button>
          </>
        )}
        {err && <Alert>{err}</Alert>}
        {perms.manage && (row.removed
          ? <button className="btn block" onClick={() => void run(() => api.trackerRestoreEntry(row.entry_id), 'Person restored.')}>Restore to the list</button>
          : <button className="btn danger block" onClick={() => void run(() => api.trackerRemoveEntry(row.entry_id), 'Removed from the list. Their ticks are kept.')}>Remove from this list</button>)}
        {!perms.manage && <p className="hint" style={{ margin: 0 }}>Only a list manager can remove people from a list.</p>}
      </div>
    </Modal>
  );
}

function CreateDialog({ listId, name, dates, chosen, onClose, onDone }: { listId: string; name: string; dates: TrackerDate[]; chosen: Set<string>; onClose: () => void; onDone: () => void }) {
  const { areas, titles, voices } = useLookups();
  const toast = useToast();
  const [v, setV] = useState<TrackerPersonInput>({ name, title_id: null, title_specify: '', area_id: null, voice_part_id: null, district: '', congregation: '', contact: '' });
  const [ticks, setTicks] = useState<Set<string>>(new Set(chosen));
  const [similar, setSimilar] = useState<TrackerCard[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TrackerPersonInput>(k: K, val: TrackerPersonInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const title = titles.find((t) => t.id === v.title_id);
  const submit = async (force: boolean) => {
    setErr('');
    if (v.name.trim().length < 2) return setErr('Please enter the full name.');
    if (title?.needs_specify && !v.title_specify.trim()) return setErr(`Please say which ${title.name} (for example the office).`);
    if (!contactOk(v.contact)) return setErr('Phone must look like +260 977 123 456, or be left empty.');
    setBusy(true);
    try {
      const r = await api.trackerCreatePerson(listId, { ...v, name: v.name.trim() }, [...ticks], force);
      if (r.status === 'similar') { setSimilar(r.matches); setBusy(false); return; }
      toast('Added.'); onDone();
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  if (similar) {
    return (
      <Modal title="Is this the same person?" onClose={onClose}>
        <div className="stack">
          <Alert kind="warn">Someone with a very similar name is already in the people register:</Alert>
          {similar.map((m) => (
            <div className="item" key={m.id}>
              <div className="grow"><b>{shown(m)}</b><div className="muted small">{[m.voice, m.area, m.district, m.congregation].filter(Boolean).join(' · ')}{m.in_list ? ' · already on this list' : ''}</div></div>
              {!m.in_list && <button className="btn small primary" onClick={async () => { try { await api.trackerAddEntry(listId, m.id, [...ticks]); toast('Added.'); onDone(); } catch (e) { setErr(errMsg(e)); } }}>Use this person</button>}
            </div>
          ))}
          {err && <Alert>{err}</Alert>}
          <button className="btn block" disabled={busy} onClick={() => void submit(true)}>They are different: add “{v.name.trim()}” anyway</button>
          <button className="btn ghost block" onClick={() => setSimilar(null)}>Go back</button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Add a new person" onClose={onClose}>
      <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void submit(false); }} noValidate>
        <Field label="Full name"><input className="input" value={v.name} maxLength={80} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          <div className="grow"><Field label="Title (optional)">
            <select className="input" value={v.title_id ?? ''} onChange={(e) => set('title_id', e.target.value || null)}>
              <option value="">No title</option>
              {titles.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></Field></div>
          <div className="grow"><Field label="Voice">
            <select className="input" value={v.voice_part_id ?? ''} onChange={(e) => set('voice_part_id', e.target.value || null)}>
              <option value="">Not set</option>
              {voices.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></Field></div>
        </div>
        {title?.needs_specify && <Field label={`Specify ${title.name.toLowerCase()}`}><input className="input" value={v.title_specify} maxLength={60} onChange={(e) => set('title_specify', e.target.value)} /></Field>}
        <Field label="Area" hint="Left empty, it follows the list name when possible.">
          <select className="input" value={v.area_id ?? ''} onChange={(e) => set('area_id', e.target.value || null)}>
            <option value="">Choose…</option>
            {areas.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="District"><DistrictInput value={v.district} onChange={(d) => set('district', d)} compact /></Field>
        <Field label="Congregation"><DistrictInput kind="congregation" value={v.congregation} onChange={(d) => set('congregation', d)} compact /></Field>
        <Field label="Phone (optional)"><input className="input" inputMode="tel" value={v.contact} placeholder="+260 9XX XXX XXX" onChange={(e) => set('contact', formatContactInput(e.target.value))} /></Field>
        {dates.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="small"><b>Tick for</b> <span className="muted">(you can also tick later)</span></span>
            <DateChips dates={dates} value={ticks} onChange={setTicks} />
          </div>
        )}
        {err && <Alert>{err}</Alert>}
        <button className="btn primary cta block" disabled={busy}>{busy ? 'Adding…' : 'Add to list'}</button>
      </form>
    </Modal>
  );
}

function ExportDialog({ eventId, listId, eventName, canContact, grid, onClose }: { eventId: string; listId: string; eventName: string; canContact: boolean; grid: TrackerGrid; onClose: () => void }) {
  const [contact, setContact] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const run = async (kind: 'xlsx' | 'pdf' | 'report') => {
    setErr(''); setBusy(kind);
    try {
      const x = await import('../../lib/trackerExport');
      await api.logExport('tracker_list', listId, kind === 'report' ? 'pdf-report' : kind, { rows: grid.rows.length, contact: contact && canContact });
      if (kind === 'report') await x.trackerReportPdf(await api.trackerAnalytics(eventId, listId, null));
      else await x.exportTrackerGrid(eventName, [grid], contact && canContact, kind);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(''); }
  };
  return (
    <Modal title="Export this list" onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>Each export is recorded in the audit log.</p>
        {canContact && <label className="check"><input type="checkbox" checked={contact} onChange={(e) => setContact(e.target.checked)} />Include phone numbers</label>}
        <button className="btn block" disabled={!!busy} onClick={() => void run('xlsx')}>{busy === 'xlsx' ? 'Preparing…' : 'Excel: names and ticks'}</button>
        <button className="btn block" disabled={!!busy} onClick={() => void run('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'PDF: names and ticks'}</button>
        <button className="btn block" disabled={!!busy} onClick={() => void run('report')}>{busy === 'report' ? 'Preparing…' : 'PDF report with analytics'}</button>
        {err && <Alert>{err}</Alert>}
      </div>
    </Modal>
  );
}
