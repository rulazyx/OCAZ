// Photos des véhicules pour la mise en ligne : prises depuis le téléphone (3 minimum, 10 maximum),
// réduites avant l'envoi puis rangées dans le dossier privé « photos » de Supabase.
// La fiche du véhicule garde la liste des fichiers ; l'ordinateur les affiche à son tour.
const Photos = (() => {
  const MIN = 3, MAX = 10;
  const BUCKET = 'photos';
  const liens = new Map(); // chemin → lien temporaire signé
  let vehiculeId = null;
  let envois = 0;

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

  // Réduit la photo (1600 px de large au plus, JPEG) : environ 300 Ko au lieu de plusieurs Mo. Retouche et logo selon les réglages.
  async function reduire(fichier) {
    const src = URL.createObjectURL(fichier);
    const img = await charger(src);
    const echelle = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * echelle);
    c.height = Math.round(img.naturalHeight * echelle);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(src);
    const r = Param.get().photos;
    if (r.ameliorer) ameliorer(ctx, c.width, c.height);
    if (r.logo) await filigrane(ctx, c.width, c.height).catch(() => {});
    return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82));
  }

  // Floutage de la plaque (ou d'un visage) : on trace un ou plusieurs cadres sur la photo, la zone est pixelisée.
  let flou = null; // { chemin, img, zones: [{x,y,w,h}] en pixels de l'image }
  async function ouvrirFlou(chemin) {
    const [url] = await signer([chemin]);
    try { flou = { chemin, img: await charger(url), zones: [] }; }
    catch (e) { toast(e.message); return; }
    $('#photos-flou').hidden = false;
    $('#photos-normal').hidden = true;
    $('#dlg-photos .o-actions').hidden = true;
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
  function fermerFlou() { flou = null; $('#photos-flou').hidden = true; $('#photos-normal').hidden = false; $('#dlg-photos .o-actions').hidden = false; }
  async function appliquerFlou() {
    const { chemin } = flou;
    $('#flou-appliquer').disabled = true;
    const blob = await new Promise(ok => $('#flou-canvas').toBlob(ok, 'image/jpeg', 0.85));
    const nouveau = chemin.replace(/[^/]+$/, Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.jpg');
    const { error } = await Sync.client.storage.from(BUCKET).upload(nouveau, blob, { contentType: 'image/jpeg' });
    if (error) { toast('Photo non enregistrée : ' + error.message); $('#flou-appliquer').disabled = false; return; }
    const v = db.get('vehicules', vehiculeId);
    db.upsert('vehicules', { id: vehiculeId, photos: liste(v).map(p => p === chemin ? nouveau : p) });
    Sync.client.storage.from(BUCKET).remove([chemin]);
    liens.delete(chemin);
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

  // Écran de prise de vue.
  async function rendre() {
    const v = db.get('vehicules', vehiculeId);
    const ph = liste(v);
    $('#photos-titre').textContent = 'Photos · ' + vehiculeNom(v);
    const reste = MIN - ph.length;
    $('#photos-compteur').innerHTML = `<strong>${ph.length} / ${MAX}</strong> ${reste > 0 ? `· encore ${reste} minimum` : '· minimum atteint'}${envois ? ` · envoi de ${envois} photo(s)…` : ''}`;
    $('#photos-compteur').className = 'ph-compteur' + (reste > 0 ? ' manque' : ' ok');
    const urls = await signer(ph);
    $('#photos-grille').innerHTML = ph.map((p, i) => `<div class="ph"><img src="${esc(urls[i])}" alt="Photo ${i + 1}">
      <button type="button" class="ph-suppr" data-suppr="${esc(p)}" aria-label="Supprimer la photo">✕</button>
      <button type="button" class="ph-flou" data-flou="${esc(p)}">Flouter</button></div>`).join('')
      + Array.from({ length: envois }, () => '<div class="ph envoi"><span class="spin"></span></div>').join('');
    const plein = ph.length + envois >= MAX;
    $('#photos-prendre').classList.toggle('desactive', plein);
    $('#photos-galerie').classList.toggle('desactive', plein);
    $('#photos-terminer').disabled = ph.length < MIN || envois > 0;
    const r = Param.get().photos, logo = !!Param.get().garage.logo;
    $('#ph-ameliorer').checked = r.ameliorer;
    $('#ph-logo').checked = r.logo && logo;
    $('#ph-logo').disabled = !logo;
    $('#ph-logo-hint').hidden = logo;
  }

  function ouvrir(id) {
    if (!Sync.role) { toast("Les photos sont envoyées en ligne : connecte-toi d'abord (⚙️ > Compte)."); return; }
    vehiculeId = id;
    fermerFlou();
    rendre();
    $('#dlg-photos').showModal();
  }

  async function ajouter(fichiers) {
    const v = db.get('vehicules', vehiculeId);
    const place = MAX - liste(v).length - envois;
    const lot = [...fichiers].slice(0, Math.max(0, place));
    if (fichiers.length > lot.length) toast(`${MAX} photos maximum : ${fichiers.length - lot.length} photo(s) ignorée(s).`);
    envois += lot.length;
    rendre();
    for (const f of lot) {
      try {
        const blob = await reduire(f);
        const chemin = `${Sync.entreprise.id}/${vehiculeId}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.jpg`;
        const { error } = await Sync.client.storage.from(BUCKET).upload(chemin, blob, { contentType: 'image/jpeg' });
        if (error) throw new Error(error.message);
        const actuel = db.get('vehicules', vehiculeId);
        db.upsert('vehicules', { id: vehiculeId, photos: liste(actuel).concat(chemin) });
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
    db.upsert('vehicules', { id: vehiculeId, photos: liste(v).filter(p => p !== chemin) });
    rendre();
  }

  function init() {
    ['#photos-input', '#photos-input-galerie'].forEach(s => $(s).addEventListener('change', e => {
      if (e.target.files.length) ajouter(e.target.files);
      e.target.value = '';
    }));
    $('#photos-grille').addEventListener('click', e => {
      if (e.target.dataset.suppr) supprimer(e.target.dataset.suppr);
      if (e.target.dataset.flou) ouvrirFlou(e.target.dataset.flou);
    });
    ['ameliorer', 'logo'].forEach(k => $('#ph-' + k).addEventListener('change', e => Param.save({ photos: { ...Param.get().photos, [k]: e.target.checked } })));
    initFlou();
    const fermer = () => { $('#dlg-photos').close(); render(); };
    $('#photos-terminer').addEventListener('click', () => { toast('Photos enregistrées sur la fiche du véhicule'); fermer(); });
    $('#photos-fermer').addEventListener('click', () => {
      if (flou) { fermerFlou(); return; }
      const n = liste(db.get('vehicules', vehiculeId)).length;
      if (n < MIN && !confirm(`Il faut au moins ${MIN} photos pour la mise en ligne (${n} pour l'instant). Fermer quand même ?`)) return;
      fermer();
    });
  }

  return { estTelephone, deblocable, galerie, hydrater, premiere, jpeg, BUCKET, ouvrir, init, MIN, MAX };
})();
