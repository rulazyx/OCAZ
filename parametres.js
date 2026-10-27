// Onglet Paramètres du revendeur : son garage (logo modifiable, le reste posé par l'administrateur) et ses documents.
// Les autres réglages (packs, réseau, barèmes) gardent leurs valeurs par défaut ou celles fixées par l'administrateur
// (Sync.config) ; ils font partie des données du garage, partagées par toute l'équipe via la synchro.
const Param = (() => {
  const DEFAUTS = {
    garage: { nom: '', adresse: '', codePostal: '', ville: '', telephone: '', email: '', siret: '', tva: '', site: '', logo: '' },
    packs: [
      { id: 'demarches', nom: 'Démarches administratives', montant: 150, coche: true },
      { id: 'protection', nom: 'Protection de peinture', montant: 250, coche: false },
    ],
    // Barème carte grise de La Réunion 2026 : 60 €/CV, taxe fixe 11 €, acheminement 2,76 €.
    carteGrise: { prixCV: 60, taxeFixe: 11, acheminement: 2.76 },
    reprise: { hausseReunion: 10, margeMin: 10, margeMax: 20 },
    // Facturation : TVA sur la marge par défaut (véhicules achetés à des particuliers).
    facture: { regime: 'marge', conditions: '' },
    // Activité : achat-revente ou dépôt-vente par défaut (chaque véhicule garde son propre mode), et commission du dépôt.
    vitrine: { actif: false, slug: '' },
    // Réseau Ocaz : véhicules partagés avec les apporteurs d'affaires, et commission versée par le garage sur chaque vente apportée.
    reseau: { actif: false, commissionType: 'fixe', commissionValeur: 300, commissionMin: 0, partageDefaut: true, accepteLe: '', publieLe: '' },
    // Photos : retouche automatique (lumière, couleurs) et logo du garage en filigrane, appliqués à l'envoi.
    photos: { ameliorer: true, logo: true },
    activite: { mode: 'achat', commissionType: 'pourcentage', commissionValeur: 8, commissionMin: 500, dureeMandat: 90 },
    documents: [],
  };
  const TYPES_DOC = ['RIB', 'Kbis', 'Assurance', 'Conditions de vente', 'Autre'];
  const CHAMPS_GARAGE = [
    ['nom', "Nom de l'entreprise *", 'full'], ['adresse', 'Adresse', 'full'], ['codePostal', 'Code postal'], ['ville', 'Ville'],
    ['telephone', 'Téléphone', '', 'tel'], ['email', 'Email', '', 'email'], ['siret', 'SIRET'], ['tva', 'N° TVA intracom.'], ['site', 'Site web', 'full'],
  ];

  // Anciens réglages gardés sur l'appareil (avant l'onglet Paramètres) : repris une fois.
  function anciens() {
    const lire = k => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; } };
    const o = lire('crmzx-offre'), r = lire('crmzx-reprise');
    const p = JSON.parse(JSON.stringify(DEFAUTS));
    ['prixCV', 'taxeFixe', 'acheminement'].forEach(k => { if (o[k] != null) p.carteGrise[k] = o[k]; });
    if (o.demarches != null) p.packs[0].montant = o.demarches;
    if (o.protection != null) p.packs[1].montant = o.protection;
    ['hausseReunion', 'margeMin', 'margeMax'].forEach(k => { if (r[k] != null) p.reprise[k] = r[k]; });
    return p;
  }

  // Réglages de l'administrateur : infos légales du garage, packs livraison, réseau Ocaz et sa commission.
  function admin(p) {
    const c = (typeof Sync !== 'undefined' && Sync.config) || {};
    const infos = Object.fromEntries(Object.entries(c.infos || {}).filter(([k, v]) => k !== 'logo' && v !== '' && v != null));
    const garage = { ...DEFAUTS.garage, ...(p.garage || {}), ...infos };
    const reseau = { ...DEFAUTS.reseau, ...(p.reseau || {}) };
    if (c.droits) {
      reseau.actif = !!c.droits.reseau;
      if (reseau.actif && !reseau.accepteLe) reseau.accepteLe = new Date().toISOString();
    }
    if (c.reseau) ['commissionType', 'commissionValeur', 'commissionMin'].forEach(k => { if (c.reseau[k] !== undefined && c.reseau[k] !== '') reseau[k] = c.reseau[k]; });
    return { garage, reseau, packs: Array.isArray(c.packs) ? c.packs : null };
  }

  function get() {
    const p = db.data.parametres || anciens();
    const a = admin(p);
    return {
      ...DEFAUTS, ...p,
      garage: a.garage,
      carteGrise: { ...DEFAUTS.carteGrise, ...(p.carteGrise || {}) },
      reprise: { ...DEFAUTS.reprise, ...(p.reprise || {}) },
      facture: { ...DEFAUTS.facture, ...(p.facture || {}) },
      activite: { ...DEFAUTS.activite, ...(p.activite || {}) },
      vitrine: { ...DEFAUTS.vitrine, ...(p.vitrine || {}) },
      reseau: a.reseau,
      photos: { ...DEFAUTS.photos, ...(p.photos || {}) },
      packs: a.packs || p.packs || DEFAUTS.packs,
      documents: p.documents || [],
    };
  }
  function save(patch) {
    db.data.parametres = { ...get(), ...patch, majLe: new Date().toISOString() };
    db.save();
  }

  const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // Logo réduit à 256 px et gardé dans les paramètres (il apparaît sur l'accueil et sur les offres).
  async function lireLogo(fichier) {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(fichier); });
    const e = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * e); c.height = Math.round(img.naturalHeight * e);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    return c.toDataURL('image/png');
  }

  // Infos du garage : affichées grisées, seul le logo se change ici (le reste : contacter l'administrateur).
  function rendre() {
    const g = get().garage;
    $('#p-garage').innerHTML = CHAMPS_GARAGE.map(([k, l, cls, type]) => `<div class="field ${cls || ''}"><label for="g-${k}">${l.replace(' *', '')}</label>
      <input id="g-${k}" type="${type || 'text'}" value="${esc(g[k])}" disabled></div>`).join('');
    $('#p-logo').innerHTML = g.logo ? `<img src="${esc(g.logo)}" alt="Logo du garage">` : '<span class="hint">Pas de logo</span>';
    $('#btn-logo-suppr').hidden = !g.logo;
    $('#doc-type').innerHTML = TYPES_DOC.map(t => `<option>${t}</option>`).join('');
    rendreDocuments(get().documents);
  }

  function rendreDocuments(docs) {
    $('#p-docs').innerHTML = docs.length ? docs.map(d => `<div class="doc-ligne"><span class="badge b-blue">${esc(d.type)}</span>
      <span class="doc-nom">${esc(d.nom)}<small>${dateFr(d.date)}</small></span>
      <button type="button" class="chip" data-doc-ouvrir="${esc(d.id)}">Ouvrir</button>
      <button type="button" class="chip" data-doc-telecharger="${esc(d.id)}">Télécharger</button>
      <button type="button" class="chip" data-doc-envoyer="${esc(d.id)}">Envoyer par mail</button>
      <button type="button" class="chip" data-doc-suppr="${esc(d.id)}" aria-label="Supprimer">✕</button></div>`).join('')
      : '<span class="hint">Aucun document pour l\'instant.</span>';
    $('#doc-ajout').classList.toggle('desactive', !Sync.role);
    $('#doc-info').textContent = Sync.role ? 'PDF ou image, 10 Mo maximum. Visible uniquement par ton équipe.'
      : 'Les documents sont rangés en ligne : connecte-toi (section Compte) pour en ajouter.';
  }

  function init() {
    $('#logo-input').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try { save({ garage: { ...get().garage, logo: await lireLogo(f) } }); rendre(); toast('Logo enregistré'); }
      catch (err) { toast("Cette image ne peut pas être lue."); }
    });
    $('#btn-logo-suppr').addEventListener('click', () => { save({ garage: { ...get().garage, logo: '' } }); rendre(); });

    // Documents : rangés dans le dossier privé de l'entreprise.
    $('#doc-input').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f || !Sync.role) return;
      if (f.size > 10 * 1024 * 1024) { toast('Fichier trop lourd (10 Mo maximum).'); return; }
      const id = nouvelId();
      const ext = (f.name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
      const chemin = `${Sync.entreprise.id}/${id}${ext}`;
      $('#doc-info').textContent = 'Envoi…';
      const { error } = await Sync.client.storage.from('documents').upload(chemin, f, { contentType: f.type });
      if (error) { toast('Document non envoyé : ' + error.message); rendre(); return; }
      const docs = get().documents.concat({ id, type: $('#doc-type').value, nom: f.name, chemin, date: today() });
      save({ documents: docs });
      rendreDocuments(docs);
      toast('Document ajouté');
    });
    $('#p-docs').addEventListener('click', async e => {
      const ouvrir = e.target.dataset.docOuvrir, suppr = e.target.dataset.docSuppr;
      const tele = e.target.dataset.docTelecharger, envoi = e.target.dataset.docEnvoyer;
      const doc = get().documents.find(d => d.id === (ouvrir || suppr || tele || envoi));
      if (!doc) return;
      if (!Sync.role) { toast("Connecte-toi pour ouvrir les documents."); return; }
      if (tele) { Fichiers.telecharger(doc.chemin, doc.nom); return; }
      if (envoi) { Fichiers.envoyer(doc.chemin, doc.nom, `${doc.type} · ${get().garage.nom || ''}`.trim()); return; }
      if (ouvrir) {
        const w = window.open('', '_blank');
        const { data, error } = await Sync.client.storage.from('documents').createSignedUrl(doc.chemin, 300);
        if (error || !data) { w?.close(); toast('Document introuvable.'); return; }
        if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
        return;
      }
      if (!confirm(`Supprimer « ${doc.nom} » ?`)) return;
      await Sync.client.storage.from('documents').remove([doc.chemin]);
      const docs = get().documents.filter(d => d.id !== doc.id);
      save({ documents: docs });
      rendreDocuments(docs);
    });
  }

  return { get, save, rendre, rendreDocuments, init };
})();
