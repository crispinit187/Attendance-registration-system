import { fmtD } from '../lib/trackerStats';

/** Choose which date an export covers: all dates, or a single day (with the option to list the absent too). */
export function ExportDate({ dates, date, onDate, absent, onAbsent }: {
  dates: { on_date: string; title: string | null }[]; date: string; onDate: (d: string) => void; absent: boolean; onAbsent: (v: boolean) => void;
}) {
  const sorted = [...dates].sort((a, b) => b.on_date.localeCompare(a.on_date));
  return (
    <div className="stack" style={{ gap: 8 }}>
      <label className="field"><span>Date</span>
        <select className="input" value={date} onChange={(e) => onDate(e.target.value)}>
          <option value="">All dates</option>
          {sorted.map((d) => <option key={d.on_date} value={d.on_date}>{fmtD(d.on_date)}{d.title ? `: ${d.title}` : ''}</option>)}
        </select>
      </label>
      {date && <label className="check small"><input type="checkbox" checked={absent} onChange={(e) => onAbsent(e.target.checked)} />Also list the people who were absent</label>}
      <span className="hint">{date ? 'The files and the report cover this one day only.' : 'Every date that has started is included.'}</span>
    </div>
  );
}
