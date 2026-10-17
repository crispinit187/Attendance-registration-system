import { useEffect, useRef, useState } from 'react';

export interface MenuItem { label: string; onClick: () => void; danger?: boolean; hidden?: boolean; hint?: string }

/** A "three dots" button that opens a small list of actions. Closes on outside click, Escape or scroll. */
export function ActionMenu({ items, label = 'Actions' }: { items: MenuItem[]; label?: string }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const shown = items.filter((i) => !i.hidden);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [pos]);

  const toggle = () => {
    if (pos) return setPos(null);
    const r = btn.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  };
  if (shown.length === 0) return null;
  return (
    <>
      <button ref={btn} type="button" className="iconbtn" aria-label={label} aria-haspopup="menu" aria-expanded={!!pos} onClick={toggle}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
      </button>
      {pos && (
        <>
          <div className="menu-backdrop" onClick={() => setPos(null)} />
          <div className="menu" role="menu" style={{ top: pos.top, right: pos.right }}>
            {shown.map((i) => (
              <button key={i.label} type="button" role="menuitem" className={`menu-item ${i.danger ? 'danger' : ''}`} onClick={() => { setPos(null); i.onClick(); }}>
                <span>{i.label}</span>{i.hint && <small>{i.hint}</small>}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
