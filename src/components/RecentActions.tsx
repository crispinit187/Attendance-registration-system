import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { errMsg, fmtDateTime } from '../lib/format';
import { Alert, Badge, Icon, Loading, Modal, useToast } from './ui';

/** The last things this person did, each with an Undo, for mistakes noticed a little later. */
export function RecentActionsButton({ className = 'iconbtn' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)} aria-label="My recent actions" title="My recent actions"><Icon name="clock" /></button>
      {open && <RecentActions onClose={() => setOpen(false)} />}
    </>
  );
}

function RecentActions({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['recent-actions'], queryFn: api.recentActions });
  const [busy, setBusy] = useState('');
  const undo = async (id: string) => {
    setBusy(id);
    try { await api.undoAction(id); toast('Undone.'); await q.refetch(); void qc.invalidateQueries(); }
    catch (e) { toast(errMsg(e)); }
    finally { setBusy(''); }
  };
  return (
    <Modal title="My recent actions" onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>What you did in the last few days. You can undo an action for up to 24 hours.</p>
        {q.isLoading ? <Loading /> : q.error ? <Alert>{errMsg(q.error)}</Alert> : !q.data?.length ? <p className="muted">Nothing yet.</p> : (
          <div className="stack" style={{ gap: 8, maxHeight: '55dvh', overflowY: 'auto' }}>
            {q.data.map((a) => (
              <div className="item" key={a.id} style={{ opacity: a.undone ? 0.55 : 1 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500, textDecoration: a.undone ? 'line-through' : 'none' }}>{a.label}</div>
                  <div className="muted small">{fmtDateTime(a.at)}</div>
                </div>
                {a.undone ? <Badge>undone</Badge> : a.can_undo ? <button className="btn small" disabled={!!busy} onClick={() => void undo(a.id)}>{busy === a.id ? '…' : 'Undo'}</button> : <span className="muted small">too old</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
