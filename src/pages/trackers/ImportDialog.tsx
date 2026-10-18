import { useMemo, useRef, useState } from 'react';
import { useLookups } from '../../lib/auth';
import { api } from '../../lib/api';
import { errMsg } from '../../lib/format';
import { FIELDS, guessMapping, readFile, toRows, type FieldKey, type Grid, type Mapping } from '../../lib/importParse';
import { fmtShort } from '../../lib/trackerStats';
import type { ImportMap, ImportResult, TrackerDate } from '../../lib/types';
import { Alert, Badge, Field, Modal, useToast } from '../../components/ui';

type Step = 'file' | 'columns' | 'check' | 'done';
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/**
 * Import a spreadsheet into one list (listId) or a whole event (eventId, each person goes to the list that
 * matches their Area). The preview comes from the database itself, so what it shows is exactly what Import does.
 */
export function ImportDialog({ eventId, listId, eventName, dates, onClose, onDone }: {
  eventId: string; listId?: string; eventName: string; dates: TrackerDate[]; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const { voices } = useLookups();
  const [step, setStep] = useState<Step>('file');
  const [grid, setGrid] = useState<Grid>([]);
  const [fileName, setFileName] = useState('');
  const [header, setHeader] = useState(true);
  const [map, setMap] = useState<Mapping>({});
  const [vmap, setVmap] = useState<Record<string, string>>({});
  const [dmap, setDmap] = useState<Record<string, string>>({});
  const [cmap, setCmap] = useState<Record<string, string>>({});
  const [tick, setTick] = useState<'none' | 'existing' | 'new'>('none');
  const [tickDate, setTickDate] = useState(dates.length ? dates[dates.length - 1]!.on_date : today());
  const [tickTitle, setTickTitle] = useState('');
  const [res, setRes] = useState<ImportResult | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => toRows(grid, header, map), [grid, header, map]);
  const importMap = (): ImportMap => ({ voice: vmap, district: dmap, congregation: cmap });
  const when = tick === 'none' ? null : tickDate;
  const eventArg = listId ? null : eventId;

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setErr(''); setBusy(true);
    try {
      const g = await readFile(f);
      if (g.length < 2) throw new Error('That file has no rows to import.');
      setGrid(g); setFileName(f.name); setMap(guessMapping(g[0]!)); setHeader(true); setStep('columns');
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  const preview = async (mapOverride?: ImportMap) => {
    setErr(''); setBusy(true);
    try {
      const r = await api.trackerImport(eventArg, listId ?? null, rows, when, tickTitle, mapOverride ?? importMap(), false);
      setRes(r); setStep('check');
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const commit = async () => {
    setErr(''); setBusy(true);
    try {
      const r = await api.trackerImport(eventArg, listId ?? null, rows, when, tickTitle, importMap(), true);
      setRes(r); setStep('done'); onDone();
      toast('Import finished.');
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  const titleFor: Record<Step, string> = { file: 'Import a spreadsheet', columns: 'Match the columns', check: 'Check and import', done: 'Import finished' };
  const blocking = !!res && res.unmapped_voices.some((v) => !vmap[v]);

  return (
    <Modal title={titleFor[step]} onClose={onClose}>
      <div className="stack">
        {step === 'file' && (
          <>
            <p className="muted small" style={{ margin: 0 }}>
              {listId ? 'Everyone in the file is added to this list.' : `Each person is added to the list of ${eventName} that matches their Area (for example “Lusaka East” goes to East).`}{' '}
              New people are also saved in the People register, so registrars can find them later. Nobody is merged automatically.
            </p>
            <input ref={input} type="file" accept=".csv,.xlsx,text/csv" hidden onChange={(e) => void choose(e.target.files?.[0])} />
            <button className="btn primary block" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Reading…' : 'Choose a .xlsx or .csv file'}</button>
            <p className="hint" style={{ margin: 0 }}>The first row should hold the column names (Name, Contact, Area, Voice, Congregation…). Up to 2000 people at a time.</p>
          </>
        )}

        {step === 'columns' && (
          <>
            <p className="small" style={{ margin: 0 }}><b>{fileName}</b> · {Math.max(0, grid.length - (header ? 1 : 0))} rows</p>
            <label className="check"><input type="checkbox" checked={header} onChange={(e) => { setHeader(e.target.checked); }} />The first row holds the column names</label>
            <div className="mapgrid">
              {FIELDS.map((f) => (
                <div key={f.key} style={{ display: 'contents' }}>
                  <span>{f.label}{'need' in f && f.need ? ' *' : ''}</span>
                  <select className="input" value={map[f.key] ?? ''} aria-label={f.label}
                    onChange={(e) => setMap((m) => { const n = { ...m }; if (e.target.value === '') delete n[f.key as FieldKey]; else n[f.key as FieldKey] = Number(e.target.value); return n; })}>
                    <option value="">Not in the file</option>
                    {(grid[0] ?? []).map((h, i) => <option key={i} value={i}>{header ? (h || `Column ${i + 1}`) : `Column ${i + 1} (${(grid[0]![i] ?? '').slice(0, 14)})`}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="small muted">Example (first person): {rows[0] ? [rows[0].name, rows[0].phone, rows[0].voice, rows[0].area, rows[0].congregation].filter(Boolean).join(' · ') : '—'}</div>
            <div className="stack" style={{ gap: 6 }}>
              <b className="small">Tick everyone for a date? (optional)</b>
              <select className="input" value={tick} onChange={(e) => setTick(e.target.value as 'none' | 'existing' | 'new')}>
                <option value="none">No, just add them to the list</option>
                {dates.length > 0 && <option value="existing">Yes, an existing date</option>}
                <option value="new">Yes, a date that is not on the list yet</option>
              </select>
              {tick === 'existing' && (
                <select className="input" value={tickDate} onChange={(e) => setTickDate(e.target.value)}>
                  {dates.map((d) => <option key={d.id} value={d.on_date}>{fmtShort(d.on_date)}{d.title ? ` · ${d.title}` : ''}</option>)}
                </select>
              )}
              {tick === 'new' && (
                <div className="grid c2">
                  <Field label="Date"><input className="input" type="date" value={tickDate} onChange={(e) => setTickDate(e.target.value)} /></Field>
                  <Field label="Title (optional)"><input className="input" value={tickTitle} maxLength={60} onChange={(e) => setTickTitle(e.target.value)} /></Field>
                </div>
              )}
              {tick !== 'none' && <span className="hint">If the file has a time of registration, it is kept as the time of the tick.</span>}
            </div>
            {map.name === undefined && <Alert kind="warn">Choose which column holds the names.</Alert>}
            {err && <Alert>{err}</Alert>}
            <div className="row">
              <button className="btn ghost" onClick={() => setStep('file')}>Back</button>
              <button className="btn primary grow" disabled={busy || map.name === undefined || !rows.length} onClick={() => void preview()}>{busy ? 'Checking…' : 'Next: check the data'}</button>
            </div>
          </>
        )}

        {step === 'check' && res && (
          <>
            <div className="statrow">
              <div className="stat"><b>{res.counts.new_people}</b><span>New people</span></div>
              <div className="stat"><b>{res.counts.existing_people}</b><span>Already known</span></div>
              <div className="stat"><b>{res.counts.added_to_list}</b><span>Added to lists</span></div>
              <div className="stat"><b>{res.counts.already_on_list}</b><span>Already on the list</span></div>
              {tick !== 'none' && <div className="stat"><b>{res.counts.ticked}</b><span>Ticks for {fmtShort(tickDate)}</span></div>}
              <div className="stat"><b>{res.counts.skipped}</b><span>Skipped</span></div>
            </div>
            {res.counts.bad_phone > 0 && <Alert kind="warn">{res.counts.bad_phone} phone number(s) did not look right and were left empty.</Alert>}

            {res.unmapped_voices.length > 0 && (
              <div className="card flat stack" style={{ gap: 8 }}>
                <b>Voice parts to match</b>
                <span className="hint">These spellings are not recognised yet. Pick the voice part once; it is remembered for next time.</span>
                <div className="mapgrid">
                  {res.unmapped_voices.map((v) => (
                    <div key={v} style={{ display: 'contents' }}>
                      <span>“{v}”</span>
                      <select className="input" value={vmap[v] ?? ''} onChange={(e) => setVmap((m) => ({ ...m, [v]: e.target.value }))}>
                        <option value="">Choose…</option>
                        {voices.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        <option value="none">Leave the voice empty</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {([['District', res.new_districts, dmap, setDmap], ['Congregation', res.new_congregations, cmap, setCmap]] as const).map(([label, list, m, setM]) => list.length > 0 && (
              <div key={label} className="card flat stack" style={{ gap: 8 }}>
                <b>New {label.toLowerCase()}s ({list.length})</b>
                <span className="hint">These will be created. If one is just a different spelling of an existing {label.toLowerCase()}, choose that one to join them.</span>
                <div className="mapgrid">
                  {list.slice(0, 40).map((g) => (
                    <div key={g.id} style={{ display: 'contents' }}>
                      <span>{g.name}</span>
                      <select className="input" value={m[g.variant ?? g.name.toLowerCase()] ?? ''} onChange={(e) => setM((p) => ({ ...p, [g.variant ?? g.name.toLowerCase()]: e.target.value }))}>
                        <option value="">Create “{g.name}” as new</option>
                        {g.suggest && <option value={g.suggest.id}>Same as “{g.suggest.name}”</option>}
                      </select>
                    </div>
                  ))}
                </div>
                {list.length > 40 && <span className="hint">…and {list.length - 40} more, created as new.</span>}
              </div>
            ))}

            {res.possible_duplicates.length > 0 && (
              <Alert kind="warn">
                <b>{res.possible_duplicates.length} possible duplicate(s)</b> were added as separate people because their phone numbers differ (for example {res.possible_duplicates[0]!.name}). They are listed under People → Possible duplicates for you to merge.
              </Alert>
            )}
            {res.rows.filter((r) => r.status === 'invalid' || r.status === 'no_list').length > 0 && (
              <details>
                <summary className="small">{res.rows.filter((r) => r.status === 'invalid' || r.status === 'no_list').length} row(s) will be skipped</summary>
                <ul className="small muted">{res.rows.filter((r) => r.status === 'invalid' || r.status === 'no_list').slice(0, 30).map((r) => <li key={r.idx}>Row {r.idx}{r.name ? ` (${r.name})` : ''}: {r.message}</li>)}</ul>
              </details>
            )}
            {err && <Alert>{err}</Alert>}
            <div className="row">
              <button className="btn ghost" onClick={() => setStep('columns')}>Back</button>
              <button className="btn" disabled={busy} onClick={() => void preview()}>{busy ? 'Checking…' : 'Update preview'}</button>
              <button className="btn primary grow" disabled={busy || blocking || res.counts.added_to_list + res.counts.ticked === 0 && res.counts.new_people === 0} onClick={() => void commit()}>
                {busy ? 'Importing…' : blocking ? 'Match the voice parts first' : `Import ${res.counts.new_people + res.counts.existing_people} people`}
              </button>
            </div>
          </>
        )}

        {step === 'done' && res && (
          <>
            <Alert kind="ok"><b>Done.</b> {res.counts.new_people} new people were saved in the People register, {res.counts.added_to_list} were added to lists{tick !== 'none' ? `, and ${res.counts.ticked} ticked for ${fmtShort(tickDate)}` : ''}.</Alert>
            {res.possible_duplicates.length > 0 && <Badge kind="warn">{res.possible_duplicates.length} possible duplicates to review</Badge>}
            <button className="btn primary block" onClick={onClose}>Close</button>
          </>
        )}
      </div>
    </Modal>
  );
}
