import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Loading } from '../../components/ui';
import { EventExportPanel, ExportPanel } from '../../components/ExportPanel';

export function Exports() {
  const events = useQuery({ queryKey: ['events'], queryFn: api.events });
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists });
  const [eventId, setEventId] = useState('');
  const [listId, setListId] = useState('');
  useEffect(() => { if (!eventId && events.data?.length) setEventId(events.data[0]!.id); }, [events.data, eventId]);
  const els = (lists.data ?? []).filter((l) => l.event_id === eventId && l.status !== 'archived');
  useEffect(() => { if (!els.some((l) => l.id === listId)) setListId(els[0]?.id ?? ''); }, [eventId, lists.data]); // eslint-disable-line
  const ev = events.data?.find((e) => e.id === eventId);
  const list = els.find((l) => l.id === listId);
  const rows = useQuery({ queryKey: ['rows', listId, false], enabled: !!listId, queryFn: () => api.listAttendance(listId, false) });
  if (events.isLoading || lists.isLoading) return <div className="page wide"><Loading /></div>;
  return (
    <div className="page wide stack">
      <h1>Exports</h1>
      {!events.data?.length ? <div className="card muted center">No events yet.</div> : (
        <>
          <div className="row">
            <select className="input" style={{ width: 'auto' }} value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Event">{events.data.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            <select className="input" style={{ width: 'auto' }} value={listId} onChange={(e) => setListId(e.target.value)} aria-label="List">{els.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</select>
          </div>
          <div className="grid c2">
            {list && <ExportPanel listId={list.id} title={list.title} event={ev?.name} rows={rows.data ?? []} />}
            {ev && <EventExportPanel eventId={ev.id} eventName={ev.name} lists={els} />}
          </div>
        </>
      )}
    </div>
  );
}
