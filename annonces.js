// Annonces de l'administrateur d'Ocaz : bandeau en haut de l'appli des revendeurs et des apporteurs.
// Chaque annonce fermée ne revient plus sur cet appareil.
const Annonces = (() => {
  const CLE = 'ocaz-annonces-vues';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const vues = () => { try { return JSON.parse(localStorage.getItem(CLE)) || []; } catch (e) { return []; } };
  function fermer(id) {
    try { localStorage.setItem(CLE, JSON.stringify([...vues(), id].slice(-100))); } catch (e) { /* rien */ }
    document.querySelector(`.annonce[data-id="${id}"]`)?.remove();
  }
  async function afficher(client) {
    if (!client) return;
    let liste = [];
    try { const { data, error } = await client.rpc('crm_annonces_lire'); if (error) return; liste = data || []; } catch (e) { return; }
    const deja = vues();
    liste = liste.filter(a => !deja.includes(a.id));
    let zone = document.getElementById('annonces');
    if (!zone) { zone = document.createElement('div'); zone.id = 'annonces'; document.querySelector('main')?.prepend(zone); }
    zone.innerHTML = liste.map(a => `<div class="annonce" data-id="${esc(a.id)}" role="status">
      <div><b>${esc(a.titre)}</b>${a.texte ? `<p>${esc(a.texte).replace(/\n/g, '<br>')}</p>` : ''}</div>
      <button type="button" class="annonce-x" aria-label="Fermer l'annonce">✕</button></div>`).join('');
    zone.querySelectorAll('.annonce-x').forEach(b => b.addEventListener('click', () => fermer(b.closest('.annonce').dataset.id)));
  }
  return { afficher };
})();
