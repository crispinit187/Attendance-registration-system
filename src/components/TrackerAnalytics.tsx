import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { errMsg } from '../lib/format';
import type { TrackerAnalytics as A } from '../lib/types';
import { COLORS, DEFAULT_EXPECTED, fmtD, fmtShort, headline, hourLabel, pct, sumBy, totals } from '../lib/trackerStats';
import { Alert, Loading } from './ui';

function Bar({ label, n, max, cls = '', right }: { label: string; n: number; max: number; cls?: string; right?: string }) {
  return (
    <div className="hbar">
      <div className="t"><span>{label}</span><span>{right ?? n}</span></div>
      <div className="track"><div className={`fill ${cls}`} style={{ width: `${Math.max(n > 0 ? 2 : 0, (n / Math.max(1, max)) * 100)}%` }} /></div>
    </div>
  );
}
const Block = ({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) => (
  <div className="card flat stack" style={{ gap: 10 }}><h3 style={{ margin: 0 }}>{title}</h3>{note && <p className="muted small" style={{ margin: 0 }}>{note}</p>}{children}</div>
);

/** Analytics for a whole tracker event, or (with listId) for one list. */
export function TrackerAnalytics({ eventId, listId = null }: { eventId: string; listId?: string | null }) {
  const [list, setList] = useState<string | null>(listId);
  const [date, setDate] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['tracker-analytics', eventId, list, date],
    queryFn: () => api.trackerAnalytics(eventId, list, date),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,   // keep showing the old numbers while new ones load, so the page does not jump
  });
  // The full list of lists and dates, whatever is filtered right now
  const base = useQuery({ queryKey: ['tracker-analytics', eventId, listId, null], queryFn: () => api.trackerAnalytics(eventId, listId, null), staleTime: 30_000 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <Alert>{errMsg(q.error)}</Alert>;
  const a = q.data as A;
  const allLists = base.data?.lists ?? a.lists;
  const dates = base.data?.dates ?? a.dates;
  const t = totals(a);
  const color = new Map(allLists.map((l, i) => [l.id, COLORS[i % COLORS.length]!]));
  const titleOf = new Map(allLists.map((l) => [l.id, l.title]));
  const maxExp = Math.max(1, ...a.lists.map((l) => Math.max(l.present, l.expected ?? DEFAULT_EXPECTED)));
  const multi = a.lists.length > 1;

  const voices = sumBy(a.voices);
  const titles = sumBy(a.titles);
  const cong = a.congregations;
  const districtsBy = a.lists.map((l) => ({ l, rows: a.districts.filter((d) => d.list_id === l.id).sort((x, y) => y.n - x.n) })).filter((g) => g.rows.length);

  // trend: one line per list over all dates
  const dts = [...new Set(a.trend.map((x) => x.on_date))].sort();
  const trendMax = Math.max(1, ...a.trend.map((x) => x.present));
  const W = 560, H = 190, padL = 34, padB = 26, padT = 10, padR = 10;
  const px = (i: number) => padL + (dts.length > 1 ? (i / (dts.length - 1)) * (W - padL - padR) : (W - padL - padR) / 2);
  const py = (v: number) => padT + (1 - v / trendMax) * (H - padT - padB);
  const ticks = [0, 0.5, 1].map((f) => Math.round(trendMax * f));

  return (
    <div className="stack" id="tracker-analytics">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Summary and analytics</h2>
        <div className="row">
          {!listId && allLists.length > 1 && (
            <select className="input" style={{ width: 'auto' }} value={list ?? ''} onChange={(e) => setList(e.target.value || null)} aria-label="List">
              <option value="">All lists</option>
              {allLists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
          )}
          <select className="input" style={{ width: 'auto' }} value={date ?? ''} onChange={(e) => setDate(e.target.value || null)} aria-label="Date">
            <option value="">Any date (cumulative)</option>
            {dates.map((d) => <option key={d.on_date} value={d.on_date}>{fmtD(d.on_date)}{d.title ? ` · ${d.title}` : ''}</option>)}
          </select>
        </div>
      </div>

      <p className="headline" style={{ margin: 0 }}>{headline(a)}</p>
      <div className="statrow">
        <div className="stat"><b>{t.present}</b><span>{date ? 'Present that day' : 'Attended at least once'}</span></div>
        <div className="stat"><b>{t.people}</b><span>Registered</span></div>
        <div className="stat"><b>{pct(t.present, t.expected)}%</b><span>Of {t.expected} expected</span></div>
        <div className="stat"><b>{a.lists.reduce((s, l) => s + l.every_date, 0)}</b><span>Came every date</span></div>
        <div className="stat"><b>{a.lists.reduce((s, l) => s + l.never, 0)}</b><span>Never ticked</span></div>
      </div>

      <Block title="Attendance against what was expected">
        {a.lists.map((l, i) => (
          <Bar key={l.id} label={l.title} n={l.present} max={maxExp} cls={COLORS[i % COLORS.length]}
            right={`${l.present} of ${l.expected ?? DEFAULT_EXPECTED} expected (${pct(l.present, l.expected ?? DEFAULT_EXPECTED)}%) · ${l.people} registered`} />
        ))}
        <p className="muted small" style={{ margin: 0 }}>The expected number is set per list ({DEFAULT_EXPECTED} unless changed).</p>
      </Block>

      {dts.length > 0 && (
        <Block title="Attendance by date" note={date ? 'Showing every date; the date chosen above only filters the other charts.' : undefined}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Attendance by date" style={{ width: '100%', height: 'auto', maxHeight: 260 }}>
            {ticks.map((v) => <g key={v}><line x1={padL} x2={W - padR} y1={py(v)} y2={py(v)} stroke="var(--border)" /><text x={padL - 6} y={py(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{v}</text></g>)}
            {dts.map((d, i) => <text key={d} x={px(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">{fmtShort(d)}</text>)}
            {a.lists.map((l) => {
              const pts = dts.map((d, i) => { const r = a.trend.find((x) => x.list_id === l.id && x.on_date === d); return r ? [px(i), py(r.present)] as const : null; }).filter((p): p is readonly [number, number] => !!p);
              const c = `var(--${color.get(l.id) ?? 'c1'})`;
              return (
                <g key={l.id}>
                  {pts.length > 1 && <polyline fill="none" stroke={c} strokeWidth="2.5" strokeLinejoin="round" points={pts.map((p) => p.join(',')).join(' ')} />}
                  {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="4" fill={c} />)}
                </g>
              );
            })}
          </svg>
          {multi && <div className="leg">{a.lists.map((l) => <span key={l.id}><i style={{ background: `var(--${color.get(l.id)})` }} />{l.title}</span>)}</div>}
        </Block>
      )}

      <div className="grid c2">
        <Block title="By voice part">
          {voices.length ? voices.map((v) => <Bar key={v.name} label={v.name} n={v.n} max={voices[0]!.n} cls="c1" />) : <p className="muted small">No data yet.</p>}
        </Block>
        <Block title="By title">
          {titles.length ? titles.map((v) => <Bar key={v.name} label={v.name} n={v.n} max={titles[0]!.n} cls="c3" />) : <p className="muted small">No data yet.</p>}
        </Block>
      </div>

      <Block title="By district" note={multi ? 'Grouped under each list.' : undefined}>
        {districtsBy.length ? districtsBy.map(({ l, rows }) => (
          <div key={l.id} className="stack" style={{ gap: 4 }}>
            {multi && <b className="small">{titleOf.get(l.id) ?? l.title}</b>}
            {rows.slice(0, 12).map((r) => <Bar key={r.name} label={r.name} n={r.n} max={rows[0]!.n} cls={color.get(l.id)} />)}
            {rows.length > 12 && <span className="muted small">and {rows.length - 12} more districts</span>}
          </div>
        )) : <p className="muted small">No data yet.</p>}
      </Block>

      <Block title="By congregation">
        {cong.length ? cong.slice(0, 15).map((r) => <Bar key={r.name} label={r.name} n={r.n} max={cong[0]!.n} cls="c2" />) : <p className="muted small">No data yet.</p>}
        {cong.length > 15 && <span className="muted small">and {cong.length - 15} more congregations</span>}
      </Block>

      <Block title="When people were registered" note="Time of day (Lusaka time) that ticks were recorded.">
        {a.timeline.length ? (
          <div className="hours" style={{ marginBottom: 20 }}>
            {a.timeline.map((h) => <div key={h.hour} style={{ height: `${Math.max(6, (h.n / Math.max(...a.timeline.map((x) => x.n))) * 100)}%` }} title={`${hourLabel(h.hour)}: ${h.n}`}><span>{hourLabel(h.hour)}</span></div>)}
          </div>
        ) : <p className="muted small">No ticks yet.</p>}
      </Block>

      <Block title="Notes on the data">
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Attendance is cumulative: a person counts as present if they were ticked on any date (or on the date chosen).</li>
          <li>{a.lists.reduce((s, l) => s + l.dates, 0)} date column(s) across {a.lists.length} list(s); dates that were removed are left out.</li>
          <li>People removed from a list are not counted.</li>
          {voices.some((v) => v.name === 'Not set') && <li>Some people have no voice part set; they are shown as “Not set”.</li>}
          <li>Spellings of districts and congregations are grouped automatically, so small typos count as one place.</li>
        </ul>
      </Block>
    </div>
  );
}
