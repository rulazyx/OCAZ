// Vitrine en ligne (côté garage) : l'appli publie une copie des véhicules disponibles, sans prix d'achat ni
// données clients, sur une page publique (reseau.ocaz.re/vitrine?g=adresse). Les demandes des visiteurs arrivent ici en direct.
const EnLigne = (() => {
  const VISIBLES = ['En stock', 'Réservé'];
  let timer = null;
  let demandes = [];
  let canal = null;
  let derniere = '';

  const reglages = () => Param.get().vitrine;
  const slugDe = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  // Les vitrines sont publiques sur le site reseau.ocaz.re ; l'appli pro est sur ocaz.re.
  const dossier = () => 'https://reseau.ocaz.re/';
  const lien = slug => dossier() + 'vitrine?g=' + encodeURIComponent(slug);
  const codeIntegre = slug => `<script src="${dossier()}integrer.js" data-garage="${slug}" async></script>`;

  // Copie publique : seulement ce qu'un acheteur doit voir.
  function copie() {
    const g = Param.get().garage;
    const vs = db.all('vehicules').filter(v => VISIBLES.includes(v.statut)).sort((a, b) => (b.dateEntree || '').localeCompare(a.dateEntree || ''));
    return {
      garage: { nom: g.nom, adresse: g.adresse, codePostal: g.codePostal, ville: g.ville, telephone: g.telephone, email: g.email, site: g.site, logo: g.logo },
      vehicules: vs.map(v => ({
        id: v.id, marque: v.marque || '', modele: v.modele || '', finition: v.finition || '', annee: v.annee || '', kilometrage: v.kilometrage || '',
        carburant: v.carburant || '', boite: v.boite || '', couleur: v.couleur || '', type: v.type || '', portes: v.portes || '', places: v.places || '',
        puissanceCh: v.puissanceCh || '', puissanceFiscale: v.puissanceFiscale || '', miseEnCirculation: v.miseEnCirculation || '',
        prix: num(v.prixVente) || '', reserve: v.statut === 'Réservé', photos: (v.photos || []).slice(0, 10), texte: v.annonce?.texte || '',
      })),
    };
  }

  // Publication après chaque changement (groupée), seulement si la copie a changé.
  function planifier() {
    clearTimeout(timer);
    timer = setTimeout(() => publier().catch(err => console.error(err)), 2500);
  }
  async function publier(forcer) {
    const r = reglages();
    if (!Sync.role || !Sync.client || !r.slug) return;
    const data = copie();
    const photos = data.vehicules.flatMap(v => v.photos);
    const sig = JSON.stringify([r.slug, r.actif, data]);
    if (!forcer && sig === derniere) return;
    const { error } = await Sync.client.rpc('crm_vitrine_publier', { p_slug: r.slug, p_actif: !!r.actif, p_data: data, p_photos: photos });
    if (error) throw new Error(/function|schema cache/i.test(error.message) ? "La vitrine n'est pas encore installée dans la base : relance le script supabase.sql." : error.message);
    derniere = sig;
    if (!Param.get().vitrine.publieLe || forcer) Param.save({ vitrine: { ...Param.get().vitrine, publieLe: new Date().toISOString() } });
  }

  // ---------- Demandes des visiteurs ----------
  async function chargerDemandes() {
    if (!Sync.role || !Sync.client) return;
    const { data, error } = await Sync.client.from('crm_demandes').select('*').eq('traite', false).order('cree_le', { ascending: false }).limit(50);
    if (error) return;
    demandes = data || [];
    if (onglet === 'donnees') render();
  }
  function ecouter() {
    if (canal || !Sync.client || !Sync.entreprise) return;
    canal = Sync.client.channel('demandes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crm_demandes', filter: 'entreprise_id=eq.' + Sync.entreprise.id }, p => {
        const d = p.new;
        toast(`📩 Nouvelle demande${d.origine === 'reseau' ? ' (site du réseau)' : ''} de ${d.nom}${d.vehicule ? ' pour ' + d.vehicule : ''}`);
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Nouvelle demande · Ocaz', { body: `${d.nom}${d.vehicule ? ' · ' + d.vehicule : ''}\n${d.message || d.telephone || ''}`, icon: 'icon-512.png', tag: d.id });
          }
        } catch (e) { /* notifications indisponibles */ }
        chargerDemandes();
      })
      .subscribe();
  }
  function demarrer() { ecouter(); chargerDemandes(); planifier(); }
  function arreter() { if (canal) { Sync.client?.removeChannel(canal); canal = null; } demandes = []; derniere = ''; }

  async function traiter(id, patch = {}) {
    const { error } = await Sync.client.from('crm_demandes').update({ traite: true, ...patch }).eq('id', id);
    if (error) { toast(error.message); return; }
    demandes = demandes.filter(d => d.id !== id);
    render();
  }
  function versClient(d) {
    const [prenom, ...reste] = d.nom.trim().split(/\s+/);
    const existant = db.all('clients').find(c => (d.telephone && norm(c.telephone).replace(/\D/g, '') === d.telephone.replace(/\D/g, '')) || (d.email && norm(c.email) === norm(d.email)));
    const v = d.vehicule_id ? db.get('vehicules', d.vehicule_id) : null;
    const note = `Demande ${d.origine === 'reseau' ? 'du site du réseau' : 'vitrine'} du ${dateFr(d.cree_le)}${d.vehicule ? ' (' + d.vehicule + ')' : ''} : ${d.message || '—'}`;
    const c = existant
      ? db.upsert('clients', { id: existant.id, interets: [...new Set([...(existant.interets || []), ...(v ? [v.id] : [])])], notes: [existant.notes, note].filter(Boolean).join('\n') })
      : db.upsert('clients', { prenom: reste.length ? prenom : '', nom: reste.length ? reste.join(' ') : prenom, telephone: d.telephone, email: d.email,
        source: 'Site / vitrine', interets: v ? [v.id] : [], notes: note });
    traiter(d.id);
    toast(existant ? 'Demande ajoutée à la fiche du client existant' : 'Client créé depuis la demande');
    return c;
  }

  // Panneau de l'accueil.
  function panneau() {
    const r = reglages();
    if (!r.slug && !demandes.length) return '';
    return `<section class="panneau demandes">
      <div class="p-tete"><h3>Demandes en ligne <span class="compte">${demandes.length}</span></h3>
        ${r.slug ? `<a class="hint" href="${esc(lien(r.slug))}" target="_blank" rel="noopener">Voir ma vitrine ↗</a>` : ''}</div>
      ${demandes.length ? demandes.map(d => `<div class="demande">
        <div><strong>${esc(d.nom)}</strong> ${d.origine === 'reseau' ? '<span class="badge b-blue">Site du réseau</span> ' : ''}<span class="hint">${new Date(d.cree_le).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          ${d.vehicule ? `<span class="sub">🚗 ${esc(d.vehicule)}</span>` : ''}
          ${d.message ? `<span class="sub">« ${esc(d.message)} »</span>` : ''}
          <span class="sub">${esc([d.telephone, d.email].filter(Boolean).join(' · '))}</span></div>
        <div class="chips">${d.telephone ? `<a class="chip" href="tel:${esc(d.telephone)}">Appeler</a>
          <a class="chip" href="https://wa.me/${Papiers.telIntl(d.telephone)}?text=${encodeURIComponent(`Bonjour ${d.nom.split(' ')[0]}, merci pour votre demande${d.vehicule ? ' concernant le véhicule ' + d.vehicule : ''}. `)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          <button type="button" class="chip active" data-demande-client="${d.id}">Ajouter aux clients</button>
          <button type="button" class="chip" data-demande-ignorer="${d.id}">Ignorer</button></div></div>`).join('')
        : '<p class="ok-vide">✓ Aucune demande en attente.</p>'}
    </section>`;
  }

  // ---------- Paramètres ----------
  // Réglages de la vitrine : retirés des Paramètres du revendeur (2026-10-27), gardés si la page les affiche.
  function rendreParametres() {
    if (!$('#vit-slug')) return;
    const r = reglages();
    const slug = r.slug || slugDe(Param.get().garage.nom || Sync.entreprise?.nom || '');
    $('#vit-actif').checked = !!r.actif;
    $('#vit-slug').value = slug;
    const url = lien(slug);
    $('#vit-lien').innerHTML = r.slug ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>` : '<span class="hint">Choisis l\'adresse puis active la vitrine.</span>';
    $('#vit-etat').textContent = r.slug ? `${r.actif ? 'En ligne' : 'Désactivée'} · ${db.all('vehicules').filter(v => VISIBLES.includes(v.statut)).length} véhicule(s) affiché(s). Elle se met à jour toute seule.` : '';
    $('#vit-qr').innerHTML = '';
    if (r.slug && r.actif) {
      const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
      $('#vit-qr').innerHTML = qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
    }
    $('#vit-notif').hidden = !('Notification' in window) || Notification.permission === 'granted';
    $('#vit-integrer').hidden = !(r.slug && r.actif);
    $('#vit-code').value = r.slug ? codeIntegre(r.slug) : '';
    $('#vit-lien-integre').value = r.slug ? lien(r.slug) + '&integre=1' : '';
  }

  function init() {
    if ($('#btn-vit-save')) initParametres();
    $('#list').addEventListener('click', e => {
      const c = e.target.dataset.demandeClient, i = e.target.dataset.demandeIgnorer;
      if (c) { const d = demandes.find(x => x.id === c); if (d) { const cl = versClient(d); switchTab('clients'); openForm(cl.id); } }
      if (i && confirm('Ignorer cette demande ?')) traiter(i);
    });
  }
  function initParametres() {
    $('#btn-vit-save').addEventListener('click', async () => {
      const slug = slugDe($('#vit-slug').value);
      if (slug.length < 3) { toast("L'adresse doit faire au moins 3 caractères."); return; }
      if (!Sync.role) { toast('Connecte-toi pour publier la vitrine.'); return; }
      const avant = reglages();
      Param.save({ vitrine: { ...avant, slug, actif: $('#vit-actif').checked } });
      try { await publier(true); toast($('#vit-actif').checked ? 'Vitrine en ligne' : 'Vitrine désactivée'); }
      catch (err) { Param.save({ vitrine: avant }); toast(err.message); }
      rendreParametres();
    });
    $('#btn-vit-copier').addEventListener('click', async () => {
      const r = reglages();
      if (!r.slug) return;
      try { await navigator.clipboard.writeText(lien(r.slug)); toast('Lien copié : mets-le sur ta page Facebook, tes annonces, ta carte de visite…'); }
      catch (e) { prompt('Copie ce lien :', lien(r.slug)); }
    });
    const copier = async (texte, ok) => {
      try { await navigator.clipboard.writeText(texte); toast(ok); } catch (e) { prompt('Copie ce texte :', texte); }
    };
    $('#btn-vit-code').addEventListener('click', () => copier($('#vit-code').value, 'Code copié : colle-le dans une page de ton site'));
    $('#btn-vit-lien-integre').addEventListener('click', () => copier($('#vit-lien-integre').value, 'Lien copié'));
    $('#vit-notif').addEventListener('click', async () => {
      const p = await Notification.requestPermission();
      toast(p === 'granted' ? 'Alertes activées sur cet appareil' : 'Alertes refusées par le navigateur');
      rendreParametres();
    });
  }

  return { init, planifier, publier, demarrer, arreter, panneau, rendreParametres, lien, get demandes() { return demandes; } };
})();
