// Parcours de reprise en deux pages :
// 1) les infos minimales pour coter le véhicule (comme sur La Centrale / Leboncoin),
// 2) la fiche reprise : cote, frais, hausse Réunion, fourchette de reprise et prix saisi à la main.
const Reprise = (() => {
  // Hausse des prix à La Réunion et marge visée : réglées dans Paramètres, partagées par l'équipe.
  const reglages = () => Param.get().reprise;

  const CARBURANTS = ['', 'Essence', 'Diesel', 'Hybride', 'Hybride rechargeable', 'Électrique', 'GPL'];
  const BOITES = ['', 'Manuelle', 'Automatique'];
  let etat = null;
  let extra = {}; // données complètes renvoyées par la recherche par plaque
  let trouve = ''; // véhicule trouvé par la plaque, affiché sous le champ

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

  // Page 1 : infos minimales demandées par les sites de cote.
  function page1() {
    const depot = Depot.est(etat);
    $('#reprise-titre').textContent = etat.id ? 'Modifier' : depot ? 'Nouveau dépôt-vente' : 'Nouvelle reprise';
    const clients = db.all('clients').slice().sort((a, b) => norm(clientNom(a)).localeCompare(norm(clientNom(b))));
    $('#reprise-body').innerHTML = `
      ${etat.statut === 'Reprise à étudier' ? `<div class="segmented mode-choix"><button type="button" data-mode="achat" class="${depot ? '' : 'active'}">Achat / reprise</button>
        <button type="button" data-mode="depot" class="${depot ? 'active' : ''}">Dépôt-vente</button></div>` : ''}
      ${etat.image ? `<div class="vehicule-image"><img src="${esc(etat.image)}" alt="" onerror="this.parentNode.remove()"></div>` : ''}
      <div class="lookup">
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
        <div class="field full"><label for="r-vendeurId">${depot ? 'Propriétaire (client qui confie le véhicule)' : 'Vendeur (client qui cède le véhicule)'}</label>
          <select id="r-vendeurId" data-r="vendeurId"><option value="">Aucun pour l'instant</option>${clients.map(c =>
            `<option value="${c.id}"${c.id === etat.vendeurId ? ' selected' : ''}>${esc(clientNom(c))}</option>`).join('')}</select></div>
      </div>`;
    $('#r-btn-suivant').hidden = false;
    $('#r-btn-suivant').textContent = depot ? 'Créer le dépôt →' : 'Créer et coter →';
    ['#r-btn-valider', '#r-btn-refuser', '#r-btn-enregistrer', '#r-btn-supprimer'].forEach(s => { $(s).hidden = true; });
  }

  // Page 2 : fiche reprise.
  // Page 2 d'un dépôt-vente : le mandat au lieu de la cote et du prix de reprise.
  function page2Depot() {
    const v = etat;
    const proprio = db.get('clients', v.vendeurId);
    $('#reprise-titre').textContent = 'Dépôt-vente';
    $('#reprise-body').innerHTML = `
      <div class="o-choix">${v.image ? `<img src="${esc(v.image)}" alt="" onerror="this.remove()">` : ''}
        <div><strong>${esc(vehiculeNom(v))}</strong>
        <span class="sub">${esc([v.annee, km(v.kilometrage), v.carburant, v.boite].filter(Boolean).join(' · '))}</span>
        <span class="sub">${v.immatriculation ? esc(v.immatriculation) + ' · ' : ''}${proprio ? 'Propriétaire : ' + esc(clientNom(proprio)) : 'Pas de propriétaire'}</span></div>
        <button type="button" class="chip" id="r-btn-modifier">Modifier</button></div>
      ${Depot.page2(v)}
      <div class="field"><label for="r-defauts">État, défauts constatés, notes</label><textarea id="r-defauts" data-r="defauts">${esc(v.defauts || '')}</textarea></div>
      ${Papiers.champsAchat(v)}
      ${Papiers.section(db.get('vehicules', v.id))}`;
    $('#r-btn-suivant').hidden = true;
    const enCours = v.statut === 'Reprise à étudier';
    $('#r-btn-valider').hidden = !enCours;
    $('#r-btn-valider').textContent = 'Valider le dépôt → en stock';
    $('#r-btn-refuser').hidden = !enCours;
    $('#r-btn-enregistrer').hidden = false;
    $('#r-btn-supprimer').hidden = false;
  }

  function page2() {
    if (Depot.est(etat)) { page2Depot(); return; }
    $('#r-btn-valider').textContent = 'Valider la reprise → préparation';
    const v = etat;
    const c = calcul(v);
    const vendeur = db.get('clients', v.vendeurId);
    const modele = [v.marque, v.modele, v.finition, v.annee].filter(Boolean).join(' ');
    $('#reprise-titre').textContent = 'Fiche reprise';
    $('#reprise-body').innerHTML = `
      <div class="o-choix">${v.image ? `<img src="${esc(v.image)}" alt="" onerror="this.remove()">` : ''}
        <div><strong>${esc(vehiculeNom(v))}</strong>
        <span class="sub">${esc([v.annee, km(v.kilometrage), v.carburant, v.boite].filter(Boolean).join(' · '))}</span>
        <span class="sub">${v.immatriculation ? esc(v.immatriculation) + ' · ' : ''}${vendeur ? 'Vendeur : ' + esc(clientNom(vendeur)) : 'Pas de vendeur'}</span></div>
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
      ${Papiers.champsAchat(v)}
      ${Papiers.section(db.get('vehicules', v.id))}`;
    $('#r-btn-suivant').hidden = true;
    const enCours = v.statut === 'Reprise à étudier';
    $('#r-btn-valider').hidden = !enCours;
    $('#r-btn-refuser').hidden = !enCours;
    $('#r-btn-enregistrer').hidden = false;
    $('#r-btn-supprimer').hidden = false;
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
    etat = id ? { ...db.get('vehicules', id) } : { statut: 'Reprise à étudier', mode: Param.get().activite.mode, ...preset };
    extra = {}; trouve = '';
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
    return saved;
  }

  // Dépôt validé : mandat daté, véhicule en stock, ligne au livre de police, fin du mandat au planning.
  function validerDepot() {
    document.querySelectorAll('#reprise-body [data-r]').forEach(i => { etat[i.dataset.r] = i.value; });
    if (!num(etat.prixVente)) { toast('Saisis le prix de vente affiché avant de valider.'); $('#r-prixVente')?.focus(); return; }
    if (etat.commissionType === 'net' && !num(etat.prixNetVendeur)) { toast('Saisis le net vendeur garanti.'); return; }
    if ((!etat.vendeurId || !etat.vendeurPieceNumero) && !confirm("Le livre de police demande le propriétaire et le numéro de sa pièce d'identité. Valider quand même et compléter plus tard ?")) return;
    const debut = etat.mandatDebut || today();
    const saved = enregistrer({ statut: 'En stock', dateEntree: etat.dateEntree || today(), achatDate: etat.achatDate || today(), mandatDebut: debut,
      mandatFin: Depot.finMandat({ ...etat, mandatDebut: debut, mandatFin: '' }) });
    Papiers.apresAchat(saved);
    const v = db.get('vehicules', saved.id);
    db.upsert('planning', { type: 'Autre', date: v.mandatFin, heure: '', clientId: v.vendeurId || '', vehiculeId: v.id, fait: false,
      notes: `Fin du mandat de dépôt-vente : prolonger ou rendre le véhicule` });
    $('#dlg-reprise').close();
    toast('Dépôt validé : le véhicule est en stock. Imprime le mandat depuis sa fiche.');
    vueStock = 'stock';
    switchTab('stock');
    setTimeout(() => alerteRecherche(v), 2800);
  }

  function init() {
    const body = $('#reprise-body');
    body.addEventListener('input', e => {
      const k = e.target.dataset.r;
      if (!k) return;
      etat[k] = e.target.value;
      if ($('#r-fourchette')) majCalcul();
      if ($('#depot-resume')) $('#depot-resume').innerHTML = Depot.resume(etat);
    });
    body.addEventListener('change', e => {
      const k = e.target.dataset.r;
      if (!k) return;
      etat[k] = e.target.value;
      // Le type de commission change les champs à remplir.
      if (k === 'commissionType') { delete etat.commissionValeur; page2Depot(); }
    });
    body.addEventListener('click', async e => {
      const mode = e.target.closest('[data-mode]');
      if (mode) { etat.mode = mode.dataset.mode; page1(); return; }
      if (e.target.id === 'r-btn-modifier') { page1(); $('#r-btn-suivant').textContent = 'Enregistrer et revenir →'; return; }
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
          toast(err.message);
        } finally {
          btn.disabled = false; btn.textContent = 'Rechercher';
        }
      }
    });
    $('#r-btn-suivant').addEventListener('click', () => {
      const manque = ['marque', 'modele', 'annee', 'kilometrage', 'carburant', 'boite'].filter(k => !String(etat[k] || '').trim());
      if (manque.length) { toast('Il manque : ' + manque.join(', ')); return; }
      if (etat.immatriculation) etat.immatriculation = formatPlaque(etat.immatriculation);
      const dup = etat.immatriculation && db.all('vehicules').find(v => v.immatriculation === etat.immatriculation && v.id !== etat.id);
      if (dup && !confirm(`La plaque ${etat.immatriculation} existe déjà (${vehiculeNom(dup)}). Continuer ?`)) return;
      const nouveau = !etat.id;
      const saved = enregistrer();
      page2();
      render();
      if (nouveau) alerteRecherche(saved);
    });
    $('#r-btn-enregistrer').addEventListener('click', () => { enregistrer(); $('#dlg-reprise').close(); toast('Reprise enregistrée'); render(); });
    $('#r-btn-refuser').addEventListener('click', () => { enregistrer({ statut: 'Reprise refusée' }); $('#dlg-reprise').close(); toast('Reprise refusée'); render(); });
    $('#r-btn-valider').addEventListener('click', () => {
      if (Depot.est(etat)) { validerDepot(); return; }
      if (!num(etat.prixPropose)) { toast('Saisis le prix de reprise avant de valider.'); $('#r-prixPropose')?.focus(); return; }
      // Champs du livre de police pré-remplis depuis le client : ils comptent même s'ils n'ont pas été retouchés.
      document.querySelectorAll('#reprise-body [data-r^="vendeurPiece"], #reprise-body [data-r^="achat"]').forEach(i => { etat[i.dataset.r] = i.value; });
      if ((!etat.vendeurId || !etat.vendeurPieceNumero) && !confirm("Le livre de police demande le vendeur et le numéro de sa pièce d'identité. Valider quand même et compléter plus tard ?")) return;
      const saved = enregistrer({ statut: 'En préparation', prixAchat: etat.prixAchat || etat.prixPropose, dateEntree: etat.dateEntree || today(), achatDate: etat.achatDate || today() });
      Papiers.apresAchat(saved);
      setTimeout(() => alerteRecherche(saved), 2800);
      $('#dlg-reprise').close();
      toast('Reprise validée : le véhicule passe en préparation');
      switchTab('stock');
      vueStock = 'preparation';
      render();
    });
    $('#r-btn-supprimer').addEventListener('click', () => {
      const ok = TABS.vehicules.canDelete(etat);
      if (ok !== true) { toast(ok); return; }
      if (!confirm('Supprimer définitivement cette reprise ?')) return;
      db.remove('vehicules', etat.id);
      TABS.vehicules.afterDelete(etat);
      $('#dlg-reprise').close();
      render();
    });
    $('#r-btn-fermer').addEventListener('click', () => { $('#dlg-reprise').close(); render(); });
  }

  return { ouvrir, init, reglages };
})();
