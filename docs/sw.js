// Service worker de Clair : mode hors ligne + notifications.
// - L'app et l'édition : réseau d'abord (toujours la dernière version), copie de secours pour le hors-ligne.
// - Les photos : gardées en cache pour être visibles sans réseau.

const SHELL = 'clair-shell-v10';
const IMG = 'clair-img-v1';
const SHELL_FILES = ['./', 'index.html', 'app.js', 'player.js', 'select.js', 'i18n.js', 'config.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];
const MAX_IMAGES = 250;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('clair-shell') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

// Réseau d'abord (avec délai max, utile en Wi-Fi d'avion capricieux), sinon la copie gardée.
async function networkFirst(request, key, ms) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([fetch(request), timeout(ms)]);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch {
    return (await cache.match(key, { ignoreSearch: true })) || Response.error();
  }
}

async function trimImages() {
  const cache = await caches.open(IMG);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_IMAGES; i++) await cache.delete(keys[i]);
}
async function cacheImage(url) {
  const cache = await caches.open(IMG);
  if (await cache.match(url)) return true;
  try {
    const res = await fetch(url, { mode: 'no-cors', referrerPolicy: 'no-referrer' });
    if (res.ok || res.type === 'opaque') { await cache.put(url, res); return true; }
  } catch { /* image indisponible */ }
  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);

  if (url.origin === scope.origin && url.pathname.startsWith(`${scope.pathname}audio/`)) return; // géré par le lecteur
  if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) {
    if (url.pathname.endsWith('/edition.json')) {
      event.respondWith(networkFirst(req, new URL('edition.json', scope).href, 8000));
    } else {
      const key = url.pathname === scope.pathname ? new URL('index.html', scope).href : url.origin + url.pathname;
      event.respondWith(networkFirst(req, key, 4000));
    }
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || fresh;
    })());
    return;
  }
  if (req.destination === 'image') {
    event.respondWith((async () => {
      const hit = await caches.match(req.url, { cacheName: IMG });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') { (await caches.open(IMG)).put(req.url, res.clone()); trimImages(); }
        return res;
      } catch {
        return Response.error();
      }
    })());
  }
});

// L'app demande de préparer le hors-ligne : on télécharge les photos de l'édition.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'precache') return;
  event.waitUntil((async () => {
    const urls = [...new Set(event.data.urls || [])];
    let ok = 0;
    for (const u of urls) if (await cacheImage(u)) ok++;
    await trimImages();
    event.source?.postMessage({ type: 'precached', ok, total: urls.length });
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Clair', {
    body: data.body || '',
    icon: 'icon-180.png',
    badge: 'icon-180.png',
    tag: data.url && data.url.includes('#recus') ? `share-${Date.now()}` : 'edition',
    data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus();
        if (url.includes('#')) w.navigate(url).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
