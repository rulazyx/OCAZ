// Mise à jour en direct : quand une nouvelle version d'Ocaz est en ligne, les pages déjà ouvertes
// (revendeur, apporteur, admin, appli installée) affichent un bandeau « Mettre à jour ».
// Comment on le sait : on demande au serveur l'empreinte (ETag / date) de la page et de ses fichiers
// JS et CSS. Si elle a changé depuis l'ouverture, c'est qu'une nouvelle version a été publiée.
// Rien à faire à la main à chaque mise en ligne.
(function () {
  if (!/^https?:$/.test(location.protocol)) return;
  const INTERVALLE = 5 * 60 * 1000; // toutes les 5 minutes, et à chaque retour sur l'appli
  const fichiers = () => {
    const urls = [location.pathname];
    document.querySelectorAll('script[src], link[rel="stylesheet"][href]').forEach(el => {
      const u = new URL(el.src || el.href, location.href);
      if (u.origin === location.origin) urls.push(u.pathname);
    });
    urls.push(new URL('sw.js', location.href).pathname);
    return [...new Set(urls)];
  };
  const empreinte = async () => {
    const parts = await Promise.all(fichiers().map(async u => {
      const r = await fetch(u, { method: 'HEAD', cache: 'no-store' });
      if (!r.ok) return u + ':' + r.status;
      return u + ':' + (r.headers.get('etag') || r.headers.get('last-modified') || r.headers.get('content-length') || '');
    }));
    return parts.join('|');
  };

  let reference = null, enCours = false, affiche = false;
  const verifier = async () => {
    if (enCours || affiche || document.hidden || !navigator.onLine) return;
    enCours = true;
    try {
      const e = await empreinte();
      if (reference === null) reference = e;
      else if (e !== reference) montrer();
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
        // On recharge les fichiers en passant outre le cache du navigateur, pour ne pas rouvrir l'ancienne version.
        await Promise.all(fichiers().map(u => fetch(u, { cache: 'reload' }).catch(() => {})));
        const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
      } catch (_) {}
      location.reload();
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
