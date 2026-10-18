import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth, useBase } from '../../lib/auth';
import { errMsg, fmtDateTime } from '../../lib/format';
import type { ListRow } from '../../lib/types';
import { Alert, Badge, Bars, ConfirmDialog, Icon, Loading, useToast } from '../../components/ui';
import { TeamPanel } from '../../components/TeamPanel';
import { EventExportPanel } from '../../components/ExportPanel';
import { ListForm, NameDialog, statusKind } from './Lists';

/** One attendance event: its lists, who manages it, and the analytics at the bottom. */
export function EventDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const base = useBase();
  const isAdmin = useAuth().account?.role === 'admin';
  const [sp, setSp] = useSearchParams();
  const events = useQuery({ queryKey: ['events'], queryFn: api.events, refetchInterval: 30_000 });
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists, refetchInterval: 30_000 });
  const [rename, setRename] = useState(false);
  const [evAct, setEvAct] = useState<'archive' | 'delete' | null>(null);
  const [form, setForm] = useState<{ list: ListRow | null } | null>(null);
  const [act, setAct] = useState<{ kind: 'open' | 'close' | 'archive' | 'delete'; list: ListRow } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const ev = events.data?.find((e) => e.id === id);
  const all = useMemo(() => (lists.data ?? []).filter((l) => l.event_id === id), [lists.data, id]);
  const ls = all.filter((l) => showArchived || l.status !== 'archived');
  const reload = () => { void qc.invalidateQueries({ queryKey: ['lists'] }); void qc.invalidateQueries({ queryKey: ['events'] }); void qc.invalidateQueries({ queryKey: ['open-lists'] }); void qc.invalidateQueries({ queryKey: ['event-breakdown'] }); };
  useEffect(() => { if (sp.get('new') && ev && !ev.archived_at) { setForm({ list: null }); setSp({}, { replace: true }); } }, [sp, ev]); // eslint-disable-line

  if (events.isLoading || lists.isLoading) return <div className="page wide"><Loading /></div>;
  if (!ev) return <div className="page wide"><Alert>Event not found. <Link to={`${base}/lists`}>Back to events</Link></Alert></div>;

  return (
    <div className="page wide stack">
      <div className="stack" style={{ gap: 4 }}>
        <Link to={`${base}/lists`} className="small">← Events</Link>
        <div className="row between">
          <h1 style={{ margin: 0 }}>{ev.name} {ev.archived_at && <Badge kind="warn">archived</Badge>}</h1>
          <div className="row">
            {isAdmin && <button className="btn small ghost" onClick={() => setRename(true)}>Rename</button>}
            {!ev.archived_at && <button className="btn small primary" onClick={() => setForm({ list: null })}><Icon name="plus" size={14} />Add list</button>}
            {isAdmin && !ev.archived_at && <button className="btn small" onClick={() => setEvAct('archive')}>Archive</button>}
            {isAdmin && ev.archived_at && (
              <>
                <button className="btn small" onClick={async () => { try { await api.unarchiveEvent(ev.id); toast('Event restored from the archive.'); reload(); } catch (e) { toast(errMsg(e)); } }}>Restore</button>
                <button className="btn small danger" onClick={() => setEvAct('delete')}>Delete…</button>
              </>
            )}
          </div>
        </div>
      </div>
      <TeamPanel kind="event" targetId={ev.id} canEdit={isAdmin} />

      <div className="row between">
        <h2 style={{ margin: 0 }}>Lists</h2>
        <label className="check small"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>
      </div>
      {ls.length === 0 && <p className="muted small" style={{ margin: 0 }}>No lists in this event yet.</p>}
      <div className="card stack" style={{ gap: 0 }}>
        {ls.map((l) => (
          <div className="item" key={l.id}>
            <div className="grow">
              <Link to={`${base}/lists/${l.id}`} style={{ fontWeight: 700, textDecoration: 'none' }}>{l.title}</Link>{' '}
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
              {l.status !== 'archived' && <button className="btn small" onClick={() => setForm({ list: l })}>Edit</button>}
              {(l.status === 'closed' || l.status === 'draft') && <button className="btn small" onClick={() => setAct({ kind: 'archive', list: l })}>Archive</button>}
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

      <EventAnalytics eventId={ev.id} eventName={ev.name} />
      {ls.length > 0 && <EventExportPanel eventId={ev.id} eventName={ev.name} lists={ls.filter((l) => l.status !== 'archived')} />}

      {rename && <NameDialog title="Rename event" label="Event name" initial={ev.name} cta="Save" onClose={() => setRename(false)}
        onSave={async (n) => { await api.renameEvent(ev.id, n); reload(); }} />}
      {form && <ListForm event={ev} list={form.list} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); toast('List saved.'); }} />}
      {act?.kind === 'open' && (
        <ConfirmDialog title={`Open “${act.list.title}”?`} confirmLabel="Open registration"
          body={<p>Members will be able to mark attendance straight away. Other lists that are already open stay open.</p>}
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
          body={<p><b>This cannot be undone.</b> The list and every attendance record in it will be permanently deleted. The deletion is written to the audit log.</p>}
          onClose={() => setAct(null)} onConfirm={async () => { await api.deleteList(act.list.id, act.list.title); toast('List deleted.'); reload(); }} />
      )}
      {evAct === 'archive' && (
        <ConfirmDialog title={`Archive “${ev.name}”?`} confirmLabel="Archive event"
          body={<p>The event is hidden from the Events page (tick “Show archived” to see it). Nothing is deleted, and you can restore it any time. An event with an open list cannot be archived.</p>}
          onClose={() => setEvAct(null)} onConfirm={async () => { await api.archiveEvent(ev.id); toast('Event archived.'); reload(); nav(`${base}/lists`); }} />
      )}
      {evAct === 'delete' && (
        <ConfirmDialog title="Delete this event and everything in it?" danger confirmLabel="Delete everything" typeToConfirm={ev.name}
          body={<Alert><b>Warning: this cannot be undone.</b> Deleting “{ev.name}” permanently deletes its <b>{all.length} list{all.length === 1 ? '' : 's'}</b> and <b>every attendance record</b> in {all.length === 1 ? 'it' : 'them'}, and any access given for it. Exports you already downloaded are not affected. The deletion is written to the audit log.</Alert>}
          onClose={() => setEvAct(null)} onConfirm={async () => { await api.deleteEvent(ev.id, ev.name); toast('Event deleted.'); reload(); nav(`${base}/lists`); }} />
      )}
    </div>
  );
}

/** Lighter analytics for an attendance event: counts per list and the area, voice and district mix. */
function EventAnalytics({ eventId, eventName }: { eventId: string; eventName: string }) {
  const q = useQuery({ queryKey: ['event-breakdown', eventId], queryFn: () => api.breakdown(eventId), refetchInterval: 30_000, placeholderData: (p) => p });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (q.isLoading) return <Loading />;
  const rows = q.data ?? [];
  if (!rows.length) return null;
  const sum = (pick: 'areas' | 'voices' | 'districts') => {
    const m: Record<string, number> = {};
    for (const b of rows) for (const [k, v] of Object.entries(b[pick])) m[k] = (m[k] ?? 0) + v;
    return m;
  };
  const total = rows.reduce((s, r) => s + r.total, 0);
  const lists: Record<string, number> = Object.fromEntries(rows.map((r) => [r.title, r.total]));
  return (
    <div className="stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Analytics</h2>
        <button className="btn small" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await api.logExport('event', eventId, 'pdf-report', {}); const x = await import('../../lib/trackerExport'); await x.attendanceReportPdf(eventName, rows); }
          catch (e) { toast(errMsg(e)); } finally { setBusy(false); }
        }}>{busy ? 'Preparing…' : 'PDF report'}</button>
      </div>
      <p className="headline" style={{ margin: 0 }}>{total} {total === 1 ? 'person was' : 'people were'} marked present across {rows.length} {rows.length === 1 ? 'list' : 'lists'}{rows.length > 1 ? `; the busiest was ${[...rows].sort((a, b) => b.total - a.total)[0]!.title}` : ''}.</p>
      <div className="grid c2">
        <div className="card flat"><h3>By list</h3><Bars data={lists} /></div>
        <div className="card flat"><h3>By area</h3><Bars data={sum('areas')} /></div>
        <div className="card flat"><h3>By voice part</h3><Bars data={sum('voices')} /></div>
        <div className="card flat"><h3>By district</h3><Bars data={sum('districts')} /></div>
      </div>
    </div>
  );
}
