// Recherche par plaque : l'appli appelle la fonction Supabase « plaque » (supabase/functions/plaque),
// qui interroge le fournisseur avec la clé gardée dans les secrets Supabase. Aucune clé dans l'appli.
const Plaque = (() => {
  // Anciennes clés RapidAPI gardées sur l'appareil par la version précédente : plus utilisées.
  try { localStorage.removeItem('crmzx-plaque'); } catch (e) { /* stockage indisponible */ }

  // Compteur du mois, renvoyé par la fonction (par garage).
  let compteur = { utilisees: null, limite: null };
  const usageTexte = () => compteur.utilisees == null ? '' : `${compteur.utilisees}/${compteur.limite} recherches par plaque ce mois-ci pour le garage`;

  const CARBURANTS = { GAZOLE: 'Diesel', DIESEL: 'Diesel', ESSENCE: 'Essence', ELECTRIC: 'Électrique', ELECTRIQUE: 'Électrique', GPL: 'GPL', PETROL: 'Essence' };
  // Codes courts de la carte grise (champ P.3).
  const CODES = { GO: 'Diesel', D: 'Diesel', ES: 'Essence', EL: 'Électrique', GP: 'GPL', EH: 'Hybride', GH: 'Hybride', EE: 'Hybride rechargeable', GL: 'Hybride rechargeable' };
  const titre = s => (s || '').toLowerCase().replace(/(^|[\s-])\S/g, c => c.toUpperCase())
    .replace(/\b(i{1,3}|iv|vi{0,3}|ix)\b/gi, c => c.toUpperCase()); // Scénic III

  function carburant(energie) {
    const e = (energie || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (CODES[e.trim()]) return CODES[e.trim()];
    if (e.includes('RECHARGEABLE')) return 'Hybride rechargeable';
    if (e.includes('HYBRID')) return 'Hybride';
    for (const k in CARBURANTS) if (e.includes(k)) return CARBURANTS[k];
    return energie ? 'Autre' : '';
  }

  async function rechercher(plaque) {
    const p = (plaque || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (p.length < 5) throw new Error("Saisis la plaque d'abord.");
    const client = window.Sync && Sync.client;
    if (!client || !Sync.user) throw new Error('Connecte-toi pour rechercher une plaque.');
    let json;
    try {
      const { data, error } = await client.functions.invoke('plaque', { body: { plaque: p } });
      if (error) throw error;
      json = data || {};
    } catch (e) {
      throw new Error("Le service de plaque ne répond pas. Si c'est la première fois, la fonction « plaque » n'est peut-être pas encore installée dans Supabase.");
    }
    if (json.erreur) throw new Error(json.erreur);
    if (json.utilisees != null) compteur = { utilisees: json.utilisees, limite: json.limite };
    const d = json.data || {};
    // Le service renvoie plus de 80 champs dont les noms varient : on cherche par mot-clé.
    const pick = (...motifs) => {
      for (const m of motifs) {
        const k = Object.keys(d).find(key => m.test(key) && d[key] !== '' && d[key] != null && typeof d[key] !== 'object');
        if (k) return String(d[k]).trim();
      }
      return '';
    };
    const mec = pick(/date_mise_en_circulation/i, /date1erCir_fr/i, /mise.*circulation/i).match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    const carrosserie = pick(/carrosserie(?!.*code)/i, /body/i);
    const genre = pick(/^AWN_genre$/i, /genre(?!.*code)/i);
    const boite = pick(/boite/i, /transmission(?!.*code)/i, /gearbox/i);
    return {
      marque: titre(pick(/^AWN_marque$/i, /marque(?!.*(image|logo|id))/i)),
      modele: titre(pick(/^AWN_modele$/i, /modele(?!.*(image|photo|id|etude|prf|label))/i)),
      finition: pick(/^AWN_version$/i, /version/i, /label_moteur/i),
      annee: mec ? mec[3] : pick(/annee(?!.*(debut|fin))/i),
      miseEnCirculation: mec ? `${mec[3]}-${mec[2]}-${mec[1]}` : '',
      carburant: carburant(pick(/energie(?!.*code)/i, /carburant/i, /fuel/i)),
      boite: /auto|robot|cvt|dsg|edc|eat|^a$/i.test(boite) ? 'Automatique' : /manu|meca|^m$/i.test(boite) ? 'Manuelle' : '',
      couleur: titre(pick(/couleur/i, /colou?r/i)),
      type: typeVehicule(carrosserie, genre),
      puissanceCh: pick(/puissance_chevaux/i, /puisFiscReelCH/i, /puissance_din/i),
      puissanceFiscale: pick(/puissance_fiscale/i, /^puisFisc$/i),
      cylindree: pick(/cylindre_capacite/i, /^ccm$/i, /cylindree(?!_liters)/i),
      co2: pick(/co_?2/i),
      portes: pick(/portes/i),
      places: pick(/places|passagers|seats/i),
      vin: pick(/_VIN$/i, /^vin$/i),
      image: json.image || pick(/model_image/i, /photo_modele/i),
      description: json.description || pick(/selector_modele_label/i, /tecdoc_modele_description/i, /label$/i),
      // Tout ce que renvoie le service, gardé dans la fiche du véhicule.
      ficheTechnique: Object.fromEntries(Object.entries(json.fiche || d)
        .filter(([k, v]) => v !== '' && v != null && typeof v !== 'object' && !/image|photo|logo/i.test(k))
        .map(([k, v]) => [k.replace(/^AWN_/, '').replace(/_/g, ' '), String(v)])),
    };
  }

  // Type de véhicule déduit de la carrosserie et du genre de la carte grise.
  function typeVehicule(carrosserie, genre) {
    const c = norm(carrosserie + ' ' + genre);
    if (/ctte|camionnette|utilitaire|fourgon|\bvu\b|deriv/.test(c)) return 'Utilitaire';
    if (/pick/.test(c)) return 'Pick-up';
    if (/break|sw|estate|touring/.test(c)) return 'Break';
    if (/monospace|mpv/.test(c)) return 'Monospace';
    if (/suv|4x4|tout.?terrain|crossover/.test(c)) return 'SUV / 4x4';
    if (/coupe|cabrio|roadster/.test(c)) return 'Coupé / Cabriolet';
    if (/berline|sedan|4 portes/.test(c)) return 'Berline';
    return '';
  }
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  return { rechercher, usageTexte };
})();
