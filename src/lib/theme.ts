import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';
const current = (): Theme => {
  const d = document.documentElement.dataset.theme;
  if (d === 'light' || d === 'dark') return d;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(current);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('theme', next); } catch { /* private mode */ }
  };
  return { theme, toggle };
}
