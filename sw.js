// Service worker : rend l'appli installable, l'ouvre vite et même sans réseau.
// Les fichiers viennent de la copie gardée sur l'appareil ; le réseau seulement pour ce qui n'y est pas encore.
// La copie est jetée quand une nouvelle version est en ligne (maj.js compare version.json), puis se reremplit.
const CACHE = 'ocaz-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(cles => Promise.all(cles.filter(c => c !== CACHE).map(c => caches.delete(c)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // Autres sites (Supabase, photos, bibliothèques en ligne) et lecture de la version en ligne : jamais de copie.
  if (req.method !== 'GET' || url.origin !== location.origin || url.searchParams.has('frais')) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const copie = await c.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (copie) return copie;
    try {
      // « no-cache » : le navigateur redemande au serveur, pour ne pas remplir la copie avec un fichier périmé.
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok && res.type === 'basic') c.put(req, res.clone());
      return res;
    } catch (err) {
      return (await c.match('./')) || Response.error();
    }
  }));
});
