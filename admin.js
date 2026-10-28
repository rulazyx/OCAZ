// Interface de l'administrateur d'Ocaz (super-admin seulement), pensée pour faire grandir le réseau jusqu'à une centaine de garages :
// Tableau de bord (activité de chaque garage), Prospection (garages à signer), Partenaires (revendeurs et apporteurs),
// Abonnements (revenu mensuel, essais, impayés), Leads réseau (tous les leads) et Annonces (bandeau chez les partenaires).
// L'administrateur est le seul à créer les comptes : infos légales, droits (réseau Ocaz, dépôt-vente, achat-revente)
// et packs livraison de chaque revendeur ; fiche complète de chaque apporteur. Mot de passe de départ : 12345678.
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const dateFr = d => d ? new Date(d).toLocaleDateString('fr-FR') : '';
  const emailOk = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
  const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const INFOS = [['nom', "Nom de l'entreprise *", 'full'], ['siret', 'SIRET'], ['tva', 'N° TVA intracom.'], ['adresse', 'Adresse', 'full'],
    ['codePostal', 'Code postal'], ['ville', 'Ville'], ['telephone', 'Téléphone', '', 'tel'], ['email', 'Email affiché sur les documents', '', 'email'], ['site', 'Site web', 'full']];
  const DROITS = [['reseau', 'Rejoindre le réseau Ocaz', 'Ses véhicules sont partagés avec les apporteurs et sur le site du réseau ; il reçoit des leads.'],
    ['depot', 'Dépôt-vente', 'Onglet « Dépôt vente ».'], ['achat', 'Achat-revente', 'Onglet « Reprise » et stock de véhicules achetés.']];
  // Abonnement revendeur : suivi à la main en attendant Stripe. Premier mois offert, sans engagement.
  const PRIX = 69.99;
  const ABO = { essai: ['Essai gratuit', 'b-orange'], actif: ['Abonné', 'b-green'], impaye: ['Impayé', 'b-red'], resilie: ['Résilié', 'b-grey'], offert: ['Offert', 'b-purple'] };
  const auj = () => new Date().toISOString().slice(0, 10);
  const finEssai = debut => { const d = new Date(debut + 'T12:00:00'); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10); };
  const OBJECTIF = 30, CAP = 100; // 30 abonnés d'ici avril 2027, puis une centaine de garages partenaires
  // Paliers du nombre de garages partenaires : 5 pour la phase test, 30 d'ici avril 2027, puis 100.
  const PALIERS = [[5, 'Phase test'], [OBJECTIF, 'Avril 2027'], [CAP, 'Le réseau complet']];
  const palierSuivant = n => PALIERS.find(([v]) => n < v) || PALIERS[PALIERS.length - 1];
  function paliers(n) {
    return `<div class="adm-paliers">${PALIERS.map(([v, l], i) => {
      const bas = i ? PALIERS[i - 1][0] : 0, fait = n >= v, encours = !fait && n >= bas;
      return `<div class="adm-palier${fait ? ' fait' : encours ? ' encours' : ''}">
        <span><b>${fait ? '✓ ' : ''}${v} partenaires</b><small>${l}${encours ? ` · ${n} / ${v}` : ''}</small></span>
        <div class="adm-barre"><span style="width:${fait ? 100 : encours ? Math.round((n - bas) / (v - bas) * 100) : 0}%"></span></div></div>`;
    }).join('')}</div>`;
  }
  const jours = d => Math.round((new Date(d + 'T12:00:00') - new Date(auj() + 'T12:00:00')) / 864e5);
  // Prochain prélèvement : fin de l'essai, puis le même jour chaque mois.
  function prochainPaiement(debut) {
    const d = new Date(finEssai(debut) + 'T12:00:00'), a = auj();
    while (d.toISOString().slice(0, 10) < a) d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  }
  const eur = n => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const PACKS = [{ id: 'demarches', nom: 'Démarches administratives', montant: 150, coche: true }, { id: 'protection', nom: 'Protection de peinture', montant: 250, coche: false }];
  const APP = [['prenom', 'Prénom *'], ['nom', 'Nom *'], ['telephone', 'Téléphone', '', 'tel'], ['adresse', 'Adresse', 'full'], ['code_postal', 'Code postal'], ['ville', 'Ville'],
    ['siret', 'SIRET (14 chiffres)'], ['raison_sociale', 'Nom de la société'], ['tva', 'N° de TVA'], ['iban', 'IBAN', 'full'], ['bic', 'BIC'], ['titulaire', 'Titulaire du compte']];

  let client = null, user = null;
  let revendeurs = [], apporteurs = [];
  let onglet = 'tableau', vue = 'revendeurs', q = '', filtreAbo = 'tous', filtrePro = 'encours', filtreLead = 'tous';
  let tableau = null, prospects = null, leads = null, annonces = null; // chargés à l'ouverture de leur onglet
  let pro = null; // fiche prospect ouverte
  let etapes = null, editionEtapes = false, etapesAvant = null; // mes étapes (tableau de bord)
  let rev = null, app = null; // fiches ouvertes

  function toast(msg) {
    const t = $('#toast');
    ([...document.querySelectorAll('dialog[open]')].pop() || document.body).appendChild(t);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 3200);
  }
  async function rpc(nom, args) {
    const { data, error } = await client.rpc(nom, args);
    if (error) throw new Error(/function|schema cache/i.test(error.message) ? "La base n'est pas à jour : relance le script supabase.sql." : error.message);
    return data;
  }

  // ---------- Connexion (mêmes réglages que l'appli) ----------
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
  const preferer = e => { try { localStorage.setItem('ocaz-espace', e); } catch (err) { /* rien */ } };

  async function demarrer() {
    try {
      const moi = await rpc('crm_moi');
      if (!moi?.superadmin) { location.replace('./'); return; }
      document.body.classList.remove('verrouille');
      $('#auth').hidden = true;
      $('#compte-email').textContent = 'Connecté : ' + user.email;
      Messagerie.moderer({ client, bouton: $('#btn-msg') });
      await charger();
      rafraichir();
    } catch (err) { $('#auth-texte').textContent = err.message; }
  }
  async function charger() {
    try {
      [revendeurs, apporteurs] = await Promise.all([rpc('crm_admin_revendeurs'), rpc('crm_apporteurs_liste')]);
    } catch (err) { toast(err.message); }
    afficher();
  }
  // Données de l'onglet ouvert, rechargées à chaque visite.
  function rafraichir() {
    ({ tableau: chargerTableau, prospection: chargerProspects, leads: chargerLeads, annonces: chargerAnnonces }[onglet] || charger)();
  }

  // ---------- Onglet Partenaires ----------
  const droitsDe = c => c?.droits || { reseau: false, depot: true, achat: true };
  function carteRevendeur(g) {
    const c = g.config || {}, d = droitsDe(c), i = c.infos || {};
    const comptes = g.comptes || [];
    return `<button type="button" class="card" data-rev="${esc(g.id)}">
      <div class="top"><span class="title">${esc(g.nom)}</span>
        <span class="c-badges">${g.demo ? '<span class="badge b-orange">Démo</span>' : ''}${g.admin ? '<span class="badge b-grey">Ton garage</span>' : ''}${c.droits ? '' : '<span class="badge b-purple">Droits à régler</span>'}${badgeAbo(g)}</span></div>
      <div class="sub">${esc([i.ville, i.telephone, i.siret && 'SIRET ' + i.siret].filter(Boolean).join(' · ') || 'Infos à compléter')}</div>
      <div class="sub">${esc(comptes.map(x => x.email).join(', ') || 'Aucun compte')}${comptes.some(x => x.doit_changer_mdp) ? ' · mot de passe de départ' : ''}</div>
      <div class="adm-droits">${DROITS.map(([k, l]) => `<span class="badge ${d[k] ? 'b-green' : 'b-grey off'}">${l.replace('Rejoindre le réseau Ocaz', 'Réseau Ocaz')}</span>`).join('')}</div>
    </button>`;
  }
  function badgeAbo(g) {
    if (g.demo || g.admin) return '';
    const a = g.config?.abonnement;
    if (!a?.statut) return '<span class="badge b-purple">Abonnement à régler</span>';
    const [l, cls] = ABO[a.statut] || ABO.essai;
    return `<span class="badge ${cls}">${l}${a.statut === 'essai' && a.debut ? " jusqu'au " + dateFr(finEssai(a.debut)) : ''}</span>`;
  }
  function carteApporteur(a) {
    return `<button type="button" class="card" data-app="${esc(a.email)}">
      <div class="top"><span class="title">${esc([a.prenom, a.nom].join(' '))}</span>
        <span class="c-badges">${a.demo ? '<span class="badge b-orange">Démo</span>' : ''}<span class="badge ${a.statut === 'actif' ? 'b-green' : 'b-red'}">${a.statut === 'actif' ? 'Actif' : 'Suspendu'}</span></span></div>
      <div class="sub">${esc([a.email, a.telephone, a.ville].filter(Boolean).join(' · '))}</div>
      <div class="sub">${esc(Commission.FORMES[a.forme] || '')}${a.siret ? ' · SIRET ' + esc(a.siret) : ''} · ${a.leads} lead(s), ${a.ventes} vente(s)</div>
      <div class="sub">${a.contrat_signe_le ? 'Contrat signé le ' + dateFr(a.contrat_signe_le) : 'Contrat pas encore signé'}${a.doit_changer_mdp ? ' · mot de passe de départ' : ''}</div>
    </button>`;
  }
  function afficher() {
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === onglet));
    ({ tableau: afficherTableau, prospection: afficherProspection, abonnements: afficherAbonnements, leads: afficherLeads, annonces: afficherAnnonces }[onglet] || afficherPartenaires)();
  }
  function afficherPartenaires() {
    const liste = vue === 'revendeurs'
      ? revendeurs.filter(g => !q || norm([g.nom, JSON.stringify(g.config?.infos || {}), (g.comptes || []).map(c => c.email).join(' ')].join(' ')).includes(norm(q)))
      : apporteurs.filter(a => !q || norm([a.prenom, a.nom, a.email, a.telephone, a.ville].join(' ')).includes(norm(q)));
    $('#vue').innerHTML = `<div class="ap-page">
      <div class="adm-tete"><h2>Partenaires</h2>
        <button type="button" class="primary" id="btn-ajouter">${icon('plus', 18)}<span>${vue === 'revendeurs' ? 'Ajouter un revendeur' : 'Ajouter un apporteur'}</span></button></div>
      <div class="adm-outils"><div class="segmented">
        <button type="button" data-vue="revendeurs" class="${vue === 'revendeurs' ? 'active' : ''}">Revendeurs (${revendeurs.length})</button>
        <button type="button" data-vue="apporteurs" class="${vue === 'apporteurs' ? 'active' : ''}">Apporteurs (${apporteurs.length})</button></div>
        <div class="search"><span class="ap-loupe">${icon('recherche', 18)}</span><input id="adm-q" type="search" placeholder="Rechercher…" value="${esc(q)}" autocomplete="off"></div></div>
      <div class="adm-liste">${liste.length ? liste.map(vue === 'revendeurs' ? carteRevendeur : carteApporteur).join('')
        : `<div class="empty"><strong>${q ? 'Aucun résultat' : vue === 'revendeurs' ? 'Aucun revendeur' : 'Aucun apporteur'}</strong><span>${q ? 'Essaie une autre recherche.' : 'Ajoute le premier avec le bouton ci-dessus.'}</span></div>`}</div>
    </div>`;
  }

  // ---------- Onglet Abonnements ----------
  const payants = () => revendeurs.filter(g => !g.demo && !g.admin);
  const statutDe = g => g.config?.abonnement?.statut || 'aregler';
  function detailAbo(g) {
    const a = g.config?.abonnement || {};
    if (!a.statut) return "Pas encore réglé : ouvre-le pour lancer son essai gratuit.";
    if (a.statut === 'essai') {
      const f = finEssai(a.debut || auj()), n = jours(f);
      return n < 0 ? `Essai terminé le ${dateFr(f)} : passe-le en « Abonné » s'il a payé.` : `Fin de l'essai le ${dateFr(f)} (${n ? 'dans ' + n + ' j' : "aujourd'hui"}), premier paiement ce jour-là.`;
    }
    if (a.statut === 'actif') return `Abonné depuis le ${dateFr(finEssai(a.debut || auj()))} · prochain paiement le ${dateFr(prochainPaiement(a.debut || auj()))}`;
    if (a.statut === 'impaye') return `Paiement en retard${a.maj ? ' depuis le ' + dateFr(a.maj) : ''} : relance-le.`;
    if (a.statut === 'resilie') return `Résilié${a.fin ? ' le ' + dateFr(a.fin) : ''}.`;
    return 'Offert : rien à payer.';
  }
  // À traiter : impayés, essais qui se terminent dans 7 jours (ou déjà finis), revendeurs sans abonnement réglé.
  const aTraiter = g => {
    const a = g.config?.abonnement;
    return !a?.statut || a.statut === 'impaye' || (a.statut === 'essai' && jours(finEssai(a.debut || auj())) <= 7);
  };
  function ligneAbo(g) {
    const st = statutDe(g);
    return `<div class="adm-abo-ligne">
      <button type="button" class="adm-abo-nom" data-rev="${esc(g.id)}"><b>${esc(g.nom)}</b><small>${esc(detailAbo(g))}</small></button>
      <select data-abo="${esc(g.id)}" aria-label="Statut de l'abonnement de ${esc(g.nom)}">
        ${st === 'aregler' ? '<option value="" selected>À régler</option>' : ''}
        ${Object.entries(ABO).map(([k, [l]]) => `<option value="${k}"${st === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </div>`;
  }
  function afficherAbonnements() {
    const tous = payants();
    const n = st => tous.filter(g => statutDe(g) === st).length;
    const actifs = n('actif'), essais = n('essai'), impayes = n('impaye');
    const partenaires = actifs + essais + impayes + n('offert');
    const urgents = tous.filter(aTraiter);
    const FILTRES = [['tous', 'Tous', tous.length], ['actif', 'Abonnés', actifs], ['essai', 'En essai', essais], ['impaye', 'Impayés', impayes],
      ['resilie', 'Résiliés', n('resilie')], ['offert', 'Offerts', n('offert')], ['aregler', 'À régler', n('aregler')]].filter(([k, , c]) => k === 'tous' || c);
    if (!FILTRES.some(([k]) => k === filtreAbo)) filtreAbo = 'tous';
    const liste = tous.filter(g => filtreAbo === 'tous' || statutDe(g) === filtreAbo)
      .filter(g => !q || norm(g.nom).includes(norm(q)));
    $('#vue').innerHTML = `<div class="ap-page">
      <div class="adm-tete"><h2>Abonnements</h2><span class="hint">${eur(PRIX)} par mois · premier mois offert · sans engagement</span></div>
      <div class="kpis">
        <div class="kpi"><span class="kpi-l">Revenu mensuel</span><span class="kpi-v">${eur(actifs * PRIX)}</span><span class="kpi-s">${actifs} abonné(s) qui paient</span></div>
        <div class="kpi"><span class="kpi-l">En essai gratuit</span><span class="kpi-v">${essais}</span><span class="kpi-s">${essais ? '+' + eur(essais * PRIX) + " s'ils restent" : 'Aucun en ce moment'}</span></div>
        <div class="kpi${impayes ? ' negatif' : ''}"><span class="kpi-l">Impayés</span><span class="kpi-v">${impayes}</span><span class="kpi-s">${impayes ? eur(impayes * PRIX) + ' en attente' : 'Tout est à jour'}</span></div>
        <div class="kpi"><span class="kpi-l">Revenu à ${CAP} garages</span><span class="kpi-v">${eur(CAP * PRIX)}</span><span class="kpi-s">par mois, ${eur(CAP * PRIX * 12)} par an</span></div>
      </div>
      <div class="adm-bloc adm-objectifs">
        <div><span>Garages partenaires : <b>${partenaires}</b> <small class="hint">(abonnés, essais, impayés et offerts)</small></span>${paliers(partenaires)}</div>
      </div>
      ${urgents.length ? `<h3 class="section">À traiter (${urgents.length})</h3><div class="adm-bloc adm-abo-liste">${urgents.map(ligneAbo).join('')}</div>` : ''}
      <h3 class="section">Tous les revendeurs</h3>
      <div class="adm-outils"><div class="chips">${FILTRES.map(([k, l, c]) => `<button type="button" class="chip${filtreAbo === k ? ' active' : ''}" data-filtre="${k}">${l} (${c})</button>`).join('')}</div>
        <div class="search"><span class="ap-loupe">${icon('recherche', 18)}</span><input id="adm-q" type="search" placeholder="Rechercher un revendeur…" value="${esc(q)}" autocomplete="off"></div></div>
      <div class="adm-bloc adm-abo-liste">${liste.length ? liste.map(ligneAbo).join('')
        : `<div class="empty"><strong>${tous.length ? 'Aucun résultat' : 'Aucun revendeur payant'}</strong><span>${tous.length ? 'Essaie un autre filtre.' : 'Ajoute-les dans l\'onglet Partenaires.'}</span></div>`}</div>
      <p class="hint">Mis à jour à la main pour l'instant. Une fois Stripe branché, les statuts changeront tout seuls.</p>
    </div>`;
  }
  async function changerAbo(id, statut, select) {
    const g = revendeurs.find(x => x.id === id);
    if (!g || !statut) return;
    const c = g.config || {};
    const a = { debut: auj(), ...(c.abonnement || {}), statut, maj: auj() };
    if (statut === 'essai' && !c.abonnement?.statut) a.debut = auj();
    if (statut === 'resilie') a.fin = auj(); else delete a.fin;
    const config = { ...c, infos: { ...(c.infos || {}), nom: c.infos?.nom || g.nom }, abonnement: a };
    select.disabled = true;
    try {
      await rpc('crm_admin_revendeur_enregistrer', { p_id: id, p_email: '', p_config: config });
      g.config = config;
      toast(`${g.nom} : ${ABO[statut][0]}`);
    } catch (err) { toast(err.message); }
    afficher();
  }

  // ---------- Onglet Tableau de bord ----------
  const ilYa = d => { if (!d) return 'jamais'; const n = Math.floor((Date.now() - new Date(d)) / 864e5); return n <= 0 ? "aujourd'hui" : n === 1 ? 'hier' : `il y a ${n} j`; };
  const joursDepuis = d => d ? Math.floor((Date.now() - new Date(d)) / 864e5) : Infinity;
  const kpi = (l, v, s, cls) => `<div class="kpi${cls ? ' ' + cls : ''}"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span><span class="kpi-s">${s}</span></div>`;
  const barre = (v, max) => `<div class="adm-barre"><span style="width:${Math.min(100, Math.round(v / max * 100))}%"></span></div>`;
  function afficherTableau() {
    if (!tableau) { $('#vue').innerHTML = '<div class="ap-page"><p class="hint">Chargement…</p></div>'; return; }
    const reels = tableau.garages.filter(g => !g.demo && !g.admin);
    const partenaires = reels.filter(g => ['essai', 'actif', 'impaye', 'offert'].includes(g.abonnement));
    const actifs = reels.filter(g => g.abonnement === 'actif').length;
    const endormis = partenaires.filter(g => joursDepuis(g.derniere_connexion) >= 14);
    const attente = reels.filter(g => g.leads_attente > 0);
    const signes = prospects ? prospects.filter(p => p.etape === 'signe').length : null;
    const ligne = g => `<tr data-rev="${esc(g.id)}"><td><b>${esc(g.nom)}</b>${g.demo ? ' <span class="badge b-orange">Démo</span>' : ''}${g.admin ? ' <span class="badge b-grey">Ton garage</span>' : ''}
        ${g.abonnement && ABO[g.abonnement] ? ` <span class="badge ${ABO[g.abonnement][1]}">${ABO[g.abonnement][0]}</span>` : ''}</td>
      <td>${ilYa(g.derniere_connexion)}</td><td>${g.stock}</td><td>${g.en_ligne}</td><td>${g.offres_30j}</td><td>${g.ventes_30j}</td>
      <td>${g.leads_30j}${g.leads_attente ? ` <span class="badge b-red">${g.leads_attente} en attente</span>` : ''}</td></tr>`;
    $('#vue').innerHTML = `<div class="ap-page">
      <div class="adm-tete"><h2>Tableau de bord</h2><button type="button" id="btn-actualiser">Actualiser</button></div>
      <div class="kpis">
        ${kpi('Garages partenaires', partenaires.length, `${actifs} abonné(s) · prochain palier ${palierSuivant(partenaires.length)[0]}`)}
        ${kpi('Revenu mensuel', eur(actifs * PRIX), `${eur(CAP * PRIX)} à ${CAP} garages`)}
        ${kpi('Leads (30 jours)', tableau.leads_30j, `${tableau.ventes_reseau_30j} vente(s) grâce au réseau`)}
        ${kpi('Apporteurs actifs', tableau.apporteurs, 'qui envoient des clients')}
      </div>
      <div class="adm-bloc adm-objectifs">
        <div><span>Garages partenaires : <b>${partenaires.length}</b></span>${paliers(partenaires.length)}</div>
        ${signes != null ? `<div><span>Prospection : <b>${signes}</b> signé(s) sur ${prospects.length} garage(s) démarché(s)</span>${barre(signes, Math.max(prospects.length, 1))}</div>` : ''}
      </div>
      ${blocEtapes()}
      ${endormis.length || attente.length ? `<h3 class="section">À surveiller</h3><div class="adm-bloc">
        ${endormis.map(g => `<div class="adm-compte"><span><b>${esc(g.nom)}</b><small>Pas connecté depuis ${joursDepuis(g.derniere_connexion) === Infinity ? 'le début' : joursDepuis(g.derniere_connexion) + ' jours'} : appelle-le avant qu'il résilie.</small></span></div>`).join('')}
        ${attente.map(g => `<div class="adm-compte"><span><b>${esc(g.nom)}</b><small>${g.leads_attente} lead(s) pas encore pris en charge.</small></span></div>`).join('')}
      </div>` : ''}
      <h3 class="section">Activité des garages</h3>
      <div class="adm-table-scroll"><table class="adm-table">
        <thead><tr><th>Garage</th><th>Dernière connexion</th><th>Stock</th><th>Sur le réseau</th><th>Offres 30 j</th><th>Ventes 30 j</th><th>Leads 30 j</th></tr></thead>
        <tbody>${tableau.garages.map(ligne).join('') || '<tr><td colspan="7">Aucun garage.</td></tr>'}</tbody></table></div>
    </div>`;
  }
  // Mes étapes : la feuille de route d'Anthony (reprise du doc « Étapes »), modifiable ici.
  const STATUTS_ETAPE = { a_faire: ['À faire', 'b-grey'], en_cours: ['En cours', 'b-orange'], fait: ['Fait', 'b-green'], plus_tard: ['Plus tard', 'b-purple'] };
  // Préparer la prospection (28/10) : avant d'aller voir les 5 premiers garages testeurs.
  const PROSPECTION_ETAPES = [
    ['8.1 Préparer une démo fiable', 'a_faire', 'Compte revendeur/test rempli avec photos, testé en 4G, et une capture vidéo de secours de 2 minutes.', 'pr1'],
    ["8.2 Rédiger l'offre garage testeur", 'a_faire', 'Une demi-page à laisser : 2 mois gratuits, un point par semaine, puis 69,99 €/mois.', 'pr2'],
    ['8.3 Répéter la démo', 'a_faire', 'Le parcours de démo en 5 minutes et les réponses aux objections.', 'pr3'],
    ['8.4 Préparer les comptes la veille', 'a_faire', "Compte créé dans l'admin et stock Leboncoin importé avant la visite.", 'pr4'],
    ['8.5 Organiser les tournées par zone', 'a_faire', '3 ou 4 garages par demi-journée, de 9 h 30 à 11 h ou de 14 h à 15 h 30.', 'pr5'],
    ['8.6 Noter chaque visite le jour même', 'a_faire', "Dans l'onglet Prospection : étape, date de relance, remarques.", 'pr6'],
    ['8.7 Tenir une fiche des retours testeurs', 'a_faire', "Ce qui plaît, ce qui manque, ce qui bloque, garage par garage.", 'pr7'],
    ['8.8 Flyer et cartes de visite', 'a_faire', 'Flyer A5 avec QR code ocaz.re, et cartes de visite.', 'pr8'],
    ['8.9 Réponse « vous êtes une vraie entreprise ? »', 'a_faire', "Préparer quoi dire tant que la micro-entreprise n'est pas encore créée.", 'pr9'],
  ];
  // Vision à long terme (28/10), en fin de liste.
  const VISION_ETAPES = [
    ["Vision 1 · D'ici 2027 : Ocaz et sa commercialisation", 'en_cours', '100 garages partenaires (5 testeurs, puis 30). Ensuite le bouche-à-oreille fait grandir le réseau.', 'vi1'],
    ['Vision 2 · Horizon 2028 : la cote des véhicules à La Réunion', 'plus_tard', "Un logiciel de cote type Autobiz pour La Réunion. Il permet de développer le site vitrine et d'ouvrir les annonces aux particuliers.", 'vi2'],
    ['Vision 3 · Horizon 2029 : les concessionnaires', 'plus_tard', 'Un logiciel de reprise pour les concessionnaires, relié au logiciel de cote.', 'vi3'],
  ];
  const AJOUTS = [...PROSPECTION_ETAPES, ...VISION_ETAPES];
  const ETAPES_DEPART = [
    ['1. Valider le marché', 'en_cours', 'Sondage Google Forms en ligne, 60 marchands repérés. Analyser les réponses.'],
    ["2. Créer l'entreprise", 'plus_tard', 'Micro-entreprise Ocaz, après avoir rencontré les premiers pros (SIREN, compte bancaire, assurance RC pro, marque INPI).'],
    ["3. Construire l'appli", 'en_cours', 'Appli pro sur ocaz.re : stock, reprises, dépôt-vente, commandes, administratif, réseau, apporteurs, messagerie, admin.'],
    ["3 bis. Vérifier l'appli", 'en_cours', "Tout vérifier onglet par onglet avec chaque identifiant (admin, revendeur, apporteur) : onglet Vérifications du doc Étapes."],
    ['3 ter. Recherche par plaque', 'en_cours', 'Créer le compte immatriculationapi.com et suivre le guide « Activer la recherche par plaque ».'],
    ['4. Domaine et mail', 'fait', 'ocaz.re = appli pro, reseau.ocaz.re = site public, contact@ocaz.re et signature mail prêts.'],
    ['5. Pages légales du site', 'en_cours', 'Ajouter le SIREN une fois l\'entreprise créée. Faire relire le contrat apporteur par un juriste.'],
    ['6. Référencement Google', 'en_cours', 'Search Console fait. Suite : fiche Google Business et annuaires locaux.'],
    ["7. Paiement de l'abonnement", 'a_faire', '69,99 €/mois, premier mois offert, sans engagement. Brancher Stripe une fois le compte pro ouvert.'],
    ...PROSPECTION_ETAPES,
    ['8. Phase test : 5 garages testeurs', 'a_faire', "Démarcher les 60 marchands (onglet Prospection), d'abord ceux qui ont répondu au sondage, en commençant par GT Auto. Puis viser 30."],
    ['9. 30 garages partenaires', 'a_faire', "Objectif avril 2027, environ 2 100 €/mois."],
    ['10. 100 garages partenaires', 'a_faire', 'Le réseau complet, environ 7 000 €/mois.'],
    ['11. Applis App Store et Google Play', 'plus_tard', 'Après les premiers clients : 99 €/an chez Apple, 25 € une fois chez Google.'],
    ...VISION_ETAPES,
  ].map(([titre, statut, suite, id]) => ({ id: id || nouvelId(), titre, statut, suite }));
  // Étapes ajoutées après coup : elles rejoignent aussi une liste déjà enregistrée, une seule fois
  // (la prospection avant la phase test, la vision à la fin).
  function completerEtapes(v) {
    if (!v?.liste) return ETAPES_DEPART;
    const liste = [...v.liste];
    const nouvelles = groupe => groupe.filter(([, , , id]) => !liste.some(e => e.id === id) && !(v.connues || []).includes(id))
      .map(([titre, statut, suite, id]) => ({ id, titre, statut, suite }));
    const pros = nouvelles(PROSPECTION_ETAPES);
    if (pros.length) {
      const i = liste.findIndex(e => /^8\. Phase test/.test(e.titre));
      liste.splice(i < 0 ? liste.length : i, 0, ...pros);
    }
    liste.push(...nouvelles(VISION_ETAPES));
    return liste;
  }
  function blocEtapes() {
    const liste = etapes || [];
    const n = st => liste.filter(e => e.statut === st).length;
    if (editionEtapes) return `<div class="adm-tete adm-sous-tete"><h3 class="section">Mes étapes</h3><span class="chips">
        <button type="button" class="chip" id="etapes-annuler">Annuler</button><button type="button" class="chip active" id="etapes-ok">Enregistrer</button></span></div>
      <div class="adm-bloc" id="etapes-edition">${liste.map((e, i) => `<div class="adm-etape-edit" data-etape-i="${i}">
          <input data-ee="titre" value="${esc(e.titre)}" placeholder="Étape" aria-label="Étape">
          <select data-ee="statut" aria-label="Statut">${Object.entries(STATUTS_ETAPE).map(([k, [l]]) => `<option value="${k}"${e.statut === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <textarea data-ee="suite" rows="2" placeholder="Prochain pas" aria-label="Prochain pas">${esc(e.suite)}</textarea>
          <span class="chips"><button type="button" class="chip" data-etape-monter="${i}" aria-label="Monter">↑</button><button type="button" class="chip" data-etape-suppr="${i}" aria-label="Supprimer l'étape">✕</button></span></div>`).join('')}
        <button type="button" id="etape-ajouter">+ Ajouter une étape</button></div>`;
    return `<div class="adm-tete adm-sous-tete"><h3 class="section">Mes étapes <small class="hint">${n('fait')} faite(s) sur ${liste.length} · ${n('en_cours')} en cours</small></h3>
        <button type="button" class="chip" id="etapes-modifier">Modifier</button></div>
      <div class="adm-table-scroll"><table class="adm-table adm-etapes">
        <thead><tr><th>Étape</th><th>Statut</th><th>Prochain pas</th></tr></thead>
        <tbody>${liste.map(e => `<tr class="st-${e.statut}"><td><b>${esc(e.titre)}</b></td>
          <td><select data-etape-statut="${esc(e.id)}" class="badge ${STATUTS_ETAPE[e.statut]?.[1] || 'b-grey'}" aria-label="Statut de ${esc(e.titre)}">${Object.entries(STATUTS_ETAPE).map(([k, [l]]) => `<option value="${k}"${e.statut === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
          <td>${esc(e.suite)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function lireEtapes() {
    etapes = [...document.querySelectorAll('#etapes-edition [data-etape-i]')].map(l => ({ ...etapes[Number(l.dataset.etapeI)],
      titre: l.querySelector('[data-ee=titre]').value.trim(), statut: l.querySelector('[data-ee=statut]').value, suite: l.querySelector('[data-ee=suite]').value.trim() }));
  }
  async function enregistrerEtapes() {
    try { await rpc('crm_admin_reglage_ecrire', { p_cle: 'etapes', p_valeur: { liste: etapes, connues: AJOUTS.map(e => e[3]) } }); toast('Étapes enregistrées'); }
    catch (err) { toast(err.message); }
  }
  async function chargerTableau() {
    if (!etapes) rpc('crm_admin_reglage_lire', { p_cle: 'etapes' }).then(v => { etapes = completerEtapes(v); if (onglet === 'tableau') afficher(); },
      () => { etapes = ETAPES_DEPART; if (onglet === 'tableau') afficher(); });
    try { [tableau, prospects] = await Promise.all([rpc('crm_admin_tableau'), prospects ? prospects : rpc('crm_admin_prospects').catch(() => null)]); }
    catch (err) { toast(err.message); tableau = { garages: [], apporteurs: 0, leads_30j: 0, ventes_reseau_30j: 0 }; }
    if (onglet === 'tableau') afficher();
  }

  // ---------- Onglet Prospection ----------
  const ETAPES = { a_contacter: ['À contacter', 'b-grey'], appele: ['Appelé', 'b-blue'], demo_prevue: ['Démo prévue', 'b-orange'], demo_faite: ['Démo faite', 'b-orange'],
    essai: ['En essai', 'b-purple'], signe: ['Signé', 'b-green'], pas_interesse: ['Pas intéressé', 'b-red'] };
  const enCours = p => !['signe', 'pas_interesse'].includes(p.etape);
  function lignePro(p) {
    const r = p.relance && enCours(p) ? jours(p.relance) : null;
    return `<div class="adm-abo-ligne">
      <button type="button" class="adm-abo-nom" data-pro="${esc(p.id)}"><b>${esc(p.nom)}</b>
        <small>${esc([p.ville, p.telephone, p.contact].filter(Boolean).join(' · ') || 'Pas de coordonnées')}${r != null ? ` · <span class="${r <= 0 ? 'adm-retard' : ''}">relance ${r < 0 ? 'en retard (' + dateFr(p.relance) + ')' : r === 0 ? "aujourd'hui" : 'le ' + dateFr(p.relance)}</span>` : ''}</small>
        ${p.note ? `<small class="adm-note">${esc(p.note.split('\n')[0])}</small>` : ''}
        ${remplis(p.entretien) ? `<small>Entretien${p.entretien.date ? ' du ' + dateFr(p.entretien.date) : ''}${p.entretien.note ? ' · ' + esc(p.entretien.note) + '/10' : ''}${p.entretien.testeur ? ' · testeur : ' + esc(p.entretien.testeur.toLowerCase()) : ''}</small>` : ''}</button>
      ${p.telephone ? `<a class="chip" href="tel:${esc(p.telephone.replace(/\s/g, ''))}">Appeler</a>` : ''}
      <select data-etape="${esc(p.id)}" aria-label="Étape de ${esc(p.nom)}">${Object.entries(ETAPES).map(([k, [l]]) => `<option value="${k}"${p.etape === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </div>`;
  }
  function afficherProspection() {
    if (!prospects) { $('#vue').innerHTML = '<div class="ap-page"><p class="hint">Chargement…</p></div>'; return; }
    const n = e => prospects.filter(p => p.etape === e).length;
    const aRelancer = prospects.filter(p => enCours(p) && p.relance && jours(p.relance) <= 0);
    const FILTRES = [['tous', 'Tous', prospects.length], ['encours', 'En cours', prospects.filter(enCours).length], ...Object.entries(ETAPES).map(([k, [l]]) => [k, l, n(k)])].filter(([k, , c]) => k === 'tous' || c);
    if (!FILTRES.some(([k]) => k === filtrePro)) filtrePro = 'tous';
    const liste = prospects.filter(p => filtrePro === 'tous' || (filtrePro === 'encours' ? enCours(p) : p.etape === filtrePro))
      .filter(p => !q || norm([p.nom, p.ville, p.telephone, p.email, p.contact, p.note].join(' ')).includes(norm(q)));
    const signes = n('signe'), demos = n('demo_faite') + n('essai') + signes;
    $('#vue').innerHTML = `<div class="ap-page">
      <div class="adm-tete"><h2>Prospection</h2><span class="chips">
        <button type="button" id="btn-importer">Importer un fichier CSV</button>
        <button type="button" class="primary" id="btn-pro-ajouter">${icon('plus', 18)}<span>Ajouter un garage</span></button></span></div>
      ${prospects.length ? `<div class="kpis">
        ${kpi('Garages à démarcher', prospects.length, `${prospects.filter(enCours).length} en cours`)}
        ${kpi('Démos faites', demos, prospects.length ? Math.round(demos / prospects.length * 100) + ' % des garages' : '')}
        ${kpi('Signés', signes, demos ? Math.round(signes / demos * 100) + ' % des démos' : 'premier palier : 5 partenaires')}
        ${kpi('À relancer', aRelancer.length, aRelancer.length ? "aujourd'hui ou en retard" : 'rien en retard', aRelancer.length ? 'negatif' : '')}
      </div>
      <div class="adm-entonnoir">${Object.entries(ETAPES).map(([k, [l, cls]]) => `<button type="button" class="adm-etape" data-filtre-pro="${k}"><span class="badge ${cls}">${l}</span><b>${n(k)}</b></button>`).join('')}</div>` : ''}
      ${aRelancer.length ? `<h3 class="section">À relancer (${aRelancer.length})</h3><div class="adm-bloc adm-abo-liste">${aRelancer.map(lignePro).join('')}</div>` : ''}
      <h3 class="section">Tous les garages</h3>
      <div class="adm-outils"><div class="chips">${FILTRES.map(([k, l, c]) => `<button type="button" class="chip${filtrePro === k ? ' active' : ''}" data-filtre-pro="${k}">${l} (${c})</button>`).join('')}</div>
        <div class="search"><span class="ap-loupe">${icon('recherche', 18)}</span><input id="adm-q" type="search" placeholder="Rechercher un garage…" value="${esc(q)}" autocomplete="off"></div></div>
      <div class="adm-bloc adm-abo-liste">${liste.length ? liste.map(lignePro).join('')
        : `<div class="empty"><strong>${prospects.length ? 'Aucun résultat' : 'Aucun garage à démarcher'}</strong><span>${prospects.length ? 'Essaie un autre filtre.' : 'Importe ta liste (le fichier prospects.csv des 60 marchands) ou ajoute un garage.'}</span></div>`}</div>
    </div>`;
  }
  async function chargerProspects() {
    try { prospects = await rpc('crm_admin_prospects'); } catch (err) { toast(err.message); prospects = prospects || []; }
    if (onglet === 'prospection') afficher();
  }
  async function enregistrerProspect(p, msg) {
    const id = await rpc('crm_admin_prospect_enregistrer', { p });
    await chargerProspects();
    if (msg) toast(msg);
    return id;
  }
  // Fiche d'entretien : les questions du speech de visite, à remplir par points pendant le rendez-vous (enregistrée toute seule).
  const ENTRETIEN = [
    ['Le garage', [
      ['rencontre', 'Personne rencontrée', 'texte'],
      ['equipe', 'Installé depuis / nombre de personnes', 'texte'],
      ['ventesMois', 'Ventes par mois', 'nombre'],
      ['stock', 'Véhicules en stock', 'nombre'],
      ['achats', 'Où il achète ses voitures', 'multi', ['Reprises clients', 'Particuliers', 'Enchères', 'Import métropole', 'Autre garage']],
      ['depot', 'Fait du dépôt-vente', 'choix', ['Oui', 'Non', 'Parfois']],
      ['roles', 'Qui vend, qui fait les papiers, qui répond aux annonces', 'long'],
    ]],
    ['Ce qui l\'énerve aujourd\'hui', [
      ['accroche', '« Vos offres, factures, livre de police, vous les faites comment ? »', 'long'],
    ]],
    ['Préparation et contrôle technique', [
      ['prepaQui', 'Qui prépare les voitures', 'choix', ['Lui-même', 'Son atelier', 'Préparateur extérieur']],
      ['prepaCout', 'Coût moyen d\'une préparation (€)', 'nombre'],
      ['fraisNotes', 'Note ses frais pour connaître sa vraie marge', 'choix', ['Oui', 'Non', 'Approximativement']],
      ['ct', 'Contrôle technique (centre, avant ou après la vente)', 'texte'],
      ['revision', 'Atelier d\'entretien / rappelle les clients pour la révision', 'choix', ['Oui', 'Atelier mais pas de rappel', 'Non']],
    ]],
    ['Administratif', [
      ['police', 'Livre de police', 'choix', ['Papier', 'Logiciel', 'Excel', 'Pas tenu']],
      ['siv', 'Cartes grises (SIV)', 'choix', ['Habilité SIV', 'Prestataire', 'Ne sait pas']],
      ['wGarage', 'W garage', 'choix', ['Oui', 'Non']],
      ['factures', 'Offres, bons de commande, factures, TVA sur marge', 'texte'],
      ['paperasse', 'La paperasse qui lui prend le plus de temps', 'texte'],
      ['comptable', 'Ce que son comptable lui demande', 'texte'],
    ]],
    ['Vente et clients', [
      ['clients', 'D\'où viennent ses clients', 'multi', ['Leboncoin', 'Facebook', 'Bouche-à-oreille', 'Passage', 'La Centrale', 'Site du garage']],
      ['annonces', 'Temps par jour à répondre aux annonces', 'texte'],
      ['apporteurs', 'Déjà des gens qui lui ramènent des clients contre commission', 'choix', ['Oui', 'Non']],
      ['autresGarages', 'Travaille avec d\'autres garages', 'choix', ['Oui', 'Non']],
    ]],
    ['Outils actuels', [
      ['logiciel', 'Logiciel aujourd\'hui', 'multi', ['Spider VO', 'Autre logiciel', 'Excel', 'Papier', 'Rien']],
      ['logicielCout', 'Combien il paie par mois (€)', 'nombre'],
      ['logicielAvis', 'Ce qui lui plaît / ce qui l\'énerve dedans', 'long'],
      ['support', 'Travaille plutôt sur', 'choix', ['Téléphone', 'Ordinateur', 'Les deux']],
    ]],
    ['Démo', [
      ['reactions', 'Ce qui l\'a fait réagir', 'multi', ['Stock et marge réelle', 'Reprise par plaque', 'Offre → facture TVA sur marge', 'Livre de police', 'Réseau d\'apporteurs', 'Site et vitrine', 'Rappel révision', 'Dépôt-vente']],
      ['demoNotes', 'Remarques pendant la démo', 'long'],
    ]],
    ['Conclusion', [
      ['note', 'Sur 10, ça lui servirait combien', 'note'],
      ['manque', 'Ce qui manque pour avoir 10', 'long'],
      ['baguette', 'Baguette magique : ce qu\'il changerait en premier', 'long'],
      ['prix', 'Prix par mois qui lui paraît correct (€)', 'nombre'],
      ['objections', 'Objections', 'multi', ['Déjà un logiciel', 'Le papier ça marche', 'Pas le temps', 'Trop cher', 'Mes données', 'Les apporteurs', 'Vraie entreprise ?']],
      ['objectionsNotes', 'Détail des objections et questions à reprendre', 'long'],
      ['testeur', 'Garage testeur', 'choix', ['Oui', 'Hésite', 'Non']],
      ['sondage', 'Sondage proposé', 'choix', ['Rempli sur place', 'Envoyé par WhatsApp', 'Non']],
      ['recommande', 'Autres garagistes à aller voir', 'texte'],
      ['suite', 'Prochaine étape convenue', 'texte'],
    ]],
  ];
  const remplis = en => ENTRETIEN.flatMap(([, ch]) => ch).filter(([k]) => { const v = en?.[k]; return Array.isArray(v) ? v.length : v != null && v !== ''; }).length;
  const NB_CHAMPS = ENTRETIEN.reduce((s, [, ch]) => s + ch.length, 0);
  function rendreEntretien() {
    const en = pro.entretien || {};
    const champ = ([k, l, type, opts]) => {
      const v = en[k];
      if (type === 'choix' || type === 'multi' || type === 'note') {
        const liste = type === 'note' ? ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] : opts;
        const actif = o => type === 'multi' ? (v || []).includes(o) : String(v ?? '') === o;
        return `<div class="field full"><span class="adm-en-l">${esc(l)}</span><div class="chips adm-en-chips${type === 'note' ? ' adm-en-note' : ''}">${liste.map(o =>
          `<button type="button" class="chip${actif(o) ? ' active' : ''}" data-en-chip="${k}" data-type="${type}" data-val="${esc(o)}" aria-pressed="${actif(o)}">${esc(o)}</button>`).join('')}</div></div>`;
      }
      if (type === 'long') return `<div class="field full"><label for="en-${k}">${esc(l)}</label><textarea id="en-${k}" data-en="${k}" rows="2">${esc(v || '')}</textarea></div>`;
      return `<div class="field${type === 'nombre' ? '' : ' full'}"><label for="en-${k}">${esc(l)}</label><input id="en-${k}" data-en="${k}" ${type === 'nombre' ? 'type="number" inputmode="decimal"' : 'type="text"'} value="${esc(v ?? '')}" autocomplete="off"></div>`;
    };
    return `<div class="adm-en-tete"><div class="field"><label for="en-date">Date de l'entretien</label><input id="en-date" data-en="date" type="date" value="${esc(en.date || auj())}"></div>
        <span class="hint" id="pro-etat">${remplis(en)} point(s) sur ${NB_CHAMPS} · enregistré automatiquement</span></div>
      ${ENTRETIEN.map(([titre, champs], i) => `<details class="adm-en-section"${i < 2 || champs.some(([k]) => en[k] != null && en[k] !== '' && !(Array.isArray(en[k]) && !en[k].length)) ? ' open' : ''}>
        <summary>${esc(titre)}</summary><div class="grid">${champs.map(champ).join('')}</div></details>`).join('')}`;
  }
  // Enregistrement automatique, une seconde après la dernière saisie (et à la fermeture de la fiche).
  function planifierSauvegarde() {
    clearTimeout(planifierSauvegarde.t);
    if (!pro.entretien.date) pro.entretien.date = auj();
    const etat = $('#pro-etat');
    if (etat) etat.textContent = 'Modification…';
    planifierSauvegarde.t = setTimeout(sauverEntretien, 1000);
  }
  async function sauverEntretien() {
    clearTimeout(planifierSauvegarde.t);
    planifierSauvegarde.t = null;
    lireProspect();
    const etat = $('#pro-etat');
    if (!pro.nom) { if (etat) etat.textContent = 'Donne un nom au garage pour enregistrer.'; return; }
    try {
      pro.id = await rpc('crm_admin_prospect_enregistrer', { p: pro });
      const i = (prospects || []).findIndex(x => x.id === pro.id);
      if (i >= 0) prospects[i] = { ...pro }; else (prospects = prospects || []).push({ ...pro });
      $('#pro-suppr').hidden = false;
      if (etat) etat.textContent = `${remplis(pro.entretien)} point(s) sur ${NB_CHAMPS} · enregistré à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
      if (onglet === 'prospection' && !$('#dlg-pro').open) afficher();
    } catch (err) { if (etat) etat.textContent = 'Pas enregistré : ' + err.message; }
  }
  function ouvrirProspect(id, base) {
    pro = id ? { ...prospects.find(p => p.id === id) } : { etape: 'a_contacter', ...(base || {}) };
    pro.entretien = { ...(pro.entretien || {}) };
    $('#pro-titre').textContent = id ? pro.nom : 'Ajouter un garage à démarcher';
    $('#pro-suppr').hidden = !id;
    const g = pro.entreprise_id && revendeurs.find(x => x.id === pro.entreprise_id);
    const ch = (k, l, cls, type) => `<div class="field ${cls || ''}"><label for="pf-${k}">${l}</label><input id="pf-${k}" data-pf="${k}" type="${type || 'text'}" value="${esc(pro[k] || '')}" autocomplete="off"></div>`;
    const nEn = remplis(pro.entretien);
    $('#pro-body').innerHTML = `
      <div class="segmented adm-pro-vues"><button type="button" data-pro-vue="fiche" class="active">Fiche</button>
        <button type="button" data-pro-vue="entretien">Entretien${nEn ? ` (${nEn})` : ''}</button></div>
      <div id="pro-fiche">
      <div class="grid">${ch('nom', 'Nom du garage *', 'full')}${ch('ville', 'Ville')}${ch('contact', 'Personne à voir')}${ch('telephone', 'Téléphone', '', 'tel')}${ch('email', 'Email', '', 'email')}</div>
      <h3 class="section">Suivi</h3>
      <div class="grid"><div class="field"><label for="pf-etape">Étape</label><select id="pf-etape" data-pf="etape">${Object.entries(ETAPES).map(([k, [l]]) => `<option value="${k}"${pro.etape === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        ${ch('relance', 'Prochaine relance', '', 'date')}
        <div class="field full"><label for="pf-note">Notes (appels, objections, ce qui l'intéresse)</label><textarea id="pf-note" data-pf="note" rows="5">${esc(pro.note || '')}</textarea></div></div>
      ${id ? `<div class="adm-bloc">${g ? `<div class="adm-compte"><span>Compte revendeur créé<small>${esc(g.nom)}</small></span><button type="button" class="chip" data-voir-rev="${esc(g.id)}">Voir sa fiche</button></div>`
        : `<div class="adm-compte"><span>Il a dit oui ?<small>Crée son compte revendeur : ses infos sont reprises et son essai gratuit démarre.</small></span><button type="button" class="chip" id="pro-convertir">Créer son compte</button></div>`}</div>` : ''}
      </div>
      <div id="pro-entretien" hidden>${rendreEntretien()}</div>`;
    $('#dlg-pro').showModal();
  }
  function lireProspect() {
    document.querySelectorAll('#pro-body [data-pf]').forEach(i => { pro[i.dataset.pf] = i.value.trim(); });
    return pro;
  }
  async function validerProspect() {
    const p = lireProspect();
    if (!p.nom) { toast('Le nom du garage est obligatoire.'); $('#pf-nom').focus(); return null; }
    const btn = $('#pro-ok');
    btn.disabled = true;
    clearTimeout(planifierSauvegarde.t); planifierSauvegarde.t = null;
    try { const id = await enregistrerProspect(p); pro.id = id; $('#dlg-pro').close(); return id; } catch (err) { toast(err.message); return null; }
    finally { btn.disabled = false; }
  }
  // Fichier CSV : celui de l'appli de relance (entreprise, telephone, email, lot, statut, commentaire, date) ou un tableur
  // avec des colonnes nom / ville / téléphone / email. « GARAGE (Ville) » est séparé en nom et ville.
  function lireCsv(txt) {
    const sep = (txt.split('\n')[0].match(/;/g) || []).length > (txt.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], f = '', dq = false;
    for (let i = 0; i < txt.length; i++) {
      const c = txt[i];
      if (dq) { if (c === '"' && txt[i + 1] === '"') { f += '"'; i++; } else if (c === '"') dq = false; else f += c; }
      else if (c === '"') dq = true;
      else if (c === sep) { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    const tete = (rows.shift() || []).map(h => norm(h).trim());
    const col = (...noms) => tete.findIndex(h => noms.includes(h));
    const iNom = col('entreprise', 'nom', 'garage', 'raison sociale'), iVille = col('ville', 'commune'), iTel = col('telephone', 'tel', 'téléphone'),
      iMail = col('email', 'mail', 'e-mail'), iLot = col('lot'), iSt = col('statut', 'etape'), iCom = col('commentaire', 'note', 'notes');
    if (iNom < 0) throw new Error('Colonne « entreprise » ou « nom » introuvable dans le fichier.');
    const ST = { a_appeler: 'a_contacter', interesse: 'appele', pas_interesse: 'pas_interesse' };
    return rows.filter(r => (r[iNom] || '').trim()).map(r => {
      let nom = r[iNom].trim(), ville = iVille >= 0 ? (r[iVille] || '').trim() : '';
      const m = nom.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      if (m && !ville) { nom = m[1]; ville = m[2]; }
      const st = iSt >= 0 ? (r[iSt] || '').trim() : '';
      return { nom, ville, telephone: iTel >= 0 ? (r[iTel] || '').trim() : '', email: iMail >= 0 ? (r[iMail] || '').trim() : '',
        lot: iLot >= 0 ? (r[iLot] || '').trim() : '', etape: ST[st] || st, note: iCom >= 0 ? (r[iCom] || '').trim() : '' };
    });
  }
  async function importer(fichier) {
    try {
      const liste = lireCsv(await fichier.text());
      if (!liste.length) { toast('Aucun garage trouvé dans ce fichier.'); return; }
      const n = await rpc('crm_admin_prospects_importer', { p: liste });
      await chargerProspects();
      toast(`${n} garage(s) ajouté(s)${liste.length - n ? `, ${liste.length - n} déjà présent(s)` : ''}`);
    } catch (err) { toast(err.message); }
  }

  // ---------- Onglet Leads réseau ----------
  const LEADS = { nouveau: ['Nouveau', 'b-orange'], en_cours: ['Pris en charge', 'b-blue'], vendu: ['Vendu', 'b-green'], perdu: ['Perdu', 'b-grey'] };
  function afficherLeads() {
    if (!leads) { $('#vue').innerHTML = '<div class="ap-page"><p class="hint">Chargement…</p></div>'; return; }
    const reels = leads.filter(l => !l.demo);
    const n = st => reels.filter(l => l.statut === st).length;
    const vendus = reels.filter(l => l.statut === 'vendu');
    const coms = vendus.reduce((s, l) => s + Number(l.commission_finale ?? l.commission ?? 0), 0);
    const aPayer = vendus.filter(l => !l.payee).reduce((s, l) => s + Number(l.commission_finale ?? l.commission ?? 0), 0);
    const oublies = reels.filter(l => l.statut === 'nouveau' && joursDepuis(l.cree_le) >= 2);
    const FILTRES = [['tous', 'Tous', leads.length], ...Object.entries(LEADS).map(([k, [l]]) => [k, l, leads.filter(x => x.statut === k).length])].filter(([k, , c]) => k === 'tous' || c);
    if (!FILTRES.some(([k]) => k === filtreLead)) filtreLead = 'tous';
    const liste = leads.filter(l => filtreLead === 'tous' || l.statut === filtreLead)
      .filter(l => !q || norm([l.garage, l.apporteur, l.vehicule, l.client, l.numero].join(' ')).includes(norm(q)));
    const ligne = l => `<div class="adm-abo-ligne"><div class="adm-abo-nom"><b>${esc(l.vehicule || 'Véhicule')} · ${esc(l.garage)}</b>
        <small>N° ${esc(l.numero)} du ${dateFr(l.cree_le)} · client ${esc(l.client)} · apporteur ${esc(l.apporteur || '?')}${l.demo ? ' · démo' : ''}</small>
        <small>${l.statut === 'nouveau' ? `Envoyé ${ilYa(l.cree_le)}, pas encore pris en charge` : l.statut === 'en_cours' ? `Pris en charge ${ilYa(l.pris_le)}` : l.statut === 'vendu' ? `Vendu · commission ${eur(Number(l.commission_finale ?? l.commission ?? 0))}${l.payee ? ' payée' : ' à verser'}` : `Perdu${l.motif ? ' : ' + esc(l.motif) : ''}`}</small></div>
      <span class="badge ${LEADS[l.statut]?.[1] || 'b-grey'}">${LEADS[l.statut]?.[0] || esc(l.statut)}</span></div>`;
    $('#vue').innerHTML = `<div class="ap-page">
      <div class="adm-tete"><h2>Leads réseau</h2><button type="button" id="btn-actualiser">Actualiser</button></div>
      <div class="kpis">
        ${kpi('Leads envoyés', reels.length, `${n('nouveau') + n('en_cours')} en cours`)}
        ${kpi('Ventes', vendus.length, reels.length ? Math.round(vendus.length / reels.length * 100) + ' % des leads' : 'aucun lead')}
        ${kpi('Commissions', eur(coms), aPayer ? eur(aPayer) + ' pas encore versées' : 'toutes versées')}
        ${kpi('Sans réponse', oublies.length, 'depuis 2 jours ou plus', oublies.length ? 'negatif' : '')}
      </div>
      ${oublies.length ? `<h3 class="section">Sans réponse du garage (${oublies.length})</h3><p class="hint">Un apporteur qui attend se décourage : appelle le garage.</p><div class="adm-bloc adm-abo-liste">${oublies.map(ligne).join('')}</div>` : ''}
      <h3 class="section">Tous les leads</h3>
      <div class="adm-outils"><div class="chips">${FILTRES.map(([k, l, c]) => `<button type="button" class="chip${filtreLead === k ? ' active' : ''}" data-filtre-lead="${k}">${l} (${c})</button>`).join('')}</div>
        <div class="search"><span class="ap-loupe">${icon('recherche', 18)}</span><input id="adm-q" type="search" placeholder="Garage, apporteur, véhicule…" value="${esc(q)}" autocomplete="off"></div></div>
      <div class="adm-bloc adm-abo-liste">${liste.length ? liste.map(ligne).join('') : `<div class="empty"><strong>${leads.length ? 'Aucun résultat' : 'Aucun lead pour l\'instant'}</strong><span>${leads.length ? 'Essaie un autre filtre.' : 'Ils arrivent quand un apporteur envoie un client à un garage du réseau.'}</span></div>`}</div>
      <p class="hint">Les coordonnées des clients restent chez le garage : ici tu ne vois que le prénom et l'initiale.</p>
    </div>`;
  }
  async function chargerLeads() {
    try { leads = await rpc('crm_admin_leads'); } catch (err) { toast(err.message); leads = leads || []; }
    if (onglet === 'leads') afficher();
  }

  // ---------- Onglet Annonces ----------
  const CIBLES = { tous: 'Tout le monde', revendeurs: 'Les revendeurs', apporteurs: 'Les apporteurs' };
  function afficherAnnonces() {
    if (!annonces) { $('#vue').innerHTML = '<div class="ap-page"><p class="hint">Chargement…</p></div>'; return; }
    const enLigne = a => a.actif && (!a.fin || a.fin >= auj());
    $('#vue').innerHTML = `<div class="ap-page">
      <div class="adm-tete"><h2>Annonces</h2></div>
      <p class="hint">Un bandeau en haut de l'appli des partenaires, à leur prochaine ouverture : nouveauté, maintenance, conseil du mois… Chacun peut le fermer.</p>
      <div class="adm-bloc">
        <div class="grid">
          <div class="field full"><label for="an-titre">Titre *</label><input id="an-titre" maxlength="140" placeholder="Nouveau : la messagerie entre partenaires" autocomplete="off"></div>
          <div class="field full"><label for="an-texte">Message</label><textarea id="an-texte" rows="3" maxlength="2000" placeholder="Quelques lignes, simples et utiles."></textarea></div>
          <div class="field"><label for="an-cible">Pour</label><select id="an-cible">${Object.entries(CIBLES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
          <div class="field"><label for="an-fin">Afficher jusqu'au (facultatif)</label><input id="an-fin" type="date"></div>
        </div>
        <div class="adm-publier"><button type="button" class="primary" id="btn-publier">Publier l'annonce</button></div>
      </div>
      <h3 class="section">Annonces publiées</h3>
      <div class="adm-bloc adm-abo-liste">${annonces.length ? annonces.map(a => `<div class="adm-abo-ligne"><div class="adm-abo-nom"><b>${esc(a.titre)}</b>
          ${a.texte ? `<small>${esc(a.texte)}</small>` : ''}
          <small>${CIBLES[a.cible] || ''} · publiée le ${dateFr(a.cree_le)}${a.fin ? ' · jusqu\'au ' + dateFr(a.fin) : ''}</small></div>
        <span class="badge ${enLigne(a) ? 'b-green' : 'b-grey'}">${enLigne(a) ? 'En ligne' : a.actif ? 'Terminée' : 'Retirée'}</span>
        <span class="chips"><button type="button" class="chip" data-an-actif="${esc(a.id)}">${a.actif ? 'Retirer' : 'Remettre'}</button>
          <button type="button" class="chip" data-an-suppr="${esc(a.id)}" aria-label="Supprimer l'annonce">✕</button></span></div>`).join('')
        : '<div class="empty"><strong>Aucune annonce</strong><span>Ta première annonce apparaîtra ici.</span></div>'}</div>
    </div>`;
  }
  async function chargerAnnonces() {
    try { annonces = await rpc('crm_admin_annonces'); } catch (err) { toast(err.message); annonces = annonces || []; }
    if (onglet === 'annonces') afficher();
  }
  async function publierAnnonce() {
    const a = { titre: $('#an-titre').value.trim(), texte: $('#an-texte').value.trim(), cible: $('#an-cible').value, fin: $('#an-fin').value, actif: true };
    if (!a.titre) { toast('Donne un titre à ton annonce.'); $('#an-titre').focus(); return; }
    $('#btn-publier').disabled = true;
    try { await rpc('crm_admin_annonce_enregistrer', { p: a }); toast('Annonce publiée'); await chargerAnnonces(); }
    catch (err) { toast(err.message); $('#btn-publier').disabled = false; }
  }

  // ---------- Fiche revendeur ----------
  // base : prospect qui vient de dire oui (ses coordonnées sont reprises).
  function ouvrirRevendeur(id, base) {
    const g = revendeurs.find(x => x.id === id);
    const c = g?.config || (base ? { infos: { nom: base.nom, ville: base.ville, telephone: base.telephone, email: base.email } } : {});
    rev = { id: g?.id || null, prospectId: base?.id || null, email: base?.email || '', infos: { ...(c.infos || {}), nom: c.infos?.nom || g?.nom || '' }, droits: { ...droitsDe(g ? c : { droits: { reseau: false, depot: false, achat: true } }) },
      reseau: { commissionType: 'fixe', commissionValeur: 300, commissionMin: 0, ...(c.reseau || {}) },
      packs: (Array.isArray(c.packs) ? c.packs : PACKS).map(p => ({ ...p })), comptes: g?.comptes || [], demo: !!g?.demo, admin: !!g?.admin,
      abonnement: { statut: 'essai', debut: auj(), ...(c.abonnement || {}) } };
    $('#rev-titre').textContent = g ? g.nom : 'Ajouter un revendeur';
    rendreRevendeur();
    $('#dlg-rev').showModal();
  }
  function rendreRevendeur() {
    const r = rev;
    const ch = ([k, l, cls, type]) => `<div class="field ${cls || ''}"><label for="ri-${k}">${l}</label><input id="ri-${k}" data-ri="${k}" type="${type || 'text'}" value="${esc(r.infos[k] || '')}" autocomplete="off"></div>`;
    $('#rev-body').innerHTML = `
      <h3 class="section">Infos de l'entreprise</h3>
      <p class="hint">Elles figurent sur ses offres, factures et mandats. Le revendeur les voit grisées et doit te contacter pour les changer.</p>
      <div class="grid">${INFOS.map(ch).join('')}</div>

      <h3 class="section">Connexion</h3>
      ${r.id ? `<div class="adm-bloc">${r.comptes.map(c => `<div class="adm-compte"><span>${esc(c.email)}<small>${c.doit_changer_mdp ? 'Mot de passe de départ (12345678)' : 'Mot de passe choisi'}</small></span>
          ${r.demo ? '' : `<span class="chips"><button type="button" class="chip" data-reinit="${esc(c.email)}">Réinit. mdp</button><button type="button" class="chip" data-retirer="${esc(c.email)}">Retirer</button></span>`}</div>`).join('') || '<span class="hint">Aucun compte.</span>'}
        ${r.demo ? '' : `<div class="field"><label for="rev-email">Ajouter un compte (email)</label><input id="rev-email" type="email" autocomplete="off" placeholder="collegue@garage.re" value="${esc(r.email || '')}"></div>`}</div>`
      : `<div class="field"><label for="rev-email">Email de connexion *</label><input id="rev-email" type="email" autocomplete="off" placeholder="contact@garage.re" value="${esc(r.email || '')}">
          <span class="hint">Il se connecte avec cet email et le mot de passe <b>12345678</b>, puis choisit le sien.</span></div>`}

      ${r.demo || r.admin ? '' : `<h3 class="section">Abonnement (${eur(PRIX)} par mois)</h3>
      <p class="hint">Premier mois offert, sans engagement. À mettre à jour à la main pour l'instant (Stripe le fera tout seul plus tard).</p>
      <div class="grid"><div class="field"><label for="abo-statut">Statut</label><select id="abo-statut">
          ${Object.entries(ABO).map(([k, [l]]) => `<option value="${k}"${r.abonnement.statut === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="abo-debut">Début de l'abonnement</label><input id="abo-debut" type="date" value="${esc(r.abonnement.debut)}">
          <span class="hint">Fin de l'essai : ${dateFr(finEssai(r.abonnement.debut))}, premier paiement ce jour-là.</span></div></div>`}

      <h3 class="section">Droits activés</h3>
      <div class="adm-bloc">${DROITS.map(([k, l, aide]) => `<label class="check"><input type="checkbox" data-droit="${k}"${r.droits[k] ? ' checked' : ''}><span><b>${l}</b><br><small class="hint">${aide}</small></span></label>
        ${k === 'reseau' ? `<div class="grid trois adm-sous" id="rev-com"${r.droits.reseau ? '' : ' hidden'}>
          <div class="field"><label for="rc-type">Commission apporteur</label><select id="rc-type" data-rc="commissionType">
            <option value="fixe"${r.reseau.commissionType === 'fixe' ? ' selected' : ''}>Montant fixe par vente</option>
            <option value="pourcentage"${r.reseau.commissionType === 'pourcentage' ? ' selected' : ''}>% du prix de vente</option></select></div>
          <div class="field"><label for="rc-valeur">Montant (€) ou taux (%)</label><input id="rc-valeur" data-rc="commissionValeur" type="number" inputmode="decimal" value="${esc(r.reseau.commissionValeur)}"></div>
          <div class="field"><label for="rc-min">Minimum (€)</label><input id="rc-min" data-rc="commissionMin" type="number" inputmode="decimal" value="${esc(r.reseau.commissionMin)}"></div></div>` : ''}`).join('')}
        <p class="hint">Achat-revente seul : pas d'onglet Dépôt vente. Dépôt-vente seul : pas d'onglet Reprise, et son Stock ne montre que les véhicules partenaires.</p></div>

      <h3 class="section">Packs livraison</h3>
      <p class="hint">Proposés dans chacune de ses offres. « Par défaut » : coché d'office.</p>
      <div class="adm-bloc" id="rev-packs">${r.packs.map((p, i) => `<div class="adm-pack" data-pack="${i}">
          <input data-pk="nom" value="${esc(p.nom)}" placeholder="Nom du pack" aria-label="Nom du pack">
          <input data-pk="montant" type="number" inputmode="decimal" value="${esc(p.montant)}" placeholder="€" aria-label="Montant (€)">
          <label class="check"><input type="checkbox" data-pk="coche"${p.coche ? ' checked' : ''}><span>Par défaut</span></label>
          <button type="button" class="chip" data-pk-suppr="${i}" aria-label="Supprimer ce pack">✕</button></div>`).join('') || '<span class="hint">Aucun pack.</span>'}
        <button type="button" id="rev-pack-ajouter">+ Ajouter un pack</button></div>`;
  }
  function lireRevendeur() {
    rev.email = ($('#rev-email')?.value || '').trim().toLowerCase();
    if ($('#abo-statut')) {
      const statut = $('#abo-statut').value;
      if (statut !== rev.abonnement.statut) { rev.abonnement.maj = auj(); if (statut === 'resilie') rev.abonnement.fin = auj(); else delete rev.abonnement.fin; }
      rev.abonnement = { ...rev.abonnement, statut, debut: $('#abo-debut').value || auj() };
    }
    document.querySelectorAll('#rev-body [data-ri]').forEach(i => { rev.infos[i.dataset.ri] = i.value.trim(); });
    document.querySelectorAll('#rev-body [data-droit]').forEach(i => { rev.droits[i.dataset.droit] = i.checked; });
    document.querySelectorAll('#rev-body [data-rc]').forEach(i => { rev.reseau[i.dataset.rc] = i.dataset.rc === 'commissionType' ? i.value : Number(i.value) || 0; });
    rev.packs = [...document.querySelectorAll('#rev-packs [data-pack]')].map((l, i) => ({
      id: rev.packs[i]?.id || nouvelId(), nom: l.querySelector('[data-pk=nom]').value.trim(), montant: Number(l.querySelector('[data-pk=montant]').value) || 0,
      coche: l.querySelector('[data-pk=coche]').checked }));
  }
  async function enregistrerRevendeur() {
    lireRevendeur();
    const email = rev.email;
    if (!rev.infos.nom) { toast("Le nom de l'entreprise est obligatoire."); $('#ri-nom').focus(); return; }
    if (!rev.id && !emailOk(email)) { toast('Saisis un email de connexion valide.'); $('#rev-email').focus(); return; }
    if (email && !emailOk(email)) { toast('Email invalide.'); return; }
    if (rev.infos.siret && !/^\d{14}$/.test(rev.infos.siret.replace(/\s/g, ''))) { toast('Le SIRET doit faire 14 chiffres.'); return; }
    if (rev.packs.some(p => !p.nom)) { toast('Donne un nom à chaque pack (ou supprime-le).'); return; }
    const config = { infos: rev.infos, droits: rev.droits, reseau: rev.reseau, packs: rev.packs };
    if (!rev.demo && !rev.admin) config.abonnement = rev.abonnement;
    const btn = $('#rev-ok');
    btn.disabled = true;
    try {
      const r = await rpc('crm_admin_revendeur_enregistrer', { p_id: rev.id, p_email: email, p_config: config });
      $('#dlg-rev').close();
      // Prospect converti : il passe « En essai » et reste relié à son compte.
      const p = rev.prospectId && prospects?.find(x => x.id === rev.prospectId);
      if (p && r?.id) await enregistrerProspect({ ...p, entreprise_id: r.id, etape: p.etape === 'signe' ? 'signe' : 'essai' }).catch(err => toast(err.message));
      toast(email ? `Compte créé : ${email} / 12345678` : 'Revendeur enregistré');
      await charger();
    } catch (err) { toast(err.message); }
    finally { btn.disabled = false; }
  }

  // ---------- Fiche apporteur ----------
  function ouvrirApporteur(email) {
    const a = apporteurs.find(x => x.email === email);
    app = a ? { ...a } : { forme: 'micro', statut: 'actif' };
    $('#app-titre').textContent = a ? [a.prenom, a.nom].join(' ') : 'Ajouter un apporteur';
    const ch = ([k, l, cls, type]) => `<div class="field ${cls || ''}"><label for="ai-${k}">${l}</label><input id="ai-${k}" data-ai="${k}" type="${type || 'text'}" value="${esc(app[k] || '')}" autocomplete="off"></div>`;
    $('#app-body').innerHTML = `
      <h3 class="section">Infos</h3>
      <div class="grid">${APP.slice(0, 2).map(ch).join('')}
        <div class="field"><label for="ai-email">Email de connexion *</label><input id="ai-email" type="email" value="${esc(app.email || '')}" autocomplete="off"${a ? ' disabled' : ''}></div>
        ${APP.slice(2, 6).map(ch).join('')}
        <div class="field"><label for="ai-forme">Statut</label><select id="ai-forme">${Object.entries(Commission.FORMES).map(([k, l]) => `<option value="${k}"${k === app.forme ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        ${APP.slice(6).map(ch).join('')}</div>
      ${a ? `<div class="adm-bloc">
          <div class="adm-compte"><span>Compte ${a.statut === 'actif' ? 'actif' : 'suspendu'}<small>${a.leads} lead(s), ${a.ventes} vente(s) · créé le ${dateFr(a.cree_le)}</small></span>
            ${a.demo ? '' : `<button type="button" class="chip" data-statut="${a.statut === 'actif' ? 'suspendu' : 'actif'}">${a.statut === 'actif' ? 'Suspendre' : 'Réactiver'}</button>`}</div>
          <div class="adm-compte"><span>Contrat<small>${a.contrat_signe_le ? `Signé le ${dateFr(a.contrat_signe_le)} (« ${esc(a.signature)} »)` : "Pas encore signé : il le signe dans son espace, à sa première connexion."}</small></span></div>
          <div class="adm-compte"><span>Mot de passe<small>${a.doit_changer_mdp ? 'Mot de passe de départ (12345678)' : 'Choisi par l\'apporteur'}</small></span>
            ${a.demo ? '' : `<button type="button" class="chip" data-reinit="${esc(a.email)}">Réinit. mdp</button>`}</div></div>`
        : '<p class="adm-info">Il se connecte sur ocaz.re avec cet email et le mot de passe <b>12345678</b>, choisit le sien, puis signe son contrat d\'apporteur en ligne.</p>'}`;
    $('#dlg-app').showModal();
  }
  async function enregistrerApporteur() {
    const infos = { forme: $('#ai-forme').value };
    document.querySelectorAll('#app-body [data-ai]').forEach(i => { infos[i.dataset.ai] = i.value.trim(); });
    const nouveau = !app.email;
    const email = nouveau ? $('#ai-email').value.trim().toLowerCase() : app.email;
    if (!infos.prenom || !infos.nom) { toast('Prénom et nom obligatoires.'); return; }
    if (nouveau && !emailOk(email)) { toast('Email invalide.'); return; }
    if (infos.siret && !/^\d{14}$/.test(infos.siret.replace(/\s/g, ''))) { toast('Le SIRET doit faire 14 chiffres.'); return; }
    const btn = $('#app-ok');
    btn.disabled = true;
    try {
      await rpc('crm_admin_apporteur_enregistrer', { p_email: email, p_infos: infos, p_nouveau: nouveau });
      $('#dlg-app').close();
      toast(nouveau ? `Compte créé : ${email} / 12345678` : 'Apporteur enregistré');
      await charger();
    } catch (err) { toast(err.message); }
    finally { btn.disabled = false; }
  }

  async function reinitialiser(email) {
    if (!confirm(`Remettre le mot de passe de ${email} à 12345678 ?`)) return false;
    try { await rpc('crm_reinit_mdp', { p_email: email }); toast(`Mot de passe de ${email} : 12345678`); return true; } catch (err) { toast(err.message); return false; }
  }

  async function deconnecter() {
    await client.auth.signOut();
    location.replace('./');
  }

  // ---------- Démarrage ----------
  function init() {
    document.querySelectorAll('[data-tab]').forEach(b => {
      const ic = { tableau: 'donnees', prospection: 'planning', partenaires: 'clients', abonnements: 'abonnements', leads: 'leads', annonces: 'annonce' }[b.dataset.tab];
      b.innerHTML = icon(ic, b.closest('#bottom-tabs') ? 22 : 18) + '<span>' + b.textContent + '</span>';
      b.addEventListener('click', () => { onglet = b.dataset.tab; q = ''; afficher(); window.scrollTo(0, 0); rafraichir(); });
    });
    $('#btn-menu').innerHTML = icon('reglages', 20);
    $('#btn-menu').addEventListener('click', () => $('#dlg-compte').showModal());
    $('#compte-fermer').addEventListener('click', () => $('#dlg-compte').close());
    $('#btn-sortir').addEventListener('click', deconnecter);
    $('#btn-garage').addEventListener('click', () => preferer('garage'));
    $('#btn-mdp').addEventListener('click', async () => {
      const m1 = $('#m-1').value;
      if (m1.length < 8) { toast('8 caractères minimum.'); return; }
      if (m1 !== $('#m-2').value) { toast('Les deux mots de passe ne sont pas identiques.'); return; }
      const { error } = await client.auth.updateUser({ password: m1 });
      if (error) { toast(error.message); return; }
      $('#m-1').value = ''; $('#m-2').value = '';
      toast('Mot de passe changé');
    });
    $('#vue').addEventListener('click', e => {
      const v = e.target.closest('[data-vue]');
      if (v) { vue = v.dataset.vue; q = ''; afficher(); return; }
      const f = e.target.closest('[data-filtre]');
      if (f) { filtreAbo = f.dataset.filtre; afficher(); return; }
      const fp = e.target.closest('[data-filtre-pro]');
      if (fp) { filtrePro = fp.dataset.filtrePro; afficher(); return; }
      const fl = e.target.closest('[data-filtre-lead]');
      if (fl) { filtreLead = fl.dataset.filtreLead; afficher(); return; }
      if (e.target.closest('#btn-actualiser')) { rafraichir(); return; }
      if (e.target.id === 'etapes-modifier') { etapesAvant = etapes.map(x => ({ ...x })); editionEtapes = true; afficher(); return; }
      if (e.target.id === 'etapes-annuler') { etapes = etapesAvant; editionEtapes = false; afficher(); return; }
      if (e.target.id === 'etapes-ok') {
        lireEtapes();
        if (etapes.some(x => !x.titre)) { toast('Donne un nom à chaque étape (ou supprime-la).'); return; }
        editionEtapes = false; afficher(); enregistrerEtapes(); return;
      }
      if (e.target.id === 'etape-ajouter') { lireEtapes(); etapes.push({ id: nouvelId(), titre: '', statut: 'a_faire', suite: '' }); afficher(); return; }
      if (e.target.dataset.etapeSuppr != null) { lireEtapes(); etapes.splice(Number(e.target.dataset.etapeSuppr), 1); afficher(); return; }
      if (e.target.dataset.etapeMonter != null) {
        lireEtapes(); const i = Number(e.target.dataset.etapeMonter);
        if (i > 0) [etapes[i - 1], etapes[i]] = [etapes[i], etapes[i - 1]];
        afficher(); return;
      }
      if (e.target.closest('#btn-pro-ajouter')) { ouvrirProspect(null); return; }
      if (e.target.closest('#btn-importer')) { $('#pro-fichier').click(); return; }
      if (e.target.closest('#btn-publier')) { publierAnnonce(); return; }
      const pr = e.target.closest('[data-pro]');
      if (pr) { ouvrirProspect(pr.dataset.pro); return; }
      const aa = e.target.closest('[data-an-actif]');
      if (aa) {
        const a = annonces.find(x => x.id === aa.dataset.anActif);
        rpc('crm_admin_annonce_enregistrer', { p: { ...a, actif: !a.actif } }).then(chargerAnnonces, err => toast(err.message));
        return;
      }
      const as = e.target.closest('[data-an-suppr]');
      if (as) {
        if (!confirm('Supprimer cette annonce ?')) return;
        rpc('crm_admin_annonce_supprimer', { p_id: as.dataset.anSuppr }).then(chargerAnnonces, err => toast(err.message));
        return;
      }
      if (e.target.closest('#btn-ajouter')) { if (vue === 'revendeurs') ouvrirRevendeur(null); else ouvrirApporteur(null); return; }
      const r = e.target.closest('[data-rev]');
      if (r) { ouvrirRevendeur(r.dataset.rev); return; }
      const a = e.target.closest('[data-app]');
      if (a) ouvrirApporteur(a.dataset.app);
    });
    $('#vue').addEventListener('change', e => {
      if (e.target.dataset.abo) changerAbo(e.target.dataset.abo, e.target.value, e.target);
      const eid = e.target.dataset.etapeStatut;
      if (eid) { etapes = etapes.map(x => x.id === eid ? { ...x, statut: e.target.value } : x); afficher(); enregistrerEtapes(); return; }
      const pid = e.target.dataset.etape;
      if (pid) {
        const p = prospects.find(x => x.id === pid);
        e.target.disabled = true;
        enregistrerProspect({ ...p, etape: e.target.value }, `${p.nom} : ${ETAPES[e.target.value][0]}`).catch(err => { toast(err.message); afficher(); });
      }
    });
    $('#vue').addEventListener('input', e => {
      if (e.target.id !== 'adm-q') return;
      q = e.target.value;
      const pos = e.target.selectionStart;
      afficher();
      const i = $('#adm-q'); i.focus(); i.setSelectionRange(pos, pos);
    });
    $('#rev-body').addEventListener('change', e => {
      if (e.target.dataset.droit === 'reseau') $('#rev-com').hidden = !e.target.checked;
      if (e.target.id === 'abo-debut') { lireRevendeur(); rendreRevendeur(); }
    });
    $('#rev-body').addEventListener('click', async e => {
      if (e.target.id === 'rev-pack-ajouter') { lireRevendeur(); rev.packs.push({ id: nouvelId(), nom: '', montant: '', coche: false }); rendreRevendeur(); return; }
      const s = e.target.dataset.pkSuppr;
      if (s != null) { lireRevendeur(); rev.packs.splice(Number(s), 1); rendreRevendeur(); return; }
      if (e.target.dataset.reinit) { if (await reinitialiser(e.target.dataset.reinit)) { await charger(); lireRevendeur(); rev.comptes = revendeurs.find(g => g.id === rev.id)?.comptes || []; rendreRevendeur(); } return; }
      const ret = e.target.dataset.retirer;
      if (ret) {
        if (!confirm(`Retirer l'accès de ${ret} ?`)) return;
        try { await rpc('crm_admin_compte_retirer', { p_email: ret }); await charger(); lireRevendeur(); rev.comptes = revendeurs.find(g => g.id === rev.id)?.comptes || []; rendreRevendeur(); }
        catch (err) { toast(err.message); }
      }
    });
    $('#app-body').addEventListener('click', async e => {
      if (e.target.dataset.reinit) { if (await reinitialiser(e.target.dataset.reinit)) { await charger(); ouvrirApporteur(app.email); } return; }
      const st = e.target.dataset.statut;
      if (st) {
        try { await rpc('crm_apporteur_statut', { p_email: app.email, p_statut: st }); toast(st === 'actif' ? 'Apporteur réactivé' : 'Apporteur suspendu'); await charger(); $('#dlg-app').close(); ouvrirApporteur(app.email); }
        catch (err) { toast(err.message); }
      }
    });
    $('#rev-ok').addEventListener('click', enregistrerRevendeur);
    $('#pro-ok').addEventListener('click', validerProspect);
    $('#pro-fichier').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importer(f); });
    $('#pro-suppr').addEventListener('click', async () => {
      if (!confirm(`Supprimer ${pro.nom} de la prospection ?`)) return;
      try { await rpc('crm_admin_prospect_supprimer', { p_id: pro.id }); $('#dlg-pro').close(); await chargerProspects(); } catch (err) { toast(err.message); }
    });
    $('#pro-body').addEventListener('input', e => {
      const k = e.target.dataset.en;
      if (k) { pro.entretien[k] = e.target.value; planifierSauvegarde(); }
    });
    $('#dlg-pro').addEventListener('close', () => { if (planifierSauvegarde.t) sauverEntretien(); else if (onglet === 'prospection') afficher(); });
    $('#pro-body').addEventListener('click', async e => {
      const vue = e.target.closest('[data-pro-vue]');
      if (vue) {
        document.querySelectorAll('#pro-body [data-pro-vue]').forEach(b => b.classList.toggle('active', b === vue));
        $('#pro-fiche').hidden = vue.dataset.proVue !== 'fiche';
        $('#pro-entretien').hidden = vue.dataset.proVue !== 'entretien';
        return;
      }
      const c = e.target.closest('[data-en-chip]');
      if (c) {
        const k = c.dataset.enChip, val = c.dataset.val;
        if (c.dataset.type === 'multi') {
          const l = pro.entretien[k] || [];
          pro.entretien[k] = l.includes(val) ? l.filter(x => x !== val) : [...l, val];
        } else pro.entretien[k] = pro.entretien[k] === val ? '' : val;
        c.parentElement.querySelectorAll('[data-en-chip]').forEach(b => {
          const on = c.dataset.type === 'multi' ? pro.entretien[k].includes(b.dataset.val) : pro.entretien[k] === b.dataset.val;
          b.classList.toggle('active', on); b.setAttribute('aria-pressed', on);
        });
        planifierSauvegarde();
        return;
      }
      const voir = e.target.dataset.voirRev;
      if (voir) { $('#dlg-pro').close(); ouvrirRevendeur(voir); return; }
      if (e.target.id === 'pro-convertir') {
        const id = await validerProspect();
        if (id) ouvrirRevendeur(null, prospects.find(x => x.id === id));
      }
    });
    $('#app-ok').addEventListener('click', enregistrerApporteur);
    ['rev', 'app', 'pro'].forEach(k => {
      $(`#${k}-fermer`).addEventListener('click', () => $(`#dlg-${k}`).close());
      $(`#${k}-annuler`).addEventListener('click', () => $(`#dlg-${k}`).close());
    });

    const s = reglages();
    if (!s.url || !s.cle || !window.supabase) { $('#auth-texte').textContent = "L'appli n'est pas reliée à sa base."; return; }
    client = window.supabase.createClient(s.url, s.cle, { auth: { persistSession: true, detectSessionInUrl: false, storage: stockage } });
    client.auth.getSession().then(({ data }) => {
      user = data.session?.user || null;
      if (user) demarrer(); else location.replace('./');
    });
  }
  init();
})();
