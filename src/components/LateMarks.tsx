import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { errMsg, fmtDateTime } from '../lib/format';
import { Alert, useToast } from './ui';

/** Marks that were made without a connection, outside the time the list was open. An admin decides. */
export function LateMarks() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['late-marks'], queryFn: () => api.lateMarks('pending'), refetchInterval: 30_000 });
  const [busy, setBusy] = useState('');
  const rows = q.data ?? [];
  if (!rows.length) return null;
  const decide = async (id: string, ok: boolean) => {
    setBusy(id);
    try { await api.decideLate(id, ok); toast(ok ? 'Approved and recorded.' : 'Rejected.'); void qc.invalidateQueries(); }
    catch (e) { toast(errMsg(e)); }
    finally { setBusy(''); }
  };
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 16, fontFamily: 'var(--font)', fontWeight: 600 }}>Late marks waiting for you ({rows.length})</h2>
        <p className="muted small" style={{ margin: '2px 0 0' }}>A registrar marked these without a connection, and they were sent after the list had closed or before it opened.</p>
      </div>
      {q.error && <Alert>{errMsg(q.error)}</Alert>}
      {rows.map((m) => (
        <div className="item" key={m.id} style={{ flexWrap: "wrap" }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>{m.person} <span className="muted">on {m.list}</span></div>
            <div className="muted small">Marked {fmtDateTime(m.at)} by {m.submitted_by ?? 'a registrar'} · {m.event}</div>
            <div className="muted small">List was open {m.opened_at ? fmtDateTime(m.opened_at) : 'never'}{m.closed_at ? ` to ${fmtDateTime(m.closed_at)}` : ''}</div>
          </div>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <button className="btn small primary" disabled={!!busy} onClick={() => void decide(m.id, true)}>Approve</button>
            <button className="btn small danger" disabled={!!busy} onClick={() => void decide(m.id, false)}>Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}
