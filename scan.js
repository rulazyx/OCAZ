// Documents photographiés au téléphone, l'un après l'autre (carte d'identité, carte grise, justificatif de domicile, RIB),
// puis lus sur l'appareil (reconnaissance de texte Tesseract, chargée seulement au premier usage) pour remplir
// les infos utiles. La lecture est une aide : rien n'est écrasé, seuls les champs vides sont remplis.
const Scan = (() => {
  const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const CONSIGNES = {
    cni: "Carte d'identité, côté avec la photo (et la bande de lignes <<< en bas). Pose-la à plat, bien éclairée, sans reflet, et cadre-la entièrement.",
    carteGrise: 'Carte grise, face avec les rubriques A, B, D.1, E… Mets-la à plat et cadre toute la carte.',
    domicile: 'Justificatif de domicile de moins de 3 mois (facture EDF, eau, internet…). Cadre le haut de la page avec le nom et l\'adresse.',
    rib: 'RIB du propriétaire : l\'IBAN doit être lisible.',
  };

  let file = [], index = 0, prise = null, quandPhoto = null, quandFin = null;

  // ---------- Fenêtre de prise de vue ----------
  // docs : [{ cle, libelle }], photo(cle, fichier) est appelé pour chaque photo validée, fin() à la fermeture.
  function lancer(docs, photo, fin) {
    file = docs; index = 0; prise = null; quandPhoto = photo; quandFin = fin;
    if (!file.length) { toast('Tous les documents sont déjà là.'); return; }
    afficher();
    $('#dlg-scan').showModal();
  }
  function afficher() {
    const d = file[index];
    $('#scan-titre').textContent = `Document ${index + 1} sur ${file.length}`;
    $('#scan-body').innerHTML = `<div class="scan-doc">
      <ol class="scan-suite">${file.map((x, i) => `<li class="${i < index ? 'fait' : i === index ? 'actif' : ''}">${esc(x.libelle)}</li>`).join('')}</ol>
      <h3>${esc(d.libelle)}</h3>
      <p class="hint">${esc(CONSIGNES[d.cle] || 'Cadre le document entièrement, bien à plat.')}</p>
      <div class="scan-apercu" id="scan-apercu">${prise ? `<img src="${URL.createObjectURL(prise)}" alt="">` : `<span>${icon('commandes', 44)}</span>`}</div>
    </div>`;
    $('#scan-prendre').firstChild.textContent = prise ? '↺ Reprendre la photo' : '📷 Prendre la photo';
    $('#scan-suivant').hidden = !prise;
    $('#scan-suivant').textContent = index === file.length - 1 ? 'Terminer ✓' : 'Document suivant →';
    $('#scan-passer').hidden = index === file.length - 1 && !!prise;
  }
  async function valider() {
    const d = file[index], f = prise;
    prise = null;
    if (f) quandPhoto?.(d.cle, f);
    suivant();
  }
  function suivant() {
    prise = null;
    if (index < file.length - 1) { index++; afficher(); return; }
    $('#dlg-scan').close();
  }

  // Photo réduite (2 000 px max, JPEG) : lisible pour la lecture et légère à envoyer.
  async function reduire(f, max = 2000) {
    if (!/^image\//.test(f.type)) return f;
    try {
      const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(f); });
      const e = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * e); c.height = Math.round(img.naturalHeight * e);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      const b = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.85));
      return b ? new File([b], (f.name || 'photo').replace(/\.[a-z0-9]+$/i, '') + '.jpg', { type: 'image/jpeg' }) : f;
    } catch (e) { return f; }
  }

  // ---------- Lecture du texte ----------
  let chargement = null;
  function charger() {
    if (window.Tesseract) return Promise.resolve();
    if (!chargement) {
      chargement = new Promise((ok, ko) => {
        const s = document.createElement('script');
        s.src = TESSERACT; s.onload = ok; s.onerror = () => { chargement = null; ko(new Error('Lecture automatique indisponible (pas de connexion).')); };
        document.head.append(s);
      });
    }
    return chargement;
  }
  async function texte(f) {
    await charger();
    const w = await window.Tesseract.createWorker('fra');
    try { return (await w.recognize(f)).data.text || ''; } finally { w.terminate(); }
  }
  // Lit une image et renvoie les infos trouvées selon le type de document ({} si rien).
  async function lire(cle, f) {
    if (!/^image\//.test(f.type)) return {};
    return analyser(cle, await texte(f));
  }

  // ---------- Analyse du texte reconnu ----------
  const propre = t => String(t || '').toUpperCase().replace(/[«‹]/g, '<').replace(/[ \t]+/g, ' ');
  const nomPropre = s => s.toLowerCase().replace(/(^|[\s-'])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()).trim();
  const dateIso = (j, m, a) => `${a.length === 2 ? (Number(a) > 40 ? '19' : '20') + a : a}-${m}-${j}`;
  const aaMmJj = x => (/^\d{6}$/.test(x) ? dateIso(x.slice(4, 6), x.slice(2, 4), x.slice(0, 2)) : '');

  // Bande MRZ de la carte d'identité : nouvelle carte (3 lignes de 30) ou ancienne (2 lignes de 36).
  function mrz(t) {
    const lignes = propre(t).split('\n').map(l => l.replace(/\s/g, '').replace(/[^A-Z0-9<]/g, '')).filter(l => l.length >= 25 && /<</.test(l));
    const out = {};
    const l1 = lignes.find(l => /^I[D<]FRA/.test(l));
    if (l1 && l1.length >= 30 && l1.length < 34) {
      // Nouvelle CNI : IDFRA + numéro (9) ; ligne 2 : naissance AAMMJJ ; ligne 3 : NOM<<PRENOM<PRENOM2.
      out.pieceNumero = l1.slice(5, 14).replace(/</g, '');
      const i = lignes.indexOf(l1);
      const l2 = lignes[i + 1] || '', l3 = lignes[i + 2] || '';
      out.dateNaissance = aaMmJj(l2.slice(0, 6));
      const [nom, prenoms] = l3.split('<<');
      if (nom) out.nom = nom.replace(/</g, ' ').trim();
      if (prenoms) out.prenom = prenoms.split('<').filter(Boolean)[0] || '';
    } else if (l1) {
      // Ancienne CNI : IDFRA + NOM sur la ligne 1 ; ligne 2 : numéro (12), prénoms, naissance.
      out.nom = l1.slice(5, 30).replace(/<+$/, '').replace(/</g, ' ').trim();
      const l2 = lignes[lignes.indexOf(l1) + 1] || '';
      if (l2.length >= 34) {
        out.pieceNumero = l2.slice(0, 12).replace(/</g, '');
        out.prenom = l2.slice(13, 27).split('<<')[0].split('<')[0];
        out.dateNaissance = aaMmJj(l2.slice(27, 33));
      }
    }
    if (out.nom) out.nom = nomPropre(out.nom);
    if (out.prenom) out.prenom = nomPropre(out.prenom);
    return out;
  }

  const CARBURANTS = { ES: 'Essence', GO: 'Diesel', EL: 'Électrique', EE: 'Hybride rechargeable', EH: 'Hybride', GL: 'Hybride rechargeable', GH: 'Hybride', EG: 'GPL', GP: 'GPL', FE: 'Essence', ET: 'Essence' };
  // Rubrique de la carte grise (ex. « D.1 »), le point étant souvent mal lu (D1, D,1, D 1).
  const rub = r => r.replace('.', '[.,\\s]?');
  function apres(t, rubrique) {
    // Valeur qui suit une rubrique de la carte grise (ex. « D.1 RENAULT »), sur la même ligne.
    // La valeur peut être collée à la rubrique (« D.1PEUGEOT ») ; « D.2.1 » n'est pas « D.2 ».
    const m = t.match(new RegExp('(?:^|\\s)' + rub(rubrique) + '(?![.,]?\\d)\\s*[:\\-).]?\\s*([^\\n]+)'));
    return m ? m[1].replace(/\s+\(?[A-Z]\s?[.,]\s?\d.*$/, '').replace(/[|_]+/g, ' ').trim() : '';
  }
  const nombre = (T, rubrique) => (T.match(new RegExp('(?:^|\\s)' + rub(rubrique) + '\\s*[:\\-).]?\\s*(\\d{1,5}(?:[.,]\\d+)?)\\b')) || [])[1] || '';
  function carteGrise(t) {
    const T = propre(t), out = {};
    // A : plaque, au format actuel (AB-123-CD) ou ancien (1234 AB 974).
    // (la rubrique A est souvent collée à la plaque : « AGH-512-KT ») ; une plaque avec tirets est préférée.
    const siv = T.match(/([A-HJ-NP-TV-Z]{2})-(\d{3})-([A-HJ-NP-TV-Z]{2})(?![A-Z0-9])/) || T.match(/([A-HJ-NP-TV-Z]{2})[\s-]?(\d{3})[\s-]?([A-HJ-NP-TV-Z]{2})(?![A-Z0-9])/);
    const fni = T.match(/(?:^|\s)A\s*[.:)]?\s*(\d{1,4})[\s-]?([A-Z]{1,3})[\s-]?(97[1-6]|\d{2}|2[AB])\b/);
    if (siv) out.immatriculation = `${siv[1]}-${siv[2]}-${siv[3]}`;
    else if (fni) out.immatriculation = `${fni[1]} ${fni[2]} ${fni[3]}`;
    else {
      // Photo moyenne : chiffres lus comme des lettres (5→S, 1→I…), seulement juste après la rubrique A.
      const brut = (T.match(/(?:^|\n)\s*A\s*[.:)]?\s*([A-Z0-9-]{7,10})(?=\s|$)/) || [])[1];
      const p = brut && brut.replace(/-/g, '').replace(/^A(?=.{7}$)/, '');
      const chiffre = { O: '0', D: '0', Q: '0', I: '1', L: '1', T: '1', Z: '2', S: '5', B: '8', G: '6' };
      const lettre = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 8: 'B', 6: 'G' };
      if (p && p.length === 7) {
        const l = x => [...x].map(c => lettre[c] || c).join(''), c = [...p.slice(2, 5)].map(x => chiffre[x] || x).join('');
        const a = l(p.slice(0, 2)), b = l(p.slice(5));
        if (/^[A-HJ-NP-TV-Z]{2}$/.test(a) && /^\d{3}$/.test(c) && /^[A-HJ-NP-TV-Z]{2}$/.test(b)) out.immatriculation = `${a}-${c}-${b}`;
      }
    }
    // E : VIN (17 caractères, sans I, O ni Q).
    const vinRub = T.match(new RegExp('(?:^|\\s)E\\s*[.:)]?\\s*([A-HJ-NPR-Z0-9]{17})\\b'));
    const vin = vinRub ? vinRub[1] : [...T.matchAll(/\b([A-HJ-NPR-Z0-9]{17,18})\b/g)]
      .map(m => m[1].length === 18 && m[1][0] === 'E' ? m[1].slice(1) : m[1]) // « EVF3… » : rubrique E collée
      .find(x => x.length === 17 && /\d/.test(x) && /[A-Z]/.test(x));
    if (vin) out.vin = vin;
    // B : 1re mise en circulation (sinon la première date de la carte).
    const d = T.match(/(?:^|\s)B\s*[:\-).]?\s*(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/) || T.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (d && Number(d[2]) >= 1 && Number(d[2]) <= 12) { out.miseEnCirculation = dateIso(d[1], d[2], d[3]); out.annee = d[3]; }
    // D.1 marque, D.2 version (type, variante), D.3 modèle (dénomination commerciale).
    const marque = apres(T, 'D.1');
    if (marque) out.marque = nomPropre(marque.split(' ')[0]);
    const modele = apres(T, 'D.3');
    if (modele) out.modele = nomPropre(modele);
    const version = apres(T, 'D.2');
    if (version && !/^D\s?[.,]?\s?2/.test(version)) out.typeVariante = version;
    // P.1 cylindrée (cm3), P.2 puissance en kW (convertie en ch), P.3 énergie, P.6 puissance fiscale.
    const cyl = nombre(T, 'P.1');
    if (cyl && Number(cyl) >= 50 && Number(cyl) <= 9000) out.cylindree = cyl;
    const kw = Number(nombre(T, 'P.2').replace(',', '.'));
    if (kw >= 5 && kw <= 900) { out.puissanceKw = String(kw); out.puissanceCh = String(Math.round(kw * 1.36)); }
    const nrj = T.match(new RegExp('(?:^|\\s)' + rub('P.3') + '\\s*[:\\-).]?\\s*([A-Z]{2})\\b'));
    if (nrj && CARBURANTS[nrj[1]]) out.carburant = CARBURANTS[nrj[1]];
    const cv = nombre(T, 'P.6');
    if (cv && Number(cv) >= 1 && Number(cv) <= 99) out.puissanceFiscale = cv;
    // J.1 genre (VP, CTTE…), S.1 places assises, V.7 CO2.
    const genre = T.match(new RegExp('(?:^|\\s)' + rub('J.1') + '\\s*[:\\-).]?\\s*(VP|CTTE|DERIV-VP|MTL|MTT1|MTT2|CL|QM|VASP|TRA|CAM)\\b'));
    if (genre) out.genre = genre[1];
    const places = nombre(T, 'S.1');
    if (places && Number(places) >= 1 && Number(places) <= 9) out.places = places;
    const co2 = nombre(T, 'V.7');
    if (co2 && Number(co2) <= 500) out.co2 = co2;
    const titulaire = apres(T, 'C.1');
    if (titulaire) out.titulaire = nomPropre(titulaire);
    return out;
  }

  // Adresse : la ligne avec le code postal (974xx à La Réunion, sinon 5 chiffres) et celle du dessus.
  function domicile(t) {
    const lignes = String(t || '').split('\n').map(l => l.trim()).filter(Boolean);
    const i = lignes.findIndex(l => /\b974\d{2}\b/.test(l));
    const j = i >= 0 ? i : lignes.findIndex(l => /^\d{5}\s+[A-Za-zÀ-ÿ]/.test(l));
    if (j < 0) return {};
    const m = lignes[j].match(/\b(\d{5})\s+(.+)$/);
    const out = m ? { codePostal: m[1], ville: nomPropre(m[2].replace(/cedex.*$/i, '')) } : {};
    if (j > 0 && /\d/.test(lignes[j - 1])) out.adresse = lignes[j - 1];
    return out;
  }

  // IBAN vérifié par sa clé (modulo 97), et BIC.
  function ibanValide(iban) {
    const r = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, c => c.charCodeAt(0) - 55);
    let reste = 0;
    for (const ch of r) reste = (reste * 10 + Number(ch)) % 97;
    return reste === 1;
  }
  function rib(t) {
    const T = propre(t), out = {};
    const candidats = T.replace(/[^A-Z0-9\n]/g, '').match(/FR\d{2}[A-Z0-9]{23}/g) || [];
    const iban = candidats.find(ibanValide) || candidats[0];
    if (iban) out.iban = iban;
    const bic = T.match(/\b([A-Z]{4}(?:FR|RE)[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/);
    if (bic) out.bic = bic[1];
    return out;
  }

  function analyser(cle, t) {
    if (cle === 'cni') {
      const out = mrz(t);
      if (out.pieceNumero || out.nom) out.pieceType = "Carte d'identité";
      return out;
    }
    if (cle === 'carteGrise') return carteGrise(t);
    if (cle === 'domicile') return domicile(t);
    if (cle === 'rib') return rib(t);
    return {};
  }

  function init() {
    $('#scan-input').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      prise = await reduire(f);
      afficher();
    });
    $('#scan-suivant').addEventListener('click', valider);
    $('#scan-passer').addEventListener('click', suivant);
    $('#scan-fermer').addEventListener('click', () => $('#dlg-scan').close());
    $('#dlg-scan').addEventListener('close', () => { const f = quandFin; quandFin = null; f?.(); });
  }

  return { init, lancer, lire, reduire, analyser };
})();
