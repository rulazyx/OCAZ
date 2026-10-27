// Onglet « Dépôt vente » : nouveau dépôt en 4 étapes.
// 1) le client (propriétaire), 2) le véhicule, 3) l'accord sur le prix de vente et la commission (le dépôt peut être
// validé dès cette étape), 4) les documents : carte d'identité, carte grise, justificatif de domicile, RIB, téléversés
// depuis l'ordinateur ou photographiés l'un après l'autre sur le téléphone (lecture automatique des infos utiles).
// Un dépôt enregistré pour plus tard reste « Dépôt en cours » (sous-onglet « À compléter »).
const DepotVente = (() => {
  const DOCS = [
    ['cni', "Carte d'identité"],
    ['carteGrise', 'Carte grise'],
    ['domicile', 'Justificatif de domicile'],
    ['rib', 'RIB'],
  ];
  const ETAPES = ['Client', 'Véhicule', 'Prix et commission', 'Documents'];
  const CARBURANTS = ['', 'Essence', 'Diesel', 'Hybride', 'Hybride rechargeable', 'Électrique', 'GPL'];
  const BOITES = ['', 'Manuelle', 'Automatique'];

  let etat = null; // véhicule en cours (mode dépôt)
  let etape = 1, maxEtape = 1;
  let nouveauClient = {}; // client saisi à l'étape 1, créé au passage à l'étape 2
  let extra = {}, trouve = '';
  let creeIci = false, garde = false; // brouillon créé pendant cette ouverture, et gardé volontairement

  const libelle = cle => DOCS.find(d => d[0] === cle)?.[1] || cle;
  const docsDe = (v, cle) => (v?.documents || []).filter(d => d.piece === cle);
  const docsManquants = v => DOCS.filter(([cle]) => !docsDe(v, cle).length).map(([, l]) => l);
  const valide = v => v && v.statut !== 'Dépôt en cours';

  function ouvrir(id, aEtape) {
    const v = id ? db.get('vehicules', id) : null;
    etat = v ? { ...v } : { mode: 'depot', statut: 'Dépôt en cours', commissionType: Param.get().activite.commissionType };
    nouveauClient = {}; extra = {}; trouve = ''; creeIci = false; garde = false;
    maxEtape = v ? (valide(v) ? 4 : Math.max(1, num(v.depotEtape) || 1)) : 1;
    etape = aEtape || maxEtape;
    afficher();
    $('#dlg-depot').showModal();
  }

  // ---------- Écrans ----------
  function afficher() {
    $('#depot-titre').textContent = valide(etat) ? 'Dépôt vente · ' + vehiculeNom(etat) : etat.id ? 'Dépôt vente à compléter' : 'Nouveau dépôt vente';
    $('#depot-etapes').innerHTML = ETAPES.map((l, i) => `<li class="${i + 1 === etape ? 'actif' : i + 1 <= maxEtape ? 'fait' : ''}">
      <button type="button" data-etape="${i + 1}"${i + 1 > maxEtape ? ' disabled' : ''}><b>${i + 1}</b><span>${l}</span></button></li>`).join('');
    $('#depot-body').innerHTML = [null, etape1, etape2, etape3, etape4][etape]();
    $('#d-btn-retour').textContent = etape === 1 ? 'Fermer' : '← Retour';
    $('#d-btn-suivant').hidden = etape === 4;
    $('#d-btn-suivant').textContent = etape === 3 ? 'Documents →' : 'Suivant →';
    $('#d-btn-valider').hidden = valide(etat) ? etape !== 4 : etape < 3;
    $('#d-btn-valider').textContent = valide(etat) ? 'Terminer ✓' : 'Valider le dépôt';
    $('#d-btn-plus-tard').hidden = valide(etat);
    if (etape === 3) $('#depot-resume').innerHTML = Depot.resume(etat);
  }

  function etape1() {
    const clients = db.all('clients').slice().sort((a, b) => norm(clientNom(a)).localeCompare(norm(clientNom(b))));
    const c = db.get('clients', etat.vendeurId);
    const ch = (k, l, type = 'text', cls = '') => `<div class="field ${cls}"><label for="dc-${k}">${l}</label>
      <input id="dc-${k}" data-nc="${k}" type="${type}" value="${esc(nouveauClient[k] || '')}" autocomplete="off"></div>`;
    return `<h3 class="section">Le propriétaire du véhicule</h3>
      ${c ? `<div class="o-choix"><div><strong>${esc(clientNom(c))}</strong><span class="sub">${esc([c.telephone, c.email, c.ville].filter(Boolean).join(' · '))}</span></div>
        <button type="button" class="chip" data-d="changer-client">Changer</button></div>`
      : `${clients.length ? `<div class="field"><label for="d-client">Client déjà connu</label><select id="d-client"><option value="">Choisir…</option>${clients.map(x =>
          `<option value="${x.id}">${esc(clientNom(x))}${x.telephone ? ' · ' + esc(x.telephone) : ''}</option>`).join('')}</select></div>
        <p class="hint">Ou crée un nouveau client :</p>` : ''}
        <div class="grid">${ch('prenom', 'Prénom')}${ch('nom', 'Nom *')}${ch('telephone', 'Téléphone *', 'tel')}${ch('email', 'Email', 'email')}
          ${ch('adresse', 'Adresse', 'text', 'full')}${ch('codePostal', 'Code postal')}${ch('ville', 'Ville')}</div>
        <p class="hint">Pas tout sous la main ? La carte d'identité et le justificatif de domicile, à l'étape 4, remplissent le nom et l'adresse.</p>`}`;
  }

  const champ = (k, l, type = 'text', attr = '') => `<div class="field"><label for="dv-${k}">${l}</label>
    <input id="dv-${k}" data-dv="${k}" type="${type}" value="${esc(etat[k] ?? '')}"${type === 'number' ? ' inputmode="decimal"' : ''} ${attr}></div>`;
  const liste = (k, l, opts) => `<div class="field"><label for="dv-${k}">${l}</label>
    <select id="dv-${k}" data-dv="${k}">${opts.map(o => `<option${o === (etat[k] || '') ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  function etape2() {
    return `${etat.image ? `<div class="vehicule-image"><img src="${esc(etat.image)}" alt="" onerror="this.parentNode.remove()"></div>` : ''}
      <div class="lookup">
        <div class="field"><label for="dv-immatriculation">Plaque d'immatriculation</label>
          <div class="inline"><input id="dv-immatriculation" data-dv="immatriculation" value="${esc(etat.immatriculation || '')}" placeholder="AB-123-CD" autocapitalize="characters">
          <button type="button" data-d="plaque">Rechercher</button></div>
          <span class="hint">${trouve ? 'Trouvé : ' + esc(trouve) : 'La plaque remplit marque, modèle et version. Sinon, saisis-les à la main (ou photographie la carte grise à l\'étape 4).'}</span></div>
      </div>
      <h3 class="section">Le véhicule</h3>
      <div class="grid">
        ${champ('marque', 'Marque *')}${champ('modele', 'Modèle *')}
        <div class="field full"><label for="dv-finition">Version / finition</label><input id="dv-finition" data-dv="finition" value="${esc(etat.finition || '')}" placeholder="ex. 1.5 dCi 90 Intens"></div>
        ${champ('annee', 'Année', 'number')}${champ('kilometrage', 'Kilométrage *', 'number')}
        ${liste('carburant', 'Carburant', CARBURANTS)}${liste('boite', 'Boîte', BOITES)}
        ${champ('couleur', 'Couleur')}${champ('vin', 'N° de série (VIN)')}
      </div>
      <div class="field"><label for="dv-defauts">État, défauts constatés, notes</label><textarea id="dv-defauts" data-dv="defauts">${esc(etat.defauts || '')}</textarea></div>`;
  }

  function etape3() {
    // Le mandat reprend les champs de depot.js (data-r) : on les lit dans etat au fil de la saisie.
    return Depot.page2(etat) + (valide(etat) ? `<div class="chips"><button type="button" class="chip" data-depot="mandat" data-vid="${etat.id}">Imprimer le mandat</button></div>` : '')
      + '<p class="hint">Tu peux valider le dépôt dès maintenant : le véhicule entre en stock, et les documents se complètent plus tard (étape 4).</p>';
  }

  function etape4() {
    const v = db.get('vehicules', etat.id) || etat;
    const tel = Photos.estTelephone();
    return `<h3 class="section">Documents du propriétaire</h3>
      ${tel ? `<button type="button" class="primary d-photo" data-d="photos">📷 Prendre les documents en photo</button>
        <p class="hint">Une fenêtre te guide document par document. Ocaz lit les infos utiles (nom, adresse, plaque, IBAN…) et les range dans la fiche.</p>`
      : '<p class="hint">Choisis le fichier de chaque document sur l\'ordinateur (PDF ou photo, 10 Mo max). Sur le téléphone, tu peux aussi les photographier.</p>'}
      <div class="d-docs">${DOCS.map(([cle, l]) => {
        const docs = docsDe(v, cle);
        return `<div class="d-doc${docs.length ? ' ok' : ''}"><div class="d-doc-tete"><strong>${docs.length ? '✓' : '○'} ${esc(l)}</strong>
          <label class="button">${docs.length ? '+ Ajouter' : 'Téléverser'}<input type="file" data-d-fichier="${cle}" accept="application/pdf,image/*" multiple hidden></label></div>
          ${docs.map(d => `<div class="doc-ligne"><span class="doc-nom">${esc(d.nom)}<small>${dateFr(d.date)}</small></span>
            <button type="button" class="chip" data-vdoc-ouvrir="${esc(d.id)}" data-vid="${v.id}">Ouvrir</button>
            <button type="button" class="chip" data-d-suppr="${esc(d.id)}" aria-label="Supprimer">✕</button></div>`).join('')}</div>`;
      }).join('')}</div>
      <div id="d-lu" class="d-lu" hidden></div>
      ${Sync.role ? '' : '<p class="alerte">Connecte-toi pour ranger les documents en ligne.</p>'}`;
  }

  // ---------- Lecture des saisies ----------
  function lire() {
    document.querySelectorAll('#depot-body [data-dv]').forEach(i => { etat[i.dataset.dv] = i.value.trim(); });
    document.querySelectorAll('#depot-body [data-r]').forEach(i => { etat[i.dataset.r] = i.value; });
    document.querySelectorAll('#depot-body [data-nc]').forEach(i => { nouveauClient[i.dataset.nc] = i.value.trim(); });
  }
  function enregistrer(patch = {}) {
    if (etat.immatriculation) etat.immatriculation = formatPlaque(etat.immatriculation);
    const enBase = etat.id ? db.get('vehicules', etat.id) : null;
    const saved = db.upsert('vehicules', { ...etat, ...extra, ...patch, mode: 'depot', depotEtape: Math.max(maxEtape, num(etat.depotEtape)),
      ...(enBase ? { documents: enBase.documents, photos: enBase.photos } : {}) });
    if (!etat.id) creeIci = true;
    etat = { ...saved };
    extra = {};
    return saved;
  }

  // Passage à l'étape suivante : chaque étape vérifie ce qui lui est indispensable.
  function verifier() {
    if (etape === 1 && !etat.vendeurId) {
      const c = nouveauClient;
      if (!c.nom || !c.telephone) { toast('Choisis un client ou saisis au moins son nom et son téléphone.'); return false; }
      etat.vendeurId = db.upsert('clients', { ...c, source: 'Passage au garage' }).id;
      nouveauClient = {};
    }
    if (etape === 2) {
      const manque = [['marque', 'marque'], ['modele', 'modèle'], ['kilometrage', 'kilométrage']].filter(([k]) => !String(etat[k] || '').trim()).map(([, l]) => l);
      if (manque.length) { toast('Il manque : ' + manque.join(', ')); return false; }
      const dup = etat.immatriculation && db.all('vehicules').find(v => v.immatriculation === formatPlaque(etat.immatriculation) && v.id !== etat.id);
      if (dup && !confirm(`La plaque ${formatPlaque(etat.immatriculation)} existe déjà (${vehiculeNom(dup)}). Continuer ?`)) return false;
    }
    if (etape === 3) {
      if (!num(etat.prixVente)) { toast('Saisis le prix de vente convenu.'); $('#r-prixVente')?.focus(); return false; }
      if (etat.commissionType === 'net' && !num(etat.prixNetVendeur)) { toast('Saisis le net vendeur garanti.'); return false; }
    }
    return true;
  }
  function aller(n) {
    lire();
    if (n > etape) {
      for (let e = etape; e < n; e++) { etape = e; if (!verifier()) { afficher(); return; } }
      maxEtape = Math.max(maxEtape, n);
    }
    // Le brouillon est enregistré dès que le véhicule est saisi (pour pouvoir y ranger les documents).
    if (n >= 3 || etat.id) enregistrer();
    etape = n;
    afficher();
  }

  // Dépôt validé : mandat daté, véhicule en stock, ligne au livre de police, fin du mandat au planning.
  function valider() {
    lire();
    if (valide(etat)) { $('#dlg-depot').close(); return; }
    const avant = etape;
    for (const e of [1, 2, 3]) { etape = e; if (!verifier()) { maxEtape = Math.max(maxEtape, e); afficher(); return; } }
    etape = avant;
    const debut = etat.mandatDebut || today();
    const saved = enregistrer({ statut: 'En stock', dateEntree: etat.dateEntree || today(), achatDate: etat.achatDate || today(), mandatDebut: debut,
      mandatFin: Depot.finMandat({ ...etat, mandatDebut: debut, mandatFin: '' }) });
    Papiers.apresAchat(saved);
    const v = db.get('vehicules', saved.id);
    db.upsert('planning', { type: 'Autre', date: v.mandatFin, heure: '', clientId: v.vendeurId || '', vehiculeId: v.id, fait: false,
      notes: 'Fin du mandat de dépôt-vente : prolonger ou rendre le véhicule' });
    garde = true;
    $('#dlg-depot').close();
    const manque = docsManquants(v);
    toast(manque.length ? `Dépôt validé, en stock. Documents à prendre : ${manque.join(', ')}` : 'Dépôt validé : le véhicule est en stock');
    vueDepot = 'stock';
    switchTab('depot');
    setTimeout(() => alerteRecherche(v), 2800);
  }
  function plusTard() {
    lire();
    if (etape === 1 && !etat.vendeurId && nouveauClient.nom) { if (!verifier()) return; }
    if (!etat.vendeurId && !etat.marque && !etat.immatriculation) { toast('Indique au moins le client ou le véhicule.'); return; }
    enregistrer({ depotEtape: Math.max(maxEtape, etape) });
    garde = true;
    $('#dlg-depot').close();
    vueDepot = 'brouillons';
    switchTab('depot');
    toast('Dépôt enregistré : retrouve-le dans « À compléter »');
  }

  // ---------- Documents ----------
  async function ajouter(cle, f) {
    if (!etat.id) enregistrer();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const ext = (f.name.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase();
    const chemin = `${Sync.entreprise.id}/vehicules/${etat.id}/${id}${ext}`;
    await Fichiers.envoyerFichier(f, chemin);
    const v = db.get('vehicules', etat.id);
    db.upsert('vehicules', { id: v.id, documents: (v.documents || []).concat({ id, type: libelle(cle), piece: cle, nom: `${libelle(cle)}${ext}`, chemin, date: today() }) });
  }
  async function televerser(cle, fichiers) {
    if (!Sync.role) { toast('Connecte-toi pour ranger des documents.'); return; }
    for (const brut of fichiers) {
      try {
        const f = await Scan.reduire(brut);
        toast(`Envoi : ${libelle(cle)}…`);
        await ajouter(cle, f);
        lireDocument(cle, f);
      } catch (err) { toast(err.message); }
    }
    if (etape === 4) afficher();
    render();
  }

  // Infos lues sur le document : remplissent seulement les champs vides du client et du véhicule.
  const CHAMPS_CLIENT = { nom: 'Nom', prenom: 'Prénom', dateNaissance: 'Date de naissance', adresse: 'Adresse', codePostal: 'Code postal', ville: 'Ville', iban: 'IBAN', bic: 'BIC' };
  const CHAMPS_VEHICULE = { immatriculation: 'Plaque', vin: 'VIN', marque: 'Marque', modele: 'Modèle', annee: 'Année', miseEnCirculation: '1re mise en circulation',
    puissanceFiscale: 'Puissance fiscale', carburant: 'Carburant', pieceType: "Pièce d'identité", pieceNumero: 'N° de la pièce' };
  async function lireDocument(cle, f) {
    if (!/^image\//.test(f.type)) return;
    const box = $('#d-lu');
    if (box) { box.hidden = false; box.innerHTML = `<span class="hint">Lecture de « ${esc(libelle(cle))} »…</span>`; }
    let infos = {};
    try { infos = await Scan.lire(cle, f); } catch (err) { if (box) box.innerHTML = `<span class="hint">${esc(err.message)}</span>`; return; }
    const remplis = [];
    const c = db.get('clients', etat.vendeurId);
    if (c) {
      const patch = {};
      Object.keys(CHAMPS_CLIENT).forEach(k => { if (infos[k] && !c[k]) { patch[k] = infos[k]; remplis.push(`${CHAMPS_CLIENT[k]} : ${infos[k]}`); } });
      if (Object.keys(patch).length) db.upsert('clients', { id: c.id, ...patch });
    }
    const v = db.get('vehicules', etat.id);
    if (v) {
      const patch = {};
      const cible = { pieceType: 'vendeurPieceType', pieceNumero: 'vendeurPieceNumero' };
      Object.keys(CHAMPS_VEHICULE).forEach(k => {
        const champ = cible[k] || k;
        if (infos[k] && !v[champ]) { patch[champ] = k === 'immatriculation' ? formatPlaque(infos[k]) : infos[k]; remplis.push(`${CHAMPS_VEHICULE[k]} : ${infos[k]}`); }
      });
      if (Object.keys(patch).length) { db.upsert('vehicules', { id: v.id, ...patch }); Object.assign(etat, patch); }
    }
    const b = $('#d-lu');
    if (!b) { if (remplis.length) toast(`${libelle(cle)} lu : ${remplis.length} info(s) remplie(s)`); return; }
    b.hidden = false;
    b.innerHTML = remplis.length ? `<strong>Lu sur « ${esc(libelle(cle))} » et ajouté à la fiche :</strong><ul>${remplis.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <span class="hint">Vérifie ces infos : la lecture automatique peut se tromper.</span>`
      : `<span class="hint">Rien de nouveau lu sur « ${esc(libelle(cle))} » (photo floue, ou infos déjà remplies).</span>`;
  }

  function init() {
    const body = $('#depot-body');
    body.addEventListener('click', async e => {
      const d = e.target.closest('[data-d]')?.dataset.d;
      if (d === 'changer-client') { etat.vendeurId = ''; afficher(); return; }
      if (d === 'photos') {
        if (!Sync.role) { toast('Connecte-toi pour ranger des documents.'); return; }
        const v = db.get('vehicules', etat.id) || etat;
        const aFaire = DOCS.filter(([cle]) => !docsDe(v, cle).length).map(([cle, l]) => ({ cle, libelle: l }));
        Scan.lancer(aFaire.length ? aFaire : DOCS.map(([cle, l]) => ({ cle, libelle: l })), (cle, f) => televerser(cle, [f]), () => { if (etape === 4) afficher(); });
        return;
      }
      if (d === 'plaque') {
        lire();
        const btn = e.target;
        etat.immatriculation = formatPlaque(etat.immatriculation || '');
        btn.disabled = true; btn.textContent = 'Recherche…';
        try {
          const r = await Plaque.rechercher(etat.immatriculation);
          ['marque', 'modele', 'finition', 'annee', 'carburant', 'boite', 'couleur', 'vin'].forEach(k => { if (r[k]) etat[k] = r[k]; });
          ['miseEnCirculation', 'type', 'puissanceCh', 'puissanceFiscale', 'cylindree', 'co2', 'portes', 'places', 'image', 'ficheTechnique']
            .forEach(k => { if (r[k]) extra[k] = r[k]; });
          if (r.image) etat.image = r.image;
          trouve = r.description || [r.marque, r.modele, r.finition].filter(Boolean).join(' ');
          afficher();
          toast('Véhicule trouvé');
        } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = 'Rechercher'; }
        return;
      }
      const s = e.target.dataset.dSuppr;
      if (s) {
        const v = db.get('vehicules', etat.id);
        const doc = (v?.documents || []).find(x => x.id === s);
        if (!doc || !confirm(`Supprimer « ${doc.nom} » ?`)) return;
        if (Sync.role) await Sync.client.storage.from('documents').remove([doc.chemin]);
        db.upsert('vehicules', { id: v.id, documents: v.documents.filter(x => x.id !== s) });
        afficher();
      }
    });
    body.addEventListener('change', e => {
      if (e.target.id === 'd-client' && e.target.value) { etat.vendeurId = e.target.value; afficher(); return; }
      const cle = e.target.dataset.dFichier;
      if (cle) { const fs = [...e.target.files]; e.target.value = ''; televerser(cle, fs); return; }
      // Type de commission : les champs du mandat changent.
      if (e.target.dataset.r === 'commissionType') { lire(); delete etat.commissionValeur; afficher(); }
    });
    body.addEventListener('input', e => {
      if (!e.target.dataset.r) return;
      etat[e.target.dataset.r] = e.target.value;
      if ($('#depot-resume')) $('#depot-resume').innerHTML = Depot.resume(etat);
    });
    $('#depot-etapes').addEventListener('click', e => { const b = e.target.closest('[data-etape]'); if (b) aller(Number(b.dataset.etape)); });
    $('#d-btn-suivant').addEventListener('click', () => aller(etape + 1));
    $('#d-btn-retour').addEventListener('click', () => { if (etape === 1) $('#dlg-depot').close(); else aller(etape - 1); });
    $('#d-btn-valider').addEventListener('click', valider);
    $('#d-btn-plus-tard').addEventListener('click', plusTard);
    $('#d-btn-fermer').addEventListener('click', () => $('#dlg-depot').close());
    // Fermé sans « Enregistrer pour plus tard » : un brouillon créé pendant cette ouverture est gardé seulement si on le veut.
    $('#dlg-depot').addEventListener('close', () => {
      const v = etat?.id && db.get('vehicules', etat.id);
      if (v && creeIci && !garde && v.statut === 'Dépôt en cours' && !(v.documents || []).length
          && !confirm('Garder ce dépôt dans « À compléter » pour le finir plus tard ?')) db.remove('vehicules', v.id);
      etat = null;
      render();
    });
  }

  return { init, ouvrir, docsManquants, DOCS };
})();
