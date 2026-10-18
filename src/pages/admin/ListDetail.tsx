import { BackButton } from '../../components/BackButton';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeCanvas } from 'qrcode.react';
import { api } from '../../lib/api';
import { useLiveAttendance } from '../../lib/live';
import { scanUrl } from '../../lib/qrurl';
import { download, errMsg, initials, safeName } from '../../lib/format';
import type { AttendanceRow, PersonCard } from '../../lib/types';
import { useBase } from '../../lib/auth';
import { Alert, Badge, Bars, ConfirmDialog, Icon, Loading, useToast } from '../../components/ui';
import { AddPerson } from '../../components/AddPerson';
import { AttendanceTable, useRowFilter } from '../../components/AttendanceTable';
import { ExportPanel } from '../../components/ExportPanel';

export function ListDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const base = useBase();
  const [withRemoved, setWithRemoved] = useState(false);
  const [removing, setRemoving] = useState<AttendanceRow | null>(null);
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists, refetchInterval: 30_000 });
  const events = useQuery({ queryKey: ['events'], queryFn: api.events, refetchInterval: 30_000 });
  const list = lists.data?.find((l) => l.id === id);
  const ev = events.data?.find((e) => e.id === list?.event_id);
  useLiveAttendance([['rows', id]]);
  const rowsQ = useQuery({ queryKey: ['rows', id, withRemoved], queryFn: () => api.listAttendance(id, withRemoved), refetchInterval: 15_000 });
  const rows = rowsQ.data ?? [];
  const live = rows.filter((r) => !r.removed);
  const f = useRowFilter(rows);
  const reload = () => { void qc.invalidateQueries({ queryKey: ['rows'] }); };
  const stats = (k: 'area' | 'voice_part' | 'district') => {
    const m: Record<string, number> = {};
    for (const r of live) { const x = r.snapshot[k] ?? 'Unknown'; m[x] = (m[x] ?? 0) + 1; }
    return m;
  };

  if (lists.isLoading) return <div className="page wide"><Loading /></div>;
  if (!list) return <div className="page wide"><Alert>List not found. <Link to={`${base}/lists`}>Back to lists</Link></Alert></div>;

  return (
    <div className="page wide stack">
      <div className="row between">
        <div>
          <BackButton to={ev ? `${base}/events/${ev.id}` : `${base}/lists`}>{ev?.name ?? 'Events'}</BackButton>
          <h1 style={{ margin: '4px 0 0' }}>{list.title}</h1>
          <div className="muted">{ev?.name} <Badge kind={list.status === 'open' ? 'ok' : list.status === 'archived' ? 'warn' : ''}>{list.status}</Badge></div>
        </div>
        <div style={{ textAlign: 'right' }}><div className="count">{live.length}</div><div className="muted small">present</div></div>
      </div>

      {list.status === 'open' && <AdminMark listId={list.id} onDone={reload} />}
      {list.status === 'open' && <AddPerson id="add-person" listId={list.id} onDone={reload} />}

      <div className="grid c3">
        <div className="card"><h3>By area</h3><Bars data={stats('area')} /></div>
        <div className="card"><h3>By voice part</h3><Bars data={stats('voice_part')} /></div>
        <div className="card"><h3>By district</h3><Bars data={stats('district')} /></div>
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Attendance</h3>
          <label className="check small"><input type="checkbox" checked={withRemoved} onChange={(e) => setWithRemoved(e.target.checked)} />Show removed people</label>
        </div>
        {f.ui}
        {rowsQ.isLoading ? <Loading /> : (
          <AttendanceTable rows={f.filtered} showContact showMethod
            onRemove={setRemoving}
            onRestore={async (r) => { try { await api.restoreAtt(r.id); toast('Restored.'); reload(); } catch (e) { toast(errMsg(e)); } }} />
        )}
      </div>

      <div className="grid c2">
        <ExportPanel listId={list.id} title={list.title} event={ev?.name} rows={f.filtered.filter((r) => !r.removed)} filtered={f.active} />
        <QrCard list={list} />
      </div>

      {removing && (
        <ConfirmDialog title={`Remove ${removing.snapshot.display_name}?`} danger askReason confirmLabel="Remove from list"
          body={<p>They will stop counting as present on this list. The removal and your reason are saved in the audit log, and you can restore them later.</p>}
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => { await api.removeAtt(removing.id, reason); toast('Removed.'); reload(); }} />
      )}
    </div>
  );
}

function AdminMark({ listId, onDone }: { listId: string; onDone: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const res = useQuery({ queryKey: ['admin-search', q, listId], enabled: q.trim().length >= 2, queryFn: () => api.searchPeople(q.trim(), listId) });
  const mark = async (p: PersonCard) => {
    try { await api.markManual(listId, p.id); toast(`${p.display_name} marked present.`); onDone(); void res.refetch(); }
    catch (e) { toast(errMsg(e)); }
  };
  return (
    <div className="card stack">
      <h3 style={{ margin: 0 }}>Mark someone present</h3>
      <input className="input" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
      {res.data?.map((p) => (
        <div className="item" key={p.id}>
          <div className="avatar">{initials(p.display_name)}</div>
          <div className="grow"><b>{p.display_name}</b><div className="muted small">{[p.area, p.district].filter(Boolean).join(' · ')}</div></div>
          {p.present ? <Badge kind="ok">Present</Badge> : <button className="btn small primary" onClick={() => mark(p)}>{p.was_removed ? 'Restore & mark' : 'Mark present'}</button>}
        </div>
      ))}
    </div>
  );
}

function QrCard({ list }: { list: { id: string; title: string; rotating_qr: boolean; status: string; location_check?: boolean } }) {
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const q = useQuery({
    queryKey: ['qr', list.id], enabled: !list.rotating_qr, staleTime: Infinity,
    queryFn: () => api.qr(list.id),
  });
  const save = () => {
    const c = ref.current?.querySelector('canvas');
    c?.toBlob((b) => { if (b) download(b, `${safeName(list.title)}-QR.png`); });
  };
  return (
    <div className="card flat stack">
      <h3>QR code</h3>
      {list.rotating_qr ? (
        <>
          <p className="muted small" style={{ margin: 0 }}>This list uses a rotating code, so there is nothing to print. Show it live on a projector or tablet while the list is open.</p>
          {list.status === 'open'
            ? <Link to={`/venue/${list.id}`} className="btn"><Icon name="tv" size={16} />Open venue screen</Link>
            : <Alert kind="info">The venue screen works while the list is open.</Alert>}
        </>
      ) : q.isLoading ? <Loading /> : q.data ? (
        <>
          <div ref={ref} className="qrbox" style={{ alignSelf: 'flex-start' }}><QRCodeCanvas value={scanUrl(q.data.list_id, q.data.token)} size={220} marginSize={2} level="M" /></div>
          <div className="row">
            <button className="btn" onClick={save}><Icon name="down" size={16} />Download QR (PNG)</button>
            <Link to={`/venue/${list.id}`} className="btn ghost"><Icon name="tv" size={16} />Full screen</Link>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <b className="small">Link, for when the projector or power is down</b>
            <div className="linkbox">
              <input className="input" readOnly value={scanUrl(q.data.list_id, q.data.token)} onFocus={(e) => e.currentTarget.select()} aria-label="Attendance link" />
              <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(scanUrl(q.data!.list_id, q.data!.token)); toast('Link copied.'); } catch { toast('Could not copy. Select the link and copy it by hand.'); } }}><Icon name="copy" size={16} />Copy</button>
            </div>
            <span className="hint">Works like the QR code: people still need to be signed in{list.location_check ? ', and the location check still applies' : ''}. It is only available while the list uses the printable (non-rotating) code.</span>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Anyone with this code can register while the list is open. It stops working when you close the list.</p>
        </>
      ) : q.error ? <Alert>{errMsg(q.error)}</Alert> : null}
    </div>
  );
}
