import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { errMsg } from '../lib/format';
import type { Account, Role, TeamMember } from '../lib/types';
import { Alert, ConfirmDialog, Modal, useToast } from './ui';

const LABEL: Record<string, string> = { manager: 'Event manager', registrar: 'Registrar', reviewer: 'Reviewer' };

/**
 * Who works on an event or a sign-up list: "Managed by" the event managers, then the registrars and
 * reviewers who were given it. Only an admin can change the team; managers just see it.
 */
export function TeamPanel({ kind, targetId, canEdit }: { kind: 'event' | 'signup'; targetId: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['team', kind, targetId],
    queryFn: () => (kind === 'event' ? api.eventTeam(targetId) : api.signupTeam(targetId)),
    refetchInterval: 30_000,
  });
  const team = q.data ?? [];
  const names = (role: Role) => team.filter((t) => t.role === role).map((t) => t.name + (t.disabled ? ' (disabled)' : ''));
  const line = (label: string, list: string[], none: string) => (
    <div className="small"><span className="muted">{label}: </span>{list.length ? <b>{list.join(', ')}</b> : <span className="muted">{none}</span>}</div>
  );
  return (
    <div className="teambox">
      <div className="grow stack" style={{ gap: 2 }}>
        {line('Managed by', names('manager'), 'no event manager yet')}
        {line('Registrars', names('registrar'), 'none chosen')}
        {line('Reviewers', names('reviewer'), 'none chosen')}
      </div>
      {canEdit && <button className="btn small" onClick={() => setOpen(true)}>Manage team</button>}
      {open && <TeamDialog kind={kind} targetId={targetId} team={team} onClose={() => setOpen(false)} />}
    </div>
  );
}

function TeamDialog({ kind, targetId, team, onClose }: { kind: 'event' | 'signup'; targetId: string; team: TeamMember[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts });
  const [pick, setPick] = useState('');
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = () => { void qc.invalidateQueries({ queryKey: ['team'] }); void qc.invalidateQueries({ queryKey: ['grants'] }); };
  // Reviewers do not work with sign-up lists; everyone else can be given an event or a sign-up list.
  const roles: Role[] = kind === 'event' ? ['manager', 'registrar', 'reviewer'] : ['manager', 'registrar'];
  const inTeam = new Set(team.map((t) => t.account_id));
  const options = (accounts.data ?? []).filter((a: Account) => roles.includes(a.role) && !a.disabled && !inTeam.has(a.id))
    .sort((a, b) => (a.role === 'manager' ? -1 : 0) - (b.role === 'manager' ? -1 : 0) || (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? ''));
  const add = async () => {
    if (!pick || busy) return;
    setBusy(true);
    try { await api.grant(pick, kind === 'event' ? targetId : null, null, kind === 'signup' ? targetId : null); setPick(''); reload(); toast('Added to the team.'); }
    catch (e) { toast(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Team" onClose={onClose}>
      <div className="stack">
        {team.length === 0 ? <Alert kind="info">Nobody has been given this {kind === 'event' ? 'event' : 'sign-up list'} yet.</Alert> : team.map((t) => (
          <div className="item" key={t.grant_id}>
            <div className="grow"><b>{t.name}</b><div className="muted small">{LABEL[t.role]}{t.email ? ` · ${t.email}` : ''}{t.disabled ? ' · disabled' : ''}</div></div>
            <button className="btn small danger" onClick={() => setRemoving(t)}>Remove</button>
          </div>
        ))}
        <label className="field"><span>Add someone</span>
          <div className="row">
            <select className="input grow" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose an account…</option>
              {options.map((a) => <option key={a.id} value={a.id}>{(a.full_name || a.email) ?? ''} ({LABEL[a.role]})</option>)}
            </select>
            <button className="btn primary" disabled={!pick || busy} onClick={() => void add()}>Add</button>
          </div>
        </label>
        <span className="hint">Registrars and reviewers set to “All events and lists” already see everything, so they are not listed here. Create accounts and change their access type on the Accounts page.</span>
        <button className="btn ghost block" onClick={onClose}>Close</button>
      </div>
      {removing && (
        <ConfirmDialog title="Remove from the team?" danger confirmLabel="Remove"
          body={<p>{removing.name} will no longer see this {kind === 'event' ? 'event' : 'sign-up list'}. You can add them back at any time.</p>}
          onClose={() => setRemoving(null)}
          onConfirm={async () => { await api.revokeGrant(removing.grant_id); reload(); toast('Removed.'); }} />
      )}
    </Modal>
  );
}
