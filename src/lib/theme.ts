import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

type Theme = 'dark' | 'light';
const current = (): Theme => {
  const d = document.documentElement.dataset.theme;
  if (d === 'light' || d === 'dark') return d;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};
const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(current);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const toggle = (ev?: { clientX?: number; clientY?: number }) => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', next); } catch { /* private mode */ }
    const root = document.documentElement;
    const apply = () => { flushSync(() => setTheme(next)); root.dataset.theme = next; };
    if (calm()) { apply(); return; }
    const x = ev?.clientX ?? window.innerWidth - 40, y = ev?.clientY ?? 30;
    root.style.setProperty('--blend-x', `${x}px`);
    root.style.setProperty('--blend-y', `${y}px`);
    const start = (document as unknown as { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }).startViewTransition;
    if (start) {
      // Smooth circular reveal that grows from the button.
      root.classList.add('theme-blend');
      const t = start.call(document, apply);
      void t.finished.finally(() => root.classList.remove('theme-blend'));
    } else {
      // Fallback: fade every colour for a moment.
      root.classList.add('theme-fade');
      apply();
      window.setTimeout(() => root.classList.remove('theme-fade'), 520);
    }
  };
  return { theme, toggle };
}
