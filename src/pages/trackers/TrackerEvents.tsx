import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { errMsg } from '../../lib/format';
import { fmtShort } from '../../lib/trackerStats';
import { Alert, Badge, Field, Icon, Loading, Modal, useToast } from '../../components/ui';

export function TrackerEvents() {
  const qc = useQueryClient();
  const { account } = useAuth();
  const isAdmin = account?.role === 'admin';
  const q = useQuery({ queryKey: ['tracker-overview'], queryFn: api.trackerOverview, refetchInterval: 30_000 });
  const [show, setShow] = useState(false);
  const [archived, setArchived] = useState(false);
  const toast = useToast();
  if (q.isLoading) return <div className="page wide"><Loading /></div>;

  const all = q.data ?? [];
  // Someone who works on exactly one list goes straight to it
  if (!isAdmin && all.length === 1 && all[0]!.lists.length === 1 && !all[0]!.can_edit && account?.role !== 'manager') {
    return <Navigate to={`/trackers/${all[0]!.id}/lists/${all[0]!.lists[0]!.id}`} replace />;
  }
  const events = all.filter((e) => archived || !e.archived_at);
  return (
    <div className="page wide stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Trackers</h1>
        <div className="row">
          {isAdmin && <label className="check small"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />Show archived</label>}
          {isAdmin && <button className="btn primary" onClick={() => setShow(true)}><Icon name="plus" size={16} />New tracker event</button>}
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>Events where you tick people against dates, with no sign-in needed by the people themselves. Open an event to see its lists.</p>
      {q.error && <Alert>{errMsg(q.error)}</Alert>}
      {!events.length && <div className="card hero muted">{isAdmin ? 'No tracker events yet. Create one (for example “Male Choir Practice”), then add its lists.' : 'No tracker event has been given to you yet. Ask an admin to assign you one.'}</div>}
      <div className="grid c2">
        {events.map((e) => {
          const people = e.lists.reduce((s, l) => s + l.people, 0);
          const last = e.lists.map((l) => l.last_date).filter(Boolean).sort().pop();
          return (
            <Link key={e.id} to={`/trackers/${e.id}`} className="card stack" style={{ textDecoration: 'none', color: 'inherit', gap: 6 }}>
              <h2 style={{ margin: 0 }}>{e.name} {e.archived_at && <Badge kind="warn">archived</Badge>}</h2>
              <div className="muted small">{e.lists.length} {e.lists.length === 1 ? 'list' : 'lists'} · {people} {people === 1 ? 'person' : 'people'}{last ? ` · last date ${fmtShort(last)}` : ''}</div>
              <div className="row" style={{ gap: 6 }}>{e.lists.slice(0, 6).map((l) => <Badge key={l.id}>{l.title}</Badge>)}</div>
            </Link>
          );
        })}
      </div>
      {show && <NewEvent onClose={() => setShow(false)} onDone={() => { void qc.invalidateQueries({ queryKey: ['tracker-overview'] }); toast('Tracker event created.'); }} />}
    </div>
  );
}

function NewEvent({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [lists, setLists] = useState('East, West, South, North');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="New tracker event" onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault(); setErr(''); setBusy(true);
        try {
          const id = await api.trackerCreateEvent(name.trim());
          for (const t of lists.split(',').map((x) => x.trim()).filter((x) => x.length >= 2)) await api.trackerSaveList(null, id, t, null);
          onDone(); onClose();
        } catch (x) { setErr(errMsg(x)); setBusy(false); }
      }}>
        <Field label="Event name"><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Male Choir Practice" /></Field>
        <Field label="Lists (optional)" hint="Separate with commas. You can add or change lists later."><input className="input" value={lists} onChange={(e) => setLists(e.target.value)} /></Field>
        {err && <Alert>{err}</Alert>}
        <button className="btn primary block" disabled={busy || name.trim().length < 2}>{busy ? 'Creating…' : 'Create event'}</button>
      </form>
    </Modal>
  );
}
