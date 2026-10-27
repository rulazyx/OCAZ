// Dépôt-vente : le garage vend le véhicule d'un propriétaire sous mandat, garde une commission et lui reverse le reste.
// Parcours : mandat (prix, commission, durée) → en stock → vendu → reversement au propriétaire.
const Depot = (() => {
  const TYPES = {
    pourcentage: '% du prix de vente (avec un minimum)',
    forfait: 'Forfait fixe',
    net: 'Net vendeur garanti (le garage garde la différence)',
  };
  const reglages = () => Param.get().activite;
  const est = v => v?.mode === 'depot';
  const val = (v, k) => v[k] === undefined || v[k] === '' ? reglages()[k] : v[k];

  function commission(v, prix = num(v.prixVente)) {
    const t = val(v, 'commissionType');
    if (t === 'forfait') return num(val(v, 'commissionValeur'));
    if (t === 'net') return Math.max(0, prix - num(v.prixNetVendeur));
    return Math.max(num(val(v, 'commissionMin')), Math.round(prix * num(val(v, 'commissionValeur')) / 100));
  }
  const net = (v, prix = num(v.prixVente)) => Math.max(0, prix - commission(v, prix));
  const finMandat = v => {
    if (v.mandatFin) return v.mandatFin;
    const d = new Date((v.mandatDebut || today()) + 'T12:00');
    d.setDate(d.getDate() + num(val(v, 'dureeMandat')));
    return isoLocal(d);
  };

  // Page 2 de la reprise quand c'est un dépôt : le mandat.
  function page2(v) {
    const champ = (k, l, type = 'number', defaut = '') => `<div class="field"><label for="r-${k}">${l}</label>
      <input id="r-${k}" data-r="${k}" type="${type}"${type === 'number' ? ' inputmode="decimal"' : ''} value="${esc(v[k] ?? defaut)}"></div>`;
    const t = val(v, 'commissionType');
    return `<h3 class="section">Mandat de dépôt-vente</h3>
      <p class="hint">Le véhicule reste la propriété du déposant jusqu'à la vente. Il n'est pas acheté : pas de prix de reprise.</p>
      <div class="grid">
        ${champ('prixVente', 'Prix de vente affiché (€)')}
        <div class="field"><label for="r-commissionType">Commission</label><select id="r-commissionType" data-r="commissionType">
          ${Object.entries(TYPES).map(([k, l]) => `<option value="${k}"${k === t ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        ${t === 'net' ? champ('prixNetVendeur', 'Net vendeur garanti (€)')
          : t === 'forfait' ? champ('commissionValeur', 'Forfait (€)', 'number', reglages().commissionValeur)
          : champ('commissionValeur', 'Commission (%)', 'number', reglages().commissionValeur) + champ('commissionMin', 'Minimum (€)', 'number', reglages().commissionMin)}
        ${champ('mandatDebut', 'Début du mandat', 'date', today())}
        ${champ('dureeMandat', 'Durée du mandat (jours)', 'number', reglages().dureeMandat)}
      </div>
      <div class="r-fourchette" id="depot-resume">${resume(v)}</div>`;
  }
  function resume(v) {
    const p = num(v.prixVente);
    if (!p) return '<span class="hint">Saisis le prix de vente pour voir la commission et le net vendeur.</span>';
    return `<div><span>Si vendu ${euros(p)}</span><strong>Commission ${euros(commission(v, p))} · reversé ${euros(net(v, p))}</strong></div>
      <span class="hint">Fin du mandat le ${dateFr(finMandat(v))}</span>`;
  }

  // Mandat imprimable, signé par le déposant et le garage.
  function mandat(v) {
    const g = Param.get().garage;
    const c = db.get('clients', v.vendeurId) || {};
    const t = val(v, 'commissionType');
    const regle = t === 'forfait' ? `un forfait de ${euros(val(v, 'commissionValeur'))}`
      : t === 'net' ? `la différence entre le prix de vente obtenu et le net vendeur garanti de ${euros(v.prixNetVendeur)}`
      : `${val(v, 'commissionValeur')} % du prix de vente obtenu, avec un minimum de ${euros(val(v, 'commissionMin'))}`;
    const cs = (l, x) => `<div class="case"><b>${l}</b>${esc(x ?? '') || '&nbsp;'}</div>`;
    Papiers.fenetre(`Mandat de dépôt-vente · ${vehiculeNom(v)}`, `
      <h1>Mandat de dépôt-vente d'un véhicule</h1><span class="muted">${v.policeNumero ? 'Livre de police n°' + v.policeNumero + ' · ' : ''}établi le ${dateFr(v.mandatDebut || today())}</span>
      <h2>Le déposant (propriétaire)</h2><div class="cases">${cs('Nom', clientNom(c))}${cs('Téléphone', c.telephone)}
        ${cs('Adresse', [c.adresse, c.codePostal, c.ville].filter(Boolean).join(' '))}${cs("Pièce d'identité", [v.vendeurPieceType, v.vendeurPieceNumero].filter(Boolean).join(' n° '))}</div>
      <h2>Le dépositaire (garage)</h2><div class="cases">${cs('Raison sociale', g.nom)}${cs('SIRET', g.siret)}${cs('Adresse', [g.adresse, g.codePostal, g.ville].filter(Boolean).join(' '))}${cs('Téléphone', g.telephone)}</div>
      <h2>Le véhicule</h2><div class="cases">${cs('Véhicule', vehiculeNom(v))}${cs('Immatriculation', v.immatriculation)}${cs('VIN', v.vin)}
        ${cs('Kilométrage au dépôt', km(v.kilometrage))}${cs('Année', v.annee)}${cs('Carburant / boîte', [v.carburant, v.boite].filter(Boolean).join(' · '))}</div>
      <h2>Conditions</h2>
      <p>Le déposant confie au dépositaire la vente du véhicule ci-dessus au prix de <b>${euros(v.prixVente)}</b>, qu'il peut négocier dans la limite convenue entre les parties.
        La rémunération du dépositaire est de <b>${regle}</b>. Le solde est reversé au déposant dans les 15 jours suivant l'encaissement complet du prix.</p>
      <p>Mandat consenti du <b>${dateFr(v.mandatDebut || today())}</b> au <b>${dateFr(finMandat(v))}</b>. À son terme, le déposant peut le renouveler ou reprendre son véhicule.
        Le déposant certifie être propriétaire du véhicule, qu'il n'est ni gagé ni volé, et remet le certificat d'immatriculation, le contrôle technique et les clés.
        Le véhicule reste assuré par ${esc(g.nom || 'le dépositaire')} pendant sa présence au garage.</p>
      <div class="signatures"><div>Le déposant : « Lu et approuvé », date et signature</div><div>Le dépositaire : cachet et signature</div></div>`);
  }

  // Vente livrée : calcul du reversement et rappel dans le planning.
  function apresVente(v, o) {
    if (!est(v) || v.reversement) return;
    const prix = num(o?.prixVente || v.prixVente) - num(o?.remise);
    const r = { prixVendu: prix, commission: commission(v, prix), montant: net(v, prix), du: today(), fait: false };
    db.upsert('vehicules', { id: v.id, reversement: r });
    const c = db.get('clients', v.vendeurId);
    db.upsert('planning', { type: 'Autre', date: today(), heure: '', clientId: v.vendeurId || '', vehiculeId: v.id, fait: false,
      notes: `Reverser ${euros(r.montant)} à ${c ? clientNom(c) : 'au déposant'} (dépôt-vente, commission ${euros(r.commission)})` });
    toast(`Dépôt-vente vendu : ${euros(r.montant)} à reverser au propriétaire`);
  }
  function releve(v) {
    const r = v.reversement;
    const c = db.get('clients', v.vendeurId) || {};
    Papiers.fenetre(`Relevé de dépôt-vente · ${vehiculeNom(v)}`, `<h1>Relevé de vente en dépôt-vente</h1>
      <span class="muted">${esc(Param.get().garage.nom || '')} · ${dateFr(today())}</span>
      <h2>Déposant</h2><p>${esc(clientNom(c))}<br>${esc([c.adresse, c.codePostal, c.ville].filter(Boolean).join(' '))}</p>
      <h2>Véhicule</h2><p>${esc(vehiculeNom(v))} · ${esc(v.immatriculation || '')}</p>
      <table><tr><td>Prix de vente obtenu</td><td style="text-align:right">${euros(r.prixVendu)}</td></tr>
        <tr><td>Commission du dépositaire</td><td style="text-align:right">− ${euros(r.commission)}</td></tr>
        <tr><th>Montant reversé au déposant</th><th style="text-align:right">${euros(r.montant)}</th></tr></table>
      <p class="muted">${r.fait ? `Reversé le ${dateFr(r.le)}${r.moyen ? ' par ' + esc(r.moyen) : ''}.` : 'Reversement à effectuer.'}</p>
      <div class="signatures"><div>Le déposant</div><div>Le dépositaire</div></div>`);
  }

  // Rubrique de la fiche véhicule.
  function section(v) {
    if (!est(v) || !v.id) return '';
    const c = db.get('clients', v.vendeurId);
    const fin = finMandat(v);
    const expire = v.statut !== 'Vendu' && fin < today();
    const r = v.reversement;
    return `<h3 class="section">Dépôt-vente</h3>
      <div class="field full depot-info">
        <span>Propriétaire : <b>${c ? esc(clientNom(c)) : 'non renseigné'}</b> · commission ${euros(commission(v))} si vendu ${euros(v.prixVente) || '?'}, reversé ${euros(net(v))}</span>
        <span class="${expire ? 'alerte' : 'hint'}">Mandat du ${dateFr(v.mandatDebut)} au ${dateFr(fin)}${expire ? ' · expiré : à renouveler ou à rendre' : ''}</span>
        ${r ? `<span class="${r.fait ? 'ok' : 'alerte'}">${r.fait ? `✓ ${euros(r.montant)} reversés le ${dateFr(r.le)}` : `À reverser : ${euros(r.montant)} (vendu ${euros(r.prixVendu)}, commission ${euros(r.commission)})`}</span>` : ''}
        <div class="chips papiers"><button type="button" class="chip" data-depot="mandat" data-vid="${v.id}">Mandat de dépôt-vente</button>
          ${expire ? `<button type="button" class="chip" data-depot="prolonger" data-vid="${v.id}">Prolonger de ${reglages().dureeMandat} jours</button>` : ''}
          ${r ? `<button type="button" class="chip" data-depot="releve" data-vid="${v.id}">Relevé de vente</button>` : ''}
          ${r && !r.fait ? `<button type="button" class="chip" data-depot="reverse" data-vid="${v.id}">✓ Reversement effectué</button>` : ''}</div>
      </div>`;
  }

  // Bouton de la fiche véhicule : on redessine sa rubrique (ailleurs, comme dans Administratif, la page se redessine seule).
  function majSection(b, id) {
    const zone = b.closest('.depot-info');
    if (zone) zone.outerHTML = section(db.get('vehicules', id)).replace(/^[\s\S]*?<\/h3>/, '');
  }

  function init() {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-depot]');
      if (!b) return;
      const v = db.get('vehicules', b.dataset.vid);
      if (!v) return;
      const a = b.dataset.depot;
      if (a === 'mandat') mandat(v);
      else if (a === 'releve') releve(v);
      else if (a === 'prolonger') {
        const d = new Date(finMandat(v) + 'T12:00'); d.setDate(d.getDate() + num(reglages().dureeMandat));
        db.upsert('vehicules', { id: v.id, mandatFin: isoLocal(d) });
        toast('Mandat prolongé jusqu\'au ' + dateFr(isoLocal(d)));
        majSection(b, v.id);
      } else if (a === 'reverse') {
        const moyen = prompt('Moyen de reversement (virement, chèque…) :', 'Virement');
        if (moyen === null) return;
        db.upsert('vehicules', { id: v.id, reversement: { ...v.reversement, fait: true, le: today(), moyen } });
        db.all('planning').filter(r => r.vehiculeId === v.id && !r.fait && /^Reverser/.test(r.notes || '')).forEach(r => db.upsert('planning', { id: r.id, fait: true }));
        toast('Reversement enregistré');
        majSection(b, v.id);
      }
    });
  }

  return { init, est, commission, net, finMandat, page2, resume, section, apresVente, TYPES };
})();
