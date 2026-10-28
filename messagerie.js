// Messagerie entre partenaires du réseau Ocaz : les garages s'écrivent entre eux et avec les apporteurs d'affaires.
// Même fichier pour l'espace garage (index.html), l'espace apporteur (apporteur.html) et l'administration (admin.html).
// Un participant est un garage (« g:<id> », partagé par toute l'équipe) ou un apporteur (« a:<email> »).
// Les messages arrivent en direct (temps réel Supabase) ; la base vérifie qui a le droit d'écrire à qui.
// Modération : le destinataire peut signaler un message ; l'administrateur ne voit que les messages signalés.
const Messagerie = (() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const initiales = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || '?';
  const heure = d => {
    const x = new Date(d), maintenant = new Date();
    if (x.toDateString() === maintenant.toDateString()) return x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (maintenant - x < 6 * 864e5) return x.toLocaleDateString('fr-FR', { weekday: 'short' });
    return x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };
  const jourComplet = d => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const heureSeule = d => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  let client = null, moi = null, bouton = null, canal = null, mode = 'membre'; // membre | admin
  let convs = [], contacts = null, fil = null, vue = 'liste', recherche = '', contexte = '';
  let admin = { signalements: [], bloques: [] };

  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    ([...document.querySelectorAll('dialog[open]')].pop() || document.body).appendChild(t);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 3200);
  }
  async function rpc(nom, args) {
    const { data, error } = await client.rpc(nom, args);
    if (error) throw new Error(/function|schema cache/i.test(error.message) ? "La messagerie n'est pas encore installée dans la base : relance le script supabase.sql." : error.message);
    return data;
  }

  // ---------- Fenêtre ----------
  function fenetre() {
    let d = $('#dlg-msg');
    if (d) return d;
    d = document.createElement('dialog');
    d.id = 'dlg-msg';
    d.className = 'plein msg';
    d.innerHTML = `<div class="o-page">
      <div class="o-tete msg-tete"><button type="button" class="ghost-dark" id="msg-retour" aria-label="Retour" hidden>←</button>
        <div class="msg-titre"><h2 id="msg-titre">Messages</h2><span class="hint" id="msg-sous"></span></div>
        <button type="button" class="ghost-dark" id="msg-fermer" aria-label="Fermer">✕</button></div>
      <div class="msg-corps" id="msg-corps"></div>
      <form class="msg-saisie" id="msg-saisie" hidden>
        <div class="msg-contexte" id="msg-contexte" hidden></div>
        <div class="msg-ligne"><textarea id="msg-texte" rows="1" maxlength="2000" placeholder="Écris ton message…" aria-label="Message"></textarea>
          <button type="submit" class="primary" id="msg-envoyer">Envoyer</button></div>
      </form></div>`;
    document.body.appendChild(d);
    $('#msg-fermer').addEventListener('click', () => d.close());
    $('#msg-retour').addEventListener('click', () => { fil = null; contexte = ''; montrer('liste'); chargerConvs(); });
    d.addEventListener('close', () => { fil = null; contexte = ''; });
    $('#msg-saisie').addEventListener('submit', e => { e.preventDefault(); envoyer(); });
    const ta = $('#msg-texte');
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
    // Ordinateur : Entrée envoie, Maj+Entrée va à la ligne.
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(hover: hover)').matches) { e.preventDefault(); envoyer(); } });
    $('#msg-corps').addEventListener('click', clic);
    $('#msg-corps').addEventListener('input', e => {
      if (e.target.id !== 'msg-q') return;
      recherche = e.target.value;
      const l = $('#msg-liste');
      if (l) l.innerHTML = vue === 'contacts' ? listeContacts() : listeConvs();
    });
    return d;
  }

  function montrer(v) {
    vue = v;
    const d = fenetre();
    $('#msg-retour').hidden = v === 'liste' || v === 'admin';
    $('#msg-saisie').hidden = v !== 'fil' || !!fil?.bloque || fil?.autre?.actif === false;
    if (v === 'liste') {
      $('#msg-titre').textContent = 'Messages';
      $('#msg-sous').textContent = 'Garages et apporteurs du réseau Ocaz';
      $('#msg-corps').innerHTML = `<div class="msg-outils"><div class="search"><span class="ap-loupe">${icon('recherche', 18)}</span>
          <input id="msg-q" type="search" placeholder="Rechercher une conversation…" autocomplete="off" value="${esc(recherche)}"></div>
          <button type="button" class="primary" data-msg-nouveau>${icon('plus', 18)}<span>Nouveau</span></button></div>
        <div class="msg-liste" id="msg-liste">${listeConvs()}</div>`;
    } else if (v === 'contacts') {
      $('#msg-titre').textContent = 'Nouveau message';
      $('#msg-sous').textContent = moi?.startsWith('a:') ? 'Les garages du réseau' : 'Les garages et les apporteurs du réseau';
      $('#msg-corps').innerHTML = `<div class="msg-outils"><div class="search"><span class="ap-loupe">${icon('recherche', 18)}</span>
          <input id="msg-q" type="search" placeholder="Rechercher un garage ou un apporteur…" autocomplete="off" value="${esc(recherche)}"></div></div>
        <div class="msg-liste" id="msg-liste">${listeContacts()}</div>`;
      if (!contacts) chargerContacts();
    } else if (v === 'fil') {
      $('#msg-titre').textContent = fil?.autre?.nom || 'Conversation';
      $('#msg-sous').textContent = fil?.autre?.sous || '';
      rendreFil(true);
    } else if (v === 'admin') rendreAdmin();
    if (!d.open) d.showModal();
  }

  // ---------- Conversations ----------
  const avatar = p => `<span class="avatar${p?.type === 'apporteur' ? ' msg-ap' : ''}">${esc(initiales(p?.nom))}</span>`;
  function listeConvs() {
    const q = norm(recherche.trim());
    const l = convs.filter(c => !q || norm([c.autre?.nom, c.autre?.sous, c.dernier_texte].join(' ')).includes(q));
    if (!l.length) {
      return `<div class="empty"><strong>${q ? 'Aucun résultat' : 'Aucune conversation'}</strong>
        <span>${q ? 'Essaie une autre recherche.' : 'Écris à un garage ou à un apporteur du réseau avec « Nouveau ».'}</span></div>`;
    }
    return l.map(c => `<button type="button" class="msg-conv${c.non_lus ? ' non-lu' : ''}" data-msg-conv="${esc(c.id)}">
      ${avatar(c.autre)}
      <span class="msg-conv-txt"><span class="msg-conv-haut"><b>${esc(c.autre?.nom || 'Partenaire')}</b><span class="hint">${esc(heure(c.dernier_le))}</span></span>
        <span class="msg-conv-bas"><span class="msg-apercu">${esc(c.dernier_texte || c.autre?.sous || '')}</span>${c.non_lus ? `<span class="pastille">${c.non_lus}</span>` : ''}</span></span>
    </button>`).join('');
  }
  function listeContacts() {
    if (!contacts) return '<p class="hint msg-charge">Chargement…</p>';
    const q = norm(recherche.trim());
    const l = contacts.filter(p => !q || norm([p.nom, p.sous].join(' ')).includes(q));
    if (!l.length) return `<div class="empty"><strong>${q ? 'Aucun résultat' : 'Personne pour le moment'}</strong><span>${q ? 'Essaie une autre recherche.' : 'Les partenaires du réseau apparaîtront ici.'}</span></div>`;
    const groupe = (titre, x) => x.length ? `<h3 class="section">${titre}</h3>` + x.map(p => `<button type="button" class="msg-conv" data-msg-contact="${esc(p.cle)}">
      ${avatar(p)}<span class="msg-conv-txt"><b>${esc(p.nom)}</b><span class="msg-apercu">${esc(p.sous)}</span></span></button>`).join('') : '';
    return groupe('Garages', l.filter(p => p.type === 'garage')) + groupe("Apporteurs d'affaires", l.filter(p => p.type === 'apporteur'));
  }
  async function chargerContacts() {
    try { contacts = await rpc('crm_msg_contacts', { p_moi: moi }) || []; } catch (err) { contacts = []; toast(err.message); }
    if (vue === 'contacts' && $('#msg-liste')) $('#msg-liste').innerHTML = listeContacts();
  }
  async function chargerConvs() {
    if (!client || !moi) return;
    try { convs = await rpc('crm_msg_conversations', { p_moi: moi }) || []; } catch (err) { console.error(err); return; }
    majPastille(convs.reduce((n, c) => n + Number(c.non_lus || 0), 0));
    if (vue === 'liste' && $('#dlg-msg')?.open && $('#msg-liste')) $('#msg-liste').innerHTML = listeConvs();
  }
  function majPastille(n) {
    if (!bouton) return;
    let p = bouton.querySelector('.pastille');
    if (!n) { p?.remove(); return; }
    if (!p) { p = document.createElement('span'); p.className = 'pastille'; bouton.append(p); }
    p.textContent = n > 99 ? '99+' : n;
  }

  // ---------- Fil d'une conversation ----------
  async function ouvrirConv(id) {
    try {
      fil = await rpc('crm_msg_lire', { p_conv: id, p_moi: moi });
      montrer('fil');
      chargerConvs();
    } catch (err) { toast(err.message); }
  }
  async function anciens() {
    if (!fil?.messages.length) return;
    try {
      const r = await rpc('crm_msg_lire', { p_conv: fil.id, p_moi: moi, p_avant: fil.messages[0].id });
      fil.messages = [...r.messages, ...fil.messages];
      fil.plusAnciens = r.messages.length < 50;
      rendreFil(false);
    } catch (err) { toast(err.message); }
  }
  function rendreFil(enBas) {
    const corps = $('#msg-corps');
    const ms = fil.messages || [];
    let jour = '';
    const dernierMien = [...ms].reverse().find(m => m.moi);
    const html = ms.map(m => {
      const j = new Date(m.cree_le).toDateString();
      const sep = j !== jour ? `<div class="msg-jour">${esc(jourComplet(m.cree_le))}</div>` : '';
      jour = j;
      const lu = m === dernierMien && fil.lu_autre && new Date(fil.lu_autre) >= new Date(m.cree_le);
      return sep + `<div class="msg-bulle ${m.moi ? 'moi' : 'autre'}">
        ${m.contexte ? `<span class="msg-a-propos">À propos de : ${esc(m.contexte)}</span>` : ''}
        <span class="msg-texte">${esc(m.texte)}</span>
        <span class="msg-meta">${heureSeule(m.cree_le)}${lu ? ' · Lu' : ''}${!m.moi ? (m.signale ? ' · Signalé' : ` · <button type="button" class="lien" data-msg-signaler="${m.id}">Signaler</button>`) : ''}</span>
      </div>`;
    }).join('');
    const avant = corps.scrollHeight - corps.scrollTop;
    corps.innerHTML = `<div class="msg-fil">
      ${ms.length >= 50 && !fil.plusAnciens ? '<button type="button" class="chip msg-anciens" data-msg-anciens>Messages plus anciens</button>' : ''}
      ${ms.length ? html : `<div class="empty"><strong>Démarre la conversation</strong><span>Ton message arrive en direct chez ${esc(fil.autre?.nom || 'ce partenaire')}.</span></div>`}
      ${fil.bloque ? '<p class="msg-alerte">Ta messagerie a été suspendue par Ocaz. Pour en parler : contact@ocaz.re.</p>' : ''}
      ${fil.autre?.actif === false ? '<p class="msg-alerte">Ce partenaire ne fait plus partie du réseau.</p>' : ''}
    </div>`;
    corps.scrollTop = enBas ? corps.scrollHeight : corps.scrollHeight - avant;
    const c = $('#msg-contexte');
    c.hidden = !contexte;
    c.innerHTML = contexte ? `<span>À propos de : <b>${esc(contexte)}</b></span><button type="button" class="lien" id="msg-contexte-retirer" aria-label="Retirer">✕</button>` : '';
    if (contexte) $('#msg-contexte-retirer').onclick = () => { contexte = ''; rendreFil(false); };
  }
  async function envoyer() {
    const ta = $('#msg-texte');
    const t = ta.value.trim();
    if (!t || !fil) return;
    const b = $('#msg-envoyer');
    b.disabled = true;
    try {
      const m = await rpc('crm_msg_envoyer', { p_conv: fil.id, p_moi: moi, p_texte: t, p_contexte: contexte });
      if (!fil.messages.some(x => x.id === m.id)) fil.messages.push(m);
      ta.value = ''; ta.style.height = 'auto';
      contexte = '';
      rendreFil(true);
      chargerConvs();
    } catch (err) { toast(err.message); } finally { b.disabled = false; ta.focus(); }
  }
  async function signaler(id) {
    const motif = prompt("Pourquoi signales-tu ce message ? Ocaz le verra et pourra bloquer l'expéditeur.", '');
    if (motif === null) return;
    try {
      await rpc('crm_msg_signaler', { p_id: Number(id), p_moi: moi, p_motif: motif });
      const m = fil.messages.find(x => String(x.id) === String(id));
      if (m) m.signale = true;
      rendreFil(false);
      toast('Message signalé à Ocaz. Merci.');
    } catch (err) { toast(err.message); }
  }

  // Ouvre la conversation avec un partenaire (bouton « Message » d'un véhicule ou d'un lead).
  async function contacter(cle, nom, sujet) {
    if (!client || !moi) { toast('Connecte-toi pour utiliser la messagerie.'); return; }
    if (cle === moi) { toast("C'est ton propre garage."); return; }
    try {
      const id = await rpc('crm_msg_ouvrir', { p_moi: moi, p_autre: cle });
      fil = await rpc('crm_msg_lire', { p_conv: id, p_moi: moi });
      if (!fil.autre && nom) fil.autre = { nom };
      contexte = sujet || '';
      montrer('fil');
      setTimeout(() => $('#msg-texte').focus(), 50);
      chargerConvs();
    } catch (err) { toast(err.message); }
  }

  function clic(e) {
    const b = e.target.closest('[data-msg-conv],[data-msg-contact],[data-msg-nouveau],[data-msg-anciens],[data-msg-signaler],[data-adm-traiter],[data-adm-debloquer]');
    if (!b) return;
    const d = b.dataset;
    if (d.msgConv) ouvrirConv(d.msgConv);
    else if (d.msgContact) { recherche = ''; const p = contacts.find(x => x.cle === d.msgContact); contacter(d.msgContact, p?.nom, ''); }
    else if (d.msgNouveau !== undefined) { recherche = ''; montrer('contacts'); }
    else if (d.msgAnciens !== undefined) anciens();
    else if (d.msgSignaler) signaler(d.msgSignaler);
    else if (d.admTraiter) traiter(d.admTraiter, d.action);
    else if (d.admDebloquer) debloquer(d.admDebloquer);
  }

  // ---------- Temps réel ----------
  function ecouter() {
    if (canal || !client?.channel) return;
    canal = client.channel('messagerie')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crm_messages' }, async p => {
        const m = p.new || {};
        const ouvert = $('#dlg-msg')?.open && vue === 'fil' && fil?.id === m.conversation_id;
        if (ouvert) {
          try { fil = { ...fil, ...(await rpc('crm_msg_lire', { p_conv: fil.id, p_moi: moi })) }; rendreFil(true); } catch (err) { /* réseau */ }
        } else if (m.auteur_cle && m.auteur_cle !== moi) {
          const c = convs.find(x => x.id === m.conversation_id);
          const de = c?.autre?.nom || 'un partenaire';
          toast(`💬 Nouveau message de ${de}`);
          try {
            if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
              new Notification(`Message de ${de} · Ocaz`, { body: String(m.texte || '').slice(0, 140), icon: 'icon-512.png', tag: 'msg-' + m.conversation_id });
            }
          } catch (err) { /* notifications indisponibles */ }
        }
        chargerConvs();
      })
      .subscribe();
  }

  // ---------- Démarrage ----------
  // espace garage : moi = 'g:<id entreprise>' ; espace apporteur : moi = 'a:<email>'.
  function demarrer(o) {
    if (moi === o.moi && client === o.client) return;
    arreter();
    client = o.client; moi = o.moi; bouton = o.bouton; mode = 'membre';
    if (bouton) {
      bouton.hidden = false;
      bouton.innerHTML = icon('message', 20);
      bouton.onclick = () => { recherche = ''; montrer('liste'); chargerConvs(); };
    }
    chargerConvs();
    ecouter();
    if (!demarrer.focus) { demarrer.focus = true; window.addEventListener('focus', () => { if (mode === 'membre') chargerConvs(); }); }
  }
  function arreter() {
    if (canal) { client?.removeChannel(canal); canal = null; }
    if ($('#dlg-msg')?.open) $('#dlg-msg').close();
    if (bouton) { bouton.hidden = true; majPastille(0); }
    moi = null; convs = []; contacts = null; fil = null;
  }

  // ---------- Administration : messages signalés ----------
  async function chargerAdmin() {
    try { admin = await rpc('crm_msg_admin') || { signalements: [], bloques: [] }; } catch (err) { toast(err.message); return; }
    majPastille(admin.signalements.length);
    if (vue === 'admin' && $('#dlg-msg')?.open) rendreAdmin();
  }
  function rendreAdmin() {
    $('#msg-titre').textContent = 'Messagerie · signalements';
    $('#msg-sous').textContent = 'Tu ne vois que les messages signalés par leur destinataire.';
    const s = admin.signalements || [], b = admin.bloques || [];
    $('#msg-corps').innerHTML = `<div class="msg-admin">
      ${s.length ? s.map(x => `<section class="panneau msg-signal">
        <div class="top"><b>${esc(x.auteur?.nom || '?')}</b><span class="hint">signalé le ${esc(new Date(x.signale_le).toLocaleDateString('fr-FR'))} par ${esc(x.par?.nom || '?')}</span></div>
        <p class="hint">${esc(x.auteur?.sous || '')}${x.auteur_bloque ? ' · <b>déjà bloqué</b>' : ''}</p>
        <p><b>Motif :</b> ${esc(x.motif || '(aucun)')}</p>
        <div class="msg-extrait">${(x.autour || []).map(m => `<div class="${m.id === x.id ? 'vise' : ''}"><span class="hint">${esc(m.auteur)} · ${esc(new Date(m.cree_le).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))}</span><br>${esc(m.texte)}</div>`).join('')}</div>
        <div class="chips"><button type="button" class="chip" data-adm-traiter="${x.id}" data-action="ignorer">Rien à signaler</button>
          ${x.auteur_bloque ? '' : `<button type="button" class="chip danger" data-adm-traiter="${x.id}" data-action="bloquer">Bloquer l'expéditeur</button>`}</div>
      </section>`).join('') : '<div class="empty"><strong>Aucun message signalé</strong><span>Quand un partenaire signale un message, il apparaît ici.</span></div>'}
      ${b.length ? `<h3 class="section">Messagerie bloquée</h3>${b.map(p => `<div class="msg-conv">${avatar(p)}<span class="msg-conv-txt"><b>${esc(p.nom)}</b>
        <span class="msg-apercu">${esc(p.sous)} · depuis le ${esc(new Date(p.bloque_le).toLocaleDateString('fr-FR'))}</span></span>
        <button type="button" class="chip" data-adm-debloquer="${esc(p.cle)}">Débloquer</button></div>`).join('')}` : ''}
    </div>`;
  }
  async function traiter(id, action) {
    if (action === 'bloquer' && !confirm("Bloquer l'expéditeur ? Il pourra lire ses messages mais plus en envoyer.")) return;
    try { await rpc('crm_msg_admin_traiter', { p_id: Number(id), p_action: action }); toast(action === 'bloquer' ? 'Expéditeur bloqué' : 'Signalement classé'); }
    catch (err) { toast(err.message); }
    chargerAdmin();
  }
  async function debloquer(cle) {
    try { await rpc('crm_msg_admin_traiter', { p_id: null, p_action: 'debloquer', p_cle: cle }); toast('Messagerie débloquée'); }
    catch (err) { toast(err.message); }
    chargerAdmin();
  }
  function moderer(o) {
    client = o.client; bouton = o.bouton; mode = 'admin';
    if (bouton) {
      bouton.hidden = false;
      bouton.innerHTML = icon('message', 20);
      bouton.title = 'Messages signalés';
      bouton.onclick = () => { montrer('admin'); chargerAdmin(); };
    }
    chargerAdmin();
  }

  return { demarrer, arreter, contacter, moderer, get actif() { return !!moi; }, get moi() { return moi; } };
})();
