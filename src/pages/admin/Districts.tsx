import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { errMsg } from '../../lib/format';
import type { DistrictGroup } from '../../lib/types';
import { Alert, ConfirmDialog, Field, Loading, Modal, useToast } from '../../components/ui';

export function Districts() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['districts'], queryFn: api.districts });
  const [rename, setRename] = useState<DistrictGroup | null>(null);
  const [name, setName] = useState('');
  const [merge, setMerge] = useState<DistrictGroup | null>(null);
  const [target, setTarget] = useState<DistrictGroup | null>(null);
  const reload = () => { void qc.invalidateQueries({ queryKey: ['districts'] }); void qc.invalidateQueries({ queryKey: ['district-groups'] }); };
  if (q.isLoading) return <div className="page wide"><Loading /></div>;
  return (
    <div className="page wide stack">
      <h1>Districts</h1>
      <p className="muted">Members type districts in their own way. Similar spellings are grouped automatically (for example “Kitwe”, “kitwe ” and “Kitwee”). Rename a group to fix its official name, or merge two groups that are really the same place.</p>
      {q.error && <Alert>{errMsg(q.error)}</Alert>}
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>District</th><th>People</th><th>Spellings seen</th><th></th></tr></thead>
          <tbody>
            {q.data?.map((g) => (
              <tr key={g.id}>
                <td><b>{g.name}</b></td><td>{g.people}</td>
                <td style={{ whiteSpace: 'normal', maxWidth: 360 }} className="muted small">{g.variants.join(', ')}</td>
                <td className="row" style={{ flexWrap: 'nowrap' }}>
                  <button className="btn small" onClick={() => { setRename(g); setName(g.name); }}>Rename</button>
                  <button className="btn small ghost" onClick={() => { setMerge(g); setTarget(null); }}>Merge…</button>
                </td>
              </tr>
            ))}
            {!q.data?.length && <tr><td colSpan={4} className="muted center">No districts yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {rename && (
        <Modal title="Rename district" onClose={() => setRename(null)}>
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { await api.renameDistrict(rename.id, name.trim()); setRename(null); reload(); toast('Renamed.'); } catch (x) { toast(errMsg(x)); } }}>
            <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus /></Field>
            <p className="hint" style={{ margin: 0 }}>Past attendance records keep the spelling they had at the time.</p>
            <button className="btn primary block">Save</button>
          </form>
        </Modal>
      )}
      {merge && !target && (
        <Modal title={`Merge “${merge.name}” into…`} onClose={() => setMerge(null)}>
          <div className="stack">
            {q.data?.filter((g) => g.id !== merge.id).map((g) => <button key={g.id} className="btn block" style={{ justifyContent: 'flex-start' }} onClick={() => setTarget(g)}>{g.name}</button>)}
          </div>
        </Modal>
      )}
      {merge && target && (
        <ConfirmDialog title="Merge these districts?" danger confirmLabel="Merge" onClose={() => { setMerge(null); setTarget(null); }}
          body={<p>Everyone in <b>{merge.name}</b> will be moved to <b>{target.name}</b>, and the group “{merge.name}” will disappear. Its spellings will be understood as {target.name} from now on.</p>}
          onConfirm={async () => { await api.mergeDistricts(merge.id, target.id); reload(); toast('Merged.'); }} />
      )}
    </div>
  );
}
