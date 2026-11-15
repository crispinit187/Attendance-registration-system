import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

export interface Opt { id: string; label: string }

/** The matching letters are shown in bold, so it is clear why an option is in the list. */
function Marked({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<b className="combo-hit">{text.slice(i, i + q.length)}</b>{text.slice(i + q.length)}</>;
}

/** Shared dropdown: type to narrow the list on every letter, arrow keys and Enter, or just tap an option. */
function Listbox({ id, items, q, active, onPick, empty, busy }: { id: string; items: Opt[]; q: string; active: number; onPick: (o: Opt) => void; empty?: string; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);
  return (
    <div ref={ref} className="combo-list" role="listbox" id={id}>
      {items.length === 0
        ? <div className="combo-empty">{busy ? 'Searching…' : empty ?? 'No match'}</div>
        : items.map((o, i) => (
          <button type="button" role="option" aria-selected={i === active} key={o.id} className={`combo-opt ${i === active ? 'on' : ''}`}
            onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(o)}>
            <Marked text={o.label} q={q} />
          </button>
        ))}
    </div>
  );
}

const rank = (label: string, q: string) => {
  const l = label.toLowerCase();
  if (l.startsWith(q)) return 0;
  if (l.split(/\s+/).some((w) => w.startsWith(q))) return 1;
  return l.includes(q) ? 2 : 9;
};

/**
 * Pick one of a fixed set (title, voice part, area). Typing narrows the list from the first letter;
 * only an existing option can be chosen.
 */
export function Combo({ options, value, onChange, placeholder = 'Type to search…', none, ariaLabel }: {
  options: Opt[]; value: string | null; onChange: (id: string | null) => void; placeholder?: string; none?: string; ariaLabel?: string;
}) {
  const uid = useId();
  const selected = options.find((o) => o.id === value) ?? null;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [active, setActive] = useState(0);
  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = !typing || !s ? options : options.filter((o) => rank(o.label, s) < 9).sort((a, b) => rank(a.label, s) - rank(b.label, s) || a.label.localeCompare(b.label));
    return none && !s ? [{ id: '', label: none }, ...list] : list;
  }, [options, q, typing, none]);
  useEffect(() => { setActive(0); }, [q, open]);
  const pick = (o: Opt) => { onChange(o.id || null); setQ(''); setTyping(false); setOpen(false); };
  const text = typing ? q : selected?.label ?? '';
  return (
    <div className="combo">
      <input className="input" role="combobox" aria-expanded={open} aria-controls={uid} aria-autocomplete="list" aria-label={ariaLabel}
        autoComplete="off" autoCorrect="off" spellCheck={false} placeholder={selected ? '' : placeholder} value={text}
        onFocus={(e) => { setOpen(true); e.target.select(); }}
        onBlur={() => { setOpen(false); setTyping(false); setQ(''); }}
        onChange={(e) => { setQ(e.target.value); setTyping(true); setOpen(true); if (!e.target.value && selected && !none) { /* keep the choice until another is picked */ } }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(items.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && open && items[active]) { e.preventDefault(); pick(items[active]!); }
          else if (e.key === 'Escape') { setOpen(false); }
        }} />
      {selected && !typing && <button type="button" className="combo-x" aria-label="Clear" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(null)}>×</button>}
      {open && <Listbox id={uid} items={items} q={typing ? q.trim() : ''} active={active} onPick={pick} empty={`Nothing matches “${q.trim()}”`} />}
    </div>
  );
}

/**
 * Free text with a live list of names that already exist (districts, congregations). The list narrows on every
 * letter; tapping a name fills it in, and a brand new name can still be typed.
 */
export function SuggestInput({ value, onChange, fetcher, kind, placeholder }: {
  value: string; onChange: (v: string) => void; fetcher: (q: string) => Promise<{ id: string; name: string }[]>; kind: string; placeholder?: string;
}) {
  const uid = useId();
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState(value);
  const [active, setActive] = useState(-1);
  useEffect(() => { setQ(value); }, [value]);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 120); return () => clearTimeout(t); }, [q]);
  const s = debounced.trim();
  const res = useQuery({ queryKey: [kind + '-suggest', s], queryFn: () => fetcher(s), enabled: open && s.length >= 1, staleTime: 60_000, placeholderData: (p) => p });
  const items: Opt[] = (res.data ?? []).map((x) => ({ id: x.id, label: x.name })).filter((o) => o.label.toLowerCase() !== q.trim().toLowerCase());
  const pick = (o: Opt) => { setQ(o.label); onChange(o.label); setOpen(false); };
  return (
    <div className="combo">
      <input className="input" role="combobox" aria-expanded={open && items.length > 0} aria-controls={uid} aria-autocomplete="list" value={q} maxLength={60}
        autoComplete="off" autoCorrect="off" placeholder={placeholder}
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
          else if (e.key === 'Enter' && open && items[active]) { e.preventDefault(); pick(items[active]!); }
          else if (e.key === 'Escape') { setOpen(false); }
        }} />
      {open && s.length >= 1 && items.length > 0 && <Listbox id={uid} items={items} q={s} active={active} onPick={pick} />}
      {open && s.length >= 1 && items.length === 0 && !res.isFetching && q.trim() && <div className="muted small combo-note">No existing {kind} matches. “{q.trim()}” will be added as a new one.</div>}
    </div>
  );
}
