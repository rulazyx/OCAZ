// Papiers du véhicule : livre de police, certificat de cession et déclaration d'achat pré-remplis,
// annonce prête à publier, documents rangés en ligne (carte grise, CT…) et messages WhatsApp.
const Papiers = (() => {
  const TYPES_PIECE = ['', "Carte d'identité", 'Passeport', 'Permis de conduire', 'Titre de séjour', 'Extrait Kbis (société)'];
  const PAIEMENTS_ACHAT = ['', 'Virement', 'Chèque', 'Espèces', 'Déduit d\'une vente (reprise)'];
  const TYPES_DOC = ['Carte grise', 'Contrôle technique', "Facture d'achat", "Carnet d'entretien", 'Certificat de cession', 'Autre'];
  const SITES = {
    leboncoin: ['Leboncoin', 'https://www.leboncoin.fr/deposer-une-annonce'],
    lacentrale: ['La Centrale', 'https://www.lacentrale.fr/'],
    facebook: ['Facebook Marketplace', 'https://www.facebook.com/marketplace/create/vehicle'],
    autoscout: ['AutoScout24', 'https://www.autoscout24.fr/'],
    site: ['Site / vitrine du garage', ''],
  };
  // Véhicules achetés par le garage : ils ont leur ligne dans le livre de police.
  const ACHETES = ['En préparation', 'En stock', 'Réservé', 'Vendu'];
  const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---------- WhatsApp ----------
  // Numéro au format international : La Réunion (0692, 0693, 0262, 0263) et Mayotte (0639) en +262, sinon +33.
  function telIntl(t) {
    const d = String(t || '').replace(/[^\d+]/g, '');
    if (d.startsWith('+')) return d.slice(1);
    if (d.startsWith('00')) return d.slice(2);
    if (/^0(69[23]|26[23]|639)/.test(d)) return '262' + d.slice(1);
    if (d.startsWith('0')) return '33' + d.slice(1);
    return d;
  }
  function messageClient(c) {
    const g = Param.get().garage;
    const offre = db.all('commandes').filter(o => o.clientId === c.id && o.statut === 'Offre').sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    const interet = (c.interets || []).map(id => db.get('vehicules', id)).find(v => v && DISPONIBLE.includes(v.statut));
    let m = `Bonjour ${c.prenom || clientNom(c)}, ${g.nom ? 'ici ' + g.nom + '. ' : ''}`;
    if (offre) m += `Je reviens vers vous au sujet de notre offre pour le véhicule ${vehiculeNom(db.get('vehicules', offre.vehiculeId))}. Avez-vous pu y réfléchir ?`;
    else if (interet) m += `Le véhicule ${vehiculeNom(interet)} qui vous intéressait est toujours disponible. Voulez-vous passer l'essayer ?`;
    return m;
  }
  const lienWhatsapp = (c, msg) => c?.telephone ? `https://wa.me/${telIntl(c.telephone)}?text=${encodeURIComponent(msg ?? messageClient(c))}` : '';

  // ---------- Fenêtre imprimable (ou à enregistrer en PDF) ----------
  function fenetre(titre, corps, style = '', opts = {}) {
    const w = window.open('', '_blank');
    if (!w) { toast("Autorise l'ouverture de fenêtres pour imprimer."); return; }
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(titre)}</title>
      <style>body{font:13px/1.45 Inter,Arial,sans-serif;color:#0d0f12;max-width:780px;margin:24px auto;padding:0 18px}
      h1{font-size:19px;margin:0 0 2px}h2{font-size:14px;margin:18px 0 6px;padding:5px 8px;background:#0d0f12;color:#fff;border-radius:4px}
      .muted{color:#6b6f76;font-size:12px}.cases{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px}
      .case{border-bottom:1px solid #9a9ea6;padding:3px 0;min-height:20px}.case b{display:block;font-size:10.5px;color:#4b4f56;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
      .plein{grid-column:1/-1}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}
      .signatures div{border:1px solid #9a9ea6;border-radius:6px;height:92px;padding:6px;font-size:11px;color:#4b4f56}
      .exemplaire{page-break-after:always;margin-bottom:28px}.exemplaire:last-child{page-break-after:auto}
      table{width:100%;border-collapse:collapse;font-size:11.5px}th,td{border:1px solid #c9cbd0;padding:4px 5px;text-align:left;vertical-align:top}
      th{background:#f1f5f9}.manque{color:#dc2626;font-style:italic}
      @media print{.noprint{display:none}body{margin:0 auto}}${style}</style></head><body>
      ${DocBarre.html(titre, opts)}<div id="doc">${corps}</div></body></html>`);
    w.document.close();
  }
  const caseHtml = (l, v, cls = '') => `<div class="case ${cls}"><b>${esc(l)}</b>${esc(v ?? '') || '&nbsp;'}</div>`;
  const adresse = x => [x?.adresse, [x?.codePostal, x?.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  // Identité d'une personne pour les formulaires : le garage, ou un client (particulier ou société).
  function personne(x, garage) {
    if (garage) return { morale: true, nom: x.nom, siret: x.siret, adresse: adresse(x) };
    if (!x) return {};
    return x.societe && !x.nom ? { morale: true, nom: x.societe, siret: x.siret || '', adresse: adresse(x) }
      : { morale: false, civilite: x.civilite || '', nom: x.nom || '', prenom: x.prenom || '', adresse: adresse(x) };
  }
  const blocPersonne = p => p.morale
    ? `<div class="cases">${caseHtml('Personne morale : raison sociale', p.nom, 'plein')}${caseHtml('N° SIRET', p.siret)}${caseHtml('', '')}${caseHtml('Adresse', p.adresse, 'plein')}</div>`
    : `<div class="cases">${caseHtml('Sexe', p.civilite === 'Mme' ? 'F' : p.civilite === 'M.' ? 'M' : '')}${caseHtml('Nom', p.nom)}${caseHtml('Prénom(s)', p.prenom, 'plein')}${caseHtml('Adresse', p.adresse, 'plein')}</div>`;
  const blocVehicule = v => `<div class="cases">
    ${caseHtml("N° d'immatriculation (A)", v.immatriculation)}${caseHtml('Date de 1re immatriculation (B)', dateFr(v.miseEnCirculation))}
    ${caseHtml("N° d'identification du véhicule (E)", v.vin, 'plein')}
    ${caseHtml('Marque (D.1)', v.marque)}${caseHtml('Type, variante, version (D.2)', v.ficheTechnique?.['Type variante version'] || '')}
    ${caseHtml('Dénomination commerciale (D.3)', [v.modele, v.finition].filter(Boolean).join(' '))}${caseHtml('Genre national (J.1)', v.type === 'Utilitaire' ? 'CTTE' : 'VP')}
    ${caseHtml('Kilométrage', km(v.kilometrage))}${caseHtml("Certificat d'immatriculation remis", 'Oui · n° de formule : ………………')}</div>`;

  // Certificat de cession (cerfa 15776*02) : sens « achat » (client → garage) ou « vente » (garage → client).
  function cession(v, sens) {
    const g = Param.get().garage;
    const cmd = commandeVente(v);
    const ancien = sens === 'achat' ? personne(db.get('clients', v.vendeurId)) : personne(g, true);
    const nouveau = sens === 'achat' ? personne(g, true) : personne(db.get('clients', cmd?.clientId));
    const date = sens === 'achat' ? (v.achatDate || today()) : (cmd?.dateLivree || cmd?.dateLivraison || today());
    const exemplaire = n => `<div class="exemplaire">
      <h1>Certificat de cession d'un véhicule d'occasion</h1>
      <span class="muted">Reprend les rubriques du cerfa n°15776*02 · Exemplaire n°${n} destiné ${n === 1 ? "à l'ancien propriétaire" : 'au nouveau propriétaire'}</span>
      <h2>Le véhicule</h2>${blocVehicule(v)}
      <h2>L'ancien propriétaire</h2>${blocPersonne(ancien)}
      <div class="cases" style="margin-top:6px">${caseHtml('Cède le véhicule le', dateFr(date))}${caseHtml('À (heure)', '…… h ……')}
        ${caseHtml('À titre', 'Onéreux')}${caseHtml('Destination', 'Cession (hors destruction)')}</div>
      <p class="muted">Certifie que ce véhicule n'a pas subi de transformation notable, et (pour un véhicule de plus de 4 ans) que le contrôle technique date de moins de 6 mois.</p>
      <h2>Le nouveau propriétaire</h2>${blocPersonne(nouveau)}
      <div class="cases" style="margin-top:6px">${caseHtml('Acquiert le véhicule le', dateFr(date))}${caseHtml('À (heure)', '…… h ……')}</div>
      <div class="signatures"><div>Signature de l'ancien propriétaire${ancien.morale ? ' et cachet' : ''}</div><div>Signature du nouveau propriétaire${nouveau.morale ? ' et cachet' : ''}</div></div></div>`;
    fenetre(`Certificat de cession · ${vehiculeNom(v)}`, exemplaire(1) + exemplaire(2));
  }

  // Déclaration d'achat d'un véhicule d'occasion par un professionnel (cerfa 13751*03).
  function declarationAchat(v) {
    const g = Param.get().garage;
    numeroter();
    v = db.get('vehicules', v.id);
    fenetre(`Déclaration d'achat · ${vehiculeNom(v)}`, `
      <h1>Déclaration d'achat d'un véhicule d'occasion</h1>
      <span class="muted">Reprend les rubriques du cerfa n°13751*03 · à remplir par le professionnel de l'automobile</span>
      <h2>Le professionnel acheteur</h2>${blocPersonne(personne(g, true))}
      <div class="cases" style="margin-top:6px">${caseHtml('Déclare avoir acheté le', dateFr(v.achatDate || v.dateEntree || today()))}${caseHtml('À (heure)', '…… h ……')}
        ${caseHtml("N° d'inscription au livre de police", v.policeNumero)}${caseHtml('Prix', euros(v.prixAchat))}</div>
      <h2>Le véhicule</h2>${blocVehicule(v)}
      <h2>Le vendeur</h2>${blocPersonne(personne(db.get('clients', v.vendeurId)))}
      <div class="cases" style="margin-top:6px">${caseHtml("Pièce d'identité", [v.vendeurPieceType, v.vendeurPieceNumero].filter(Boolean).join(' n° '))}
        ${caseHtml('Délivrée le / par', [dateFr(v.vendeurPieceDate), v.vendeurPieceAutorite].filter(Boolean).join(' · '))}</div>
      <div class="signatures"><div>Fait à ${esc(g.ville || '……………')}, le ${dateFr(today())}</div><div>Signature et cachet du professionnel</div></div>`);
  }

  // ---------- Livre de police ----------
  const dateAchat = v => v.achatDate || v.dateEntree || (v.creeLe || '').slice(0, 10);
  const commandeVente = v => db.all('commandes').filter(o => o.vehiculeId === v.id && o.statut !== 'Annulée' && o.statut !== 'Offre')
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  // Chaque véhicule acheté reçoit le numéro suivant (dans l'ordre des dates d'achat pour les plus anciens).
  function numeroter() {
    const tous = db.all('vehicules');
    let max = Math.max(0, ...tous.map(v => num(v.policeNumero)));
    tous.filter(v => ACHETES.includes(v.statut) && !v.policeNumero)
      .sort((a, b) => dateAchat(a).localeCompare(dateAchat(b)))
      .forEach(v => db.upsert('vehicules', { id: v.id, policeNumero: ++max }));
  }
  function lignesPolice() {
    numeroter();
    return db.all('vehicules').filter(v => v.policeNumero).sort((a, b) => num(a.policeNumero) - num(b.policeNumero)).map(v => {
      const c = db.get('clients', v.vendeurId);
      const cmd = v.statut === 'Vendu' ? commandeVente(v) : null;
      const acheteur = cmd ? db.get('clients', cmd.clientId) : null;
      const depot = v.mode === 'depot';
      const manque = [!c && 'vendeur', !v.vendeurPieceNumero && "pièce d'identité", !depot && !num(v.prixAchat) && "prix d'achat", !v.immatriculation && !v.vin && 'plaque ou VIN'].filter(Boolean);
      return {
        v, numero: v.policeNumero, date: dateAchat(v),
        vehicule: [vehiculeNom(v), v.couleur].filter(Boolean).join(' · '), immat: v.immatriculation || '', vin: v.vin || '',
        vendeur: c ? clientNom(c) : '', adresseVendeur: adresse(c),
        piece: [v.vendeurPieceType, v.vendeurPieceNumero].filter(Boolean).join(' n° '),
        pieceDetail: [v.vendeurPieceDate ? 'du ' + dateFr(v.vendeurPieceDate) : '', v.vendeurPieceAutorite].filter(Boolean).join(', '),
        prix: depot ? Depot.net(v) : num(v.prixAchat), paiement: depot ? 'Dépôt-vente (net vendeur)' : v.achatPaiement || '',
        sortie: v.statut === 'Vendu' ? (v.dateVente || cmd?.dateLivree || '') : '', acheteur: acheteur ? clientNom(acheteur) : '',
        manque,
      };
    });
  }
  let anneePolice = String(new Date().getFullYear());
  function ouvrirPolice() {
    rendrePolice();
    $('#dlg-police').showModal();
  }
  function rendrePolice() {
    const toutes = lignesPolice();
    const annees = [...new Set(toutes.map(l => l.date.slice(0, 4)).filter(Boolean))].sort().reverse();
    if (!annees.includes(anneePolice)) anneePolice = annees[0] || anneePolice;
    const lignes = toutes.filter(l => anneePolice === 'tout' || l.date.startsWith(anneePolice));
    const aCompleter = lignes.filter(l => l.manque.length).length;
    $('#police-body').innerHTML = `
      <p class="hint">Rempli tout seul : chaque reprise validée crée sa ligne d'entrée, chaque vente livrée complète la sortie.
        Clique sur une ligne pour compléter la fiche du véhicule.</p>
      <div class="chips">${annees.map(a => `<button type="button" class="chip${a === anneePolice ? ' active' : ''}" data-annee="${a}">${a}</button>`).join('')}
        <button type="button" class="chip${anneePolice === 'tout' ? ' active' : ''}" data-annee="tout">Tout</button></div>
      ${aCompleter ? `<p class="police-alerte">⚠ ${aCompleter} ligne(s) à compléter (vendeur, pièce d'identité, prix ou plaque).</p>` : lignes.length ? '<p class="ok-vide">✓ Toutes les lignes sont complètes.</p>' : ''}
      ${lignes.length ? `<div class="police-table"><table><thead><tr><th>N°</th><th>Achat</th><th>Véhicule</th><th>Vendeur</th><th>Pièce d'identité</th><th>Prix</th><th>Sortie</th></tr></thead><tbody>
        ${lignes.map(l => `<tr data-vehicule="${l.v.id}" class="${l.manque.length ? 'incomplet' : ''}"><td><b>${l.numero}</b></td><td>${dateFr(l.date)}<small>${esc(l.paiement)}</small></td>
          <td>${esc(l.vehicule)}<small>${esc([l.immat, l.vin].filter(Boolean).join(' · '))}</small></td>
          <td>${esc(l.vendeur) || '<em>à compléter</em>'}<small>${esc(l.adresseVendeur)}</small></td>
          <td>${esc(l.piece) || '<em>à compléter</em>'}<small>${esc(l.pieceDetail)}</small></td>
          <td>${l.prix ? euros(l.prix) : '<em>?</em>'}</td>
          <td>${l.sortie ? dateFr(l.sortie) : ''}<small>${esc(l.acheteur)}</small></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="hint">Aucun véhicule acheté sur cette période.</p>'}`;
    return lignes;
  }
  function imprimerPolice() {
    const lignes = rendrePolice();
    const g = Param.get().garage;
    fenetre(`Livre de police ${anneePolice}`, `<h1>Registre des objets mobiliers (livre de police)</h1>
      <span class="muted">${esc(g.nom || '')}${g.siret ? ' · SIRET ' + esc(g.siret) : ''} · ${esc(adresse(g))} · ${anneePolice === 'tout' ? 'toutes les années' : 'année ' + anneePolice} · édité le ${dateFr(today())}</span>
      <table style="margin-top:12px"><thead><tr><th>N°</th><th>Date d'achat</th><th>Désignation du véhicule</th><th>Immatriculation / VIN</th><th>Vendeur (nom, adresse)</th><th>Pièce d'identité</th><th>Prix d'achat · paiement</th><th>Date de revente · acquéreur</th></tr></thead>
      <tbody>${lignes.map(l => `<tr><td>${l.numero}</td><td>${dateFr(l.date)}</td><td>${esc(l.vehicule)}</td><td>${esc(l.immat)}<br>${esc(l.vin)}</td>
        <td>${esc(l.vendeur) || '<span class="manque">à compléter</span>'}<br>${esc(l.adresseVendeur)}</td><td>${esc(l.piece) || '<span class="manque">à compléter</span>'}<br>${esc(l.pieceDetail)}</td>
        <td>${l.prix ? euros(l.prix) : ''}<br>${esc(l.paiement)}</td><td>${l.sortie ? dateFr(l.sortie) : ''}<br>${esc(l.acheteur)}</td></tr>`).join('')}</tbody></table>`,
      '@page{size:A4 landscape}body{max-width:none}');
  }
  function exporterPolice() {
    const lignes = rendrePolice();
    const cel = x => '"' + String(x ?? '').replace(/"/g, '""') + '"';
    const csv = [['N°', "Date d'achat", 'Véhicule', 'Immatriculation', 'VIN', 'Vendeur', 'Adresse du vendeur', "Pièce d'identité", 'Délivrance', "Prix d'achat", 'Paiement', 'Date de revente', 'Acquéreur']]
      .concat(lignes.map(l => [l.numero, dateFr(l.date), l.vehicule, l.immat, l.vin, l.vendeur, l.adresseVendeur, l.piece, l.pieceDetail, l.prix || '', l.paiement, l.sortie ? dateFr(l.sortie) : '', l.acheteur]))
      .map(r => r.map(cel).join(';')).join('\r\n');
    telecharger('﻿' + csv, `livre-de-police-${anneePolice}.csv`, 'text/csv');
  }
  function telecharger(contenu, nom, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(contenu instanceof Blob ? contenu : new Blob([contenu], { type }));
    a.download = nom;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Annonce prête à publier ----------
  let annonceId = null;
  function texteAnnonce(v) {
    const g = Param.get().garage;
    const mec = v.miseEnCirculation ? ` (1re mise en circulation ${new Date(v.miseEnCirculation).toLocaleDateString('fr-FR', { month: '2-digit', year: 'numeric' })})` : '';
    const lignes = [
      `${vehiculeNom(v)}`,
      '',
      v.annee && `• Année : ${v.annee}${mec}`,
      v.kilometrage && `• Kilométrage : ${km(v.kilometrage)}`,
      (v.carburant || v.boite) && `• ${[v.carburant, v.boite && 'boîte ' + v.boite.toLowerCase()].filter(Boolean).join(', ')}`,
      (v.puissanceCh || v.puissanceFiscale) && `• Puissance : ${[v.puissanceCh && v.puissanceCh + ' ch', v.puissanceFiscale && v.puissanceFiscale + ' CV fiscaux'].filter(Boolean).join(' · ')}`,
      (v.couleur || v.portes || v.places) && `• ${[v.couleur && 'Couleur ' + v.couleur.toLowerCase(), v.portes && v.portes + ' portes', v.places && v.places + ' places'].filter(Boolean).join(' · ')}`,
      '',
      'Véhicule contrôlé et préparé par nos soins. Reprise de votre véhicule possible.',
      v.prixVente && `Prix : ${euros(v.prixVente)}`,
      '',
      [g.nom, g.ville].filter(Boolean).join(' · '),
      g.telephone && `Tél. ${g.telephone}`,
    ];
    return lignes.filter(x => x !== false && x !== undefined && x !== null && x !== 0).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  const titreAnnonce = v => [v.marque, v.modele, v.finition, v.annee, v.kilometrage ? km(v.kilometrage) : ''].filter(Boolean).join(' ').slice(0, 100);
  function ouvrirAnnonce(id) {
    annonceId = id;
    const v = db.get('vehicules', id);
    const a = v.annonce || {};
    const pub = v.annonces || {};
    const vendu = v.statut === 'Vendu';
    $('#annonce-titre').textContent = 'Annonce · ' + vehiculeNom(v);
    $('#annonce-body').innerHTML = `
      <div class="field"><label for="an-titre">Titre</label><div class="inline"><input id="an-titre" value="${esc(a.titre || titreAnnonce(v))}" maxlength="100">
        <button type="button" class="chip" data-copier="an-titre">Copier</button></div></div>
      <div class="field"><label for="an-texte">Texte</label><textarea id="an-texte" rows="14">${esc(a.texte || texteAnnonce(v))}</textarea>
        <div class="inline"><button type="button" class="chip" data-copier="an-texte">Copier le texte</button>
        <button type="button" class="chip" id="an-regen">Régénérer depuis la fiche</button></div></div>
      <div class="field"><label>Photos (${(v.photos || []).length})</label>
        ${(v.photos || []).length ? `<button type="button" id="an-photos">${navigator.canShare ? 'Partager / enregistrer les photos' : 'Télécharger les photos'}</button>`
          : '<span class="hint">Pas encore de photos : elles se prennent depuis le téléphone quand le véhicule est en préparation.</span>'}</div>
      <h3 class="section">${vendu ? 'Annonces à retirer' : 'Où est-elle publiée ?'}</h3>
      <p class="hint">${vendu ? 'Le véhicule est vendu : retire ses annonces, puis coche « retirée ».' : 'Coche les sites où tu as publié : quand le véhicule sera vendu, Ocaz te rappellera de retirer les annonces.'}</p>
      <div class="an-sites">${Object.entries(SITES).map(([k, [nom, url]]) => {
        const p = pub[k] || {};
        return `<div class="an-site"><label class="check"><input type="checkbox" data-site="${k}"${p.le ? ' checked' : ''}><span>${nom}${p.le ? `<small>publiée le ${dateFr(p.le)}</small>` : ''}</span></label>
          ${p.le ? `<label class="check"><input type="checkbox" data-retire="${k}"${p.retire ? ' checked' : ''}><span>retirée</span></label>` : url ? `<a class="chip" href="${url}" target="_blank" rel="noopener">Ouvrir</a>` : ''}</div>`;
      }).join('')}</div>`;
    $('#dlg-annonce').showModal();
  }
  function enregistrerAnnonce() {
    const v = db.get('vehicules', annonceId);
    const annonces = { ...(v.annonces || {}) };
    document.querySelectorAll('#annonce-body [data-site]').forEach(i => {
      const k = i.dataset.site;
      if (i.checked) annonces[k] = { le: annonces[k]?.le || today(), retire: !!document.querySelector(`#annonce-body [data-retire="${k}"]`)?.checked };
      else delete annonces[k];
    });
    db.upsert('vehicules', { id: v.id, annonce: { titre: $('#an-titre').value.trim(), texte: $('#an-texte').value }, annonces });
  }
  async function photosAnnonce() {
    const v = db.get('vehicules', annonceId);
    if (!Sync.role) { toast('Connecte-toi pour récupérer les photos.'); return; }
    const btn = $('#an-photos');
    btn.disabled = true; btn.textContent = 'Préparation…';
    try {
      const { data } = await Sync.client.storage.from('photos').createSignedUrls(v.photos, 600);
      const fichiers = await Promise.all((data || []).filter(d => d.signedUrl).map(async (d, i) => {
        const b = await (await fetch(d.signedUrl)).blob();
        return new File([b], `${titreAnnonce(v).replace(/[^\w-]+/g, '-').slice(0, 40)}-${i + 1}.jpg`, { type: 'image/jpeg' });
      }));
      // Sur téléphone : feuille de partage (Leboncoin, Facebook, enregistrer dans Photos…). Sinon : téléchargement.
      if (navigator.canShare?.({ files: fichiers })) await navigator.share({ files: fichiers, title: titreAnnonce(v) });
      else fichiers.forEach((f, i) => setTimeout(() => telecharger(f, f.name), i * 300));
    } catch (err) {
      if (err.name !== 'AbortError') toast('Photos indisponibles : ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = navigator.canShare ? 'Partager / enregistrer les photos' : 'Télécharger les photos';
    }
  }
  // Véhicule vendu : rappel de retirer les annonces encore en ligne.
  function rappelRetrait(v) {
    const enLigne = Object.entries(v.annonces || {}).filter(([, p]) => p.le && !p.retire).map(([k]) => SITES[k]?.[0] || k);
    if (!enLigne.length) return;
    if (db.all('planning').some(r => r.vehiculeId === v.id && r.retraitAnnonces && !r.fait)) return;
    db.upsert('planning', { type: 'Autre', date: today(), heure: '', vehiculeId: v.id, retraitAnnonces: true, fait: false,
      notes: `Retirer les annonces de ${vehiculeNom(v)} : ${enLigne.join(', ')}` });
    toast(`Véhicule vendu : pense à retirer ses annonces (${enLigne.join(', ')})`);
  }

  // ---------- Section « Papiers et annonce » de la fiche véhicule ----------
  function section(v) {
    if (!v?.id) return '';
    const vente = commandeVente(v);
    const achete = ACHETES.includes(v.statut);
    return `<h3 class="section">Papiers et annonce</h3>
      <div class="field full"><div class="chips papiers">
        ${DISPONIBLE.includes(v.statut) || v.statut === 'Réservé' || v.statut === 'Vendu' ? `<button type="button" class="chip" data-papier="annonce" data-vid="${v.id}">📣 Annonce</button>` : ''}
        ${v.vendeurId ? `<button type="button" class="chip" data-papier="cession-achat" data-vid="${v.id}">Certificat de cession (achat)</button>` : ''}
        ${achete ? `<button type="button" class="chip" data-papier="declaration" data-vid="${v.id}">Déclaration d'achat</button>` : ''}
        ${vente ? `<button type="button" class="chip" data-papier="cession-vente" data-vid="${v.id}">Certificat de cession (vente)</button>` : ''}
        ${achete ? `<button type="button" class="chip" data-papier="police" data-vid="${v.id}">📖 Livre de police${v.policeNumero ? ' n°' + v.policeNumero : ''}</button>` : ''}
      </div></div>
      <div class="field full"><label>Documents du véhicule</label><div class="v-docs" data-docs="${v.id}">${listeDocs(v)}</div>
        <div class="inline doc-ajout${Sync.role ? '' : ' desactive'}"><select class="v-doc-type" aria-label="Type de document">${TYPES_DOC.map(t => `<option>${t}</option>`).join('')}</select>
        <label class="button">+ Ajouter<input type="file" class="v-doc-input" data-vid="${v.id}" accept="application/pdf,image/*" hidden></label></div>
        <span class="hint">${Sync.role ? 'Carte grise, CT, factures… PDF ou photo, 10 Mo maximum, visibles par ton équipe.' : 'Connecte-toi pour ranger des documents.'}</span></div>`;
  }
  const listeDocs = v => (v.documents || []).length ? v.documents.map(d => `<div class="doc-ligne"><span class="badge b-blue">${esc(d.type)}</span>
      <span class="doc-nom">${esc(d.nom)}<small>${dateFr(d.date)}</small></span>
      <button type="button" class="chip" data-vdoc-ouvrir="${esc(d.id)}" data-vid="${v.id}">Ouvrir</button>
      <button type="button" class="chip" data-vdoc-suppr="${esc(d.id)}" data-vid="${v.id}" aria-label="Supprimer">✕</button></div>`).join('')
    : '<span class="hint">Aucun document.</span>';
  const majDocs = id => document.querySelectorAll(`[data-docs="${id}"]`).forEach(el => { el.innerHTML = listeDocs(db.get('vehicules', id)); });

  async function ouvrirFichier(chemin) {
    if (!Sync.role) { toast('Connecte-toi pour ouvrir les documents.'); return; }
    const w = window.open('', '_blank');
    const { data, error } = await Sync.client.storage.from('documents').createSignedUrl(chemin, 300);
    if (error || !data) { w?.close(); toast('Document introuvable.'); return; }
    if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
  }

  // Champs « achat » de la reprise (livre de police), repris du client s'il a déjà fourni sa pièce.
  function champsAchat(etat) {
    const c = db.get('clients', etat.vendeurId) || {};
    const val = (k, ck) => etat[k] ?? c[ck] ?? '';
    const sel = (k, l, opts, v) => `<div class="field"><label for="r-${k}">${l}</label><select id="r-${k}" data-r="${k}">${opts.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
    const inp = (k, l, v, type = 'text') => `<div class="field"><label for="r-${k}">${l}</label><input id="r-${k}" data-r="${k}" type="${type}" value="${esc(v)}"></div>`;
    const depot = etat.mode === 'depot';
    return `<h3 class="section">${depot ? 'Dépôt' : 'Achat'} · livre de police</h3>
      <p class="hint">Obligatoire pour le livre de police : pièce d'identité du ${depot ? 'déposant' : 'vendeur'}${depot ? '' : ' et mode de paiement'}.${etat.vendeurId ? '' : ` Choisis d'abord le ${depot ? 'propriétaire' : 'vendeur'} (bouton Modifier en haut).`}</p>
      <div class="grid">
        ${inp('achatDate', depot ? 'Date du dépôt' : "Date d'achat", etat.achatDate || today(), 'date')}${depot ? '' : sel('achatPaiement', 'Paiement du vendeur', PAIEMENTS_ACHAT, etat.achatPaiement || '')}
        ${sel('vendeurPieceType', "Pièce d'identité", TYPES_PIECE, val('vendeurPieceType', 'pieceType'))}${inp('vendeurPieceNumero', 'Numéro de la pièce', val('vendeurPieceNumero', 'pieceNumero'))}
        ${inp('vendeurPieceDate', 'Délivrée le', val('vendeurPieceDate', 'pieceDate'), 'date')}${inp('vendeurPieceAutorite', 'Délivrée par (préfecture, mairie…)', val('vendeurPieceAutorite', 'pieceAutorite'))}
      </div>`;
  }
  // Reprise validée : numéro au livre de police, et pièce d'identité gardée sur la fiche du client.
  function apresAchat(v) {
    numeroter();
    if (v.vendeurId && v.vendeurPieceNumero) db.upsert('clients', { id: v.vendeurId, pieceType: v.vendeurPieceType || '', pieceNumero: v.vendeurPieceNumero,
      pieceDate: v.vendeurPieceDate || '', pieceAutorite: v.vendeurPieceAutorite || '' });
  }

  function init() {
    document.addEventListener('click', async e => {
      const b = e.target.closest('[data-papier]');
      if (b) {
        const v = db.get('vehicules', b.dataset.vid);
        if (!v) return;
        const p = b.dataset.papier;
        if (p === 'annonce') ouvrirAnnonce(v.id);
        else if (p === 'cession-achat') cession(v, 'achat');
        else if (p === 'cession-vente') cession(v, 'vente');
        else if (p === 'declaration') declarationAchat(v);
        else if (p === 'police') ouvrirPolice();
        return;
      }
      const o = e.target.dataset.vdocOuvrir, s = e.target.dataset.vdocSuppr;
      if (o || s) {
        const v = db.get('vehicules', e.target.dataset.vid);
        const d = (v?.documents || []).find(x => x.id === (o || s));
        if (!d) return;
        if (o) { ouvrirFichier(d.chemin); return; }
        if (!confirm(`Supprimer « ${d.nom} » ?`)) return;
        if (Sync.role) await Sync.client.storage.from('documents').remove([d.chemin]);
        db.upsert('vehicules', { id: v.id, documents: v.documents.filter(x => x.id !== d.id) });
        majDocs(v.id);
      }
    });
    document.addEventListener('change', async e => {
      if (!e.target.classList.contains('v-doc-input')) return;
      const f = e.target.files[0];
      const vid = e.target.dataset.vid;
      const type = e.target.closest('.doc-ajout').querySelector('.v-doc-type').value;
      e.target.value = '';
      if (!f || !Sync.role) return;
      if (f.size > 10 * 1024 * 1024) { toast('Fichier trop lourd (10 Mo maximum).'); return; }
      const id = nouvelId();
      const ext = (f.name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
      const chemin = `${Sync.entreprise.id}/vehicules/${vid}/${id}${ext}`;
      toast('Envoi du document…');
      const { error } = await Sync.client.storage.from('documents').upload(chemin, f, { contentType: f.type });
      if (error) { toast('Document non envoyé : ' + error.message); return; }
      const v = db.get('vehicules', vid);
      db.upsert('vehicules', { id: vid, documents: (v.documents || []).concat({ id, type, nom: f.name, chemin, date: today() }) });
      majDocs(vid);
      toast('Document ajouté');
    });

    // Livre de police.
    $('#police-body').addEventListener('click', e => {
      const a = e.target.closest('[data-annee]');
      if (a) { anneePolice = a.dataset.annee; rendrePolice(); return; }
      const l = e.target.closest('tr[data-vehicule]');
      if (l) { $('#dlg-police').close(); switchTab('stock'); openForm(l.dataset.vehicule); }
    });
    $('#police-fermer').addEventListener('click', () => $('#dlg-police').close());
    $('#police-imprimer').addEventListener('click', imprimerPolice);
    $('#police-exporter').addEventListener('click', exporterPolice);

    // Annonce.
    $('#annonce-body').addEventListener('click', async e => {
      const c = e.target.dataset.copier;
      if (c) {
        try { await navigator.clipboard.writeText($('#' + c).value); toast('Copié : colle-le sur le site'); }
        catch (err) { $('#' + c).select(); toast('Sélectionné : copie-le avec Ctrl+C'); }
        return;
      }
      if (e.target.id === 'an-regen') { const v = db.get('vehicules', annonceId); $('#an-titre').value = titreAnnonce(v); $('#an-texte').value = texteAnnonce(v); return; }
      if (e.target.id === 'an-photos') photosAnnonce();
    });
    $('#annonce-body').addEventListener('change', e => {
      if (e.target.dataset.site && e.target.checked) { enregistrerAnnonce(); ouvrirAnnonce(annonceId); }
    });
    $('#annonce-fermer').addEventListener('click', () => $('#dlg-annonce').close());
    $('#annonce-ok').addEventListener('click', () => { enregistrerAnnonce(); $('#dlg-annonce').close(); toast('Annonce enregistrée'); render(); });
  }

  return { init, section, champsAchat, apresAchat, numeroter, ouvrirPolice, imprimerPolice, exporterPolice, lignesPolice, rappelRetrait, lienWhatsapp, messageClient, telIntl, fenetre, telecharger, TYPES_PIECE, PAIEMENTS_ACHAT };
})();
