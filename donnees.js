// Onglet Données : tableau de bord du garage, calculé à partir des fiches (rien n'est saisi ici).
// CA d'une vente = prix de vente − remise + pack livraison (la carte grise est une taxe reversée, hors CA).
// Bénéfice estimé = CA − prix d'achat du véhicule − frais (réels de la checklist de préparation, sinon estimés à la reprise).
const Donnees = (() => {
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const EN_MAIN = ['En préparation', 'En stock', 'Réservé'];
  const jour = 864e5;
  const jours = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / jour));
  const mois = d => (d || '').slice(0, 7);

  // Ventes livrées, avec leur date, leur CA et leur bénéfice.
  function ventes() {
    return db.all('commandes').filter(o => o.statut === 'Livrée').map(o => {
      const v = db.get('vehicules', o.vehiculeId) || {};
      const date = o.dateLivree || o.dateLivraison || (o.majLe || o.date || '').slice(0, 10);
      const prix = num(o.prixVente || v.prixVente) - num(o.remise);
      // Dépôt-vente : le chiffre d'affaires du garage est sa commission (le reste revient au propriétaire).
      const ca = (Depot.est(v) ? Depot.commission(v, prix) : prix) + num(o.montantPack);
      const benef = ca - (Depot.est(v) ? 0 : num(v.prixAchat)) - Prepa.frais(v);
      return { o, v, date, ca, benef };
    });
  }

  function calculer() {
    const auj = today();
    const vs = ventes();
    const ceMois = vs.filter(x => mois(x.date) === mois(auj));
    const vehicules = db.all('vehicules');
    const entree = v => v.dateEntree || (v.creeLe || '').slice(0, 10);
    // Rotation : jours entre l'entrée en stock et la vente, sur les ventes des 12 derniers mois.
    const ilYaUnAn = isoLocal(new Date(Date.now() - 365 * jour));
    const rot = vs.filter(x => x.date >= ilYaUnAn && entree(x.v)).map(x => jours(entree(x.v), x.date));
    const enMain = vehicules.filter(v => EN_MAIN.includes(v.statut))
      .map(v => ({ v, age: jours(entree(v), auj) })).sort((a, b) => b.age - a.age);
    // 6 derniers mois, du plus ancien au plus récent.
    const d = new Date(); d.setDate(1);
    const serie = Array.from({ length: 6 }, (_, i) => {
      const m = new Date(d.getFullYear(), d.getMonth() - 5 + i, 1);
      const cle = isoLocal(m).slice(0, 7);
      const lot = vs.filter(x => mois(x.date) === cle);
      return { cle, label: MOIS[m.getMonth()], ca: lot.reduce((s, x) => s + x.ca, 0), benef: lot.reduce((s, x) => s + x.benef, 0), n: lot.length };
    });
    return {
      enStock: vehicules.filter(v => v.statut === 'En stock').length,
      enPrepa: vehicules.filter(v => v.statut === 'En préparation').length,
      reserves: vehicules.filter(v => v.statut === 'Réservé').length,
      valeurStock: enMain.reduce((s, x) => s + num(x.v.prixAchat), 0),
      rotation: rot.length ? Math.round(rot.reduce((a, b) => a + b, 0) / rot.length) : null,
      nbRot: rot.length,
      ca: ceMois.reduce((s, x) => s + x.ca, 0),
      benef: ceMois.reduce((s, x) => s + x.benef, 0),
      nbVentes: ceMois.length,
      enMain, serie, souffrance: souffrance(auj),
    };
  }

  // Clients en souffrance : relance en retard, ou offre sans réponse depuis plus de 7 jours.
  function souffrance(auj) {
    const parClient = new Map();
    const ajouter = (id, motif, depuis) => {
      if (!id || !db.get('clients', id)) return;
      const c = parClient.get(id) || { id, motifs: [], depuis: 0 };
      c.motifs.push(motif);
      c.depuis = Math.max(c.depuis, depuis);
      parClient.set(id, c);
    };
    db.all('planning').filter(r => !r.fait && r.date && r.date < auj && r.clientId)
      .forEach(r => ajouter(r.clientId, `${r.type || 'Rendez-vous'} en retard`, jours(r.date, auj)));
    db.all('commandes').filter(o => o.statut === 'Offre' && o.date && jours(o.date, auj) > 7)
      .forEach(o => ajouter(o.clientId, `Offre ${o.numero || ''} sans réponse`, jours(o.date, auj)));
    return [...parClient.values()].sort((a, b) => b.depuis - a.depuis);
  }

  const tuile = (label, valeur, sous, cls = '') => `<div class="kpi ${cls}"><span class="kpi-l">${label}</span><strong class="kpi-v">${valeur}</strong><span class="kpi-s">${sous}</span></div>`;
  const eurosCourt = n => Math.abs(n) >= 1000 ? (n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k€' : euros(n);

  // Barres groupées CA / bénéfice sur 6 mois (une seule échelle, en euros).
  function graphMois(serie, largeur) {
    if (!serie.some(s => s.ca || s.benef)) return '<p class="hint viz-vide">Aucune vente livrée sur les 6 derniers mois : le graphique se remplira avec les premières livraisons.</p>';
    // Dessiné à la largeur réelle de l'écran pour garder des textes lisibles sur téléphone.
    const W = Math.max(280, Math.round(largeur || 640)), H = W < 500 ? 200 : 240, g = { l: 44, r: 6, t: 12, b: 26 };
    const max = Math.max(1, ...serie.map(s => Math.max(s.ca, s.benef)));
    const min = Math.min(0, ...serie.map(s => s.benef));
    const pas = Math.pow(10, Math.floor(Math.log10(max - min || 1)));
    const haut = Math.ceil(max / pas) * pas, bas = Math.floor(min / pas) * pas;
    const y = v => g.t + (haut - v) / (haut - bas || 1) * (H - g.t - g.b);
    const bw = (W - g.l - g.r) / serie.length;
    const larg = Math.min(26, bw * 0.3);
    const graduations = [bas, ...Array.from({ length: 4 }, (_, i) => bas + (haut - bas) * (i + 1) / 4)];
    const barre = (x, v, cls) => {
      const y0 = y(0), y1 = y(v), h = Math.abs(y0 - y1);
      if (h < 0.5) return '';
      const r = Math.min(4, h, larg / 2);
      // Bout arrondi côté valeur, base droite sur l'axe.
      return v >= 0
        ? `<path class="${cls}" d="M${x},${y0}V${y1 + r}q0,-${r} ${r},-${r}h${larg - 2 * r}q${r},0 ${r},${r}V${y0}Z"/>`
        : `<path class="${cls}" d="M${x},${y0}V${y1 - r}q0,${r} ${r},${r}h${larg - 2 * r}q${r},0 ${r},-${r}V${y0}Z"/>`;
    };
    return `<svg viewBox="0 0 ${W} ${H}" class="viz" role="img" aria-label="Chiffre d'affaires et bénéfice des 6 derniers mois">
      ${graduations.map(t => `<line class="grille" x1="${g.l}" x2="${W - g.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axe" x="${g.l - 6}" y="${y(t) + 4}" text-anchor="end">${eurosCourt(t).replace(/\s?€/, '')}</text>`).join('')}
      <line class="base" x1="${g.l}" x2="${W - g.r}" y1="${y(0)}" y2="${y(0)}"/>
      ${serie.map((s, i) => {
        const cx = g.l + bw * i + bw / 2;
        return `<g class="mois" data-i="${i}">
          <rect class="cible" x="${g.l + bw * i}" y="${g.t}" width="${bw}" height="${H - g.t - g.b}"/>
          ${barre(cx - larg - 1, s.ca, 's1')}${barre(cx + 1, s.benef, 's2')}
          <text class="axe" x="${cx}" y="${H - 8}" text-anchor="middle">${s.label}</text></g>`;
      }).join('')}
    </svg>`;
  }

  // Barres horizontales : jours passés au garage par les véhicules les plus anciens.
  function graphAnciens(liste) {
    if (!liste.length) return '<p class="hint">Aucun véhicule au garage pour l\'instant.</p>';
    const max = Math.max(30, ...liste.map(x => x.age));
    return `<div class="anciens">${liste.map(x => `<button type="button" class="ancien" data-vehicule="${x.v.id}">
      <span class="an-nom">${esc(vehiculeNom(x.v))}<small>${esc(x.v.statut)}${x.v.immatriculation ? ' · ' + esc(x.v.immatriculation) : ''}</small></span>
      <span class="an-barre"><span style="width:${Math.max(2, x.age / max * 100)}%"></span></span>
      <span class="an-j">${x.age} j${x.age > 90 ? ' <em class="alerte">⚠ +90 j</em>' : ''}</span></button>`).join('')}</div>`;
  }

  // Origine des clients : nombre de clients et ventes livrées des 12 derniers mois, par source.
  function origines() {
    const ilYaUnAn = isoLocal(new Date(Date.now() - 365 * jour));
    const parSource = new Map();
    const ligne = s => parSource.get(s) || parSource.set(s, { source: s, clients: 0, ventes: 0, ca: 0 }).get(s);
    db.all('clients').forEach(c => { ligne(c.source || 'Non renseignée').clients++; });
    ventes().filter(x => x.date >= ilYaUnAn).forEach(x => {
      const c = db.get('clients', x.o.clientId);
      const l = ligne(c?.source || 'Non renseignée');
      l.ventes++; l.ca += x.ca;
    });
    return [...parSource.values()].sort((a, b) => b.ventes - a.ventes || b.clients - a.clients);
  }
  function graphOrigines(liste) {
    if (!liste.length) return '<p class="hint">Aucun client pour l\'instant.</p>';
    const max = Math.max(1, ...liste.map(x => x.ventes));
    return `<div class="anciens">${liste.map(x => `<div class="ancien origine${x.source === 'Non renseignée' ? ' inconnue' : ''}">
      <span class="an-nom">${esc(x.source)}<small>${x.clients} client(s)${x.ca ? ' · ' + euros(x.ca) : ''}</small></span>
      <span class="an-barre"><span style="width:${x.ventes ? Math.max(3, x.ventes / max * 100) : 0}%"></span></span>
      <span class="an-j">${x.ventes} vente${x.ventes > 1 ? 's' : ''}</span></div>`).join('')}</div>`;
  }

  function rendre() {
    const d = calculer();
    const police = Papiers.lignesPolice();
    const aCompleter = police.filter(l => l.manque.length).length;
    const recherches = db.all('clients').filter(aUneRecherche).map(c => ({ c, n: vehiculesPour(c).length })).sort((a, b) => b.n - a.n);
    const m = MOIS[new Date().getMonth()];
    const g = Param.get().garage;
    const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#list').innerHTML = `<div class="donnees">
      <div class="accueil-tete">${g.logo ? `<img src="${esc(g.logo)}" alt="">` : ''}
        <div><h2>${g.nom ? esc(g.nom) : 'Ton garage'}</h2>
        <span class="muted">${esc([g.ville, date].filter(Boolean).join(' · '))}${g.nom ? '' : ' · <button type="button" class="lien" data-aller="parametres">Renseigne le nom de ton entreprise</button>'}</span></div></div>
      <div class="kpis">
        ${tuile('Véhicules en stock', d.enStock, `+ ${d.enPrepa} en prépa · ${d.reserves} réservé(s)`)}
        ${tuile('Rotation moyenne', d.rotation === null ? '—' : d.rotation + ' j', d.nbRot ? `entrée en stock → vente, sur ${d.nbRot} vente(s) en 12 mois` : 'Apparaît après la première vente livrée')}
        ${tuile(`CA de ${m}`, euros(d.ca), `${d.nbVentes} vente(s) livrée(s)`)}
        ${tuile(`Bénéfice de ${m}`, euros(d.benef), d.ca ? `marge ${Math.round(d.benef / d.ca * 100)} % · estimé` : 'CA − achat − frais du véhicule', d.benef < 0 ? 'negatif' : '')}
      </div>
      ${EnLigne.panneau()}
      ${Reseau.panneau()}
      ${Revision.panneau()}
      <section class="panneau">
        <div class="p-tete"><h3>CA et bénéfice, 6 derniers mois</h3>
          <div class="legende"><span><i class="s1"></i>CA</span><span><i class="s2"></i>Bénéfice</span></div></div>
        <div class="viz-zone"><div class="viz-svg"></div><div class="bulle" hidden></div></div>
      </section>
      <div class="deux">
        <section class="panneau">
          <div class="p-tete"><h3>Les plus anciens au garage</h3><span class="hint">${d.enMain.length} véhicule(s) · valeur d'achat ${euros(d.valeurStock) || '0 €'}</span></div>
          ${graphAnciens(d.enMain.slice(0, 8))}
        </section>
        <section class="panneau">
          <div class="p-tete"><h3>Clients en souffrance <span class="compte">${d.souffrance.length}</span></h3></div>
          <p class="hint">Relance en retard, ou offre sans réponse depuis plus de 7 jours.</p>
          ${d.souffrance.length ? `<div class="souffrance">${d.souffrance.map(s => {
            const c = db.get('clients', s.id);
            return `<button type="button" class="souf" data-client="${s.id}"><span><strong>${esc(clientNom(c))}</strong>
              <small>${esc(s.motifs.join(' · '))}</small></span><span class="badge b-orange">${s.depuis} j</span></button>`;
          }).join('')}</div>` : '<p class="ok-vide">✓ Aucun client en attente. Tout est à jour.</p>'}
        </section>
      </div>
      <div class="deux">
        <section class="panneau">
          <div class="p-tete"><h3>D'où viennent tes ventes</h3><span class="hint">12 derniers mois</span></div>
          <p class="hint">Renseigne « Comment nous a-t-il connus ? » sur chaque fiche client pour savoir quelles annonces font vendre.</p>
          ${graphOrigines(origines())}
        </section>
        <div class="pile">
        <section class="panneau">
          <div class="p-tete"><h3>Recherches clients <span class="compte">${recherches.length}</span></h3></div>
          ${recherches.length ? `<div class="souffrance">${recherches.map(r => `<button type="button" class="souf" data-client="${r.c.id}"><span><strong>${esc(clientNom(r.c))}</strong>
            <small>${esc(resumeRecherche(r.c))}</small></span>${r.n ? `<span class="badge b-green">${r.n} trouvé(s)</span>` : '<span class="badge b-grey">en attente</span>'}</button>`).join('')}</div>`
            : '<p class="hint">Note ce que cherche un client (rubrique « Ce qu\'il recherche » de sa fiche) : Ocaz te prévient quand une reprise ou un véhicule correspond.</p>'}
        </section>
        <section class="panneau">
          <div class="p-tete"><h3>Livre de police</h3><span class="hint">${police.length} véhicule(s) inscrit(s)</span></div>
          ${aCompleter ? `<p class="police-alerte">⚠ ${aCompleter} ligne(s) à compléter (vendeur, pièce d'identité, prix ou plaque).</p>` : police.length ? '<p class="ok-vide">✓ Toutes les lignes sont complètes.</p>' : '<p class="hint">Chaque reprise validée y crée sa ligne automatiquement.</p>'}
          <button type="button" class="chip" data-police>📖 Ouvrir le livre de police</button>
        </section>
        </div>
      </div></div>`;
    const zone = $('#list .viz-zone');
    zone.querySelector('.viz-svg').innerHTML = graphMois(d.serie, zone.clientWidth);
    brancher(d);
  }

  // Infobulle au survol (ou au toucher) de chaque mois.
  function brancher(d) {
    const zone = $('#list .viz-zone');
    const bulle = zone.querySelector('.bulle');
    const montrer = e => {
      const g = e.target.closest('.mois');
      zone.querySelectorAll('.mois').forEach(x => x.classList.toggle('actif', x === g));
      if (!g) { bulle.hidden = true; return; }
      const s = d.serie[g.dataset.i];
      bulle.innerHTML = `<strong>${s.label} ${s.cle.slice(0, 4)}</strong>
        <span><i class="s1"></i>CA <b>${euros(s.ca)}</b></span><span><i class="s2"></i>Bénéfice <b>${euros(s.benef)}</b></span>
        <span class="hint">${s.n} vente(s)</span>`;
      bulle.hidden = false;
      const r = zone.getBoundingClientRect(), gr = g.getBoundingClientRect();
      // Bulle à côté du mois survolé, pour ne pas cacher ses barres.
      const droite = gr.left - r.left + gr.width / 2 > r.width / 2;
      bulle.style.left = (droite ? gr.left - r.left - 4 : gr.right - r.left + 4) + 'px';
      bulle.style.transform = droite ? 'translateX(-100%)' : 'none';
    };
    zone.addEventListener('pointermove', montrer);
    zone.addEventListener('pointerdown', montrer);
    zone.addEventListener('pointerleave', () => { bulle.hidden = true; zone.querySelectorAll('.mois').forEach(x => x.classList.remove('actif')); });
  }

  return { rendre, calculer };
})();
