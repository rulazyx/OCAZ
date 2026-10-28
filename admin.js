// Interface de l'administrateur d'Ocaz (super-admin seulement) : onglet Partenaires (revendeurs et apporteurs)
// et onglet Abonnements (suivi des revendeurs payants, revenu mensuel, essais qui se terminent, impayés).
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
  let onglet = 'partenaires', vue = 'revendeurs', q = '', filtreAbo = 'tous';
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
      await charger();
    } catch (err) { $('#auth-texte').textContent = err.message; }
  }
  async function charger() {
    try {
      [revendeurs, apporteurs] = await Promise.all([rpc('crm_admin_revendeurs'), rpc('crm_apporteurs_liste')]);
    } catch (err) { toast(err.message); }
    afficher();
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
    if (onglet === 'abonnements') afficherAbonnements(); else afficherPartenaires();
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
    const barre = (v, max) => `<div class="adm-barre"><span style="width:${Math.min(100, Math.round(v / max * 100))}%"></span></div>`;
    $('#vue').innerHTML = `<div class="ap-page">
      <div class="adm-tete"><h2>Abonnements</h2><span class="hint">${eur(PRIX)} par mois · premier mois offert · sans engagement</span></div>
      <div class="kpis">
        <div class="kpi"><span class="kpi-l">Revenu mensuel</span><span class="kpi-v">${eur(actifs * PRIX)}</span><span class="kpi-s">${actifs} abonné(s) qui paient</span></div>
        <div class="kpi"><span class="kpi-l">En essai gratuit</span><span class="kpi-v">${essais}</span><span class="kpi-s">${essais ? '+' + eur(essais * PRIX) + " s'ils restent" : 'Aucun en ce moment'}</span></div>
        <div class="kpi${impayes ? ' negatif' : ''}"><span class="kpi-l">Impayés</span><span class="kpi-v">${impayes}</span><span class="kpi-s">${impayes ? eur(impayes * PRIX) + ' en attente' : 'Tout est à jour'}</span></div>
        <div class="kpi"><span class="kpi-l">Revenu à ${CAP} garages</span><span class="kpi-v">${eur(CAP * PRIX)}</span><span class="kpi-s">par mois, ${eur(CAP * PRIX * 12)} par an</span></div>
      </div>
      <div class="adm-bloc adm-objectifs">
        <div><span>Objectif ${OBJECTIF} abonnés (avril 2027) : <b>${actifs} / ${OBJECTIF}</b></span>${barre(actifs, OBJECTIF)}</div>
        <div><span>Cap des ${CAP} garages partenaires : <b>${partenaires} / ${CAP}</b> <small class="hint">(abonnés, essais, impayés et offerts)</small></span>${barre(partenaires, CAP)}</div>
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

  // ---------- Fiche revendeur ----------
  function ouvrirRevendeur(id) {
    const g = revendeurs.find(x => x.id === id);
    const c = g?.config || {};
    rev = { id: g?.id || null, infos: { ...(c.infos || {}), nom: c.infos?.nom || g?.nom || '' }, droits: { ...droitsDe(g ? c : { droits: { reseau: false, depot: false, achat: true } }) },
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
      await rpc('crm_admin_revendeur_enregistrer', { p_id: rev.id, p_email: email, p_config: config });
      $('#dlg-rev').close();
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
      const ic = { partenaires: 'clients', abonnements: 'abonnements' }[b.dataset.tab];
      b.innerHTML = icon(ic, b.closest('#bottom-tabs') ? 22 : 18) + '<span>' + b.textContent + '</span>';
      b.addEventListener('click', () => { onglet = b.dataset.tab; q = ''; afficher(); window.scrollTo(0, 0); });
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
      if (e.target.closest('#btn-ajouter')) { if (vue === 'revendeurs') ouvrirRevendeur(null); else ouvrirApporteur(null); return; }
      const r = e.target.closest('[data-rev]');
      if (r) { ouvrirRevendeur(r.dataset.rev); return; }
      const a = e.target.closest('[data-app]');
      if (a) ouvrirApporteur(a.dataset.app);
    });
    $('#vue').addEventListener('change', e => {
      if (e.target.dataset.abo) changerAbo(e.target.dataset.abo, e.target.value, e.target);
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
    $('#app-ok').addEventListener('click', enregistrerApporteur);
    ['rev', 'app'].forEach(k => {
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
