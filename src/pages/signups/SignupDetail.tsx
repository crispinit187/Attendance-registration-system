import { BackButton } from '../../components/BackButton';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { errMsg, fmtDateTime, initials } from '../../lib/format';
import type { PersonCard, ProfileInput, SignupDetailInfo, SignupEntry, SignupMatch } from '../../lib/types';
import { Alert, Badge, ConfirmDialog, Field, Icon, Loading, Modal, useToast } from '../../components/ui';
import { PersonForm } from '../../components/PersonForm';
import { StaffTop, useCanManage, useIsAdmin } from './common';
import { TeamPanel } from '../../components/TeamPanel';
import { PasteTab } from './PasteTab';
import { QrTab } from './QrTab';

type Tab = 'entries' | 'paste' | 'qr';

export function SignupDetail() {
  const { id = '' } = useParams();
  const isAdmin = useCanManage();   // admins and event managers
  const reallyAdmin = useIsAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('entries');
  const [act, setAct] = useState<boolean | null>(null);
  const q = useQuery({ queryKey: ['signup', id], queryFn: () => api.signupGet(id), refetchInterval: 15_000, retry: false });
  const list = q.data;
  const reload = () => { void qc.invalidateQueries({ queryKey: ['signup'] }); void qc.invalidateQueries({ queryKey: ['signup-lists'] }); };

  const wrap = (children: React.ReactNode) => (
    <div className={`page ${isAdmin ? 'wide' : ''} stack`} style={isAdmin ? undefined : { paddingTop: 32, gap: 20 }}><StaffTop />{children}</div>
  );
  if (q.isLoading) return wrap(<Loading />);
  if (q.error || !list) return wrap(<Alert>{errMsg(q.error ?? 'Sign-up list not found.')} <Link to="/signups">Back to sign-ups</Link></Alert>);

  const open = list.status === 'open';
  return wrap(
    <>
      <div className="row between">
        <div>
          <BackButton to="/signups">Sign-ups</BackButton>
          <h1 style={{ margin: '4px 0 0' }}>{list.title}</h1>
          <div className="muted small">Anyone with the QR code or link can sign up while sign-ups are open.</div>
        </div>
        <div style={{ textAlign: 'right' }}><div className="count">{list.entries}</div><div className="muted small">signed up</div></div>
      </div>

      {isAdmin && <TeamPanel kind="signup" targetId={list.id} canEdit={reallyAdmin} />}

      <div className={`statusbar ${open ? 'open' : ''}`}>
        <div className="row" style={{ gap: 10 }}>
          <span className={`statusline ${open ? 'ok' : 'warn'}`}>{open ? 'Sign-ups open' : 'Sign-ups closed'}</span>
          <span className="muted small">{open ? 'The QR code and link accept sign-ups.' : 'The QR code and link show a “closed” message.'}</span>
        </div>
        {isAdmin && (open
          ? <button className="btn danger" onClick={() => setAct(false)}>Close sign-ups</button>
          : <button className="btn primary" onClick={() => setAct(true)}>Open sign-ups</button>)}
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'entries'} className={tab === 'entries' ? 'on' : ''} onClick={() => setTab('entries')}>Entries</button>
        <button role="tab" aria-selected={tab === 'paste'} className={tab === 'paste' ? 'on' : ''} onClick={() => setTab('paste')}>Paste a list</button>
        <button role="tab" aria-selected={tab === 'qr'} className={tab === 'qr' ? 'on' : ''} onClick={() => setTab('qr')}>{isAdmin ? 'QR and settings' : 'QR and link'}</button>
      </div>

      {tab === 'entries' && <EntriesTab list={list} isAdmin={isAdmin} reallyAdmin={reallyAdmin} />}
      {tab === 'paste' && <PasteTab list={list} />}
      {tab === 'qr' && <QrTab list={list} isAdmin={isAdmin} />}

      {act !== null && (
        <ConfirmDialog title={act ? `Open sign-ups for “${list.title}”?` : `Close sign-ups for “${list.title}”?`}
          danger={!act} confirmLabel={act ? 'Open sign-ups' : 'Close sign-ups'}
          body={<p>{act ? 'Anyone with the QR code or the link will be able to sign up straight away.'
            : 'Nobody will be able to sign up any more. The QR code and link show a “closed” message until you open it again. Staff can still add people.'}</p>}
          onClose={() => setAct(null)}
          onConfirm={async () => { await api.signupSetOpen(list.id, act); toast(act ? 'Sign-ups are open.' : 'Sign-ups are closed.'); reload(); }} />
      )}
    </>,
  );
}

const srcLabel = (e: SignupEntry) =>
  e.source === 'public' ? 'QR or link' : e.source === 'paste' ? `Pasted by ${e.added_by_name ?? 'staff'}` : `Added by ${e.added_by_name ?? 'staff'}`;

function EntriesTab({ list, isAdmin, reallyAdmin }: { list: SignupDetailInfo; isAdmin: boolean; reallyAdmin: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [withRemoved, setWithRemoved] = useState(false);
  const [fq, setFq] = useState('');
  const [fa, setFa] = useState('');
  const [fd, setFd] = useState('');
  const [fv, setFv] = useState('');
  const [editing, setEditing] = useState<SignupEntry | null>(null);
  const [removing, setRemoving] = useState<SignupEntry | null>(null);
  const [purging, setPurging] = useState<SignupEntry | null>(null);   // a removed entry the admin is deleting for good
  const [merging, setMerging] = useState<SignupEntry | null>(null);
  const [similar, setSimilar] = useState<{ entry: SignupEntry; matches: PersonCard[] } | null>(null);
  const [invite, setInvite] = useState<{ entry: SignupEntry; personId: string } | null>(null);
  const rowsQ = useQuery({ queryKey: ['signup-entries', list.id, withRemoved], queryFn: () => api.signupEntries(list.id, withRemoved), refetchInterval: 8_000 });
  const rows = rowsQ.data ?? [];
  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['signup-entries'] }); void qc.invalidateQueries({ queryKey: ['signup'] });
    void qc.invalidateQueries({ queryKey: ['signup-lists'] }); void qc.invalidateQueries({ queryKey: ['people'] });
  };
  const opts = useMemo(() => {
    const u = (f: (r: SignupEntry) => string | null) => [...new Set(rows.map(f).filter(Boolean) as string[])].sort();
    return { areas: u((r) => r.area), districts: u((r) => r.district), voices: u((r) => r.voice_part) };
  }, [rows]);
  const shown = rows.filter((r) =>
    (!fq || r.display_name.toLowerCase().includes(fq.toLowerCase())) && (!fa || r.area === fa) && (!fd || r.district === fd) && (!fv || r.voice_part === fv));
  const live = shown.filter((r) => !r.removed);

  const startAccount = async (e: SignupEntry) => {
    try {
      const r = await api.signupToPerson(e.id, false);
      if (r.status === 'similar') setSimilar({ entry: e, matches: r.matches });
      else { reload(); setInvite({ entry: e, personId: r.id }); }
    } catch (x) { toast(errMsg(x)); }
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Everyone who signed up</h3>
          <label className="check small"><input type="checkbox" checked={withRemoved} onChange={(e) => setWithRemoved(e.target.checked)} />Show removed</label>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <input className="input grow" style={{ minWidth: 160 }} placeholder="Search name…" value={fq} onChange={(e) => setFq(e.target.value)} />
          <select className="input" style={{ width: 'auto' }} value={fa} onChange={(e) => setFa(e.target.value)}><option value="">All areas</option>{opts.areas.map((a) => <option key={a}>{a}</option>)}</select>
          <select className="input" style={{ width: 'auto' }} value={fv} onChange={(e) => setFv(e.target.value)}><option value="">All voice parts</option>{opts.voices.map((a) => <option key={a}>{a}</option>)}</select>
          <select className="input" style={{ width: 'auto' }} value={fd} onChange={(e) => setFd(e.target.value)}><option value="">All districts</option>{opts.districts.map((a) => <option key={a}>{a}</option>)}</select>
        </div>
        {rowsQ.error && <Alert>{errMsg(rowsQ.error)}</Alert>}
        {rowsQ.isLoading ? <Loading /> : !shown.length ? (
          <p className="muted center" style={{ padding: 24 }}>{rows.length ? 'Nobody matches those filters.' : 'Nobody has signed up yet. Show the QR code, share the link, or paste a list.'}</p>
        ) : (
          <div className="table-wrap" style={{ maxHeight: '60dvh', overflowY: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>#</th><th>Name</th><th>Area</th><th>District</th><th>Voice</th>{isAdmin && <th>Contact</th>}<th>Signed up</th><th></th></tr></thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.id} className={r.removed ? 'removed' : ''}>
                    <td>{i + 1}</td>
                    <td>{r.display_name}{' '}
                      {r.forced && <Badge kind="warn">possible duplicate</Badge>}{' '}
                      {isAdmin && r.person_id && <Badge kind="accent">linked{r.person_name ? `: ${r.person_name}` : ''}</Badge>}
                      {r.removed && r.removed_reason && <div className="muted small" style={{ textDecoration: 'none' }}>Removed: {r.removed_reason}</div>}
                    </td>
                    <td>{r.area}</td><td>{r.district}</td><td>{r.voice_part}</td>
                    {isAdmin && <td>{r.contact}</td>}
                    <td>{fmtDateTime(r.created_at)}<div className="muted small">{srcLabel(r)}</div></td>
                    <td style={{ textDecoration: 'none' }}>
                      <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                        {!r.removed && r.can_edit && <button className="btn small" onClick={() => setEditing(r)}>Edit</button>}
                        {!r.removed && reallyAdmin && !r.person_id && <button className="btn small" onClick={() => void startAccount(r)}>Create account</button>}
                        {!r.removed && reallyAdmin && !r.person_id && <button className="btn small ghost" onClick={() => setMerging(r)}>Merge…</button>}
                        {!r.removed && r.can_edit && <button className="btn small danger" onClick={() => setRemoving(r)}>Remove</button>}
                        {r.removed && isAdmin && <button className="btn small" onClick={async () => { try { await api.signupRestore(r.id); toast('Restored.'); reload(); } catch (x) { toast(errMsg(x)); } }}>Restore</button>}
                        {r.removed && reallyAdmin && <button className="btn small danger" onClick={() => setPurging(r)}>Delete forever…</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {reallyAdmin && <p className="muted small" style={{ margin: '10px 0 0' }}>
          <b>Create account</b> adds the person to People and invites them to make an account. <b>Merge…</b> attaches the entry to someone who is already in People, for example after they made their own account.
        </p>}
      </div>

      {isAdmin && <SignupExport list={list} rows={live} filtered={Boolean(fq || fa || fd || fv)} />}

      {editing && <EditEntry entry={editing} list={list} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); toast('Saved.'); }} />}
      {removing && (
        <ConfirmDialog title={`Remove ${removing.display_name}?`} danger askReason confirmLabel="Remove"
          body={<p>They stop counting on this sign-up list. The removal and your reason are saved in the audit log{isAdmin ? ', and you can restore them later' : ''}.</p>}
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => { await api.signupRemove(removing.id, reason); toast('Removed.'); reload(); }} />
      )}
      {purging && (
        <ConfirmDialog title={`Delete ${purging.display_name} forever?`} danger confirmLabel="Delete forever"
          body={<p><b>This cannot be undone.</b> The entry is erased completely. The audit log notes that an entry was deleted from this list, but not who it was.</p>}
          onClose={() => setPurging(null)}
          onConfirm={async () => { await api.signupDeleteEntry(purging.id); toast('Entry deleted.'); reload(); }} />
      )}
      {merging && <MergeDialog entry={merging} onClose={() => setMerging(null)} onDone={() => { setMerging(null); reload(); toast('Attached.'); }} />}
      {similar && (
        <Modal title="Someone like this is already in People" onClose={() => setSimilar(null)}>
          <div className="stack">
            <p style={{ margin: 0 }}>Is <b>{similar.entry.display_name}</b> one of these people? Attaching the entry to an existing person keeps their records together.</p>
            {similar.matches.map((m) => (
              <div className="item" key={m.id}>
                <div className="avatar">{initials(m.display_name)}</div>
                <div className="grow"><b>{m.display_name}</b><div className="muted small">{[m.area, m.district].filter(Boolean).join(' · ')}{m.has_account ? ' · has an account' : ''}</div></div>
                <button className="btn small primary" onClick={async () => {
                  try {
                    await api.signupMergeInto(similar.entry.id, m.id); reload();
                    const e = similar.entry; setSimilar(null);
                    if (m.has_account) toast('Attached to the existing person.'); else setInvite({ entry: e, personId: m.id });
                  } catch (x) { toast(errMsg(x)); }
                }}>That is them</button>
              </div>
            ))}
            <button className="btn" onClick={async () => {
              try { const r = await api.signupToPerson(similar.entry.id, true); if (r.status === 'created') { const e = similar.entry; setSimilar(null); reload(); setInvite({ entry: e, personId: r.id }); } }
              catch (x) { toast(errMsg(x)); }
            }}>None of them: add as a new person</button>
          </div>
        </Modal>
      )}
      {invite && <InviteMember entry={invite.entry} personId={invite.personId} onClose={() => { setInvite(null); reload(); }} />}
    </div>
  );
}

function EditEntry({ entry, list, onClose, onSaved }: { entry: SignupEntry; list: SignupDetailInfo; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [pending, setPending] = useState<{ v: ProfileInput; status: string; matches: SignupMatch[] } | null>(null);
  const init: ProfileInput = {
    title_id: entry.title_id, title_specify: entry.title_specify ?? '', full_name: entry.full_name, area_id: entry.area_id,
    voice_part_id: entry.voice_part_id, district: entry.district ?? '', contact: entry.contact ?? '',
  };
  const save = async (v: ProfileInput, force: boolean) => {
    const r = await api.signupUpdate(entry.id, v, force);
    if (r.status === 'saved') onSaved(); else setPending({ v, status: r.status, matches: r.matches ?? [] });
  };
  return (
    <Modal title="Edit sign-up" onClose={onClose}>
      <PersonForm relaxed initial={init} submitLabel="Save" voiceIds={list.voice_part_ids} areaIds={list.allowed_area_ids} onSubmit={(v) => save(v, false)}
        extra={pending && (
          <div className="alert warn stack" style={{ gap: 8 }}>
            <b>{pending.status === 'already' ? 'This name is already on the list in the same district.' : 'A very similar name is already on this list.'}</b>
            {pending.matches.map((m) => <div key={m.id} className="small">{m.name}</div>)}
            <button type="button" className="btn small" onClick={() => void save(pending.v, true).catch((x) => toast(errMsg(x)))}>Save anyway, it is a different person</button>
          </div>
        )} />
    </Modal>
  );
}

function MergeDialog({ entry, onClose, onDone }: { entry: SignupEntry; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState(entry.full_name);
  const res = useQuery({ queryKey: ['merge-search', q], enabled: q.trim().length >= 2, queryFn: () => api.searchPeople(q.trim(), null) });
  return (
    <Modal title={`Attach ${entry.display_name} to a person`} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>Find the person in People. The sign-up entry is then linked to them, so their records stay together.</p>
        <input className="input" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        {res.isLoading && q.trim().length >= 2 ? <Loading /> : res.data?.length === 0 ? <div className="muted small">No one found. Try another spelling, or use Create account instead.</div> : null}
        {res.data?.map((p) => (
          <div className="item" key={p.id}>
            <div className="avatar">{initials(p.display_name)}</div>
            <div className="grow"><b>{p.display_name}</b><div className="muted small">{[p.area, p.district].filter(Boolean).join(' · ')}{p.has_account ? ' · has an account' : ''}</div></div>
            <button className="btn small primary" onClick={async () => { try { await api.signupMergeInto(entry.id, p.id); onDone(); } catch (x) { toast(errMsg(x)); } }}>Attach</button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function InviteMember({ entry, personId, onClose }: { entry: SignupEntry; personId: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr('Please enter a valid email address.');
    setBusy(true);
    try { await api.invite({ email: email.trim(), full_name: entry.full_name, role: 'member', person_id: personId }); setSent(true); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  if (sent) return (
    <Modal title="Invitation sent" onClose={onClose}>
      <div className="stack">
        <Alert kind="ok">We emailed {email.trim()} a link to accept the invitation and choose a password. Their sign-up is attached to their account.</Alert>
        <button className="btn primary block" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
  return (
    <Modal title="Create an account" onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <Alert kind="ok">{entry.display_name} is now in People and the sign-up is attached to them.</Alert>
        <Field label="Email for their account" hint="They get an email to confirm it and choose a password. You can also skip this and create the account later from Accounts.">
          <input className="input" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        {err && <Alert>{err}</Alert>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Sending…' : 'Send invitation'}</button>
        <button type="button" className="btn ghost block" onClick={onClose}>Not now</button>
      </form>
    </Modal>
  );
}

function SignupExport({ list, rows, filtered }: { list: SignupDetailInfo; rows: SignupEntry[]; filtered: boolean }) {
  const [contact, setContact] = useState(false);
  const [source, setSource] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const run = async (format: 'xlsx' | 'pdf') => {
    setErr(''); setBusy(format);
    try {
      const { exportSignups } = await import('../../lib/export');
      await api.logExport('signup', list.id, format, { rows: rows.length, contact, filtered });
      await exportSignups({ title: list.title }, rows, { includeContact: contact, includeSource: source }, format);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(''); }
  };
  return (
    <div className="card flat stack">
      <h3 style={{ margin: 0 }}>Export</h3>
      <p className="muted small" style={{ margin: 0 }}>{filtered ? 'Exports only the people currently shown by the filters.' : 'Exports everyone on this list.'} Each export is recorded in the audit log.</p>
      <label className="check"><input type="checkbox" checked={contact} onChange={(e) => setContact(e.target.checked)} />Include contact numbers</label>
      <label className="check"><input type="checkbox" checked={source} onChange={(e) => setSource(e.target.checked)} />Include how each person signed up</label>
      <div className="row">
        <button className="btn" disabled={!!busy || !rows.length} onClick={() => void run('xlsx')}>{busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}</button>
        <button className="btn" disabled={!!busy || !rows.length} onClick={() => void run('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</button>
      </div>
      {err && <Alert>{err}</Alert>}
    </div>
  );
}
