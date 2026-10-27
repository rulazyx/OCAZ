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
    $('#r-btn-suivant').hidden = page !== 1;
    $('#r-btn-valider').hidden = page !== 2 || !enCours;
    $('#r-btn-enregistrer').textContent = enCours ? 'Enregistrer pour plus tard' : 'Enregistrer';
    const annuler = $('#r-btn-annuler');
    annuler.hidden = !etat.id || !['Reprise à étudier', 'Reprise validée', 'Reprise refusée'].includes(etat.statut);
    annuler.textContent = etat.statut === 'Reprise refusée' ? 'Remettre en cours' : 'Annuler la reprise';
    annuler.className = etat.statut === 'Reprise refusée' ? '' : 'danger';
  }
  let page_ = 1;

  // Page 1 : infos minimales demandées par les sites de cote (le vendeur n'est pas demandé : c'est le client de l'offre).
  function page1() {
    $('#reprise-titre').textContent = etat.id ? 'Modifier la reprise' : 'Nouvelle reprise';
    $('#reprise-body').innerHTML = `
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
      </div>`;
    boutons(1);
  }

  // Page 2 : fiche reprise (cote, frais, prix de reprise).
  function page2() {
    const v = etat;
    const c = calcul(v);
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
      ${v.statut === 'Reprise validée' ? '<p class="hint">Reprise validée : choisis-la dans « Véhicule repris » d\'une offre. Quand l\'offre passe en commande, le véhicule entre en préparation.</p>' : ''}`;
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

  function init() {
    const body = $('#reprise-body');
    body.addEventListener('input', e => {
      const k = e.target.dataset.r;
      if (!k) return;
      etat[k] = e.target.value;
      if ($('#r-fourchette')) majCalcul();
    });
    body.addEventListener('change', e => {
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
    $('#r-btn-retour').addEventListener('click', () => { if (page_ === 2) page1(); else fermer(); });
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
      toast('Reprise validée : tu peux l\'ajouter dans une offre');
      fermer();
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

  return { ouvrir, init, reglages };
})();
