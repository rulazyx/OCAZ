// Données d'exemple du compte démo (identifiant « revendeur ») : un petit garage de La Réunion fictif.
// Les dates sont calculées à partir d'aujourd'hui pour que l'accueil et le planning restent vivants.
const Demo = (() => {
  const jour = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoLocal(d); };
  const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // Photos d'exemple : une illustration de la voiture dans sa couleur, sur un fond qui change d'un véhicule à l'autre.
  // (Les vraies photos se prennent depuis le téléphone, dans la fiche du véhicule.)
  const TEINTES = { Blanc: '#eef0f3', Gris: '#8b929b', Noir: '#25282d', Rouge: '#c62d34', Bleu: '#2f5fb3', Orange: '#e8772e', Vert: '#2f8f5b', Jaune: '#f2c230' };
  const DECORS = [['#fff2c6', '#f4c26b'], ['#d7ecff', '#8fc1f2'], ['#dff5e3', '#9fd4ad'], ['#ffe0e6', '#f4a7b9'], ['#e6e4f7', '#b3aee6'], ['#f1ece4', '#cdbfa8']];
  const FORMES = {
    citadine: { caisse: 'M110 330 L110 292 Q112 264 150 257 L215 249 Q250 206 300 199 L410 197 Q452 199 482 250 L516 262 Q533 270 533 300 L533 330 Z',
      vitres: ['M230 250 Q258 216 300 211 L350 210 L350 250 Z', 'M362 210 L405 210 Q432 213 458 250 L362 250 Z'], roues: [195, 452], r: 38, y: 332, porte: 356 },
    suv: { caisse: 'M104 336 L104 282 Q107 252 150 244 L206 238 Q236 184 292 177 L440 175 Q472 177 497 238 L521 248 Q538 256 538 292 L538 336 Z',
      vitres: ['M222 238 Q248 192 294 188 L362 187 L362 238 Z', 'M374 187 L436 187 Q458 191 478 238 L374 238 Z'], roues: [192, 456], r: 43, y: 336, porte: 368 },
    utilitaire: { caisse: 'M98 336 L98 272 Q100 246 140 240 L190 232 Q214 170 260 162 L522 160 Q542 162 542 186 L542 336 Z',
      vitres: ['M204 232 Q228 180 262 175 L322 175 L322 232 Z', 'M334 175 L404 175 L404 232 Z'], roues: [186, 462], r: 41, y: 336, porte: 328 },
  };
  function illustration(type, couleur, n) {
    const f = FORMES[type === 'SUV / 4x4' ? 'suv' : type === 'Utilitaire' ? 'utilitaire' : 'citadine'];
    const c = TEINTES[couleur] || TEINTES.Gris;
    const [ciel, sol] = DECORS[n % DECORS.length];
    const roue = x => `<circle cx="${x}" cy="${f.y}" r="${f.r + 6}" fill="#1b1d21" opacity=".18"/><circle cx="${x}" cy="${f.y}" r="${f.r}" fill="#1b1d21"/>`
      + `<circle cx="${x}" cy="${f.y}" r="${f.r * .55}" fill="#c9ccd1"/><circle cx="${x}" cy="${f.y}" r="${f.r * .18}" fill="#7d828a"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">`
      + `<stop offset="0" stop-color="${ciel}"/><stop offset="1" stop-color="${sol}"/></linearGradient>`
      + `<linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`
      + `<rect width="640" height="480" fill="url(#f)"/><rect y="360" width="640" height="120" fill="#000" opacity=".06"/>`
      + `<ellipse cx="321" cy="${f.y + f.r - 2}" rx="250" ry="16" fill="#000" opacity=".18"/>`
      + `<path d="${f.caisse}" fill="${c}" stroke="#1b1d21" stroke-opacity=".25" stroke-width="2"/><path d="${f.caisse}" fill="url(#r)"/>`
      + f.vitres.map(d => `<path d="${d}" fill="#2b3440" opacity=".85"/>`).join('')
      + `<path d="M${f.porte} ${f.y - 80} L${f.porte} ${f.y - 18}" stroke="#1b1d21" stroke-opacity=".3" stroke-width="2"/>`
      + `<rect x="${f.porte + 18}" y="${f.y - 66}" width="22" height="5" rx="2" fill="#1b1d21" opacity=".35"/>`
      + `<rect x="${f.roues[1] + f.r + 20}" y="${f.y - 58}" width="22" height="12" rx="4" fill="#fff6c8"/>`
      + `<rect x="${f.roues[0] - f.r - 34}" y="${f.y - 56}" width="12" height="12" rx="3" fill="#d43a3a"/>`
      + f.roues.map(roue).join('') + `</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  // Compte démo déjà rempli avant l'ajout des photos d'exemple : on les ajoute aux véhicules qui n'en ont pas.
  // Elles sont aussi envoyées dans le dossier « photos » du garage démo, pour apparaître sur le site du réseau.
  let envoiEnCours = false;
  async function completerPhotos() {
    db.all('vehicules').forEach((v, i) => { if (!v.image && !(v.photos || []).length) db.upsert('vehicules', { id: v.id, image: illustration(v.type, v.couleur, i) }); });
    if (envoiEnCours || !Sync.client || !Sync.entreprise?.id) return;
    envoiEnCours = true;
    try {
      for (const v of db.all('vehicules').filter(x => x.statut !== 'Vendu' && x.image?.startsWith('data:image/svg') && !(x.photos || []).length)) {
        try {
          const c = await Photos.jpeg(v.image);
          const blob = c && await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
          if (!blob) continue;
          const chemin = `${Sync.entreprise.id}/${v.id}/exemple.jpg`;
          const { error } = await Sync.client.storage.from(Photos.BUCKET).upload(chemin, blob, { contentType: 'image/jpeg', upsert: true });
          if (!error && db.get('vehicules', v.id)) db.upsert('vehicules', { id: v.id, photos: [chemin] });
        } catch (e) { /* hors ligne : nouvel essai à la prochaine connexion */ }
      }
    } finally { envoiEnCours = false; }
    render();
  }

  function remplir(remettreAZero) {
    const maintenant = new Date().toISOString();
    if (remettreAZero) {
      // Les anciennes fiches sont marquées supprimées pour que la synchro ne les ramène pas.
      const supprimes = db.data.supprimes || {};
      ['clients', 'vehicules', 'commandes', 'planning'].forEach(t => db.all(t).forEach(r => { supprimes[r.id] = maintenant; }));
      db.data.supprimes = supprimes;
    }
    const fiche = r => ({ id: id(), creeLe: maintenant, majLe: maintenant, ...r });

    const clients = [
      ['Payet', 'Jean-Marc', '0692 41 22 18', 'Saint-Pierre'], ['Hoarau', 'Sandrine', '0693 12 54 90', 'Le Tampon'],
      ['Grondin', 'Luc', '0692 77 03 61', 'Saint-Louis'], ['Técher', 'Nathalie', '0692 30 48 12', 'Saint-Paul'],
      ['Fontaine', 'David', '0693 88 21 07', 'Saint-Denis'], ['Rivière', 'Émilie', '0692 15 66 39', 'Saint-André'],
      ['Boyer', 'Kévin', '0693 02 97 45', 'Saint-Joseph'], ['Maillot', 'Audrey', '0692 59 13 80', 'Sainte-Marie'],
    ].map(([nom, prenom, telephone, ville]) => fiche({ nom, prenom, telephone, ville, email: `${prenom}.${nom}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '@exemple.re' }));
    const sources = ['Leboncoin', 'Facebook', 'Passage au garage', 'Leboncoin', 'Bouche-à-oreille', 'La Centrale', 'Leboncoin', 'Facebook'];
    clients.forEach((c, i) => { c.source = sources[i]; c.civilite = i % 2 ? 'Mme' : 'M.'; c.adresse = (12 + i * 7) + ' rue de la République'; });
    const C = Object.fromEntries(clients.map(c => [c.nom, c.id]));

    const v = (marque, modele, finition, annee, km, carburant, boite, type, couleur, statut, entree, achat, vente, frais, extra = {}) => fiche({
      marque, modele, finition, annee, kilometrage: km, carburant, boite, type, couleur, statut, puissanceFiscale: 5,
      dateEntree: entree == null ? '' : jour(-entree), prixAchat: achat, prixVente: vente, fraisEstimes: frais, ...extra,
    });
    const vehicules = [
      v('Renault', 'Clio', 'V TCe 90 Evolution', 2021, 32000, 'Essence', 'Manuelle', 'Citadine', 'Blanc', 'En stock', 45, 11800, 15900, 400,
        { vendeurId: C['Grondin'], immatriculation: 'GH-204-RE', vin: 'VF1RJA00X67123456', achatPaiement: 'Virement', vendeurPieceType: "Carte d'identité", vendeurPieceNumero: 'X4RT82KL9', vendeurPieceDate: jour(-2000), vendeurPieceAutorite: 'Préfecture de La Réunion' }),
      v('Peugeot', '208', 'PureTech 100 Allure', 2020, 48000, 'Essence', 'Manuelle', 'Citadine', 'Gris', 'En stock', 95, 10500, 14500, 600),
      v('Dacia', 'Duster', 'Blue dCi 115 Prestige', 2019, 61000, 'Diesel', 'Manuelle', 'SUV / 4x4', 'Orange', 'En stock', 20, 12000, 15900, 300),
      v('Toyota', 'Yaris', 'Hybride 116h Design', 2022, 25000, 'Hybride', 'Automatique', 'Citadine', 'Rouge', 'En stock', 12, 15800, 19900, 200),
      v('Kia', 'Picanto', '1.0 Active', 2018, 52000, 'Essence', 'Manuelle', 'Citadine', 'Bleu', 'En stock', 130, 6200, 8900, 350),
      v('Hyundai', 'i20', '1.2 Intuitive', 2019, 58000, 'Essence', 'Manuelle', 'Citadine', 'Noir', 'En préparation', 6, 7900, 11500, 900),
      v('Volkswagen', 'Polo', '1.0 TSI Confortline', 2017, 74000, 'Essence', 'Manuelle', 'Citadine', 'Gris', 'En préparation', 3, 7200, 10900, 1200),
      v('Nissan', 'Qashqai', '1.3 DIG-T N-Connecta', 2020, 41000, 'Essence', 'Automatique', 'SUV / 4x4', 'Blanc', 'Réservé', 38, 16500, 21900, 500),
      v('Citroën', 'C3', '1.2 PureTech Feel', 2016, 98000, 'Essence', 'Manuelle', 'Citadine', 'Blanc', 'Reprise à étudier', null, '', '', '',
        { vendeurId: C['Técher'], coteLaCentrale: 7600, coteLeboncoin: 8200, fraisMecanique: 400, fraisCarrosserie: 300, fraisSupposes: 150, immatriculation: 'FA-512-RE' }),
      v('Renault', 'Clio', '1.5 dCi 90 Zen', 2017, 88000, 'Diesel', 'Manuelle', 'Citadine', 'Gris', 'Reprise validée', null, '', '', '',
        { vendeurId: C['Hoarau'], coteLaCentrale: 8400, coteLeboncoin: 8900, fraisMecanique: 300, fraisSupposes: 150, prixPropose: 6200, immatriculation: 'EY-208-RE' }),
    ];
    // Ventes livrées sur les 5 derniers mois (et trois autour de 11 mois).
    const ventes = [
      ['Renault', 'Captur', 2019, 'SUV / 4x4', 12, 40, 13200, 17900, 'Payet'], ['Toyota', 'Aygo', 2020, 'Citadine', 25, 30, 7400, 10500, 'Fontaine'],
      ['Peugeot', '3008', 2018, 'SUV / 4x4', 48, 55, 15500, 20900, 'Boyer'], ['Suzuki', 'Swift', 2019, 'Citadine', 70, 28, 8800, 12400, 'Maillot'],
      ['Dacia', 'Sandero', 2021, 'Citadine', 95, 22, 8600, 11900, 'Rivière'], ['Ford', 'Fiesta', 2018, 'Citadine', 128, 60, 6900, 9900, 'Grondin'],
      ['Renault', 'Kangoo', 2017, 'Utilitaire', 150, 75, 8200, 12500, 'Hoarau'],
      // Ventes d'il y a 11 mois environ : elles donnent les leads « Révision » de la démo.
      ['Peugeot', '208', 2018, 'Citadine', 340, 35, 9200, 12900, 'Técher'], ['Hyundai', 'Tucson', 2019, 'SUV / 4x4', 352, 40, 16200, 21500, 'Rivière'],
      ['Citroën', 'C3', 2019, 'Citadine', 322, 30, 7900, 11200, 'Grondin'],
    ].map(([marque, modele, annee, type, il, sejour, achat, vente, client]) => ({
      v: v(marque, modele, '', annee, 50000 + annee % 7 * 9000, 'Essence', 'Manuelle', type, 'Gris', 'Vendu', il + sejour, achat, vente, 400, { dateVente: jour(-il) }),
      il, vente, client,
    }));
    vehicules.push(...ventes.map(x => x.v));
    // Un véhicule en dépôt-vente, confié par un client.
    vehicules.push(v('Peugeot', '2008', '1.2 PureTech 130 GT Line', 2020, 46000, 'Essence', 'Automatique', 'SUV / 4x4', 'Gris', 'En stock', 25, '', 18900, 0,
      { mode: 'depot', vendeurId: C['Fontaine'], commissionType: 'pourcentage', commissionValeur: 8, commissionMin: 500, mandatDebut: jour(-25), mandatFin: jour(65) }));
    // Livre de police de la démo : chaque véhicule acheté a son vendeur et sa pièce d'identité.
    const pieces = ["Carte d'identité", 'Permis de conduire', 'Passeport'];
    vehicules.filter(x => !REPRISE.includes(x.statut)).forEach((x, i) => {
      if (!x.vendeurId) Object.assign(x, { vendeurId: clients[(i + 3) % clients.length].id, achatPaiement: i % 3 ? 'Virement' : 'Chèque',
        vendeurPieceType: pieces[i % 3], vendeurPieceNumero: (i * 7919 + 104729).toString(36).toUpperCase().padStart(9, 'X'),
        vendeurPieceDate: jour(-1500 - i * 90), vendeurPieceAutorite: 'Préfecture de La Réunion' });
      if (!x.immatriculation) x.immatriculation = `${'FGHJKL'[i % 6]}${'ABCDEF'[(i * 5) % 6]}-${String(100 + i * 37).slice(0, 3)}-RE`;
    });

    // Photos d'exemple et options principales (reprises sur l'offre).
    vehicules.forEach((x, i) => { x.image = illustration(x.type, x.couleur, i); });
    const OPTIONS = ['Climatisation automatique, GPS, Caméra de recul, Régulateur de vitesse, Apple CarPlay / Android Auto, Jantes alliage',
      'Climatisation, Bluetooth, Radar de recul, Vitres électriques, Écran tactile',
      'Climatisation, GPS, Barres de toit, Radar de recul, Attelage, Vitres arrière surteintées',
      'Climatisation automatique, Caméra de recul, Sièges chauffants, Aide au maintien de voie, Démarrage sans clé'];
    vehicules.forEach((x, i) => { if (x.statut !== 'Vendu') x.equipements = OPTIONS[i % OPTIONS.length]; });

    let seq = 0;
    const numero = () => 'CMD-' + String(++seq).padStart(4, '0');
    const packs = Param.get().packs.map(k => ({ id: k.id, nom: k.nom, montant: k.montant, coche: !!k.coche }));
    const montantPack = packs.filter(k => k.coche).reduce((s, k) => s + num(k.montant), 0);
    const commande = (vehicule, client, statut, date, extra = {}) => fiche({
      numero: numero(), vehiculeId: vehicule.id, clientId: C[client], statut, date,
      prixVente: vehicule.prixVente, remise: 300, montantPack, carteGrise: 313.76, prix: num(vehicule.prixVente) - 300 + montantPack + 313.76,
      pack: { items: packs, frais: false }, ...extra,
    });
    const commandes = [
      ...ventes.map(x => commande(x.v, x.client, 'Livrée', jour(-x.il - 6), { dateLivree: jour(-x.il) })),
      commande(vehicules[7], 'Hoarau', 'Commande', jour(-4), { dateLivraison: jour(3) }),
      commande(vehicules[0], 'Rivière', 'Offre', jour(-10)),
      commande(vehicules[3], 'Fontaine', 'Offre', jour(-1)),
    ];
    const offreAncienne = commandes[commandes.length - 2];
    const planning = [
      fiche({ type: 'Relance client', date: jour(-2), heure: '10:00', clientId: C['Rivière'], commandeId: offreAncienne.id, notes: 'Relancer pour la Clio', fait: false }),
      fiche({ type: 'Essai', date: jour(1), heure: '14:30', clientId: C['Boyer'], vehiculeId: vehicules[2].id, fait: false }),
      fiche({ type: 'Vente / livraison', date: jour(3), heure: '09:30', clientId: C['Hoarau'], vehiculeId: vehicules[7].id, fait: false }),
      fiche({ type: 'Expertise reprise', date: jour(2), heure: '11:00', clientId: C['Técher'], vehiculeId: vehicules[8].id, fait: false }),
      fiche({ type: 'Relance client', date: jour(1), heure: '16:00', clientId: C['Fontaine'], commandeId: commandes[commandes.length - 1].id, fait: false }),
    ];
    // Recherches de clients : l'une correspond au Duster en stock, l'autre attend une Clio.
    Object.assign(clients[0], { rechMarque: 'Dacia', rechBudget: 17000, rechKmMax: 80000 });
    Object.assign(clients[6], { rechMarque: 'Citroën', rechModele: 'C3', rechBudget: 11000 });
    // Préparation en cours sur la Polo.
    vehicules[6].prepa = [['Vidange et filtres', true, 180], ['Pneus', true, 360], ['Freins', false, 240], ['Contrôle technique', false, 78],
      ['Carrosserie', false, 300], ['Nettoyage intérieur', true, 60]].map(([nom, fait, montant], i) => ({ id: 'p' + i, nom, fait, montant }));
    vehicules[6].fraisReels = 600;
    // Tarif prépa des véhicules vendus il y a 11 mois : la vidange sert au prix de la révision proposée.
    ventes.filter(x => x.il > 300).forEach((x, i) => {
      x.v.prepa = [['Vidange et filtres', true, [140, 190, 125][i]], ['Nettoyage intérieur', true, 60]].map(([nom, fait, montant], j) => ({ id: 'r' + i + j, nom, fait, montant }));
    });
    clients[3].interets = [vehicules[2].id];
    clients[1].interets = [vehicules[7].id];

    setTimeout(completerPhotos, 1500);
    db.data.clients = clients;
    db.data.vehicules = vehicules;
    db.data.commandes = commandes;
    db.data.planning = planning;
    db.data.seq = seq;
    Param.save({ garage: { ...Param.get().garage, nom: 'Garage Démo', ville: 'Saint-Pierre', telephone: '0262 00 00 00' },
      reseau: { ...Param.get().reseau, actif: true, accepteLe: maintenant },
      revision: { ...(Param.get().revision || {}), cout: 120, margeType: 'pourcentage', margeValeur: 30 } });
  }

  return { remplir, completerPhotos, illustration };
})();
