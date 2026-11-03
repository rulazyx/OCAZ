// Parcours de reprise en deux pages :
// 1) les infos minimales pour coter le véhicule (comme sur La Centrale / Leboncoin),
// 2) la fiche reprise : cote, frais, hausse Réunion, fourchette de reprise et prix saisi à la main.
// « Valider » range la reprise dans les reprises validées, sans la passer en préparation : elle se choisit
// ensuite dans une offre, et c'est le passage de l'offre en commande qui la fait entrer en préparation.
// Le dépôt-vente a son propre onglet (depotvente.js).
const Reprise = (() => {
  // Hausse des prix à La Réunion et marge visée : réglées dans Paramètres, partagées par l'équipe.
  const reglages = () => Param.get().reprise;

  const CARBURANTS = ['', 'Essence', 'Diesel', 'Hybride', 'Hybride rechargeable', 'Électrique', 'GPL'];
  const BOITES = ['', 'Manuelle', 'Automatique'];
  let etat = null;
  let extra = {}; // données complètes renvoyées par la recherche par plaque
  let trouve = ''; // véhicule trouvé par la plaque, affiché sous le champ
  let cgPhoto = null; // photo de la carte grise scannée, rangée dans les documents du véhicule à l'enregistrement
  let cgLu = []; // infos lues sur la carte grise, affichées sous le bouton
  let edition = false; // reprise validée : résumé (plaque, véhicule, cote, prix) sauf après « Modifier »

  // Fourchette de reprise : prix de revente estimé à La Réunion, moins les frais, moins la marge visée.
  function calcul(v) {
    const r = reglages();
    const cotes = [num(v.coteLaCentrale), num(v.coteLeboncoin)].filter(Boolean);
    const cote = cotes.length ? cotes.reduce((a, b) => a + b, 0) / cotes.length : 0;
    const hausse = v.hausseReunion === undefined || v.hausseReunion === '' ? r.hausseReunion : num(v.hausseReunion);
    const revente = cote * (1 + hausse / 100);
    const frais = num(v.fraisMecanique) + num(v.fraisCarrosserie) + num(v.fraisSupposes);
    const arrondi = x => Math.max(0, Math.round(x / 50) * 50);
    return {
      cote, hausse, revente, frais,
      basse: arrondi(revente * (1 - r.margeMax / 100) - frais),
      haute: arrondi(revente * (1 - r.margeMin / 100) - frais),
      r,
    };
  }

  const champ = (k, l, type = 'text', extraAttr = '') => `<div class="field"><label for="r-${k}">${l}</label>
    <input id="r-${k}" data-r="${k}" type="${type}" value="${esc(etat[k] ?? '')}"${type === 'number' ? ' inputmode="decimal"' : ''} ${extraAttr}></div>`;
  const liste = (k, l, opts) => `<div class="field"><label for="r-${k}">${l}</label>
    <select id="r-${k}" data-r="${k}">${opts.map(o => `<option${o === (etat[k] || '') ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;

  // Boutons du bas : Retour, Enregistrer pour plus tard, Coter (page 1) ou Valider (page 2).
  // Une reprise déjà enregistrée peut être annulée (ou remise en cours si elle l'était).
  function boutons(page) {
    page_ = page;
    const enCours = etat.statut === 'Reprise à étudier';
    // Reprise validée, sur la fiche : Modifier, Rentrer en stock ou Annuler la reprise.
    const validee = page === 2 && etat.statut === 'Reprise validée';
    $('#r-btn-suivant').hidden = page !== 1;
    $('#r-btn-valider').hidden = page !== 2 || !enCours;
    $('#r-btn-editer').hidden = !validee;
    $('#r-btn-stock').hidden = !validee;
    $('#r-btn-enregistrer').hidden = validee;
    $('#r-btn-enregistrer').textContent = enCours ? 'Enregistrer pour plus tard' : 'Enregistrer';
    const annuler = $('#r-btn-annuler');
    annuler.hidden = !etat.id || !['Reprise à étudier', 'Reprise validée', 'Reprise refusée'].includes(etat.statut);
    annuler.textContent = etat.statut === 'Reprise refusée' ? 'Remettre en cours' : 'Annuler la reprise';
    annuler.className = etat.statut === 'Reprise refusée' ? '' : 'danger';
  }
  let page_ = 1;

  // Page 1 : infos minimales demandées par les sites de cote (le vendeur n'est pas demandé : c'est le client de l'offre).
  function page1() {
    edition = true;
    $('#reprise-titre').textContent = etat.id ? 'Modifier la reprise' : 'Nouvelle reprise';
    $('#reprise-body').innerHTML = `
      ${etat.image ? `<div class="vehicule-image"><img src="${esc(etat.image)}" alt="" onerror="this.parentNode.remove()"></div>` : ''}
      <div class="lookup">
        <div class="field r-cg"><label class="button ph-btn" id="r-cg-label">📷 Scanner la carte grise<input id="r-cg-input" type="file" accept="image/*" hidden></label>
          <span class="hint" id="r-cg-info">${cgLu.length ? 'Lu sur la carte grise : ' + esc(cgLu.join(' · ')) + '. Vérifie, la lecture peut se tromper.' : 'Photo ou image de la carte grise : la plaque, le VIN, la marque, la date de mise en circulation, l\'énergie et la puissance sont lus, puis la plaque complète le reste.'}</span></div>
        <div class="field"><label for="r-immatriculation">Plaque d'immatriculation</label>
          <div class="inline"><input id="r-immatriculation" data-r="immatriculation" value="${esc(etat.immatriculation || '')}" placeholder="AB-123-CD" autocapitalize="characters">
          <button type="button" id="r-btn-plaque">Rechercher</button></div>
          <span class="hint">${trouve ? 'Trouvé : ' + esc(trouve) : 'La plaque remplit marque, modèle, version et l\'image du modèle. Sinon, saisis-les à la main.'}</span></div>
      </div>
      <h3 class="section">Infos pour la cote</h3>
      <div class="grid">
        ${champ('marque', 'Marque *')}${champ('modele', 'Modèle *')}
        <div class="field full"><label for="r-finition">Version / finition</label><input id="r-finition" data-r="finition" value="${esc(etat.finition || '')}" placeholder="ex. 1.5 dCi 90 Intens"></div>
        ${champ('annee', 'Année *', 'number')}${champ('kilometrage', 'Kilométrage *', 'number')}
        ${liste('carburant', 'Carburant *', CARBURANTS)}${liste('boite', 'Boîte *', BOITES)}
      </div>`;
    boutons(1);
  }

  // Page 2 : fiche reprise (cote, frais, prix de reprise).
  function page2() {
    const v = etat;
    const c = calcul(v);
    if (v.statut === 'Reprise validée' && !edition) { resume(c); return; }
    $('#reprise-titre').textContent = 'Fiche reprise' + (v.statut !== 'Reprise à étudier' ? ' · ' + libStatut(v.statut).replace('Reprise ', '') : '');
    $('#reprise-body').innerHTML = `
      <div class="o-choix">${v.image ? `<img src="${esc(v.image)}" alt="" onerror="this.remove()">` : ''}
        <div><strong>${esc(vehiculeNom(v))}</strong>
        <span class="sub">${esc([v.annee, km(v.kilometrage), v.carburant, v.boite].filter(Boolean).join(' · '))}</span>
        <span class="sub">${v.immatriculation ? esc(v.immatriculation) : 'Sans plaque'}</span></div>
        <button type="button" class="chip" id="r-btn-modifier">Modifier</button></div>

      <h3 class="section">Cote</h3>
      <p class="hint">La Centrale, L'argus et Leboncoin n'ont pas d'accès automatique autorisé : les boutons ouvrent le site avec ton véhicule, tu reportes la cote observée ici.</p>
      <div class="grid">
        <div class="field"><label for="r-coteLaCentrale">Cote observée La Centrale / L'argus (€)</label>
          <div class="inline"><input id="r-coteLaCentrale" data-r="coteLaCentrale" type="number" inputmode="decimal" value="${esc(v.coteLaCentrale || '')}">
          <button type="button" class="chip" data-cote-site="lacentrale">La Centrale</button>
          <button type="button" class="chip" data-cote-site="argus">L'argus</button></div></div>
        <div class="field"><label for="r-coteLeboncoin">Prix Leboncoin (€)</label>
          <div class="inline"><input id="r-coteLeboncoin" data-r="coteLeboncoin" type="number" inputmode="decimal" value="${esc(v.coteLeboncoin || '')}">
          <button type="button" class="chip" data-cote-site="leboncoin">Leboncoin</button></div></div>
      </div>
      <div class="r-kpi"><div><span>Cote retenue</span><strong id="r-k-cote">${c.cote ? euros(c.cote) : '—'}</strong></div>
        <div><span>Hausse Réunion</span><div class="inline r-hausse"><input data-r="hausseReunion" type="number" inputmode="decimal" value="${esc(v.hausseReunion ?? c.r.hausseReunion)}"><b>%</b></div></div>
        <div><span>Revente estimée 974</span><strong id="r-k-revente">${c.revente ? euros(c.revente) : '—'}</strong></div></div>

      <h3 class="section">Frais à prévoir</h3>
      <div class="grid">
        ${champ('fraisMecanique', 'Frais mécanique (€)', 'number')}
        ${champ('fraisCarrosserie', 'Frais carrosserie (€)', 'number')}
        <div class="field full"><label for="r-fraisSupposes">Frais supposés : gardiennage, imprévus (€)</label>
          <input id="r-fraisSupposes" data-r="fraisSupposes" type="number" inputmode="decimal" value="${esc(v.fraisSupposes || '')}"></div>
      </div>

      <h3 class="section">Prix de reprise</h3>
      <div class="r-fourchette" id="r-fourchette">${fourchetteHtml(c)}</div>
      <div class="field"><label for="r-prixPropose">Prix de reprise proposé (€)</label>
        <input id="r-prixPropose" data-r="prixPropose" type="number" inputmode="decimal" class="r-prix" value="${esc(v.prixPropose || '')}" placeholder="À saisir"></div>
      <div class="field"><label for="r-defauts">Défauts constatés / notes</label><textarea id="r-defauts" data-r="defauts">${esc(v.defauts || '')}</textarea></div>
      ${v.statut === 'Reprise validée' ? '<p class="hint">Reprise validée : « Rentrer en stock » ouvre la page photos, infos, options et prix. Elle peut aussi être choisie dans « Véhicule repris » d\'une offre : quand l\'offre passe en commande, le véhicule entre en préparation.</p>' : ''}`;
    boutons(2);
  }

  // Reprise validée, ouverte depuis la liste : l'essentiel seulement.
  function resume(c) {
    const v = etat;
    $('#reprise-titre').textContent = 'Reprise validée';
    $('#reprise-body').innerHTML = `
      <div class="o-choix r-resume">${v.image ? `<img src="${esc(v.image)}" alt="" onerror="this.remove()">` : ''}
        <div><span class="r-plaque">${v.immatriculation ? esc(v.immatriculation) : 'Sans plaque'}</span>
        <strong>${esc(vehiculeNom(v))}</strong>
        <span class="sub">${esc([v.annee, km(v.kilometrage), v.carburant, v.boite].filter(Boolean).join(' · '))}</span></div></div>
      <h3 class="section">Cote</h3>
      <div class="r-kpi r-kpi-2"><div><span>Cote</span><strong>${c.cote ? euros(c.cote) : '—'}</strong></div>
        <div><span>Prix de reprise</span><strong>${v.prixPropose ? euros(v.prixPropose) : '—'}</strong></div></div>`;
    boutons(2);
  }

  function fourchetteHtml(c) {
    if (!c.cote) return '<span class="hint">Saisis au moins une cote pour calculer la fourchette.</span>';
    return `<div><span>Fourchette de reprise</span><strong>${euros(c.basse)} – ${euros(c.haute)}</strong></div>
      <span class="hint">Revente estimée ${euros(c.revente)} − frais ${euros(c.frais)} − marge de ${c.r.margeMin} à ${c.r.margeMax} %</span>`;
  }

  // Mise à jour des montants calculés sans redessiner les champs en cours de saisie.
  function majCalcul() {
    const c = calcul(etat);
    $('#r-k-cote').textContent = c.cote ? euros(c.cote) : '—';
    $('#r-k-revente').textContent = c.revente ? euros(c.revente) : '—';
    $('#r-fourchette').innerHTML = fourchetteHtml(c);
  }

  function ouvrir(id, preset = {}) {
    etat = id ? { ...db.get('vehicules', id) } : { statut: 'Reprise à étudier', mode: 'achat', ...preset };
    extra = {}; trouve = ''; cgPhoto = null; cgLu = []; edition = false;
    if (id) page2(); else page1();
    $('#dlg-reprise').showModal();
  }

  function enregistrer(patch = {}) {
    const c = calcul(etat);
    // Documents et annonces sont modifiés directement sur la fiche : on garde leur dernière version.
    const enBase = etat.id ? db.get('vehicules', etat.id) : null;
    const saved = db.upsert('vehicules', { ...etat, ...extra, ...patch, coteRetenue: c.cote || '', fraisEstimes: c.frais || '',
      ...(enBase ? { documents: enBase.documents, annonces: enBase.annonces } : {}) });
    etat = { ...saved };
    extra = {}; trouve = '';
    if (cgPhoto) { rangerCarteGrise(saved.id, cgPhoto); cgPhoto = null; }
    return saved;
  }

  // La photo de la carte grise est rangée dans les documents du véhicule (bucket privé du garage).
  async function rangerCarteGrise(id, f) {
    if (!Sync.role || !Sync.entreprise) return;
    try {
      const doc = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const chemin = `${Sync.entreprise.id}/vehicules/${id}/${doc}.jpg`;
      await Fichiers.envoyerFichier(f, chemin);
      const v = db.get('vehicules', id);
      if (!v) return;
      db.upsert('vehicules', { id, documents: (v.documents || []).concat({ id: doc, type: 'Carte grise', piece: 'carteGrise', nom: 'Carte grise.jpg', chemin, date: today() }) });
      if (etat?.id === id) etat.documents = db.get('vehicules', id).documents;
    } catch (e) { toast('Carte grise non rangée dans les documents : ' + e.message); }
  }

  // Scan de la carte grise : lecture sur l'appareil (gratuite), puis recherche par plaque pour compléter.
  const LU = { immatriculation: 'plaque', vin: 'VIN', marque: 'marque', modele: 'modèle', annee: 'année',
    carburant: 'énergie', puissanceCh: 'ch', puissanceFiscale: 'CV', cylindree: 'cm³', places: 'places' };
  async function scannerCarteGrise(brut) {
    const info = $('#r-cg-info'), label = $('#r-cg-label');
    label.classList.add('busy');
    info.textContent = 'Lecture de la carte grise… (quelques secondes, plus la première fois)';
    let r = {};
    try {
      const f = await Scan.reduire(brut);
      cgPhoto = f;
      r = await Scan.lire('carteGrise', f);
    } catch (e) {
      label.classList.remove('busy');
      info.textContent = e.message;
      return;
    }
    label.classList.remove('busy');
    if (r.immatriculation) r.immatriculation = formatPlaque(r.immatriculation);
    if (r.vin && !r.marque) { const d = VIN.decode(r.vin); if (d.ok && d.marque) r.marque = d.marque; }
    // La carte grise décrit ce véhicule : ses infos remplacent celles déjà saisies.
    ['immatriculation', 'marque', 'modele', 'annee', 'carburant'].forEach(k => { if (r[k]) etat[k] = r[k]; });
    ['typeVariante', 'vin', 'miseEnCirculation', 'puissanceCh', 'puissanceFiscale', 'cylindree', 'places', 'co2', 'genre'].forEach(k => { if (r[k]) extra[k] = r[k]; });
    if (r.genre === 'CTTE' || r.genre === 'DERIV-VP') extra.type = 'Utilitaire';
    cgLu = Object.keys(LU).filter(k => r[k]).map(k => k === 'puissanceCh' || k === 'puissanceFiscale' || k === 'cylindree' || k === 'places' ? `${r[k]} ${LU[k]}` : `${LU[k]} ${r[k]}`);
    if (!cgLu.length) {
      const ext = extra; page1(); extra = ext;
      $('#r-cg-info').textContent = 'Rien de lisible sur la photo. Reprends-la à plat, bien éclairée, sans reflet, en cadrant toute la carte. Tu peux aussi saisir la plaque.';
      return;
    }
    const ext = extra; page1(); extra = ext;
    // La plaque lue complète le reste (modèle exact, version, boîte, image) avec la recherche habituelle.
    // Si la recherche payante est coupée par l'admin, rien ne s'affiche : le scan suffit.
    const btnPlaque = $('#r-btn-plaque');
    if (etat.immatriculation && Sync.user && btnPlaque) { btnPlaque.dataset.auto = '1'; btnPlaque.click(); }
    else toast('Carte grise lue : vérifie les infos');
  }

  function init() {
    const body = $('#reprise-body');
    body.addEventListener('input', e => {
      const k = e.target.dataset.r;
      if (!k) return;
      etat[k] = e.target.value;
      if ($('#r-fourchette')) majCalcul();
    });
    body.addEventListener('change', e => {
      if (e.target.id === 'r-cg-input') {
        const f = e.target.files[0];
        e.target.value = '';
        if (f) scannerCarteGrise(f);
        return;
      }
      const k = e.target.dataset.r;
      if (k) etat[k] = e.target.value;
    });
    body.addEventListener('click', async e => {
      if (e.target.id === 'r-btn-modifier') { page1(); return; }
      const site = e.target.dataset.coteSite;
      if (site) {
        const q = [etat.marque, etat.modele, etat.finition, etat.annee].filter(Boolean).join(' ');
        const url = site === 'lacentrale'
          ? 'https://www.google.com/search?q=' + encodeURIComponent('cote La Centrale ' + q + ' ' + (etat.kilometrage || '') + ' km')
          : site === 'argus'
          ? 'https://www.google.com/search?q=' + encodeURIComponent('cote argus ' + q + ' ' + (etat.kilometrage || '') + ' km')
          : 'https://www.leboncoin.fr/recherche?category=2&locations=La%20R%C3%A9union&text=' + encodeURIComponent([etat.marque, etat.modele].filter(Boolean).join(' '));
        window.open(url, '_blank', 'noopener');
        return;
      }
      if (e.target.id === 'r-btn-plaque') {
        const btn = e.target;
        const auto = btn.dataset.auto === '1';
        delete btn.dataset.auto;
        const plate = $('#r-immatriculation');
        plate.value = formatPlaque(plate.value);
        etat.immatriculation = plate.value;
        btn.disabled = true; btn.textContent = 'Recherche…';
        try {
          const r = await Plaque.rechercher(plate.value);
          ['marque', 'modele', 'finition', 'annee', 'carburant', 'boite'].forEach(k => { if (r[k]) etat[k] = r[k]; });
          // Le reste de la fiche technique est gardé avec le véhicule.
          ['miseEnCirculation', 'couleur', 'type', 'puissanceCh', 'puissanceFiscale', 'cylindree', 'co2', 'portes', 'places', 'vin', 'image', 'ficheTechnique']
            .forEach(k => { if (r[k]) extra[k] = r[k]; });
          if (r.image) etat.image = r.image;
          trouve = r.description || [r.marque, r.modele, r.finition].filter(Boolean).join(' ');
          const ext = extra;
          page1();
          extra = ext;
          const usage = Plaque.usageTexte();
          toast('Véhicule trouvé' + (usage ? ` (${usage})` : ''));
        } catch (err) {
          if (!(auto && err.coupee)) toast(err.message);
        } finally {
          btn.disabled = false; btn.textContent = 'Rechercher';
        }
      }
    });
    // Coter : les infos de la page 1 sont obligatoires.
    const verifier = () => {
      const manque = ['marque', 'modele', 'annee', 'kilometrage', 'carburant', 'boite'].filter(k => !String(etat[k] || '').trim());
      if (manque.length) { toast('Il manque : ' + manque.join(', ')); return false; }
      if (etat.immatriculation) etat.immatriculation = formatPlaque(etat.immatriculation);
      const dup = etat.immatriculation && db.all('vehicules').find(v => v.immatriculation === etat.immatriculation && v.id !== etat.id);
      return !dup || confirm(`La plaque ${etat.immatriculation} existe déjà (${vehiculeNom(dup)}). Continuer ?`);
    };
    const fermer = () => { $('#dlg-reprise').close(); render(); };
    $('#r-btn-suivant').addEventListener('click', () => {
      if (!verifier()) return;
      const nouveau = !etat.id;
      const saved = enregistrer();
      page2();
      render();
      if (nouveau) alerteRecherche(saved);
    });
    $('#r-btn-retour').addEventListener('click', () => {
      if (page_ === 2 && etat.statut === 'Reprise validée') { enregistrer(); fermer(); return; }
      if (page_ === 2) page1(); else fermer();
    });
    $('#r-btn-editer').addEventListener('click', () => { enregistrer(); page1(); });
    $('#r-btn-stock').addEventListener('click', () => {
      if (!verifier()) return;
      const saved = enregistrer();
      $('#dlg-reprise').close();
      EntreeStock.ouvrir(saved.id);
    });
    $('#r-btn-enregistrer').addEventListener('click', () => {
      if (!String(etat.marque || etat.immatriculation || '').trim()) { toast('Indique au moins la plaque ou la marque.'); return; }
      if (etat.immatriculation) etat.immatriculation = formatPlaque(etat.immatriculation);
      enregistrer();
      toast(etat.statut === 'Reprise à étudier' ? 'Reprise enregistrée : retrouve-la dans les reprises en cours' : 'Reprise enregistrée');
      fermer();
    });
    $('#r-btn-valider').addEventListener('click', () => {
      if (!verifier()) return;
      if (!num(etat.prixPropose)) { toast('Saisis le prix de reprise avant de valider.'); $('#r-prixPropose')?.focus(); return; }
      const saved = enregistrer({ statut: 'Reprise validée' });
      setTimeout(() => alerteRecherche(saved), 2800);
      filtreReprise = 'Reprises validées';
      render();
      edition = false;
      page2(); // la fiche validée propose Modifier, Rentrer en stock ou Annuler
      toast('Reprise validée : rentre-la en stock, ou ajoute-la dans une offre');
    });
    $('#r-btn-annuler').addEventListener('click', () => {
      if (etat.statut === 'Reprise refusée') {
        enregistrer({ statut: 'Reprise à étudier' });
        filtreReprise = 'Reprises en cours';
        toast('Reprise remise en cours');
        fermer();
        return;
      }
      const ventes = db.all('commandes').filter(o => o.repriseId === etat.id && o.statut !== 'Annulée');
      if (ventes.length) { toast(`Cette reprise est dans ${ventes.map(o => o.numero).join(', ')} : retire-la d'abord de l'offre.`); return; }
      if (!confirm('Annuler cette reprise ? Elle reste visible dans les reprises annulées.')) return;
      enregistrer({ statut: 'Reprise refusée' });
      filtreReprise = 'Reprises annulées';
      toast('Reprise annulée');
      fermer();
    });
    $('#r-btn-fermer').addEventListener('click', fermer);
  }

  return { ouvrir, init, reglages, rangerCarteGrise };
})();
