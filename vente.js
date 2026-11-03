// Déclarer une vente sans l'option Commandes (offre de base) : depuis la fiche du véhicule, le garage note l'acheteur
// et le prix. On enregistre une vente livrée (comme une commande livrée) : le véhicule passe en « Vendu »
// et le lead révision apparaîtra dans l'onglet Leads au bout du délai réglé (11 mois par défaut).
// Un lead du réseau marqué vendu crée aussi cette vente (reseau.js), pour la même raison.
const Vente = (() => {
  let vehiculeId = null;

  const declarable = v => !!v && !Droits.module('commandes') && ['En préparation', 'En stock', 'Réservé'].includes(v.statut);

  // Enregistre la vente livrée et met le véhicule en « Vendu ». client : id d'une fiche existante, ou { prenom, nom, telephone, email }.
  function enregistrer({ vehiculeId: vid, client, prix, date }) {
    const v = db.get('vehicules', vid);
    if (!v) return null;
    const jour = date || today();
    const c = typeof client === 'string' ? db.get('clients', client) : db.upsert('clients', { ...client, source: client.source || 'Vente au garage' });
    const o = db.upsert('commandes', { clientId: c?.id || '', vehiculeId: v.id, statut: 'Livrée', prix: prix === '' || prix == null ? (v.prixVente || '') : prix,
      date: jour, dateLivraison: jour, dateLivree: jour, notes: 'Vente déclarée depuis la fiche du véhicule.' });
    TABS.commandes.afterSave(o, null);
    db.upsert('vehicules', { id: v.id, dateVente: jour });
    return o;
  }

  function ouvrir(id) {
    const v = db.get('vehicules', id);
    if (!v) return;
    vehiculeId = id;
    const clients = db.all('clients').sort((a, b) => clientNom(a).localeCompare(clientNom(b)));
    const delai = num(Param.get().revision?.delaiMois) || 11;
    $('#vente-sous').textContent = [vehiculeNom(v), v.immatriculation].filter(Boolean).join(' · ');
    $('#vente-body').innerHTML = `
      ${clients.length ? `<div class="field"><label for="vente-client">Acheteur</label><select id="vente-client">
        <option value="">Nouveau client</option>${clients.map(c => `<option value="${esc(c.id)}">${esc(clientNom(c))}${c.telephone ? ' · ' + esc(c.telephone) : ''}</option>`).join('')}</select></div>` : ''}
      <div class="grid" id="vente-nouveau">
        <div class="field"><label for="vente-prenom">Prénom</label><input id="vente-prenom" autocomplete="off"></div>
        <div class="field"><label for="vente-nom">Nom *</label><input id="vente-nom" autocomplete="off"></div>
        <div class="field"><label for="vente-tel">Téléphone *</label><input id="vente-tel" type="tel" inputmode="tel" autocomplete="off"></div>
        <div class="field"><label for="vente-email">Email</label><input id="vente-email" type="email" autocomplete="off"></div></div>
      <div class="grid">
        <div class="field"><label for="vente-prix">Prix de vente (€)</label><input id="vente-prix" type="number" inputmode="decimal" value="${esc(v.prixVente || '')}"></div>
        <div class="field"><label for="vente-date">Date de la vente</label><input id="vente-date" type="date" value="${today()}"></div></div>
      <p class="hint">Le téléphone sert au lead révision : dans ${delai} mois, Ocaz te rappelle d'appeler ce client pour lui proposer sa révision.</p>`;
    $('#vente-client')?.addEventListener('change', e => { $('#vente-nouveau').hidden = !!e.target.value; });
    $('#dlg-vente').showModal();
  }

  function valider() {
    const existant = $('#vente-client')?.value || '';
    let client = existant;
    if (!existant) {
      client = { prenom: $('#vente-prenom').value.trim(), nom: $('#vente-nom').value.trim(), telephone: $('#vente-tel').value.trim(), email: $('#vente-email').value.trim() };
      if (!client.nom) { toast("Le nom de l'acheteur est obligatoire."); $('#vente-nom').focus(); return; }
      if (!client.telephone) { toast('Le téléphone sert au lead révision : saisis-le.'); $('#vente-tel').focus(); return; }
    }
    const prix = $('#vente-prix').value === '' ? '' : num($('#vente-prix').value);
    const o = enregistrer({ vehiculeId, client, prix, date: $('#vente-date').value || today() });
    $('#dlg-vente').close();
    if (!o) return;
    toast('Vente enregistrée : le véhicule passe en « Vendu », le lead révision est programmé');
    render();
  }

  function init() {
    $('#vente-ok').addEventListener('click', valider);
    $('#vente-annuler').addEventListener('click', () => $('#dlg-vente').close());
  }

  return { init, ouvrir, enregistrer, declarable };
})();
