// Onglet Calendrier de l'administrateur : la semaine heure par heure, ses rendez-vous et activités, une couleur par type.
// On change de semaine en glissant le doigt (ou avec les flèches). Un rendez-vous de prospection peut être lié à un garage prospect.
// Types d'activité (nom + couleur) enregistrés dans crm_admin_reglages, clé 'agenda_types'.
window.Calendrier = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COULEURS = ['#f5b301', '#22a06b', '#e5484d', '#8e4ec6', '#ef6c00', '#12a594', '#d6409f', '#8b8f97'];
  const TYPES = [{ id: 'prospection', nom: 'Prospection', couleur: '#f5b301' }, { id: 'travail', nom: 'Travail', couleur: '#22a06b' },
    { id: 'rdv', nom: 'RDV', couleur: '#e5484d' }, { id: 'autre', nom: 'Autre', couleur: '#8e4ec6' }];
  const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const HAUT = () => (matchMedia('(min-width: 900px)').matches ? 52 : 46); // hauteur d'une heure (px)

  let ctx = null, lundi = debutSemaine(new Date()), evts = null, types = null, prospects = null, ev = null, dlg = null, dlgTypes = null, editTypes = null;
  let defile = null; // position de défilement à garder d'un affichage à l'autre

  function debutSemaine(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
  const plus = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const min = h => { const [a, b] = String(h || '0:0').split(':').map(Number); return a * 60 + (b || 0); };
  const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const heure = h => h.replace(':00', 'h').replace(':', 'h');
  const typeDe = id => types.find(t => t.id === id) || { id, nom: 'Sans type', couleur: '#8b8f97' };
  const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function titreSemaine() {
    const fin = plus(lundi, 6), o = { day: 'numeric', month: 'short' };
    return `${lundi.toLocaleDateString('fr-FR', o)} – ${fin.toLocaleDateString('fr-FR', { ...o, year: 'numeric' })}`;
  }

  // ---------- Chargement ----------
  async function charger() {
    const debut = lundi;
    try {
      if (!types) {
        const v = await ctx.rpc('crm_admin_reglage_lire', { p_cle: 'agenda_types' }).catch(() => null);
        types = v?.liste?.length ? v.liste : TYPES.map(t => ({ ...t }));
      }
      const liste = await ctx.rpc('crm_admin_agenda', { p_du: iso(debut), p_au: iso(plus(debut, 6)) });
      if (debut === lundi) evts = liste;
    } catch (err) { ctx.toast(err.message); evts = evts || []; types = types || TYPES.map(t => ({ ...t })); }
    if (ctx.actif()) afficher();
  }
  function changerSemaine(n, sens) {
    lundi = n ? plus(lundi, 7 * n) : debutSemaine(new Date());
    evts = null;
    const g = ctx.vue.querySelector('.cal-grille');
    if (g && sens) g.classList.add(sens < 0 ? 'cal-part-g' : 'cal-part-d');
    setTimeout(() => { afficher(sens); charger(); }, sens ? 140 : 0);
  }

  // ---------- Affichage ----------
  // Rendez-vous qui se chevauchent : côte à côte, chacun dans sa colonne.
  function placer(liste) {
    const tri = [...liste].sort((a, b) => min(a.debut) - min(b.debut) || min(b.fin) - min(a.fin));
    let groupe = [], finGroupe = -1;
    const out = [];
    const fermer = () => { const n = Math.max(...groupe.map(x => x.col)) + 1; groupe.forEach(x => { x.n = n; out.push(x); }); groupe = []; };
    tri.forEach(e => {
      const d = min(e.debut), f = min(e.fin);
      if (groupe.length && d >= finGroupe) fermer();
      const cols = groupe.filter(x => min(x.e.fin) > d).map(x => x.col);
      let col = 0; while (cols.includes(col)) col++;
      groupe.push({ e, col });
      finGroupe = Math.max(finGroupe, f);
    });
    if (groupe.length) fermer();
    return out;
  }
  function afficher(sens) {
    const vue = ctx.vue;
    const ancien = vue.querySelector('.cal-corps');
    if (ancien && !sens) defile = ancien.scrollTop;
    const liste = evts || [];
    const H = HAUT();
    const h0 = Math.min(6, ...liste.map(e => Math.floor(min(e.debut) / 60)));
    const h1 = Math.max(22, ...liste.map(e => Math.ceil(min(e.fin) / 60)));
    const auj = iso(new Date()), maintenant = new Date(), mNow = maintenant.getHours() * 60 + maintenant.getMinutes();
    const jours = [...Array(7)].map((_, i) => plus(lundi, i));
    const compte = id => liste.filter(e => e.type === id).length;
    const heuresTot = id => liste.filter(e => e.type === id).reduce((s, e) => s + min(e.fin) - min(e.debut), 0);
    const duree = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`;
    const bloc = ({ e, col, n }) => {
      const t = typeDe(e.type), d = min(e.debut), f = min(e.fin), court = f - d < 45;
      return `<button type="button" class="cal-ev${court ? ' court' : ''}" data-cal-ev="${esc(e.id)}" style="--c:${esc(t.couleur)};top:${(d - h0 * 60) / 60 * H}px;height:${Math.max((f - d) / 60 * H - 2, 18)}px;left:calc(${col} * 100% / ${n});width:calc(100% / ${n} - 2px)">
        <b>${esc(e.titre)}</b><small>${heure(e.debut)}${court ? '' : '–' + heure(e.fin)}${e.prospect && e.prospect !== e.titre ? ' · ' + esc(e.prospect) : ''}</small></button>`;
    };
    const parJour = jours.map(j => liste.filter(e => e.jour === iso(j)));
    vue.innerHTML = `<div class="ap-page cal">
      <div class="adm-tete"><h2>Calendrier</h2>
        <button type="button" class="primary" data-cal-ajouter>${icon('plus', 18)}<span>Ajouter</span></button></div>
      <div class="semaine-nav cal-nav">
        <button type="button" class="chip" data-cal-sem="-1" aria-label="Semaine précédente">‹</button>
        <strong>${titreSemaine()}</strong>
        ${iso(lundi) === iso(debutSemaine(new Date())) ? '' : '<button type="button" class="chip" data-cal-sem="0">Aujourd\'hui</button>'}
        <button type="button" class="chip" data-cal-sem="1" aria-label="Semaine suivante">›</button>
      </div>
      <div class="cal-legende">${types.map(t => `<span class="cal-type" style="--c:${esc(t.couleur)}"><i></i>${esc(t.nom)}${compte(t.id) ? ` <small>${compte(t.id)} · ${duree(heuresTot(t.id))}</small>` : ''}</span>`).join('')}
        <button type="button" class="chip" data-cal-types>Types et couleurs</button></div>
      <div class="cal-grille${sens ? (sens < 0 ? ' cal-entre-g' : ' cal-entre-d') : ''}">
        <div class="cal-jours"><span></span>${jours.map(j => `<span class="${iso(j) === auj ? 'auj' : ''}">${JOURS[(j.getDay() + 6) % 7]} <b>${j.getDate()}</b></span>`).join('')}</div>
        <div class="cal-corps" style="--h:${H}px">
          <div class="cal-heures">${[...Array(h1 - h0)].map((_, i) => `<span>${h0 + i}h</span>`).join('')}</div>
          ${jours.map((j, i) => `<div class="cal-jour${iso(j) === auj ? ' auj' : ''}" data-cal-jour="${iso(j)}" data-h0="${h0}" style="height:${(h1 - h0) * H}px">
            ${placer(parJour[i]).map(bloc).join('')}
            ${iso(j) === auj && mNow >= h0 * 60 && mNow <= h1 * 60 ? `<i class="cal-maintenant" style="top:${(mNow - h0 * 60) / 60 * H}px"></i>` : ''}</div>`).join('')}
        </div>
      </div>
      <p class="hint cal-aide">Touche une case vide pour ajouter un rendez-vous à cette heure. Glisse vers la gauche ou la droite pour changer de semaine.</p>
      <h3 class="section">Cette semaine</h3>
      <div class="adm-bloc cal-liste">${!evts ? '<p class="hint">Chargement…</p>' : liste.length ? jours.map((j, i) => parJour[i].length ? `<div class="cal-liste-jour"><h4>${j.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</h4>
          ${parJour[i].map(e => `<div class="cal-ligne" style="--c:${esc(typeDe(e.type).couleur)}"><button type="button" data-cal-ev="${esc(e.id)}"><i></i><span><b>${heure(e.debut)}–${heure(e.fin)} · ${esc(e.titre)}</b>
            <small>${esc([typeDe(e.type).nom, e.prospect, e.lieu].filter(Boolean).join(' · '))}</small></span></button>
            ${e.telephone ? `<a class="chip" href="tel:${esc(e.telephone.replace(/\s/g, ''))}">Appeler</a>` : ''}</div>`).join('')}</div>` : '').join('')
        : '<div class="empty"><strong>Rien de prévu cette semaine</strong><span>Ajoute une prospection, un rendez-vous ou un créneau de travail.</span></div>'}</div>
    </div>`;
    const corps = vue.querySelector('.cal-corps');
    // À la première ouverture : on se place sur 7 h (ou plus tôt si un rendez-vous commence avant).
    corps.scrollTop = defile ?? (Math.min(7, ...liste.map(e => Math.floor(min(e.debut) / 60))) - h0) * H;
    brancher(vue.querySelector('.cal'));
  }

  // ---------- Gestes ----------
  function brancher(page) {
    page.addEventListener('click', e => {
      const s = e.target.closest('[data-cal-sem]');
      if (s) { const n = Number(s.dataset.calSem); changerSemaine(n, n); return; }
      if (e.target.closest('[data-cal-ajouter]')) { ouvrir(null, { jour: iso(jourParDefaut()), debut: '09:00', fin: '10:00' }); return; }
      if (e.target.closest('[data-cal-types]')) { ouvrirTypes(); return; }
      const b = e.target.closest('[data-cal-ev]');
      if (b) { ouvrir(b.dataset.calEv); return; }
      const col = e.target.closest('[data-cal-jour]');
      if (col && !balayage) {
        const y = e.clientY - col.getBoundingClientRect().top;
        const m = Math.max(0, Math.min(23 * 60 + 30, Math.floor((Number(col.dataset.h0) * 60 + y / HAUT() * 60) / 30) * 30));
        ouvrir(null, { jour: col.dataset.calJour, debut: hhmm(m), fin: hhmm(Math.min(m + 60, 23 * 60 + 59)) });
      }
    });
    // Glisser horizontalement sur la grille = semaine précédente / suivante.
    const g = page.querySelector('.cal-grille');
    let x0 = null, y0 = null, balayage = false;
    g.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; balayage = false; }, { passive: true });
    g.addEventListener('touchmove', e => {
      if (x0 == null) return;
      const dx = e.touches[0].clientX - x0, dy = e.touches[0].clientY - y0;
      if (!balayage && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) balayage = true;
      if (balayage) g.style.transform = `translateX(${dx * .35}px)`;
    }, { passive: true });
    g.addEventListener('touchend', e => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      g.style.transform = '';
      if (balayage && Math.abs(dx) > 60) changerSemaine(dx < 0 ? 1 : -1, dx < 0 ? 1 : -1);
      x0 = null;
      setTimeout(() => { balayage = false; }, 50);
    });
  }
  const jourParDefaut = () => { const a = new Date(); return a >= lundi && a < plus(lundi, 7) ? a : lundi; };
  document.addEventListener('keydown', e => {
    if (!ctx?.actif() || document.querySelector('dialog[open]') || /input|select|textarea/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') changerSemaine(-1, -1);
    if (e.key === 'ArrowRight') changerSemaine(1, 1);
  });

  // ---------- Fiche rendez-vous ----------
  function creerFenetres() {
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-cal';
    dlg.className = 'plein';
    dlg.innerHTML = `<div class="o-page"><div class="o-tete"><h2 id="cal-titre"></h2><button type="button" class="ghost-dark" data-fermer aria-label="Fermer">✕</button></div>
      <div class="o-body" id="cal-body"></div>
      <div class="actions o-actions"><button type="button" id="cal-suppr" class="danger">Supprimer</button><span class="spacer"></span>
        <button type="button" data-fermer>Annuler</button><button type="button" id="cal-ok" class="primary">Enregistrer</button></div></div>`;
    dlgTypes = document.createElement('dialog');
    dlgTypes.id = 'dlg-cal-types';
    dlgTypes.className = 'plein';
    dlgTypes.innerHTML = `<div class="o-page"><div class="o-tete"><h2>Types d'activité</h2><button type="button" class="ghost-dark" data-fermer aria-label="Fermer">✕</button></div>
      <div class="o-body" id="cal-types-body"></div>
      <div class="actions o-actions"><span class="spacer"></span><button type="button" data-fermer>Annuler</button><button type="button" id="cal-types-ok" class="primary">Enregistrer</button></div></div>`;
    document.body.append(dlg, dlgTypes);
    [dlg, dlgTypes].forEach(d => d.addEventListener('click', e => { if (e.target.closest('[data-fermer]')) d.close(); }));
    dlg.querySelector('#cal-ok').addEventListener('click', enregistrer);
    dlg.querySelector('#cal-suppr').addEventListener('click', supprimer);
    dlg.addEventListener('click', e => {
      const t = e.target.closest('[data-cal-type]');
      if (t) { lire(); ev.type = t.dataset.calType; rendre(); }
    });
    dlg.addEventListener('change', e => {
      if (e.target.id === 'cf-debut') { // on garde la durée quand on déplace le début
        const d = min(ev.debut), f = min(ev.fin), n = min(e.target.value);
        if (e.target.value && f > d) dlg.querySelector('#cf-fin').value = hhmm(Math.min(n + f - d, 23 * 60 + 59));
      }
      if (e.target.id === 'cf-prospect') {
        const p = prospects.find(x => x.id === e.target.value), t = dlg.querySelector('#cf-titre');
        if (p && (!t.value.trim() || prospects.some(x => x.nom === t.value.trim()))) t.value = p.nom;
        if (p && !dlg.querySelector('#cf-lieu').value.trim() && p.ville) dlg.querySelector('#cf-lieu').value = p.ville;
      }
      lire();
    });
    dlgTypes.querySelector('#cal-types-ok').addEventListener('click', enregistrerTypes);
    dlgTypes.addEventListener('click', e => {
      const c = e.target.closest('[data-couleur]');
      if (c) { lireTypes(); editTypes[Number(c.dataset.i)].couleur = c.dataset.couleur; rendreTypes(); return; }
      const s = e.target.closest('[data-type-suppr]');
      if (s) { lireTypes(); editTypes.splice(Number(s.dataset.typeSuppr), 1); rendreTypes(); return; }
      if (e.target.closest('#cal-type-ajouter')) { lireTypes(); editTypes.push({ id: nouvelId(), nom: '', couleur: COULEURS.find(c => !editTypes.some(t => t.couleur === c)) || COULEURS[7] }); rendreTypes(); dlgTypes.querySelector(`[data-tn="${editTypes.length - 1}"]`).focus(); }
    });
  }
  async function ouvrir(id, base) {
    if (!dlg) creerFenetres();
    ev = id ? { ...evts.find(e => e.id === id) } : { type: types[0]?.id || '', titre: '', lieu: '', note: '', prospect_id: '', ...base };
    dlg.querySelector('#cal-titre').textContent = id ? 'Rendez-vous' : 'Nouveau rendez-vous';
    dlg.querySelector('#cal-suppr').hidden = !id;
    rendre();
    dlg.showModal();
    if (!prospects) {
      prospects = await ctx.rpc('crm_admin_prospects').catch(() => []);
      if (dlg.open) { lire(); rendre(); }
    }
  }
  function rendre() {
    const ch = (k, l, cls, type, extra) => `<div class="field ${cls || ''}"><label for="cf-${k}">${l}</label><input id="cf-${k}" data-cf="${k}" type="${type || 'text'}" value="${esc(ev[k] || '')}" autocomplete="off"${extra || ''}></div>`;
    const lies = (prospects || []).filter(p => !['signe', 'pas_interesse'].includes(p.etape) || p.id === ev.prospect_id).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    dlg.querySelector('#cal-body').innerHTML = `
      <div class="field"><label>Type</label><div class="cal-choix">${types.map(t => `<button type="button" class="chip cal-type${ev.type === t.id ? ' active' : ''}" data-cal-type="${esc(t.id)}" style="--c:${esc(t.couleur)}"><i></i>${esc(t.nom)}</button>`).join('')}</div></div>
      <div class="grid">${ch('titre', 'Titre *', 'full', 'text', ' maxlength="140" placeholder="Visite GT Auto, compta, démo…"')}
        ${ch('jour', 'Jour', 'full', 'date')}${ch('debut', 'Début', '', 'time', ' step="900"')}${ch('fin', 'Fin', '', 'time', ' step="900"')}
        <div class="field full"><label for="cf-prospect">Garage prospect (facultatif)</label><select id="cf-prospect" data-cf="prospect_id">
          <option value="">${prospects ? 'Aucun' : 'Chargement…'}</option>${lies.map(p => `<option value="${esc(p.id)}"${p.id === ev.prospect_id ? ' selected' : ''}>${esc(p.nom)}${p.ville ? ' (' + esc(p.ville) + ')' : ''}</option>`).join('')}</select></div>
        ${ch('lieu', 'Lieu', 'full', 'text', ' maxlength="200"')}
        <div class="field full"><label for="cf-note">Notes</label><textarea id="cf-note" data-cf="note" rows="4">${esc(ev.note || '')}</textarea></div></div>`;
  }
  function lire() { dlg.querySelectorAll('#cal-body [data-cf]').forEach(i => { ev[i.dataset.cf] = i.value.trim(); }); return ev; }
  async function enregistrer() {
    const e = lire();
    if (!e.titre) { ctx.toast('Donne un titre au rendez-vous.'); dlg.querySelector('#cf-titre').focus(); return; }
    if (!e.jour || !e.debut || !e.fin) { ctx.toast('Indique le jour et les heures.'); return; }
    if (min(e.fin) <= min(e.debut)) { ctx.toast("L'heure de fin doit être après l'heure de début."); return; }
    const btn = dlg.querySelector('#cal-ok');
    btn.disabled = true;
    try {
      await ctx.rpc('crm_admin_agenda_enregistrer', { p: e });
      dlg.close();
      ctx.toast('Rendez-vous enregistré');
      const j = new Date(e.jour + 'T12:00:00');
      if (j < lundi || j >= plus(lundi, 7)) { lundi = debutSemaine(j); defile = null; }
      await charger();
    } catch (err) { ctx.toast(err.message); } finally { btn.disabled = false; }
  }
  async function supprimer() {
    if (!confirm(`Supprimer « ${ev.titre} » ?`)) return;
    try { await ctx.rpc('crm_admin_agenda_supprimer', { p_id: ev.id }); dlg.close(); await charger(); } catch (err) { ctx.toast(err.message); }
  }

  // ---------- Types d'activité ----------
  function ouvrirTypes() {
    if (!dlg) creerFenetres();
    editTypes = types.map(t => ({ ...t }));
    rendreTypes();
    dlgTypes.showModal();
  }
  function rendreTypes() {
    dlgTypes.querySelector('#cal-types-body').innerHTML = `<p class="hint">Renomme, change la couleur ou ajoute tes propres types (formation, administratif, perso…).</p>
      <div class="adm-bloc">${editTypes.map((t, i) => `<div class="cal-type-ligne">
        <input data-tn="${i}" value="${esc(t.nom)}" maxlength="30" placeholder="Nom du type" aria-label="Nom du type">
        <span class="cal-pastilles">${COULEURS.map(c => `<button type="button" class="cal-pastille${t.couleur === c ? ' active' : ''}" data-i="${i}" data-couleur="${c}" style="--c:${c}" aria-label="Couleur ${c}"></button>`).join('')}</span>
        <button type="button" class="chip" data-type-suppr="${i}" aria-label="Supprimer ce type"${editTypes.length < 2 ? ' disabled' : ''}>✕</button></div>`).join('')}
        <div><button type="button" class="chip" id="cal-type-ajouter">+ Ajouter un type</button></div></div>`;
  }
  function lireTypes() { dlgTypes.querySelectorAll('[data-tn]').forEach(i => { editTypes[Number(i.dataset.tn)].nom = i.value.trim(); }); }
  async function enregistrerTypes() {
    lireTypes();
    if (editTypes.some(t => !t.nom)) { ctx.toast('Donne un nom à chaque type (ou supprime-le).'); return; }
    try {
      await ctx.rpc('crm_admin_reglage_ecrire', { p_cle: 'agenda_types', p_valeur: { liste: editTypes } });
      types = editTypes;
      dlgTypes.close();
      ctx.toast('Types enregistrés');
      afficher();
    } catch (err) { ctx.toast(err.message); }
  }

  return {
    // c : { rpc, toast, vue (élément #vue), actif () → l'onglet Calendrier est ouvert }
    monter(c) { ctx = c; },
    afficher() {
      if (!types) { ctx.vue.innerHTML = '<div class="ap-page"><p class="hint">Chargement…</p></div>'; return; }
      afficher();
    },
    charger() { defile = null; return charger(); },
  };
})();
