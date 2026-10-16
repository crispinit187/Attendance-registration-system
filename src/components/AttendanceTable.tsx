import { useMemo, useState } from 'react';
import type { AttendanceRow } from '../lib/types';
import { fmtDateTime } from '../lib/format';
import { Badge } from './ui';

export function useRowFilter(rows: AttendanceRow[], labeled = false) {
  const [q, setQ] = useState('');
  const [area, setArea] = useState('');
  const [voice, setVoice] = useState('');
  const [district, setDistrict] = useState('');
  const opts = useMemo(() => {
    const u = (f: (r: AttendanceRow) => string | null) => [...new Set(rows.map(f).filter(Boolean) as string[])].sort();
    return { areas: u((r) => r.snapshot.area), voices: u((r) => r.snapshot.voice_part), districts: u((r) => r.snapshot.district) };
  }, [rows]);
  const filtered = useMemo(() => rows.filter((r) => {
    const s = r.snapshot;
    if (area && s.area !== area) return false;
    if (voice && s.voice_part !== voice) return false;
    if (district && s.district !== district) return false;
    if (q && !s.display_name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [rows, q, area, voice, district]);
  const lbl = (text: string, el: React.ReactNode, flex: string) => (
    <div style={{ flex, display: 'flex', flexDirection: 'column', gap: 4 }}><label style={{ fontSize: 13, color: 'var(--muted)' }}>{text}{el}</label></div>
  );
  const ui = labeled ? (
    <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
      {lbl('Search by name', <input className="input" style={{ minHeight: 44, borderRadius: 10, marginTop: 4, background: 'var(--bg)' }} type="search" placeholder="Type a name" value={q} onChange={(e) => setQ(e.target.value)} />, '2 1 220px')}
      {lbl('Area', <select className="input" style={{ minHeight: 44, borderRadius: 10, marginTop: 4, background: 'var(--bg)' }} value={area} onChange={(e) => setArea(e.target.value)}><option value="">All areas</option>{opts.areas.map((a) => <option key={a}>{a}</option>)}</select>, '1 1 140px')}
      {lbl('District', <select className="input" style={{ minHeight: 44, borderRadius: 10, marginTop: 4, background: 'var(--bg)' }} value={district} onChange={(e) => setDistrict(e.target.value)}><option value="">All districts</option>{opts.districts.map((a) => <option key={a}>{a}</option>)}</select>, '1 1 140px')}
      {lbl('Voice part', <select className="input" style={{ minHeight: 44, borderRadius: 10, marginTop: 4, background: 'var(--bg)' }} value={voice} onChange={(e) => setVoice(e.target.value)}><option value="">All voice parts</option>{opts.voices.map((a) => <option key={a}>{a}</option>)}</select>, '1 1 140px')}
    </div>
  ) : (
    <div className="row" style={{ marginBottom: 10 }}>
      <input className="input grow" style={{ minWidth: 160 }} placeholder="Search name…" value={q} onChange={(e) => setQ(e.target.value)} />
      <select className="input" style={{ width: 'auto' }} value={area} onChange={(e) => setArea(e.target.value)}>
        <option value="">All areas</option>{opts.areas.map((a) => <option key={a}>{a}</option>)}
      </select>
      <select className="input" style={{ width: 'auto' }} value={voice} onChange={(e) => setVoice(e.target.value)}>
        <option value="">All voice parts</option>{opts.voices.map((a) => <option key={a}>{a}</option>)}
      </select>
      <select className="input" style={{ width: 'auto' }} value={district} onChange={(e) => setDistrict(e.target.value)}>
        <option value="">All districts</option>{opts.districts.map((a) => <option key={a}>{a}</option>)}
      </select>
    </div>
  );
  return { filtered, ui, active: Boolean(q || area || voice || district) };
}

export function AttendanceTable({ rows, showContact, showMethod, onRemove, onRestore }: {
  rows: AttendanceRow[]; showContact?: boolean; showMethod?: boolean;
  onRemove?: (r: AttendanceRow) => void; onRestore?: (r: AttendanceRow) => void;
}) {
  if (!rows.length) return <p className="muted center" style={{ padding: 24 }}>Nobody matches yet.</p>;
  return (
    <div className="table-wrap" style={{ maxHeight: '60dvh', overflowY: 'auto' }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>#</th><th>Name</th><th>Area</th><th>District</th><th>Voice</th>
            {showContact && <th>Contact</th>}
            <th>Time</th>{showMethod && <th>Marked by</th>}
            {(onRemove || onRestore) && <th></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={r.removed ? 'removed' : ''}>
              <td>{i + 1}</td>
              <td>{r.snapshot.display_name}</td>
              <td>{r.snapshot.area}</td><td>{r.snapshot.district}</td><td>{r.snapshot.voice_part}</td>
              {showContact && <td>{r.snapshot.contact}</td>}
              <td>{fmtDateTime(r.marked_at)}</td>
              {showMethod && <td>{r.marked_by_name} <Badge>{r.method === 'self' ? 'QR' : r.method}</Badge></td>}
              {(onRemove || onRestore) && (
                <td style={{ textDecoration: 'none' }}>
                  {r.removed
                    ? onRestore && <button className="btn small" onClick={() => onRestore(r)}>Restore</button>
                    : onRemove && <button className="btn small danger" onClick={() => onRemove(r)}>Remove</button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
