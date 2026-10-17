import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { errMsg, fmtTime } from '../../lib/format';
import type { PersonCard, ProfileInput } from '../../lib/types';
import { Alert, ConfirmDialog, Icon, Loading, useToast } from '../../components/ui';
import { PersonForm } from '../../components/PersonForm';
import { HeaderActions } from '../../components/Shell';

const H2 = { margin: 0, fontSize: 16, fontFamily: 'var(--font)', fontWeight: 600 } as const;

export function Registrar() {
  const { session, account } = useAuth();
  const me = session?.user.id;
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);

  const opens = useQuery({ queryKey: ['open-lists'], queryFn: api.openLists, refetchInterval: 15_000 });
  const signups = useQuery({ queryKey: ['signup-lists'], queryFn: api.signupLists, refetchInterval: 15_000 });
  const openSignups = (signups.data ?? []).filter((l) => l.status === 'open');
  const [pick, setPick] = useState<string | null>(null);
  // Several lists can be open. The registrar works on one at a time; this keeps the choice.
  const current = opens.data?.find((l) => l.id === pick) ?? opens.data?.[0] ?? null;
  const open = { data: current, isLoading: opens.isLoading, error: opens.error };
  const listId = current?.id ?? null;
  const present = useQuery({
    queryKey: ['present', listId, true], enabled: !!listId, refetchInterval: 8_000,
    queryFn: () => api.listPresent(listId!, true),
  });
  const results = useQuery({
    queryKey: ['search', dq, listId, present.dataUpdatedAt], enabled: dq.length >= 3 && !!listId,
    queryFn: () => api.searchPeople(dq, listId),
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['present'] }); void qc.invalidateQueries({ queryKey: ['search'] }); void qc.invalidateQueries({ queryKey: ['open-lists'] }); };

  const mark = async (p: PersonCard) => {
    try {
      const r = await api.markManual(listId!, p.id);
      toast(r.status === 'already' ? `${p.display_name} was already marked.` : `${p.display_name} marked present.`);
      refresh();
    } catch (e) { toast(errMsg(e)); }
  };

  const rows = present.data ?? [];
  const live = rows.filter((r) => !r.removed);
  const byId = new Map(live.map((r) => [r.person_id, r]));

  return (
    <div className="page stack" style={{ gap: 20, paddingTop: 32 }}>
      <div className="pageHead">
        <div><div className="muted" style={{ fontSize: 13 }}>Registrar</div><h1>{account?.full_name || account?.email}</h1></div>
        <HeaderActions />
      </div>

      {openSignups.map((s) => (
        <Link key={s.id} to={`/signups/${s.id}`} className="rowcard" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ minWidth: 0 }}>
            <div className="openTag">Sign-ups open</div>
            <div style={{ fontSize: 15, fontWeight: 500, marginTop: 4 }}>{s.title}</div>
            <div className="muted" style={{ fontSize: 13 }}>{s.entries} signed up · show the QR code or paste a list</div>
          </div>
          <span className="btn small">Open</span>
        </Link>
      ))}

      {(opens.data?.length ?? 0) > 1 && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="muted" style={{ fontSize: 13 }}>Several lists are open. Choose the one you are working on.</div>
          <div className="row" style={{ gap: 6 }}>
            {opens.data!.map((l) => (
              <button key={l.id} type="button" className={`btn small ${l.id === current?.id ? 'primary' : ''}`} onClick={() => setPick(l.id)}>{l.title}</button>
            ))}
          </div>
        </div>
      )}

      {open.isLoading ? <Loading /> : open.error ? <Alert>{errMsg(open.error)}</Alert> : !open.data ? (
        <div className="card stack" style={{ gap: 6 }}>
          <div className="openTag off">Not open</div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 600 }}>No attendance list is open for you right now</div>
          <div className="muted" style={{ fontSize: 14 }}>When an admin opens a list you have access to, it will appear here.</div>
        </div>
      ) : (
        <>
          <div className="card live stack" style={{ gap: 12, padding: '18px 20px' }}>
            <div className="row between" style={{ flexWrap: 'nowrap' }}>
              <div className="openTag">Open now</div>
              <div className="muted" style={{ fontSize: 14 }}><span style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 600, color: 'var(--text)' }}>{live.length}</span> present</div>
            </div>
            <div style={{ fontFamily: 'var(--serif)', fontSize: 22, lineHeight: 1.25, fontWeight: 600 }}>{open.data.title}</div>
            <Link to={`/venue/${open.data.id}`} className="btn" style={{ height: 48 }}><Icon name="tv" size={20} />Open venue screen</Link>
          </div>

          <div id="rg-mark" className="stack" style={{ gap: 12, scrollMarginTop: 12 }}>
            <h2 style={H2}>Find a person</h2>
            <label className="field"><span>Search by name</span>
              <input className="input" style={{ height: 50, background: 'var(--surface)' }} type="search" placeholder="Type at least three letters" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
            </label>
            {dq.length >= 3 && (results.isLoading ? <Loading /> : results.data?.length ? results.data.map((p) => {
              const att = byId.get(p.id);
              const recent = att && att.marked_by === me && Date.now() - new Date(att.marked_at).getTime() < 110_000;
              return (
                <div className="rowcard" key={p.id}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{p.display_name}</div>
                    <div className="muted" style={{ fontSize: 13 }}>{[p.area, p.district].filter(Boolean).join(' - ')}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{p.has_account ? 'Has an account' : 'No account yet'}</div>
                  </div>
                  {p.present ? (recent
                    ? <button className="btn accent-outline" style={{ minWidth: 104 }} onClick={async () => { try { await api.undo(att!.att_id); toast('Un-marked.'); refresh(); } catch (e) { toast(errMsg(e)); } }}>Undo</button>
                    : <button className="btn" style={{ minWidth: 104, color: 'var(--muted)' }} disabled>Present</button>)
                    : p.was_removed ? <button className="btn" style={{ minWidth: 104, color: 'var(--muted)' }} disabled>Removed</button>
                    : <button className="btn primary" style={{ minWidth: 104 }} onClick={() => mark(p)}>Mark present</button>}
                </div>
              );
            }) : <div className="muted" style={{ fontSize: 14 }}>No match. Check the spelling, or add them as a new person below.</div>)}
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>Marked by mistake? Tap Undo right away, no reason needed. Later, use Remove below. Search shows only name, area and district.</div>
          </div>

          <AddPerson id="rg-add" listId={open.data.id} onDone={refresh} />

          <div id="rg-present" className="stack" style={{ gap: 10, scrollMarginTop: 12 }}>
            <h2 style={H2}>Present on this list</h2>
            {present.isLoading ? <Loading /> : rows.length === 0 ? <div className="muted" style={{ fontSize: 14 }}>Nobody yet.</div> : rows.map((r) => (
              <div className="rowcard" key={r.att_id} style={{ padding: '12px 16px', opacity: r.removed ? .6 : 1 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, textDecoration: r.removed ? 'line-through' : 'none' }}>{r.display_name}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{fmtTime(r.marked_at)} - {r.removed ? `Removed: ${r.removed_reason ?? ''}` : r.method === 'self' ? 'Self-scan' : r.marked_by === me ? 'You' : r.marked_by_name ?? r.method}</div>
                </div>
                {r.removed
                  ? <button className="btn small" onClick={async () => { try { await api.restoreAtt(r.att_id); refresh(); } catch (e) { toast(errMsg(e)); } }}>Restore</button>
                  : <button className="btn small danger" style={{ minHeight: 44 }} onClick={() => setRemoving(r.att_id)}>Remove</button>}
              </div>
            ))}
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>Removing asks for a reason and is logged. A removed attendee can be restored.</div>
          </div>
        </>
      )}

      {removing && (
        <ConfirmDialog
          title="Remove this person from the list?" danger askReason confirmLabel="Remove"
          body={<p>They will no longer count as present. A reason is required, and the removal is recorded in the audit log. You can restore them later.</p>}
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => { await api.removeAtt(removing, reason); refresh(); toast('Removed.'); }}
        />
      )}
    </div>
  );
}

function AddPerson({ id, listId, onDone }: { id: string; listId: string; onDone: () => void }) {
  const toast = useToast();
  const [pending, setPending] = useState<{ values: ProfileInput; matches: PersonCard[] } | null>(null);
  const [formKey, setFormKey] = useState(0);

  const finish = async (pid: string) => {
    try { await api.markManual(listId, pid); toast('Added and marked present.'); } catch (e) { toast(`Added, but could not mark: ${errMsg(e)}`); }
    setPending(null); setFormKey((n) => n + 1); onDone();
  };
  const create = async (v: ProfileInput, force: boolean) => {
    const r = await api.createPerson(v, force);
    if (r.status === 'similar') { setPending({ values: v, matches: r.matches }); return; }
    await finish(r.id);
  };
  return (
    <div id={id} className="card stack" style={{ gap: 14, scrollMarginTop: 12 }}>
      <h2 style={H2}>Add a new person</h2>
      <PersonForm key={formKey} compact submitLabel="Add and mark present" onSubmit={(v) => create(v, false)} />
      {pending && (
        <div style={{ padding: '14px 16px', borderRadius: 12, border: '1px solid var(--accent)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Similar name found</div>
          {pending.matches.map((m) => (
            <div key={m.id} className="stack" style={{ gap: 8 }}>
              <div className="muted" style={{ fontSize: 14 }}>{m.display_name} - {[m.area, m.district].filter(Boolean).join(', ')}. Is this the same person?</div>
              <button className="btn primary" style={{ minHeight: 44 }} disabled={m.present} onClick={() => finish(m.id)}>{m.present ? 'Already present' : 'That is them'}</button>
            </div>
          ))}
          <button className="btn" style={{ minHeight: 44 }} onClick={async () => { try { await create(pending.values, true); } catch (e) { toast(errMsg(e)); } }}>Add as new</button>
        </div>
      )}
    </div>
  );
}
