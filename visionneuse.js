// Photos qui défilent : au doigt sur le téléphone (glisser), avec les flèches ou le clavier sur l'ordinateur.
// - Visionneuse.carrousel(images) : bande de photos à placer dans une carte ou une fiche.
//   Chaque image est une adresse, ou { chemin } pour une photo privée dont l'adresse arrive ensuite (Photos.hydrater).
// - Visionneuse.ouvrir(adresses, i) : photos en plein écran, à partir de la i-ème.
// Les clics et le défilement sont écoutés une seule fois pour toute la page : rien à brancher après un rendu.
const Visionneuse = (() => {
  const echap = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FLECHE = d => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="${d < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // `zoom` : un appui sur une photo l'ouvre en plein écran (fiche du véhicule). Sans, l'appui va à la carte.
  function carrousel(images, { alt = 'Photo', zoom = false, classe = '' } = {}) {
    const n = images.length;
    if (!n) return '';
    const img = (x, i) => {
      const src = typeof x === 'string' ? x : '';
      const chemin = typeof x === 'object' && x ? x.chemin : '';
      return `<div class="car-diapo"><img${src ? ` src="${echap(src)}"` : ''}${chemin ? ` data-chemin="${echap(chemin)}"` : ''} alt="${echap(alt)} ${i + 1}" loading="${i ? 'lazy' : 'eager'}" draggable="false"></div>`;
    };
    return `<div class="carrousel ${classe}"${zoom ? ' data-zoom' : ''}>
      <div class="car-piste" tabindex="0" aria-label="${echap(alt)} : ${n} photo${n > 1 ? 's' : ''}, glisser pour les voir">${images.map(img).join('')}</div>
      ${n > 1 ? `<button type="button" class="car-fleche car-prec" data-stop data-car="-1" aria-label="Photo précédente" hidden>${FLECHE(-1)}</button>
      <button type="button" class="car-fleche car-suiv" data-stop data-car="1" aria-label="Photo suivante">${FLECHE(1)}</button>
      <span class="car-compteur">1 / ${n}</span>` : ''}
    </div>`;
  }

  const index = piste => Math.round(piste.scrollLeft / Math.max(1, piste.clientWidth));
  function majEtat(car) {
    const piste = car.querySelector('.car-piste');
    const n = piste.children.length, i = Math.min(n - 1, index(piste));
    const c = car.querySelector('.car-compteur');
    if (c) c.textContent = `${i + 1} / ${n}`;
    const p = car.querySelector('.car-prec'), s = car.querySelector('.car-suiv');
    if (p) p.hidden = i <= 0;
    if (s) s.hidden = i >= n - 1;
  }
  function aller(car, pas, instant) {
    const piste = car.querySelector('.car-piste');
    const n = piste.children.length;
    const i = Math.max(0, Math.min(n - 1, index(piste) + pas));
    piste.scrollTo({ left: i * piste.clientWidth, behavior: instant ? 'instant' : 'smooth' });
  }

  // Plein écran : une fenêtre créée à la première ouverture.
  let dlg = null;
  function fenetre() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'visionneuse';
    dlg.setAttribute('aria-label', 'Photos');
    dlg.innerHTML = '<div class="vis-corps"></div><button type="button" class="vis-fermer" aria-label="Fermer">✕</button>';
    dlg.querySelector('.vis-fermer').addEventListener('click', () => dlg.close());
    // Un appui à côté de la photo (bande noire) ferme aussi.
    dlg.addEventListener('click', e => { if (e.target.classList.contains('car-diapo')) dlg.close(); });
    document.body.appendChild(dlg);
    return dlg;
  }
  function ouvrir(adresses, depart = 0) {
    const urls = adresses.filter(Boolean);
    if (!urls.length) return;
    const d = fenetre();
    d.querySelector('.vis-corps').innerHTML = carrousel(urls, { alt: 'Photo' });
    d.showModal();
    const car = d.querySelector('.carrousel');
    const piste = car.querySelector('.car-piste');
    piste.scrollLeft = Math.max(0, Math.min(urls.length - 1, depart)) * piste.clientWidth;
    majEtat(car);
    piste.focus({ preventScroll: true });
  }

  // Écoutes communes à toute la page.
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-car]');
    if (b) { e.preventDefault(); e.stopPropagation(); aller(b.closest('.carrousel'), Number(b.dataset.car)); return; }
    const car = e.target.closest('.carrousel[data-zoom]');
    const img = car && e.target.closest('.car-diapo img');
    if (img) {
      e.preventDefault();
      const imgs = [...car.querySelectorAll('.car-diapo img')];
      ouvrir(imgs.map(x => x.currentSrc || x.src), imgs.indexOf(img));
    }
  }, true);
  // Le défilement ne remonte pas jusqu'au document : on l'écoute à la capture.
  let attente = null;
  document.addEventListener('scroll', e => {
    const piste = e.target;
    if (!(piste instanceof Element) || !piste.classList.contains('car-piste')) return;
    cancelAnimationFrame(attente);
    attente = requestAnimationFrame(() => majEtat(piste.closest('.carrousel')));
  }, true);
  // Clavier : ← → sur une bande de photos qui a le focus (et toujours en plein écran).
  document.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const car = (dlg?.open && dlg.querySelector('.carrousel')) || document.activeElement?.closest?.('.carrousel');
    if (!car) return;
    e.preventDefault();
    aller(car, e.key === 'ArrowLeft' ? -1 : 1);
  });
  // Une fenêtre redimensionnée (téléphone tourné) garde la même photo à l'écran.
  let redim = null;
  window.addEventListener('resize', () => {
    clearTimeout(redim);
    redim = setTimeout(() => document.querySelectorAll('.carrousel').forEach(car => {
      const c = car.querySelector('.car-compteur');
      const i = c ? Number(c.textContent.split('/')[0]) - 1 : 0;
      const piste = car.querySelector('.car-piste');
      piste.scrollLeft = i * piste.clientWidth;
    }), 120);
  });

  return { carrousel, ouvrir };
})();
