// Service worker de Clair : affiche les notifications et ouvre l'app au toucher.
// Pas de mise en cache : l'app charge toujours la dernière version et la dernière édition.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Clair', {
    body: data.body || '',
    icon: 'icon-180.png',
    badge: 'icon-180.png',
    tag: 'edition',
    data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { await w.focus(); return; }
    }
    await self.clients.openWindow(url);
  })());
});
