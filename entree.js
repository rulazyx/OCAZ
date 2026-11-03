// Entrée en stock d'une reprise validée (bouton « Rentrer en stock » de la fiche reprise).
// Une page en quatre parties : Photos, Informations (reprises de la reprise, le reste à compléter),
// Options (cases à cocher par catégorie, pré-cochées avec ce que disent la carte grise et la plaque) et Vente
// (prix d'achat, prix de vente, date d'entrée, livre de police).
const EntreeStock = (() => {
  // Options classées par catégorie. Les libellés cochés vont dans « Options et équipements » (repris sur l'offre).
  const OPTIONS = {
    'Confort': ['Climatisation', 'Climatisation automatique', 'Climatisation bi-zone', 'Sièges chauffants', 'Sièges électriques',
      'Volant chauffant', 'Toit ouvrant', 'Toit panoramique', 'Vitres arrière surteintées', 'Accès et démarrage sans clé',
      'Hayon électrique', 'Régulateur de vitesse', 'Limiteur de vitesse'],
    'Multimédia': ['Écran tactile', 'GPS', 'Apple CarPlay', 'Android Auto', 'Bluetooth', 'Prise USB', 'Recharge sans fil',
      'Système audio premium', 'Compteurs numériques'],
    'Aides à la conduite et sécurité': ['Radar de recul', 'Radars avant', 'Caméra de recul', 'Caméra 360°', 'Aide au stationnement',
      'Régulateur adaptatif', 'Alerte de franchissement de ligne', 'Maintien dans la voie', "Freinage d'urgence automatique",
      "Surveillance d'angle mort", 'Lecture des panneaux', 'Feux de route automatiques', 'Détecteur de pluie',
      'Allumage automatique des feux', 'Affichage tête haute'],
    'Extérieur': ['Jantes alliage', 'Phares LED', 'Phares xénon', 'Antibrouillards', 'Rétroviseurs rabattables électriquement',
      'Barres de toit', 'Attelage', 'Peinture métallisée'],
    'Intérieur': ['Sellerie cuir', 'Sellerie mi-cuir', 'Accoudoir central', 'Banquette rabattable', "Éclairage d'ambiance", '7 places'],
    'Motorisation et transmission': ['Boîte automatique', 'Palettes au volant', 'Transmission intégrale (4x4)', 'Start & Stop',
      'Modes de conduite', 'Hybride', 'Électrique', 'Câble de recharge'],
  };
  const TOUTES = Object.values(OPTIONS).flat();
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Options déduites de la carte grise, de la plaque et du nom de la version (ex. « 1.5 dCi EDC Intens GPS »).
  function deduites(v) {
    const out = new Set();
    const texte = norm([v.finition, v.typeVariante, ...Object.values(v.ficheTechnique || {})].join(' '));
    if (v.boite === 'Automatique' || /\b(bva|eat\d?|edc|dsg|dct|s.?tronic|steptronic|cvt|automatique)\b/.test(texte)) out.add('Boîte automatique');
    if (/hybride/i.test(v.carburant || '')) out.add('Hybride');
    if (v.carburant === 'Électrique') out.add('Électrique');
    if (num(v.places) >= 7) out.add('7 places');
    if (/\b(4x4|4wd|awd|quattro|xdrive|4motion|allgrip|4matic|integrale)\b/.test(texte)) out.add('Transmission intégrale (4x4)');
    if (/\b(gps|navi|nav)\b/.test(texte)) out.add('GPS');
    if (/\bcuir\b/.test(texte)) out.add('Sellerie cuir');
    if (/toit pano/.test(texte)) out.add('Toit panoramique');
    if (/\bclim/.test(texte)) out.add('Climatisation');
    return out;
  }

  // (fonction : TYPES vient de app.js, chargé après ce fichier)
  const INFOS_ = () => [
    ['immatriculation', 'Plaque'], ['vin', 'N° de série (VIN)'], ['marque', 'Marque'], ['modele', 'Modèle'],
    ['finition', 'Version / finition', 'full'], ['annee', 'Année', 'number'], ['miseEnCirculation', '1re mise en circulation', 'date'],
    ['kilometrage', 'Kilométrage', 'number'], ['carburant', 'Carburant', ['', 'Essence', 'Diesel', 'Hybride', 'Hybride rechargeable', 'Électrique', 'GPL', 'Autre']],
    ['boite', 'Boîte', ['', 'Manuelle', 'Automatique']], ['couleur', 'Couleur'], ['type', 'Type', TYPES],
    ['puissanceCh', 'Puissance (ch)', 'number'], ['puissanceFiscale', 'Puissance fiscale (CV)', 'number'], ['cylindree', 'Cylindrée (cm³)', 'number'],
    ['co2', 'CO₂ (g/km)', 'number'], ['portes', 'Portes', 'number'], ['places', 'Places', 'number'],
  ];

  let etat = null, auto = new Set();

  const valeur = k => etat[k] ?? '';
  function champ(k, l, type = 'text') {
    const vide = !String(valeur(k)).trim();
    const cls = 'field' + (type === 'full' ? ' full' : '') + (vide ? ' a-remplir' : '');
    if (Array.isArray(type)) return `<div class="${cls}"><label for="s-${k}">${l}</label>
      <select id="s-${k}" data-s="${k}">${type.map(o => `<option${o === valeur(k) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
    const t = ['number', 'date'].includes(type) ? type : 'text';
    return `<div class="${cls}"><label for="s-${k}">${l}</label><input id="s-${k}" data-s="${k}" type="${t}" value="${esc(valeur(k))}"${t === 'number' ? ' inputmode="decimal"' : ''}></div>`;
  }

  async function photos() {
    const box = $('#s-photos');
    if (!box) return;
    const n = (etat.photos || []).length;
    $('#s-photos-n').textContent = n ? `${n} photo${n > 1 ? 's' : ''}` : 'aucune';
    if (!n) { box.innerHTML = `<span class="hint">Pas encore de photos (${Photos.MIN} minimum pour la mise en ligne).</span>`; return; }
    await Photos.galerie(box, etat);
  }

  function afficher() {
    const v = etat;
    const vides = INFOS_().filter(([k]) => !String(valeur(k)).trim()).length;
    const coches = new Set(v.options || []);
    const clients = db.all('clients').slice().sort((a, b) => clientNom(a).localeCompare(clientNom(b)));
    const achat = Papiers.champsAchat(v)
      .replace(/data-r=/g, 'data-s=').replace(/id="r-/g, 'id="s-').replace(/for="r-/g, 'for="s-')
      .replace(/ Choisis d'abord le [^<]*/, ' Choisis le vendeur juste au-dessus.');
    $('#entree-titre').textContent = 'Rentrer en stock · ' + vehiculeNom(v);
    $('#entree-body').innerHTML = `
      <h3 class="section">Photos <span class="hint" id="s-photos-n"></span></h3>
      <div id="s-photos" class="s-photos"></div>
      <div class="inline s-photo-btns">
        <button type="button" class="primary" id="s-btn-photos">📷 Prendre ou ajouter des photos</button>
      </div>

      <h3 class="section">Informations</h3>
      <p class="hint">${vides ? `Repris de la reprise. <strong>${vides} info${vides > 1 ? 's' : ''} à compléter</strong> (cadres en jaune).` : 'Repris de la reprise : tout est rempli, vérifie simplement.'}</p>
      <div class="grid">${INFOS_().map(([k, l, t]) => champ(k, l, t)).join('')}</div>

      <h3 class="section">Options</h3>
      <p class="hint">${auto.size ? `${auto.size} option${auto.size > 1 ? 's' : ''} cochée${auto.size > 1 ? 's' : ''} d'après la carte grise et la plaque (marquées « auto »). ` : ''}Coche le reste en faisant le tour du véhicule.</p>
      <div class="s-options">${Object.entries(OPTIONS).map(([cat, liste]) => {
        const n = liste.filter(o => coches.has(o)).length;
        return `<details${n ? ' open' : ''}><summary>${esc(cat)} <span class="s-n">${n || ''}</span></summary>
          <div class="s-cases">${liste.map(o => `<label class="check"><input type="checkbox" data-opt="${esc(o)}"${coches.has(o) ? ' checked' : ''}><span>${esc(o)}${auto.has(o) ? ' <em class="s-auto">auto</em>' : ''}</span></label>`).join('')}</div>
        </details>`;
      }).join('')}</div>
      <div class="field"><label for="s-optionsAutres">Autres options et équipements</label>
        <textarea id="s-optionsAutres" data-s="optionsAutres" placeholder="Une par ligne ou séparées par des virgules">${esc(v.optionsAutres || '')}</textarea></div>

      <h3 class="section">Vente</h3>
      <div class="grid">
        <div class="field"><label for="s-prixAchat">Prix d'achat (€)</label><input id="s-prixAchat" data-s="prixAchat" type="number" inputmode="decimal" value="${esc(v.prixAchat || '')}"></div>
        <div class="field"><label for="s-prixVente">Prix de vente (€)</label><input id="s-prixVente" data-s="prixVente" type="number" inputmode="decimal" value="${esc(v.prixVente || '')}"></div>
        <div class="field"><label for="s-dateEntree">Entrée en stock</label><input id="s-dateEntree" data-s="dateEntree" type="date" value="${esc(v.dateEntree || today())}"></div>
        <div class="field"><label for="s-statut">Le véhicule passe</label><select id="s-statut" data-s="statut">
          <option value="En préparation"${v.statut === 'En préparation' ? ' selected' : ''}>En préparation</option>
          <option value="En stock"${v.statut === 'En stock' ? ' selected' : ''}>En stock, prêt à vendre</option></select></div>
        <div class="field full"><label for="s-vendeurId">Vendeur (client qui cède le véhicule)</label><select id="s-vendeurId" data-s="vendeurId">
          <option value="">— à choisir —</option>${clients.map(c => `<option value="${esc(c.id)}"${c.id === v.vendeurId ? ' selected' : ''}>${esc(clientNom(c))}</option>`).join('')}</select></div>
      </div>
      <p class="hint" id="s-marge">${margeTexte()}</p>
      ${achat}`;
    photos();
  }

  function margeTexte() {
    const achat = num(etat.prixAchat), vente = num(etat.prixVente), frais = num(etat.fraisEstimes);
    if (!achat || !vente) return 'Saisis le prix de vente pour voir la marge.';
    return `Marge estimée : ${euros(vente - achat - frais)}${frais ? ` (frais prévus ${euros(frais)} déduits)` : ''}`;
  }

  function ouvrir(id) {
    const v = db.get('vehicules', id);
    if (!v) return;
    etat = { ...v };
    // Prix d'achat = prix de reprise ; préparation s'il reste des frais à faire.
    if (!etat.prixAchat) etat.prixAchat = etat.prixPropose || '';
    if (!DISPONIBLE.includes(etat.statut)) etat.statut = num(etat.fraisEstimes) > 0 ? 'En préparation' : 'En stock';
    if (!etat.achatPaiement) etat.achatPaiement = '';
    auto = new Set();
    if (!Array.isArray(etat.options)) {
      // Première ouverture : options déduites, et l'ancien texte libre gardé dans « Autres ».
      auto = deduites(etat);
      etat.options = [...auto];
      const anciennes = String(etat.equipements || '').split(/\n|,|;|•/).map(x => x.trim()).filter(Boolean);
      anciennes.forEach(o => { const t = TOUTES.find(x => norm(x) === norm(o)); if (t) etat.options.push(t); });
      etat.optionsAutres = anciennes.filter(o => !TOUTES.some(x => norm(x) === norm(o))).join(', ');
    }
    afficher();
    $('#dlg-entree').showModal();
  }

  function enregistrer(entrer) {
    const options = TOUTES.filter(o => etat.options.includes(o));
    const autres = String(etat.optionsAutres || '').split(/\n|,|;|•/).map(x => x.trim()).filter(Boolean);
    const patch = { ...etat, options, equipements: [...options, ...autres].join(', ') };
    if (patch.immatriculation) patch.immatriculation = formatPlaque(patch.immatriculation);
    const enBase = db.get('vehicules', etat.id) || {};
    // Photos et documents changent ailleurs (fenêtre photos, envois) : on garde leur dernière version.
    patch.photos = enBase.photos; patch.documents = enBase.documents;
    if (!entrer) { patch.statut = enBase.statut; patch.dateEntree = enBase.dateEntree || ''; }
    else { patch.achatDate = patch.achatDate || today(); patch.dateEntree = patch.dateEntree || today(); }
    const saved = db.upsert('vehicules', patch);
    etat = { ...saved, options };
    if (entrer) Papiers.apresAchat(saved);
    return saved;
  }

  function init() {
    const body = $('#entree-body');
    const lire = e => {
      const k = e.target.dataset.s;
      if (k) {
        etat[k] = e.target.value;
        e.target.closest('.field')?.classList.toggle('a-remplir', INFOS_().some(([x]) => x === k) && !e.target.value.trim());
        if (['prixAchat', 'prixVente'].includes(k)) $('#s-marge').textContent = margeTexte();
      }
      const o = e.target.dataset.opt;
      if (o) {
        etat.options = e.target.checked ? [...new Set([...etat.options, o])] : etat.options.filter(x => x !== o);
        const d = e.target.closest('details');
        const n = [...d.querySelectorAll('[data-opt]')].filter(x => x.checked).length;
        d.querySelector('.s-n').textContent = n || '';
      }
    };
    body.addEventListener('input', lire);
    body.addEventListener('change', lire);
    body.addEventListener('click', e => {
      if (e.target.id !== 's-btn-photos') return;
      enregistrer(false);
      Photos.ouvrir(etat.id);
    });
    // Retour de la fenêtre photos : la galerie se met à jour.
    $('#dlg-photos').addEventListener('close', () => {
      if (!$('#dlg-entree').open || !etat) return;
      etat.photos = db.get('vehicules', etat.id)?.photos || [];
      photos();
    });
    const fermer = () => { $('#dlg-entree').close(); render(); };
    $('#s-btn-retour').addEventListener('click', () => { enregistrer(false); fermer(); Reprise.ouvrir(etat.id); });
    $('#s-btn-fermer').addEventListener('click', () => { enregistrer(false); fermer(); });
    $('#s-btn-entrer').addEventListener('click', () => {
      const manque = ['marque', 'modele', 'kilometrage'].filter(k => !String(etat[k] || '').trim());
      if (manque.length) { toast('Il manque : ' + manque.join(', ')); return; }
      if (!num(etat.prixAchat)) { toast("Saisis le prix d'achat."); $('#s-prixAchat')?.focus(); return; }
      if (!num(etat.prixVente) && !confirm('Pas de prix de vente pour l\'instant. Rentrer quand même en stock ?')) return;
      const saved = enregistrer(true);
      vueVehicule = 'stock';
      vueStock = saved.statut === 'En préparation' ? 'preparation' : 'stock';
      switchTab('stock');
      fermer();
      toast(saved.statut === 'En préparation' ? 'Véhicule entré en préparation' : 'Véhicule entré en stock');
    });
  }

  return { ouvrir, init, OPTIONS, deduites };
})();
