import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import App from './App';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './components/ui';

const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 5_000, networkMode: 'always' } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// Lets the app open with no connection. Only on the real site, not while developing.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('./sw.js').catch(() => { /* not available: the app still works online */ }); });
}

// Scrollbars show while something is scrolling and fade out a moment after it stops.
const timers = new WeakMap<Element, number>();
window.addEventListener('scroll', (e) => {
  const t = e.target instanceof Element ? e.target : document.documentElement;
  t.setAttribute('data-scrolling', '');
  clearTimeout(timers.get(t));
  timers.set(t, window.setTimeout(() => t.removeAttribute('data-scrolling'), 900));
}, { capture: true, passive: true });
