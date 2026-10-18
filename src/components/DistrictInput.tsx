import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

/** Free-text district with suggestions of districts that already exist. */
export function DistrictInput({ value, onChange, compact, kind = 'district' }: { value: string; onChange: (v: string) => void; compact?: boolean; kind?: 'district' | 'congregation' }) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { setQ(value); }, [value]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const sugg = useQuery({
    queryKey: [kind + '-suggest', debounced],
    queryFn: () => (kind === 'district' ? api.suggestDistricts(debounced) : api.suggestCongregations(debounced)),
    enabled: debounced.trim().length >= 2 && open,
    staleTime: 30_000,
  });
  const items = (sugg.data ?? []).filter((s) => s.name.toLowerCase() !== q.trim().toLowerCase());
  const top = items[0];
  return (
    <div className="stack" style={{ gap: 6 }}>
      <input
        className="input" value={q} maxLength={60} autoComplete="off" placeholder={kind === 'district' ? 'Type your district' : 'Type the congregation'}
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && top && (compact ? (
        <div className="muted small">Suggestion: <button type="button" className="didyou" style={{ border: 0, padding: 0, background: 'none' }} onClick={() => { setQ(top.name); onChange(top.name); setOpen(false); }}><b style={{ color: 'var(--accent)' }}>{top.name}</b></button> (typos are matched automatically)</div>
      ) : (
        <div className="didyou">
          Did you mean <button type="button" onClick={() => { setQ(top.name); onChange(top.name); setOpen(false); }}>{top.name}</button>? Tap to use it. Spelling variations are matched to one {kind} automatically.
          {items.length > 1 && <div className="row" style={{ marginTop: 6, gap: 12 }}>{items.slice(1, 4).map((s) => <button type="button" key={s.id} onClick={() => { setQ(s.name); onChange(s.name); setOpen(false); }}>{s.name}</button>)}</div>}
        </div>
      ))}
    </div>
  );
}
