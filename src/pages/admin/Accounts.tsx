import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { errMsg, fmtDate } from '../../lib/format';
import type { Account, AccountState, AccountStatus, Grant } from '../../lib/types';
import { ActionMenu } from '../../components/ActionMenu';
import { Alert, Badge, ConfirmDialog, Field, Icon, Loading, Modal, useToast } from '../../components/ui';

const ROLE_HELP: Record<string, string> = {
  member: 'Marks their own attendance by scanning.',
  registrar: 'Registers people at the venue, including people without phones or accounts.',
  reviewer: 'Sees reports and exports for the events or lists you give them.',
  manager: 'Runs the events and sign-up lists you give them: creates lists, opens and closes registration, marks attendance, sees contact numbers and exports. Cannot create events or use Accounts, Setup, Districts or the audit log.',
  list_manager: 'Runs the tracker lists you give them: adds the date columns, imports spreadsheets, ticks people, adds and removes people from the list and sees phone numbers. Cannot create events or lists.',
  admin: 'Full control.',
};

const ROLE_LABEL: Record<string, string> = { admin: 'admin', manager: 'event manager', list_manager: 'list manager', reviewer: 'reviewer', registrar: 'registrar', member: 'member' };

const STATE_LABEL: Record<AccountState, string> = { pending: 'Pending verification', setup: 'Verified, no details yet', active: 'Active', disabled: 'Disabled' };

/** Where an account is in its life: not verified yet, verified but not set up, or in use. */
function stateOf(a: Account, s: AccountStatus | undefined): AccountState {
  if (a.disabled) return 'disabled';
  if (s && !s.verified_at) return 'pending';
  if (a.role === 'member' && !a.person_id) return 'setup';
  return 'active';
}

export function Accounts() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts, refetchInterval: 30_000 });
  const people = useQuery({ queryKey: ['people'], queryFn: api.allPeople, refetchInterval: 30_000 });
  const events = useQuery({ queryKey: ['events'], queryFn: api.events, refetchInterval: 30_000 });
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists, refetchInterval: 30_000 });
  const tevents = useQuery({ queryKey: ['tracker-overview'], queryFn: api.trackerOverview, refetchInterval: 30_000 });
  const grants = useQuery({ queryKey: ['grants'], queryFn: api.grants });
  const [inviting, setInviting] = useState(false);
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<'active' | 'pending' | 'disabled'>('active');
  const [removing, setRemoving] = useState<Account | null>(null);
  const [verifying, setVerifying] = useState<Account | null>(null);
  const statuses = useQuery({ queryKey: ['account-statuses'], queryFn: api.accountStatuses, refetchInterval: 10_000 });
  const stMap = useMemo(() => new Map((statuses.data ?? []).map((s) => [s.id, s])), [statuses.data]);
  const [linking, setLinking] = useState<Account | null>(null);
  const [granting, setGranting] = useState<Account | null>(null);
  const [changing, setChanging] = useState<Account | null>(null);
  const [toggle, setToggle] = useState<Account | null>(null);
  const reload = () => { void qc.invalidateQueries({ queryKey: ['accounts'] }); void qc.invalidateQueries({ queryKey: ['account-statuses'] }); void qc.invalidateQueries({ queryKey: ['grants'] }); };
  const pname = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.full_name])), [people.data]);
  const ename = useMemo(() => new Map((events.data ?? []).map((e) => [e.id, e.name])), [events.data]);
  const signupLists = useQuery({ queryKey: ['signup-lists'], queryFn: api.signupLists, refetchInterval: 30_000 });
  const sname = useMemo(() => new Map((signupLists.data ?? []).map((l) => [l.id, l.title])), [signupLists.data]);
  const lname = useMemo(() => new Map((lists.data ?? []).map((l) => [l.id, l.title])), [lists.data]);
  const tename = useMemo(() => new Map((tevents.data ?? []).map((e) => [e.id, e.name])), [tevents.data]);
  const tlname = useMemo(() => new Map((tevents.data ?? []).flatMap((e) => e.lists.map((l) => [l.id, `${e.name}: ${l.title}`] as const))), [tevents.data]);

  if (accounts.isLoading) return <div className="page wide"><Loading /></div>;
  const all = accounts.data ?? [];
  const kind = (a: Account): 'active' | 'pending' | 'disabled' => (a.disabled ? 'disabled' : stateOf(a, stMap.get(a.id)) === 'pending' ? 'pending' : 'active');
  const count = { active: all.filter((a) => kind(a) === 'active').length, pending: all.filter((a) => kind(a) === 'pending').length, disabled: all.filter((a) => kind(a) === 'disabled').length };
  const rows = all.filter((a) => kind(a) === tab)
    .filter((a) => !filter || `${a.email} ${a.full_name} ${a.role}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="page wide stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Accounts</h1>
        <button className="btn primary" onClick={() => setInviting(true)}><Icon name="plus" size={16} />Create account</button>
      </div>
      {accounts.error && <Alert>{errMsg(accounts.error)}</Alert>}
      <div className="tabs" role="tablist" style={{ alignSelf: 'flex-start' }}>
        {([['active', 'Active'], ['pending', 'Pending'], ['disabled', 'Disabled']] as const).map(([k, l]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l} ({count[k]})</button>
        ))}
      </div>
      {tab === 'pending' && <div className="muted small">These people were invited but have not verified their email yet. Use the ⋯ menu to resend the invitation, verify by hand, or delete the account.</div>}
      {tab === 'disabled' && <div className="muted small">Disabled people cannot sign in. Enable an account to bring it back, or delete it for good. Their attendance history stays either way.</div>}
      <input className="input" placeholder="Search accounts…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Linked person</th><th>Since</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((a) => {
              const mine = (grants.data ?? []).filter((g) => g.account_id === a.id);
              return (
                <tr key={a.id}>
                  <td><b>{a.full_name || '—'}</b> {a.disabled && <Badge kind="danger">disabled</Badge>}</td>
                  <td>{a.email}</td>
                  <td><Badge kind={a.role === 'admin' ? 'accent' : ''}>{ROLE_LABEL[a.role] ?? a.role}</Badge>
                    {(a.role === 'reviewer' || a.role === 'registrar' || a.role === 'manager' || a.role === 'list_manager') && <div className="muted small" style={{ whiteSpace: 'normal' }}>
                      {a.access_scope === 'all' && a.role !== 'manager' && a.role !== 'list_manager' ? 'All events, lists and trackers'
                        : mine.length ? mine.map((g) => (g.event_id ? `Event: ${ename.get(g.event_id)}` : g.list_id ? `List: ${lname.get(g.list_id)}` : g.tracker_event_id ? `Tracker event: ${tename.get(g.tracker_event_id)}` : g.tracker_list_id ? `Tracker list: ${tlname.get(g.tracker_list_id)}` : `Sign-ups: ${sname.get(g.signup_list_id!)}`)).join(', ') : 'Selected only, none given yet'}</div>}
                  </td>
                  <td>{(() => {
                    const s = stMap.get(a.id); const k = stateOf(a, s);
                    return (
                      <>
                        <Badge kind={k === 'active' ? 'ok' : k === 'disabled' ? 'danger' : 'warn'}>{STATE_LABEL[k]}</Badge>
                        <div className="muted small" style={{ whiteSpace: 'normal' }}>
                          {k === 'pending' ? `Since ${fmtDate(s?.invited_at ?? a.created_at)}` : s?.last_sign_in_at ? `Last in ${fmtDate(s.last_sign_in_at)}` : s ? 'Never signed in' : ''}
                        </div>
                      </>
                    );
                  })()}</td>
                  <td>{a.person_id ? pname.get(a.person_id) ?? 'Linked' : <span className="muted">none</span>}</td>
                  <td>{fmtDate(a.created_at)}</td>
                  <td style={{ width: 56, textAlign: 'right' }}>
                    {(() => {
                      const k = stateOf(a, stMap.get(a.id));
                      const self = a.id === session?.user.id;
                      return (
                        <ActionMenu label={`Actions for ${a.full_name || a.email}`} items={[
                          { label: 'Access and permissions…', hint: a.access_scope === 'all' && a.role !== 'manager' && a.role !== 'list_manager' ? 'Has access to everything' : 'Only what you choose', hidden: !(a.role === 'registrar' || a.role === 'reviewer' || a.role === 'manager' || a.role === 'list_manager'), onClick: () => setGranting(a) },
                          { label: 'Change role…', hint: `Now ${ROLE_LABEL[a.role] ?? a.role}`, hidden: self, onClick: () => setChanging(a) },
                          { label: 'Link to a person…', hidden: !!a.person_id || a.role === 'reviewer' || a.role === 'manager' || a.role === 'list_manager', onClick: () => setLinking(a) },
                          { label: 'Verify now…', hint: 'Skip the email link', hidden: k !== 'pending', onClick: () => setVerifying(a) },
                          { label: 'Resend invite', hidden: !(k === 'pending' && a.must_set_password), onClick: async () => { try { await api.resendInvite(a.id); toast('Invitation sent again.'); } catch (e) { toast(errMsg(e)); } } },
                          { label: a.disabled ? 'Enable account' : 'Disable account', danger: !a.disabled, hidden: self, onClick: () => setToggle(a) },
                          { label: 'Delete account…', danger: true, hidden: self || !(a.disabled || k === 'pending'), onClick: () => setRemoving(a) },
                        ]} />
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>{filter ? 'No accounts match.' : tab === 'disabled' ? 'No disabled accounts.' : tab === 'pending' ? 'Nobody is waiting to verify.' : 'No active accounts yet.'}</td></tr>}
          </tbody>
        </table>
      </div>

      {inviting && <InviteDialog onClose={() => setInviting(false)} onDone={() => { setInviting(false); reload(); void qc.invalidateQueries({ queryKey: ['people'] }); }} />}
      {toggle && <ConfirmDialog title={`${toggle.disabled ? 'Enable' : 'Disable'} ${toggle.full_name || toggle.email}?`} danger={!toggle.disabled}
        confirmLabel={toggle.disabled ? 'Enable account' : 'Disable account'}
        body={<p>{toggle.disabled ? 'They will be able to sign in again.' : 'They will not be able to use the app. Their attendance history stays.'}</p>}
        onClose={() => setToggle(null)} onConfirm={async () => { await api.setDisabled(toggle.id, !toggle.disabled); reload(); }} />}
      {verifying && <ConfirmDialog title={`Verify ${verifying.full_name || verifying.email} by hand?`} confirmLabel="Verify now"
        body={<p>This skips the email link and marks the address as verified. Use it only when you are sure the address is theirs. If they were invited and have not chosen a password yet, they can use “Forgot password?” on the sign-in page. It is written to the audit log.</p>}
        onClose={() => setVerifying(null)}
        onConfirm={async () => { await api.verifyAccount(verifying.id); toast('Marked as verified.'); reload(); }} />}
      {removing && <ConfirmDialog title={`Delete ${removing.full_name || removing.email} for good?`} danger confirmLabel="Delete account" typeToConfirm={removing.email ?? ''}
        body={<p><b>This cannot be undone.</b> Their sign-in and any reviewer access are removed, and the email can be invited again later. Their attendance history and the linked person record stay. The deletion is written to the audit log.</p>}
        onClose={() => setRemoving(null)}
        onConfirm={async () => { await api.deleteAccount(removing.id); toast('Account deleted.'); reload(); void qc.invalidateQueries({ queryKey: ['people'] }); }} />}
      {linking && <LinkDialog account={linking} onClose={() => setLinking(null)} onDone={() => { setLinking(null); reload(); toast('Linked.'); }} />}
      {changing && <RoleDialog account={changing} grants={(grants.data ?? []).filter((g) => g.account_id === changing.id)} onClose={() => setChanging(null)} onChanged={reload} />}
      {granting && <GrantDialog account={granting} onClose={() => setGranting(null)} onChanged={reload} />}
    </div>
  );
}

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('reviewer');
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [personQ, setPersonQ] = useState('');
  const [person, setPerson] = useState<{ id: string; full_name: string } | null>(null);
  const people = useQuery({ queryKey: ['people'], queryFn: api.allPeople, refetchInterval: 30_000 });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts, refetchInterval: 30_000 });
  const taken = new Set((accounts.data ?? []).map((a) => a.person_id));
  const opts = (people.data ?? []).filter((p) => !p.archived && !taken.has(p.id) && personQ.length >= 2 && p.full_name.toLowerCase().includes(personQ.toLowerCase())).slice(0, 6);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr('Please enter a valid email address.');
    if (name.trim().length < 2) return setErr('Please enter their name.');
    setBusy(true);
    try { await api.invite({ email: email.trim(), full_name: name.trim(), role, person_id: person?.id ?? null, scope }); setSent(true); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  if (sent) return (
    <Modal title="Invitation sent" onClose={onDone}>
      <div className="stack">
        <Alert kind="ok">We emailed {email.trim()} a link to accept the invitation and choose a password.</Alert>
        <button className="btn primary block" onClick={onDone}>Done</button>
      </div>
    </Modal>
  );
  return (
    <Modal title="Create account" onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Role" hint={ROLE_HELP[role]}>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="manager">Event manager</option><option value="list_manager">List manager (trackers)</option><option value="reviewer">Reviewer</option><option value="registrar">Registrar</option>
            <option value="member">Member (for someone you already registered)</option><option value="admin">Admin</option>
          </select>
        </Field>
        {role === 'manager' && <Alert kind="info">An event manager works only with the events and sign-up lists you give them. After creating the account, choose them from the ⋯ menu on their row (Access and permissions), or from the event or sign-up list itself.</Alert>}
        {role === 'list_manager' && <Alert kind="info">A list manager works only with the tracker lists you give them. After creating the account, choose their lists from the ⋯ menu on their row (Access and permissions), or from the tracker event itself.</Alert>}
        {(role === 'reviewer' || role === 'registrar') && (
          <Field label="Access" hint={scope === 'selected' ? 'Choose their events and lists afterwards from the ⋯ menu on their row.' : 'Every event and list, including future ones.'}>
            <select className="input" value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'selected')}>
              <option value="all">All events and lists</option><option value="selected">Only what I select</option>
            </select>
          </Field>
        )}
        <Field label="Full name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
        <Field label="Email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        {(role === 'member') && (
          <div className="stack" style={{ gap: 6 }}>
            <Field label="Link to an existing person (optional)" hint="Their past attendance will then show in their history.">
              <input className="input" value={person ? person.full_name : personQ} onChange={(e) => { setPerson(null); setPersonQ(e.target.value); }} placeholder="Search by name…" />
            </Field>
            {!person && opts.map((p) => <button type="button" className="btn small" key={p.id} onClick={() => setPerson(p)}>{p.full_name}</button>)}
          </div>
        )}
        <p className="hint" style={{ margin: 0 }}>They get an email with a link and will choose their own password.</p>
        {err && <Alert>{err}</Alert>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Sending…' : 'Send invitation'}</button>
      </form>
    </Modal>
  );
}

function LinkDialog({ account, onClose, onDone }: { account: Account; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const toast = useToast();
  const people = useQuery({ queryKey: ['people'], queryFn: api.allPeople, refetchInterval: 30_000 });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts, refetchInterval: 30_000 });
  const taken = new Set((accounts.data ?? []).map((a) => a.person_id));
  const opts = (people.data ?? []).filter((p) => !p.archived && !taken.has(p.id) && q.length >= 2 && p.full_name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  return (
    <Modal title={`Link ${account.full_name || account.email} to a person`} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>Connects this login to a person you registered earlier, so their previous attendance appears in their history.</p>
        <Field label="Search people"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></Field>
        {opts.map((p) => <button key={p.id} className="btn block" style={{ justifyContent: 'flex-start' }}
          onClick={async () => { try { await api.linkAccount(account.id, p.id); onDone(); } catch (e) { toast(errMsg(e)); } }}>{p.full_name}</button>)}
      </div>
    </Modal>
  );
}

function GrantDialog({ account, onClose, onChanged }: { account: Account; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const events = useQuery({ queryKey: ['events'], queryFn: api.events, refetchInterval: 30_000 });
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists, refetchInterval: 30_000 });
  const signups = useQuery({ queryKey: ['signup-lists'], queryFn: api.signupLists, refetchInterval: 30_000 });
  const tevents = useQuery({ queryKey: ['tracker-overview'], queryFn: api.trackerOverview, refetchInterval: 30_000 });
  const grants = useQuery({ queryKey: ['grants'], queryFn: api.grants });
  const [tev, setTev] = useState('');
  const [tli, setTli] = useState('');
  const [scope, setScope] = useState<'all' | 'selected'>(account.access_scope);
  const [ev, setEv] = useState('');
  const [li, setLi] = useState('');
  const [sl, setSl] = useState('');
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);   // the access grant being removed (asks first)
  const isRegistrar = account.role === 'registrar';
  const isListMgr = account.role === 'list_manager';   // trackers only, always limited to what is selected
  const isManager = account.role === 'manager' || isListMgr;   // always limited to what is selected
  const hasSignups = (isRegistrar || account.role === 'manager');
  const attendance = !isListMgr;   // list managers only work with trackers
  const mine = (grants.data ?? []).filter((g) => g.account_id === account.id);
  const name = (g: (typeof mine)[number]) => (g.event_id ? `Whole event: ${events.data?.find((e) => e.id === g.event_id)?.name}`
    : g.list_id ? `List: ${lists.data?.find((l) => l.id === g.list_id)?.title}`
    : g.tracker_event_id ? `Whole tracker event: ${tevents.data?.find((e) => e.id === g.tracker_event_id)?.name}`
    : g.tracker_list_id ? `Tracker list: ${tevents.data?.flatMap((e) => e.lists.map((l) => ({ ...l, ev: e.name }))).find((l) => l.id === g.tracker_list_id)?.title}`
    : `Sign-up list: ${signups.data?.find((l) => l.id === g.signup_list_id)?.title}`);
  const addT = async (event: string | null, list: string | null) => {
    try { await api.grantTracker(account.id, event, list); onChanged(); void grants.refetch(); setTev(''); setTli(''); } catch (e) { toast(errMsg(e)); }
  };
  const add = async (event: string | null, list: string | null, signup: string | null) => {
    try { await api.grant(account.id, event, list, signup); onChanged(); void grants.refetch(); setEv(''); setLi(''); setSl(''); } catch (e) { toast(errMsg(e)); }
  };
  const change = async (next: 'all' | 'selected') => {
    if (next === scope || busy) return;
    setBusy(true);
    try { await api.setScope(account.id, next); setScope(next); onChanged(); toast(next === 'all' ? 'Now has access to everything.' : 'Now limited to the access you choose.'); }
    catch (e) { toast(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Access for ${account.full_name || account.email}`} onClose={onClose}>
      <div className="stack">
        {!isManager && <div className="stack" style={{ gap: 8 }}>
          <b className="small">What can this {account.role} work with?</b>
          <label className="check"><input type="radio" name="scope" checked={scope === 'all'} disabled={busy} onChange={() => void change('all')} />
            <span><b>All events, lists and trackers</b><br /><span className="hint">Everything, including future ones{isRegistrar ? ', and every sign-up list' : ''}.</span></span></label>
          <label className="check"><input type="radio" name="scope" checked={scope === 'selected'} disabled={busy} onChange={() => void change('selected')} />
            <span><b>Only what I select</b><br /><span className="hint">Just the events and lists you add below{hasSignups ? ' (sign-up lists too)' : ''}. You can add or remove them at any time.</span></span></label>
        </div>}

        {scope === 'all' && !isManager ? (
          <Alert kind="info">This {account.role} already has access to everything. Switch to “Only what I select” to limit them. The choices you add below are kept.</Alert>
        ) : (
          <>
            {mine.length === 0 ? <Alert kind="warn">No access yet. They will see nothing until you add some.</Alert> : mine.map((g) => (
              <div className="item" key={g.id}><div className="grow">{name(g)}</div>
                <button className="btn small danger" onClick={() => setRevoking(g.id)}>Remove</button></div>
            ))}
            {attendance && <Field label="Give access to a whole event (all its lists, now and later)">
              <div className="row"><select className="input grow" value={ev} onChange={(e) => setEv(e.target.value)}><option value="">Choose event…</option>{events.data?.filter((e) => !e.archived_at).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
                <button className="btn" disabled={!ev} onClick={() => add(ev, null, null)}>Add</button></div>
            </Field>}
            {attendance && !isManager && <Field label="Or to one list only">
              <div className="row"><select className="input grow" value={li} onChange={(e) => setLi(e.target.value)}><option value="">Choose list…</option>{lists.data?.filter((l) => l.status !== 'archived').map((l) => <option key={l.id} value={l.id}>{events.data?.find((e) => e.id === l.event_id)?.name}: {l.title}</option>)}</select>
                <button className="btn" disabled={!li} onClick={() => add(null, li, null)}>Add</button></div>
            </Field>}
            <Field label="Tracker events (all their lists, now and later)">
              <div className="row"><select className="input grow" value={tev} onChange={(e) => setTev(e.target.value)}><option value="">Choose tracker event…</option>{tevents.data?.filter((e) => !e.archived_at).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
                <button className="btn" disabled={!tev} onClick={() => addT(tev, null)}>Add</button></div>
            </Field>
            {account.role !== 'manager' && <Field label="Or one tracker list only">
              <div className="row"><select className="input grow" value={tli} onChange={(e) => setTli(e.target.value)}><option value="">Choose tracker list…</option>{tevents.data?.filter((e) => !e.archived_at).flatMap((e) => e.lists.map((l) => <option key={l.id} value={l.id}>{e.name}: {l.title}</option>))}</select>
                <button className="btn" disabled={!tli} onClick={() => addT(null, tli)}>Add</button></div>
            </Field>}
            {hasSignups && (
              <Field label="Sign-up lists">
                <div className="row"><select className="input grow" value={sl} onChange={(e) => setSl(e.target.value)}><option value="">Choose sign-up list…</option>{signups.data?.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</select>
                  <button className="btn" disabled={!sl} onClick={() => add(null, null, sl)}>Add</button></div>
              </Field>
            )}
          </>
        )}
        <button className="btn ghost block" onClick={onClose}>Close</button>
      </div>
      {revoking && (() => {
        const g = mine.find((x) => x.id === revoking);
        return (
          <ConfirmDialog title="Remove this access?" danger confirmLabel="Remove access"
            body={<p>{account.full_name || account.email} will no longer see {g ? name(g) : 'this'}. You can give it back at any time.</p>}
            onClose={() => setRevoking(null)}
            onConfirm={async () => { await api.revokeGrant(revoking); onChanged(); void grants.refetch(); toast('Access removed.'); }} />
        );
      })()}
    </Modal>
  );
}

/** Switch an account to another role. Explains what happens to its access before anything changes. */
function RoleDialog({ account, grants, onClose, onChanged }: { account: Account; grants: Grant[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const name = account.full_name || account.email || 'This account';
  const kept = (r: string) => grants.filter((g) => !(r === 'admin' || r === 'member' || (r === 'manager' && (g.list_id || g.tracker_list_id)) || (r === 'list_manager' && (g.event_id || g.list_id || g.signup_list_id)) || (r === 'reviewer' && g.signup_list_id)));
  const effect = (r: string) => {
    if (r === 'admin') return 'They get full control of the system. Any access they were given is cleared because admins do not need it.';
    if (r === 'member') return `They will only mark their own attendance by scanning. All access they were given is removed${grants.length ? ` (${grants.length} item${grants.length === 1 ? '' : 's'})` : ''}. If they have no personal details yet, they are asked for them next time they sign in.`;
    const lost = grants.length - kept(r).length;
    const base = r === 'manager' ? 'They work only with the events, sign-up lists and tracker events you give them.'
      : r === 'list_manager' ? 'They work only with the tracker lists you give them.'
      : r === 'reviewer' ? 'They see reports and exports for what you give them.' : 'They register people at the venue.';
    const keep = kept(r).length ? ` ${kept(r).length} access item${kept(r).length === 1 ? ' is' : 's are'} kept.` : '';
    const drop = lost ? ` ${lost} item${lost === 1 ? '' : 's'} the new role cannot use ${lost === 1 ? 'is' : 'are'} removed (${r === 'manager' ? 'single lists' : r === 'list_manager' ? 'attendance events, lists and sign-up lists' : 'sign-up lists'}).` : '';
    const scopeNote = r === 'manager' || r === 'list_manager' ? ' They always see only what you select.' : account.role === 'member' || account.role === 'admin' ? (r === 'reviewer' ? ' Reviewers start with only what you select, so choose their access next.' : ' Registrars start with access to everything; change that from Access and permissions if needed.') : '';
    return base + keep + drop + scopeNote;
  };
  const go = async () => {
    if (!role || busy) return;
    setBusy(true); setErr('');
    try { await api.changeRole(account.id, role); onChanged(); toast(`${name} is now ${ROLE_LABEL[role]}.`); onClose(); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <Modal title={`Change role for ${name}`} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>Now: <b>{ROLE_LABEL[account.role] ?? account.role}</b>. Their sign-in, history and details stay the same.</p>
        <Field label="New role">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Choose a role…</option>
            {['admin', 'manager', 'list_manager', 'reviewer', 'registrar', 'member'].filter((r) => r !== account.role).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]?.replace(/^./, (c) => c.toUpperCase())}</option>)}
          </select>
        </Field>
        {role && <Alert kind={role === 'admin' ? 'warn' : 'info'}>{effect(role)}</Alert>}
        {err && <Alert>{err}</Alert>}
        <button className={`btn block ${role === 'admin' ? 'danger' : 'primary'}`} disabled={!role || busy} onClick={() => void go()}>{busy ? 'Changing…' : 'Change role'}</button>
        <button className="btn ghost block" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
