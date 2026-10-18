/* Keeps the app available with no connection. Data is never cached here: the app keeps its own copy and its own queue. */
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', './favicon.svg', './manifest.webmanifest', './icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => ![SHELL, ASSETS].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // Supabase, fonts: let the browser handle them

  // Opening the app: try the network first so updates arrive, fall back to the saved page.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((r) => { const copy = r.clone(); caches.open(SHELL).then((c) => c.put('./', copy)); return r; })
        .catch(() => caches.match('./').then((r) => r || Response.error())),
    );
    return;
  }
  // Scripts, styles, images: saved after first use. Their names change when the code changes.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(ASSETS).then((c) => c.put(req, copy)); }
      return r;
    })),
  );
});
