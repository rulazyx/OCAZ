// Service worker minimal : rend l'appli installable et l'ouvre même sans réseau.
// Toujours le réseau d'abord (pour avoir la dernière version), la copie locale seulement en secours.
const CACHE = 'crmzx-v1';
// « no-cache » : le navigateur redemande toujours au serveur si le fichier a changé, pour servir la dernière version.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
    const copie = res.clone();
    caches.open(CACHE).then(c => c.put(req, copie));
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match('./'))));
});
