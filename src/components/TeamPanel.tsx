import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { errMsg } from '../lib/format';
import type { Account, Role, TeamMember } from '../lib/types';
import { Alert, ConfirmDialog, Modal, useToast } from './ui';

const LABEL: Record<string, string> = { manager: 'Event manager', list_manager: 'List manager', registrar: 'Registrar', reviewer: 'Reviewer' };
type Kind = 'event' | 'signup' | 'tracker';

/**
 * Who works on an event or a sign-up list: "Managed by" the event managers, then the registrars and
 * reviewers who were given it. Only an admin can change the team; managers just see it.
 */
export function TeamPanel({ kind, targetId, canEdit, lists }: { kind: Kind; targetId: string; canEdit: boolean; lists?: { id: string; title: string }[] }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['team', kind, targetId],
    queryFn: () => (kind === 'event' ? api.eventTeam(targetId) : kind === 'tracker' ? api.trackerTeam(targetId) : api.signupTeam(targetId)),
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
        {kind === 'tracker' && line('List managers', names('list_manager'), 'none chosen')}
        {line('Registrars', names('registrar'), 'none chosen')}
        {line('Reviewers', names('reviewer'), 'none chosen')}
      </div>
      {canEdit && <button className="btn small" onClick={() => setOpen(true)}>Manage team</button>}
      {open && <TeamDialog kind={kind} targetId={targetId} team={team} lists={lists} onClose={() => setOpen(false)} />}
    </div>
  );
}

function TeamDialog({ kind, targetId, team, lists, onClose }: { kind: Kind; targetId: string; team: TeamMember[]; lists?: { id: string; title: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts });
  const [pick, setPick] = useState('');
  const [where, setWhere] = useState('');   // tracker only: '' = the whole event, otherwise one list
  const noun = kind === 'event' ? 'event' : kind === 'tracker' ? 'tracker event' : 'sign-up list';
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = () => { void qc.invalidateQueries({ queryKey: ['team'] }); void qc.invalidateQueries({ queryKey: ['grants'] }); };
  // Reviewers do not work with sign-up lists; everyone else can be given an event or a sign-up list.
  const roles: Role[] = kind === 'event' ? ['manager', 'registrar', 'reviewer'] : kind === 'tracker' ? ['manager', 'list_manager', 'registrar', 'reviewer'] : ['manager', 'registrar'];
  const picked = (accounts.data ?? []).find((a) => a.id === pick);
  const inTeam = new Set(team.map((t) => t.account_id));
  const options = (accounts.data ?? []).filter((a: Account) => roles.includes(a.role) && !a.disabled && !inTeam.has(a.id))
    .sort((a, b) => (a.role === 'manager' ? -1 : 0) - (b.role === 'manager' ? -1 : 0) || (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? ''));
  const add = async () => {
    if (!pick || busy) return;
    setBusy(true);
    try {
      if (kind === 'tracker') await api.grantTracker(pick, where ? null : targetId, where || null);
      else await api.grant(pick, kind === 'event' ? targetId : null, null, kind === 'signup' ? targetId : null);
      setPick(''); setWhere(''); reload(); toast('Added to the team.');
    }
    catch (e) { toast(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Team" onClose={onClose}>
      <div className="stack">
        {team.length === 0 ? <Alert kind="info">Nobody has been given this {noun} yet.</Alert> : team.map((t) => (
          <div className="item" key={t.grant_id}>
            <div className="grow"><b>{t.name}</b><div className="muted small">{LABEL[t.role]}{t.level === 'list' ? ' · one list' : ''}{t.email ? ` · ${t.email}` : ''}{t.disabled ? ' · disabled' : ''}</div></div>
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
        {kind === 'tracker' && picked && picked.role !== 'manager' && lists && lists.length > 0 && (
          <label className="field"><span>Give them</span>
            <select className="input" value={where} onChange={(e) => setWhere(e.target.value)}>
              <option value="">The whole event (every list)</option>
              {lists.map((l) => <option key={l.id} value={l.id}>Only the list “{l.title}”</option>)}
            </select>
          </label>
        )}
        <span className="hint">Registrars and reviewers set to “All events and lists” already see everything, so they are not listed here. Create accounts and change their access type on the Accounts page.</span>
        <button className="btn ghost block" onClick={onClose}>Close</button>
      </div>
      {removing && (
        <ConfirmDialog title="Remove from the team?" danger confirmLabel="Remove"
          body={<p>{removing.name} will no longer see this {noun}. You can add them back at any time.</p>}
          onClose={() => setRemoving(null)}
          onConfirm={async () => { await api.revokeGrant(removing.grant_id); reload(); toast('Removed.'); }} />
      )}
    </Modal>
  );
}
