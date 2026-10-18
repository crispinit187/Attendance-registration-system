import { useMemo, useState } from 'react';
import type { TrackerGrid } from '../lib/types';
import { download, safeName } from '../lib/format';
import { fmtD } from '../lib/trackerStats';
import { Field, Icon, Modal, useToast } from './ui';

const digits = (c: string) => c.replace(/\D/g, '');
const shown = (r: { title: string | null; title_specify: string | null; name: string }) => [r.title, r.title_specify ? `(${r.title_specify})` : '', r.name].filter(Boolean).join(' ');

/** Who missed a date, with one-tap call and WhatsApp links. Built from the grid already on screen. */
export function FollowUpDialog({ grid, onClose }: { grid: TrackerGrid; onClose: () => void }) {
  const toast = useToast();
  const dates = grid.dates.filter((d) => !d.removed);
  const [mode, setMode] = useState<string>(dates.length ? dates[dates.length - 1]!.id : 'streak');
  const [note, setNote] = useState('');
  const canSee = grid.perms.contact;

  const rows = useMemo(() => {
    const live = grid.rows.filter((r) => !r.removed);
    if (mode === 'streak') {
      const last = dates.slice(-3).map((d) => d.id);
      if (last.length < 2) return [];
      return live.filter((r) => last.every((d) => !r.marks.includes(d)));
    }
    return live.filter((r) => !r.marks.includes(mode));
  }, [grid, mode, dates]);

  const label = mode === 'streak' ? 'the last 3 dates' : fmtD(dates.find((d) => d.id === mode)?.on_date ?? '');
  const withPhone = rows.filter((r) => r.contact);
  const msg = (name: string) => note.replace('{name}', name.split(' ')[0] ?? name);

  const csv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [['Name', 'Contact', 'District', 'Congregation'].join(','), ...rows.map((r) => [shown(r), r.contact ?? '', r.district ?? '', r.congregation ?? ''].map(esc).join(','))];
    download(new Blob([lines.join('\r\n')], { type: 'text/csv' }), `${safeName(`${grid.list.title}_absent_${label}`)}.csv`);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(withPhone.map((r) => `${shown(r)}: ${r.contact}`).join('\n')); toast('Copied.'); }
    catch { toast('Could not copy. Use Download instead.'); }
  };

  return (
    <Modal title="Absent follow-up" onClose={onClose}>
      <div className="stack">
        <Field label="Who was away on">
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
            {[...dates].reverse().map((d) => <option key={d.id} value={d.id}>{fmtD(d.on_date)}{d.title ? `: ${d.title}` : ''}</option>)}
            {dates.length >= 3 && <option value="streak">Missed all of the last 3 dates</option>}
          </select>
        </Field>
        {canSee && (
          <Field label="Message for WhatsApp (optional)" hint="Use {name} for their first name.">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Hello {name}, we missed you at practice." maxLength={300} />
          </Field>
        )}
        <p className="muted small" style={{ margin: 0 }}>{rows.length} {rows.length === 1 ? 'person' : 'people'} away on {label}{canSee ? ` · ${withPhone.length} with a phone number` : ''}.</p>
        <div className="stack" style={{ gap: 6, maxHeight: '42dvh', overflowY: 'auto' }}>
          {rows.map((r) => (
            <div className="item" key={r.entry_id}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{shown(r)}</div>
                <div className="muted small">{canSee ? (r.contact ?? 'No phone number') : [r.district, r.congregation].filter(Boolean).join(' · ')}</div>
              </div>
              {canSee && r.contact && (
                <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                  <a className="btn small" href={`tel:+${digits(r.contact)}`} aria-label={`Call ${r.name}`}><Icon name="phone" size={16} />Call</a>
                  <a className="btn small" href={`https://wa.me/${digits(r.contact)}${note ? `?text=${encodeURIComponent(msg(r.name))}` : ''}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${r.name}`}><Icon name="chat" size={16} />WhatsApp</a>
                </div>
              )}
            </div>
          ))}
          {!rows.length && <p className="muted center">Nobody. Everyone was there.</p>}
        </div>
        {!canSee && <p className="muted small" style={{ margin: 0 }}>Phone numbers are shown only to people who manage this list.</p>}
        {rows.length > 0 && (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {canSee && <button className="btn" onClick={() => void copy()}><Icon name="copy" size={16} />Copy numbers</button>}
            <button className="btn" onClick={csv}><Icon name="down" size={16} />Download</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
