import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { errMsg } from '../../lib/format';
import type { Lookup } from '../../lib/types';
import { Alert, Badge, ConfirmDialog, Loading, useToast } from '../../components/ui';

type Table = 'areas' | 'titles' | 'voice_parts';

export function Setup() {
  return (
    <div className="page wide stack">
      <h1>Setup</h1>
      <p className="muted">These are the choices members see on the sign-up and profile forms. Inactive items disappear from the form but stay on old records.</p>
      <div className="grid c3">
        <Section title="Areas" table="areas" qk="areas" load={api.areas} />
        <Section title="Titles" table="titles" qk="titles" load={api.titles} specify />
        <Section title="Voice parts" table="voice_parts" qk="voices" load={api.voiceParts} />
      </div>
    </div>
  );
}

function Section({ title, table, qk, load, specify }: { title: string; table: Table; qk: string; load: () => Promise<Lookup[]>; specify?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: [qk], queryFn: load });
  const [name, setName] = useState('');
  const [needs, setNeeds] = useState(false);
  const [del, setDel] = useState<Lookup | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const reload = () => qc.invalidateQueries({ queryKey: [qk] });
  const run = async (fn: () => Promise<void>) => { try { await fn(); await reload(); } catch (e) { toast(errMsg(e)); } };
  const nextSort = Math.max(0, ...(q.data ?? []).map((x) => x.sort)) + 1;
  if (q.isLoading) return <div className="card"><Loading /></div>;
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{title}</h2>
      {q.error && <Alert>{errMsg(q.error)}</Alert>}
      <div>
        {q.data?.map((r) => (
          <div className="item" key={r.id} style={{ flexWrap: 'wrap' }}>
            {editing?.id === r.id ? (
              <form className="row grow" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api.saveLookup(table, { id: r.id, name: editing.name.trim() }); setEditing(null); }); }}>
                <input className="input grow" value={editing.name} onChange={(e) => setEditing({ id: r.id, name: e.target.value })} autoFocus />
                <button className="btn small primary">Save</button>
              </form>
            ) : (
              <div className="grow" style={{ opacity: r.active ? 1 : .55 }}>
                <b>{r.name}</b> {!r.active && <Badge>inactive</Badge>} {r.needs_specify && <Badge kind="accent">asks for details</Badge>}
              </div>
            )}
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <button className="btn small ghost" onClick={() => setEditing({ id: r.id, name: r.name })}>Rename</button>
              {specify && <button className="btn small ghost" onClick={() => run(() => api.saveLookup(table, { id: r.id, name: r.name, needs_specify: !r.needs_specify }))}>{r.needs_specify ? 'No details' : 'Ask details'}</button>}
              <button className="btn small ghost" onClick={() => run(() => api.saveLookup(table, { id: r.id, name: r.name, active: !r.active }))}>{r.active ? 'Hide' : 'Show'}</button>
              <button className="btn small danger" onClick={() => setDel(r)}>×</button>
            </div>
          </div>
        ))}
      </div>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (name.trim().length < 1) return; void run(async () => { await api.saveLookup(table, { name: name.trim(), sort: nextSort, active: true, ...(specify ? { needs_specify: needs } : {}) }); setName(''); setNeeds(false); }); }}>
        <div className="row"><input className="input grow" placeholder={`Add to ${title.toLowerCase()}…`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /><button className="btn primary">Add</button></div>
        {specify && <label className="check small"><input type="checkbox" checked={needs} onChange={(e) => setNeeds(e.target.checked)} />Ask the member for details (like “Minister of …”)</label>}
      </form>
      {del && <ConfirmDialog title={`Delete “${del.name}”?`} danger confirmLabel="Delete"
        body={<p>If anyone is using it, it cannot be deleted. Use Hide instead.</p>}
        onClose={() => setDel(null)} onConfirm={async () => { await api.deleteLookup(table, del.id); await reload(); }} />}
    </div>
  );
}
