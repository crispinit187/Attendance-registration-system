import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeCanvas } from 'qrcode.react';
import { api } from '../../lib/api';
import { useLiveAttendance } from '../../lib/live';
import { scanUrl } from '../../lib/qrurl';
import { describeAudit, fmtWhen } from '../../lib/audit';
import { download, errMsg, safeName } from '../../lib/format';
import { useLookups } from '../../lib/auth';
import type { ListRow } from '../../lib/types';
import { Alert, ConfirmDialog, Loading, useToast } from '../../components/ui';

const H2 = { margin: '0 0 4px', fontSize: 16, fontFamily: 'var(--font)', fontWeight: 600 } as const;

const shortLabel = (t: string, i: number) => {
  const m = t.match(/^(\S)\S*\s+(\d+)$/);
  return m ? `${m[1]!.toUpperCase()}${m[2]}` : t.length <= 5 ? t : `#${i + 1}`;
};
const chipLabel = (l: ListRow) => (l.status === 'open' ? 'Open' : l.status === 'closed' ? 'Closed' : l.status === 'archived' ? 'Archived' : 'Not opened');

export function AdminDashboard() {
  const qc = useQueryClient();
  const toast = useToast();
  const { areas } = useLookups();
  const events = useQuery({ queryKey: ['events'], queryFn: api.events, select: (d) => d.filter((e) => !e.archived_at) });   // archived events are hidden here
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists });
  const people = useQuery({ queryKey: ['people'], queryFn: api.allPeople });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts });
  const open = useQuery({ queryKey: ['open-list'], queryFn: api.openList, refetchInterval: 10_000 });
  const audit = useQuery({ queryKey: ['audit', 6], queryFn: () => api.audit(6) });
  const [eventId, setEventId] = useState('');
  const [closing, setClosing] = useState<ListRow | null>(null);
  const [opening, setOpening] = useState<ListRow | null>(null);
  const [archiving, setArchiving] = useState<ListRow | null>(null);

  const openRow = lists.data?.find((l) => l.status === 'open');
  useEffect(() => {
    if (!eventId && events.data?.length) setEventId(openRow?.event_id ?? events.data[0]!.id);
  }, [events.data, openRow, eventId]);
  useLiveAttendance([['open-list'], ['breakdown', eventId]]);
  const bd = useQuery({ queryKey: ['breakdown', eventId], enabled: !!eventId, queryFn: () => api.breakdown(eventId), refetchInterval: 20_000 });

  const ev = events.data?.find((e) => e.id === eventId);
  const evLists = (lists.data ?? []).filter((l) => l.event_id === eventId && l.status !== 'archived')
    .sort((a, b) => (a.opened_at ?? a.created_at).localeCompare(b.opened_at ?? b.created_at));
  const total = (id: string) => bd.data?.find((b) => b.list_id === id)?.total ?? 0;
  const focus = evLists.find((l) => l.status === 'open') ?? [...evLists].reverse().find((l) => total(l.id) > 0) ?? evLists[0];
  const focusBd = bd.data?.find((b) => b.list_id === focus?.id);
  const held = evLists.filter((l) => l.status === 'closed' || l.status === 'open').length;
  const maxBar = Math.max(1, ...evLists.map((l) => total(l.id)));
  const withAcc = (accounts.data ?? []).filter((a) => a.person_id).length;
  const peopleCount = (people.data ?? []).filter((p) => !p.archived).length;
  const reload = () => { void qc.invalidateQueries({ queryKey: ['lists'] }); void qc.invalidateQueries({ queryKey: ['open-list'] }); void qc.invalidateQueries({ queryKey: ['audit'] }); };

  if (events.isLoading || lists.isLoading) return <div className="page wide"><Loading /></div>;
  const err = events.error ?? lists.error ?? people.error ?? accounts.error;
  const areaMax = Math.max(1, ...Object.values(focusBd?.areas ?? {}));
  const activeAreas = areas.filter((a) => a.active).length;
  const openAreas = openRow ? (openRow.allowed_area_ids.length === 0 || openRow.allowed_area_ids.length === activeAreas ? 'Areas: all' : `Areas: ${openRow.allowed_area_ids.length} of ${activeAreas}`) : '';

  return (
    <div className="page wide stack" style={{ gap: 22, paddingTop: 28 }}>
      <div className="row between">
        <div>
          <h1 style={{ margin: 0, fontSize: 30 }}>Admin dashboard</h1>
          <div className="row" style={{ gap: 6, marginTop: 2 }}>
            <span className="muted" style={{ fontSize: 14 }}>Event:</span>
            {(events.data?.length ?? 0) > 1 ? (
              <select className="input" style={{ width: 'auto', minHeight: 36, fontSize: 14, padding: '0 10px' }} value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Event">
                {events.data!.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            ) : <span className="muted" style={{ fontSize: 14 }}>{ev?.name ?? 'none yet'}</span>}
          </div>
        </div>
        <Link to={eventId ? `/admin/lists?new=${eventId}` : '/admin/lists'} className="btn primary" style={{ borderRadius: 12 }}>Create list</Link>
      </div>
      {err && <Alert>{errMsg(err)}</Alert>}

      {openRow && (
        <section className="card live row between" style={{ padding: 22, gap: 18 }} aria-label="Open list">
          <div className="stack" style={{ gap: 8, minWidth: 240 }}>
            <div className="openTag">Open now - live</div>
            <div style={{ fontFamily: 'var(--serif)', fontSize: 26, fontWeight: 600 }}>{openRow.title}</div>
            <div className="row" style={{ gap: 8 }}>
              {openRow.location_check && <span className="pill">Location check: {openRow.radius_m} m</span>}
              {openRow.rotating_qr && <span className="pill">Rotating QR: {openRow.rotation_seconds} s</span>}
              <span className="pill">{openAreas}</span>
            </div>
          </div>
          <div style={{ textAlign: 'center', padding: '0 12px' }}>
            <div className="bigcount">{open.data?.present_count ?? 0}</div>
            <div className="muted" style={{ fontSize: 13 }}>present</div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            {!openRow.rotating_qr && <QrDownloadButton listId={openRow.id} title={openRow.title} />}
            <Link to={`/venue/${openRow.id}`} className="btn">Venue screen</Link>
            <Link to={`/admin/lists/${openRow.id}`} className="btn">Manage</Link>
            <button className="btn danger" onClick={() => setClosing(openRow)}>Close list</button>
          </div>
        </section>
      )}

      <section className="grid c3" aria-label="Key figures">
        <div className="statcard"><div className="l">Present on open list</div><div className="v">{openRow ? open.data?.present_count ?? 0 : '–'}</div><div className="n">{openRow ? 'Updating live' : 'No list is open'}</div></div>
        <div className="statcard"><div className="l">People on record</div><div className="v">{peopleCount}</div><div className="n">Members and registrar entries</div></div>
        <div className="statcard"><div className="l">With accounts</div><div className="v">{withAcc}</div><div className="n">{Math.max(0, peopleCount - withAcc)} without a device yet</div></div>
        <div className="statcard"><div className="l">Lists in this event</div><div className="v">{evLists.length}</div><div className="n">{held} held, {evLists.length - held} to come</div></div>
      </section>

      <section className="row" style={{ alignItems: 'stretch', gap: 14 }} aria-label="Charts">
        <div className="card" style={{ flex: '3 1 340px', minWidth: 0 }}>
          <h2 style={H2}>Attendance across the event</h2>
          <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>People present per list; later lists not yet held</div>
          {evLists.length === 0 ? <div className="muted small">No lists yet.</div> : (
            <>
              <div className="vbars">
                {evLists.map((l) => {
                  const n = total(l.id); const done = l.status === 'open' || l.status === 'closed';
                  return (
                    <div className="col" key={l.id} title={`${l.title}: ${n}`}>
                      <div>{done ? n : '-'}</div>
                      <div className={`b ${l.status === 'open' ? 'cur' : done ? '' : 'todo'}`} style={{ height: done ? Math.max(4, Math.round((n / maxBar) * 130)) : 24 }} />
                    </div>
                  );
                })}
              </div>
              <div className="vlabels">{evLists.map((l, i) => <span key={l.id}>{shortLabel(l.title, i)}</span>)}</div>
            </>
          )}
        </div>
        <div className="card" style={{ flex: '2 1 280px', minWidth: 0 }}>
          <h2 style={H2}>Area participation</h2>
          <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>{focus ? `${focus.title}, people present` : 'No list yet'}</div>
          {Object.entries(focusBd?.areas ?? {}).sort((a, b) => b[1] - a[1]).map(([n, v]) => (
            <div className="hbar" key={n}><div className="t"><span>{n}</span><span>{v}</span></div><div className="track"><div className="fill" style={{ width: `${(v / areaMax) * 100}%` }} /></div></div>
          ))}
          {!Object.keys(focusBd?.areas ?? {}).length && <div className="muted small">No attendance yet.</div>}
        </div>
      </section>

      <section className="card stack" style={{ gap: 4 }} aria-label="Lists">
        <div className="row between" style={{ alignItems: 'baseline', marginBottom: 8 }}>
          <h2 style={{ ...H2, margin: 0 }}>Lists in this event</h2>
          {openRow && <span className="muted" style={{ fontSize: 13 }}>Only one list can be open at a time. Close {openRow.title} before opening another.</span>}
        </div>
        {evLists.map((l) => {
          const n = total(l.id);
          const canOpen = (l.status === 'draft' || l.status === 'closed') && !openRow;
          return (
            <div className="row between" key={l.id} style={{ padding: '12px 0', borderTop: '1px solid var(--border)', gap: 10 }}>
              <div className="row" style={{ gap: 12, minWidth: 180 }}>
                <span className={`chip ${l.status === 'open' ? 'open' : ''}`}>{chipLabel(l)}</span>
                <span style={{ fontSize: 15, fontWeight: 500 }}>{l.title}</span>
              </div>
              <span className="muted" style={{ fontSize: 14, minWidth: 90 }}>{n ? `${n} present` : 'No records'}</span>
              <div className="row" style={{ gap: 8 }}>
                {l.status === 'open' ? <button className="btn small danger" onClick={() => setClosing(l)}>Close list</button>
                  : l.status === 'closed' ? <>
                    <Link to={`/admin/lists/${l.id}`} className="btn small">View</Link>
                    <button className="btn small" disabled={!canOpen} style={canOpen ? undefined : { opacity: .5 }} onClick={() => setOpening(l)}>Re-open</button></>
                  : <button className="btn small" disabled={!canOpen} style={canOpen ? undefined : { opacity: .5 }} onClick={() => setOpening(l)}>Open list</button>}
                <button className="btn small" style={{ color: 'var(--muted)', fontWeight: 500 }} disabled={l.status === 'open'} onClick={() => setArchiving(l)}>Archive</button>
              </div>
            </div>
          );
        })}
        {!evLists.length && <div className="muted small">Create a list to get started.</div>}
      </section>

      <section className="card stack" style={{ gap: 4 }} aria-label="Recent activity">
        <div className="row between" style={{ alignItems: 'baseline', marginBottom: 8 }}>
          <h2 style={{ ...H2, margin: 0 }}>Recent activity</h2>
          <Link to="/admin/audit" style={{ fontSize: 14, fontWeight: 500 }}>View audit log</Link>
        </div>
        {(audit.data ?? []).slice(0, 4).map((r) => {
          const d = describeAudit(r);
          return (
            <div className="logrow" key={r.id}>
              <div style={{ flex: '1 1 320px', minWidth: 0 }}><b>{r.actor_name ?? 'Someone'}</b> {d.what}{d.why && <div className="muted" style={{ fontSize: 13 }}>{d.why}</div>}</div>
              <span className="muted" style={{ fontSize: 13 }}>{fmtWhen(r.at)}</span>
            </div>
          );
        })}
        {!audit.data?.length && <div className="muted small">Nothing recorded yet.</div>}
      </section>

      {closing && <ConfirmDialog title={`Close “${closing.title}”?`} danger confirmLabel="Close registration"
        body={<p>Nobody will be able to mark attendance for this list afterwards. You can re-open it later if needed.</p>}
        onClose={() => setClosing(null)} onConfirm={async () => { await api.closeList(closing.id); toast('Registration closed.'); reload(); }} />}
      {archiving && <ConfirmDialog title={`Archive “${archiving.title}”?`} confirmLabel="Archive"
        body={<p>The list moves out of the way (reviewers stop seeing it) but nothing is deleted. You can restore it any time from Events and lists.</p>}
        onClose={() => setArchiving(null)} onConfirm={async () => { await api.archiveList(archiving.id); toast('Archived.'); reload(); }} />}
      {opening && <ConfirmDialog title={`Open “${opening.title}”?`} confirmLabel="Open registration"
        body={<p>Members will be able to mark attendance straight away.</p>}
        onClose={() => setOpening(null)} onConfirm={async () => { await api.openListById(opening.id); toast('Registration is open.'); reload(); }} />}
    </div>
  );
}

function QrDownloadButton({ listId, title }: { listId: string; title: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  useEffect(() => {
    if (!url || !busy) return;
    ref.current?.querySelector('canvas')?.toBlob((b) => { if (b) download(b, `${safeName(title)}-QR.png`); setBusy(false); setUrl(null); });
  }, [url, busy, title]);
  return (
    <>
      <button className="btn" disabled={busy} onClick={async () => {
        setBusy(true);
        try { const q = await api.qr(listId); setUrl(scanUrl(q.list_id, q.token)); } catch (e) { toast(errMsg(e)); setBusy(false); }
      }}>Download QR</button>
      {url && <div ref={ref} style={{ position: 'fixed', left: -9999, top: 0 }}><QRCodeCanvas value={url} size={1024} marginSize={4} level="M" /></div>}
    </>
  );
}
