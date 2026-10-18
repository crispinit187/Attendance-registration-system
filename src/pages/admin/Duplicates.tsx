import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { errMsg } from '../../lib/format';
import type { DuplicatePair, DuplicateSide } from '../../lib/types';
import { Alert, Badge, ConfirmDialog, Loading, useToast } from '../../components/ui';

const FIELDS: [string, (s: DuplicateSide) => string | null][] = [
  ['Area', (s) => s.area], ['District', (s) => s.district], ['Congregation', (s) => s.congregation],
  ['Voice', (s) => s.voice_part], ['Phone', (s) => s.contact],
];

export function Duplicates() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['duplicates'], queryFn: api.duplicates, refetchInterval: 60_000 });
  const [ask, setAsk] = useState<{ keep: DuplicateSide; drop: DuplicateSide } | null>(null);
  const reload = () => { void qc.invalidateQueries({ queryKey: ['duplicates'] }); void qc.invalidateQueries({ queryKey: ['people'] }); };

  if (q.isLoading) return <div className="page wide"><Loading /></div>;
  const pairs = q.data ?? [];
  return (
    <div className="page wide stack">
      <Link to="/admin/people" className="small">← People</Link>
      <h1 style={{ margin: 0 }}>Possible duplicates</h1>
      <p className="muted" style={{ margin: 0 }}>People with a very similar name, or the same phone number. Nothing is joined automatically. Merging keeps one person: all attendance, tracker entries and ticks move to them, and any empty details are filled from the other.</p>
      {q.error && <Alert>{errMsg(q.error)}</Alert>}
      {!pairs.length && <div className="card hero muted">No possible duplicates right now.</div>}
      {pairs.map((p: DuplicatePair) => (
        <div className="card stack" key={p.a.person_id + p.b.person_id}>
          <div className="row between">
            <div className="row" style={{ gap: 6 }}>
              {p.same_contact && <Badge kind="warn">same phone number</Badge>}
              <Badge>{Math.round(p.similarity * 100)}% similar name</Badge>
            </div>
            <button className="btn small ghost" onClick={async () => { try { await api.dismissDuplicate(p.a.person_id, p.b.person_id); toast('Marked as different people.'); reload(); } catch (e) { toast(errMsg(e)); } }}>Not the same person</button>
          </div>
          <div className="grid c2">
            {[p.a, p.b].map((s, i) => {
              const other = i === 0 ? p.b : p.a;
              return (
                <div key={s.person_id} className="stack" style={{ gap: 6 }}>
                  <b>{s.display_name} {s.has_account && <Badge kind="accent">has an account</Badge>}</b>
                  {FIELDS.map(([label, get]) => (
                    <div className="small" key={label}><span className="muted">{label}: </span>{get(s) ?? <span className="muted">—</span>}
                      {get(s) && get(other) && get(s) !== get(other) ? <Badge kind="warn"> differs</Badge> : null}</div>
                  ))}
                  <button className="btn small primary" onClick={() => setAsk({ keep: s, drop: other })}>Keep this one</button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {ask && (
        <ConfirmDialog title="Merge these two people?" danger confirmLabel="Merge" onClose={() => setAsk(null)}
          body={<p>Everything of <b>{ask.drop.display_name}</b> (attendance, tracker entries and ticks, and any account) moves to <b>{ask.keep.display_name}</b>. Empty details are filled in from the other record. The other record is archived as a duplicate. This is logged.</p>}
          onConfirm={async () => { await api.mergePeople(ask.keep.person_id, ask.drop.person_id); toast('People merged.'); reload(); }} />
      )}
    </div>
  );
}
