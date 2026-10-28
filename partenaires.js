// Stock > « Partenaires » : les véhicules que les autres garages du réseau Ocaz partagent (lecture seule).
// Un client cherche un modèle qu'on n'a pas ? On appelle le garage qui l'a.
const Partenaires = (() => {
  let garages = null, charge = 0, enCours = null;
  const urls = new Map();

  const vehicules = () => (garages || []).flatMap(g => (g.vehicules || []).map(v => ({ g, v })));
  const nombre = () => (garages ? vehicules().length : '…');

  async function charger(forcer) {
    if (!Sync.role || !Sync.client) return;
    if (!forcer && garages && Date.now() - charge < 120000) return;
    if (enCours) return enCours;
    enCours = (async () => {
      const { data, error } = await Sync.client.rpc('crm_reseau_partenaires');
      garages = error ? [] : data || [];
      charge = Date.now();
      if (error) console.error(error);
      await signer(vehicules().map(x => (x.v.photos || [])[0]).filter(Boolean));
      if (onglet === 'stock') { $('#filters').dataset.vue = ''; render(); }
    })().finally(() => { enCours = null; });
    return enCours;
  }
  // Photos privées des véhicules partagés : adresses temporaires.
  async function signer(chemins) {
    const manquants = chemins.filter(p => !urls.has(p));
    if (!manquants.length) return;
    try {
      const { data } = await Sync.client.storage.from('photos').createSignedUrls(manquants, 3600);
      (data || []).forEach(x => { if (x.signedUrl) urls.set(x.path, x.signedUrl); });
    } catch (e) { /* photos indisponibles */ }
  }

  function filtresHtml() { return ''; }

  function rendre() {
    if (!garages) charger();
    const q = norm($('#search').value.trim());
    const liste = vehicules().filter(({ g, v }) => !q || norm([v.marque, v.modele, v.finition, v.annee, v.couleur, v.carburant, g.garage?.nom, g.garage?.ville].join(' ')).includes(q));
    $('#count').textContent = garages ? `${liste.length} véhicule${liste.length > 1 ? 's' : ''} chez les garages partenaires` : 'Chargement des véhicules partenaires…';
    if (!garages) { $('#list').innerHTML = ''; return; }
    $('#list').innerHTML = liste.length ? liste.map(({ g, v }) => {
      const u = urls.get((v.photos || [])[0]);
      return `<div class="card partenaire" data-partenaire="${esc(g.entreprise_id)}" data-pv="${esc(v.id)}">
        ${u ? `<div class="thumb"><img src="${esc(u)}" alt="" loading="lazy"></div>` : ''}
        <div class="top"><span class="title">${esc([v.marque, v.modele, v.finition].filter(Boolean).join(' '))}</span>
          <span class="c-badges">${v.reserve ? '<span class="badge b-orange">Réservé</span>' : ''}<span class="badge b-grey">${esc(g.garage?.nom || 'Garage')}</span></span></div>
        <div class="sub">${esc([v.annee, km(v.kilometrage), v.carburant, v.boite, v.type, v.couleur].filter(Boolean).join(' · '))}</div>
        <div class="top"><span class="sub">${esc(g.garage?.ville || '')}</span><span class="price">${euros(v.prix) || 'Prix sur demande'}</span></div></div>`;
    }).join('') : `<div class="empty">${ILLUS.stock}<strong>${vehicules().length ? 'Aucun résultat' : 'Aucun véhicule partenaire pour le moment'}</strong>
      <span>${vehicules().length ? 'Essaie une autre recherche.' : 'Les garages du réseau Ocaz qui partagent leurs véhicules apparaissent ici.'}</span></div>`;
  }

  // Fiche d'un véhicule partenaire : appeler ou écrire au garage.
  function clic(e) {
    const c = e.target.closest('[data-partenaire]');
    if (!c) return false;
    const g = (garages || []).find(x => x.entreprise_id === c.dataset.partenaire);
    const v = g?.vehicules.find(x => x.id === c.dataset.pv);
    if (!v) return true;
    const gg = g.garage || {};
    const nom = [v.marque, v.modele, v.finition].filter(Boolean).join(' ');
    const msg = `Bonjour, ici ${Param.get().garage.nom || 'un garage du réseau Ocaz'}. Votre ${nom}${v.annee ? ' de ' + v.annee : ''} est-il toujours disponible ?`;
    const sujet = [nom, v.annee, euros(v.prix)].filter(Boolean).join(' · ');
    const actions = [
      Messagerie.actif && Messagerie.moi !== 'g:' + g.entreprise_id && [`💬 Message à ${gg.nom || 'ce garage'} dans Ocaz`, () => Messagerie.contacter('g:' + g.entreprise_id, gg.nom, sujet)],
      gg.telephone && [`📞 Appeler ${gg.nom || 'le garage'} (${gg.telephone})`, () => { location.href = 'tel:' + gg.telephone.replace(/\s/g, ''); }],
      gg.telephone && ['💬 WhatsApp', () => window.open(Papiers.lienWhatsapp({ telephone: gg.telephone }, msg), '_blank', 'noopener')],
      gg.email && ['✉ Email', () => { location.href = `mailto:${gg.email}?subject=${encodeURIComponent(nom)}&body=${encodeURIComponent(msg)}`; }],
    ].filter(Boolean);
    $('#actions-titre').textContent = nom;
    $('#actions-sous').textContent = [v.annee, km(v.kilometrage), v.carburant, v.boite, euros(v.prix), gg.nom, gg.ville].filter(Boolean).join(' · ');
    $('#actions-liste').innerHTML = (v.texte ? `<p class="hint" style="white-space:pre-line">${esc(v.texte)}</p>` : '')
      + (actions.length ? actions.map(([l], i) => `<button type="button" data-action="${i}">${esc(l)}</button>`).join('') : '<p class="hint">Ce garage n\'a pas laissé de coordonnées.</p>');
    $('#actions-liste').onclick = ev => {
      const b = ev.target.closest('[data-action]');
      if (!b) return;
      $('#dlg-actions').close();
      actions[b.dataset.action][1]();
    };
    $('#dlg-actions').showModal();
    return true;
  }

  function init() { /* chargement à la première ouverture du sous-onglet */ }

  return { init, rendre, clic, nombre, filtresHtml, charger };
})();
