import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/auth';
import { parsePaste, type ParsedLine } from '../../lib/pasteParse';
import { displayName, errMsg } from '../../lib/format';
import type { PasteResult, SignupDetailInfo } from '../../lib/types';
import { Alert, Field, useToast } from '../../components/ui';

const LABEL = { new: 'New', already: 'Already on the list', similar: 'Looks similar', invalid: 'Problem', added: 'Added', skipped: 'Not added' } as const;
const CLASS = { new: 'pv-new', already: 'pv-warn', similar: 'pv-warn', invalid: 'pv-bad', added: 'pv-new', skipped: 'muted' } as const;

/** Paste a plain text list (one person per line), check it against the same duplicate rules, then add it. */
export function PasteTab({ list }: { list: SignupDetailInfo }) {
  const lk = useLookups();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [def, setDef] = useState<{ title_id: string | null; area_id: string | null; voice_part_id: string | null; district: string }>({ title_id: null, area_id: null, voice_part_id: null, district: '' });
  const [pv, setPv] = useState<{ lines: ParsedLine[]; res: PasteResult } | null>(null);
  const [force, setForce] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const areas = lk.areas.filter((a) => a.active && (!list.allowed_area_ids.length || list.allowed_area_ids.includes(a.id)));
  const voices = lk.voices.filter((v) => v.active && (!list.voice_part_ids.length || list.voice_part_ids.includes(v.id)));
  const stale = () => { setPv(null); setForce(new Set()); };

  const check = async () => {
    setErr('');
    const lines = parsePaste(text, lk, def);
    if (!lines.length) return setErr('Paste at least one name first.');
    if (lines.length > 300) return setErr('Please paste at most 300 people at a time.');
    setBusy(true);
    try { setPv({ lines, res: await api.signupPaste(list.id, lines.map((l) => l.row), false) }); setForce(new Set()); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  const statusOf = (i: number) => pv?.res.rows[i]?.status ?? 'invalid';
  const addable = pv ? pv.res.rows.reduce((n, r, i) => n + (r.status === 'new' || (force.has(i) && (r.status === 'similar' || r.status === 'already')) ? 1 : 0), 0) : 0;

  const commit = async () => {
    if (!pv) return;
    setErr(''); setBusy(true);
    try {
      const rows = pv.lines.map((l, i) => ({ ...l.row, force: force.has(i) }));
      const res = await api.signupPaste(list.id, rows, true);
      toast(`Added ${res.added} ${res.added === 1 ? 'person' : 'people'}.`);
      // keep the lines that were not added so they can be fixed and tried again
      const left = pv.lines.filter((_, i) => res.rows[i]?.status !== 'added').map((l) => l.raw);
      setText(left.join('\n')); stale();
      void qc.invalidateQueries({ queryKey: ['signup-entries'] }); void qc.invalidateQueries({ queryKey: ['signup'] }); void qc.invalidateQueries({ queryKey: ['signup-lists'] });
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <div className="card stack">
        <h3 style={{ margin: 0 }}>Paste a list</h3>
        <p className="muted small" style={{ margin: 0, lineHeight: 1.5 }}>
          One person per line. After the name you can add district, voice part, area and phone number, separated by commas, in any order.
          A title at the start (Brother, Sister, Minister) is recognised. Anything a line leaves out is filled from the choices below.
        </p>
        <div className="grid c2">
          <Field label="Title for lines without one">
            <select className="input" value={def.title_id ?? ''} onChange={(e) => { setDef({ ...def, title_id: e.target.value || null }); stale(); }}>
              <option value="">None</option>{lk.titles.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Area for lines without one">
            <select className="input" value={def.area_id ?? ''} onChange={(e) => { setDef({ ...def, area_id: e.target.value || null }); stale(); }}>
              <option value="">None</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Voice part for lines without one">
            <select className="input" value={def.voice_part_id ?? ''} onChange={(e) => { setDef({ ...def, voice_part_id: e.target.value || null }); stale(); }}>
              <option value="">None</option>{voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="District for lines without one">
            <input className="input" maxLength={60} placeholder="For example Woodlands" value={def.district} onChange={(e) => { setDef({ ...def, district: e.target.value }); stale(); }} />
          </Field>
        </div>
        <Field label="The list">
          <textarea className="input" rows={8} placeholder={'Mulenga Chanda\nSister Grace Tembo, Kabwata, Soprano II, 0977 123 456\nMinister (Evangelist) Peter Zulu, Alto I'}
            value={text} onChange={(e) => { setText(e.target.value); stale(); }} />
        </Field>
        {err && <Alert>{err}</Alert>}
        <div className="row">
          <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void check()}>{busy && !pv ? 'Checking…' : 'Check the list'}</button>
          {text && <button className="btn ghost" disabled={busy} onClick={() => { setText(''); stale(); }}>Clear</button>}
        </div>
      </div>

      {pv && (
        <div className="card stack">
          <div className="row between">
            <h3 style={{ margin: 0 }}>Check before adding</h3>
            <div className="row small">
              <span className="pv-new">{pv.res.new} new</span>
              {pv.res.similar > 0 && <span className="pv-warn">{pv.res.similar} look similar</span>}
              {pv.res.already > 0 && <span className="pv-warn">{pv.res.already} already there</span>}
              {pv.res.invalid > 0 && <span className="pv-bad">{pv.res.invalid} with problems</span>}
            </div>
          </div>
          <div className="table-wrap" style={{ maxHeight: '55dvh', overflowY: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>Line</th><th>Name</th><th>District</th><th>Voice</th><th>Result</th><th>Add anyway</th></tr></thead>
              <tbody>
                {pv.lines.map((l, i) => {
                  const st = statusOf(i);
                  const r = l.row;
                  const tname = lk.titles.find((t) => t.id === r.title_id)?.name;
                  return (
                    <tr key={i}>
                      <td>{l.line}</td>
                      <td>{displayName(tname, r.title_specify, r.name)}</td>
                      <td>{r.district || '—'}</td>
                      <td>{lk.voices.find((v) => v.id === r.voice_part_id)?.name ?? '—'}</td>
                      <td style={{ whiteSpace: 'normal', minWidth: 200 }}>
                        <b className={CLASS[st]}>{LABEL[st]}</b>
                        {[pv.res.rows[i]?.message, ...l.notes].filter(Boolean).map((m, k) => <div key={k} className="muted small">{m}</div>)}
                      </td>
                      <td>
                        {(st === 'similar' || st === 'already') && (
                          <input type="checkbox" style={{ width: 20, height: 20, accentColor: 'var(--accent)' }} aria-label={`Add line ${l.line} anyway`}
                            checked={force.has(i)} onChange={(e) => setForce((s) => { const n = new Set(s); if (e.target.checked) n.add(i); else n.delete(i); return n; })} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="muted small">Lines marked “Problem” are not added. Tick “Add anyway” only when it really is a different person.</div>
          <button className="btn primary" disabled={busy || addable === 0} onClick={() => void commit()}>
            {busy ? 'Adding…' : addable === 0 ? 'Nothing to add' : `Add ${addable} ${addable === 1 ? 'person' : 'people'}`}
          </button>
        </div>
      )}
    </div>
  );
}
