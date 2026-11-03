// Photos des véhicules pour la mise en ligne : prises depuis le téléphone (3 minimum, 10 maximum),
// réduites avant l'envoi puis rangées dans le dossier privé « photos » de Supabase.
// La fiche du véhicule garde la liste des fichiers ; l'ordinateur les affiche à son tour.
const Photos = (() => {
  const MIN = 3, MAX = 10;
  const BUCKET = 'photos';
  const liens = new Map(); // chemin → lien temporaire signé
  let vehiculeId = null;
  let envois = 0;
  // Photo d'origine (avant cadrage, retouche et logo) des photos ajoutées depuis l'ouverture de l'appli :
  // recadrer repart d'elle, sans perte. Pour les autres, on recadre la photo enregistrée.
  const originaux = new Map(); // chemin → fichier

  // Prise de vue réservée au téléphone (écran tactile sans souris).
  const estTelephone = () => matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
  const deblocable = v => !!v && ['En préparation', 'En stock'].includes(v.statut);
  const liste = v => (v && v.photos) || [];

  const charger = src => new Promise((ok, ko) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => ok(i);
    i.onerror = () => ko(new Error("Cette image ne peut pas être lue."));
    i.src = src;
  });

  // Retouche automatique : niveaux étirés (photos sombres ou voilées), luminosité recentrée, couleurs un peu plus vives.
  function ameliorer(ctx, w, h) {
    const im = ctx.getImageData(0, 0, w, h), d = im.data;
    const histo = new Uint32Array(256);
    let n = 0, somme = 0;
    for (let i = 0; i < d.length; i += 16) { const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8; histo[l]++; n++; somme += l; }
    const seuil = n * 0.005;
    let bas = 0, haut = 255, cumul = 0;
    while (bas < 255 && (cumul += histo[bas]) < seuil) bas++;
    cumul = 0;
    while (haut > 0 && (cumul += histo[haut]) < seuil) haut--;
    if (haut - bas < 40) return; // image presque unie : on n'y touche pas
    const etire = Math.min(1.6, 255 / (haut - bas));
    const moyenne = Math.min(0.95, Math.max(0.05, ((somme / n) - bas) * etire / 255));
    const expo = Math.min(1.3, Math.max(0.75, 1 + (Math.log(0.5) / Math.log(moyenne) - 1) * 0.6)); // > 1 assombrit, < 1 éclaircit
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(Math.min(1, Math.max(0, (v - bas) * etire / 255)), expo);
    for (let i = 0; i < d.length; i += 4) {
      const r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
      const l = (r * 77 + g * 150 + b * 29) >> 8;
      d[i] = l + (r - l) * 1.1; d[i + 1] = l + (g - l) * 1.1; d[i + 2] = l + (b - l) * 1.1;
    }
    ctx.putImageData(im, 0, 0);
  }

  // Logo du garage en bas à droite, sur un fond blanc arrondi pour rester lisible.
  async function filigrane(ctx, w, h) {
    const logo = Param.get().garage.logo;
    if (!logo) return;
    const img = await charger(logo);
    const lw = Math.round(w * 0.16), lh = Math.round(lw * img.naturalHeight / img.naturalWidth);
    const m = Math.round(w * 0.02), p = Math.round(lw * 0.08);
    const x = w - lw - m - p * 2, y = h - lh - m - p * 2;
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, lw + p * 2, lh + p * 2, p * 1.5) : ctx.rect(x, y, lw + p * 2, lh + p * 2);
    ctx.fill();
    ctx.globalAlpha = 0.95;
    ctx.drawImage(img, x + p, y + p, lw, lh);
    ctx.restore();
  }

  const lireFichier = async fichier => {
    const src = URL.createObjectURL(fichier);
    try { return await charger(src); } finally { URL.revokeObjectURL(src); }
  };

  // Retouche et logo selon les réglages, puis JPEG.
  async function finir(c) {
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const r = Param.get().photos;
    if (r.ameliorer) ameliorer(ctx, c.width, c.height);
    if (r.logo) await filigrane(ctx, c.width, c.height).catch(() => {});
    return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82));
  }

  // Réduit la photo (1600 px de large au plus, JPEG) : environ 300 Ko au lieu de plusieurs Mo.
  // Cadrage sur le véhicule (format 4:3, voir cadrage.js), retouche et logo selon les réglages.
  // Renvoie { blob, boite } : boite = le véhicule trouvé sur la photo (sert à deviner la vue), sinon null.
  async function reduire(fichier) {
    const img = await lireFichier(fichier);
    if (Param.get().photos.cadrer) {
      const { cadre, boite } = await Cadrage.auto(img);
      return { blob: await finir(Cadrage.dessiner(img, cadre)), boite: boite || null };
    }
    const echelle = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * echelle);
    c.height = Math.round(img.naturalHeight * echelle);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { blob: await finir(c), boite: null };
  }

  // ---------- Vues : avant, côté, arrière toujours en premier, dans cet ordre ----------
  // La vue de chaque photo est gardée sur la fiche (v.vues = { chemin: 'avant' | 'cote' | 'arriere' | 'autre' }),
  // et la liste des photos est remise dans l'ordre à chaque changement : le site, le réseau et les PDF suivent.
  const VUES = ['avant', 'cote', 'arriere'];
  const LIB_VUE = { avant: 'Avant', cote: 'Côté', arriere: 'Arrière', autre: 'Autre' };
  const PROCHAINE = { avant: "de l'avant", cote: 'du côté', arriere: "de l'arrière" };
  const vuesDe = v => (v && v.vues) || {};
  const manquantes = v => { const pris = new Set(Object.values(vuesDe(v))); return VUES.filter(x => !pris.has(x)); };
  // Ordre : la 1re photo avant, la 1re côté, la 1re arrière, puis toutes les autres dans leur ordre d'ajout.
  function ordonner(photos, vues) {
    const tete = VUES.map(x => photos.find(p => vues[p] === x)).filter(Boolean);
    return tete.concat(photos.filter(p => !tete.includes(p)));
  }
  function trier(vid) {
    const v = db.get('vehicules', vid);
    if (!v) return;
    const vues = Object.fromEntries(Object.entries(vuesDe(v)).filter(([p]) => liste(v).includes(p)));
    const photos = ordonner(liste(v), vues);
    if (photos.join() !== liste(v).join() || Object.keys(vues).length !== Object.keys(vuesDe(v)).length)
      db.upsert('vehicules', { id: vid, photos, vues });
  }
  // Vue d'une nouvelle photo. Appareil photo : l'appli demande l'avant, puis le côté, puis l'arrière.
  // Galerie : un véhicule très allongé (plus de 1,9 fois plus large que haut) est vu de côté ; les autres
  // remplissent l'avant puis l'arrière s'ils manquent. Un appui sur l'étiquette de la photo corrige.
  function deviner(v, boite, camera) {
    const manque = manquantes(v);
    const allonge = boite && boite.w / boite.h > (camera ? 2.1 : 1.9);
    if (allonge && manque.includes('cote')) return 'cote';
    if (camera) return manque[0] || 'autre';
    return manque.find(x => x !== 'cote') || 'autre';
  }
  function changerVue(chemin) {
    const v = db.get('vehicules', vehiculeId);
    const cycle = [...VUES, 'autre'];
    const actuelle = vuesDe(v)[chemin] || 'autre';
    const suivante = cycle[(cycle.indexOf(actuelle) + 1) % cycle.length];
    // Une seule photo par vue : l'ancienne photo de cette vue passe en « Autre ».
    const vues = { ...vuesDe(v) };
    if (suivante !== 'autre') Object.keys(vues).forEach(p => { if (vues[p] === suivante) vues[p] = 'autre'; });
    vues[chemin] = suivante;
    db.upsert('vehicules', { id: vehiculeId, vues });
    trier(vehiculeId);
    rendre();
  }

  // Les photos déjà cadrées sur le véhicule finissent par « -c.jpg » : les autres (prises avant le cadrage) sont
  // recadrées une fois, en arrière-plan (recadrerAnciennes).
  const CADREE = /-c\.jpg$/;
  const nom = cadree => Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + (cadree ? '-c' : '') + '.jpg';

  // Remplace une photo enregistrée par une nouvelle version (floutée ou recadrée), à la même place dans la liste.
  async function remplacer(chemin, blob, { cadree = CADREE.test(chemin), vid = vehiculeId } = {}) {
    const nouveau = chemin.replace(/[^/]+$/, nom(cadree));
    const { error } = await Sync.client.storage.from(BUCKET).upload(nouveau, blob, { contentType: 'image/jpeg' });
    if (error) throw new Error('Photo non enregistrée : ' + error.message);
    const v = db.get('vehicules', vid);
    if (!v) throw new Error('Véhicule supprimé');
    const vues = { ...vuesDe(v) };
    if (vues[chemin]) { vues[nouveau] = vues[chemin]; delete vues[chemin]; }
    db.upsert('vehicules', { id: vid, photos: liste(v).map(p => p === chemin ? nouveau : p), vues });
    Sync.client.storage.from(BUCKET).remove([chemin]);
    liens.delete(chemin);
    return nouveau;
  }

  // Un seul écran à la fois dans la fenêtre Photos : la grille, le floutage ou le cadrage.
  function ecran(nom) {
    $('#photos-normal').hidden = nom !== 'normal';
    $('#photos-flou').hidden = nom !== 'flou';
    $('#photos-cadre').hidden = nom !== 'cadre';
    $('#dlg-photos .o-actions').hidden = nom !== 'normal';
  }

  // Floutage de la plaque (ou d'un visage) : on trace un ou plusieurs cadres sur la photo, la zone est pixelisée.
  let flou = null; // { chemin, img, zones: [{x,y,w,h}] en pixels de l'image }
  async function ouvrirFlou(chemin) {
    const [url] = await signer([chemin]);
    try { flou = { chemin, img: await charger(url), zones: [] }; }
    catch (e) { toast(e.message); return; }
    ecran('flou');
    dessinerFlou();
  }
  function pixeliser(ctx, z) {
    const bloc = Math.max(8, Math.round(Math.max(z.w, z.h) / 10));
    const pw = Math.max(1, Math.round(z.w / bloc)), phh = Math.max(1, Math.round(z.h / bloc));
    const t = document.createElement('canvas'); t.width = pw; t.height = phh;
    t.getContext('2d').drawImage(ctx.canvas, z.x, z.y, z.w, z.h, 0, 0, pw, phh);
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(t, 0, 0, pw, phh, z.x, z.y, z.w, z.h);
    ctx.restore();
  }
  function dessinerFlou(cadre) {
    const c = $('#flou-canvas'), { img, zones } = flou;
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    zones.forEach(z => pixeliser(ctx, z));
    if (cadre) { ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = Math.max(3, c.width / 300); ctx.strokeRect(cadre.x, cadre.y, cadre.w, cadre.h); }
    $('#flou-appliquer').disabled = !zones.length;
    $('#flou-annuler-zone').disabled = !zones.length;
  }
  function fermerFlou() { flou = null; ecran('normal'); }
  async function appliquerFlou() {
    const { chemin } = flou;
    $('#flou-appliquer').disabled = true;
    const blob = await new Promise(ok => $('#flou-canvas').toBlob(ok, 'image/jpeg', 0.85));
    try { await remplacer(chemin, blob); } catch (e) { toast(e.message); $('#flou-appliquer').disabled = false; return; }
    // La photo d'origine n'a pas le floutage : un recadrage repartira de la photo floutée.
    originaux.delete(chemin);
    fermerFlou();
    toast('Zone floutée');
    rendre();
  }
  function initFlou() {
    const c = $('#flou-canvas');
    let depart = null;
    const point = e => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height }; };
    const cadre = (a, b) => ({ x: Math.round(Math.min(a.x, b.x)), y: Math.round(Math.min(a.y, b.y)), w: Math.round(Math.abs(a.x - b.x)), h: Math.round(Math.abs(a.y - b.y)) });
    c.addEventListener('pointerdown', e => { if (!flou) return; depart = point(e); c.setPointerCapture(e.pointerId); e.preventDefault(); });
    c.addEventListener('pointermove', e => { if (depart) dessinerFlou(cadre(depart, point(e))); });
    c.addEventListener('pointerup', e => {
      if (!depart) return;
      const z = cadre(depart, point(e));
      depart = null;
      if (z.w > c.width / 60 && z.h > c.height / 80) flou.zones.push(z);
      dessinerFlou();
    });
    $('#flou-annuler-zone').addEventListener('click', () => { flou.zones.pop(); dessinerFlou(); });
    $('#flou-retour').addEventListener('click', fermerFlou);
    $('#flou-appliquer').addEventListener('click', () => appliquerFlou().catch(err => toast(err.message)));
  }

  // Cadrage d'une photo : glisser pour déplacer, pincer (ou molette, ou curseur) pour zoomer ou dézoomer.
  // « Sur le véhicule » recadre automatiquement, « Toute la photo » dézoome pour tout voir.
  let cad = null; // { chemin, img, mini, s, original, cadre, base, zmin }
  const ZMAX = 4;
  async function ouvrirCadre(chemin) {
    let img, original = originaux.get(chemin) || null;
    try {
      if (original) img = await lireFichier(original);
      else { const [url] = await signer([chemin]); img = await charger(url); }
    } catch (e) { toast(e.message); return; }
    // Copie réduite pour l'aperçu : fluide au doigt même avec une photo de 12 Mpx.
    const s = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
    const mini = document.createElement('canvas');
    mini.width = Math.round(img.naturalWidth * s); mini.height = Math.round(img.naturalHeight * s);
    mini.getContext('2d').drawImage(img, 0, 0, mini.width, mini.height);
    const base = Cadrage.centre(img);
    cad = { chemin, img, mini, s, original, base, zmin: Math.min(1, base.w / Cadrage.entier(img).w) * 0.8, cadre: { ...base } };
    ecran('cadre');
    $('#cadre-etat').textContent = original ? '' : 'Photo déjà enregistrée : la retouche et le logo restent tels quels.';
    dessinerCadre();
    // Photo d'origine : on part du cadrage automatique. Photo déjà enregistrée (déjà cadrée) : on part de la photo entière.
    if (original) cadrerAuto();
  }
  const zoomDe = c => cad.base.w / c.w;
  function fixerZoom(z, cx, cy) {
    const c = cad.cadre;
    z = Math.min(ZMAX, Math.max(cad.zmin, z));
    cx ??= c.x + c.w / 2; cy ??= c.y + c.h / 2;
    const w = cad.base.w / z, h = w / Cadrage.RATIO;
    cad.cadre = { x: cx - w / 2, y: cy - h / 2, w, h };
    borner();
  }
  // Le centre du cadre reste sur la photo : on ne peut pas la faire sortir complètement.
  function borner() {
    const c = cad.cadre, iw = cad.img.naturalWidth, ih = cad.img.naturalHeight;
    const cx = Math.min(iw, Math.max(0, c.x + c.w / 2)), cy = Math.min(ih, Math.max(0, c.y + c.h / 2));
    c.x = cx - c.w / 2; c.y = cy - c.h / 2;
  }
  function dessinerCadre() {
    const { cadre: c, s } = cad;
    Cadrage.dessiner(cad.mini, { x: c.x * s, y: c.y * s, w: c.w * s, h: c.h * s }, 800, 600, $('#cadre-canvas'));
    const z = $('#cadre-zoom');
    z.min = cad.zmin; z.max = ZMAX; z.value = zoomDe(c);
  }
  async function cadrerAuto() {
    const b = $('#cadre-auto');
    b.disabled = true; b.textContent = 'Recherche du véhicule…';
    const { cadre, trouve } = await Cadrage.auto(cad.img);
    b.disabled = false; b.textContent = 'Sur le véhicule';
    if (!cad) return;
    if (!trouve) toast('Véhicule non trouvé sur la photo : cadre-la à la main.');
    cad.cadre = cadre;
    dessinerCadre();
  }
  function fermerCadre() { cad = null; ecran('normal'); }
  async function appliquerCadre() {
    const { chemin, img, original, cadre } = cad;
    $('#cadre-appliquer').disabled = true;
    try {
      const c = Cadrage.dessiner(img, cadre);
      // Depuis l'origine : retouche et logo refaits. Depuis la photo enregistrée : ils y sont déjà.
      const blob = original ? await finir(c) : await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.85));
      const nouveau = await remplacer(chemin, blob, { cadree: true });
      originaux.delete(chemin);
      if (original) originaux.set(nouveau, original);
    } catch (e) { toast(e.message); return; }
    finally { $('#cadre-appliquer').disabled = false; }
    fermerCadre();
    toast('Photo recadrée');
    rendre();
  }
  function initCadre() {
    const c = $('#cadre-canvas');
    const doigts = new Map(); // pointerId → { x, y }
    let pince = null; // { d, z } au début du pincement
    const dist = () => { const [a, b] = [...doigts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    c.addEventListener('pointerdown', e => {
      if (!cad) return;
      c.setPointerCapture(e.pointerId);
      doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (doigts.size === 2) pince = { d: dist(), z: zoomDe(cad.cadre) };
      e.preventDefault();
    });
    c.addEventListener('pointermove', e => {
      const avant = doigts.get(e.pointerId);
      if (!cad || !avant) return;
      const maintenant = { x: e.clientX, y: e.clientY };
      doigts.set(e.pointerId, maintenant);
      if (doigts.size >= 2 && pince) fixerZoom(pince.z * dist() / Math.max(1, pince.d));
      else {
        // Glisser : la photo suit le doigt.
        const k = cad.cadre.w / c.getBoundingClientRect().width;
        cad.cadre.x -= (maintenant.x - avant.x) * k;
        cad.cadre.y -= (maintenant.y - avant.y) * k;
        borner();
      }
      dessinerCadre();
    });
    const lever = e => { doigts.delete(e.pointerId); if (doigts.size < 2) pince = null; };
    c.addEventListener('pointerup', lever);
    c.addEventListener('pointercancel', lever);
    c.addEventListener('wheel', e => { if (!cad) return; e.preventDefault(); fixerZoom(zoomDe(cad.cadre) * Math.exp(-e.deltaY * 0.0015)); dessinerCadre(); }, { passive: false });
    $('#cadre-zoom').addEventListener('input', e => { if (cad) { fixerZoom(+e.target.value); dessinerCadre(); } });
    $('#cadre-auto').addEventListener('click', () => cad && cadrerAuto());
    $('#cadre-entier').addEventListener('click', () => { if (cad) { cad.cadre = Cadrage.entier(cad.img); dessinerCadre(); } });
    $('#cadre-retour').addEventListener('click', fermerCadre);
    $('#cadre-appliquer').addEventListener('click', () => cad && appliquerCadre());
  }

  // Adresses temporaires (1 h) des photos privées, redemandées après 50 minutes.
  const DUREE = 3600, VALIDE = 50 * 60 * 1000;
  const lien = p => { const l = liens.get(p); return l && Date.now() - l.t < VALIDE ? l.url : ''; };
  async function signer(chemins) {
    const manquants = [...new Set(chemins.filter(p => p && !lien(p)))];
    if (manquants.length && Sync.client && Sync.role) {
      const { data } = await Sync.client.storage.from(BUCKET).createSignedUrls(manquants, DUREE);
      (data || []).forEach(d => { if (d.signedUrl) liens.set(d.path, { url: d.signedUrl, t: Date.now() }); });
    }
    return chemins.map(lien);
  }

  // Remplit les photos d'un carrousel rendu avant d'avoir leurs adresses (cartes du stock, véhicules partenaires).
  async function hydrater(racine) {
    const imgs = [...racine.querySelectorAll('img[data-chemin]:not([src])')];
    if (!imgs.length) return;
    let urls = [];
    try { urls = await signer(imgs.map(i => i.dataset.chemin)); } catch (e) { /* hors ligne */ }
    imgs.forEach((i, k) => { if (urls[k]) i.src = urls[k]; else i.closest('.car-diapo')?.classList.add('vide'); });
  }

  // Image recadrée en JPEG 4:3 (documents PDF et photos d'exemple). null si l'image ne peut pas être lue.
  async function jpeg(src, w = 1000, h = 750) {
    try {
      const i = await charger(src);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const k = Math.max(w / i.naturalWidth, h / i.naturalHeight);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(i, (w - i.naturalWidth * k) / 2, (h - i.naturalHeight * k) / 2, i.naturalWidth * k, i.naturalHeight * k);
      return c;
    } catch (e) { return null; }
  }

  // Photo principale d'un véhicule (documents) : la 1re photo prise, sinon la photo du modèle.
  async function premiere(v) {
    const ph = liste(v);
    let src = v?.image || '';
    if (ph.length) { try { const [u] = await signer([ph[0]]); if (u) src = u; } catch (e) { /* hors ligne */ } }
    // Copie recadrée intégrée au document : le PDF la reprend telle quelle.
    const c = src && await jpeg(src);
    try { return c ? c.toDataURL('image/jpeg', 0.88) : src; } catch (e) { return src; }
  }

  // Galerie affichée sur la fiche du véhicule (téléphone et ordinateur).
  async function galerie(el, v) {
    const ph = liste(v);
    if (!ph.length) { el.innerHTML = '<span class="hint">Pas encore de photos. Elles se prennent depuis le téléphone, une fois le véhicule en préparation.</span>'; return; }
    // Photos qui défilent (doigt ou flèches) ; un appui ouvre le plein écran.
    const urls = await signer(ph).catch(() => []);
    if (!urls.some(Boolean)) { el.innerHTML = '<span class="hint">Connecte-toi pour voir les photos.</span>'; return; }
    el.innerHTML = Visionneuse.carrousel(urls.filter(Boolean), { alt: vehiculeNom(v) + ', photo', zoom: true, classe: 'car-fiche' });
  }

  // Fiche du véhicule : la photo choisie en grand, les miniatures en dessous (un appui choisit la photo).
  // La grande photo défile au doigt ou avec les flèches ; un appui l'ouvre en plein écran.
  async function vitrine(el, v) {
    const ph = liste(v);
    if (!ph.length) {
      el.innerHTML = v?.image ? `<div class="vf-grande modele"><img src="${esc(v.image)}" alt="" onerror="this.remove()"></div>`
        : `<div class="vf-grande vide"><span>📷 Pas encore de photos${deblocable(v) ? ' : elles se prennent depuis le téléphone' : ''}</span></div>`;
      return;
    }
    const urls = (await signer(ph).catch(() => [])).filter(Boolean);
    if (!urls.length) { el.innerHTML = '<div class="vf-grande vide"><span>Connecte-toi pour voir les photos.</span></div>'; return; }
    const vues = vuesDe(v);
    const nomV = vehiculeNom(v);
    el.innerHTML = `<div class="vf-grande"><img id="vf-img" src="${esc(urls[0])}" alt="${esc(nomV)}, photo 1" draggable="false">
        ${urls.length > 1 ? `<button type="button" class="car-fleche car-prec" data-vf="-1" aria-label="Photo précédente">‹</button>
        <button type="button" class="car-fleche car-suiv" data-vf="1" aria-label="Photo suivante">›</button>` : ''}
        <span class="car-compteur" id="vf-n">1 / ${urls.length}</span></div>
      ${urls.length > 1 ? `<div class="vf-miniatures">${urls.map((u, i) => `<button type="button" data-vfi="${i}" class="${i ? '' : 'active'}" aria-label="Photo ${i + 1}">
        <img src="${esc(u)}" alt="" loading="lazy">${vues[ph[i]] && vues[ph[i]] !== 'autre' ? `<span>${LIB_VUE[vues[ph[i]]]}</span>` : ''}</button>`).join('')}</div>` : ''}`;
    let i = 0;
    const choisir = k => {
      i = (k + urls.length) % urls.length;
      el.querySelector('#vf-img').src = urls[i];
      el.querySelector('#vf-img').alt = `${nomV}, photo ${i + 1}`;
      el.querySelector('#vf-n').textContent = `${i + 1} / ${urls.length}`;
      el.querySelectorAll('[data-vfi]').forEach(b => b.classList.toggle('active', +b.dataset.vfi === i));
      el.querySelector(`[data-vfi="${i}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    };
    el.querySelectorAll('[data-vfi]').forEach(b => b.addEventListener('click', () => choisir(+b.dataset.vfi)));
    el.querySelectorAll('[data-vf]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); choisir(i + +b.dataset.vf); }));
    // Glisser sur la grande photo : photo suivante ou précédente. Un simple appui : plein écran.
    const grande = el.querySelector('.vf-grande');
    let x0 = null;
    grande.addEventListener('pointerdown', e => { if (!e.target.closest('[data-vf]')) x0 = e.clientX; });
    grande.addEventListener('pointerup', e => {
      if (x0 === null) return;
      const dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 40 && urls.length > 1) choisir(i + (dx < 0 ? 1 : -1));
      else if (Math.abs(dx) < 8) Visionneuse.ouvrir(urls, i);
    });
  }

  // Écran de prise de vue.
  async function rendre() {
    const v = db.get('vehicules', vehiculeId);
    const ph = liste(v);
    $('#photos-titre').textContent = 'Photos · ' + vehiculeNom(v);
    const reste = MIN - ph.length;
    $('#photos-compteur').innerHTML = `<strong>${ph.length} / ${MAX}</strong> ${reste > 0 ? `· encore ${reste} minimum` : '· minimum atteint'}${envois ? ` · envoi de ${envois} photo(s)…` : ''}`;
    $('#photos-compteur').className = 'ph-compteur' + (reste > 0 ? ' manque' : ' ok');
    const urls = await signer(ph);
    const vues = vuesDe(v), manque = manquantes(v);
    $('#photos-guide').innerHTML = manque.length
      ? `Photos à faire en premier : ${VUES.map(x => `<span class="${manque.includes(x) ? '' : 'fait'}">${manque.includes(x) ? '' : '✓ '}${LIB_VUE[x]}</span>`).join(' · ')}. Elles s'affichent toujours dans cet ordre.`
      : '✓ Avant, côté et arrière : elles s\'affichent en premier, dans cet ordre.';
    $('#photos-prendre').firstChild.textContent = manque.length ? `📷 Photo ${PROCHAINE[manque[0]]}` : '📷 Prendre une photo';
    $('#photos-grille').innerHTML = ph.map((p, i) => `<div class="ph"><img src="${esc(urls[i])}" alt="Photo ${i + 1}">
      <button type="button" class="ph-vue${vues[p] && vues[p] !== 'autre' ? ' ok' : ''}" data-vue="${esc(p)}" aria-label="Vue de la photo : appuie pour changer">${LIB_VUE[vues[p] || 'autre']}</button>
      <button type="button" class="ph-suppr" data-suppr="${esc(p)}" aria-label="Supprimer la photo">✕</button>
      <span class="ph-outils"><button type="button" data-cadre="${esc(p)}">Cadrer</button><button type="button" data-flou="${esc(p)}">Flouter</button></span></div>`).join('')
      + Array.from({ length: envois }, () => '<div class="ph envoi"><span class="spin"></span></div>').join('');
    const plein = ph.length + envois >= MAX;
    $('#photos-prendre').classList.toggle('desactive', plein);
    $('#photos-galerie').classList.toggle('desactive', plein);
    $('#photos-terminer').disabled = ph.length < MIN || envois > 0;
    const r = Param.get().photos, logo = !!Param.get().garage.logo;
    $('#ph-cadrer').checked = r.cadrer;
    $('#ph-ameliorer').checked = r.ameliorer;
    $('#ph-logo').checked = r.logo && logo;
    $('#ph-logo').disabled = !logo;
    $('#ph-logo-hint').hidden = logo;
  }

  function ouvrir(id) {
    if (!Sync.role) { toast("Les photos sont envoyées en ligne : connecte-toi d'abord (⚙️ > Compte)."); return; }
    vehiculeId = id;
    fermerFlou();
    cad = null;
    // La reconnaissance du véhicule se charge pendant qu'on prend la première photo.
    if (Param.get().photos.cadrer) Cadrage.charger().catch(() => {});
    rendre();
    $('#dlg-photos').showModal();
  }

  async function ajouter(fichiers, camera = false) {
    const v = db.get('vehicules', vehiculeId);
    const place = MAX - liste(v).length - envois;
    const lot = [...fichiers].slice(0, Math.max(0, place));
    if (fichiers.length > lot.length) toast(`${MAX} photos maximum : ${fichiers.length - lot.length} photo(s) ignorée(s).`);
    envois += lot.length;
    rendre();
    for (const f of lot) {
      try {
        const { blob, boite } = await reduire(f);
        const chemin = `${Sync.entreprise.id}/${vehiculeId}/${nom(Param.get().photos.cadrer)}`;
        const { error } = await Sync.client.storage.from(BUCKET).upload(chemin, blob, { contentType: 'image/jpeg' });
        if (error) throw new Error(error.message);
        const actuel = db.get('vehicules', vehiculeId);
        const vue = deviner(actuel, boite, camera);
        db.upsert('vehicules', { id: vehiculeId, photos: liste(actuel).concat(chemin), vues: { ...vuesDe(actuel), [chemin]: vue } });
        trier(vehiculeId);
        originaux.set(chemin, f);
      } catch (err) {
        toast("Photo non envoyée : " + err.message);
      } finally {
        envois--;
        rendre();
      }
    }
  }

  async function supprimer(chemin) {
    if (!confirm('Supprimer cette photo ?')) return;
    await Sync.client.storage.from(BUCKET).remove([chemin]);
    const v = db.get('vehicules', vehiculeId);
    const vues = { ...vuesDe(v) };
    delete vues[chemin];
    db.upsert('vehicules', { id: vehiculeId, photos: liste(v).filter(p => p !== chemin), vues });
    rendre();
  }

  function init() {
    ['#photos-input', '#photos-input-galerie'].forEach(s => $(s).addEventListener('change', e => {
      if (e.target.files.length) ajouter(e.target.files, s === '#photos-input');
      e.target.value = '';
    }));
    $('#photos-grille').addEventListener('click', e => {
      if (e.target.dataset.suppr) supprimer(e.target.dataset.suppr);
      if (e.target.dataset.flou) ouvrirFlou(e.target.dataset.flou);
      if (e.target.dataset.cadre) ouvrirCadre(e.target.dataset.cadre);
      if (e.target.dataset.vue) changerVue(e.target.dataset.vue);
    });
    ['cadrer', 'ameliorer', 'logo'].forEach(k => $('#ph-' + k).addEventListener('change', e => Param.save({ photos: { ...Param.get().photos, [k]: e.target.checked } })));
    initFlou();
    initCadre();
    const fermer = () => { $('#dlg-photos').close(); render(); };
    $('#photos-terminer').addEventListener('click', () => { toast('Photos enregistrées sur la fiche du véhicule'); fermer(); });
    $('#photos-fermer').addEventListener('click', () => {
      if (flou) { fermerFlou(); return; }
      if (cad) { fermerCadre(); return; }
      const n = liste(db.get('vehicules', vehiculeId)).length;
      if (n < MIN && !confirm(`Il faut au moins ${MIN} photos pour la mise en ligne (${n} pour l'instant). Fermer quand même ?`)) return;
      fermer();
    });
  }

  // Photos prises avant le cadrage automatique : recadrées une fois sur le véhicule, en arrière-plan, à la connexion
  // (véhicules non vendus). Une photo où aucun véhicule n'est trouvé n'est pas touchée et n'est plus réessayée.
  let migration = false, indisponible = false;
  const ESSAYEES = 'ocaz-cadrage-essaye';
  async function recadrerAnciennes() {
    if (migration || indisponible || !Param.get().photos.cadrer || !Sync.client || !Sync.role || !Sync.entreprise?.id) return;
    let essayees = [];
    try { essayees = JSON.parse(localStorage.getItem(ESSAYEES)) || []; } catch (e) { /* rien */ }
    const aFaire = db.all('vehicules').filter(v => v.statut !== 'Vendu')
      .flatMap(v => liste(v).filter(p => !CADREE.test(p) && !/exemple\.jpg$/.test(p) && !essayees.includes(p)).map(p => [v.id, p]));
    if (!aFaire.length) return;
    migration = true;
    let n = 0;
    try {
      for (const [vid, p] of aFaire) {
        // La photo a pu changer entre-temps (supprimée, floutée, recadrée à la main).
        if (!liste(db.get('vehicules', vid)).includes(p)) continue;
        let url, img;
        try { [url] = await signer([p]); img = url && await charger(url); } catch (e) { continue; }
        if (!img) continue;
        const { cadre, trouve, erreur } = await Cadrage.auto(img);
        if (erreur) { indisponible = true; break; } // reconnaissance indisponible : nouvel essai à la prochaine ouverture
        if (!trouve) { essayees.push(p); continue; }
        const c = Cadrage.dessiner(img, cadre);
        const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.85));
        try { await remplacer(p, blob, { cadree: true, vid }); n++; } catch (e) { /* hors ligne : plus tard */ }
      }
    } finally {
      migration = false;
      try { localStorage.setItem(ESSAYEES, JSON.stringify(essayees.slice(-300))); } catch (e) { /* rien */ }
    }
    if (n) { toast(`${n} photo${n > 1 ? 's' : ''} recadrée${n > 1 ? 's' : ''} sur le véhicule`); render(); }
  }

  return { vitrine, trier, recadrerAnciennes, estTelephone, deblocable, galerie, hydrater, premiere, jpeg, BUCKET, ouvrir, init, MIN, MAX };
})();
