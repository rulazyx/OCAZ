// Espace apporteur d'affaires du réseau Ocaz (accès gratuit) : compte créé par l'administrateur, contrat signé en ligne
// à la première connexion, suivi des leads envoyés aux garages, chiffres (commissions, ventes, taux de transformation),
// choix d'un véhicule du réseau pour transmettre un client, et paramètres (téléphone, RIB, contrat, factures).
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euros = n => (n === '' || n == null || isNaN(n)) ? '' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const km = n => n !== '' && n != null ? Number(n).toLocaleString('fr-FR') + ' km' : '';
  const dateFr = d => d ? new Date(d.length === 10 ? d + 'T12:00' : d).toLocaleDateString('fr-FR') : '';
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const num = x => Number(x) || 0;
  const nomV = v => [v.marque, v.modele, v.finition].filter(Boolean).join(' ');
  const jour = 864e5;

  const STATUTS = {
    nouveau: ['Envoyé au garage', 'b-orange'], en_cours: ['Pris en charge', 'b-blue'], vendu: ['Vendu', 'b-green'], perdu: ['Clos', 'b-grey'],
  };
  const VUES = { 'En cours': ['nouveau', 'en_cours'], Clos: ['perdu'], 'Terminés': ['vendu'] };

  let client = null, user = null, moi = null;
  let garages = [], leads = [], urls = new Map();
  let onglet = 'leads', vue = 'En cours';
  const filtres = { q: '', type: '', carburant: '', budget: '' };
  let choix = null; // { g, v } véhicule choisi pour un lead
  let canal = null;

  function toast(msg) {
    const t = $('#toast');
    // Une fenêtre ouverte passe au-dessus de tout : le message doit être dedans pour rester visible.
    ([...document.querySelectorAll('dialog[open]')].pop() || document.body).appendChild(t);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 3200);
  }

  // ---------- Connexion (mêmes réglages que l'appli des garages) ----------
  function reglages() {
    const c = window.CRMZX_CONFIG || {};
    let s = {};
    try { s = JSON.parse(localStorage.getItem('crmzx-sync')) || {}; } catch (e) { /* rien */ }
    return { url: s.url || c.supabaseUrl || '', cle: s.cle || c.supabaseCle || '' };
  }
  const rester = () => { try { return localStorage.getItem('crmzx-rester') !== '0'; } catch (e) { return true; } };
  const stockage = {
    getItem: k => { try { return (rester() ? localStorage : sessionStorage).getItem(k); } catch (e) { return null; } },
    setItem: (k, v) => { try { (rester() ? localStorage : sessionStorage).setItem(k, v); } catch (e) { /* rien */ } },
    removeItem: k => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) { /* rien */ } },
  };
  async function rpc(nom, args) {
    const { data, error } = await client.rpc(nom, args);
    if (error) throw new Error(/function|schema cache/i.test(error.message) ? "Le réseau n'est pas encore installé : préviens l'administrateur d'Ocaz." : error.message);
    return data;
  }

  function erreur(msg) {
    const el = $('#auth-erreur');
    el.textContent = msg;
    el.hidden = !msg;
    if (msg) { el.classList.remove('secoue'); void el.offsetWidth; el.classList.add('secoue'); }
  }
  function verrou(oui, texte) {
    document.body.classList.toggle('verrouille', oui);
    $('#auth').hidden = !oui;
    if (texte) $('#auth-texte').textContent = texte;
  }
  // Une seule connexion pour tout Ocaz : la page de connexion est l'accueil (./?espace=apporteur).
  // Ici on n'arrive que connecté ; un compte garage sans espace apporteur repart vers son garage.
  const preferer = e => { try { localStorage.setItem('ocaz-espace', e); } catch (err) { /* rien */ } };
  const versConnexion = () => location.replace('./?espace=apporteur');
  async function demarrer() {
    try {
      const m = await rpc('crm_apporteur_moi');
      if (!m) { preferer('garage'); location.replace('./'); return; }
      // Compte aussi garage : bouton pour passer à l'espace garage.
      client.rpc('crm_moi').then(({ data }) => { $('#btn-espace').hidden = !data?.role; }, () => {});
      moi = m;
      // Mot de passe de départ (compte créé par l'administrateur) : à remplacer avant tout.
      if (moi.doit_changer_mdp && !moi.demo) { verrou(true); $('#n-mdp').focus(); return; }
      verrou(false);
      if (!moi.contrat_signe_le && !moi.demo) { onglet = 'parametres'; toast('Bienvenue ! Signe ton contrat d\'apporteur pour commencer.'); }
      if (moi.statut !== 'actif') toast('Ton compte est suspendu : contacte Ocaz.');
      await Promise.all([chargerReseau(), chargerLeads()]);
      ecouter();
      afficher(onglet);
    } catch (err) {
      verrou(false);
      $('#vue').innerHTML = `<div class="empty"><strong>Connexion impossible</strong><span>${esc(err.message)}</span></div>`;
    }
  }
  async function chargerReseau() {
    if (moi?.statut !== 'actif') { garages = []; return; }
    try { garages = await rpc('crm_reseau_apporteur') || []; } catch (err) { garages = []; toast(err.message); }
    signer(garages.flatMap(g => (g.vehicules || []).map(v => (v.photos || [])[0]).filter(Boolean)));
  }
  async function chargerLeads() {
    try { leads = await rpc('crm_leads_apporteur') || []; } catch (err) { leads = []; toast(err.message); }
  }
  function ecouter() {
    if (canal || !client.channel) return;
    canal = client.channel('mes-leads')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'crm_leads', filter: 'apporteur_email=eq.' + moi.email }, async p => {
        const l = p.new, avant = leads.find(x => x.lead.id === l.id)?.lead;
        if (avant && avant.statut !== l.statut) toast(`${[l.client_prenom, l.client_nom].join(' ')} : ${STATUTS[l.statut][0].toLowerCase()}`);
        if (avant && !avant.payee && l.payee) toast(`💶 Commission versée : ${euros(l.commission_finale)}`);
        await chargerLeads();
        afficher(onglet);
      })
      .subscribe();
  }

  // Photos privées des véhicules partagés : adresses temporaires.
  async function signer(chemins) {
    const manquants = chemins.filter(p => p && !urls.has(p));
    if (!manquants.length || !client.storage) return;
    try {
      const { data } = await client.storage.from('photos').createSignedUrls(manquants, 3600);
      (data || []).forEach(x => { if (x.signedUrl) urls.set(x.path, x.signedUrl); });
      if (onglet === 'reseau') afficher('reseau');
    } catch (e) { /* photos indisponibles */ }
  }

  // ---------- Onglets ----------
  function afficher(nom) {
    onglet = nom;
    document.body.dataset.onglet = nom;
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === nom));
    $('#vue').innerHTML = { leads: vueLeads, donnees: vueDonnees, reseau: vueReseau, parametres: vueParametres }[nom]();
    if (nom === 'parametres') remplirParametres();
  }

  function carteLead(x) {
    const l = x.lead, g = x.garage || {};
    const [lib, cls] = STATUTS[l.statut];
    const com = l.statut === 'vendu' ? l.commission_finale : l.commission;
    return `<div class="card lead">
      <div class="top"><span class="title">${esc([l.client_prenom, l.client_nom].filter(Boolean).join(' '))}</span>
        <span class="c-badges">${l.statut === 'vendu' ? `<span class="badge ${l.payee ? 'b-green' : 'b-orange'}">${l.payee ? 'Commission reçue' : 'Commission à recevoir'}</span>` : ''}<span class="badge ${cls}">${lib}</span></span></div>
      <div class="sub">${icon('vehicules', 14)} ${esc(l.vehicule)}${l.vehicule_prix ? ' · ' + euros(l.vehicule_prix) : ''}</div>
      <div class="sub">${icon('stock', 14)} ${esc(g.nom || 'Garage')}${g.ville ? ' · ' + esc(g.ville) : ''}${g.telephone ? ` · <a href="tel:${esc(g.telephone)}">${esc(g.telephone)}</a>` : ''}</div>
      <div class="sub">Envoyé le ${dateFr(l.cree_le)} · lead n° ${esc(l.numero)}${l.statut !== 'nouveau' && l.pris_le ? ' · pris en charge le ' + dateFr(l.pris_le) : ''}</div>
      <div class="sub">Commission : <b>${euros(com)}</b>${l.statut === 'vendu' && num(l.commission_finale) !== num(l.commission) ? ` (annoncée ${euros(l.commission)})` : ''}</div>
      ${l.statut === 'perdu' ? `<div class="sub">Motif : ${esc(l.motif || '—')}</div>` : ''}
      ${l.statut === 'vendu' ? `<div class="sub">Vendu le ${dateFr(l.vendu_le)} · facture ${esc(l.facture_numero)}${l.payee ? ' · versée le ' + dateFr(l.payee_le) : ''}</div>
        <div class="chips lead-actions"><button type="button" class="chip active" data-facture="${l.id}">Ma facture de commission</button></div>` : ''}
    </div>`;
  }
  function vueLeads() {
    const n = Object.fromEntries(Object.entries(VUES).map(([k, s]) => [k, leads.filter(x => s.includes(x.lead.statut)).length]));
    const lot = leads.filter(x => VUES[vue].includes(x.lead.statut));
    return `<div class="ap-page">
      <div class="ap-tete"><h2>Suivi de mes leads</h2></div>
      <div class="chips">${Object.keys(VUES).map(k => `<button type="button" class="chip${k === vue ? ' active' : ''}" data-vue="${k}">${k}${n[k] ? ' · ' + n[k] : ''}</button>`).join('')}</div>
      ${lot.length ? `<div class="list">${lot.map(carteLead).join('')}</div>` : `<div class="empty">${ILLUS.clients}<strong>${vue === 'En cours' ? 'Aucun lead en cours' : 'Rien ici pour le moment'}</strong>
        <span>${vue === 'En cours' ? 'Choisis un véhicule dans « Réseau » et envoie les coordonnées de ton contact au garage.' : 'Tes leads arrivent ici quand le garage les fait avancer.'}</span></div>`}
    </div>`;
  }

  // Lead en souffrance : pas pris en charge après 2 jours, ou sans nouvelle du garage depuis 15 jours.
  const enSouffrance = l => (l.statut === 'nouveau' && Date.now() - new Date(l.cree_le) > 2 * jour)
    || (l.statut === 'en_cours' && Date.now() - new Date(l.statut_le) > 15 * jour);
  function vueDonnees() {
    const L = leads.map(x => x.lead);
    const vendus = L.filter(l => l.statut === 'vendu');
    const recues = vendus.filter(l => l.payee).reduce((s, l) => s + num(l.commission_finale), 0);
    const aRecevoir = vendus.filter(l => !l.payee).reduce((s, l) => s + num(l.commission_finale), 0);
    const ventes = vendus.reduce((s, l) => s + num(l.prix_vente), 0);
    const finis = L.filter(l => ['vendu', 'perdu'].includes(l.statut)).length;
    const taux = L.length ? Math.round(vendus.length / L.length * 100) : null;
    const souf = leads.filter(x => enSouffrance(x.lead));
    const an = String(new Date().getFullYear());
    const tuile = (l, v, s) => `<div class="kpi"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span><span class="kpi-s">${s}</span></div>`;
    return `<div class="donnees ap-page">
      <div class="ap-tete"><div><h2>Bonjour ${esc(moi.prenom)}</h2><span class="muted">${L.length} lead(s) envoyé(s) · ${garages.length} garage(s) dans le réseau</span></div></div>
      <div class="kpis">
        ${tuile('Commissions reçues', euros(recues) || '0 €', `${vendus.filter(l => l.payee).length} versement(s) · ${euros(vendus.filter(l => l.payee && (l.payee_le || '').startsWith(an)).reduce((s, l) => s + num(l.commission_finale), 0)) || '0 €'} en ${an}`)}
        ${tuile('À recevoir', euros(aRecevoir) || '0 €', `${vendus.filter(l => !l.payee).length} vente(s) en attente de virement`)}
        ${tuile('Montant des ventes', euros(ventes) || '0 €', `${vendus.length} véhicule(s) vendu(s) grâce à toi`)}
        ${tuile('Taux de transformation', taux === null ? '—' : taux + ' %', L.length ? `${vendus.length} vente(s) sur ${L.length} lead(s) · ${L.length - finis} en cours` : 'Apparaît après ton premier lead')}
      </div>
      <section class="panneau">
        <div class="p-tete"><h3>Leads en souffrance <span class="compte">${souf.length}</span></h3></div>
        <p class="hint">Pas pris en charge par le garage après 2 jours, ou sans nouvelle depuis 15 jours. Un appel au garage débloque souvent la situation.</p>
        ${souf.length ? `<div class="souffrance">${souf.map(x => `<div class="souf"><span><strong>${esc([x.lead.client_prenom, x.lead.client_nom].join(' '))}</strong>
          <small>${esc(x.lead.vehicule)} · ${esc(x.garage?.nom || '')} · ${STATUTS[x.lead.statut][0].toLowerCase()} depuis ${Math.floor((Date.now() - new Date(x.lead.statut === 'nouveau' ? x.lead.cree_le : x.lead.statut_le)) / jour)} j</small></span>
          ${x.garage?.telephone ? `<a class="chip" href="tel:${esc(x.garage.telephone)}">Appeler le garage</a>` : ''}</div>`).join('')}</div>`
          : '<p class="ok-vide">✓ Aucun lead en attente anormale.</p>'}
      </section>
      ${!/^\d{14}$/.test(moi.siret || '') || !moi.iban ? `<section class="panneau"><h3>Pour être payé</h3><p class="hint">Il manque ${[!/^\d{14}$/.test(moi.siret || '') && 'ton SIRET', !moi.iban && 'ton RIB'].filter(Boolean).join(' et ')} : sans eux, ta facture de commission ne peut pas être envoyée.</p>
        <button type="button" class="chip active" data-aller="parametres">Compléter mes paramètres</button></section>` : ''}
    </div>`;
  }

  // Véhicules du réseau (tous garages), filtrés.
  function vehicules() {
    const q = norm(filtres.q);
    return garages.flatMap(g => (g.vehicules || []).map(v => ({ g, v })))
      .filter(({ g, v }) => (!q || norm([nomV(v), v.couleur, v.annee, g.garage?.nom, g.garage?.ville].join(' ')).includes(q))
        && (!filtres.type || v.type === filtres.type) && (!filtres.carburant || v.carburant === filtres.carburant)
        && (!filtres.budget || (v.prix && num(v.prix) <= num(filtres.budget))));
  }
  function vueReseau() {
    const tous = garages.flatMap(g => g.vehicules || []);
    const opts = k => [...new Set(tous.map(v => v[k]).filter(Boolean))].sort();
    const liste = vehicules();
    if (moi.statut !== 'actif') return '<div class="empty"><strong>Compte suspendu</strong><span>Contacte Ocaz pour réactiver ton accès au réseau.</span></div>';
    return `<div class="ap-page">
      <div class="ap-tete"><h2>Véhicules du réseau</h2><span class="muted">${liste.length} véhicule(s)</span></div>
      <p class="hint ap-astuce">Touche un véhicule pour envoyer un lead au garage.</p>
      <div class="ap-filtres">
        <div class="search"><span class="ap-loupe">${icon('recherche', 18)}</span><input id="r-q" type="search" placeholder="Marque, modèle, ville…" value="${esc(filtres.q)}" autocomplete="off"></div>
        <select id="r-type" aria-label="Type"><option value="">Tous types</option>${opts('type').map(o => `<option${o === filtres.type ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>
        <select id="r-carburant" aria-label="Carburant"><option value="">Tous carburants</option>${opts('carburant').map(o => `<option${o === filtres.carburant ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>
        <input id="r-budget" type="number" inputmode="numeric" placeholder="Budget max (€)" value="${esc(filtres.budget)}" aria-label="Budget max">
      </div>
      <div class="ap-grille">${liste.length ? liste.map(({ g, v }) => {
        const p = (v.photos || [])[0], u = p && urls.get(p);
        return `<button type="button" class="ap-vehicule${v.reserve ? ' reserve' : ''}" data-g="${esc(g.entreprise_id)}" data-v="${esc(v.id)}"${v.reserve ? ' disabled' : ''}>
          <div class="ap-photo">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : icon('vehicules', 44)}${v.reserve ? '<span class="badge b-orange">Réservé</span>' : ''}</div>
          <div class="ap-info"><strong>${esc(nomV(v))}</strong>
            <span class="sub">${esc([v.annee, km(v.kilometrage), v.carburant, v.boite].filter(Boolean).join(' · '))}</span>
            <span class="sub">${esc([g.garage?.nom, g.garage?.ville].filter(Boolean).join(' · '))}</span>
            <span class="ap-prix"><b>${euros(v.prix) || 'Prix sur demande'}</b><span class="badge b-green">Commission ${euros(v.commission)}</span></span></div>
        </button>`;
      }).join('') : `<div class="empty"><strong>${tous.length ? 'Aucun véhicule ne correspond' : 'Aucun véhicule partagé pour le moment'}</strong>
        <span>${tous.length ? 'Essaie une autre recherche.' : 'Les garages du réseau ajoutent leurs véhicules au fil de l\'eau.'}</span></div>`}</div>
    </div>`;
  }

  // ---------- Création d'un lead ----------
  function ouvrirLead(gid, vid) {
    const g = garages.find(x => x.entreprise_id === gid), v = g?.vehicules.find(x => x.id === vid);
    if (!v) return;
    choix = { g, v };
    const u = urls.get((v.photos || [])[0]);
    $('#lead-body').innerHTML = `<div class="ap-choix">${u ? `<img src="${esc(u)}" alt="">` : ''}<div><strong>${esc(nomV(v))}</strong>
        <span class="sub">${esc([v.annee, km(v.kilometrage), v.carburant, v.boite, v.couleur].filter(Boolean).join(' · '))}</span>
        <span class="sub">${esc(g.garage?.nom || '')}${g.garage?.ville ? ' · ' + esc(g.garage.ville) : ''} · ${euros(v.prix) || 'prix sur demande'}</span>
        <span class="sub">Ta commission si la vente se fait : <b>${euros(v.commission)}</b>${v.commissionTexte ? ' (' + esc(v.commissionTexte.toLowerCase()) + ')' : ''}</span></div></div>
      ${v.texte ? `<details><summary>Annonce du garage</summary><p class="hint" style="white-space:pre-line">${esc(v.texte)}</p></details>` : ''}
      <h3 class="section">Ton contact</h3>
      <div class="grid">
        <div class="field"><label for="l-prenom">Prénom</label><input id="l-prenom" autocomplete="off"></div>
        <div class="field"><label for="l-nom">Nom *</label><input id="l-nom" autocomplete="off" required></div>
        <div class="field"><label for="l-tel">Téléphone *</label><input id="l-tel" type="tel" autocomplete="off" required></div>
        <div class="field"><label for="l-email">Email</label><input id="l-email" type="email" autocomplete="off"></div>
        <div class="field full"><label for="l-message">Message pour le garage</label><textarea id="l-message" placeholder="ex. veut l'essayer samedi matin, paiement comptant, cherche un financement…"></textarea></div>
      </div>
      <label class="check"><input type="checkbox" id="l-reprise"><span>Le client a un véhicule à faire reprendre</span></label>
      <div class="grid" id="l-reprise-champs" hidden>
        <div class="field"><label for="r-marque">Marque</label><input id="r-marque" data-r="marque"></div>
        <div class="field"><label for="r-modele">Modèle</label><input id="r-modele" data-r="modele"></div>
        <div class="field"><label for="r-annee">Année</label><input id="r-annee" data-r="annee" type="number" inputmode="numeric"></div>
        <div class="field"><label for="r-kilometrage">Kilométrage</label><input id="r-kilometrage" data-r="kilometrage" type="number" inputmode="numeric"></div>
        <div class="field"><label for="r-immatriculation">Plaque</label><input id="r-immatriculation" data-r="immatriculation" autocapitalize="characters"></div>
        <div class="field"><label for="r-carburant">Carburant</label><select id="r-carburant" data-r="carburant">${['', 'Essence', 'Diesel', 'Hybride', 'Hybride rechargeable', 'Électrique', 'GPL'].map(o => `<option>${o}</option>`).join('')}</select></div>
        <div class="field"><label for="r-etat">État</label><select id="r-etat" data-r="etat">${['', 'Très bon', 'Bon', 'Moyen', 'À rénover'].map(o => `<option>${o}</option>`).join('')}</select></div>
        <div class="field"><label for="r-prixSouhaite">Prix souhaité (€)</label><input id="r-prixSouhaite" data-r="prixSouhaite" type="number" inputmode="numeric"></div>
        <div class="field full"><label for="r-notes">Remarques (entretien, défauts…)</label><textarea id="r-notes" data-r="notes"></textarea></div>
      </div>
      <label class="check ap-consent"><input type="checkbox" id="l-accord"><span>Mon contact a accepté que je transmette son nom et son téléphone à <b>${esc(g.garage?.nom || 'ce garage')}</b>, pour être recontacté au sujet de ce véhicule. *</span></label>
      <p class="hint">Le garage te tient au courant ici : pris en charge, vendu ou clos. Commission versée par le garage directement sur ton compte.</p>`;
    $('#l-reprise').addEventListener('change', e => { $('#l-reprise-champs').hidden = !e.target.checked; });
    $('#dlg-lead').showModal();
  }
  async function envoyerLead(e) {
    e.preventDefault();
    const nom = $('#l-nom').value.trim(), tel = $('#l-tel').value.trim();
    if (!nom || tel.replace(/\D/g, '').length < 6) { toast('Nom et téléphone du client obligatoires.'); return; }
    if (!$('#l-accord').checked) { toast('Coche l\'accord du client pour transmettre ses coordonnées.'); return; }
    let reprise = null;
    if ($('#l-reprise').checked) {
      reprise = {};
      document.querySelectorAll('[data-r]').forEach(el => { if (el.value.trim()) reprise[el.dataset.r] = el.value.trim(); });
      if (!Object.keys(reprise).length) reprise = null;
    }
    const btn = $('#lead-envoyer');
    btn.disabled = true;
    try {
      await rpc('crm_lead_creer', { p_garage: choix.g.entreprise_id, p_vid: choix.v.id, p_prenom: $('#l-prenom').value.trim(), p_nom: nom, p_tel: tel,
        p_email: $('#l-email').value.trim(), p_message: $('#l-message').value.trim(), p_reprise: reprise, p_consentement: true });
      $('#dlg-lead').close();
      toast(`Lead envoyé à ${choix.g.garage?.nom || 'au garage'} ✓`);
      await chargerLeads();
      vue = 'En cours';
      afficher('leads');
    } catch (err) { toast(err.message); }
    finally { btn.disabled = false; }
  }

  // ---------- Paramètres ----------
  function vueParametres() {
    const vendus = leads.filter(x => x.lead.statut === 'vendu');
    const ch = (k, l, cls = '', type = 'text') => `<div class="field ${cls}"><label for="p-${k}">${l}</label><input id="p-${k}" data-p="${k}" type="${type}"></div>`;
    const fixe = (l, v, cls = '') => `<div class="field ${cls}"><label>${l}</label><input value="${esc(v || '')}" disabled></div>`;
    const signe = !!moi.contrat_signe_le;
    return `<div class="parametres ap-param"><div class="p-col">
      <section class="panneau"><h2>Mes infos</h2>
        <p class="muted">Elles figurent sur tes factures de commission. Pour changer ton nom, ton adresse ou ton SIRET,
          <a href="mailto:contact@ocaz.re?subject=Modifier%20mes%20infos%20apporteur">contacte l'administrateur</a>.</p>
        <div class="grid">${fixe('Prénom', moi.prenom)}${fixe('Nom', moi.nom)}${ch('telephone', 'Téléphone', '', 'tel')}${fixe('Email', moi.email)}
          ${fixe('Adresse', [moi.adresse, moi.code_postal, moi.ville].filter(Boolean).join(' '), 'full')}
          ${fixe('Statut', Commission.FORMES[moi.forme])}${fixe('SIRET', moi.siret)}</div>
      </section>
      <section class="panneau"><h2>Mon RIB</h2>
        <p class="muted">Montré seulement au garage d'une vente conclue, pour qu'il te verse ta commission.</p>
        <div class="grid">${ch('iban', 'IBAN', 'full')}${ch('bic', 'BIC')}${ch('titulaire', 'Titulaire du compte')}</div>
        <div class="p-actions"><span class="spacer"></span><button type="button" id="btn-p-save" class="primary">Enregistrer</button></div>
      </section></div>
      <div class="p-col">
      <section class="panneau"><h2>Mon contrat</h2>
        ${signe ? `<p class="muted">Contrat d'apporteur d'affaires du réseau Ocaz, signé en ligne le ${dateFr(moi.contrat_signe_le)} (« ${esc(moi.signature)} »).</p>
          <button type="button" id="btn-contrat">Voir / imprimer mon contrat</button>`
        : `<p class="muted">Lis le contrat d'apporteur d'affaires du réseau Ocaz, puis signe-le en tapant ton prénom et ton nom.</p>
          <div class="ap-contrat" tabindex="0">${Commission.contratHtml()}</div>
          <label class="check"><input type="checkbox" id="s-accepte"><span>J'ai lu le contrat et je l'accepte, ainsi que les <a href="https://reseau.ocaz.re/cgu" target="_blank">CGU</a> et la <a href="https://reseau.ocaz.re/confidentialite" target="_blank">politique de confidentialité</a>.</span></label>
          <label class="check"><input type="checkbox" id="s-certifie"><span>Je déclarerai moi-même mes commissions (URSSAF, impôts).</span></label>
          <div class="field"><label for="s-signature">Signature : prénom et nom</label><input id="s-signature" autocomplete="name"></div>
          <div class="p-actions"><span class="spacer"></span><button type="button" id="btn-signer" class="primary">Signer le contrat</button></div>`}
      </section>
      <section class="panneau"><h2>Mes factures de commission</h2>
        <p class="muted">Une facture par vente, numérotée automatiquement. Envoie-la au garage (PDF) ; il te paie par virement.</p>
        ${vendus.length ? `<div class="souffrance">${vendus.map(x => `<button type="button" class="souf" data-facture="${x.lead.id}"><span><strong>${esc(x.lead.facture_numero)} · ${euros(x.lead.commission_finale)}</strong>
          <small>${esc(x.garage?.nom || '')} · ${esc(x.lead.vehicule)} · ${dateFr(x.lead.vendu_le)}</small></span><span class="badge ${x.lead.payee ? 'b-green' : 'b-orange'}">${x.lead.payee ? 'Payée' : 'À recevoir'}</span></button>`).join('')}</div>`
          : '<p class="hint">Ta première facture apparaîtra ici dès qu\'un garage marquera une vente.</p>'}
      </section>
      <section class="panneau"><h2>Compte</h2>
        <p class="hint">Connecté : ${esc(moi.email)}${moi.demo ? ' · compte de démo' : ''}</p>
        ${moi.demo ? '' : `<details><summary>Changer mon mot de passe</summary><div class="stack" style="margin-top:8px">
          <input id="m-1" type="password" placeholder="Nouveau mot de passe (8 caractères min.)" autocomplete="new-password">
          <input id="m-2" type="password" placeholder="Confirme" autocomplete="new-password">
          <button type="button" id="btn-mdp" class="primary">Enregistrer le mot de passe</button></div></details>`}
        <div class="p-actions"><button type="button" id="btn-sortir">Se déconnecter</button></div>
      </section></div></div>`;
  }
  function remplirParametres() {
    document.querySelectorAll('[data-p]').forEach(el => { el.value = moi[el.dataset.p] || ''; });
    $('#btn-p-save').addEventListener('click', async () => {
      const infos = {};
      document.querySelectorAll('[data-p]').forEach(el => { infos[el.dataset.p] = el.value.trim(); });
      try { moi = await rpc('crm_apporteur_maj', { p_infos: infos }); toast('Infos enregistrées'); afficher('parametres'); } catch (err) { toast(err.message); }
    });
    $('#btn-contrat')?.addEventListener('click', () => { if (!Commission.imprimerContrat(moi)) toast("Autorise l'ouverture de fenêtres pour imprimer."); });
    $('#btn-signer')?.addEventListener('click', async () => {
      const signature = $('#s-signature').value.trim();
      if (!$('#s-accepte').checked || !$('#s-certifie').checked) { toast('Coche les deux cases du contrat.'); return; }
      if (!signature) { toast('Signe en tapant ton prénom et ton nom.'); return; }
      try { moi = await rpc('crm_apporteur_signer', { p_contrat: Commission.VERSION, p_signature: signature }); toast('Contrat signé : bienvenue dans le réseau Ocaz !'); afficher('reseau'); }
      catch (err) { toast(err.message); }
    });
    $('#btn-sortir').addEventListener('click', deconnecter);
    $('#btn-mdp')?.addEventListener('click', async () => {
      const m1 = $('#m-1').value;
      if (m1.length < 8) { toast('8 caractères minimum.'); return; }
      if (m1 !== $('#m-2').value) { toast('Les deux mots de passe ne sont pas identiques.'); return; }
      const { error } = await client.auth.updateUser({ password: m1 });
      toast(error ? error.message : 'Mot de passe changé');
    });
  }
  function facture(id) {
    const x = leads.find(y => y.lead.id === id);
    if (!x) return;
    const g = { ...(x.garage || {}), ...(x.garage_facture || {}) };
    if (!Commission.imprimerFacture(moi, x.lead, g)) toast("Autorise l'ouverture de fenêtres pour imprimer.");
  }

  async function deconnecter() {
    if (canal) { client.removeChannel(canal); canal = null; }
    await client.auth.signOut();
    moi = null; leads = []; garages = [];
    $('#vue').innerHTML = '';
    versConnexion();
  }

  // ---------- Mot de passe de départ ----------
  async function nouveauMdp(e) {
    e.preventDefault();
    const m1 = $('#n-mdp').value;
    if (m1.length < 8) { erreur('Le mot de passe doit faire au moins 8 caractères.'); return; }
    if (m1 === '12345678') { erreur('Choisis un mot de passe différent de celui de départ.'); return; }
    if (m1 !== $('#n-mdp2').value) { erreur('Les deux mots de passe ne sont pas identiques.'); return; }
    erreur('');
    const { error } = await client.auth.updateUser({ password: m1 });
    if (error) { erreur(error.message); return; }
    try { await rpc('crm_apporteur_mdp_change'); } catch (err) { /* base pas à jour */ }
    toast('Mot de passe enregistré');
    await demarrer();
  }

  // ---------- Démarrage ----------
  function init() {
    document.querySelectorAll('[data-tab]').forEach(b => {
      const ic = { leads: 'commandes', donnees: 'donnees', reseau: 'vehicules', parametres: 'reglages' }[b.dataset.tab];
      b.innerHTML = icon(ic, b.closest('#bottom-tabs') ? 22 : 18) + '<span>' + b.textContent + '</span>';
      b.addEventListener('click', () => afficher(b.dataset.tab));
    });
    // Paramètres : icône en haut à droite de l'en-tête, comme chez les garages.
    $('#btn-menu').innerHTML = icon('reglages', 20);
    $('#btn-menu').addEventListener('click', () => afficher('parametres'));
    $('#f-mdp').addEventListener('submit', nouveauMdp);
    $('#auth-sortir').addEventListener('click', deconnecter);
    $('#btn-espace').addEventListener('click', () => preferer('garage'));
    $('#f-lead').addEventListener('submit', envoyerLead);
    $('#lead-fermer').addEventListener('click', () => $('#dlg-lead').close());
    $('#lead-annuler').addEventListener('click', () => $('#dlg-lead').close());
    $('#vue').addEventListener('click', e => {
      const b = e.target.closest('[data-vue],[data-aller],[data-facture],.ap-vehicule');
      if (!b) return;
      if (b.dataset.vue) { vue = b.dataset.vue; afficher('leads'); }
      else if (b.dataset.aller) afficher(b.dataset.aller);
      else if (b.dataset.facture) facture(b.dataset.facture);
      else ouvrirLead(b.dataset.g, b.dataset.v);
    });
    $('#vue').addEventListener('input', e => {
      const k = { 'r-q': 'q', 'r-type': 'type', 'r-carburant': 'carburant', 'r-budget': 'budget' }[e.target.id];
      if (!k) return;
      filtres[k] = e.target.value;
      // On ne reconstruit que la grille, pour garder le focus dans la recherche.
      const tmp = document.createElement('div');
      tmp.innerHTML = vueReseau();
      $('#vue .ap-grille').replaceWith(tmp.querySelector('.ap-grille'));
      $('#vue .ap-tete .muted').textContent = `${vehicules().length} véhicule(s)`;
    });
    const s = reglages();
    if (!s.url || !s.cle || !window.supabase) { versConnexion(); return; }
    client = window.supabase.createClient(s.url, s.cle, { auth: { persistSession: true, detectSessionInUrl: false, storage: stockage } });
    client.auth.onAuthStateChange((event, session) => {
      const avant = user;
      user = session?.user || null;
      if (user && (!avant || avant.id !== user.id)) setTimeout(demarrer);
    });
    client.auth.getSession().then(({ data }) => {
      user = data.session?.user || null;
      if (user) demarrer(); else versConnexion();
    });
  }
  init();
})();
