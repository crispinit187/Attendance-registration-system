import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { errMsg, fmtDateTime } from '../../lib/format';
import { Alert, Loading } from '../../components/ui';

const nice = (a: string) => a.replace('.', ': ').replace(/_/g, ' ');
function summary(d: Record<string, unknown>) {
  return Object.entries(d).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`).join(' · ');
}

export function AuditLog() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => api.audit(500), refetchInterval: 30_000 });
  const [f, setF] = useState('');
  if (q.isLoading) return <div className="page wide"><Loading /></div>;
  const rows = (q.data ?? []).filter((r) => !f || `${r.action} ${r.actor_name} ${JSON.stringify(r.details)}`.toLowerCase().includes(f.toLowerCase()));
  return (
    <div className="page wide stack">
      <h1>Audit log</h1>
      <p className="muted">A permanent record of sensitive actions: removals, restores, deletions, exports, account changes. Nobody can edit or erase it. Showing the latest {q.data?.length ?? 0}.</p>
      {q.error && <Alert>{errMsg(q.error)}</Alert>}
      <input className="input" placeholder="Filter (e.g. export, remove, delete, a name)…" value={f} onChange={(e) => setF(e.target.value)} />
      <div className="table-wrap" style={{ maxHeight: '70dvh', overflowY: 'auto' }}>
        <table className="tbl">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.at)}</td><td>{r.actor_name ?? '—'}</td>
                <td><b>{nice(r.action)}</b></td>
                <td style={{ whiteSpace: 'normal', minWidth: 260 }} className="small muted">{summary(r.details)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="muted center">Nothing recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
