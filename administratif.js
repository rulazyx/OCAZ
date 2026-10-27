// Onglet Administratif : toute la paperasse du garage au même endroit.
// « À faire » liste ce qui est en retard ou bientôt dû (délais légaux), « Véhicules » montre le dossier de chaque véhicule,
// « Registres » le livre de police, les factures et les mandats, « Garage » les habilitations, échéances et documents.
// Les papiers eux-mêmes restent ceux de papiers.js, facture.js et depot.js (mêmes boutons data-papier, data-vente, data-depot).
const Administratif = (() => {
  const VUES = { afaire: 'À faire', dossiers: 'Véhicules', registres: 'Registres', garage: 'Garage' };
  let vue = 'afaire';
  let filtre = 'encours';
  // Déclaration d'achat et déclaration de cession dans le SIV : 15 jours (code de la route, R322-4).
  const DELAI_SIV = 15;
  // Contrôle technique de moins de 6 mois pour vendre un véhicule de plus de 4 ans.
  const CT_MOIS = 6;
  const SUIVIS = ['En préparation', 'En stock', 'Réservé', 'Vendu'];
  const CHAMPS = [
    ['prefecture', 'Déclaration en préfecture (registre des objets mobiliers, cerfa 11733)', 'date', 'Faite le'],
    ['habilitationSiv', 'Habilitation SIV (n°), ou nom du prestataire qui fait tes cartes grises', 'text', ''],
    ['wGarage', 'Certificat W garage (n°)', 'text', ''],
    ['wGarageFin', 'W garage valable jusqu\'au', 'date', ''],
    ['assuranceFin', 'Assurance du garage : échéance', 'date', ''],
    ['comptable', 'Email du comptable', 'email', ''],
  ];

  const reglages = () => Param.get().administratif || {};
  const plus = (d, n) => { const x = new Date(d + 'T12:00'); x.setDate(x.getDate() + n); return isoLocal(x); };
  const ecart = d => Math.round((new Date(d + 'T12:00') - new Date(today() + 'T12:00')) / 864e5);
  const dateAchat = v => v.achatDate || v.dateEntree || (v.creeLe || '').slice(0, 10) || today();
  const vente = v => db.all('commandes').filter(o => o.vehiculeId === v.id && !['Offre', 'Annulée'].includes(o.statut))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const dateVente = (v, o = vente(v)) => v.dateVente || o?.dateLivree || o?.dateLivraison || '';
  const achat = v => !Depot.est(v);
  // Mise en circulation (ou année) : plus de 4 ans, il faut un CT de moins de 6 mois à la vente.
  function plusDe4Ans(v) {
    const mec = v.miseEnCirculation || (v.annee ? v.annee + '-01-01' : '');
    return !!mec && ecart(plus(mec, 4 * 365)) < 0;
  }
  const finCt = v => { if (!v.ctDate) return ''; const d = new Date(v.ctDate + 'T12:00'); d.setMonth(d.getMonth() + CT_MOIS); return isoLocal(d); };
  const vehicules = () => db.all('vehicules').filter(v => SUIVIS.includes(v.statut));
  const delai = (echeance, fait) => {
    if (fait) return ['ok', `fait le ${dateFr(fait)}`];
    const n = ecart(echeance);
    return n < 0 ? ['retard', `en retard de ${-n} j (avant le ${dateFr(echeance)})`] : [n <= 5 ? 'bientot' : 'info', `avant le ${dateFr(echeance)} (${n} j)`];
  };

  // ---------- À faire ----------
  function taches() {
    const t = [];
    const ajoute = (niveau, titre, detail, actions) => t.push({ niveau, titre, detail, actions });
    const nomV = v => esc(vehiculeNom(v)) + (v.immatriculation ? ' · ' + esc(v.immatriculation) : '');
    vehicules().forEach(v => {
      if (Droits.achat() && achat(v) && !v.daSiv) {
        const [n, txt] = delai(plus(dateAchat(v), DELAI_SIV));
        ajoute(n, `Déclaration d'achat au SIV · ${nomV(v)}`, `Acheté le ${dateFr(dateAchat(v))} : à enregistrer ${txt}.`,
          `<button type="button" class="chip" data-papier="declaration" data-vid="${v.id}">Déclaration d'achat (cerfa 13751)</button>
           <button type="button" class="chip" data-adm="da" data-vid="${v.id}">✓ Enregistrée au SIV</button>`);
      }
      if (v.statut === 'Vendu' && !v.cessionSiv) {
        const d = dateVente(v) || today();
        const [n, txt] = delai(plus(d, DELAI_SIV));
        ajoute(n, `Déclaration de cession au SIV · ${nomV(v)}`, `Vendu le ${dateFr(d)} : à déclarer ${txt}, puis remettre le récépissé et le code de cession à l'acheteur.`,
          `<button type="button" class="chip" data-papier="cession-vente" data-vid="${v.id}">Certificat de cession (cerfa 15776)</button>
           <button type="button" class="chip" data-adm="cession" data-vid="${v.id}">✓ Déclarée au SIV</button>`);
      }
      if (v.statut !== 'Vendu' && plusDe4Ans(v) && (!v.ctDate || finCt(v) < today())) {
        ajoute(v.statut === 'Réservé' ? 'retard' : 'info', `Contrôle technique · ${nomV(v)}`,
          v.ctDate ? `Le CT du ${dateFr(v.ctDate)} a plus de 6 mois : à refaire avant la vente.` : 'Plus de 4 ans : un CT de moins de 6 mois doit être remis à l\'acheteur.',
          ctChamp(v));
      }
      if (Depot.est(v) && v.statut !== 'Vendu') {
        const n = ecart(Depot.finMandat(v));
        if (n <= 10) ajoute(n < 0 ? 'retard' : 'bientot', `Mandat de dépôt-vente · ${nomV(v)}`,
          n < 0 ? `Expiré le ${dateFr(Depot.finMandat(v))} : à prolonger ou véhicule à rendre.` : `Expire le ${dateFr(Depot.finMandat(v))} (${n} j).`,
          `<button type="button" class="chip" data-depot="prolonger" data-vid="${v.id}">Prolonger</button>
           <button type="button" class="chip" data-depot="mandat" data-vid="${v.id}">Mandat</button>`);
      }
      if (Depot.est(v) && v.reversement && !v.reversement.fait) {
        ajoute('bientot', `Reverser ${euros(v.reversement.montant)} au déposant · ${nomV(v)}`, `Vendu ${euros(v.reversement.prixVendu)}, commission ${euros(v.reversement.commission)}.`,
          `<button type="button" class="chip" data-depot="releve" data-vid="${v.id}">Relevé de vente</button>
           <button type="button" class="chip" data-depot="reverse" data-vid="${v.id}">✓ Reversement effectué</button>`);
      }
    });
    db.all('commandes').filter(o => o.statut === 'Livrée' && !o.factureNumero).forEach(o => {
      ajoute('bientot', `Facture à éditer · commande ${esc(o.numero || '')}`, `${esc(clientNom(db.get('clients', o.clientId)))} · ${esc(vehiculeNom(db.get('vehicules', o.vehiculeId)))}, livrée le ${dateFr(o.dateLivree || o.dateLivraison)}.`,
        `<button type="button" class="chip" data-vente="facture" data-cid="${o.id}">Éditer la facture</button>`);
    });
    const incompletes = Papiers.lignesPolice().filter(l => l.manque.length);
    if (incompletes.length) ajoute('retard', `Livre de police : ${incompletes.length} ligne${incompletes.length > 1 ? 's' : ''} à compléter`,
      incompletes.slice(0, 3).map(l => `n°${l.numero} ${esc(l.vehicule)} : ${esc(l.manque.join(', '))}`).join('<br>') + (incompletes.length > 3 ? '<br>…' : ''),
      '<button type="button" class="chip" data-adm="police">Ouvrir le livre de police</button>');
    const r = reglages();
    const echeance = (k, nom) => {
      if (!r[k]) return;
      const n = ecart(r[k]);
      if (n <= 30) ajoute(n < 0 ? 'retard' : 'bientot', `${nom} ${n < 0 ? 'expiré' : 'à renouveler'}`, `Échéance le ${dateFr(r[k])}.`, '<button type="button" class="chip" data-adm-vue="garage">Mettre à jour</button>');
    };
    echeance('wGarageFin', 'Certificat W garage');
    echeance('assuranceFin', 'Assurance du garage');
    if (!r.wGarage || !r.prefecture) ajoute('info', 'Compléter les infos du garage', 'Déclaration en préfecture, habilitation SIV, W garage, assurance : Ocaz te prévient avant les échéances.',
      '<button type="button" class="chip" data-adm-vue="garage">Compléter</button>');
    const ordre = { retard: 0, bientot: 1, info: 2 };
    return t.sort((a, b) => ordre[a.niveau] - ordre[b.niveau]);
  }
  const ctChamp = v => `<label class="adm-ct">CT fait le <input type="date" data-adm-ct="${v.id}" value="${esc(v.ctDate || '')}"></label>`;

  function vueAFaire() {
    const t = taches();
    if (!t.length) return `<div class="empty">${ILLUS.commandes || ''}<strong>Rien en retard</strong><span>Déclarations, factures, mandats et échéances sont à jour.</span></div>`;
    const lib = { retard: ['En retard', 'b-red'], bientot: ['Bientôt', 'b-orange'], info: ['À prévoir', 'b-grey'] };
    return `<p class="muted">${t.filter(x => x.niveau === 'retard').length} en retard · ${t.length} au total</p>
      <div class="list">${t.map(x => `<div class="card adm-tache ${x.niveau}"><div class="top"><span class="title">${x.titre}</span>
        <span class="badge ${lib[x.niveau][1]}">${lib[x.niveau][0]}</span></div>
        <div class="sub">${x.detail}</div><div class="chips papiers">${x.actions}</div></div>`).join('')}</div>`;
  }

  // ---------- Dossier de chaque véhicule ----------
  // Une étape : ✓ faite, ⚠ à faire, ou simple bouton d'impression.
  const etape = (ok, libelle, attrs = '') => `<button type="button" class="chip adm-etape ${ok === true ? 'ok' : ok === false ? 'manque' : ''}" ${attrs}>${ok === true ? '✓ ' : ok === false ? '⚠ ' : ''}${libelle}</button>`;
  function manques(v) {
    const o = vente(v);
    const l = Papiers.lignesPolice().find(x => x.v.id === v.id);
    const m = [];
    if (l?.manque.length) m.push('livre de police');
    if (achat(v) && !v.daSiv) m.push('déclaration d\'achat');
    if (v.statut === 'Vendu') {
      if (!v.cessionSiv) m.push('cession');
      if (o && !o.factureNumero) m.push('facture');
      if (Depot.est(v) && v.reversement && !v.reversement.fait) m.push('reversement');
    }
    return m;
  }
  function dossier(v) {
    const o = vente(v);
    const l = Papiers.lignesPolice().find(x => x.v.id === v.id);
    const depot = Depot.est(v);
    const m = manques(v);
    const entree = depot
      ? [etape(null, 'Mandat de dépôt-vente', `data-depot="mandat" data-vid="${v.id}"`)]
      : [v.vendeurId ? etape(null, 'Cession (achat)', `data-papier="cession-achat" data-vid="${v.id}"`) : '',
        etape(null, "Déclaration d'achat", `data-papier="declaration" data-vid="${v.id}"`),
        v.daSiv ? etape(true, `SIV le ${dateFr(v.daSiv)}`, `data-adm="da-annuler" data-vid="${v.id}" title="Annuler"`) : etape(false, 'Enregistrée au SIV ?', `data-adm="da" data-vid="${v.id}"`)];
    const police = l ? etape(!l.manque.length, `Livre de police n°${l.numero}`, 'data-adm="police"') : '';
    const sortie = [];
    if (v.statut !== 'Vendu' && plusDe4Ans(v)) sortie.push(ctChamp(v) + (v.ctDate ? `<span class="hint">${finCt(v) < today() ? '⚠ plus de 6 mois' : 'valable pour vendre jusqu\'au ' + dateFr(finCt(v))}</span>` : ''));
    if (o) {
      sortie.push(etape(null, 'Bon de commande', `data-vente="bon" data-cid="${o.id}"`));
      if (['Livraison', 'Livrée'].includes(o.statut)) sortie.push(etape(!!o.factureNumero, o.factureNumero ? 'Facture ' + esc(o.factureNumero) : 'Facture', `data-vente="facture" data-cid="${o.id}"`));
      sortie.push(etape(null, 'Cession (vente)', `data-papier="cession-vente" data-vid="${v.id}"`));
    }
    if (v.statut === 'Vendu') sortie.push(v.cessionSiv ? etape(true, `Cession SIV le ${dateFr(v.cessionSiv)}`, `data-adm="cession-annuler" data-vid="${v.id}" title="Annuler"`) : etape(false, 'Cession déclarée au SIV ?', `data-adm="cession" data-vid="${v.id}"`));
    if (depot && v.reversement) sortie.push(etape(!!v.reversement.fait, v.reversement.fait ? 'Reversé' : 'Reversement', `data-depot="${v.reversement.fait ? 'releve' : 'reverse'}" data-vid="${v.id}"`));
    return `<div class="card adm-dossier"><div class="top"><span class="title">${esc(vehiculeNom(v))}${v.immatriculation ? ' · ' + esc(v.immatriculation) : ''}</span>
        <span class="c-badges">${depot ? '<span class="badge b-purple">Dépôt</span>' : ''}<span class="badge ${STATUT_VEHICULE[v.statut] || 'b-grey'}">${esc(v.statut)}</span></span></div>
      <div class="sub">${depot ? 'Déposé' : 'Acheté'} le ${dateFr(dateAchat(v))}${v.statut === 'Vendu' && dateVente(v) ? ' · vendu le ' + dateFr(dateVente(v)) : ''}
        ${m.length ? ` · <b class="neg">à faire : ${esc(m.join(', '))}</b>` : ' · <b class="ok">dossier complet</b>'}</div>
      <div class="adm-ligne"><span class="adm-l">Entrée</span><div class="chips papiers">${police}${entree.join('')}</div></div>
      ${sortie.length ? `<div class="adm-ligne"><span class="adm-l">Vente</span><div class="chips papiers">${sortie.join('')}</div></div>` : ''}
      <div class="chips"><button type="button" class="lien hint" data-adm="fiche" data-vid="${v.id}">Ouvrir la fiche du véhicule (documents rangés)</button></div></div>`;
  }
  function vueDossiers() {
    const tous = vehicules().sort((a, b) => dateAchat(b).localeCompare(dateAchat(a)));
    const FILTRES = { encours: ['À compléter', v => manques(v).length > 0], stock: ['En stock', v => v.statut !== 'Vendu'], vendus: ['Vendus', v => v.statut === 'Vendu'], tous: ['Tous', () => true] };
    const liste = tous.filter(FILTRES[filtre][1]);
    return `<div class="chips">${Object.entries(FILTRES).map(([k, [l, f]]) => `<button type="button" class="chip${k === filtre ? ' active' : ''}" data-adm-filtre="${k}">${l} (${tous.filter(f).length})</button>`).join('')}</div>
      <div class="list">${liste.map(dossier).join('') || `<div class="empty">${ILLUS.stock}<strong>${filtre === 'encours' ? 'Tous les dossiers sont complets' : 'Aucun véhicule ici'}</strong><span>Chaque reprise validée ou dépôt crée son dossier.</span></div>`}</div>`;
  }

  // ---------- Registres ----------
  function vueRegistres() {
    const lignes = Papiers.lignesPolice();
    const an = String(new Date().getFullYear());
    const incompletes = lignes.filter(l => l.manque.length).length;
    const factures = db.all('commandes').filter(o => o.factureNumero).sort((a, b) => b.factureNumero.localeCompare(a.factureNumero));
    const deps = db.all('vehicules').filter(v => Depot.est(v) && SUIVIS.includes(v.statut) && v.statut !== 'Vendu');
    return `<div class="parametres adm-grille"><div class="p-col">
      <section class="panneau"><h2>Livre de police</h2>
        <p class="muted">Registre des objets mobiliers : chaque véhicule acheté ou déposé y entre avec un numéro d'ordre, l'identité et la pièce d'identité du vendeur, le prix et le mode de paiement.
          À présenter sur demande de la police, de la gendarmerie, des douanes ou de la DGCCRF.</p>
        <p><b>${lignes.filter(l => l.date.startsWith(an)).length}</b> ligne(s) en ${an} · ${lignes.length} au total${incompletes ? ` · <b class="neg">${incompletes} à compléter</b>` : ' · <b class="ok">tout est complet</b>'}</p>
        <div class="chips"><button type="button" class="chip" data-adm="police">Ouvrir</button><button type="button" class="chip" data-adm="police-imprimer">Imprimer / PDF</button>
          <button type="button" class="chip" data-adm="police-exporter">Exporter (Excel)</button></div>
        <p class="hint">Le livre de police d'Ocaz se remplit tout seul mais n'est pas un registre électronique certifié (inaltérable, norme ISO 14641-1). En attendant, imprime-le chaque mois et range-le, ou recopie-le sur ton registre papier coté et paraphé.</p>
      </section>
      ${Droits.depot() ? `<section class="panneau"><h2>Mandats de dépôt-vente</h2>
        <p class="muted">${deps.length} véhicule(s) en dépôt.</p>
        ${deps.length ? `<div class="stack">${deps.map(v => { const fin = Depot.finMandat(v); return `<div class="doc-ligne"><span class="doc-nom">${esc(vehiculeNom(v))}<small>jusqu'au ${dateFr(fin)}${fin < today() ? ' · expiré' : ''}</small></span>
          <button type="button" class="chip" data-depot="mandat" data-vid="${v.id}">Mandat</button></div>`; }).join('')}</div>` : ''}
      </section>` : ''}
    </div><div class="p-col">
      <section class="panneau"><h2>Factures</h2>
        <p class="muted">Numérotées sans trou ni doublon (FAC-année-0001). À garder 10 ans.</p>
        <div class="chips"><button type="button" class="chip" data-adm="export-fac">Exporter pour le comptable (Excel)</button>
          ${reglages().comptable ? `<a class="chip" href="mailto:${esc(reglages().comptable)}?subject=${encodeURIComponent('Factures ' + (Param.get().garage.nom || ''))}">Écrire au comptable</a>` : ''}</div>
        ${factures.length ? `<div class="stack adm-factures">${factures.slice(0, 12).map(o => `<div class="doc-ligne"><span class="badge b-blue">${esc(o.factureNumero)}</span>
          <span class="doc-nom">${esc(clientNom(db.get('clients', o.clientId)))}<small>${dateFr(o.factureDate)} · ${euros(Facture.lignes(o).ttc)}</small></span>
          <button type="button" class="chip" data-vente="facture" data-cid="${o.id}">Ouvrir</button></div>`).join('')}</div>` : '<p class="hint">Aucune facture éditée pour l\'instant.</p>'}
      </section>
    </div></div>`;
  }

  // ---------- Garage ----------
  function vueGarage() {
    const r = reglages();
    return `<div class="parametres adm-grille"><div class="p-col">
      <section class="panneau"><h2>Habilitations et échéances</h2>
        <p class="muted">Ocaz te prévient 30 jours avant la fin du W garage ou de l'assurance.</p>
        <div class="stack">${CHAMPS.map(([k, l, type]) => `<div class="field"><label for="adm-${k}">${l}</label>
          <input id="adm-${k}" type="${type}" data-adm-champ="${k}" value="${esc(r[k] || '')}"></div>`).join('')}</div>
      </section></div>
    <div class="p-col"><section class="panneau"><h2>Bon à savoir</h2>
      <ul class="adm-regles">
        <li><b>Livre de police</b> : une ligne par véhicule acheté ou déposé, le jour même, avec la pièce d'identité du vendeur. Papier : 5 ans après sa clôture.</li>
        <li><b>Déclaration d'achat</b> (cerfa 13751) : à enregistrer dans le SIV sous 15 jours, avec la carte grise barrée et le certificat de cession.</li>
        <li><b>Revente</b> : déclaration de cession dans le SIV sous 15 jours, remettre le certificat de cession, la carte grise barrée, le code de cession et le récépissé de la déclaration d'achat.</li>
        <li><b>Contrôle technique</b> : moins de 6 mois pour un véhicule de plus de 4 ans (2 mois si une contre-visite est demandée).</li>
        <li><b>W garage</b> : pour faire rouler les véhicules du stock (essais, transferts). Valable 1 an.</li>
        <li><b>TVA sur la marge</b> : véhicule acheté à un particulier, pas de TVA apparente sur la facture (8,5 % à La Réunion).</li>
        <li><b>Paiement en espèces</b> : 1 000 € maximum entre un pro et un particulier résident.</li>
        <li><b>Garanties</b> : garantie légale de conformité (12 mois de présomption pour l'occasion) et vices cachés, même sans garantie commerciale.</li>
        <li><b>Conservation</b> : factures et pièces comptables 10 ans.</li>
      </ul>
      <p class="hint">Résumé indicatif : vérifie avec ton comptable ou la préfecture en cas de doute.</p></section></div></div>`;
  }

  function rendre() {
    $('#adm').innerHTML = `<div class="segmented">${Object.entries(VUES).map(([k, l]) => `<button type="button" data-adm-vue="${k}" class="${k === vue ? 'active' : ''}">${l}${k === 'afaire' ? majPastille() : ''}</button>`).join('')}</div>
      ${{ afaire: vueAFaire, dossiers: vueDossiers, registres: vueRegistres, garage: vueGarage }[vue]()}`;
    $('#adm-docs').hidden = vue !== 'garage';
    if (vue === 'garage') Param.rendre();
  }
  function majPastille() {
    const n = taches().filter(t => t.niveau === 'retard').length;
    return n ? `<small class="adm-pastille">${n}</small>` : '';
  }

  function init() {
    const page = $('#page-administratif');
    page.addEventListener('click', e => {
      const v = e.target.closest('[data-adm-vue]');
      if (v) { vue = v.dataset.admVue; rendre(); return; }
      const f = e.target.closest('[data-adm-filtre]');
      if (f) { filtre = f.dataset.admFiltre; rendre(); return; }
      const b = e.target.closest('[data-adm]');
      if (b) {
        const a = b.dataset.adm, id = b.dataset.vid;
        if (a === 'police') Papiers.ouvrirPolice();
        else if (a === 'police-imprimer') Papiers.imprimerPolice();
        else if (a === 'police-exporter') Papiers.exporterPolice();
        else if (a === 'export-fac') Facture.exporter();
        else if (a === 'fiche') { switchTab('stock'); openForm(id); }
        else if (a === 'da' || a === 'cession') {
          const d = prompt(a === 'da' ? "Date d'enregistrement de la déclaration d'achat (JJ/MM/AAAA) :" : 'Date de la déclaration de cession (JJ/MM/AAAA) :', dateFr(today()));
          if (d === null) return;
          const m = d.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          const iso = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : today();
          db.upsert('vehicules', { id, [a === 'da' ? 'daSiv' : 'cessionSiv']: iso });
          toast('Enregistré');
          rendre();
        } else if (a === 'da-annuler' || a === 'cession-annuler') {
          if (!confirm('Marquer cette déclaration comme non faite ?')) return;
          db.upsert('vehicules', { id, [a === 'da-annuler' ? 'daSiv' : 'cessionSiv']: '' });
          rendre();
        }
        return;
      }
      // Facture éditée, mandat prolongé, reversement fait : on remet la vue à jour.
      if (e.target.closest('[data-vente], [data-depot]')) setTimeout(rendre, 0);
    });
    page.addEventListener('change', e => {
      const ct = e.target.dataset.admCt;
      if (ct) { db.upsert('vehicules', { id: ct, ctDate: e.target.value }); toast('Date du CT enregistrée'); rendre(); return; }
      const k = e.target.dataset.admChamp;
      if (k) { Param.save({ administratif: { ...reglages(), [k]: e.target.value.trim() } }); toast('Enregistré'); }
    });
  }

  return { init, rendre, taches };
})();
