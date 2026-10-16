import { useEffect, useRef } from 'react';
import { turnstileSiteKey } from '../lib/supabase';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, o: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}
let loader: Promise<void> | null = null;
function loadScript() {
  if (window.turnstile) return Promise.resolve();
  loader ??= new Promise<void>((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => res();
    s.onerror = () => { loader = null; rej(new Error('Could not load the human check.')); };
    document.head.appendChild(s);
  });
  return loader;
}

export const turnstileEnabled = Boolean(turnstileSiteKey);

/** Cloudflare Turnstile "are you human" check. `resetKey` changes -> fresh check. */
export function Turnstile({ onToken, resetKey }: { onToken: (t: string | null) => void; resetKey?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!turnstileEnabled || !box.current) return;
    let dead = false;
    loadScript().then(() => {
      if (dead || !box.current || !window.turnstile) return;
      const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      id.current = window.turnstile.render(box.current, {
        sitekey: turnstileSiteKey, theme,
        callback: (t: string) => onToken(t),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      });
    }).catch(() => onToken(null));
    return () => { dead = true; if (id.current) window.turnstile?.remove(id.current); id.current = undefined; onToken(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  if (!turnstileEnabled) return null;
  return <div ref={box} style={{ minHeight: 65 }} />;
}
