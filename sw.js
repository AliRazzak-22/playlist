const CACHE = 'signage-admin-v11';
const SHELL = ['./', 'index.html', 'app.js', 'style.css', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
const SHELL_URLS = new Set(SHELL.map((p) => new URL(p, self.registration.scope).href));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  url.search = '';
  url.hash = '';
  const key = url.href;
  if (!SHELL_URLS.has(key)) return;
  event.respondWith((async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(req, { cache: 'no-cache', signal: controller.signal });
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(key, copy));
      }
      return res;
    } catch {
      const hit = await caches.match(key);
      return hit || Response.error();
    } finally {
      clearTimeout(timeout);
    }
  })());
});
