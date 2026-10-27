// Page « Offre » : choix du véhicule, de la reprise et du client, puis calcul du prix.
// Prix = prix de vente − reprise + pack livraison − remise + carte grise.
const Offre = (() => {
  // Barème carte grise de La Réunion (véhicule d'occasion déjà immatriculé en France).
  // Sources : service-public.gouv.fr (taxe fixe 11 €, acheminement 2,76 €) ; tarif régional 2026 de 60 €/CV,
  // abattement de 50 % au-delà de 10 ans (calcul-carte-grise.fr). Seul le montant ANTS fait foi : modifiable dans Paramètres.
  const reglages = () => Param.get().carteGrise;

  // Packs de l'offre : copie des packs des Paramètres au moment de l'offre (les prix restent figés ensuite).
  // Les offres d'avant l'onglet Paramètres (démarches / protection en dur) sont converties.
  function packsOffre(pack, nouvelle) {
    const params = Param.get().packs;
    let items = pack.items;
    if (!items) {
      items = params.map(k => ({ id: k.id, nom: k.nom, montant: k.montant, coche: nouvelle ? !!k.coche : false }));
      if (!nouvelle) {
        const anc = { demarches: ['Démarches administratives', pack.montantDemarches], protection: ['Protection de peinture', pack.montantProtection] };
        Object.entries(anc).forEach(([id, [nom, montant]]) => {
          const it = items.find(x => x.id === id) || (items.push({ id, nom, montant }), items[items.length - 1]);
          if (montant != null) it.montant = montant;
          it.coche = !!pack[id];
        });
      }
    } else {
      // Packs ajoutés depuis dans les Paramètres : proposés, non cochés.
      params.forEach(k => { if (!items.some(x => x.id === k.id)) items.push({ id: k.id, nom: k.nom, montant: k.montant, coche: false }); });
    }
    return items;
  }

  // Âge en années à partir de la 1re mise en circulation (ou de l'année).
  function age(v) {
    const d = v.miseEnCirculation ? new Date(v.miseEnCirculation) : v.annee ? new Date(Number(v.annee), 6, 1) : null;
    return d ? (Date.now() - d) / (365.25 * 864e5) : null;
  }

  function carteGrise(v, cv) {
    const r = reglages();
    if (!v || !num(cv)) return { total: 0, detail: 'Puissance fiscale inconnue' };
    const plusDe10 = (age(v) ?? 0) > 10;
    const regionale = num(cv) * r.prixCV * (plusDe10 ? 0.5 : 1);
    const total = Math.round((regionale + r.taxeFixe + r.acheminement) * 100) / 100;
    return {
      total,
      detail: `${cv} CV × ${r.prixCV} €${plusDe10 ? ' × 50 % (plus de 10 ans)' : ''} + taxe fixe ${r.taxeFixe} € + acheminement ${String(r.acheminement).replace('.', ',')} €`,
    };
  }

  let etat = null; // offre en cours d'édition

  const stock = () => db.all('vehicules').filter(v => DISPONIBLE.includes(v.statut) || v.id === etat?.vehiculeId);
  // Seules les reprises validées se choisissent dans une offre (menu déroulant).
  const reprisesDispo = () => db.all('vehicules').filter(v => v.statut === 'Reprise validée' || v.id === etat?.repriseId);
  const libelleV = v => vehiculeNom(v) + (v.immatriculation ? ' — ' + v.immatriculation : '');

  function calcul() {
    const v = db.get('vehicules', etat.vehiculeId);
    const rep = db.get('vehicules', etat.repriseId);
    const prixVente = num(v?.prixVente);
    const reprise = num(rep?.prixAchat || rep?.prixPropose);
    const pack = etat.pack.items.filter(k => k.coche).reduce((s, k) => s + num(k.montant), 0)
      + (etat.pack.frais ? num(etat.pack.montantFrais) : 0);
    const cg = carteGrise(v, etat.cv || v?.puissanceFiscale);
    const total = prixVente - reprise + pack - num(etat.remise) + cg.total;
    return { v, rep, prixVente, reprise, pack, cg, total };
  }

  // Sélecteur avec recherche (plaque, modèle, nom).
  function selecteur(id, titre, liste, choisi, libelle, vide, optionnel) {
    const sel = choisi ? liste.find(x => x.id === choisi) || db.get('vehicules', choisi) || db.get('clients', choisi) : null;
    return `<section class="o-bloc">
      <h3 class="section">${titre}${optionnel ? ' <span class="hint">(facultatif)</span>' : ''}</h3>
      ${sel ? `<div class="o-choix">${sel.image ? `<img src="${esc(sel.image)}" alt="" onerror="this.remove()">` : ''}
          <div><strong>${esc(libelle(sel))}</strong>${sel.annee || sel.kilometrage ? `<span class="sub">${esc([sel.annee, km(sel.kilometrage), sel.carburant].filter(Boolean).join(' · '))}</span>` : ''}${sel.telephone ? `<span class="sub">${esc(sel.telephone)}</span>` : ''}</div>
          <button type="button" class="chip" data-vider="${id}">Changer</button></div>`
        : `<input type="search" class="o-recherche" data-recherche="${id}" placeholder="Rechercher par plaque, modèle ou nom…" autocomplete="off">
          <div class="o-liste" id="liste-${id}">${liste.length ? liste.map(x => `<button type="button" class="o-item" data-choisir="${id}" data-id="${x.id}">${esc(libelle(x))}</button>`).join('') : `<span class="hint">${vide}</span>`}</div>`}
    </section>`;
  }

  function menuReprise() {
    const liste = reprisesDispo();
    const rep = db.get('vehicules', etat.repriseId);
    return `<section class="o-bloc">
      <h3 class="section">Véhicule repris <span class="hint">(facultatif)</span></h3>
      <select data-reprise-menu aria-label="Véhicule repris"><option value="">${liste.length ? 'Aucune reprise' : 'Aucune reprise validée pour le moment'}</option>
        ${liste.map(v => `<option value="${v.id}"${v.id === etat.repriseId ? ' selected' : ''}>${esc(libelleV(v))} · ${euros(v.prixAchat || v.prixPropose) || 'prix à saisir'}</option>`).join('')}</select>
      ${rep?.image ? `<div class="o-choix"><img src="${esc(rep.image)}" alt="" onerror="this.remove()"><div><strong>${esc(vehiculeNom(rep))}</strong>
        <span class="sub">${esc([rep.annee, km(rep.kilometrage), rep.carburant].filter(Boolean).join(' · '))}</span></div></div>` : ''}
      <span class="hint">Les reprises se valident dans l'onglet Reprise.</span>
    </section>`;
  }

  function rendre() {
    const c = calcul();
    const r = etat.pack;
    const ligne = (l, m, cls = '') => `<div class="o-ligne ${cls}"><span>${l}</span><strong>${m}</strong></div>`;
    $('#offre-body').innerHTML = `
      ${selecteur('vehiculeId', 'Véhicule souhaité', stock(), etat.vehiculeId, libelleV, 'Aucun véhicule disponible en stock.')}
      ${Droits.achat() ? menuReprise() : ''}
      ${selecteur('clientId', 'Client', db.all('clients').slice().sort((a, b) => norm(clientNom(a)).localeCompare(norm(clientNom(b)))), etat.clientId, clientNom, 'Aucun client pour l\'instant : crée-le ci-dessous.')}
      ${etat.clientId ? '' : `<section class="o-bloc o-nouveau-client">
        <h3 class="section">Nouveau client</h3>
        <div class="inline"><input data-nc="prenom" placeholder="Prénom" autocomplete="off"><input data-nc="nom" placeholder="Nom" autocomplete="off"></div>
        <div class="inline"><input data-nc="telephone" type="tel" placeholder="Téléphone" autocomplete="off"><input data-nc="email" type="email" placeholder="Email" autocomplete="off"></div>
        <button type="button" data-creer-client>${icon('plus', 16)}<span>Créer ce client</span></button>
      </section>`}
      <section class="o-bloc">
        <h3 class="section">Pack livraison</h3>
        ${r.items.map((k, i) => `<label class="check"><input type="checkbox" data-pack-item="${i}"${k.coche ? ' checked' : ''}><span>${esc(k.nom)}</span><span class="o-montant">${euros(k.montant)}</span></label>`).join('')}
        <label class="check"><input type="checkbox" data-pack="frais"${r.frais ? ' checked' : ''}><span>Frais supplémentaires</span></label>
        ${r.frais ? `<div class="inline o-frais"><input data-champ="libelleFrais" placeholder="Précisez (ex. jantes, attelage…)" value="${esc(r.libelleFrais || '')}">
          <input data-champ="montantFrais" type="number" inputmode="decimal" placeholder="Montant €" value="${esc(r.montantFrais || '')}"></div>` : ''}
      </section>
      <section class="o-bloc">
        <h3 class="section">Détail du prix</h3>
        ${ligne('Prix de vente', c.v ? euros(c.prixVente) : '—')}
        ${c.rep ? ligne('Reprise ' + esc(vehiculeNom(c.rep)), '− ' + euros(c.reprise), 'moins') : ''}
        ${c.pack ? ligne('Pack livraison', '+ ' + euros(c.pack)) : ''}
        <div class="o-ligne"><span>Remise</span><span class="inline o-remise"><span>−</span><input data-champ="remise" type="number" inputmode="decimal" value="${esc(etat.remise || '')}" placeholder="0"><span>€</span></span></div>
        <div class="o-ligne"><span>Carte grise<span class="sub">${esc(c.cg.detail)}</span></span><strong>+ ${euros(c.cg.total)}</strong></div>
        ${c.v && !c.v.puissanceFiscale ? `<div class="inline o-cv"><span class="hint">Puissance fiscale du véhicule :</span><input data-champ="cv" type="number" inputmode="numeric" value="${esc(etat.cv || '')}" placeholder="CV"></div>` : ''}
        <div class="o-total"><span>Total à payer</span><strong>${euros(c.total)}</strong></div>
      </section>`;
  }

  function ouvrir(id) {
    const o = id ? db.get('commandes', id) : null;
    etat = o ? JSON.parse(JSON.stringify(o)) : {
      vehiculeId: '', repriseId: '', clientId: '', remise: '', cv: '',
      pack: { frais: false, libelleFrais: '', montantFrais: '' },
    };
    etat.pack = etat.pack || {};
    etat.pack.items = packsOffre(etat.pack, !o);
    $('#offre-titre').textContent = o ? 'Offre ' + o.numero : 'Nouvelle offre';
    $('#btn-offre-imprimer').hidden = !o;
    $('#btn-offre-accepter').hidden = !o || o.statut !== 'Offre';
    $('#btn-offre-supprimer').hidden = !o;
    rendre();
    $('#dlg-offre').showModal();
  }

  function enregistrer() {
    const c = calcul();
    if (!etat.vehiculeId || !etat.clientId) { toast('Choisis au moins le véhicule et le client.'); return null; }
    const row = {
      ...etat, statut: etat.statut || 'Offre', date: etat.date || today(),
      prixVente: c.prixVente, valeurReprise: c.reprise, montantPack: c.pack, carteGrise: c.cg.total, prix: c.total,
    };
    const avant = etat.id ? { ...db.get('commandes', etat.id) } : null;
    const saved = db.upsert('commandes', row);
    etat = JSON.parse(JSON.stringify(saved));
    TABS.commandes.afterSave(saved, avant);
    return saved;
  }

  // Options et équipements saisis sur la fiche du véhicule (une par ligne ou séparées par des virgules).
  const equipements = v => String(v?.equipements || '').split(/\n|,|;|•/).map(x => x.trim()).filter(Boolean);

  // Fiche du véhicule reprise dans l'offre : photo, caractéristiques et options principales.
  function ficheVehicule(v, photo) {
    const infos = [['Marque', v.marque], ['Modèle', [v.modele, v.finition].filter(Boolean).join(' ')], ['Année', v.miseEnCirculation ? dateFr(v.miseEnCirculation) : v.annee],
      ['Kilométrage', v.kilometrage && km(v.kilometrage)], ['Carburant', v.carburant], ['Boîte', v.boite], ['Couleur', v.couleur], ['Type', v.type],
      ['Puissance', [v.puissanceCh && v.puissanceCh + ' ch', v.puissanceFiscale && v.puissanceFiscale + ' CV'].filter(Boolean).join(' · ')],
      ['Portes / places', [v.portes, v.places].filter(Boolean).join(' / ')], ['Immatriculation', v.immatriculation]].filter(([, x]) => x);
    const opts = equipements(v);
    return `<section class="fiche"><h2>${esc(vehiculeNom(v))}</h2>
      <div class="fiche-grille">${photo ? `<img class="photo" src="${esc(photo)}" alt="" onerror="this.remove()">` : ''}
        <dl>${infos.map(([l, x]) => `<div><dt>${esc(l)}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl></div>
      ${opts.length ? `<h3>Options et équipements</h3><ul class="options">${opts.map(o => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}</section>`;
  }

  // Préparation du calcul d'une offre enregistrée, sans ouvrir l'écran de l'offre.
  function charger(o) {
    etat = JSON.parse(JSON.stringify(o));
    etat.pack = etat.pack || {};
    etat.pack.items = packsOffre(etat.pack, false);
  }

  // Document de l'offre, avec la barre Retour / Envoyer par mail / Enregistrer le PDF.
  // La fenêtre s'ouvre tout de suite (sinon le navigateur la bloque), puis se remplit une fois la photo trouvée.
  async function documentOffre(saved, { envoyer = false } = {}) {
    const w = window.open('', '_blank');
    if (!w) { toast("Autorise l'ouverture de fenêtres pour afficher l'offre."); return; }
    w.document.write('<!doctype html><meta charset="utf-8"><title>Offre</title><p style="font:15px Arial,sans-serif;padding:30px">Préparation de l’offre…</p>');
    const c = calcul();
    const cl = db.get('clients', saved.clientId);
    const p = saved.pack;
    const g = Param.get().garage;
    const photo = await Promise.race([Photos.premiere(c.v), new Promise(r => setTimeout(() => r(c.v?.image || ''), 4000))]);
    const lignes = [
      ['Prix de vente ' + vehiculeNom(c.v), euros(c.prixVente)],
      c.rep && ['Reprise ' + libelleV(c.rep), '− ' + euros(c.reprise)],
      ...(p.items || []).filter(k => k.coche).map(k => [k.nom, euros(k.montant)]),
      p.frais && [p.libelleFrais || 'Frais supplémentaires', euros(p.montantFrais)],
      num(saved.remise) && ['Remise', '− ' + euros(saved.remise)],
      ['Carte grise (estimation)', euros(c.cg.total)],
    ].filter(Boolean);
    const titre = `Offre ${saved.numero}${g.nom ? ' · ' + g.nom : ''}`;
    w.document.open();
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titre)}</title>
      <style>body{font:14px/1.5 Inter,Arial,sans-serif;color:#0d0f12;max-width:760px;margin:16px auto;padding:0 16px;background:#fff}
      #doc{padding:8px 4px;container-type:inline-size}header{display:flex;align-items:center;gap:12px;border-bottom:2px solid #0d0f12;padding-bottom:12px}
      header img{width:56px;height:56px;border-radius:10px;object-fit:contain}.garage{margin-left:auto;text-align:right;font-size:12px;color:#334155}h1{margin:0;font-size:22px}.muted{color:#6b6f76}
      .bloc{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:18px 0}.bloc div{border:1px solid #e6e7ea;border-radius:10px;padding:12px}
      .fiche{border:1px solid #e6e7ea;border-radius:12px;padding:14px;margin:18px 0}.fiche h2{margin:0 0 10px;font-size:17px}.fiche h3{margin:14px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#4b4f56}
      .fiche-grille{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;align-items:start}.fiche-grille .photo{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;background:#f1f2f4}
      .fiche-grille:not(:has(.photo)){grid-template-columns:1fr}
      dl{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:6px 12px}dl div{border-bottom:1px solid #eef0f2;padding-bottom:4px}dt{font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:#6b6f76}dd{margin:0;font-weight:600}
      .options{margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px}.options li{border:1px solid #d9dbe0;border-radius:999px;padding:3px 10px;font-size:12.5px}
      table{width:100%;border-collapse:collapse;margin-top:10px}td{padding:8px 0;border-bottom:1px solid #e6e7ea}td:last-child{text-align:right;white-space:nowrap}
      .total td{font-size:18px;font-weight:700;border-bottom:0;border-top:2px solid #0d0f12}footer{margin-top:24px;font-size:12px;color:#6b6f76}
      @container (max-width:560px){.bloc,.fiche-grille{grid-template-columns:1fr}}</style></head><body>
      ${DocBarre.html(titre, { email: cl?.email || '', envoyer, sujet: titre,
        texte: `Bonjour ${cl?.prenom || clientNom(cl)},\n\nVous trouverez ci-joint notre offre pour le véhicule ${vehiculeNom(c.v)}.\n\nCordialement,\n${g.nom || ''}`.trim() })}
      <div id="doc">
      <header>${g.logo ? `<img src="${esc(g.logo)}" alt="">` : ''}<div><h1>Offre ${esc(saved.numero)}</h1><span class="muted">du ${dateFr(saved.date)} · valable 15 jours</span></div>
        ${g.nom ? `<div class="garage"><strong>${esc(g.nom)}</strong><br>${esc([g.adresse, [g.codePostal, g.ville].filter(Boolean).join(' ')].filter(Boolean).join(', '))}<br>${esc([g.telephone, g.email].filter(Boolean).join(' · '))}${g.siret ? '<br>SIRET ' + esc(g.siret) : ''}</div>` : ''}</header>
      <div class="bloc"><div><strong>Client</strong><br>${esc(clientNom(cl))}<br>${esc([cl?.telephone, cl?.email].filter(Boolean).join(' · '))}<br>${esc([cl?.adresse, cl?.codePostal, cl?.ville].filter(Boolean).join(' '))}</div>
      <div><strong>Prix</strong><br>Véhicule : ${euros(c.prixVente)}${c.rep ? `<br>Reprise de votre ${esc(vehiculeNom(c.rep))} : − ${euros(c.reprise)}` : ''}<br><b>Total : ${euros(c.total)}</b></div></div>
      ${ficheVehicule(c.v, photo)}
      <table>${lignes.map(([l, m]) => `<tr><td>${esc(l)}</td><td>${m}</td></tr>`).join('')}
      <tr class="total"><td>Total à payer</td><td>${euros(c.total)}</td></tr></table>
      <footer>Montant de la carte grise estimé selon le barème de La Réunion ; seul le montant ANTS fait foi.</footer></div></body></html>`);
    w.document.close();
  }

  // Bouton de l'écran de l'offre : enregistre puis affiche le document.
  function imprimer() {
    const saved = enregistrer();
    if (saved) documentOffre(saved);
  }

  // Depuis la liste des offres (menu d'actions).
  function afficher(id, opts) {
    const o = db.get('commandes', id);
    if (!o) return;
    charger(o);
    documentOffre(o, opts);
  }

  // Offre acceptée : elle passe en commande (la reprise éventuelle est validée par la commande).
  function accepter(id) {
    const o = db.get('commandes', id);
    if (!o) return null;
    charger(o);
    etat.statut = 'Commande';
    return enregistrer();
  }

  function supprimer(id) {
    const o = db.get('commandes', id);
    if (!o || !confirm(`Supprimer définitivement l'offre ${o.numero} ?`)) return false;
    db.remove('commandes', o.id);
    TABS.commandes.afterDelete(o);
    relances(o).forEach(r => db.remove('planning', r.id));
    return true;
  }

  function init() {
    const body = $('#offre-body');
    body.addEventListener('click', e => {
      const ch = e.target.closest('[data-choisir]');
      if (ch) {
        etat[ch.dataset.choisir] = ch.dataset.id;
        // Une reprise rattachée à un client sélectionne ce client.
        if (ch.dataset.choisir === 'repriseId' && !etat.clientId) etat.clientId = db.get('vehicules', ch.dataset.id)?.vendeurId || '';
        rendre();
        return;
      }
      const vd = e.target.closest('[data-vider]');
      if (vd) { etat[vd.dataset.vider] = ''; rendre(); return; }
      // Les clients se créent directement depuis l'offre (plus d'onglet Clients chez les revendeurs).
      if (e.target.closest('[data-creer-client]')) {
        const c = {};
        body.querySelectorAll('[data-nc]').forEach(i => { c[i.dataset.nc] = i.value.trim(); });
        if (!c.nom && !c.prenom && !c.telephone) { toast('Indique au moins un nom ou un téléphone.'); return; }
        etat.clientId = db.upsert('clients', c).id;
        rendre();
      }
    });
    body.addEventListener('change', e => {
      if (e.target.matches('[data-reprise-menu]')) {
        etat.repriseId = e.target.value;
        if (etat.repriseId && !etat.clientId) etat.clientId = db.get('vehicules', etat.repriseId)?.vendeurId || '';
        rendre();
        return;
      }
      const i = e.target.dataset.packItem;
      if (i != null) { etat.pack.items[i].coche = e.target.checked; rendre(); return; }
      const k = e.target.dataset.pack;
      if (k) { etat.pack[k] = e.target.checked; rendre(); }
    });
    body.addEventListener('input', e => {
      const q = e.target.dataset.recherche;
      if (q) {
        const t = norm(e.target.value);
        document.querySelectorAll(`#liste-${q} .o-item`).forEach(b => { b.hidden = !norm(b.textContent).includes(t); });
        return;
      }
      const k = e.target.dataset.champ;
      if (!k) return;
      if (k === 'libelleFrais' || k === 'montantFrais') etat.pack[k] = e.target.value; else etat[k] = e.target.value;
      if (k === 'libelleFrais') return;
      // Recalcul sans reconstruire le champ en cours de saisie.
      const pos = e.target.selectionStart;
      rendre();
      const el = body.querySelector(`[data-champ="${k}"]`);
      el.focus();
      try { el.setSelectionRange(pos, pos); } catch (err) { /* champ numérique */ }
    });
    $('#btn-offre-annuler').addEventListener('click', () => $('#dlg-offre').close());
    $('#btn-offre-enregistrer').addEventListener('click', () => {
      const saved = enregistrer();
      if (!saved) return;
      $('#dlg-offre').close();
      render();
    });
    $('#btn-offre-imprimer').addEventListener('click', imprimer);
    $('#btn-offre-accepter').addEventListener('click', () => {
      etat.statut = 'Commande';
      const saved = enregistrer();
      if (!saved) return;
      $('#dlg-offre').close();
      render();
      const next = apresEnregistrement;
      apresEnregistrement = null;
      next?.(saved);
    });
    $('#btn-offre-supprimer').addEventListener('click', () => {
      if (!supprimer(etat.id)) return;
      $('#dlg-offre').close();
      render();
    });
  }

  return { ouvrir, init, reglages, carteGrise, afficher, accepter, supprimer };
})();
