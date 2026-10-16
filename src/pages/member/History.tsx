import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { errMsg, fmtLongDate } from '../../lib/format';
import { Alert, Icon, Loading } from '../../components/ui';

export function History() {
  const q = useQuery({ queryKey: ['my-history'], queryFn: api.myHistory });
  return (
    <div className="page stack" style={{ gap: 14, paddingTop: 32 }}>
      <h1 style={{ margin: 0, fontSize: 24 }}>My attendance</h1>
      {q.isLoading ? <Loading /> : q.error ? <Alert>{errMsg(q.error)}</Alert> : !q.data?.length ? (
        <div className="card center muted">Nothing yet. Your attendance will show up here.</div>
      ) : q.data.map((h) => (
        <div className="rowcard" key={h.id}>
          <div><div style={{ fontSize: 15, fontWeight: 500 }}>{h.list_title}</div><div className="muted" style={{ fontSize: 13 }}>{h.event_name} · {fmtLongDate(h.marked_at)}</div></div>
          <div className="present-ok"><Icon name="check" size={16} />Present</div>
        </div>
      ))}
    </div>
  );
}
