import { BackButton } from '../../components/BackButton';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { errMsg } from '../../lib/format';
import { DEFAULT_EXPECTED, fmtShort } from '../../lib/trackerStats';
import type { TrackerListSummary } from '../../lib/types';
import { Alert, Badge, ConfirmDialog, Field, Icon, Loading, Modal, useToast } from '../../components/ui';
import { TeamPanel } from '../../components/TeamPanel';
import { TrackerAnalytics } from '../../components/TrackerAnalytics';
import { ImportDialog } from './ImportDialog';

export function TrackerEventPage() {
  const { eventId = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { account } = useAuth();
  const role = account?.role ?? 'member';
  const isAdmin = role === 'admin';
  const q = useQuery({ queryKey: ['tracker-event', eventId], queryFn: () => api.trackerEvent(eventId), refetchInterval: 30_000 });
  const [form, setForm] = useState<{ list: TrackerListSummary | null } | null>(null);
  const [delList, setDelList] = useState<TrackerListSummary | null>(null);
  const [rename, setRename] = useState(false);
  const [delEvent, setDelEvent] = useState(false);
  const [imp, setImp] = useState(false);
  const [exp, setExp] = useState(false);
  const reload = () => { void qc.invalidateQueries({ queryKey: ['tracker-event', eventId] }); void qc.invalidateQueries({ queryKey: ['tracker-overview'] }); void qc.invalidateQueries({ queryKey: ['tracker-analytics'] }); };

  if (q.isLoading) return <div className="page wide"><Loading /></div>;
  if (q.error || !q.data) return <div className="page wide stack"><Alert>{errMsg(q.error)}</Alert><Link to="/trackers">← Trackers</Link></div>;
  const ev = q.data;
  const canEdit = ev.can_edit;
  if (!canEdit && !isAdmin && ev.lists.length === 1) return <Navigate to={`/trackers/${ev.id}/lists/${ev.lists[0]!.id}`} replace />;
  const canExport = role !== 'registrar';
  const canImportAll = isAdmin || role === 'manager';

  return (
    <div className="page wide stack">
      <div className="stack" style={{ gap: 4 }}>
        <BackButton to="/trackers">Trackers</BackButton>
        <div className="row between">
          <h1 style={{ margin: 0 }}>{ev.name} {ev.archived_at && <Badge kind="warn">archived</Badge>}</h1>
          <div className="row">
            {isAdmin && <button className="btn small ghost" onClick={() => setRename(true)}>Rename</button>}
            {isAdmin && !ev.archived_at && <button className="btn small" onClick={async () => { try { await api.trackerArchive(ev.id, true); toast('Archived.'); nav('/trackers'); reload(); } catch (e) { toast(errMsg(e)); } }}>Archive</button>}
            {isAdmin && ev.archived_at && (
              <>
                <button className="btn small" onClick={async () => { try { await api.trackerArchive(ev.id, false); toast('Restored.'); reload(); } catch (e) { toast(errMsg(e)); } }}>Restore</button>
                <button className="btn small danger" onClick={() => setDelEvent(true)}>Delete…</button>
              </>
            )}
          </div>
        </div>
      </div>
      {(isAdmin || canEdit || role === 'list_manager' || ev.lists.length > 0) && role !== 'registrar' && role !== 'reviewer' && (
        <TeamPanel kind="tracker" targetId={ev.id} canEdit={isAdmin} lists={ev.lists.map((l) => ({ id: l.id, title: l.title }))} />
      )}

      <div className="row between">
        <h2 style={{ margin: 0 }}>Lists</h2>
        <div className="row">
          {canImportAll && !ev.archived_at && ev.lists.length > 0 && <button className="btn small" onClick={() => setImp(true)}><Icon name="down" size={14} />Import to event</button>}
          {canExport && ev.lists.length > 0 && <button className="btn small" onClick={() => setExp(true)}>Export</button>}
          {canEdit && !ev.archived_at && <button className="btn small primary" onClick={() => setForm({ list: null })}><Icon name="plus" size={14} />Add list</button>}
        </div>
      </div>
      {!ev.lists.length && <div className="card hero muted">{canEdit ? 'No lists yet. Add one for each group (for example East, West, South and North).' : 'You have not been given any list in this event yet.'}</div>}
      <div className="grid c2">
        {ev.lists.map((l) => (
          <div className="card stack" key={l.id} style={{ gap: 8 }}>
            <div className="row between">
              <Link to={`/trackers/${ev.id}/lists/${l.id}`} style={{ fontWeight: 700, fontSize: '1.1rem', textDecoration: 'none' }}>{l.title}</Link>
              <Link to={`/trackers/${ev.id}/lists/${l.id}`} className="btn small primary">Open</Link>
            </div>
            <div className="muted small">
              {l.people} {l.people === 1 ? 'person' : 'people'} · {l.dates} {l.dates === 1 ? 'date' : 'dates'}
              {l.last_date ? ` · last ${fmtShort(l.last_date)}: ${l.present_last} present` : ''} · expected {l.expected ?? DEFAULT_EXPECTED}
            </div>
            {canEdit && !ev.archived_at && (
              <div className="row">
                <button className="btn small ghost" onClick={() => setForm({ list: l })}>Edit</button>
                <button className="btn small ghost" onClick={() => setDelList(l)}>Delete…</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {ev.lists.length > 0 && <TrackerAnalytics eventId={ev.id} />}

      {form && <ListForm eventId={ev.id} list={form.list} onClose={() => setForm(null)} onDone={() => { toast('Saved.'); reload(); }} />}
      {rename && <RenameDialog name={ev.name} onClose={() => setRename(false)} onSave={async (n) => { await api.trackerRenameEvent(ev.id, n); reload(); }} />}
      {delList && (
        <ConfirmDialog title="Delete this list for good?" danger confirmLabel="Delete forever" typeToConfirm={delList.title}
          body={<p><b>This cannot be undone.</b> The list <b>{delList.title}</b> and all of its dates and ticks are deleted ({delList.people} people are on it). The people stay in the People register. It is written to the audit log.</p>}
          onClose={() => setDelList(null)} onConfirm={async () => { await api.trackerDeleteList(delList.id, delList.title); toast('List deleted.'); reload(); }} />
      )}
      {delEvent && (
        <ConfirmDialog title="Delete this event and everything in it?" danger confirmLabel="Delete everything" typeToConfirm={ev.name}
          body={<p><b>This cannot be undone.</b> Its lists, dates and ticks are deleted, and any access given for it is removed. The people stay in the People register. Export first if you may need the data.</p>}
          onClose={() => setDelEvent(false)} onConfirm={async () => { await api.trackerDeleteEvent(ev.id, ev.name); toast('Event deleted.'); nav('/trackers'); reload(); }} />
      )}
      {imp && <ImportDialog eventId={ev.id} eventName={ev.name} dates={[]} onClose={() => setImp(false)} onDone={reload} />}
      {exp && <EventExport eventId={ev.id} eventName={ev.name} lists={ev.lists} canContact={role === 'admin' || role === 'manager' || role === 'list_manager'} onClose={() => setExp(false)} />}
    </div>
  );
}

function RenameDialog({ name, onSave, onClose }: { name: string; onSave: (n: string) => Promise<void>; onClose: () => void }) {
  const [v, setV] = useState(name);
  const [err, setErr] = useState('');
  return (
    <Modal title="Rename event" onClose={onClose}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { await onSave(v.trim()); onClose(); } catch (x) { setErr(errMsg(x)); } }}>
        <Field label="Event name"><input className="input" value={v} maxLength={80} onChange={(e) => setV(e.target.value)} autoFocus /></Field>
        {err && <Alert>{err}</Alert>}
        <button className="btn primary block" disabled={v.trim().length < 2}>Save</button>
      </form>
    </Modal>
  );
}

function ListForm({ eventId, list, onClose, onDone }: { eventId: string; list: TrackerListSummary | null; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(list?.title ?? '');
  const [exp, setExp] = useState(String(list?.expected ?? DEFAULT_EXPECTED));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={list ? 'Edit list' : 'Add a list'} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault(); setErr(''); setBusy(true);
        try { await api.trackerSaveList(list?.id ?? null, eventId, title.trim(), Number(exp) || DEFAULT_EXPECTED); onDone(); onClose(); }
        catch (x) { setErr(errMsg(x)); setBusy(false); }
      }}>
        <Field label="List name" hint="For example East, or Choir A."><input className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} autoFocus /></Field>
        <Field label="Expected attendance" hint="Used in the analytics to compare who came with who was expected."><input className="input" inputMode="numeric" value={exp} onChange={(e) => setExp(e.target.value.replace(/\D/g, ''))} /></Field>
        {err && <Alert>{err}</Alert>}
        <button className="btn primary block" disabled={busy || title.trim().length < 2}>{busy ? 'Saving…' : 'Save list'}</button>
      </form>
    </Modal>
  );
}

function EventExport({ eventId, eventName, lists, canContact, onClose }: { eventId: string; eventName: string; lists: TrackerListSummary[]; canContact: boolean; onClose: () => void }) {
  const [contact, setContact] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const run = async (kind: 'xlsx' | 'pdf' | 'report') => {
    setErr(''); setBusy(kind);
    try {
      const x = await import('../../lib/trackerExport');
      await api.logExport('tracker_event', eventId, kind === 'report' ? 'pdf-report' : kind, { lists: lists.length, contact: contact && canContact });
      if (kind === 'report') await x.trackerReportPdf(await api.trackerAnalytics(eventId, null, null));
      else { const grids = await Promise.all(lists.map((l) => api.trackerGrid(l.id))); await x.exportTrackerGrid(eventName, grids, contact && canContact, kind); }
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(''); }
  };
  return (
    <Modal title="Export the whole event" onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>Every list you can see, in one file. Each export is recorded in the audit log.</p>
        {canContact && <label className="check"><input type="checkbox" checked={contact} onChange={(e) => setContact(e.target.checked)} />Include phone numbers</label>}
        <button className="btn block" disabled={!!busy} onClick={() => void run('xlsx')}>{busy === 'xlsx' ? 'Preparing…' : 'Excel: names and ticks'}</button>
        <button className="btn block" disabled={!!busy} onClick={() => void run('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'PDF: names and ticks'}</button>
        <button className="btn block" disabled={!!busy} onClick={() => void run('report')}>{busy === 'report' ? 'Preparing…' : 'PDF report with analytics'}</button>
        {err && <Alert>{err}</Alert>}
      </div>
    </Modal>
  );
}
