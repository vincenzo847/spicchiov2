// Service worker: l'app si apre anche senza rete.
// Pagina e /api/config: prima la rete, se manca la copia salvata. Icone e manifest: la copia salvata.
// /api/claude e Supabase non passano mai dalla cache.
const CACHE = 'app-v3';
const STATIC = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/api/') && u.pathname !== '/api/config') return;
  const page = req.mode === 'navigate' || u.pathname === '/' || u.pathname === '/index.html';
  if (page || u.pathname === '/api/config') {
    const key = page ? '/' : '/api/config';
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(key, cp)); }
      return r;
    }).catch(() => caches.match(key).then(r => r || Response.error())));
    return;
  }
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});

// Promemoria a fine servizio: la notifica mandata da /api/promemoria
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title || 'Promemoria', { body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'promemoria-scarti', data: { url: d.url || '/' } }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(x => new URL(x.url).origin === location.origin);
    return w ? w.focus() : self.clients.openWindow(url);
  }));
});
