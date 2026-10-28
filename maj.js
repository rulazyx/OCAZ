// Mise à jour en direct : quand une nouvelle version d'Ocaz est en ligne, les pages déjà ouvertes
// (revendeur, apporteur, admin, appli installée) affichent un bandeau « Mettre à jour ».
// Comment on le sait : le fichier version.json change à chaque mise en ligne (réécrit tout seul par GitHub,
// voir .github/workflows/version.yml). Une seule petite requête toutes les 5 minutes, au lieu de tous les fichiers.
// Le téléphone garde une copie de l'appli (sw.js) pour l'ouvrir vite : au démarrage, si cette copie est plus
// ancienne que la version en ligne, on la jette et on recharge tout de suite.
(function () {
  if (!/^https?:$/.test(location.protocol)) return;
  const INTERVALLE = 5 * 60 * 1000; // toutes les 5 minutes, et à chaque retour sur l'appli
  const VERSION = new URL('version.json', location.href).pathname;
  // « frais » : sw.js laisse passer cette adresse sans copie, pour lire la version vraiment en ligne.
  const enLigne = () => lire(VERSION + '?frais=' + Date.now(), 'no-store');
  const lire = async (u, cache) => {
    const r = await fetch(u, { cache });
    if (!r.ok) throw new Error('version ' + r.status);
    return String((await r.json()).version || '');
  };

  // Jette la copie gardée par le téléphone et recharge : tous les fichiers reviennent du serveur.
  const appliquer = async () => {
    try { sessionStorage.setItem('ocaz-maj', String(Date.now())); } catch (_) {}
    try { if (window.caches) await Promise.all((await caches.keys()).map(k => caches.delete(k))); } catch (_) {}
    location.reload();
  };
  // Garde-fou : jamais deux rechargements automatiques en moins d'une minute.
  const rechargeRecente = () => { try { return Date.now() - Number(sessionStorage.getItem('ocaz-maj') || 0) < 60000; } catch (_) { return true; } };

  let reference = null, enCours = false, affiche = false;
  const verifier = async () => {
    if (enCours || affiche || document.hidden || !navigator.onLine) return;
    enCours = true;
    try {
      const derniere = await enLigne();
      if (reference === null) {
        reference = derniere;
        // Version des fichiers ouverts = version.json tel que la copie du téléphone l'a gardé.
        if (navigator.serviceWorker?.controller && !rechargeRecente() && await lire(VERSION, 'default') !== derniere) { await appliquer(); return; }
      } else if (derniere !== reference) montrer();
    } catch (_) { /* hors ligne ou serveur indisponible : on réessaiera */ }
    enCours = false;
  };

  const montrer = () => {
    affiche = true;
    const style = document.createElement('style');
    style.textContent = `
#ocaz-maj { position: fixed; z-index: 2147483000; left: 50%; transform: translateX(-50%);
  top: calc(10px + env(safe-area-inset-top)); width: min(560px, calc(100% - 20px)); box-sizing: border-box;
  display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 14px; border-radius: 14px;
  background: #1c1f24; color: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.35); border: 1px solid #2a2d33;
  font: 500 14px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
#ocaz-maj .txt { flex: 1; min-width: 0; }
#ocaz-maj .txt small { display: block; color: #9a9ea6; font-weight: 400; font-size: 12.5px; }
#ocaz-maj button { font: inherit; cursor: pointer; border: 0; border-radius: 10px; }
#ocaz-maj .go { background: #f59e0b; color: #111; font-weight: 700; padding: 9px 14px; white-space: nowrap; }
#ocaz-maj .non { background: transparent; color: #9a9ea6; padding: 6px 8px; font-size: 18px; line-height: 1; }
@media print { #ocaz-maj { display: none; } }`;
    document.head.appendChild(style);
    const b = document.createElement('div');
    b.id = 'ocaz-maj';
    b.setAttribute('role', 'status');
    b.innerHTML = '<div class="txt">Nouvelle version d\'Ocaz disponible<small>Pensez à enregistrer ce que vous êtes en train de saisir.</small></div>'
      + '<button class="go" type="button">Mettre à jour</button>'
      + '<button class="non" type="button" aria-label="Plus tard" title="Plus tard">✕</button>';
    document.body.appendChild(b);
    b.querySelector('.go').addEventListener('click', async () => {
      b.querySelector('.go').textContent = 'Mise à jour…';
      try {
        const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
      } catch (_) {}
      appliquer();
    });
    // « Plus tard » : le bandeau revient dans 30 minutes.
    b.querySelector('.non').addEventListener('click', () => {
      b.remove(); style.remove();
      setTimeout(montrer, 30 * 60 * 1000);
    });
  };

  verifier();
  setInterval(verifier, INTERVALLE);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) verifier(); });
  window.addEventListener('online', verifier);
})();
