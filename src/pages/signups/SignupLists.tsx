import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { errMsg, fmtDateTime } from '../../lib/format';
import type { SignupListRow } from '../../lib/types';
import { Alert, Badge, ConfirmDialog, Icon, Loading, useToast } from '../../components/ui';
import { SignupForm } from './SignupForm';
import { StaffTop, useCanManage } from './common';

export function SignupLists() {
  const isAdmin = useCanManage();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const lists = useQuery({ queryKey: ['signup-lists'], queryFn: api.signupLists, refetchInterval: 15_000 });
  const [creating, setCreating] = useState(false);
  const [act, setAct] = useState<{ open: boolean; list: SignupListRow } | null>(null);
  const reload = () => { void qc.invalidateQueries({ queryKey: ['signup-lists'] }); void qc.invalidateQueries({ queryKey: ['signup'] }); };

  return (
    <div className={`page ${isAdmin ? 'wide' : ''} stack`} style={isAdmin ? undefined : { paddingTop: 32, gap: 20 }}>
      <StaffTop />
      <div className="row between">
        <div>
          <h1 style={{ margin: 0 }}>Sign-ups</h1>
          <div className="muted small">People sign up by scanning a QR code or opening a shared link. No account is needed.</div>
        </div>
        {isAdmin && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />New sign-up list</button>}
      </div>
      {lists.error && <Alert>{errMsg(lists.error)}</Alert>}

      {lists.isLoading ? <Loading /> : !lists.data?.length ? (
        <div className="card hero muted">
          {isAdmin ? 'No sign-up lists yet. Create one, choose the voice parts, then open sign-ups and show the QR code.'
            : 'No sign-up list is open right now. Ask an admin to open one and it will appear here.'}
        </div>
      ) : (
        <div className="card">
          {lists.data.map((l) => (
            <div className="item" key={l.id}>
              <div className="grow">
                <Link to={`/signups/${l.id}`} style={{ fontWeight: 700, textDecoration: 'none' }}>{l.title}</Link>{' '}
                <Badge kind={l.status === 'open' ? 'ok' : ''}>{l.status === 'open' ? 'sign-ups open' : 'closed'}</Badge>
                <div className="muted small">{l.entries} {l.entries === 1 ? 'person' : 'people'} · {l.opened_at ? `Opened ${fmtDateTime(l.opened_at)}` : `Created ${fmtDateTime(l.created_at)}`}</div>
              </div>
              <div className="row">
                {isAdmin && (l.status === 'open'
                  ? <button className="btn small danger" onClick={() => setAct({ open: false, list: l })}>Close sign-ups</button>
                  : <button className="btn small primary" onClick={() => setAct({ open: true, list: l })}>Open sign-ups</button>)}
                <Link className="btn small" to={`/signups/${l.id}`}>Open</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && <SignupForm list={null} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); reload(); toast('Sign-up list created.'); nav(`/signups/${id}`); }} />}
      {act && (
        <ConfirmDialog title={act.open ? `Open sign-ups for “${act.list.title}”?` : `Close sign-ups for “${act.list.title}”?`}
          danger={!act.open} confirmLabel={act.open ? 'Open sign-ups' : 'Close sign-ups'}
          body={<p>{act.open
            ? 'Anyone with the QR code or the link will be able to sign up straight away.'
            : 'Nobody will be able to sign up any more. The QR code and link show a “closed” message until you open it again.'}</p>}
          onClose={() => setAct(null)}
          onConfirm={async () => { await api.signupSetOpen(act.list.id, act.open); toast(act.open ? 'Sign-ups are open.' : 'Sign-ups are closed.'); reload(); }} />
      )}
    </div>
  );
}
