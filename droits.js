// Ce que l'administrateur (admin.html) a ouvert pour ce garage. Réglage enregistré dans crm_entreprises.config :
// le revendeur le lit mais ne peut pas le modifier (seul l'admin écrit la config, côté Supabase).
//
// Offre de base (19,99 €/mois) : le réseau Ocaz et les leads.
//   - Stock : ses véhicules, à partager avec les autres garages et les apporteurs d'affaires, et les véhicules partenaires.
//   - Leads : les leads du réseau (apporteurs, site) et les leads révision (11 mois après une vente).
// Options, masquées d'origine et cochées par l'admin au cas par cas (config.modules) :
//   Tableau de bord, Commandes (offres, bons de commande, factures), Reprise, Dépôt vente, Administratif.
// Sans l'option Commandes, la vente se déclare depuis la fiche du véhicule (vente.js) : c'est elle qui crée le lead révision.
const Droits = (() => {
  const MODULES = ['donnees', 'commandes', 'reprises', 'depot', 'administratif'];

  const config = () => Sync.config || {};
  // Options cochées par l'admin. Garage pas encore réglé : l'offre de base seule.
  const modules = () => config().modules || {};
  const module = nom => !!modules()[nom];

  // Réseau Ocaz : inclus dans l'offre de base. L'admin peut le couper (droits.reseau = false), par ex. avant le lancement.
  const reseau = () => config().droits?.reseau !== false;
  // Ses propres véhicules : toujours (ils sont la base du stock partagé).
  const achat = () => true;
  const depot = () => module('depot');

  // Onglets visibles du garage.
  function onglets() {
    return {
      donnees: module('donnees'),
      commandes: module('commandes'),
      reprises: module('reprises'),
      depot: module('depot'),
      administratif: module('administratif'),
      stock: true,
      leads: true,
    };
  }
  const visible = nom => onglets()[nom] !== false;

  // Masque les boutons d'onglets non ouverts ; renvoie vers le premier onglet visible si l'onglet ouvert disparaît.
  function appliquer() {
    document.querySelectorAll('[data-tab]').forEach(b => { b.hidden = !visible(b.dataset.tab); });
    if (typeof onglet !== 'undefined' && !visible(onglet)) switchTab(typeof ongletAccueil === 'function' ? ongletAccueil() : 'stock');
  }

  return { MODULES, module, reseau, achat, depot, visible, appliquer };
})();
