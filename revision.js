// Rappels de révision : 11 mois après une vente livrée, le client reçoit un mail (fonction Supabase « revision »,
// lancée chaque jour par la base) et le garage voit un lead « Révision » à rappeler dans l'onglet Leads.
// Le prix proposé = coût de la révision (ligne vidange de la préparation du véhicule, sinon coût réglé dans Paramètres)
// + la marge du garage. Le suivi du lead (RDV, faite, close) est gardé sur la commande (champ revision).
const Revision = (() => {
  const DEFAUTS = { actif: true, mail: true, delaiMois: 11, cout: '', margeType: 'pourcentage', margeValeur: 30, prixDansMail: true };
  const VUES = { 'À appeler': 'a_appeler', 'À venir': 'a_venir', RDV: 'rdv', Faites: 'faite', Closes: 'clos' };
  const STATUTS = { a_appeler: ['À appeler', 'b-orange'], a_venir: ['À venir', 'b-grey'], rdv: ['RDV pris', 'b-blue'], faite: ['Faite', 'b-green'], clos: ['Close', 'b-grey'] };
  const MOTIFS = ['Pas intéressé', 'Client injoignable', 'Révision faite ailleurs', 'Véhicule revendu', 'Autre'];
  // Délai passé depuis plus de 6 mois sans suivi : la vente n'apparaît plus (anciennes ventes importées).
  const OUBLI_JOURS = 180;
  const A_VENIR_JOURS = 30;
  let vue = 'À appeler';
  let vueLeads = null; // 'revisions' | 'reseau'
  let envois = new Map(); // commande_id → { envoye_le, statut, stop_le }
  let stops = new Set();
  let chargeLe = 0;
  let enCours = null; // { id, mode } dans la fenêtre RDV / Faite / Clore

  const reglages = () => ({ ...DEFAUTS, ...(Param.get().revision || {}) });
  const actif = () => !!reglages().actif;

  // ---------- Calculs ----------
  const plusMois = (date, n) => {
    const d = new Date(date + 'T12:00:00');
    const jour = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(jour, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return isoLocal(d);
  };
  const dateVente = o => String(o.dateLivree || o.dateLivraison || o.date || '').slice(0, 10);
  const echeance = o => plusMois(dateVente(o), num(reglages().delaiMois) || 11);

  // Coût de la révision : la ligne vidange de la préparation du véhicule (son tarif prépa), sinon le coût du garage.
  function cout(v) {
    const vidange = (v?.prepa || []).find(p => /vidange|r[ée]vision/i.test(p.nom || '') && num(p.montant) > 0);
    return vidange ? { montant: num(vidange.montant), source: 'prépa du véhicule' } : { montant: num(reglages().cout), source: 'coût du garage' };
  }
  function prix(v) {
    const r = reglages();
    const c = cout(v);
    if (!c.montant) return { prix: 0, cout: 0, marge: 0, source: '' };
    const marge = r.margeType === 'fixe' ? num(r.margeValeur) : c.montant * num(r.margeValeur) / 100;
    return { prix: Math.round((c.montant + marge) / 5) * 5, cout: c.montant, marge, source: c.source };
  }

  // Leads de révision : une vente livrée par lead, avec son état.
  function leads() {
    if (!actif()) return [];
    const auj = today();
    const oubli = isoLocal(ajouterJours(new Date(), -OUBLI_JOURS));
    const avant = isoLocal(ajouterJours(new Date(), A_VENIR_JOURS));
    return db.all('commandes').filter(o => o.statut === 'Livrée' && dateVente(o)).map(o => {
      const e = echeance(o);
      const s = o.revision?.statut || (e <= auj ? 'a_appeler' : 'a_venir');
      return { o, e, s, c: db.get('clients', o.clientId), v: db.get('vehicules', o.vehiculeId) };
    }).filter(x => x.o.revision?.statut || (x.s === 'a_appeler' ? x.e >= oubli : x.e <= avant))
      .sort((a, b) => (a.o.revision?.rdv || a.e).localeCompare(b.o.revision?.rdv || b.e));
  }
  const aAppeler = () => leads().filter(x => x.s === 'a_appeler');

  // ---------- Mails envoyés (lus dans la base) ----------
  async function charger(forcer) {
    if (!Sync.role || !Sync.client || (!forcer && Date.now() - chargeLe < 60000)) return;
    chargeLe = Date.now();
    const [a, b] = await Promise.all([
      Sync.client.from('crm_revision_envois').select('commande_id, envoye_le, statut, stop_le'),
      Sync.client.from('crm_revision_stop').select('email'),
    ]);
    if (a.error) return; // tables pas encore installées : relancer supabase.sql
    envois = new Map((a.data || []).map(x => [x.commande_id, x]));
    stops = new Set((b.data || []).map(x => x.email));
    if (['leads', 'donnees'].includes(onglet)) render();
  }
  function etatMail(x) {
    const r = reglages();
    const env = envois.get(x.o.id);
    const email = String(x.c?.email || '').trim().toLowerCase();
    if (env?.stop_le || (email && stops.has(email))) return '<span class="neg">✉ Le client a refusé les rappels par mail</span>';
    if (env) return `✉ Mail de rappel envoyé le ${dateFr(env.envoye_le)}`;
    if (!r.mail) return '✉ Mail automatique désactivé (Paramètres)';
    if (!email) return '✉ Pas d\'email sur la fiche : rappel par téléphone seulement';
    if (x.c?.pasDeRappel) return '✉ Le client ne veut pas de rappel par mail';
    if (Sync.entreprise?.demo) return '✉ Démo : aucun mail n\'est envoyé';
    if (x.s === 'a_venir') return `✉ Mail prévu le ${dateFr(x.e)}`;
    return x.e >= isoLocal(ajouterJours(new Date(), -30)) ? '✉ Mail en attente d\'envoi (fait chaque matin)' : '✉ Vente trop ancienne pour le mail automatique';
  }

  // ---------- Onglet Leads ----------
  // Bascule Révisions / Réseau en haut de l'onglet (le réseau seulement si le garage y a droit).
  function vueActive() {
    if (!Droits.reseau()) return 'revisions';
    // Par défaut : les nouveaux leads du réseau d'abord, sinon les révisions à proposer.
    return vueLeads || (!Reseau.nouveaux().length && aAppeler().length ? 'revisions' : 'reseau');
  }
  function bascule() {
    if (!Droits.reseau()) return '';
    const n = aAppeler().length;
    return `<div class="segmented lead-bascule">
      <button type="button" data-leads-vue="reseau" class="${vueActive() === 'reseau' ? 'active' : ''}">Réseau</button>
      <button type="button" data-leads-vue="revisions" class="${vueActive() === 'revisions' ? 'active' : ''}">Révisions${n ? ' (' + n + ')' : ''}</button></div>`;
  }
  function rendreOnglet() {
    charger();
    if (vueActive() === 'reseau') Reseau.rendreLeads(); else rendre();
  }

  function carte(x) {
    const { o, c, v } = x;
    const [lib, cls] = STATUTS[x.s];
    const rv = o.revision || {};
    const p = prix(v);
    const montant = rv.prix || p.prix;
    const nom = c ? clientNom(c) : 'Client supprimé';
    const veh = v ? vehiculeNom(v) + (v.immatriculation ? ' · ' + v.immatriculation : '') : 'Véhicule';
    const g = Param.get().garage;
    const wa = c?.telephone ? Papiers.lienWhatsapp(c, `Bonjour ${c.prenom || nom}, ici ${g.nom || 'votre garage'}. Votre ${v ? vehiculeNom(v) : 'véhicule'} a bientôt un an : nous vous proposons sa révision${montant ? ' à ' + euros(montant) : ''}. Quand seriez-vous disponible ?`) : '';
    const ouvert = ['a_appeler', 'a_venir'].includes(x.s);
    return `<div class="card lead" data-revision="${o.id}">
      <div class="top"><span class="title">${esc(nom)}</span><span class="c-badges"><span class="badge b-purple">Révision</span><span class="badge ${cls}">${lib}</span></span></div>
      <div class="sub">🚗 ${esc(veh)} · vendu le ${dateFr(dateVente(o))}${o.numero ? ' (' + esc(o.numero) + ')' : ''}</div>
      ${c ? `<div class="sub">📞 ${esc([c.telephone, c.email].filter(Boolean).join(' · ') || 'pas de coordonnées')}</div>` : ''}
      <div class="sub">🔧 Révision ${x.s === 'a_venir' ? 'à proposer à partir du' : 'due depuis le'} ${dateFr(x.e)}${x.s === 'a_appeler' && x.e < today() ? ` · <b class="neg">${Math.floor((Date.now() - new Date(x.e)) / 864e5)} j</b>` : ''}</div>
      <div class="sub">Prix à proposer : <b>${montant ? euros(montant) : '—'}</b>${!rv.prix && p.prix ? ` <span class="hint">(${esc(p.source)} ${euros(p.cout)} + marge ${euros(p.marge)})</span>` : ''}${!montant ? ' <button type="button" class="lien hint" data-aller="parametres">Régler le coût d\'une révision</button>' : ''}</div>
      ${x.s === 'rdv' ? `<div class="sub ok">📅 RDV le ${dateFr(rv.rdv)}${rv.heure ? ' à ' + esc(rv.heure) : ''}</div>` : ''}
      ${x.s === 'faite' ? `<div class="sub ok">✓ Faite le ${dateFr(rv.faiteLe)} · facturée ${euros(rv.montant) || '—'}${rv.cout ? ' · bénéfice ' + euros(num(rv.montant) - num(rv.cout)) : ''}</div>` : ''}
      ${x.s === 'clos' && rv.motif ? `<div class="sub">Motif : ${esc(rv.motif)}</div>` : ''}
      ${rv.note ? `<div class="sub">« ${esc(rv.note)} »</div>` : ''}
      <div class="sub hint">${etatMail(x)}</div>
      <div class="chips lead-actions">
        ${c?.telephone && ['a_appeler', 'a_venir', 'rdv'].includes(x.s) ? `<a class="chip" href="tel:${esc(c.telephone)}">Appeler</a>` : ''}
        ${wa && ouvert ? `<a class="chip" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        ${ouvert ? `<button type="button" class="chip active" data-rev-rdv="${o.id}">RDV pris</button><button type="button" class="chip" data-rev-clore="${o.id}">Clore</button>` : ''}
        ${x.s === 'rdv' ? `<button type="button" class="chip active" data-rev-faite="${o.id}">Révision faite</button><button type="button" class="chip" data-rev-rdv="${o.id}">Changer le RDV</button>
          <button type="button" class="chip" data-rev-clore="${o.id}">Annuler</button>` : ''}
        ${['faite', 'clos'].includes(x.s) ? `<button type="button" class="chip" data-rev-rouvrir="${o.id}">Rouvrir</button>` : ''}
        ${c ? `<button type="button" class="chip" data-rev-fiche="${o.id}">Fiche client</button>` : ''}
      </div></div>`;
  }

  function rendre() {
    const tous = leads();
    const n = Object.fromEntries(Object.entries(VUES).map(([k, s]) => [k, tous.filter(x => x.s === s).length]));
    const lot = tous.filter(x => x.s === VUES[vue]);
    const faites = tous.filter(x => x.s === 'faite' && (x.o.revision.faiteLe || '') >= isoLocal(ajouterJours(new Date(), -365)));
    const ca = faites.reduce((s, x) => s + num(x.o.revision.montant), 0);
    const benef = faites.reduce((s, x) => s + num(x.o.revision.montant) - num(x.o.revision.cout), 0);
    $('#count').textContent = '';
    $('#list').innerHTML = `<div class="leads-page">
      ${bascule()}
      ${actif() ? '' : `<div class="panneau lead-info"><strong>Rappels de révision désactivés</strong><p class="hint">Réactive-les dans Paramètres &gt; Révisions pour rappeler tes clients 11 mois après leur achat.</p>
        <button type="button" class="chip active" data-aller="parametres">Paramètres</button></div>`}
      <p class="hint">${esc(reglages().delaiMois)} mois après chaque vente livrée, le client reçoit un mail de rappel et tu le rappelles pour lui proposer sa révision : ça rapporte et ça le fidélise.</p>
      <div class="chips lead-vues">${Object.keys(VUES).map(k => `<button type="button" class="chip${k === vue ? ' active' : ''}" data-rev-vue="${k}">${k}${n[k] ? ' · ' + n[k] : ''}</button>`).join('')}</div>
      ${faites.length ? `<p class="hint">12 derniers mois : ${faites.length} révision(s) faite(s) · <b>${euros(ca)}</b> facturé(s)${benef ? ' · bénéfice ' + euros(benef) : ''}</p>` : ''}
      ${lot.length ? `<div class="list">${lot.map(carte).join('')}</div>` : `<div class="empty">${ILLUS.clients}<strong>${vue === 'À appeler' ? 'Aucune révision à proposer' : 'Rien ici'}</strong>
        <span>${vue === 'À appeler' ? `Les clients apparaissent ici ${esc(reglages().delaiMois)} mois après la livraison de leur véhicule.` : 'Les leads changent de liste quand tu les fais avancer.'}</span></div>`}
    </div>`;
  }

  // ---------- Fenêtre RDV / Faite / Clore ----------
  function ouvrirDialogue(id, mode) {
    const o = db.get('commandes', id);
    if (!o) return;
    enCours = { id, mode };
    const rv = o.revision || {};
    const v = db.get('vehicules', o.vehiculeId);
    const p = prix(v);
    const c = db.get('clients', o.clientId);
    $('#rev-titre').textContent = { rdv: 'Rendez-vous de révision', faite: 'Révision faite', clos: 'Clore le lead révision' }[mode];
    const tete = `<p class="hint">${esc(c ? clientNom(c) : '')} · ${esc(v ? vehiculeNom(v) : '')}</p>`;
    $('#rev-body').innerHTML = tete + (mode === 'rdv'
      ? `<div class="grid"><div class="field"><label for="rev-date">Date</label><input id="rev-date" type="date" value="${esc(rv.rdv || today())}"></div>
        <div class="field"><label for="rev-heure">Heure</label><input id="rev-heure" type="time" value="${esc(rv.heure || '')}"></div>
        <div class="field full"><label for="rev-prix">Prix proposé (€ TTC)</label><input id="rev-prix" type="number" inputmode="decimal" value="${esc(rv.prix || p.prix || '')}"></div>
        <div class="field full"><label for="rev-note">Note</label><input id="rev-note" value="${esc(rv.note || '')}" placeholder="ex. changer aussi les plaquettes"></div></div>
        ${p.prix ? `<p class="hint">Calcul : ${esc(p.source)} ${euros(p.cout)} + marge ${euros(p.marge)}, arrondi.</p>` : ''}`
      : mode === 'faite'
      ? `<div class="grid"><div class="field"><label for="rev-montant">Montant facturé (€ TTC)</label><input id="rev-montant" type="number" inputmode="decimal" value="${esc(rv.montant || rv.prix || p.prix || '')}"></div>
        <div class="field"><label for="rev-cout">Coût pour le garage (€)</label><input id="rev-cout" type="number" inputmode="decimal" value="${esc(rv.cout || p.cout || '')}"></div></div>`
      : `<div class="field"><label for="rev-motif">Pourquoi ?</label><select id="rev-motif">${MOTIFS.map(m => `<option${m === rv.motif ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select></div>`);
    $('#rev-ok').textContent = { rdv: 'Enregistrer le RDV', faite: 'Marquer faite', clos: 'Clore' }[mode];
    $('#dlg-revision').showModal();
  }
  function valider() {
    const { id, mode } = enCours;
    const o = db.get('commandes', id);
    const rv = { ...(o.revision || {}) };
    if (mode === 'rdv') {
      if (!$('#rev-date').value) { toast('Choisis la date du RDV.'); return; }
      Object.assign(rv, { statut: 'rdv', rdv: $('#rev-date').value, heure: $('#rev-heure').value, prix: num($('#rev-prix').value) || '', note: $('#rev-note').value.trim() });
    } else if (mode === 'faite') {
      Object.assign(rv, { statut: 'faite', faiteLe: today(), montant: num($('#rev-montant').value) || '', cout: num($('#rev-cout').value) || '' });
    } else Object.assign(rv, { statut: 'clos', motif: $('#rev-motif').value, closLe: today() });
    db.upsert('commandes', { id, revision: rv });
    $('#dlg-revision').close();
    vue = { rdv: 'RDV', faite: 'Faites', clos: 'Closes' }[mode];
    toast({ rdv: 'RDV de révision enregistré', faite: 'Révision faite : bien joué', clos: 'Lead révision clos' }[mode]);
    render();
  }

  function clic(e) {
    const b = e.target.closest('[data-leads-vue],[data-rev-vue],[data-rev-rdv],[data-rev-faite],[data-rev-clore],[data-rev-rouvrir],[data-rev-fiche]');
    if (!b) return false;
    const d = b.dataset;
    if (d.leadsVue) { vueLeads = d.leadsVue; render(); return true; }
    if (d.revVue) { vue = d.revVue; render(); return true; }
    if (d.revRdv) ouvrirDialogue(d.revRdv, 'rdv');
    else if (d.revFaite) ouvrirDialogue(d.revFaite, 'faite');
    else if (d.revClore) ouvrirDialogue(d.revClore, 'clos');
    else if (d.revRouvrir) {
      const o = db.get('commandes', d.revRouvrir);
      const rv = o.revision || {};
      db.upsert('commandes', { id: o.id, revision: rv.rdv && rv.statut === 'faite' ? { ...rv, statut: 'rdv' } : { ...rv, statut: '' } });
      vue = rv.rdv && rv.statut === 'faite' ? 'RDV' : 'À appeler';
      render();
    } else if (d.revFiche) { switchTab('clients'); openForm(db.get('commandes', d.revFiche).clientId); }
    return true;
  }

  // Panneau de l'accueil (onglet Données).
  function panneau() {
    if (!actif()) return '';
    charger();
    const tous = leads();
    const a = tous.filter(x => x.s === 'a_appeler');
    const rdv = tous.filter(x => x.s === 'rdv');
    if (!a.length && !rdv.length && !tous.some(x => x.s === 'a_venir')) return '';
    return `<section class="panneau demandes">
      <div class="p-tete"><h3>Révisions à proposer <span class="compte">${a.length}</span></h3><button type="button" class="lien hint" data-rev-aller>Voir les révisions →</button></div>
      ${a.length ? a.slice(0, 4).map(x => `<div class="demande"><div><strong>${esc(x.c ? clientNom(x.c) : '')}</strong> <span class="hint">due le ${dateFr(x.e)}</span>
        <span class="sub">🔧 ${esc(x.v ? vehiculeNom(x.v) : '')}${prix(x.v).prix ? ' · ' + euros(prix(x.v).prix) : ''}</span></div>
        <div class="chips">${x.c?.telephone ? `<a class="chip" href="tel:${esc(x.c.telephone)}">Appeler</a>` : ''}<button type="button" class="chip active" data-rev-aller>Traiter</button></div></div>`).join('')
        : '<p class="ok-vide">✓ Aucune révision à proposer aujourd\'hui.</p>'}
      <p class="hint">${rdv.length} RDV de révision prévu(s) · ${tous.filter(x => x.s === 'a_venir').length} à venir dans le mois</p>
    </section>`;
  }

  // ---------- Paramètres > Révisions ----------
  function rendreParam() {
    const r = reglages();
    const ex = prix(null);
    $('#p-revision').innerHTML = `
      <label class="check"><input type="checkbox" data-rev-param="actif"${r.actif ? ' checked' : ''}><span>Créer un lead « Révision » après chaque vente</span></label>
      <label class="check"><input type="checkbox" data-rev-param="mail"${r.mail ? ' checked' : ''}><span>Envoyer aussi un mail de rappel automatique au client</span></label>
      <label class="check"><input type="checkbox" data-rev-param="prixDansMail"${r.prixDansMail ? ' checked' : ''}><span>Indiquer le prix dans le mail</span></label>
      <div class="grid">
        <div class="field"><label for="rev-p-delai">Délai après la vente (mois)</label><input id="rev-p-delai" data-rev-param="delaiMois" type="number" inputmode="numeric" min="1" max="36" value="${esc(r.delaiMois)}"></div>
        <div class="field"><label for="rev-p-cout">Coût d'une révision pour toi (€)</label><input id="rev-p-cout" data-rev-param="cout" type="number" inputmode="decimal" value="${esc(r.cout)}" placeholder="ex. 120"></div>
        <div class="field"><label for="rev-p-type">Marge</label><select id="rev-p-type" data-rev-param="margeType">
          <option value="pourcentage"${r.margeType !== 'fixe' ? ' selected' : ''}>En %</option><option value="fixe"${r.margeType === 'fixe' ? ' selected' : ''}>En € fixe</option></select></div>
        <div class="field"><label for="rev-p-marge">Marge (${r.margeType === 'fixe' ? '€' : '%'})</label><input id="rev-p-marge" data-rev-param="margeValeur" type="number" inputmode="decimal" value="${esc(r.margeValeur)}"></div>
      </div>
      <p class="hint">Le coût pris en compte est celui de la ligne « Vidange et filtres » de la préparation du véhicule vendu (ton tarif prépa) ; sinon, le coût ci-dessus.
        ${ex.prix ? `Exemple : ${euros(ex.cout)} + marge ${euros(ex.marge)} = <b>${euros(ex.prix)}</b> proposé au client.` : ''}</p>
      <p class="hint">Le mail part le matin, au nom du garage ; la réponse du client arrive sur l'email du garage. Il contient un lien pour ne plus recevoir de rappel.
        Pour un client qui n'en veut pas, coche « Pas de rappel d'entretien par mail » sur sa fiche.</p>`;
  }
  function majParam(e) {
    const k = e.target.dataset.revParam;
    if (!k) return;
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.tagName === 'SELECT' ? e.target.value : (e.target.value === '' ? '' : num(e.target.value));
    Param.save({ revision: { ...reglages(), [k]: val } });
    if (e.target.type !== 'number' || e.type === 'change') rendreParam();
  }

  function init() {
    $('#rev-ok').addEventListener('click', valider);
    $('#rev-annuler').addEventListener('click', () => $('#dlg-revision').close());
    $('#p-revision').addEventListener('change', majParam);
    document.addEventListener('click', e => {
      if (!e.target.closest('[data-rev-aller]')) return;
      vueLeads = 'revisions';
      vue = 'À appeler';
      switchTab('leads');
    });
  }

  return { init, rendre, rendreOnglet, bascule, clic, panneau, rendreParam, aAppeler, prix, charger };
})();
