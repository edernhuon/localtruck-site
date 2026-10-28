/* LocalTruck – service worker : l'application s'ouvre même sans réseau (les données, elles, viennent toujours du serveur).
 * Stratégie : les fichiers de l'application sont mis en cache à l'installation ; au démarrage on sert le cache, et à chaque
 * nouvelle version publiée (BUILD change) l'ancien cache est supprimé. Les requêtes vers Supabase, l'IGN et OpenStreetMap
 * ne passent jamais par ici (autres domaines). */
'use strict';
const BUILD = 'ccae311-202610280744';
const CACHE = 'mft-' + BUILD;
const FILES = [
  './', 'index.html', 'style.css', 'desktop.css', 'manifest.webmanifest',
  'js/frameguard.js', 'js/theme.js', 'js/config.js', 'js/core.js', 'js/legal.js', 'js/platform.js', 'js/cloud.js', 'js/geo.js', 'js/ui.js', 'js/desktop.js', 'js/map.js', 'js/qr.js', 'js/app.js',
  'js/updates.js', 'js/funnel.js', 'js/presence.js', 'js/push.js', 'js/install.js', 'js/screens-shared.js', 'js/screens-auth.js', 'js/screens-client.js', 'js/screens-truck.js', 'js/screens-admin.js', 'js/screens-listing.js', 'js/poster.js', 'js/poster-data.js', 'js/screens-poster.js',
  'assets/icon.png', 'assets/fonts/archivo-var.woff', 'assets/grain.png', 'assets/blueprint-dark.svg', 'assets/blueprint-light.svg', 'assets/favicon.png', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/apple-touch-icon.png',
];

/* Une nouvelle version s'installe en arrière-plan puis PREND LA MAIN TOUTE SEULE (aucune fenêtre, aucune question) : une fois tous les
 * fichiers en cache, elle s'active. La page ouverte (js/updates.js) s'en aperçoit et se recharge quand cela ne fait rien perdre ;
 * sinon la prochaine page ouverte est déjà la bonne. SKIP_WAITING reste compris pour les pages ouvertes avec une ancienne version. */
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('mft-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || /\.apk$/i.test(url.pathname)) return;      // l'APK à télécharger ne passe jamais par ici : le navigateur le télécharge directement
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});

/* ---------------------------------------------------------- notifications « application fermée » (voir js/push.js et supabase/functions/send-push)
 * Le serveur envoie {title, body, url, tag} chiffré ; on l'affiche toujours (iPhone retire l'autorisation si une notification reçue n'est pas montrée). */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  const url = typeof d.url === 'string' && /^#\/(truck\/[0-9a-fA-F-]{36})?$/.test(d.url) ? d.url : '#/';
  const opts = {
    body: String(d.body || '').slice(0, 300), icon: 'assets/icon-192.png', badge: 'assets/favicon.png',
    tag: typeof d.tag === 'string' && d.tag ? d.tag.slice(0, 100) : undefined, renotify: false, data: { url },
  };
  e.waitUntil(self.registration.showNotification(String(d.title || 'LocalTruck').slice(0, 80), opts));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '#/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const mine = list.find((c) => c.url && c.url.startsWith(self.registration.scope));
    if (mine) { mine.postMessage({ type: 'open', url }); return mine.focus(); }
    return self.clients.openWindow(self.registration.scope + (url === '#/' ? '' : url));
  }));
});
