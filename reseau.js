// Réseau Ocaz (côté garage) : le garage partage les véhicules de son choix avec les apporteurs d'affaires
// et sur le site du réseau, fixe sa commission, et reçoit les leads (clients transmis par un apporteur) en direct.
// Il verse lui-même la commission à l'apporteur ; Ocaz la calcule et prépare la facture de l'apporteur.
const Reseau = (() => {
  const VISIBLES = ['En stock', 'Réservé'];
  const VUES = { Nouveaux: ['nouveau'], 'En cours': ['en_cours'], Vendus: ['vendu'], Clos: ['perdu'] };
  const STATUTS = { nouveau: ['Nouveau', 'b-orange'], en_cours: ['En cours', 'b-blue'], vendu: ['Vendu', 'b-green'], perdu: ['Clos', 'b-grey'] };
  const MOTIFS = ['Client injoignable', 'Plus intéressé', 'A acheté ailleurs', 'Financement refusé', 'Véhicule déjà vendu', 'Client déjà connu du garage', 'Autre'];
  let timer = null;
  let derniere = '';
  let leads = [];
  let canal = null;
  let vue = 'Nouveaux';
  let enCours = null; // lead ouvert dans la fenêtre Vendu / Clore

  const reglages = () => Param.get().reseau;
  const actif = () => !!reglages().actif;
  const partage = v => v.reseau ?? !!reglages().partageDefaut;
  const commission = v => Commission.montant(reglages(), v.prixVente, v.commissionReseau);
  const chiffres = s => String(s || '').replace(/\D/g, '');
  const apporteurNom = a => [a?.prenom, a?.nom].filter(Boolean).join(' ') || a?.email || 'apporteur';

  // Copie publiée : infos publiques du garage et véhicules partagés (sans prix d'achat ni données clients).
  function copie() {
    const g = Param.get().garage;
    const vit = Param.get().vitrine;
    const vs = db.all('vehicules').filter(v => VISIBLES.includes(v.statut) && partage(v)).sort((a, b) => (b.dateEntree || '').localeCompare(a.dateEntree || ''));
    return {
      garage: { nom: g.nom, adresse: g.adresse, codePostal: g.codePostal, ville: g.ville, telephone: g.telephone, email: g.email, site: g.site, logo: g.logo,
        slug_vitrine: vit.actif && vit.slug ? vit.slug : '' },
      vehicules: vs.map(v => ({
        id: v.id, marque: v.marque || '', modele: v.modele || '', finition: v.finition || '', annee: v.annee || '', kilometrage: v.kilometrage || '',
        carburant: v.carburant || '', boite: v.boite || '', couleur: v.couleur || '', type: v.type || '', portes: v.portes || '', places: v.places || '',
        puissanceCh: v.puissanceCh || '', puissanceFiscale: v.puissanceFiscale || '', miseEnCirculation: v.miseEnCirculation || '',
        prix: num(v.prixVente) || '', reserve: v.statut === 'Réservé', photos: (v.photos || []).slice(0, 10), texte: v.annonce?.texte || '',
        commission: commission(v), commissionTexte: Commission.texteRegle(reglages(), v.commissionReseau),
      })),
    };
  }

  // Publication après chaque changement (groupée), seulement si la copie a changé.
  function planifier() {
    clearTimeout(timer);
    timer = setTimeout(() => publier().catch(err => console.error(err)), 3000);
  }
  async function publier(forcer) {
    const r = reglages();
    if (!Sync.role || !Sync.client || (!r.actif && !r.publieLe)) return;
    const data = r.actif ? copie() : { garage: {}, vehicules: [] };
    const sig = JSON.stringify([r.actif, data]);
    if (!forcer && sig === derniere) return;
    const { error } = await Sync.client.rpc('crm_reseau_publier', { p_actif: !!r.actif, p_data: data, p_photos: data.vehicules.flatMap(v => v.photos) });
    if (error) throw new Error(/function|schema cache/i.test(error.message) ? "Le réseau n'est pas encore installé dans la base : relance le script supabase.sql." : error.message);
    derniere = sig;
    if (!r.publieLe || forcer) Param.save({ reseau: { ...reglages(), publieLe: new Date().toISOString() } });
  }

  // ---------- Leads reçus ----------
  async function charger() {
    if (!Sync.role || !Sync.client) return;
    const { data, error } = await Sync.client.rpc('crm_leads_garage');
    if (error) return;
    leads = data || [];
    majPastille();
    if (['leads', 'donnees'].includes(onglet)) render();
  }
  function ecouter() {
    if (canal || !Sync.client || !Sync.entreprise) return;
    canal = Sync.client.channel('leads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_leads', filter: 'entreprise_id=eq.' + Sync.entreprise.id }, p => {
        if (p.eventType === 'INSERT') {
          const l = p.new;
          toast(`🤝 Nouveau lead : ${[l.client_prenom, l.client_nom].join(' ')} pour ${l.vehicule}`);
          try {
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('Nouveau lead · Ocaz', { body: `${[l.client_prenom, l.client_nom].join(' ')} · ${l.vehicule}\nCommission ${euros(l.commission)}`, icon: 'icon-512.png', tag: l.id });
            }
          } catch (e) { /* notifications indisponibles */ }
        }
        charger();
      })
      .subscribe();
  }
  function demarrer() { ecouter(); charger(); planifier(); }
  function arreter() { if (canal) { Sync.client?.removeChannel(canal); canal = null; } leads = []; derniere = ''; majPastille(); }

  const nouveaux = () => leads.filter(x => x.lead.statut === 'nouveau');
  function majPastille() {
    // Pastille de l'onglet Leads : nouveaux leads du réseau + révisions à proposer.
    const n = nouveaux().length + Revision.aAppeler().length;
    document.querySelectorAll('[data-tab="leads"]').forEach(b => {
      let p = b.querySelector('.pastille');
      if (!n) { p?.remove(); return; }
      if (!p) { p = document.createElement('span'); p.className = 'pastille'; b.append(p); }
      p.textContent = n;
    });
  }
  // Vente livrée détectée dans les commandes pour le client et le véhicule du lead.
  const venteLivree = l => db.all('commandes').find(o => o.statut === 'Livrée' && o.vehiculeId === l.vehicule_id && (!l.client_id || o.clientId === l.client_id));

  async function statut(l, s, extra = {}) {
    const { data, error } = await Sync.client.rpc('crm_lead_statut', { p_id: l.id, p_statut: s, p_motif: extra.motif || '', p_prix: extra.prix ?? null,
      p_commission: extra.commission ?? null, p_client_id: extra.clientId ?? null, p_note: extra.note ?? null });
    if (error) { toast(error.message); return null; }
    await charger();
    return data;
  }

  // Prise en charge : le client entre dans Ocaz (fiche, intérêt pour le véhicule, reprise à étudier, relance du jour).
  async function prendre(x) {
    const l = x.lead;
    const tel = chiffres(l.client_tel);
    const v = db.get('vehicules', l.vehicule_id);
    const note = `Lead réseau n° ${l.numero} du ${dateFr(l.cree_le)}, apporté par ${apporteurNom(x.apporteur)} (${x.apporteur.telephone || x.apporteur.email}) · commission annoncée ${euros(l.commission)}.${l.message ? ' Message : ' + l.message : ''}`;
    const existant = db.all('clients').find(c => tel && chiffres(c.telephone) === tel);
    const c = existant
      ? db.upsert('clients', { id: existant.id, interets: [...new Set([...(existant.interets || []), ...(v ? [v.id] : [])])], notes: [existant.notes, note].filter(Boolean).join('\n') })
      : db.upsert('clients', { prenom: l.client_prenom, nom: l.client_nom, telephone: l.client_tel, email: l.client_email, source: 'Apporteur réseau', interets: v ? [v.id] : [], notes: note });
    const r = l.reprise;
    if (r && !db.all('vehicules').some(w => w.leadId === l.id)) {
      db.upsert('vehicules', { marque: r.marque || '(à préciser)', modele: r.modele || '', annee: r.annee || '', kilometrage: r.kilometrage || '', carburant: r.carburant || '',
        immatriculation: r.immatriculation ? formatPlaque(r.immatriculation) : '', etat: r.etat || '', statut: 'Reprise à étudier', vendeurId: c.id, leadId: l.id,
        notes: `Reprise annoncée par l'apporteur (lead n° ${l.numero})${r.prixSouhaite ? ' · prix souhaité ' + euros(r.prixSouhaite) : ''}${r.notes ? ' · ' + r.notes : ''}` });
    }
    db.upsert('planning', { type: 'Relance client', date: today(), clientId: c.id, vehiculeId: v?.id || '', notes: `Rappeler le client du lead réseau n° ${l.numero}.` });
    const ok = await statut(l, 'en_cours', { clientId: c.id });
    if (ok) toast(existant ? 'Lead pris en charge : ajouté à la fiche du client existant' : 'Lead pris en charge : client créé, relance ajoutée au planning');
  }

  // ---------- Onglet Leads ----------
  function carte(x) {
    const l = x.lead, a = x.apporteur;
    const [lib, cls] = STATUTS[l.statut];
    const client = [l.client_prenom, l.client_nom].filter(Boolean).join(' ');
    const r = l.reprise;
    const jours = Math.floor((Date.now() - new Date(l.cree_le)) / 864e5);
    const livree = l.statut === 'en_cours' && venteLivree(l);
    const fiche = l.client_id && db.get('clients', l.client_id);
    const wa = Papiers.telIntl(l.client_tel);
    return `<div class="card lead" data-lead="${l.id}">
      <div class="top"><span class="title">${esc(client)}</span>
        <span class="c-badges">${l.statut === 'vendu' ? `<span class="badge ${l.payee ? 'b-green' : 'b-orange'}">${l.payee ? 'Commission versée' : 'Commission à verser'}</span>` : ''}
          <span class="badge ${cls}">${lib}</span></span></div>
      <div class="sub">${icon('vehicules', 14)} ${esc(l.vehicule)}${l.vehicule_prix ? ' · ' + euros(l.vehicule_prix) : ''}</div>
      <div class="sub">📞 ${esc([l.client_tel, l.client_email].filter(Boolean).join(' · '))}</div>
      ${r ? `<div class="sub">↺ Reprise : ${esc([r.marque, r.modele, r.annee, r.kilometrage && km(r.kilometrage), r.immatriculation].filter(Boolean).join(' · '))}${r.prixSouhaite ? ' · souhaite ' + euros(r.prixSouhaite) : ''}</div>` : ''}
      ${l.message ? `<div class="sub">« ${esc(l.message)} »</div>` : ''}
      <div class="sub">🤝 ${esc(apporteurNom(a))}${a.telephone ? ' · ' + esc(a.telephone) : ''} · le ${dateFr(l.cree_le)}${l.statut === 'nouveau' && jours >= 1 ? ` · <b class="neg">en attente depuis ${jours} j</b>` : ''}</div>
      <div class="sub">Commission : <b>${euros(l.statut === 'vendu' ? l.commission_finale : l.commission)}</b>${l.statut === 'vendu' && Number(l.commission_finale) !== Number(l.commission) ? ` (annoncée ${euros(l.commission)})` : ''}${l.commission_texte ? ' · ' + esc(l.commission_texte) : ''}</div>
      ${l.statut === 'perdu' && l.motif ? `<div class="sub">Motif : ${esc(l.motif)}</div>` : ''}
      ${l.statut === 'vendu' ? `<div class="sub">Vendu le ${dateFr(l.vendu_le)}${l.prix_vente ? ' · ' + euros(l.prix_vente) : ''} · facture ${esc(l.facture_numero)}${l.payee ? ' · versée le ' + dateFr(l.payee_le) : ''}</div>
        ${a.iban ? `<div class="sub">RIB : ${esc(a.titulaire || apporteurNom(a))} · ${esc(a.iban.replace(/(.{4})/g, '$1 ').trim())}${a.bic ? ' · ' + esc(a.bic) : ''}</div>` : '<div class="sub neg">L\'apporteur n\'a pas encore renseigné son RIB.</div>'}` : ''}
      ${livree ? '<div class="sub ok">✓ Vente livrée trouvée dans tes commandes : marque le lead vendu.</div>' : ''}
      <div class="chips lead-actions">
        ${['nouveau', 'en_cours'].includes(l.statut) ? `<a class="chip" href="tel:${esc(l.client_tel)}">Appeler</a>
          ${wa ? `<a class="chip" href="https://wa.me/${wa}?text=${encodeURIComponent(`Bonjour ${l.client_prenom || client}, ici ${Param.get().garage.nom || 'le garage'}. ${apporteurNom(a)} nous a transmis votre intérêt pour le véhicule ${l.vehicule}. `)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}` : ''}
        ${Messagerie.actif ? `<button type="button" class="chip" data-lead-msg="${l.id}">💬 Écrire à l'apporteur</button>` : ''}
        ${l.statut === 'nouveau' ? `<button type="button" class="chip active" data-lead-prendre="${l.id}">Prendre en charge</button>` : ''}
        ${fiche ? `<button type="button" class="chip" data-lead-fiche="${l.id}">Fiche client</button>` : ''}
        ${l.statut === 'en_cours' ? `<button type="button" class="chip${livree ? ' active' : ''}" data-lead-vendu="${l.id}">Vendu</button>` : ''}
        ${['nouveau', 'en_cours'].includes(l.statut) ? `<button type="button" class="chip" data-lead-clore="${l.id}">Clore</button>` : ''}
        ${l.statut === 'vendu' ? `<button type="button" class="chip${l.payee ? '' : ' active'}" data-lead-payee="${l.id}">${l.payee ? 'Annuler « versée »' : 'Commission versée'}</button>
          <button type="button" class="chip" data-lead-facture="${l.id}">Facture de l'apporteur</button>` : ''}
        ${l.statut === 'perdu' || (l.statut === 'vendu' && !l.payee) ? `<button type="button" class="chip" data-lead-rouvrir="${l.id}">Rouvrir</button>` : ''}
        <a class="chip" href="tel:${esc(a.telephone)}">Appeler l'apporteur</a>
      </div></div>`;
  }

  function rendreLeads() {
    const n = Object.fromEntries(Object.entries(VUES).map(([k, s]) => [k, leads.filter(x => s.includes(x.lead.statut)).length]));
    const lot = leads.filter(x => VUES[vue].includes(x.lead.statut));
    const aVerser = leads.filter(x => x.lead.statut === 'vendu' && !x.lead.payee).reduce((s, x) => s + num(x.lead.commission_finale), 0);
    $('#list').innerHTML = `<div class="leads-page">
      ${Revision.bascule()}
      ${actif() ? '' : `<div class="panneau lead-info"><strong>Rejoins le réseau Ocaz</strong><p class="hint">Des apporteurs d'affaires présentent tes véhicules à leurs contacts et t'envoient des clients prêts à acheter. Tu ne paies une commission que sur les ventes conclues. Active-le dans Paramètres &gt; Réseau Ocaz.</p>
        <button type="button" class="chip active" data-aller="parametres">Activer le réseau</button></div>`}
      <div class="chips lead-vues">${Object.keys(VUES).map(k => `<button type="button" class="chip${k === vue ? ' active' : ''}" data-lead-vue="${k}">${k}${n[k] ? ' · ' + n[k] : ''}</button>`).join('')}</div>
      ${aVerser ? `<p class="hint">Commissions à verser : <b>${euros(aVerser)}</b></p>` : ''}
      ${lot.length ? `<div class="list">${lot.map(carte).join('')}</div>` : `<div class="empty">${ILLUS.clients}<strong>${vue === 'Nouveaux' ? 'Aucun nouveau lead' : 'Rien ici'}</strong>
        <span>${vue === 'Nouveaux' ? 'Les clients envoyés par les apporteurs arrivent ici en direct.' : 'Les leads changent de liste quand tu les fais avancer.'}</span></div>`}
    </div>`;
  }

  // Fenêtre Vendu / Clore.
  function ouvrirDialogue(x, mode) {
    enCours = { x, mode };
    const l = x.lead;
    const o = venteLivree(l);
    const v = db.get('vehicules', l.vehicule_id);
    const prix = o ? num(o.prixVente || v?.prixVente) - num(o.remise) : (l.vehicule_prix || '');
    $('#lead-titre').textContent = mode === 'vendu' ? 'Vente conclue' : 'Clore le lead';
    $('#lead-body').innerHTML = mode === 'vendu'
      ? `<p class="hint">${esc([l.client_prenom, l.client_nom].join(' '))} · ${esc(l.vehicule)}</p>
        <div class="grid"><div class="field"><label for="lead-prix">Prix de vente (€)</label><input id="lead-prix" type="number" inputmode="decimal" value="${esc(prix)}"></div>
        <div class="field"><label for="lead-com">Commission à verser (€)</label><input id="lead-com" type="number" inputmode="decimal" value="${esc(l.commission)}"></div></div>
        <p class="hint">Commission annoncée à l'apporteur : <b>${euros(l.commission)}</b>${l.commission_texte ? ' (' + esc(l.commission_texte) + ')' : ''}. Tu la verses directement par virement, sous 30 jours ; sa facture est prête dans la fiche du lead.</p>`
      : `<div class="field"><label for="lead-motif">Pourquoi ?</label><select id="lead-motif">${MOTIFS.map(m => `<option>${esc(m)}</option>`).join('')}</select></div>
        <p class="hint">L'apporteur voit le motif dans son suivi.</p>`;
    $('#lead-ok').textContent = mode === 'vendu' ? 'Marquer vendu' : 'Clore';
    $('#dlg-lead').showModal();
  }
  async function validerDialogue() {
    const { x, mode } = enCours;
    const ok = mode === 'vendu'
      ? await statut(x.lead, 'vendu', { prix: $('#lead-prix').value === '' ? null : Number($('#lead-prix').value), commission: $('#lead-com').value === '' ? null : Number($('#lead-com').value) })
      : await statut(x.lead, 'perdu', { motif: $('#lead-motif').value });
    if (!ok) return;
    $('#dlg-lead').close();
    if (mode === 'vendu') { vue = 'Vendus'; render(); toast('Lead vendu : la facture de l\'apporteur est prête'); } else toast('Lead clos');
  }

  function clic(e) {
    const b = e.target.closest('[data-lead-vue],[data-lead-prendre],[data-lead-fiche],[data-lead-vendu],[data-lead-clore],[data-lead-payee],[data-lead-facture],[data-lead-rouvrir],[data-lead-msg]');
    if (!b) return false;
    const d = b.dataset;
    if (d.leadVue) { vue = d.leadVue; render(); return true; }
    const x = leads.find(y => y.lead.id === (d.leadPrendre || d.leadFiche || d.leadVendu || d.leadClore || d.leadPayee || d.leadFacture || d.leadRouvrir || d.leadMsg));
    if (!x) return true;
    if (d.leadMsg) Messagerie.contacter('a:' + x.apporteur.email, apporteurNom(x.apporteur), `Lead n° ${x.lead.numero} · ${[x.lead.client_prenom, x.lead.client_nom].filter(Boolean).join(' ')} · ${x.lead.vehicule}`);
    else if (d.leadPrendre) prendre(x);
    else if (d.leadFiche) { switchTab('clients'); openForm(x.lead.client_id); }
    else if (d.leadVendu) ouvrirDialogue(x, 'vendu');
    else if (d.leadClore) ouvrirDialogue(x, 'perdu');
    else if (d.leadRouvrir) statut(x.lead, 'en_cours').then(ok => { if (ok) { vue = 'En cours'; render(); } });
    else if (d.leadFacture) {
      if (!Commission.imprimerFacture({ ...x.apporteur }, x.lead, Param.get().garage)) toast("Autorise l'ouverture de fenêtres pour imprimer.");
    } else if (d.leadPayee) {
      Sync.client.rpc('crm_lead_payee', { p_id: x.lead.id, p_payee: !x.lead.payee }).then(({ error }) => {
        if (error) toast(error.message); else { toast(x.lead.payee ? 'Marquée non versée' : 'Commission marquée versée'); charger(); }
      });
    }
    return true;
  }

  // Panneau de l'accueil (onglet Tableau de bord).
  function panneau() {
    if (!actif() && !leads.length) return '';
    const nv = nouveaux();
    const encours = leads.filter(x => x.lead.statut === 'en_cours').length;
    const aVerser = leads.filter(x => x.lead.statut === 'vendu' && !x.lead.payee);
    return `<section class="panneau demandes">
      <div class="p-tete"><h3>Leads du réseau <span class="compte">${nv.length}</span></h3><button type="button" class="lien hint" data-aller="leads">Voir les leads →</button></div>
      ${nv.length ? nv.slice(0, 4).map(x => `<div class="demande"><div><strong>${esc([x.lead.client_prenom, x.lead.client_nom].join(' '))}</strong> <span class="hint">${dateFr(x.lead.cree_le)}</span>
        <span class="sub">🚗 ${esc(x.lead.vehicule)} · par ${esc(apporteurNom(x.apporteur))}</span></div>
        <div class="chips"><button type="button" class="chip active" data-aller="leads">Traiter</button></div></div>`).join('')
        : '<p class="ok-vide">✓ Aucun nouveau lead en attente.</p>'}
      <p class="hint">${encours} lead(s) en cours${aVerser.length ? ` · ${aVerser.length} commission(s) à verser (${euros(aVerser.reduce((s, x) => s + num(x.lead.commission_finale), 0))})` : ''} · ${copie().vehicules.length} véhicule(s) partagé(s)</p>
    </section>`;
  }

  // ---------- Fiche véhicule : partage au réseau et commission propre ----------
  function champVehicule(row) {
    if (!actif()) return '';
    return `<div class="field full reseau-champ"><label class="check"><input type="checkbox" id="f-reseau" name="reseau"${partage(row) ? ' checked' : ''}>
        <span>Partager au réseau Ocaz (apporteurs et site du réseau)</span></label>
      <div class="inline"><input id="f-commissionReseau" name="commissionReseau" type="number" inputmode="decimal" value="${esc(row.commissionReseau ?? '')}"
        placeholder="${esc(commission(row) + ' € (' + Commission.texteRegle(reglages()).toLowerCase() + ')')}" aria-label="Commission propre à ce véhicule (€)">
        <span class="hint">Commission pour ce véhicule (€), vide = règle du garage</span></div></div>`;
  }

  // Le réseau (adhésion et commission) est réglé par l'administrateur pour chaque revendeur.

  function init() {
    $('#lead-ok').addEventListener('click', validerDialogue);
    $('#lead-annuler').addEventListener('click', () => $('#dlg-lead').close());
  }

  return { init, demarrer, arreter, planifier, publier, charger, rendreLeads, majPastille, nouveaux, panneau, clic, champVehicule, partage, actif };
})();
