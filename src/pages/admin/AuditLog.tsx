import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { describeAudit } from '../../lib/audit';
import { errMsg, fmtDateTime } from '../../lib/format';
import { Alert, Field, Loading } from '../../components/ui';

const GROUPS: [string, string][] = [
  ['', 'Everything'], ['attendance', 'Attendance'], ['tracker', 'Trackers'], ['account', 'Accounts'], ['grant', 'Access'],
  ['list', 'Lists'], ['event', 'Events'], ['signup', 'Sign-ups'], ['person', 'People'], ['export', 'Exports'], ['late_mark', 'Late marks'], ['action', 'Undone actions'],
];

export function AuditLog() {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(300);
  useEffect(() => { const t = setTimeout(() => setDebounced(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  useEffect(() => { setLimit(300); }, [debounced, action, from, to]);

  const q = useQuery({
    queryKey: ['audit', 'search', debounced, action, from, to, limit],
    queryFn: () => api.auditSearch({ q: debounced, action, from, to, limit }),
    refetchInterval: 30_000, placeholderData: (p) => p,
  });
  const rows = q.data ?? [];
  const filtered = !!(debounced || action || from || to);
  return (
    <div className="page wide stack">
      <h1>Audit log</h1>
      <p className="muted">A permanent record of sensitive actions. Nobody can edit or erase it. Search by a name, an action or a word from the details.</p>
      {q.error && <Alert>{errMsg(q.error)}</Alert>}
      <div className="row" style={{ alignItems: 'end' }}>
        <div className="grow" style={{ minWidth: 220 }}><Field label="Search"><input className="input" placeholder="A name, export, remove, delete…" value={text} onChange={(e) => setText(e.target.value)} /></Field></div>
        <Field label="Type"><select className="input" value={action} onChange={(e) => setAction(e.target.value)}>{GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="From"><input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
        {filtered && <button className="btn ghost" onClick={() => { setText(''); setAction(''); setFrom(''); setTo(''); }}>Clear</button>}
      </div>
      {q.isLoading ? <Loading /> : (
        <>
          <div className="muted small">{rows.length} {rows.length === 1 ? 'entry' : 'entries'}{filtered ? ' match' : ''}{rows.length >= limit ? ' (showing the latest)' : ''}</div>
          <div className="table-wrap" style={{ maxHeight: '65dvh', overflowY: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>When</th><th>Who</th><th>What happened</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const d = describeAudit(r);
                  return (
                    <tr key={r.id}>
                      <td>{fmtDateTime(r.at)}</td><td>{r.actor_name ?? '—'}</td>
                      <td style={{ whiteSpace: 'normal', minWidth: 260 }}>{d.what}{d.why && <div className="small muted">{d.why}</div>}</td>
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={3} className="muted center">{filtered ? 'Nothing matches. Try fewer filters.' : 'Nothing recorded yet.'}</td></tr>}
              </tbody>
            </table>
          </div>
          {rows.length >= limit && limit < 1000 && <button className="btn block" onClick={() => setLimit((l) => Math.min(1000, l + 300))}>Show more</button>}
        </>
      )}
    </div>
  );
}
