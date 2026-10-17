import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { errMsg } from '../../lib/format';
import type { Person, PersonCard, ProfileInput } from '../../lib/types';
import { Alert, Badge, ConfirmDialog, Field, Icon, Loading, Modal, useToast } from '../../components/ui';
import { PersonForm, profileFromPerson } from '../../components/PersonForm';
import { useLookups } from '../../lib/auth';

export function People() {
  const qc = useQueryClient();
  const toast = useToast();
  const { areas, voices, titles } = useLookups();
  const people = useQuery({ queryKey: ['people'], queryFn: api.allPeople, refetchInterval: 30_000 });
  const groups = useQuery({ queryKey: ['district-groups'], queryFn: async () => (await supabase.from('district_groups').select('id,name')).data as { id: string; name: string }[] ?? [] });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts, refetchInterval: 30_000 });
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [edit, setEdit] = useState<Person | 'new' | null>(null);
  const [merge, setMerge] = useState<Person | null>(null);
  const [del, setDel] = useState<Person | null>(null);
  const [arch, setArch] = useState<Person | null>(null);
  const [similar, setSimilar] = useState<{ v: ProfileInput; matches: PersonCard[] } | null>(null);

  const gname = useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g.name])), [groups.data]);
  const aname = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);
  const vname = useMemo(() => new Map(voices.map((a) => [a.id, a.name])), [voices]);
  const tname = useMemo(() => new Map(titles.map((a) => [a.id, a.name])), [titles]);
  const statuses = useQuery({ queryKey: ['account-statuses'], queryFn: api.accountStatuses, refetchInterval: 10_000 });
  const accState = useMemo(() => {
    const st = new Map((statuses.data ?? []).map((s) => [s.id, s]));
    return new Map((accounts.data ?? []).filter((a) => a.person_id).map((a) => [a.person_id as string, a.disabled ? 'disabled' : st.has(a.id) && !st.get(a.id)!.verified_at ? 'pending' : 'active']));
  }, [accounts.data, statuses.data]);
  const hasAcc = useMemo(() => new Set((accounts.data ?? []).map((a) => a.person_id).filter(Boolean)), [accounts.data]);
  const shown = (people.data ?? []).filter((p) => (showArchived ? true : !p.archived) && !p.merged_into && (!q || p.full_name.toLowerCase().includes(q.toLowerCase())));
  const reload = () => { void qc.invalidateQueries({ queryKey: ['people'] }); void qc.invalidateQueries({ queryKey: ['district-groups'] }); };

  if (people.isLoading) return <div className="page wide"><Loading /></div>;
  return (
    <div className="page wide stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>People</h1>
        <button className="btn primary" onClick={() => setEdit('new')}><Icon name="plus" size={16} />New person</button>
      </div>
      {people.error && <Alert>{errMsg(people.error)}</Alert>}
      <div className="row">
        <input className="input grow" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check small"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>
      </div>
      <div className="table-wrap" style={{ maxHeight: '70dvh', overflowY: 'auto' }}>
        <table className="tbl">
          <thead><tr><th>Name</th><th>Area</th><th>District</th><th>Voice</th><th>Contact</th><th>Account</th><th></th></tr></thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id}>
                <td><b>{[p.title_id ? (p.title_specify ?? tname.get(p.title_id)) : '', p.full_name].filter(Boolean).join(' ')}</b> {p.archived && <Badge kind="warn">archived</Badge>}</td>
                <td>{p.area_id ? aname.get(p.area_id) : ''}</td>
                <td>{p.district_group_id ? gname.get(p.district_group_id) : ''}</td>
                <td>{p.voice_part_id ? vname.get(p.voice_part_id) : ''}</td>
                <td>{p.contact}</td>
                <td>{hasAcc.has(p.id)
                  ? <Badge kind={accState.get(p.id) === 'active' ? 'ok' : accState.get(p.id) === 'disabled' ? 'danger' : 'warn'}>{accState.get(p.id) === 'pending' ? 'pending' : accState.get(p.id) === 'disabled' ? 'disabled' : 'yes'}</Badge>
                  : <span className="muted">none</span>}</td>
                <td className="row" style={{ flexWrap: 'nowrap' }}>
                  <button className="btn small" onClick={() => setEdit(p)}>Edit</button>
                  <button className="btn small ghost" onClick={() => setMerge(p)}>Merge…</button>
                  {p.archived
                    ? <button className="btn small" onClick={async () => { try { await api.restorePerson(p.id); reload(); } catch (e) { toast(errMsg(e)); } }}>Restore</button>
                    : <button className="btn small ghost" onClick={() => setArch(p)}>Archive</button>}
                  <button className="btn small danger" onClick={() => setDel(p)}>Delete</button>
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={7} className="muted center">No one found.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title={edit === 'new' ? 'New person' : 'Edit person'} onClose={() => setEdit(null)}>
          <PersonForm
            initial={edit === 'new' ? undefined : profileFromPerson(edit, edit.district_group_id ? gname.get(edit.district_group_id) ?? '' : '')}
            submitLabel={edit === 'new' ? 'Create person' : 'Save changes'}
            extra={edit !== 'new' ? <p className="hint">Editing does not change past attendance records; they keep the details from the time.</p> : undefined}
            onSubmit={async (v) => {
              if (edit === 'new') {
                const r = await api.createPerson(v, false);
                if (r.status === 'similar') { setSimilar({ v, matches: r.matches }); return; }
              } else await api.updatePerson(edit.id, v);
              toast('Saved.'); setEdit(null); reload();
            }} />
        </Modal>
      )}
      {similar && (
        <Modal title="Possible duplicate" onClose={() => setSimilar(null)}>
          <div className="stack">
            <Alert kind="warn">Someone with a very similar name already exists:</Alert>
            {similar.matches.map((m) => <div className="item" key={m.id}><b>{m.display_name}</b><span className="muted small">{[m.area, m.district].filter(Boolean).join(' · ')}</span></div>)}
            <button className="btn primary block" onClick={async () => { try { await api.createPerson(similar.v, true); toast('Created.'); setSimilar(null); setEdit(null); reload(); } catch (e) { toast(errMsg(e)); } }}>This is a different person: create</button>
            <button className="btn ghost block" onClick={() => setSimilar(null)}>Go back</button>
          </div>
        </Modal>
      )}
      {arch && <ConfirmDialog title={`Archive ${arch.full_name}?`} confirmLabel="Archive"
        body={<p>They will no longer appear in searches, but their attendance history stays. You can restore them later.</p>}
        onClose={() => setArch(null)} onConfirm={async () => { await api.archivePerson(arch.id); reload(); }} />}
      {del && <ConfirmDialog title={`Delete ${del.full_name}?`} danger confirmLabel="Delete person" typeToConfirm={del.full_name}
        body={<p><b>This cannot be undone.</b> A person who has attendance records cannot be deleted (archive them instead). It is recorded in the audit log.</p>}
        onClose={() => setDel(null)} onConfirm={async () => { await api.deletePerson(del.id); toast('Deleted.'); reload(); }} />}
      {merge && <MergeDialog from={merge} people={people.data ?? []} onClose={() => setMerge(null)} onDone={() => { setMerge(null); reload(); toast('People merged.'); }} />}
    </div>
  );
}

function MergeDialog({ from, people, onClose, onDone }: { from: Person; people: Person[]; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<Person | null>(null);
  const opts = people.filter((p) => p.id !== from.id && !p.archived && !p.merged_into && q.length >= 2 && p.full_name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  if (target) return (
    <ConfirmDialog title="Merge these two people?" danger confirmLabel="Merge" onClose={onClose}
      body={<p>All attendance and any account of <b>{from.full_name}</b> will move to <b>{target.full_name}</b>, and <b>{from.full_name}</b> will be archived as a duplicate. This is logged.</p>}
      onConfirm={async () => { await api.mergePeople(target.id, from.id); onDone(); }} />
  );
  return (
    <Modal title={`Merge ${from.full_name} into…`} onClose={onClose}>
      <div className="stack">
        <Field label="Find the person to keep"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></Field>
        {opts.map((p) => <button key={p.id} className="btn block" style={{ justifyContent: 'flex-start' }} onClick={() => setTarget(p)}>{p.full_name}</button>)}
      </div>
    </Modal>
  );
}
