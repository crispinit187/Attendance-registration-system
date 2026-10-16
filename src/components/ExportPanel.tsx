import { useState } from 'react';
import type { AttendanceRow } from '../lib/types';
import { api } from '../lib/api';
import { errMsg } from '../lib/format';
import { Alert } from './ui';

/** Export buttons for one list. Every export is written to the audit log. */
export function ExportPanel({ listId, title, event, rows, canSeeContact = true, filtered = false }: {
  listId: string; title: string; event?: string; rows: AttendanceRow[]; canSeeContact?: boolean; filtered?: boolean;
}) {
  const [contact, setContact] = useState(false);
  const [method, setMethod] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const run = async (format: 'xlsx' | 'pdf') => {
    setErr(''); setBusy(format);
    try {
      const { exportList } = await import('../lib/export');
      await api.logExport('list', listId, format, { rows: rows.length, contact: contact && canSeeContact, filtered });
      await exportList({ title, event }, rows, { includeContact: contact && canSeeContact, includeMethod: method }, format);
    } catch (e) { setErr(errMsg(e)); }
    finally { setBusy(''); }
  };
  return (
    <div className="card flat stack">
      <h3>Export</h3>
      <p className="muted small" style={{ margin: 0 }}>
        {filtered ? 'Exports only the people currently shown by the filters.' : 'Exports everyone on this list.'} Each export is recorded in the audit log.
      </p>
      {canSeeContact && <label className="check"><input type="checkbox" checked={contact} onChange={(e) => setContact(e.target.checked)} />Include contact numbers</label>}
      <label className="check"><input type="checkbox" checked={method} onChange={(e) => setMethod(e.target.checked)} />Include who marked each person</label>
      <div className="row">
        <button className="btn" disabled={!!busy || !rows.length} onClick={() => run('xlsx')}>{busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}</button>
        <button className="btn" disabled={!!busy || !rows.length} onClick={() => run('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</button>
      </div>
      {err && <Alert>{err}</Alert>}
    </div>
  );
}

/** Cross-list export for one event: one row per person, one column per list. */
export function EventExportPanel({ eventId, eventName, lists, canSeeContact = true }: {
  eventId: string; eventName: string; lists: import('../lib/types').ListRow[]; canSeeContact?: boolean;
}) {
  const [contact, setContact] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const run = async (format: 'xlsx' | 'pdf') => {
    setErr(''); setBusy(format);
    try {
      const rows = await api.eventAttendance(lists.map((l) => l.id));
      const { exportEventGrid } = await import('../lib/export');
      await api.logExport('event', eventId, format, { lists: lists.length, rows: rows.length, contact: contact && canSeeContact });
      await exportEventGrid(eventName, lists, rows, { includeContact: contact && canSeeContact }, format);
    } catch (e) { setErr(errMsg(e)); }
    finally { setBusy(''); }
  };
  return (
    <div className="card flat stack">
      <h3>Whole event: {eventName}</h3>
      <p className="muted small" style={{ margin: 0 }}>One sheet with every person and a tick for each list they attended, plus totals. Recorded in the audit log.</p>
      {canSeeContact && <label className="check"><input type="checkbox" checked={contact} onChange={(e) => setContact(e.target.checked)} />Include contact numbers</label>}
      <div className="row">
        <button className="btn" disabled={!!busy || !lists.length} onClick={() => run('xlsx')}>{busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}</button>
        <button className="btn" disabled={!!busy || !lists.length} onClick={() => run('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</button>
      </div>
      {err && <Alert>{err}</Alert>}
    </div>
  );
}
