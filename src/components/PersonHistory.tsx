import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { errMsg, fmtDateTime } from '../lib/format';
import { fmtD } from '../lib/trackerStats';
import { Alert, Badge, Loading, Modal } from './ui';

/** Everything one person has attended, across events and trackers. */
export function PersonHistoryDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['person-history', id], queryFn: () => api.personHistory(id) });
  const att = q.data?.attendance.filter((a) => !a.removed) ?? [];
  return (
    <Modal title={`${name}: attendance`} onClose={onClose}>
      {q.isLoading ? <Loading /> : q.error || !q.data ? <Alert>{errMsg(q.error)}</Alert> : (
        <div className="stack">
          <h3 style={{ margin: 0, fontSize: 15 }}>Events and lists <span className="muted small">({att.length} attended)</span></h3>
          {q.data.attendance.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No event attendance yet.</p> : (
            <div className="stack" style={{ gap: 6, maxHeight: '28dvh', overflowY: 'auto' }}>
              {q.data.attendance.map((a) => (
                <div className="item" key={a.id} style={{ opacity: a.removed ? 0.55 : 1 }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{a.event}: {a.list}</div>
                    <div className="muted small">{fmtDateTime(a.marked_at)} · {a.method === 'self' ? 'scanned themselves' : 'marked by staff'}</div>
                  </div>
                  {a.removed && <Badge kind="warn">removed</Badge>}
                </div>
              ))}
            </div>
          )}
          <h3 style={{ margin: 0, fontSize: 15 }}>Trackers</h3>
          {q.data.trackers.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Not on any tracker list.</p> : q.data.trackers.map((t, i) => (
            <div key={i} className="stack" style={{ gap: 4 }}>
              <div className="row between" style={{ flexWrap: 'nowrap' }}>
                <b>{t.event}: {t.list}</b>
                <span className="muted small">{t.ticks} of {t.dates} dates{t.dates ? ` (${Math.round((t.ticks / t.dates) * 100)}%)` : ''}</span>
              </div>
              {t.marks.length > 0 && <div className="small muted">{t.marks.map((m) => fmtD(m.on_date)).join(' · ')}</div>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
