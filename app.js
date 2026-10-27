// Ocaz — V1. Données stockées dans le navigateur (localStorage).
// Toute la lecture/écriture passe par `db`, pour pouvoir brancher
// une vraie base (Supabase) plus tard sans toucher aux écrans.

const STORAGE_KEY = 'crmzx-v1';

const db = {
  data: { clients: [], vehicules: [], commandes: [], planning: [], seq: 0 },
  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved) this.data = Object.assign(this.data, saved);
      (this.data.planning || []).forEach(r => {
        if (r.type === 'Rappel client') r.type = 'Relance client';
        if (r.type === 'Livraison') r.type = 'Vente / livraison';
      });
      (this.data.commandes || []).forEach(o => {
        if (o.statut === 'Devis') o.statut = 'Offre';
        if (o.statut === 'En cours') o.statut = 'Commande';
      });
    } catch (e) { /* stockage indisponible : on démarre vide */ }
  },
  // `distant` : données reçues de la synchro, à ne pas renvoyer.
  save(distant) {
    if (!distant) this.data.majLe = new Date().toISOString();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); }
    catch (e) { toast("Impossible d'enregistrer sur cet appareil."); }
    if (!distant) Sync.changed();
  },
  // Déconnexion : les données restent en ligne, on les retire de l'appareil.
  vider() {
    this.data = { clients: [], vehicules: [], commandes: [], planning: [], seq: 0 };
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* rien */ }
  },
  all(table) { return this.data[table]; },
  get(table, id) { return this.data[table].find(r => r.id === id); },
  upsert(table, row) {
    const now = new Date().toISOString();
    if (row.id) {
      const i = this.data[table].findIndex(r => r.id === row.id);
      this.data[table][i] = Object.assign({}, this.data[table][i], row, { majLe: now });
    } else {
      row.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      row.creeLe = now;
      row.majLe = now;
      if (table === 'commandes') row.numero = 'CMD-' + String(++this.data.seq).padStart(4, '0');
      this.data[table].push(row);
    }
    this.save();
    return row;
  },
  remove(table, id) {
    this.data[table] = this.data[table].filter(r => r.id !== id);
    // Trace de la suppression, pour que la synchro ne la fasse pas revenir depuis un autre appareil.
    this.data.supprimes = Object.assign(this.data.supprimes || {}, { [id]: new Date().toISOString() });
    this.save();
  },
};

// ---------- Utilitaires ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euros = n => (n === '' || n == null || isNaN(n)) ? '' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const km = n => (n === '' || n == null) ? '' : Number(n).toLocaleString('fr-FR') + ' km';
const dateFr = d => d ? new Date(d).toLocaleDateString('fr-FR') : '';
// Date du jour à l'heure locale (La Réunion est en UTC+4 : toISOString donnerait parfois la veille).
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => isoLocal(new Date());
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function toast(msg) {
  const t = $('#toast');
  // Une fenêtre ouverte passe au-dessus de tout : le message doit être dedans pour rester visible.
  const open = [...document.querySelectorAll('dialog[open]')].pop();
  (open || document.body).appendChild(t);
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

const clientNom = c => c ? [c.prenom, c.nom].filter(Boolean).join(' ') || c.societe || '(sans nom)' : '(client supprimé)';
const vehiculeNom = v => v ? [v.marque, v.modele, v.finition].filter(Boolean).join(' ') || '(véhicule sans nom)' : '(véhicule supprimé)';

// Parcours d'une reprise : en cours (« Reprise à étudier ») → validée → (offre passée en commande) En préparation / En stock
// → Réservé → Vendu, ou annulée (« Reprise refusée »). Un dépôt-vente pas encore validé est « Dépôt en cours ».
const STATUT_VEHICULE = {
  'Reprise à étudier': 'b-purple', 'Reprise validée': 'b-green', 'Reprise refusée': 'b-red', 'Dépôt en cours': 'b-purple', 'En préparation': 'b-blue',
  'En stock': 'b-green', 'Réservé': 'b-orange', 'Vendu': 'b-grey',
};
// Libellés affichés (les anciens noms restent dans les données).
const LIBELLE_STATUT = { 'Reprise à étudier': 'Reprise en cours', 'Reprise refusée': 'Reprise annulée' };
const libStatut = s => LIBELLE_STATUT[s] || s || '';
const REPRISE = ['Reprise à étudier', 'Reprise validée', 'Reprise refusée'];
const DISPONIBLE = ['En préparation', 'En stock'];
// Origine des clients : sert au tableau de bord (quelles sources font vendre).
const SOURCES = ['', 'Leboncoin', 'La Centrale', 'Facebook', 'Instagram', 'Site / vitrine', 'Apporteur réseau', 'Passage au garage', 'Bouche-à-oreille', 'Ancien client', 'Téléphone', 'Autre'];
const TYPES = ['', 'Citadine', 'Berline', 'Break', 'SUV / 4x4', 'Monospace', 'Coupé / Cabriolet', 'Utilitaire', 'Pick-up'];
// Véhicules : deux vues. « Stock » (pas d'ajout direct, on y entre par une reprise validée) et « Reprises ».
let vueVehicule = 'stock';
// Stock : sous-onglets En prépa, Stock, Réservés, Vendus (véhicules achetés) et Partenaires (véhicules des autres garages du réseau).
let vueStock = 'stock';
// Dépôt vente : En stock, Réservés, Vendus, et « À compléter » (dépôts enregistrés pour plus tard).
let vueDepot = 'stock';
const VUES_DEPOT = {
  stock: ['Véhicules en stock', ['En stock', 'En préparation']],
  reserves: ['Réservés', ['Réservé']],
  vendus: ['Vendus', ['Vendu']],
};
const filtresStock = { couleur: '', type: '', anneeMin: '', anneeMax: '', kmMax: '' };
// Sous-onglets du Stock : libellé et statut du véhicule.
const VUES_STOCK = {
  preparation: ['En prépa', 'En préparation'],
  stock: ['Stock', 'En stock'],
  reserves: ['Réservés', 'Réservé'],
  vendus: ['Vendus', 'Vendu'],
};
const STATUTS_REPRISE = {
  'Reprises en cours': v => v.statut === 'Reprise à étudier',
  'Reprises validées': v => v.statut === 'Reprise validée',
  'Reprises annulées': v => v.statut === 'Reprise refusée',
};
let filtreReprise = 'Reprises en cours';
const interessesPar = v => db.all('clients').filter(c => (c.interets || []).includes(v.id));
const num = x => Number(x) || 0;
// Recherche d'un client (marque, budget, km…) : alerte quand une reprise ou un véhicule du stock correspond.
const RECHERCHE = ['rechMarque', 'rechModele', 'rechBudget', 'rechKmMax', 'rechAnneeMin', 'rechCarburant', 'rechBoite'];
const aUneRecherche = c => RECHERCHE.some(k => c[k]);
function correspond(c, v) {
  const reprise = ['Reprise à étudier', 'Reprise validée'].includes(v.statut);
  if (!aUneRecherche(c) || !(DISPONIBLE.includes(v.statut) || reprise)) return false;
  return (!c.rechMarque || norm(v.marque).includes(norm(c.rechMarque)))
    && (!c.rechModele || norm([v.modele, v.finition].join(' ')).includes(norm(c.rechModele)))
    && (!c.rechBudget || reprise || !v.prixVente || num(v.prixVente) <= num(c.rechBudget))
    && (!c.rechKmMax || !v.kilometrage || num(v.kilometrage) <= num(c.rechKmMax))
    && (!c.rechAnneeMin || !v.annee || num(v.annee) >= num(c.rechAnneeMin))
    && (!c.rechCarburant || v.carburant === c.rechCarburant)
    && (!c.rechBoite || v.boite === c.rechBoite);
}
const clientsQuiCherchent = v => db.all('clients').filter(c => correspond(c, v));
const vehiculesPour = c => db.all('vehicules').filter(v => correspond(c, v));
const resumeRecherche = c => [[c.rechMarque, c.rechModele].filter(Boolean).join(' '), c.rechCarburant, c.rechBoite,
  c.rechAnneeMin && 'depuis ' + c.rechAnneeMin, c.rechKmMax && 'moins de ' + km(c.rechKmMax), c.rechBudget && euros(c.rechBudget) + ' max'].filter(Boolean).join(' · ');
const messageRecherche = (c, v) => `Bonjour ${c.prenom || clientNom(c)}, ${Param.get().garage.nom ? 'ici ' + Param.get().garage.nom + '. ' : ''}Nous avons un véhicule qui correspond à votre recherche : ${vehiculeNom(v)}${v.annee ? ' de ' + v.annee : ''}${v.kilometrage ? ', ' + km(v.kilometrage) : ''}. Voulez-vous plus d'informations ?`;
function alerteRecherche(v) {
  const cs = clientsQuiCherchent(v);
  if (cs.length) toast(`🔎 ${cs.length} client(s) cherchent ce véhicule : ${cs.map(clientNom).join(', ')}`);
}
const TYPES_RDV = { 'Essai': 'b-blue', 'Expertise reprise': 'b-purple', 'Vente / livraison': 'b-green', 'Relance client': 'b-orange', 'Rendez-vous': 'b-blue', 'Autre': 'b-grey' };
const FILTRES_RDV = {
  'Semaine': () => true,
  'À venir': r => !r.fait && r.date >= today(),
  'En retard': r => !r.fait && r.date < today(),
  'Faits': r => !!r.fait,
  'Tous': () => true,
};
let filtreRdv = 'Semaine';
// Lundi de la semaine affichée dans le calendrier.
let semaine = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d; })();
const ajouterJours = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
// Une vente commence par une offre ; validée, elle devient une commande.
// Parcours : Offre → (acceptée) Commande → (validée) Livraison → Livrée, ou Annulée à tout moment.
const STATUT_COMMANDE = { 'Offre': 'b-purple', 'Commande': 'b-orange', 'Livraison': 'b-blue', 'Livrée': 'b-green', 'Annulée': 'b-red' };
const VUES_COMMANDE = {
  'Offres': o => o.statut === 'Offre',
  'Commandes': o => o.statut === 'Commande',
  'Livraisons': o => o.statut === 'Livraison' || o.statut === 'Livrée',
  'Annulées': o => o.statut === 'Annulée',
};
let vueCommande = 'Offres';
// Bouton d'étape suivante selon le statut.
const ETAPE_SUIVANTE = {
  'Offre': ['Offre acceptée → commande', 'Commande'],
  'Commande': ['Commande validée → livraison', 'Livraison'],
  'Livraison': ['Véhicule livré', 'Livrée'],
};

// ---------- Définition des onglets ----------
const TABS = {
  clients: {
    titre: 'client', titreNouveau: 'Nouveau client',
    fields: [
      { k: 'civilite', l: 'Civilité', type: 'select', options: ['', 'M.', 'Mme'] },
      { k: 'prenom', l: 'Prénom' },
      { k: 'nom', l: 'Nom', required: true },
      { k: 'telephone', l: 'Téléphone', type: 'tel' },
      { k: 'email', l: 'Email', type: 'email' },
      { k: 'pasDeRappel', l: "Pas de rappel d'entretien par mail", type: 'check', full: true },
      { k: 'adresse', l: 'Adresse', full: true },
      { k: 'codePostal', l: 'Code postal' },
      { k: 'ville', l: 'Ville' },
      { k: 'societe', l: 'Société (si pro)', full: true },
      { k: 'source', l: "Comment nous a-t-il connus ?", type: 'select', options: SOURCES, full: true },
      { k: 'notes', l: 'Notes', type: 'textarea', full: true },
      { k: '_projet', l: 'Projet du client', type: 'section' },
      { k: 'interets', l: 'Véhicules en stock qui l\'intéressent', type: 'interets', full: true },
      { k: 'repriseId', l: 'Sa reprise', type: 'reprise', full: true },
      { k: '_recherche', l: "Ce qu'il recherche", type: 'section' },
      { k: 'rechMarque', l: 'Marque' },
      { k: 'rechModele', l: 'Modèle' },
      { k: 'rechBudget', l: 'Budget max (€)', type: 'number' },
      { k: 'rechKmMax', l: 'Kilométrage max', type: 'number' },
      { k: 'rechAnneeMin', l: 'Année min', type: 'number' },
      { k: 'rechCarburant', l: 'Carburant', type: 'select', options: ['', 'Essence', 'Diesel', 'Hybride', 'Hybride rechargeable', 'Électrique', 'GPL'] },
      { k: 'rechBoite', l: 'Boîte', type: 'select', options: ['', 'Manuelle', 'Automatique'] },
      { k: '_correspond', type: 'correspond' },
    ],
    search: c => [c.prenom, c.nom, c.telephone, c.email, c.ville, c.societe],
    sort: (a, b) => norm(a.nom).localeCompare(norm(b.nom)),
    card: c => {
      const nb = db.all('commandes').filter(o => o.clientId === c.id).length;
      const interets = (c.interets || []).map(id => db.get('vehicules', id)).filter(Boolean);
      const reprise = db.all('vehicules').find(v => v.vendeurId === c.id && REPRISE.includes(v.statut));
      const initiales = ((c.prenom || '')[0] || '') + ((c.nom || c.societe || '')[0] || '');
      return `<div class="top"><span class="who"><span class="avatar">${esc(initiales.toUpperCase())}</span><span class="title">${esc(clientNom(c))}</span></span>
        <span class="c-badges">${c.source ? `<span class="badge b-grey">${esc(c.source)}</span>` : ''}${nb ? `<span class="badge b-blue">${nb} commande${nb > 1 ? 's' : ''}</span>` : ''}
        ${c.telephone ? `<a class="wa" href="${esc(Papiers.lienWhatsapp(c))}" target="_blank" rel="noopener" data-stop title="WhatsApp" aria-label="Écrire sur WhatsApp">${icon('whatsapp', 18)}</a>` : ''}</span></div>
        <div class="sub">${esc([c.telephone, c.email].filter(Boolean).join(' · '))}</div>
        <div class="sub">${esc([c.ville, c.societe].filter(Boolean).join(' · '))}</div>
        ${interets.length ? `<div class="sub">★ Intéressé par : ${esc(interets.map(vehiculeNom).join(', '))}</div>` : ''}
        ${reprise ? `<div class="sub">↺ Reprise : ${esc(vehiculeNom(reprise))}</div>` : ''}
        ${aUneRecherche(c) ? `<div class="sub">🔎 Cherche : ${esc(resumeRecherche(c))}${vehiculesPour(c).length ? ` · <b class="ok">${vehiculesPour(c).length} véhicule(s) correspondent</b>` : ''}</div>` : ''}`;
    },
    canDelete: c => {
      const nb = db.all('commandes').filter(o => o.clientId === c.id).length;
      return nb ? `Ce client a ${nb} commande(s). Supprime d'abord ses commandes.` : true;
    },
    // La reprise est rattachée au véhicule (vendeurId) : on met à jour le lien depuis la fiche client.
    beforeSave: c => {
      c.interets = c.interets || [];
      const repriseId = c.repriseId;
      delete c.repriseId;
      return saved => {
        db.all('vehicules').filter(v => v.vendeurId === saved.id && REPRISE.includes(v.statut) && v.id !== repriseId)
          .forEach(v => db.upsert('vehicules', { id: v.id, vendeurId: '' }));
        if (repriseId) db.upsert('vehicules', { id: repriseId, vendeurId: saved.id });
      };
    },
  },

  vehicules: {
    titre: 'véhicule', titreNouveau: 'Nouvelle reprise / nouveau véhicule',
    fields: [
      { k: '_lookup', type: 'lookup' },
      { k: 'marque', l: 'Marque', required: true },
      { k: 'modele', l: 'Modèle' },
      { k: 'finition', l: 'Finition / version', full: true },
      { k: 'annee', l: 'Année', type: 'number' },
      { k: 'miseEnCirculation', l: '1re mise en circulation', type: 'date' },
      { k: 'kilometrage', l: 'Kilométrage', type: 'number' },
      { k: 'carburant', l: 'Carburant', type: 'select', options: ['', 'Essence', 'Diesel', 'Hybride', 'Hybride rechargeable', 'Électrique', 'GPL', 'Autre'] },
      { k: 'boite', l: 'Boîte', type: 'select', options: ['', 'Manuelle', 'Automatique'] },
      { k: 'couleur', l: 'Couleur' },
      { k: 'type', l: 'Type', type: 'select', options: TYPES },
      { k: 'puissanceCh', l: 'Puissance (ch)', type: 'number' },
      { k: 'puissanceFiscale', l: 'Puissance fiscale (CV)', type: 'number' },
      { k: 'cylindree', l: 'Cylindrée (cm³)', type: 'number' },
      { k: 'co2', l: 'CO₂ (g/km)', type: 'number' },
      { k: 'portes', l: 'Portes', type: 'number' },
      { k: 'places', l: 'Places', type: 'number' },
      { k: 'equipements', l: 'Options et équipements (repris sur l\'offre)', type: 'textarea', full: true },
      { k: '_fiche', type: 'fiche' },
      { k: 'statut', l: 'Statut', type: 'select', options: Object.keys(STATUT_VEHICULE), def: 'Reprise à étudier' },
      { k: '_reprise', l: 'Reprise', type: 'section' },
      { k: 'vendeurId', l: 'Vendeur (client qui cède le véhicule)', type: 'ref', table: 'clients', full: true },
      { k: 'etat', l: 'État général', type: 'select', options: ['', 'Très bon', 'Bon', 'Moyen', 'À rénover'] },
      { k: 'coteEstimee', l: 'Cote estimée (€)', type: 'number' },
      { k: '_cote', type: 'cote' },
      { k: 'fraisEstimes', l: 'Frais de remise en état (€)', type: 'number' },
      { k: 'prixPropose', l: 'Prix de reprise proposé (€)', type: 'number' },
      { k: 'defauts', l: 'Défauts constatés', type: 'textarea', full: true },
      { k: '_achat', l: 'Achat · livre de police', type: 'section' },
      { k: 'achatDate', l: "Date d'achat", type: 'date' },
      { k: 'achatPaiement', l: 'Paiement du vendeur', type: 'select', options: ['', 'Virement', 'Chèque', 'Espèces', "Déduit d'une vente (reprise)"] },
      { k: 'vendeurPieceType', l: "Pièce d'identité du vendeur", type: 'select', options: ['', "Carte d'identité", 'Passeport', 'Permis de conduire', 'Titre de séjour', 'Extrait Kbis (société)'] },
      { k: 'vendeurPieceNumero', l: 'Numéro de la pièce' },
      { k: 'vendeurPieceDate', l: 'Délivrée le', type: 'date' },
      { k: 'vendeurPieceAutorite', l: 'Délivrée par' },
      { k: '_stock', l: 'Stock et vente', type: 'section' },
      { k: 'prixAchat', l: "Prix d'achat final (€)", type: 'number' },
      { k: 'prixVente', l: 'Prix de vente (€)', type: 'number' },
      { k: 'dateEntree', l: "Date d'entrée en stock", type: 'date' },
      { k: '_reseau', type: 'reseau' },
      { k: '_photos', type: 'photos' },
      { k: '_interesses', type: 'interesses' },
      { k: '_depot', type: 'depot' },
      { k: '_cherchent', type: 'cherchent' },
      { k: '_papiers', type: 'papiers' },
      { k: 'notes', l: 'Notes', type: 'textarea', full: true },
    ],
    search: v => [v.immatriculation, v.vin, v.marque, v.modele, v.finition, v.vendeurId ? clientNom(db.get('clients', v.vendeurId)) : ''],
    sort: (a, b) => (b.creeLe || '').localeCompare(a.creeLe || ''),
    filter: v => {
      if (vueVehicule === 'reprises') return !Depot.est(v) && STATUTS_REPRISE[filtreReprise](v);
      if (vueVehicule === 'depot') return Depot.est(v) && (vueDepot === 'brouillons' ? v.statut === 'Dépôt en cours' : VUES_DEPOT[vueDepot][1].includes(v.statut));
      const f = filtresStock;
      return !Depot.est(v) && v.statut === VUES_STOCK[vueStock]?.[1]
        && (!f.couleur || norm(v.couleur) === norm(f.couleur))
        && (!f.type || v.type === f.type)
        && (!f.anneeMin || num(v.annee) >= num(f.anneeMin))
        && (!f.anneeMax || (v.annee && num(v.annee) <= num(f.anneeMax)))
        && (!f.kmMax || (v.kilometrage !== '' && v.kilometrage != null && num(v.kilometrage) <= num(f.kmMax)));
    },
    card: v => {
      const reprise = REPRISE.includes(v.statut);
      const prix = reprise ? (v.prixPropose ? 'Proposé ' + euros(v.prixPropose) : '') : euros(v.prixVente);
      const marge = Depot.est(v) ? (v.prixVente ? Depot.commission(v) - Prepa.frais(v) : null)
        : !reprise && v.prixVente && v.prixAchat ? num(v.prixVente) - num(v.prixAchat) - Prepa.frais(v) : null;
      return `${v.image ? `<div class="thumb"><img src="${esc(v.image)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></div>` : ''}
        <div class="top"><span class="title">${esc(vehiculeNom(v))}</span>
        <span class="c-badges">${Depot.est(v) ? '<span class="badge b-purple">Dépôt-vente</span>' : ''}${Reseau.actif() && Reseau.partage(v) && ['En stock', 'Réservé'].includes(v.statut) ? '<span class="badge b-blue" title="Partagé au réseau Ocaz">Réseau</span>' : ''}<span class="badge ${STATUT_VEHICULE[v.statut] || 'b-grey'}">${esc(libStatut(v.statut))}</span></span></div>
        <div class="sub">${esc([v.annee, km(v.kilometrage), v.carburant, v.boite, v.type, v.couleur].filter(Boolean).join(' · '))}</div>
        ${(v.photos || []).length ? `<div class="sub">📷 ${v.photos.length} photo(s)</div>` : Photos.deblocable(v) ? '<div class="sub">📷 Photos à prendre</div>' : ''}
        ${v.statut === 'En préparation' ? `<div class="sub">🔧 Préparation ${v.prepa ? Prepa.avancement(v) + ' · frais ' + (euros(Prepa.fraisReels(v)) || '0 €') : 'à commencer'}</div>` : ''}
        ${!reprise && interessesPar(v).length ? `<div class="sub">★ ${interessesPar(v).length} client(s) intéressé(s)</div>` : ''}
        ${clientsQuiCherchent(v).length ? `<div class="sub">🔎 ${clientsQuiCherchent(v).length} client(s) cherchent ce véhicule</div>` : ''}
        ${(reprise || Depot.est(v)) && v.vendeurId ? `<div class="sub">${Depot.est(v) ? 'Propriétaire' : 'Vendeur'} : ${esc(clientNom(db.get('clients', v.vendeurId)))}</div>` : ''}
        ${Depot.est(v) && DepotVente.docsManquants(v).length ? `<div class="sub alerte">📄 Documents à prendre : ${esc(DepotVente.docsManquants(v).join(', '))}</div>` : ''}
        <div class="top"><span>${v.immatriculation ? `<span class="plate">${esc(v.immatriculation)}</span>` : ''}</span>
        <span class="price">${prix}${marge !== null ? `<span class="sub"> · ${Depot.est(v) ? 'commission' : 'marge'} ${euros(marge)}</span>` : ''}</span></div>`;
    },
    canDelete: v => {
      const nb = db.all('commandes').filter(o => o.vehiculeId === v.id).length;
      return nb ? `Ce véhicule est dans ${nb} commande(s). Supprime d'abord la commande.` : true;
    },
    afterDelete: v => {
      interessesPar(v).forEach(c => db.upsert('clients', { id: c.id, interets: c.interets.filter(id => id !== v.id) }));
    },
  },

  commandes: {
    titre: 'commande', titreNouveau: 'Nouvelle offre',
    fields: [
      { k: 'clientId', l: 'Client', type: 'ref', table: 'clients', required: true, full: true },
      { k: 'vehiculeId', l: 'Véhicule', type: 'ref', table: 'vehicules', required: true, full: true },
      { k: 'date', l: 'Date', type: 'date', def: today },
      { k: 'statut', l: 'Statut', type: 'select', options: Object.keys(STATUT_COMMANDE), def: 'Offre' },
      { k: 'prix', l: 'Prix de vente (€)', type: 'number' },
      { k: 'acompte', l: 'Acompte versé (€)', type: 'number' },
      { k: 'paiement', l: 'Mode de paiement', type: 'select', options: ['', 'Comptant', 'Virement', 'Chèque', 'Financement / crédit', 'Reprise + soulte'] },
      { k: 'dateLivraison', l: 'Livraison prévue', type: 'date' },
      { k: 'notes', l: 'Notes', type: 'textarea', full: true },
      { k: '_ventes', type: 'docsVente' },
    ],
    filter: o => VUES_COMMANDE[vueCommande](o),
    search: o => [o.numero, clientNom(db.get('clients', o.clientId)), vehiculeNom(db.get('vehicules', o.vehiculeId)),
      db.get('vehicules', o.vehiculeId)?.immatriculation, o.statut],
    sort: (a, b) => (b.date || '').localeCompare(a.date || '') || (b.numero || '').localeCompare(a.numero || ''),
    card: o => {
      const c = db.get('clients', o.clientId), v = db.get('vehicules', o.vehiculeId);
      const reste = (Number(o.prix) || 0) - (Number(o.acompte) || 0);
      return `<div class="top"><span class="title">${esc(o.numero)} · ${esc(clientNom(c))}</span>
        <span class="badge ${STATUT_COMMANDE[o.statut] || 'b-grey'}">${esc(o.statut)}</span></div>
        <div class="sub">${esc(vehiculeNom(v))}${v?.immatriculation ? ' · ' + esc(v.immatriculation) : ''}</div>
        <div class="top"><span class="sub">${dateFr(o.date)}${o.prix && o.statut !== 'Livrée' && o.statut !== 'Annulée' && reste > 0 ? ' · reste ' + euros(reste) : ''}</span>
        <span class="price">${euros(o.prix)}</span></div>`;
    },
    canDelete: () => true,
    afterSave: (o, avant) => {
      // Offre émise : relance client planifiée deux jours après.
      if (o.statut === 'Offre' && !relances(o).length) {
        const d = new Date(); d.setDate(d.getDate() + 2);
        db.upsert('planning', { type: 'Relance client', date: isoLocal(d), heure: '', clientId: o.clientId, vehiculeId: o.vehiculeId,
          commandeId: o.id, notes: `Relance de l'offre ${o.numero}`, fait: false });
        toast(`Offre ${o.numero} créée · relance planifiée le ${dateFr(isoLocal(d))}`);
      }
      // Offre validée ou annulée : la relance n'a plus lieu d'être.
      if (o.statut !== 'Offre') relances(o).forEach(r => db.upsert('planning', { id: r.id, fait: true }));
      // Le statut du véhicule suit la commande (une simple offre ne le réserve pas).
      const v = db.get('vehicules', o.vehiculeId);
      if (v && o.statut !== 'Offre') {
        const statut = o.statut === 'Livrée' ? 'Vendu' : o.statut === 'Annulée' ? 'En stock' : 'Réservé';
        if (v.statut !== statut) db.upsert('vehicules', { id: v.id, statut, ...(statut === 'Vendu' ? { dateVente: today() } : {}) });
        if (statut === 'Vendu') { Papiers.rappelRetrait(db.get('vehicules', v.id)); Depot.apresVente(db.get('vehicules', v.id), o); }
      }
      repriseSuitCommande(o);
      // Date de livraison effective : sert au CA du mois et à la rotation du stock (onglet Données).
      if (o.statut === 'Livrée' && !o.dateLivree) db.upsert('commandes', { id: o.id, dateLivree: today() });
      // La liste suit la vente dans son nouveau sous-onglet.
      vueCommande = Object.keys(VUES_COMMANDE).find(k => VUES_COMMANDE[k](o)) || vueCommande;
    },
    afterDelete: o => {
      const v = db.get('vehicules', o.vehiculeId);
      if (v && v.statut === 'Réservé') db.upsert('vehicules', { id: v.id, statut: 'En stock' });
      repriseSuitCommande({ ...o, statut: 'Annulée' });
    },
  },

  planning: {
    titre: 'rendez-vous', titreNouveau: 'Nouveau rendez-vous',
    fields: [
      { k: 'type', l: 'Type', type: 'select', options: Object.keys(TYPES_RDV), def: 'Essai' },
      { k: 'date', l: 'Date', type: 'date', def: today, required: true },
      { k: 'heure', l: 'Heure', type: 'time' },
      { k: 'duree', l: 'Durée', type: 'select', options: ['', '15 min', '30 min', '45 min', '1 h', '1 h 30', '2 h', 'Demi-journée'] },
      { k: 'clientId', l: 'Client', type: 'ref', table: 'clients', full: true },
      { k: 'vehiculeId', l: 'Véhicule (stock ou reprise)', type: 'ref', table: 'vehicules', tous: true, full: true },
      { k: 'lieu', l: 'Lieu', full: true },
      { k: 'notes', l: 'Notes', type: 'textarea', full: true },
      { k: 'fait', l: 'Fait', type: 'check' },
    ],
    search: r => [r.type, r.lieu, r.notes, clientNom(db.get('clients', r.clientId)), vehiculeNom(db.get('vehicules', r.vehiculeId))],
    filter: r => FILTRES_RDV[filtreRdv](r),
    sort: (a, b) => {
      const k = r => (r.date || '') + (r.heure || '99');
      return filtreRdv === 'Faits' || filtreRdv === 'Tous' ? k(b).localeCompare(k(a)) : k(a).localeCompare(k(b));
    },
    card: r => {
      const c = db.get('clients', r.clientId), v = db.get('vehicules', r.vehiculeId);
      const retard = !r.fait && r.date < today();
      const d = r.date ? new Date(r.date + 'T12:00') : null;
      return `<div class="rdv${r.fait ? ' fait' : ''}">
        <div class="rdv-date${r.date === today() ? ' today' : ''}${retard ? ' late' : ''}">
          <span>${d ? d.toLocaleDateString('fr-FR', { weekday: 'short' }) : ''}</span>
          <strong>${d ? d.getDate() : '?'}</strong>
          <span>${d ? d.toLocaleDateString('fr-FR', { month: 'short' }) : ''}</span></div>
        <div class="rdv-body"><div class="top"><span class="title">${esc(r.type)}${r.heure ? ' · ' + esc(r.heure) : ''}</span>
          <span class="badge ${r.fait ? 'b-grey' : retard ? 'b-red' : TYPES_RDV[r.type] || 'b-blue'}">${r.fait ? 'Fait' : retard ? 'En retard' : esc(r.duree || 'À venir')}</span></div>
          ${c ? `<div class="sub">${icon('clients', 14)} ${esc(clientNom(c))}${c.telephone ? ' · ' + esc(c.telephone) : ''}</div>` : ''}
          ${v ? `<div class="sub">${icon('vehicules', 14)} ${esc(vehiculeNom(v))}${v.immatriculation ? ' · ' + esc(v.immatriculation) : ''}</div>` : ''}
          ${r.lieu ? `<div class="sub">${esc(r.lieu)}</div>` : ''}</div></div>`;
    },
    canDelete: () => true,
  },
};

// Onglets affichés : Stock et Reprise sont deux vues de la même liste de véhicules.
const ONGLETS = {
  clients: { table: 'clients', icon: 'clients', label: 'Clients', placeholder: 'Nom, téléphone, ville…' },
  commandes: { table: 'commandes', icon: 'commandes', label: 'Commandes', placeholder: 'N°, client, véhicule…' },
  leads: { table: null, icon: 'leads', label: 'Leads', placeholder: '' },
  stock: { table: 'vehicules', icon: 'stock', label: 'Stock', placeholder: 'Rechercher un modèle, une marque, une plaque…' },
  reprises: { table: 'vehicules', icon: 'reprise', label: 'Reprise', placeholder: 'Modèle, plaque…' },
  depot: { table: 'vehicules', icon: 'depot', label: 'Dépôt vente', placeholder: 'Modèle, plaque, propriétaire…' },
  planning: { table: 'planning', icon: 'planning', label: 'Planning', placeholder: 'Client, véhicule, type…' },
  donnees: { table: null, icon: 'donnees', label: 'Données', placeholder: '' },
  parametres: { table: null, icon: 'reglages', label: 'Paramètres', placeholder: '' },
};
let onglet = 'clients';

// ---------- Liste ----------
let current = 'clients';
let editing = null;

function render() {
  Reseau.majPastille();
  if (onglet === 'donnees') { renderFiltres(); Donnees.rendre(); return; }
  if (onglet === 'parametres') { renderFiltres(); return; }
  if (onglet === 'leads') { renderFiltres(); Revision.rendreOnglet(); return; }
  if (onglet === 'stock' && (vueStock === 'partenaires' || !Droits.achat())) { vueStock = 'partenaires'; renderFiltres(); Partenaires.rendre(); return; }
  const tab = TABS[current];
  const q = norm($('#search').value.trim());
  renderFiltres();
  const rows = db.all(current)
    .filter(r => !tab.filter || tab.filter(r))
    .filter(r => !q || norm(tab.search(r).join(' ')).includes(q))
    .sort(tab.sort);
  if (onglet === 'planning' && filtreRdv === 'Semaine') { renderSemaine(rows); return; }
  const total = db.all(current).length;
  const n = rows.length;
  const titre = { stock: 'véhicule', reprises: 'reprise', depot: 'véhicule', planning: 'rendez-vous', commandes: { Offres: 'offre', Commandes: 'commande', Livraisons: 'livraison', 'Annulées': 'annulée' }[vueCommande] }[onglet] || tab.titre;
  $('#count').textContent = (tab.filter || n !== total) ? `${n} ${titre}${n > 1 && titre !== 'rendez-vous' ? 's' : ''}` : `${total} ${titre}${total > 1 ? 's' : ''}`;
  const q2 = $('#search').value.trim();
  const vide = {
    clients: ["Aucun client pour l'instant", 'Ajoute ton premier client avec « + Ajouter ».'],
    commandes: ['Aucune offre ni commande', 'Crée une offre : une relance est planifiée à J+2. Acceptée, elle passe en commande, puis en livraison.'],
    stock: ['Aucun véhicule ici', 'Les véhicules entrent en stock quand tu valides une reprise.'],
    reprises: ['Aucune reprise ici', 'Tape la plaque dans « + Nouvelle reprise » : la fiche se remplit toute seule.'],
    depot: ['Aucun dépôt vente ici', 'Crée un dépôt avec « + Nouveau dépôt vente » : client, véhicule, prix, puis documents.'],
    planning: ['Rien de prévu', 'Ajoute un essai, une expertise, une livraison ou une relance.'],
  }[onglet];
  const [t1, t2] = total && (q2 || tab.filter) ? ['Aucun résultat', 'Essaie une autre recherche ou d\'autres filtres.'] : vide;
  $('#list').innerHTML = n
    ? rows.map(r => `<div class="card" data-id="${r.id}">${tab.card(r)}</div>`).join('')
    : `<div class="empty">${ILLUS[ONGLETS[onglet].icon] || ILLUS.stock}<strong>${t1}</strong><span>${t2}</span></div>`;
}

const sigFiltres = () => onglet + vueStock + vueDepot + Droits.achat() + JSON.stringify(filtresStock) + filtreReprise + filtreRdv + vueCommande + db.all('commandes').map(o => o.statut).join() + db.all('vehicules').map(v => v.statut).join()
  + db.all('vehicules').map(v => v.statut + v.couleur).join() + db.all('planning').map(r => r.date + r.fait).join();

// Calendrier de la semaine : un clic sur un jour ajoute un évènement à cette date.
function renderSemaine(rows) {
  const jours = [...Array(7)].map((_, i) => ajouterJours(semaine, i));
  const fin = jours[6];
  const fmt = (d, o) => d.toLocaleDateString('fr-FR', o);
  const titre = semaine.getMonth() === fin.getMonth()
    ? `${semaine.getDate()} – ${fmt(fin, { day: 'numeric', month: 'long', year: 'numeric' })}`
    : `${fmt(semaine, { day: 'numeric', month: 'short' })} – ${fmt(fin, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const auj = today();
  const nb = rows.filter(r => r.date >= isoLocal(semaine) && r.date <= isoLocal(fin)).length;
  $('#count').textContent = `${nb} évènement${nb > 1 ? 's' : ''} cette semaine`;
  $('#list').innerHTML = `<div class="semaine">
    <div class="semaine-nav">
      <button type="button" class="chip" data-sem="-1" aria-label="Semaine précédente">‹</button>
      <strong>${titre}</strong>
      <button type="button" class="chip" data-sem="1" aria-label="Semaine suivante">›</button>
      <button type="button" class="chip" data-sem="0">Aujourd'hui</button>
    </div>
    <div class="jours">${jours.map(d => {
      const iso = isoLocal(d);
      const evts = rows.filter(r => r.date === iso).sort((a, b) => (a.heure || '99').localeCompare(b.heure || '99'));
      return `<div class="jour${iso === auj ? ' today' : ''}${iso < auj ? ' passe' : ''}" data-jour="${iso}">
        <div class="jour-tete"><span>${fmt(d, { weekday: 'short' })}</span><strong>${d.getDate()}</strong></div>
        <div class="jour-evts">${evts.map(r => {
          const c = db.get('clients', r.clientId), v = db.get('vehicules', r.vehiculeId);
          return `<div class="evt ${TYPES_RDV[r.type] || 'b-grey'}${r.fait ? ' fait' : ''}" data-id="${r.id}">
            <span class="evt-h">${esc(r.heure || '')}</span> <span class="evt-t">${esc(r.type)}</span>
            <span class="evt-s">${esc([c && clientNom(c), v && vehiculeNom(v)].filter(Boolean).join(' · '))}</span></div>`;
        }).join('')}<span class="jour-add">+ Ajouter</span></div></div>`;
    }).join('')}</div></div>`;
}

// Sous-onglets et filtres de l'onglet Véhicules (reconstruits seulement quand nécessaire, pour garder le focus).
function renderFiltres() {
  const box = $('#filters');
  const add = $('#btn-add');
  add.style.display = onglet === 'stock' ? 'none' : '';
  add.innerHTML = icon('plus', 18) + '<span>' + (onglet === 'reprises' ? 'Nouvelle reprise' : onglet === 'depot' ? 'Nouveau dépôt vente' : onglet === 'planning' ? 'Nouveau RDV' : onglet === 'commandes' ? 'Nouvelle offre' : 'Ajouter') + '</span>';
  add.style.display = onglet === 'stock' || (onglet === 'commandes' && vueCommande !== 'Offres') ? 'none' : '';
  if (!ONGLETS[onglet].table) add.style.display = 'none';
  if (!['stock', 'reprises', 'depot', 'planning', 'commandes'].includes(onglet)) { box.innerHTML = ''; box.dataset.vue = ''; return; }
  const all = db.all('vehicules');
  const opt = (list, val) => list.map(o => `<option value="${esc(o)}"${o === val ? ' selected' : ''}>${esc(o || 'Tous')}</option>`).join('');
  const sig = sigFiltres();
  if (box.dataset.vue === sig) return;
  box.dataset.vue = sig;
  let html = '';
  if (onglet === 'commandes') {
    const cmd = db.all('commandes');
    const n = v => cmd.filter(VUES_COMMANDE[v]).length;
    html = `<div class="segmented">${['Offres', 'Commandes', 'Livraisons'].map(v =>
      `<button type="button" data-vuecmd="${v}" class="${v === vueCommande ? 'active' : ''}">${v} (${n(v)})</button>`).join('')}</div>
      ${vueCommande === 'Livraisons' ? '<div class="chips"><button type="button" id="btn-export-fac" class="chip">Exporter les factures (comptable)</button></div>' : ''}
      ${n('Annulées') ? `<div class="chips"><button type="button" data-vuecmd="Annulées" class="chip${vueCommande === 'Annulées' ? ' active' : ''}">Annulées (${n('Annulées')})</button></div>` : ''}`;
  } else if (onglet === 'planning') {
    html = `<div class="chips">${Object.keys(FILTRES_RDV).map(f =>
      `<button type="button" data-rdv="${f}" class="chip${f === filtreRdv ? ' active' : ''}">${f}${f === 'Semaine' ? '' : ` (${db.all('planning').filter(FILTRES_RDV[f]).length})`}</button>`).join('')}</div>`;
  } else if (vueVehicule === 'reprises') {
    const reps = all.filter(v => !Depot.est(v));
    html += `<div class="segmented">${Object.keys(STATUTS_REPRISE).map(f =>
      `<button type="button" data-reprise="${f}" class="${f === filtreReprise ? 'active' : ''}">${f.replace('Reprises ', '')} (${reps.filter(STATUTS_REPRISE[f]).length})</button>`).join('')}</div>`;
  } else if (vueVehicule === 'depot') {
    const deps = all.filter(Depot.est);
    const brouillons = deps.filter(v => v.statut === 'Dépôt en cours').length;
    html += `<div class="segmented seg-stock">${Object.entries(VUES_DEPOT).map(([k, [l, st]]) =>
      `<button type="button" data-vuedepot="${k}" class="${k === vueDepot ? 'active' : ''}">${l}<small>${deps.filter(v => st.includes(v.statut)).length}</small></button>`).join('')}</div>
      ${brouillons ? `<div class="chips"><button type="button" data-vuedepot="brouillons" class="chip${vueDepot === 'brouillons' ? ' active' : ''}">À compléter (${brouillons})</button></div>` : ''}`;
  } else {
    // Dépôt-vente seul : le Stock ne montre que les véhicules partenaires.
    const achat = all.filter(v => !Depot.est(v));
    const vues = Droits.achat() ? Object.entries(VUES_STOCK) : [];
    html += `<div class="segmented seg-stock">${vues.map(([k, [l, st]]) =>
      `<button type="button" data-vuestock="${k}" class="${k === vueStock ? 'active' : ''}">${l}<small>${achat.filter(v => v.statut === st).length}</small></button>`).join('')}
      <button type="button" data-vuestock="partenaires" class="${vueStock === 'partenaires' ? 'active' : ''}">Partenaires<small>${Partenaires.nombre()}</small></button></div>`;
    if (vueStock === 'partenaires') { box.innerHTML = html + Partenaires.filtresHtml(); return; }
    const f = filtresStock;
    const couleurs = [''].concat([...new Set(achat.filter(v => !REPRISE.includes(v.statut) && v.couleur).map(v => v.couleur.trim()))].sort());
    html += `<div class="filtres">
      <label>Type<select data-f="type">${opt(TYPES, f.type)}</select></label>
      <label>Couleur<select data-f="couleur">${opt(couleurs, f.couleur)}</select></label>
      <label>Année min<input data-f="anneeMin" type="number" inputmode="numeric" value="${esc(f.anneeMin)}" placeholder="ex. 2015"></label>
      <label>Année max<input data-f="anneeMax" type="number" inputmode="numeric" value="${esc(f.anneeMax)}" placeholder="ex. 2022"></label>
      <label>Km max<input data-f="kmMax" type="number" inputmode="numeric" step="10000" value="${esc(f.kmMax)}" placeholder="ex. 100000"></label>
      <button type="button" id="btn-reset-filtres" class="chip">Effacer</button></div>
      <div class="chips"><button type="button" id="btn-police" class="chip">📖 Livre de police</button></div>`;
  }
  box.innerHTML = html;
}

let rechercheOuverte = false;

function switchTab(name) {
  onglet = name;
  document.body.dataset.onglet = name;
  rechercheOuverte = false;
  majLoupe();
  current = ONGLETS[name].table;
  if (current === 'vehicules') vueVehicule = name;
  if (name === 'stock' && !Droits.achat()) vueStock = 'partenaires';
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $('#search').value = '';
  $('#search').placeholder = ONGLETS[name].placeholder;
  if (name === 'parametres') remplirParametres();
  render();
}

// ---------- Formulaire ----------
function fieldHtml(f, row) {
  let val = row[f.k] ?? (row.id ? '' : (typeof f.def === 'function' ? f.def() : f.def ?? ''));
  const id = 'f-' + f.k;
  const req = f.required ? ' required' : '';
  const label = `<label for="${id}">${esc(f.l)}${f.required ? ' *' : ''}</label>`;
  const cls = 'field' + (f.full ? ' full' : '');
  switch (f.type) {
    case 'lookup': return lookupHtml(row);
    case 'section': return `<h3 class="section">${esc(f.l)}</h3>`;
    case 'interets': {
      const sel = row.interets || [];
      const opts = db.all('vehicules').filter(v => DISPONIBLE.includes(v.statut) || v.statut === 'Réservé' || sel.includes(v.id))
        .sort((a, b) => norm(vehiculeNom(a)).localeCompare(norm(vehiculeNom(b))));
      return `<div class="${cls}"><label>${esc(f.l)}</label>${opts.length
        ? `<input type="search" class="mini-search" placeholder="Filtrer les véhicules…" data-filtre-liste="interets">
           <div class="checklist" id="liste-interets">${opts.map(v => `<label class="check"><input type="checkbox" name="interets" value="${v.id}"${sel.includes(v.id) ? ' checked' : ''}>
           <span>${esc(vehiculeNom(v))}<span class="sub"> ${esc([v.annee, km(v.kilometrage), v.couleur, euros(v.prixVente)].filter(Boolean).join(' · '))}${v.statut !== 'En stock' ? ' · ' + esc(v.statut) : ''}</span></span></label>`).join('')}</div>`
        : '<span class="hint">Aucun véhicule en stock pour le moment.</span>'}</div>`;
    }
    case 'reprise': {
      const cur = row.id ? db.all('vehicules').find(v => v.vendeurId === row.id && REPRISE.includes(v.statut)) : null;
      const opts = db.all('vehicules').filter(v => REPRISE.includes(v.statut) && (!v.vendeurId || v.vendeurId === row.id || !db.get('clients', v.vendeurId)));
      return `<div class="${cls}"><label for="${id}">${esc(f.l)}</label>
        <div class="inline"><select id="${id}" name="repriseId"><option value="">Aucune</option>${opts.map(v =>
          `<option value="${v.id}"${cur && cur.id === v.id ? ' selected' : ''}>${esc(vehiculeNom(v) + (v.immatriculation ? ' — ' + v.immatriculation : '') + (v.statut === 'Reprise refusée' ? ' (refusée)' : ''))}</option>`).join('')}</select>
        <button type="button" id="btn-nouvelle-reprise">+ Nouvelle</button></div>
        <span class="hint">« + Nouvelle » enregistre le client puis ouvre une fiche de reprise à son nom.</span></div>`;
    }
    case 'fiche': {
      const fiche = row.ficheTechnique || {};
      const n = Object.keys(fiche).length;
      return `<details class="fiche full" id="fiche"${n ? '' : ' hidden'}><summary>Fiche technique complète (<span id="fiche-n">${n}</span> infos)</summary>
        <dl id="fiche-dl">${ficheHtml(fiche)}</dl></details>`;
    }
    case 'photos': {
      if (!row.id || !Photos.deblocable(row) && !(row.photos || []).length) return '';
      const n = (row.photos || []).length;
      return `<div class="field full"><label>Photos (${n} / ${Photos.MAX})</label><div id="galerie-photos"></div></div>`;
    }
    case 'interesses': {
      const cs = row.id ? interessesPar(row) : [];
      return cs.length ? `<div class="field full"><label>Clients intéressés</label><span>${esc(cs.map(clientNom).join(', '))}</span></div>` : '';
    }
    case 'papiers': return Papiers.section(row);
    case 'reseau': return Reseau.champVehicule(row);
    case 'docsVente': return Facture.section(row);
    case 'depot': return Depot.section(row);
    case 'correspond': {
      if (!row.id || !aUneRecherche(row)) return '';
      const vs = vehiculesPour(row);
      return `<div class="field full"><label>Véhicules qui correspondent (${vs.length})</label>${vs.length
        ? vs.map(v => `<span>${esc(vehiculeNom(v))}<span class="hint"> ${esc([v.annee, km(v.kilometrage), euros(v.prixVente), v.statut].filter(Boolean).join(' · '))}</span></span>`).join('')
        : '<span class="hint">Aucun pour l\'instant : Ocaz te préviendra quand une reprise ou un véhicule correspondra.</span>'}</div>`;
    }
    case 'cherchent': {
      const cs = row.id ? clientsQuiCherchent(row) : [];
      return cs.length ? `<div class="field full"><label>🔎 Clients qui cherchent ce véhicule</label>${cs.map(c => `<span class="cherche">${esc(clientNom(c))}
        <span class="hint">${esc(resumeRecherche(c))}</span>${c.telephone ? ` <a class="wa" href="${esc(Papiers.lienWhatsapp(c, messageRecherche(c, row)))}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp', 16)}</a>` : ''}</span>`).join('')}</div>` : '';
    }
    case 'cote': return `<div class="field full cote"><span class="hint">Trouver une cote (gratuit, ouvre un nouvel onglet) :</span>
      <div class="chips"><button type="button" class="chip" data-cote="lacentrale">La Centrale</button>
      <button type="button" class="chip" data-cote="argus">L'argus</button>
      <button type="button" class="chip" data-cote="leboncoin">Annonces Leboncoin</button></div></div>`;
    case 'check': return `<label class="field check-field"><input type="checkbox" id="${id}" name="${f.k}"${val === true ? ' checked' : ''}> ${esc(f.l)}</label>`;
    case 'textarea': return `<div class="${cls}">${label}<textarea id="${id}" name="${f.k}">${esc(val)}</textarea></div>`;
    // Une nouvelle vente commence toujours par une offre : pas de choix du statut à la création.
    case 'select': if (f.k === 'statut' && current === 'commandes' && !row.id) return `<input type="hidden" id="${id}" name="statut" value="Offre">`;
      return `<div class="${cls}">${label}<select id="${id}" name="${f.k}">${f.options.map(o => `<option value="${esc(o)}"${o === val ? ' selected' : ''}>${esc(f.k === 'statut' ? libStatut(o) : o)}</option>`).join('')}</select></div>`;
    case 'ref': {
      let opts = db.all(f.table).slice();
      if (f.table === 'vehicules') {
        // Proposer les véhicules disponibles, plus celui déjà lié à la commande.
        if (!f.tous) opts = opts.filter(v => (v.statut !== 'Vendu' && !REPRISE.includes(v.statut)) || v.id === val);
        opts.sort((a, b) => norm(vehiculeNom(a)).localeCompare(norm(vehiculeNom(b))));
      } else {
        opts.sort((a, b) => norm(clientNom(a)).localeCompare(norm(clientNom(b))));
      }
      const name = f.table === 'clients' ? clientNom : v => vehiculeNom(v) + (v.immatriculation ? ' — ' + v.immatriculation : '')
        + (f.tous && REPRISE.includes(v.statut) ? ' (reprise)' : v.statut === 'Réservé' && v.id !== val ? ' (réservé)' : '');
      const empty = opts.length ? 'Choisir…' : (f.table === 'clients' ? "Aucun client : ajoute-le d'abord" : 'Aucun véhicule disponible');
      return `<div class="${cls}">${label}<select id="${id}" name="${f.k}"${req}><option value="">${empty}</option>${opts.map(o => `<option value="${o.id}"${o.id === val ? ' selected' : ''}>${esc(name(o))}</option>`).join('')}</select></div>`;
    }
    default: return `<div class="${cls}">${label}<input id="${id}" name="${f.k}" type="${f.type || 'text'}" value="${esc(val)}"${req}${f.type === 'number' ? ' inputmode="decimal" step="any"' : ''}></div>`;
  }
}

const ficheHtml = fiche => Object.entries(fiche).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
let ficheEnCours = null;
let imageEnCours = null;
// Image du modèle fournie par le service de plaque (si disponible).
function afficherImage(url) {
  const box = $('#vehicule-image');
  if (!box) return;
  box.hidden = !url;
  box.innerHTML = url ? `<img src="${esc(url)}" alt="" onerror="this.parentNode.hidden = true">` : '';
}

function lookupHtml(row) {
  return `<div class="vehicule-image" id="vehicule-image"${row.image ? '' : ' hidden'}>${row.image ? `<img src="${esc(row.image)}" alt="" onerror="this.parentNode.hidden = true">` : ''}</div>
  <div class="lookup">
    <div class="field"><label for="f-immatriculation">Plaque d'immatriculation</label>
      <div class="inline"><input id="f-immatriculation" name="immatriculation" value="${esc(row.immatriculation || '')}" placeholder="AB-123-CD" autocapitalize="characters">
      <button type="button" id="btn-plaque">Rechercher</button></div></div>
    <div class="field"><label for="f-vin">N° de série (VIN)</label>
      <div class="inline"><input id="f-vin" name="vin" value="${esc(row.vin || '')}" placeholder="17 caractères, case E de la carte grise" autocapitalize="characters" maxlength="20">
      <button type="button" id="btn-vin">Décoder</button></div>
      <span class="hint" id="vin-hint">La plaque remplit marque, modèle et finition. Le VIN remplit seulement la marque et l'année, gratuitement.</span></div>
  </div>`;
}

function openForm(id, preset = {}) {
  const tab = TABS[current];
  const row = id ? db.get(current, id) : { ...preset };
  editing = { table: current, id };
  $('#form-title').textContent = id
    ? (current === 'commandes' ? (row.statut === 'Offre' ? 'Offre ' : 'Commande ') + row.numero : current === 'vehicules' ? vehiculeNom(row) : current === 'planning' ? 'Rendez-vous' : clientNom(row))
    : (onglet === 'reprises' ? 'Nouvelle reprise' : tab.titreNouveau);
  $('#form-body').innerHTML = `<div class="grid">${tab.fields.map(f => fieldHtml(f, row)).join('')}</div>`;
  $('#btn-delete').style.display = id ? '' : 'none';
  $('#form-extra').innerHTML = current === 'vehicules' && (!id || row.statut === 'Reprise à étudier')
    ? `<button type="button" id="btn-refuser" class="danger">Refuser la reprise</button>
       <button type="button" id="btn-valider" class="success">Valider → entrer en stock</button>`
    : current === 'vehicules' && id && row.statut === 'En préparation'
    ? `<button type="button" id="btn-prepa" class="primary">🔧 Préparation${row.prepa ? ' ' + Prepa.avancement(row) : ''}</button><button type="button" id="btn-pret" class="success">Prêt → en stock</button>`
    : current === 'clients' && id && row.telephone
    ? `<a class="button wa-btn" href="${esc(Papiers.lienWhatsapp(row))}" target="_blank" rel="noopener">${icon('whatsapp', 18)} WhatsApp</a>`
    : current === 'commandes' && id && ETAPE_SUIVANTE[row.statut]
    ? `<button type="button" id="btn-etape" class="success" data-statut="${ETAPE_SUIVANTE[row.statut][1]}">${ETAPE_SUIVANTE[row.statut][0]}</button>`
    : '';
  // Dépôt-vente : documents du déposant (CNI, carte grise, justificatif, RIB) à téléverser ou photographier.
  if (current === 'vehicules' && id && Depot.est(row))
    $('#form-extra').insertAdjacentHTML('afterbegin', `<button type="button" id="btn-docs-depot">📄 Documents${DepotVente.docsManquants(row).length ? ' (' + DepotVente.docsManquants(row).length + ' à prendre)' : ''}</button>`);
  // Sur le téléphone, la prise de photos se débloque dès que le véhicule est en préparation.
  if (current === 'vehicules' && id && Photos.deblocable(row) && Photos.estTelephone())
    $('#form-extra').insertAdjacentHTML('afterbegin', '<button type="button" id="btn-photos" class="primary">📷 Prendre les photos</button>');
  if (current === 'vehicules') wireVehicule();
  if (current === 'commandes') wireCommande();
  if (current === 'clients') wireClient();
  $('#dlg').showModal();
}

function wireVehicule() {
  const galerie = $('#galerie-photos');
  if (galerie) Photos.galerie(galerie, db.get('vehicules', editing.id));
  $('#btn-photos')?.addEventListener('click', () => Photos.ouvrir(editing.id));
  $('#btn-docs-depot')?.addEventListener('click', () => { $('#dlg').close(); DepotVente.ouvrir(editing.id, 4); });
  $('#btn-prepa')?.addEventListener('click', () => Prepa.ouvrir(editing.id));
  $('#btn-pret')?.addEventListener('click', () => {
    $('#f-statut').value = 'En stock';
    if (!$('#f-dateEntree').value) $('#f-dateEntree').value = today();
    $('#form').requestSubmit();
    toast('Véhicule prêt : il passe en stock');
  });
  $('#btn-valider')?.addEventListener('click', () => {
    // Reprise validée : le prix proposé devient le prix d'achat, le véhicule entre en stock.
    if (!$('#f-prixAchat').value) $('#f-prixAchat').value = $('#f-prixPropose').value;
    if (!$('#f-dateEntree').value) $('#f-dateEntree').value = today();
    $('#f-statut').value = num($('#f-fraisEstimes').value) > 0 ? 'En préparation' : 'En stock';
    $('#form').requestSubmit();
  });
  $('#btn-refuser')?.addEventListener('click', () => {
    $('#f-statut').value = 'Reprise refusée';
    $('#form').requestSubmit();
  });
  document.querySelectorAll('[data-cote]').forEach(b => b.addEventListener('click', () => {
    const modele = ['marque', 'modele', 'finition', 'annee'].map(k => $('#f-' + k).value.trim()).filter(Boolean).join(' ');
    if (!modele) { toast("Remplis d'abord la marque et le modèle (ou cherche la plaque)."); return; }
    const plaque = $('#f-immatriculation').value.trim();
    if (plaque) navigator.clipboard?.writeText(plaque).catch(() => {});
    const url = {
      lacentrale: 'https://www.google.com/search?q=' + encodeURIComponent('cote La Centrale ' + modele),
      argus: 'https://www.google.com/search?q=' + encodeURIComponent("cote L'argus " + modele),
      leboncoin: 'https://www.leboncoin.fr/recherche?category=2&text=' + encodeURIComponent(modele),
    }[b.dataset.cote];
    window.open(url, '_blank', 'noopener');
    if (plaque) toast('Plaque copiée : colle-la sur le site si elle est demandée.');
  }));
  const plate = $('#f-immatriculation');
  plate.addEventListener('blur', () => { plate.value = formatPlaque(plate.value); });
  $('#btn-plaque').addEventListener('click', async () => {
    plate.value = formatPlaque(plate.value);
    const btn = $('#btn-plaque');
    btn.disabled = true;
    btn.textContent = 'Recherche…';
    try {
      const r = await Plaque.rechercher(plate.value);
      // Le résultat de la plaque remplace l'identité du véhicule, et complète tous les champs vides.
      let n = 0;
      ['marque', 'modele', 'finition'].forEach(k => { if (r[k]) { $('#f-' + k).value = r[k]; n++; } });
      ['annee', 'miseEnCirculation', 'carburant', 'boite', 'couleur', 'type', 'puissanceCh', 'puissanceFiscale',
        'cylindree', 'co2', 'portes', 'places', 'vin'].forEach(k => {
        const el = $('#f-' + k);
        if (!r[k] || !el || el.value) return;
        if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === r[k])) return;
        el.value = r[k];
        el.classList.add('auto');
        n++;
      });
      ficheEnCours = r.ficheTechnique;
      imageEnCours = r.image || '';
      afficherImage(imageEnCours);
      $('#fiche-dl').innerHTML = ficheHtml(r.ficheTechnique);
      $('#fiche-n').textContent = Object.keys(r.ficheTechnique).length;
      $('#fiche').hidden = false;
      $('#vin-hint').textContent = r.description ? 'Trouvé : ' + r.description : 'Véhicule trouvé.';
      const usage = Plaque.usageTexte();
      toast(`${n} champs remplis automatiquement` + (usage ? ` (${usage})` : ''));
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Rechercher';
    }
  });
  const decode = () => {
    const r = VIN.decode($('#f-vin').value);
    const hint = $('#vin-hint');
    if (!r.ok) { hint.textContent = r.error; return; }
    $('#f-vin').value = r.vin;
    const m = $('#f-marque'), a = $('#f-annee');
    if (r.marque && !m.value) m.value = r.marque;
    if (r.annee && !a.value) a.value = r.annee;
    hint.textContent = r.marque
      ? `Trouvé : ${r.marque}${r.annee ? ', année ' + r.annee + ' (indicative)' : ''}. Complète le modèle et la finition.`
      : 'Constructeur non reconnu. Saisis la marque à la main.';
  };
  $('#btn-vin').addEventListener('click', decode);
}

function wireClient() {
  $('[data-filtre-liste]')?.addEventListener('input', e => {
    const q = norm(e.target.value);
    document.querySelectorAll('#liste-interets .check').forEach(l => { l.style.display = norm(l.textContent).includes(q) ? '' : 'none'; });
  });
  $('#btn-nouvelle-reprise').addEventListener('click', () => {
    if (!$('#form').reportValidity()) return;
    apresEnregistrement = saved => {
      filtreReprise = 'Reprises en cours';
      switchTab('reprises');
      Reprise.ouvrir(null, { vendeurId: saved.id });
    };
    $('#form').requestSubmit();
  });
}

let apresEnregistrement = null;

// Reprise validée portée par une offre : le passage en commande fait entrer le véhicule en préparation,
// l'annulation ou la suppression de la commande le renvoie dans les reprises validées.
function repriseSuitCommande(o) {
  const r = db.get('vehicules', o.repriseId);
  if (!r) return;
  if (['Commande', 'Livraison', 'Livrée'].includes(o.statut) && REPRISE.includes(r.statut)) {
    const saved = db.upsert('vehicules', { id: r.id, statut: 'En préparation',
      prixAchat: r.prixAchat || r.prixPropose || '', dateEntree: r.dateEntree || today(), achatDate: r.achatDate || today(),
      achatPaiement: r.achatPaiement || "Déduit d'une vente (reprise)", vendeurId: r.vendeurId || o.clientId, repriseCommandeId: o.id });
    Papiers.apresAchat(saved);
    toast(`Reprise ${vehiculeNom(r)} validée : elle passe en préparation`);
  } else if (o.statut === 'Annulée' && r.repriseCommandeId === o.id && ['En préparation', 'En stock'].includes(r.statut)) {
    // Retirée du livre de police seulement si c'est la dernière ligne (pas de trou dans la numérotation).
    const dernier = num(r.policeNumero) && num(r.policeNumero) === Math.max(...db.all('vehicules').map(x => num(x.policeNumero)));
    db.upsert('vehicules', { id: r.id, statut: 'Reprise validée', dateEntree: '', repriseCommandeId: '', ...(dernier ? { policeNumero: '' } : {}) });
    toast(`Commande annulée : la reprise ${vehiculeNom(r)} repasse dans les reprises validées`);
  }
}

// Menu d'une offre ou d'une commande : imprimer, envoyer, modifier, étape suivante, supprimer.
const ETAPE_MENU = { 'Commande': ['Passer en livraison', 'Livraison'], 'Livraison': ['Marquer comme livrée', 'Livrée'] };
function menuCommande(id) {
  const o = db.get('commandes', id);
  if (!o) return;
  const offre = o.statut === 'Offre';
  const quoi = offre ? "l'offre" : 'la commande';
  // Commande livrée : le document à imprimer ou envoyer est la facture.
  const docVente = opts => (o.statut === 'Livrée' ? Facture.facture(o, opts) : Facture.bonDeCommande(o, opts));
  const fermer = () => $('#dlg-actions').close();
  const actions = [
    [`🖨 Imprimer ${quoi}`, () => offre ? Offre.afficher(id) : docVente()],
    [`✉ Envoyer ${quoi}`, () => offre ? Offre.afficher(id, { envoyer: true }) : docVente({ envoyer: true })],
    [`✎ Modifier ${quoi}`, () => offre ? Offre.ouvrir(id) : openForm(id)],
    offre ? ['✓ Passer en commande', () => { if (Offre.accepter(id)) { render(); toast(`Offre ${o.numero} passée en commande`); } }, 'success']
      : ETAPE_MENU[o.statut] && [`✓ ${ETAPE_MENU[o.statut][0]}`, () => {
        const avant = { ...o };
        db.upsert('commandes', { id, statut: ETAPE_MENU[o.statut][1] });
        const saved = db.get('commandes', id);
        TABS.commandes.afterSave(saved, avant);
        render();
        toast(`${o.numero} : ${saved.statut.toLowerCase()}`);
      }, 'success'],
    [`🗑 Supprimer ${quoi}`, () => {
      if (offre) { if (Offre.supprimer(id)) render(); return; }
      if (!confirm(`Supprimer définitivement la commande ${o.numero} ?`)) return;
      db.remove('commandes', id);
      TABS.commandes.afterDelete(o);
      toast('Commande supprimée');
      render();
    }, 'danger'],
  ].filter(Boolean);
  $('#actions-titre').textContent = (offre ? 'Offre ' : 'Commande ') + o.numero;
  $('#actions-sous').textContent = [clientNom(db.get('clients', o.clientId)), vehiculeNom(db.get('vehicules', o.vehiculeId)), euros(o.prix)].filter(Boolean).join(' · ');
  $('#actions-liste').innerHTML = actions.map(([l, , cls], i) => `<button type="button" data-action="${i}" class="${cls || ''}">${esc(l)}</button>`).join('');
  $('#actions-liste').onclick = e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    fermer();
    actions[b.dataset.action][1]();
  };
  $('#dlg-actions').showModal();
}
$('#actions-fermer').addEventListener('click', () => $('#dlg-actions').close());

const relances = o => db.all('planning').filter(r => r.commandeId === o.id && r.type === 'Relance client' && !r.fait);

function wireCommande() {
  $('#btn-etape')?.addEventListener('click', e => {
    $('#f-statut').value = e.target.dataset.statut;
    $('#form').requestSubmit();
  });
  // Pré-remplir le prix avec le prix de vente du véhicule choisi.
  $('#f-vehiculeId').addEventListener('change', e => {
    const v = db.get('vehicules', e.target.value);
    if (v && v.prixVente && !$('#f-prix').value) $('#f-prix').value = v.prixVente;
  });
}

$('#form').addEventListener('submit', e => {
  e.preventDefault();
  const tab = TABS[editing.table];
  const row = { id: editing.id };
  const fd = new FormData(e.target);
  fd.forEach((v, k) => { row[k] = typeof v === 'string' ? v.trim() : v; });
  if (editing.table === 'clients') row.interets = fd.getAll('interets');
  TABS[editing.table].fields.filter(f => f.type === 'check').forEach(f => { row[f.k] = fd.has(f.k); });
  if (editing.table === 'vehicules' && $('#f-reseau')) row.reseau = fd.has('reseau');
  if (editing.table === 'vehicules' && ficheEnCours) row.ficheTechnique = ficheEnCours;
  if (editing.table === 'vehicules' && imageEnCours !== null) row.image = imageEnCours;
  if (row.immatriculation) row.immatriculation = formatPlaque(row.immatriculation);
  if (row.vin) row.vin = VIN.clean(row.vin);
  if (editing.table === 'vehicules' && row.immatriculation) {
    const dup = db.all('vehicules').find(v => v.immatriculation === row.immatriculation && v.id !== editing.id);
    if (dup && !confirm(`La plaque ${row.immatriculation} existe déjà (${vehiculeNom(dup)}). Enregistrer quand même ?`)) return;
  }
  const avant = editing.id ? { ...db.get(editing.table, editing.id) } : null;
  const after = tab.beforeSave?.(row);
  const saved = db.upsert(editing.table, row);
  after?.(saved);
  if (editing.table === 'vehicules') {
    if (['En préparation', 'En stock', 'Réservé', 'Vendu'].includes(saved.statut)) Papiers.apresAchat(saved);
    if (saved.statut === 'Vendu') Papiers.rappelRetrait(saved);
  }
  $('#dlg').close();
  toast(editing.id ? 'Modifications enregistrées' : 'Ajouté');
  tab.afterSave?.(saved, avant);
  render();
  const next = apresEnregistrement;
  apresEnregistrement = null;
  next?.(saved);
});

$('#btn-delete').addEventListener('click', () => {
  const tab = TABS[editing.table];
  const row = db.get(editing.table, editing.id);
  const ok = tab.canDelete(row);
  if (ok !== true) { toast(ok); return; }
  if (!confirm('Supprimer définitivement ce ' + tab.titre + ' ?')) return;
  db.remove(editing.table, editing.id);
  tab.afterDelete?.(row);
  $('#dlg').close();
  toast('Supprimé');
  render();
});

$('#btn-cancel').addEventListener('click', () => $('#dlg').close());
$('#dlg').addEventListener('close', () => { apresEnregistrement = null; ficheEnCours = null; imageEnCours = null; });

// ---------- Sauvegarde ----------
// Onglet Paramètres : réglages du garage (partagés) et de cet appareil.
function remplirParametres() {
  Param.rendre();
  Revision.rendreParam();
  const sb = Sync.settings();
  $('#set-sb-url').value = sb.url || '';
  $('#set-sb-cle').value = sb.cle || '';
  afficherSync(Sync.status, Sync.user, Sync.role);
  afficherQr();
  majInstall();
}
$('#btn-menu').addEventListener('click', () => switchTab('parametres'));

// ---------- Comptes et synchronisation ----------
const SYNC_TEXTE = { off: 'Non connecté', connexion: 'Connexion…', ok: 'Synchronisé', envoi: 'Envoi…', erreur: 'Erreur de synchro', refuse: 'Accès refusé', 'nouveau-mdp': 'Nouveau mot de passe' };
let etaitConnecte = false;
let vitrineDemarree = false;

function afficherSync(status, user, role) {
  const pill = $('#sync-pill');
  const demo = !!Sync.entreprise?.demo;
  pill.hidden = !Sync.configure() || !role;
  pill.className = 'sync-pill s-' + status + (demo ? ' demo' : '');
  pill.innerHTML = icon('nuage', 16) + '<span>' + (demo ? 'Démo · ' : '') + SYNC_TEXTE[status] + '</span>';
  $('#sync-etat').textContent = user ? `Connecté : ${demo ? 'compte de démo' : user.email}${Sync.profil.superadmin ? ' · Administrateur' : ''} · ${SYNC_TEXTE[status]}` : '';
  $('#compte-connecte').hidden = !user;
  $('#changer-mdp').hidden = demo;
  $('#btn-demo-reset').hidden = !demo;
  $('#btn-admin').hidden = !Sync.profil.superadmin;
  $('#reglages-supabase').open = !Sync.configure();
  if (role) etaitConnecte = true;
  if (status === 'ok') {
    // Vitrine en ligne : demandes des visiteurs en direct, et copie publique remise à jour.
    if (!vitrineDemarree) { vitrineDemarree = true; EnLigne.demarrer(); Reseau.demarrer(); } else { EnLigne.planifier(); Reseau.planifier(); }
    // Nom de l'entreprise donné à la création du compte : repris dans les infos du garage.
    if (Sync.entreprise?.nom && !Param.get().garage.nom) Param.save({ garage: { ...Param.get().garage, nom: Sync.entreprise.nom } });
    // Compte démo vide : on le remplit avec des données d'exemple.
    if (demo && !db.all('vehicules').length) Demo.remplir();
    else if (demo) Demo.completerPhotos();
    // Démo : le garage fait partie du réseau, pour montrer les leads de l'apporteur de démo.
    if (demo && !Param.get().reseau.accepteLe) Param.save({ reseau: { ...Param.get().reseau, actif: true, accepteLe: new Date().toISOString() } });
    if (onglet === 'donnees') render();
  }
  // Déconnexion : les données quittent l'appareil (elles restent en ligne).
  if (!user && etaitConnecte) { etaitConnecte = false; vitrineDemarree = false; EnLigne.arreter(); Reseau.arreter(); db.vider(); switchTab('donnees'); }
  afficherAuth(status, user, role);
  if (!['connexion', 'envoi'].includes(status)) chargement(false);
}

// Transition après la connexion : l'écran de lancement (barre de chargement) jusqu'à l'arrivée des données.
let chargementDepuis = 0;
function chargement(oui) {
  const s = $('#splash');
  if (oui) { chargementDepuis = Date.now(); s.classList.remove('fin'); setTimeout(() => chargement(false), 8000); return; }
  if (!chargementDepuis) return;
  const reste = Math.max(0, 900 - (Date.now() - chargementDepuis));
  chargementDepuis = 0;
  setTimeout(() => s.classList.add('fin'), reste);
}

// Un seul écran de connexion pour les revendeurs et les apporteurs, l'espace s'ouvre selon le compte.
// ?espace=… (anciens liens) choisit l'espace préféré d'un compte qui a les deux.
const espaceLien = new URLSearchParams(location.search).get('espace');
if (['revendeur', 'apporteur'].includes(espaceLien)) Sync.preferer(espaceLien === 'apporteur' ? 'apporteur' : 'garage');
$('#btn-espace').addEventListener('click', () => Sync.preferer('apporteur'));
$('#btn-admin').addEventListener('click', () => Sync.preferer(''));

// Écran de connexion : l'appli s'ouvre dessus tant qu'on n'est pas connecté.
function afficherAuth(status, user, role) {
  const gate = $('#auth');
  const config = Sync.configure();
  // Mot de passe de départ : il faut le changer avant d'utiliser l'appli.
  const nouveau = !!user && !!Sync.profil.doit_changer_mdp;
  const bloque = !role || nouveau;
  gate.hidden = !bloque || (status === 'connexion' && !!user);
  document.body.classList.toggle('verrouille', bloque);
  $('#btn-espace').hidden = !role || !Sync.apporteur;
  if (!bloque) return;
  $('#auth-espace').hidden = !!user;
  $('#auth-espace').textContent = 'Version pro';
  const refuse = status === 'refuse';
  $('#auth-texte').textContent = !config ? "L'appli n'est pas encore reliée à sa base : ouvre Réglages techniques ci-dessous."
    : refuse ? `Le compte ${user.email} n'est rattaché à aucun garage. Contacte ton administrateur. (Administrateur : cet email doit figurer dans la liste des super-admins, voir le guide de mise en route.)`
    : status === 'erreur' && user ? 'Connexion à la base impossible. Vérifie le réseau, ou que le script supabase.sql a bien été lancé.'
    : nouveau ? 'Première connexion : choisis ton mot de passe (8 caractères minimum).'
    : 'Revendeur ou apporteur d\'affaires : connecte-toi, Ocaz ouvre ton espace.';
  $('#auth-ok').textContent = nouveau ? 'Enregistrer mon mot de passe' : 'Se connecter';
  $('#auth-champ-email').hidden = refuse || nouveau || !config;
  $('#auth-champ-mdp').hidden = refuse || !config;
  $('#auth-champ-mdp2').hidden = !nouveau;
  $('#auth-champ-rester').hidden = refuse || nouveau || !config;
  $('#auth-ok').hidden = refuse || !config;
  $('#auth-aide').hidden = refuse || nouveau || !config;
  $('#auth-devenir').hidden = refuse || nouveau || !config;
  $('#auth-mdp').autocomplete = nouveau ? 'new-password' : 'current-password';
  $('#auth-mdp').placeholder = nouveau ? 'Nouveau mot de passe' : '';
  $('#auth-sortir').hidden = !user;
  $('#auth-config').hidden = config && !refuse;
  $('#auth-config').open = !config;
}

$('#auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#auth-email').value.trim(), mdp = $('#auth-mdp').value;
  const btn = $('#auth-ok');
  const nouveau = !!Sync.profil.doit_changer_mdp;
  if (!nouveau && !id) { erreurAuth('Saisis ton email.'); return; }
  if (!mdp) { erreurAuth('Saisis ton mot de passe.'); return; }
  if (nouveau && mdp !== $('#auth-mdp2').value) { erreurAuth('Les deux mots de passe ne sont pas identiques.'); return; }
  btn.disabled = true;
  btn.textContent = nouveau ? 'Enregistrement…' : 'Connexion…';
  erreurAuth('');
  try {
    if (nouveau) { await Sync.nouveauMotDePasse(mdp); toast('Mot de passe enregistré'); }
    else { await Sync.connecter(id, mdp, $('#auth-rester').checked); chargement(true); }
    $('#auth-mdp').value = ''; $('#auth-mdp2').value = '';
  } catch (err) { erreurAuth(err.message); }
  finally { btn.disabled = false; btn.textContent = Sync.profil.doit_changer_mdp ? 'Enregistrer mon mot de passe' : 'Se connecter'; }
});
$('#auth-sortir').addEventListener('click', () => Sync.deconnecter());
// Erreur affichée dans la carte de connexion (bien visible, au-dessus du bouton).
function erreurAuth(msg) {
  const el = $('#auth-erreur');
  el.textContent = msg;
  el.hidden = !msg;
  if (msg) { el.classList.remove('secoue'); void el.offsetWidth; el.classList.add('secoue'); }
}
['#auth-email', '#auth-mdp'].forEach(sel => $(sel).addEventListener('input', () => erreurAuth('')));
const enregistrerConfig = (url, cle) => {
  url = url.trim(); cle = cle.trim();
  if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) { toast("L'adresse doit ressembler à https://xxxx.supabase.co"); return; }
  Sync.saveSettings({ url: url.replace(/\/$/, ''), cle });
  toast('Réglages enregistrés, rechargement…');
  setTimeout(() => location.reload(), 800);
};
$('#auth-sb-ok').addEventListener('click', () => enregistrerConfig($('#auth-sb-url').value, $('#auth-sb-cle').value));
$('#btn-save-sync').addEventListener('click', () => enregistrerConfig($('#set-sb-url').value, $('#set-sb-cle').value));
$('#btn-deconnexion').addEventListener('click', () => Sync.deconnecter());
$('#sync-pill').addEventListener('click', () => $('#btn-menu').click());
$('#btn-mdp-changer').addEventListener('click', async () => {
  const m1 = $('#mdp-nouveau').value, m2 = $('#mdp-nouveau2').value;
  if (m1 !== m2) { toast('Les deux mots de passe ne sont pas identiques.'); return; }
  try { await Sync.nouveauMotDePasse(m1); $('#mdp-nouveau').value = ''; $('#mdp-nouveau2').value = ''; $('#changer-mdp').open = false; toast('Mot de passe changé'); }
  catch (err) { toast(err.message); }
});
$('#btn-demo-reset').addEventListener('click', () => {
  if (!confirm('Remplacer les données de démo par les données d\'exemple de départ ?')) return;
  Demo.remplir(true);
  switchTab('donnees');
  toast('Démo remise à zéro');
});

// ---------- Installation (sans App Store) ----------
let invitationInstall = null;
const estInstallee = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const estIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); invitationInstall = e; majInstall(); });
function majInstall() {
  $('#btn-installer-ici').hidden = !invitationInstall || estInstallee();
  let refus = false;
  try { refus = localStorage.getItem('crmzx-install-non') === '1'; } catch (e) { /* rien */ }
  const montrer = !estInstallee() && !refus && Photos.estTelephone() && (invitationInstall || estIphone());
  $('#install-banner').hidden = !montrer;
  $('#install-ok').hidden = !invitationInstall;
  $('#install-texte').textContent = invitationInstall
    ? "Installe l'appli sur ton téléphone pour l'ouvrir comme une vraie appli."
    : "Pour installer l'appli : touche Partager ⬆️ en bas de Safari, puis « Sur l'écran d'accueil ».";
}
async function installer() {
  if (!invitationInstall) return;
  invitationInstall.prompt();
  await invitationInstall.userChoice;
  invitationInstall = null;
  majInstall();
}
$('#install-ok').addEventListener('click', installer);
$('#btn-installer-ici').addEventListener('click', installer);
$('#install-non').addEventListener('click', () => { try { localStorage.setItem('crmzx-install-non', '1'); } catch (e) { /* rien */ } majInstall(); });
window.addEventListener('appinstalled', () => { invitationInstall = null; majInstall(); });
function afficherQr() {
  const qr = qrcode(0, 'M');
  qr.addData(Sync.lienConfig());
  qr.make();
  $('#qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
$('#btn-copier-lien').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(Sync.lienConfig()); toast('Lien copié : envoie-le à ton collègue'); }
  catch (e) { prompt('Copie ce lien :', Sync.lienConfig()); }
});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});



$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(db.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ocaz-sauvegarde-' + today() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#file-import').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.clients) || !Array.isArray(data.vehicules) || !Array.isArray(data.commandes)) throw new Error();
    if (!confirm('Remplacer toutes les données actuelles par cette sauvegarde ?')) return;
    db.data = Object.assign({ seq: 0 }, data);
    db.save();
    switchTab('donnees');
    toast('Sauvegarde importée');
  } catch (err) {
    toast("Ce fichier n'est pas une sauvegarde Ocaz valide.");
  } finally {
    e.target.value = '';
  }
});

// ---------- Démarrage ----------
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
$('#search').addEventListener('input', render);
$('#filters').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.rdv) filtreRdv = b.dataset.rdv;
  else if (b.dataset.vuecmd) vueCommande = b.dataset.vuecmd;
  else if (b.dataset.vuestock) vueStock = b.dataset.vuestock;
  else if (b.dataset.vuedepot) vueDepot = b.dataset.vuedepot;
  else if (b.dataset.reprise) filtreReprise = b.dataset.reprise;
  else if (b.id === 'btn-police') { Papiers.ouvrirPolice(); return; }
  else if (b.id === 'btn-export-fac') { Facture.exporter(); return; }
  else if (b.id === 'btn-reset-filtres') Object.assign(filtresStock, { couleur: '', type: '', anneeMin: '', anneeMax: '', kmMax: '' });
  else return;
  render();
});
$('#filters').addEventListener('input', e => {
  const k = e.target.dataset.f;
  if (!k) return;
  filtresStock[k] = e.target.value;
  // Les champs texte gardent le focus : on ne reconstruit pas la barre de filtres.
  $('#filters').dataset.vue = sigFiltres();
  render();
});
$('#btn-add').addEventListener('click', () => (onglet === 'commandes' ? Offre.ouvrir() : onglet === 'reprises' ? Reprise.ouvrir() : onglet === 'depot' ? DepotVente.ouvrir() : openForm(null)));
$('#list').addEventListener('click', e => {
  if (e.target.closest('[data-stop]')) return;
  if (Reseau.clic(e)) return;
  if (Revision.clic(e)) return;
  if (Partenaires.clic(e)) return;
  const police = e.target.closest('[data-police]');
  if (police) { Papiers.ouvrirPolice(); return; }
  const sem = e.target.closest('[data-sem]');
  if (sem) {
    const n = Number(sem.dataset.sem);
    if (n) semaine = ajouterJours(semaine, 7 * n);
    else { const d = new Date(); d.setHours(12, 0, 0, 0); semaine = ajouterJours(d, -((d.getDay() + 6) % 7)); }
    render();
    return;
  }
  const aller = e.target.closest('[data-aller]');
  if (aller) { switchTab(aller.dataset.aller); return; }
  const anc = e.target.closest('[data-vehicule]');
  if (anc) { switchTab('stock'); openForm(anc.dataset.vehicule); return; }
  const souf = e.target.closest('[data-client]');
  if (souf) { switchTab('clients'); openForm(souf.dataset.client); return; }
  const evt = e.target.closest('.evt');
  if (evt) { openForm(evt.dataset.id); return; }
  const jour = e.target.closest('[data-jour]');
  if (jour) { openForm(null, { date: jour.dataset.jour }); return; }
  const card = e.target.closest('.card');
  if (!card) return;
  if (current === 'commandes') menuCommande(card.dataset.id);
  else if (current === 'vehicules' && db.get('vehicules', card.dataset.id)?.statut === 'Dépôt en cours') DepotVente.ouvrir(card.dataset.id);
  else if (current === 'vehicules' && REPRISE.includes(db.get('vehicules', card.dataset.id)?.statut)) Reprise.ouvrir(card.dataset.id);
  else openForm(card.dataset.id);
});

db.load();
// Icônes des onglets et des boutons.
document.querySelectorAll('[data-tab]').forEach(b => {
  const o = ONGLETS[b.dataset.tab];
  b.innerHTML = icon(o.icon, b.closest('#bottom-tabs') ? 22 : 18) + '<span>' + o.label + '</span>';
});
$('#btn-menu').innerHTML = icon('reglages', 20);
$('#btn-loupe').innerHTML = icon('recherche', 20);

// Dans Commandes, la recherche est repliée derrière une loupe.
function majLoupe() {
  const replie = onglet === 'commandes';
  $('#btn-loupe').hidden = !replie;
  $('#btn-loupe').classList.toggle('active', rechercheOuverte);
  document.querySelector('.search').hidden = replie && !rechercheOuverte;
}
$('#btn-loupe').addEventListener('click', () => {
  rechercheOuverte = !rechercheOuverte;
  if (!rechercheOuverte) { $('#search').value = ''; render(); }
  majLoupe();
  if (rechercheOuverte) $('#search').focus();
});
$('#search-ico').innerHTML = icon('recherche', 18);
switchTab('donnees');
// iOS ignore parfois user-scalable=no : on bloque aussi le geste de pincement.
document.addEventListener('gesturestart', e => e.preventDefault());
Offre.init();
Reprise.init();
Scan.init();
Photos.init();
Param.init();
Papiers.init();
Facture.init();
Prepa.init();
Depot.init();
DepotVente.init();
Partenaires.init();
EnLigne.init();
Reseau.init();
Revision.init();
Import.init();
let redim = null;
window.addEventListener('resize', () => { clearTimeout(redim); if (onglet === 'donnees') redim = setTimeout(render, 150); });
$('#dlg-photos').addEventListener('close', () => {
  const g = $('#galerie-photos');
  if (g && $('#dlg').open) Photos.galerie(g, db.get('vehicules', editing.id));
});
// Écran de lancement : court (environ 1 s), puis fondu vers l'appli.
// Il reste dans la page (caché) pour servir de transition à la connexion.
setTimeout(() => { if (!chargementDepuis) $('#splash').classList.add('fin'); }, 900);
// Réglages de l'administrateur reçus (ou modifiés) : onglets autorisés et infos du garage.
Sync.init(afficherSync, () => {
  Droits.appliquer();
  if (onglet === 'parametres') Param.rendre();
  else render();
});
Droits.appliquer();
afficherSync(Sync.status, Sync.user, Sync.role);
majInstall();
