import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { errMsg, fmtDate } from '../../lib/format';
import type { Account } from '../../lib/types';
import { Alert, Badge, ConfirmDialog, Field, Icon, Loading, Modal, useToast } from '../../components/ui';

const ROLE_HELP: Record<string, string> = {
  member: 'Marks their own attendance by scanning.',
  registrar: 'Registers people at the venue, including people without phones or accounts.',
  reviewer: 'Sees reports and exports for the events or lists you give them.',
  admin: 'Full control.',
};

export function Accounts() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts });
  const people = useQuery({ queryKey: ['people'], queryFn: api.allPeople });
  const events = useQuery({ queryKey: ['events'], queryFn: api.events });
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists });
  const grants = useQuery({ queryKey: ['grants'], queryFn: api.grants });
  const [inviting, setInviting] = useState(false);
  const [filter, setFilter] = useState('');
  const [linking, setLinking] = useState<Account | null>(null);
  const [granting, setGranting] = useState<Account | null>(null);
  const [toggle, setToggle] = useState<Account | null>(null);
  const reload = () => { void qc.invalidateQueries({ queryKey: ['accounts'] }); void qc.invalidateQueries({ queryKey: ['grants'] }); };
  const pname = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.full_name])), [people.data]);
  const ename = useMemo(() => new Map((events.data ?? []).map((e) => [e.id, e.name])), [events.data]);
  const lname = useMemo(() => new Map((lists.data ?? []).map((l) => [l.id, l.title])), [lists.data]);

  if (accounts.isLoading) return <div className="page wide"><Loading /></div>;
  const rows = (accounts.data ?? []).filter((a) => !filter || `${a.email} ${a.full_name} ${a.role}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="page wide stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Accounts</h1>
        <button className="btn primary" onClick={() => setInviting(true)}><Icon name="plus" size={16} />Create account</button>
      </div>
      {accounts.error && <Alert>{errMsg(accounts.error)}</Alert>}
      <input className="input" placeholder="Search accounts…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Linked person</th><th>Since</th><th></th></tr></thead>
          <tbody>
            {rows.map((a) => {
              const mine = (grants.data ?? []).filter((g) => g.account_id === a.id);
              return (
                <tr key={a.id}>
                  <td><b>{a.full_name || '—'}</b> {a.disabled && <Badge kind="danger">disabled</Badge>}</td>
                  <td>{a.email}</td>
                  <td><Badge kind={a.role === 'admin' ? 'accent' : ''}>{a.role}</Badge>
                    {a.role === 'reviewer' && <div className="muted small" style={{ whiteSpace: 'normal' }}>
                      {mine.length ? mine.map((g) => (g.event_id ? `Event: ${ename.get(g.event_id)}` : `List: ${lname.get(g.list_id!)}`)).join(', ') : 'No access yet'}</div>}
                  </td>
                  <td>{a.person_id ? pname.get(a.person_id) ?? 'Linked' : <span className="muted">none</span>}</td>
                  <td>{fmtDate(a.created_at)}</td>
                  <td className="row" style={{ flexWrap: 'nowrap' }}>
                    {a.role === 'reviewer' && <button className="btn small" onClick={() => setGranting(a)}>Access…</button>}
                    {!a.person_id && a.role !== 'reviewer' && <button className="btn small ghost" onClick={() => setLinking(a)}>Link person…</button>}
                    {a.id !== session?.user.id && (
                      <button className={`btn small ${a.disabled ? '' : 'danger'}`} onClick={() => setToggle(a)}>{a.disabled ? 'Enable' : 'Disable'}</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {inviting && <InviteDialog onClose={() => setInviting(false)} onDone={() => { setInviting(false); reload(); void qc.invalidateQueries({ queryKey: ['people'] }); }} />}
      {toggle && <ConfirmDialog title={`${toggle.disabled ? 'Enable' : 'Disable'} ${toggle.full_name || toggle.email}?`} danger={!toggle.disabled}
        confirmLabel={toggle.disabled ? 'Enable account' : 'Disable account'}
        body={<p>{toggle.disabled ? 'They will be able to sign in again.' : 'They will not be able to use the app. Their attendance history stays.'}</p>}
        onClose={() => setToggle(null)} onConfirm={async () => { await api.setDisabled(toggle.id, !toggle.disabled); reload(); }} />}
      {linking && <LinkDialog account={linking} onClose={() => setLinking(null)} onDone={() => { setLinking(null); reload(); toast('Linked.'); }} />}
      {granting && <GrantDialog account={granting} onClose={() => setGranting(null)} onChanged={reload} />}
    </div>
  );
}

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('reviewer');
  const [personQ, setPersonQ] = useState('');
  const [person, setPerson] = useState<{ id: string; full_name: string } | null>(null);
  const people = useQuery({ queryKey: ['people'], queryFn: api.allPeople });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts });
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
    try { await api.invite({ email: email.trim(), full_name: name.trim(), role, person_id: person?.id ?? null }); setSent(true); }
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
            <option value="reviewer">Reviewer</option><option value="registrar">Registrar</option>
            <option value="member">Member (for someone you already registered)</option><option value="admin">Admin</option>
          </select>
        </Field>
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
  const people = useQuery({ queryKey: ['people'], queryFn: api.allPeople });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts });
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
  const events = useQuery({ queryKey: ['events'], queryFn: api.events });
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists });
  const grants = useQuery({ queryKey: ['grants'], queryFn: api.grants });
  const [ev, setEv] = useState('');
  const [li, setLi] = useState('');
  const [revoking, setRevoking] = useState<string | null>(null);   // the access grant being removed (asks first)
  const mine = (grants.data ?? []).filter((g) => g.account_id === account.id);
  const name = (g: (typeof mine)[number]) => (g.event_id ? `Whole event: ${events.data?.find((e) => e.id === g.event_id)?.name}` : `List: ${lists.data?.find((l) => l.id === g.list_id)?.title}`);
  const add = async (event: string | null, list: string | null) => {
    try { await api.grant(account.id, event, list); onChanged(); void grants.refetch(); setEv(''); setLi(''); } catch (e) { toast(errMsg(e)); }
  };
  return (
    <Modal title={`What can ${account.full_name || account.email} see?`} onClose={onClose}>
      <div className="stack">
        {mine.length === 0 ? <Alert kind="warn">No access yet. They will see nothing until you add some.</Alert> : mine.map((g) => (
          <div className="item" key={g.id}><div className="grow">{name(g)}</div>
            <button className="btn small danger" onClick={() => setRevoking(g.id)}>Remove</button></div>
        ))}
        <Field label="Give access to a whole event (all its lists, now and later)">
          <div className="row"><select className="input grow" value={ev} onChange={(e) => setEv(e.target.value)}><option value="">Choose event…</option>{events.data?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            <button className="btn" disabled={!ev} onClick={() => add(ev, null)}>Add</button></div>
        </Field>
        <Field label="Or to one list only">
          <div className="row"><select className="input grow" value={li} onChange={(e) => setLi(e.target.value)}><option value="">Choose list…</option>{lists.data?.filter((l) => l.status !== 'archived').map((l) => <option key={l.id} value={l.id}>{l.title} ({events.data?.find((e) => e.id === l.event_id)?.name})</option>)}</select>
            <button className="btn" disabled={!li} onClick={() => add(null, li)}>Add</button></div>
        </Field>
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
