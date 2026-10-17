import { useState } from 'react';
import { api } from '../lib/api';
import { errMsg } from '../lib/format';
import type { PersonCard, ProfileInput } from '../lib/types';
import { useToast } from './ui';
import { PersonForm } from './PersonForm';

const H2 = { margin: 0, fontSize: 16, fontFamily: 'var(--font)', fontWeight: 600 } as const;

/** Add someone who is not on the system yet and mark them present on an open list (checks for similar names first). */
export function AddPerson({ id, listId, onDone }: { id: string; listId: string; onDone: () => void }) {
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
