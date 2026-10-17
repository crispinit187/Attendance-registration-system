import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useLiveAttendance } from '../../lib/live';
import { errMsg, fmtTime } from '../../lib/format';
import type { AttendanceRow } from '../../lib/types';
import { Alert, Bars, Loading } from '../../components/ui';
import { useRowFilter } from '../../components/AttendanceTable';

const H2 = { margin: '0 0 4px', fontSize: 16, fontFamily: 'var(--font)', fontWeight: 600 } as const;
const BY: Record<string, string> = { self: 'Self-scan', registrar: 'Registrar', admin: 'Admin' };
const ALL = '__all__';

export function Reviewer() {
  const events = useQuery({ queryKey: ['events'], queryFn: api.events, refetchInterval: 30_000 });
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists, refetchInterval: 30_000 });
  const grants = useQuery({ queryKey: ['grants'], queryFn: api.grants });
  const [eventId, setEventId] = useState('');
  const [listId, setListId] = useState('');
  const [leaveOut, setLeaveOut] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => { if (!eventId && events.data?.length) setEventId(events.data[0]!.id); }, [events.data, eventId]);
  const eventLists = useMemo(() => (lists.data ?? []).filter((l) => l.event_id === eventId && l.status !== 'archived')
    .sort((a, b) => (b.opened_at ?? b.created_at).localeCompare(a.opened_at ?? a.created_at)), [lists.data, eventId]);
  useEffect(() => {
    if (listId !== ALL && !eventLists.some((l) => l.id === listId)) setListId((eventLists.find((l) => l.status === 'open') ?? eventLists[0])?.id ?? '');
  }, [eventLists, listId]);
  const ev = events.data?.find((e) => e.id === eventId);
  const list = eventLists.find((l) => l.id === listId);
  const all = listId === ALL;

  useLiveAttendance([['rv-rows'], ['breakdown', eventId]]);
  const rowsQ = useQuery({
    queryKey: ['rv-rows', listId, eventLists.length], enabled: !!listId && (all ? eventLists.length > 0 : true),
    queryFn: () => (all ? api.eventAttendance(eventLists.map((l) => l.id)) : api.listAttendance(listId, false)), refetchInterval: 20_000,
  });
  const bd = useQuery({ queryKey: ['breakdown', eventId], enabled: !!eventId, queryFn: () => api.breakdown(eventId), refetchInterval: 30_000 });
  const rows: AttendanceRow[] = rowsQ.data ?? [];
  const f = useRowFilter(rows, true);

  const listName = (id: string) => eventLists.find((l) => l.id === id)?.title ?? '';
  const stats = useMemo(() => {
    const src = bd.data ?? [];
    const cur = all ? null : src.find((b) => b.list_id === listId);
    const areas: Record<string, number> = {}; const voices: Record<string, number> = {};
    for (const b of cur ? [cur] : src) { for (const [k, v] of Object.entries(b.areas)) areas[k] = (areas[k] ?? 0) + v; for (const [k, v] of Object.entries(b.voices)) voices[k] = (voices[k] ?? 0) + v; }
    const topArea = Object.entries(areas).sort((a, b) => b[1] - a[1])[0];
    const heldLists = src.filter((b) => b.status === 'open' || b.status === 'closed');
    const avg = heldLists.length ? Math.round(heldLists.reduce((s, b) => s + b.total, 0) / heldLists.length) : 0;
    return { areas, voices, topArea, avg, heldCount: heldLists.length, total: cur ? cur.total : src.reduce((s, b) => s + b.total, 0) };
  }, [bd.data, listId, all]);
  const openCount = eventLists.filter((l) => l.status === 'open').length;
  const todo = eventLists.filter((l) => l.status === 'draft').length;

  const myGrants = grants.data ?? [];
  const accessText = myGrants.map((g) => (g.event_id
    ? `${events.data?.find((e) => e.id === g.event_id)?.name ?? 'Event'} - all lists`
    : `${(lists.data ?? []).find((l) => l.id === g.list_id)?.title ?? 'List'}`)).join(', ');
  const includesLater = myGrants.some((g) => g.event_id);

  const run = async (format: 'xlsx' | 'pdf') => {
    setErr(''); setBusy(format);
    try {
      const { exportList, exportEventGrid } = await import('../../lib/export');
      const shown = f.filtered;
      if (all && ev) {
        await api.logExport('event', ev.id, format, { rows: shown.length, contact: !leaveOut, filtered: f.active });
        await exportEventGrid(ev.name, eventLists, shown, { includeContact: !leaveOut }, format);
      } else if (list) {
        await api.logExport('list', list.id, format, { rows: shown.length, contact: !leaveOut, filtered: f.active });
        await exportList({ title: list.title, event: ev?.name }, shown, { includeContact: !leaveOut, includeMethod: true }, format);
      }
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(''); }
  };

  if (events.isLoading || lists.isLoading) return <div className="page wide"><Loading /></div>;
  if (events.error) return <div className="page"><Alert>{errMsg(events.error)}</Alert></div>;
  if (!events.data?.length) return (
    <div className="page"><div className="card stack" style={{ gap: 6 }}><h2 style={{ margin: 0 }}>Nothing to review yet</h2><div className="muted">An admin has not given you access to any event or list yet.</div></div></div>
  );

  const cols = `2.2fr 0.8fr 1.1fr 1fr ${leaveOut ? '' : '1.3fr '}0.7fr 1fr${all ? ' 1fr' : ''}`;
  const subject = all ? 'All lists' : list?.title ?? '';

  return (
    <div className="page wide stack" style={{ gap: 22, paddingTop: 28 }} id="rv-top">
      <div className="row between">
        <div>
          <h1 style={{ margin: 0, fontSize: 30 }}>Reviewer dashboard</h1>
          <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>View and export only. You cannot change data or mark attendance.</div>
        </div>
        <span className="readonly">Read-only access</span>
      </div>

      <section id="rv-access" className="card row between" style={{ gap: 10, padding: '16px 20px', scrollMarginTop: 12 }} aria-label="Your access">
        <div>
          <div className="muted" style={{ fontSize: 13 }}>Your access, granted by an admin</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{accessText || ev?.name}</div>
          {includesLater && <div className="muted" style={{ fontSize: 13 }}>Includes lists added later</div>}
        </div>
        <div className="stack" style={{ gap: 6, minWidth: 220 }}>
          {events.data.length > 1 && (
            <select className="input" style={{ minHeight: 46, borderRadius: 10, background: 'var(--bg)' }} value={eventId} onChange={(e) => { setEventId(e.target.value); setListId(''); }} aria-label="Event">
              {events.data.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
          <label style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 6 }}>Showing list
            <select className="input" style={{ minHeight: 46, borderRadius: 10, background: 'var(--bg)', fontSize: 15 }} value={listId} onChange={(e) => setListId(e.target.value)}>
              {eventLists.map((l) => <option key={l.id} value={l.id}>{l.title}{l.status === 'open' ? ' (open)' : ''}</option>)}
              {eventLists.length > 1 && <option value={ALL}>All lists in the event</option>}
            </select>
          </label>
        </div>
      </section>

      <section className="grid c3" aria-label="Key figures">
        <div className="statcard"><div className="l">Present</div><div className="v">{all ? stats.total : rows.length}</div><div className="n">{subject}{list?.status === 'open' ? ', live' : ''}</div></div>
        <div className="statcard"><div className="l">Lists you can see</div><div className="v">{eventLists.length}</div><div className="n">{stats.heldCount - openCount} held, {openCount} open, {todo} to come</div></div>
        <div className="statcard"><div className="l">Largest area</div><div className="v">{stats.topArea?.[0] ?? '–'}</div><div className="n">{stats.topArea ? `${stats.topArea[1]} people` : 'No attendance yet'}</div></div>
        <div className="statcard"><div className="l">Average per list</div><div className="v">{stats.avg}</div><div className="n">Across lists held so far</div></div>
      </section>

      <section id="rv-charts" className="row" style={{ alignItems: 'stretch', gap: 14, scrollMarginTop: 12 }} aria-label="Charts">
        <div className="card" style={{ flex: '3 1 340px', minWidth: 0 }}>
          <h2 style={H2}>Voice parts</h2>
          <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>{subject}, people present</div>
          <Bars data={stats.voices} inline />
        </div>
        <div className="card" style={{ flex: '2 1 280px', minWidth: 0 }}>
          <h2 style={H2}>Area participation</h2>
          <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>{subject}, people present</div>
          <Bars data={stats.areas} />
        </div>
      </section>

      <section id="rv-attendance" className="card stack" style={{ gap: 14, scrollMarginTop: 12 }} aria-label="Attendance">
        <div id="rv-export" className="row between" style={{ scrollMarginTop: 12 }}>
          <h2 style={{ ...H2, margin: 0 }}>Attendance</h2>
          <div className="row" style={{ gap: 10 }}>
            <label className="check" style={{ alignItems: 'center', minHeight: 44, color: 'var(--muted)', fontSize: 14 }}><input type="checkbox" checked={leaveOut} onChange={(e) => setLeaveOut(e.target.checked)} />Leave out contact</label>
            <button className="btn" disabled={!!busy || !f.filtered.length} onClick={() => run('xlsx')}>{busy === 'xlsx' ? 'Preparing…' : 'Export Excel'}</button>
            <button className="btn primary" disabled={!!busy || !f.filtered.length} onClick={() => run('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'Export PDF'}</button>
          </div>
        </div>
        {err && <Alert>{err}</Alert>}
        {f.ui}
        <div style={{ overflowX: 'auto' }}>
          <div className="gridtbl" style={{ minWidth: 760 }}>
            <div className="hd" style={{ gridTemplateColumns: cols }}>
              <span>Name</span><span>Area</span><span>District</span><span>Voice part</span>{!leaveOut && <span>Contact</span>}<span>Time</span><span>Marked by</span>{all && <span>List</span>}
            </div>
            {f.filtered.map((r) => (
              <div className="rw" style={{ gridTemplateColumns: cols }} key={r.id}>
                <span>{r.snapshot.display_name}</span><span>{r.snapshot.area}</span><span>{r.snapshot.district}</span><span>{r.snapshot.voice_part}</span>
                {!leaveOut && <span className="m">{r.snapshot.contact || 'Not given'}</span>}
                <span className="m">{fmtTime(r.marked_at)}</span><span className="m">{BY[r.method] ?? r.method}</span>{all && <span className="m">{listName(r.list_id)}</span>}
              </div>
            ))}
            {!f.filtered.length && <div className="muted center" style={{ padding: 24 }}>{rowsQ.isLoading ? 'Loading…' : 'Nobody matches.'}</div>}
          </div>
        </div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>Showing {f.filtered.length} of {rows.length}. Removed attendees are left out. Every export is logged with your name, the list and the time.</div>
      </section>
    </div>
  );
}
