import { useState, type ReactNode } from 'react';
import type { RecentAction } from '../lib/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { errMsg, fmtDateTime } from '../lib/format';
import { Alert, Badge, Icon, Loading, Modal, useToast } from './ui';

/** The last things this person did, each with an Undo, for mistakes noticed a little later. */
export function RecentActionsButton({ className = 'iconbtn', children }: { className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)} aria-label="My recent actions" title="My recent actions"><Icon name="clock" />{children}</button>
      {open && <RecentActions onClose={() => setOpen(false)} />}
    </>
  );
}

function RecentActions({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['recent-actions'], queryFn: () => api.recentActions() });
  const [more, setMore] = useState<RecentAction[]>([]);
  const [done, setDone] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const rows = [...(q.data ?? []), ...more];
  const loadMore = async () => {
    const last = rows[rows.length - 1]; if (!last) return;
    setLoadingMore(true);
    try { const r = await api.recentActions(last.at); setMore((m) => [...m, ...r]); if (r.length < 40) setDone(true); }
    catch (e) { toast(errMsg(e)); }
    finally { setLoadingMore(false); }
  };
  const [busy, setBusy] = useState('');
  const undo = async (id: string) => {
    setBusy(id);
    try { await api.undoAction(id); toast('Undone.'); setMore([]); setDone(false); await q.refetch(); void qc.invalidateQueries(); }
    catch (e) { toast(errMsg(e)); }
    finally { setBusy(''); }
  };
  return (
    <Modal title="My recent actions" onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>What you did in the last 7 days. You can undo a tick, a person added, removed or restored, or a column opened or closed for up to 24 hours.</p>
        {q.isLoading ? <Loading /> : q.error ? <Alert>{errMsg(q.error)}</Alert> : !rows.length ? <p className="muted">Nothing yet.</p> : (
          <div className="stack" style={{ gap: 8, maxHeight: '55dvh', overflowY: 'auto' }}>
            {rows.map((a) => (
              <div className="item" key={a.id} style={{ opacity: a.undone ? 0.55 : 1 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500, textDecoration: a.undone ? 'line-through' : 'none' }}>{a.label}</div>
                  <div className="muted small">{fmtDateTime(a.at)}</div>
                </div>
                {a.undone ? <Badge>undone</Badge> : a.can_undo ? <button className="btn small" disabled={!!busy} onClick={() => void undo(a.id)}>{busy === a.id ? '…' : 'Undo'}</button> : <span className="muted small">too old</span>}
              </div>
            ))}
            {!done && rows.length >= 40 && <button className="btn block" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading…' : 'Load more'}</button>}
          </div>
        )}
      </div>
    </Modal>
  );
}
