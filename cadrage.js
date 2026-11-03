// Cadrage des photos sur le véhicule : chaque photo est enregistrée au format 4:3, le véhicule au centre et entier.
// - Cadrage.auto(img) : trouve le véhicule sur la photo (reconnaissance d'objets COCO-SSD, chargée au premier usage)
//   et renvoie le cadre qui le contient avec une petite marge. Si le véhicule déborde du format, on dézoome :
//   les bords manquants sont remplis par la photo elle-même, très floutée. Sans véhicule trouvé : photo centrée.
// - Cadrage.dessiner(img, cadre) : la photo cadrée, en 1600 × 1200.
// Le cadre est un rectangle { x, y, w, h } en pixels de l'image, toujours au format 4:3, qui peut dépasser de l'image.
// Le cadrage est enregistré dans la photo elle-même : l'appli, le site public, le réseau et les PDF l'affichent tels quels.
const Cadrage = (() => {
  // Bibliothèques et modèle servis par l'appli (dossier vendor) : gardés par le téléphone, ils marchent aussi sans réseau.
  // Le modèle (SSDLite MobileNet v2, entraîné sur COCO) a ses poids réduits en 8 bits : 5 Mo au lieu de 18.
  const TF = 'vendor/tf.min.js', COCO = 'vendor/coco-ssd.min.js', MODELE = 'vendor/vehicules/model.json';
  const RATIO = 4 / 3, W = 1600, H = 1200;
  const VEHICULES = ['car', 'truck', 'bus', 'motorcycle'];

  let modele = null;
  const script = src => new Promise((ok, ko) => {
    if ([...document.scripts].some(s => s.getAttribute('src') === src)) return ok();
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => { s.remove(); ko(new Error('Reconnaissance du véhicule indisponible (pas de réseau ?)')); };
    document.head.appendChild(s);
  });
  // Chargé une seule fois (environ 6,5 Mo, gardés ensuite par le téléphone). Un échec permet de réessayer plus tard.
  function charger() {
    modele ||= (async () => {
      await script(TF);
      await script(COCO);
      return window.cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: MODELE });
    })().catch(e => { modele = null; throw e; });
    return modele;
  }
  const delai = (p, ms) => Promise.race([p, new Promise((_, ko) => setTimeout(() => ko(new Error('trop long')), ms))]);

  // Le véhicule de la photo : le plus grand trouvé (surface × confiance), en pixels de l'image. null sinon.
  async function vehicule(img) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const m = await delai(charger(), 20000);
    // Analyse sur une copie réduite : plus rapide, et le résultat est aussi bon.
    const k = Math.min(1, 640 / Math.max(iw, ih));
    const c = document.createElement('canvas');
    c.width = Math.round(iw * k); c.height = Math.round(ih * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const trouves = (await m.detect(c, 10, 0.3)).filter(p => VEHICULES.includes(p.class));
    if (!trouves.length) return null;
    const note = p => p.bbox[2] * p.bbox[3] * p.score;
    const [x, y, w, h] = trouves.sort((a, b) => note(b) - note(a))[0].bbox;
    // Ignore un véhicule minuscule au fond (une voiture garée derrière).
    if (w * h < c.width * c.height * 0.04) return null;
    return { x: x / k, y: y / k, w: w / k, h: h / k };
  }

  const dims = img => ({ iw: img.naturalWidth || img.width, ih: img.naturalHeight || img.height });
  // Le plus grand cadre 4:3 qui tient dans la photo, centré (aucun bord à remplir).
  function centre(img) {
    const { iw, ih } = dims(img);
    const w = Math.min(iw, ih * RATIO), h = w / RATIO;
    return { x: (iw - w) / 2, y: (ih - h) / 2, w, h };
  }
  // Toute la photo visible, quitte à remplir les bords.
  function entier(img) {
    const { iw, ih } = dims(img);
    const w = Math.max(iw, ih * RATIO), h = w / RATIO;
    return { x: (iw - w) / 2, y: (ih - h) / 2, w, h };
  }
  // Cadre autour du véhicule : marge d'environ 7 % de chaque côté, centré sur lui, puis recalé dans la photo
  // quand c'est possible pour éviter les bords à remplir.
  function autour(img, b) {
    const { iw, ih } = dims(img);
    let w = Math.max(b.w * 1.14, b.h * 1.2 * RATIO);
    w = Math.max(w, Math.min(iw, ih * RATIO) * 0.4); // pas de zoom extrême : la photo resterait floue
    const h = w / RATIO;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const cale = (debut, taille, total) => taille <= total ? Math.min(Math.max(debut, 0), total - taille) : (total - taille) / 2;
    return { x: cale(cx - w / 2, w, iw), y: cale(cy - h / 2, h, ih), w, h };
  }

  // Cadre automatique : sur le véhicule si on le trouve, sinon centré. { cadre, trouve }.
  async function auto(img) {
    try {
      const b = await vehicule(img);
      if (b) return { cadre: autour(img, b), trouve: true };
    } catch (e) { /* hors ligne ou appareil trop ancien : photo centrée */ }
    return { cadre: centre(img), trouve: false };
  }

  // Dessine la photo cadrée. Les bords hors de la photo reprennent la photo agrandie et très floutée
  // (réduite à quelques pixels puis réagrandie : marche sur tous les téléphones), un peu assombrie.
  function dessiner(img, cadre, w = W, h = H, canvas = document.createElement('canvas')) {
    const { iw, ih } = dims(img);
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const k = w / cadre.w;
    const dx = -cadre.x * k, dy = -cadre.y * k, dw = iw * k, dh = ih * k;
    const deborde = dx > 0.5 || dy > 0.5 || dx + dw < w - 0.5 || dy + dh < h - 0.5;
    if (deborde) {
      const p = document.createElement('canvas');
      p.width = 24; p.height = 18;
      const pc = p.getContext('2d');
      const kc = Math.max(24 / iw, 18 / ih);
      pc.drawImage(img, (24 - iw * kc) / 2, (18 - ih * kc) / 2, iw * kc, ih * kc);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(p, 0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, dx, dy, dw, dh);
    return canvas;
  }

  return { auto, charger, centre, entier, autour, dessiner, RATIO, W, H };
})();
