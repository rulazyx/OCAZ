// Droits du revendeur, posés par l'administrateur (admin.html) : réseau Ocaz, dépôt-vente, achat-revente.
// Achat-revente seul : pas d'onglet Dépôt vente. Dépôt-vente seul : pas d'onglet Reprise, et le Stock ne montre
// que les véhicules partenaires. Les deux : tout est affiché. Le Stock a toujours un sous-onglet « Partenaires ».
const Droits = (() => {
  // Garage créé avant les droits (pas encore réglé par l'admin) : tout est ouvert, le réseau suit son réglage.
  function get() {
    const d = Sync.config?.droits;
    if (!d) return { achat: true, depot: true, reseau: null };
    return { achat: !!d.achat, depot: !!d.depot, reseau: !!d.reseau };
  }
  // Ni l'un ni l'autre coché : on garde l'achat-revente, pour ne pas laisser un garage sans rien.
  const achat = () => get().achat || !get().depot;
  const depot = () => get().depot;
  const reseau = () => (get().reseau === null ? !!Param.get().reseau.actif : get().reseau);

  // Onglets visibles du garage.
  function onglets() {
    return {
      reprises: achat(),
      depot: depot(),
      leads: reseau(),
    };
  }
  const visible = nom => onglets()[nom] !== false;

  // Masque les boutons d'onglets interdits ; renvoie vers Données si l'onglet ouvert disparaît.
  function appliquer() {
    document.querySelectorAll('[data-tab]').forEach(b => { b.hidden = !visible(b.dataset.tab); });
    if (typeof onglet !== 'undefined' && !visible(onglet)) switchTab('donnees');
  }

  return { get, achat, depot, reseau, visible, appliquer };
})();
