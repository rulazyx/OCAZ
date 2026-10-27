// Fonction Supabase « plaque » : plaque d'immatriculation → marque, modèle, version, image du modèle.
// L'appli appelle cette fonction ; la clé du fournisseur reste dans les secrets Supabase, jamais dans l'appli.
//
// Secrets (Supabase > Edge Functions > Secrets) :
//   PLAQUE_UTILISATEUR   nom d'utilisateur immatriculationapi.com (fournisseur conseillé)
//   ou PLAQUE_RAPIDAPI_CLE (+ PLAQUE_RAPIDAPI_HOST) pour une API plaque vendue sur RapidAPI
//   PLAQUE_LIMITE_MOIS   recherches payantes par garage et par mois (30 par défaut)
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reponse = (body: unknown) => new Response(JSON.stringify(body), { headers: { ...CORS, 'Content-Type': 'application/json' } });
const erreur = (message: string) => reponse({ erreur: message });

const env = (k: string) => (Deno.env.get(k) || '').trim();
const CACHE_JOURS = 180;

type Resultat = { data: Record<string, string>; fiche: Record<string, string>; image: string; description: string };

// Garde les valeurs simples d'un objet (texte, nombre), sans les champs vides.
function simples(o: Record<string, unknown>): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v == null || v === '' || typeof v === 'object') continue;
    r[k] = String(v).trim();
  }
  return r;
}
const texte = (v: unknown): string =>
  v && typeof v === 'object' ? String((v as Record<string, unknown>).CurrentTextValue ?? '') : String(v ?? '');
const https = (url: string) => url.replace(/^http:\/\//i, 'https://');

// immatriculationapi.com (RegCheck) : 0,20 € la recherche, payée à l'avance par crédits.
async function immatriculationApi(plaque: string): Promise<Resultat | string> {
  const url = 'https://www.immatriculationapi.com/api/reg.asmx/CheckFrance?' +
    new URLSearchParams({ RegistrationNumber: plaque, username: env('PLAQUE_UTILISATEUR') });
  const res = await fetch(url);
  const xml = await res.text();
  const m = xml.match(/<vehicleJson>([\s\S]*?)<\/vehicleJson>/);
  if (!m || !m[1].trim()) {
    if (/credit/i.test(xml)) return 'Plus de crédits chez immatriculationapi.com : recharge le compte.';
    if (/username|user name|not found.*user|invalid user/i.test(xml)) return "Nom d'utilisateur immatriculationapi.com refusé : vérifie le secret PLAQUE_UTILISATEUR.";
    return 'Véhicule introuvable pour cette plaque.';
  }
  const json = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  let v: Record<string, unknown>;
  try { v = JSON.parse(json); } catch { return 'Réponse illisible du fournisseur.'; }
  const x = (v.ExtendedData || {}) as Record<string, unknown>;
  const mec = String(x.datePremiereMiseCirculation || '').match(/^(\d{2})(\d{2})(\d{4})$/);
  // Noms de champs compris par plaque.js.
  const data = simples({
    marque: x.marque || texte(v.CarMake),
    modele: x.libelleModele || texte(v.CarModel),
    version: x.libVersion,
    date_mise_en_circulation: mec ? `${mec[1]}-${mec[2]}-${mec[3]}` : '',
    annee: v.RegistrationYear,
    energie: texte(v.FuelType) || x.carburantVersion,
    boite: x.boiteDeVitesse || texte(v.Transmission),
    carrosserie: texte(v.BodyStyle),
    puissance_chevaux: x.puissanceDyn,
    puissance_fiscale: x.puissance,
    cylindree: x.EngineCC || texte(v.EngineSize),
    co2: x.Co2,
    portes: texte(v.NumberOfDoors),
    places: texte(v.NumberOfSeats),
    couleur: x.couleur,
    vin: x.numSerieMoteur,
  });
  return {
    data,
    fiche: { ...simples(v as Record<string, unknown>), ...simples(x) },
    image: https(String(v.ImageUrl || '')),
    description: String(v.Description || ''),
  };
}

// API plaque vendue sur RapidAPI (ex. api-plaque-immatriculation.com) : abonnement mensuel.
async function rapidApi(plaque: string): Promise<Resultat | string> {
  const host = env('PLAQUE_RAPIDAPI_HOST') || 'api-de-plaque-d-immatriculation-france.p.rapidapi.com';
  const res = await fetch(`https://${host}/?${new URLSearchParams({ plaque })}`, {
    headers: { 'x-rapidapi-key': env('PLAQUE_RAPIDAPI_CLE'), 'x-rapidapi-host': host },
  });
  let json: Record<string, unknown> = {};
  try { json = await res.json(); } catch { /* réponse non JSON */ }
  const msg = String(json.message || '');
  if (res.status === 401 || res.status === 403) return 'RapidAPI refuse la clé' + (msg ? ' : ' + msg : '.');
  if (res.status === 429) return 'Quota RapidAPI atteint pour ce mois.';
  const d = (json.data && typeof json.data === 'object' ? json.data : json) as Record<string, unknown>;
  if (!res.ok || json.error || !Object.keys(d).length) return msg || 'Véhicule introuvable pour cette plaque.';
  const data = simples(d);
  const image = Object.entries(data).find(([k]) => /model_image|photo_modele/i.test(k))?.[1] || '';
  const description = Object.entries(data).find(([k]) => /modele_label|description/i.test(k))?.[1] || '';
  return { data, fiche: data, image: https(image), description };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

    // Qui appelle ? Le compte connecté à l'appli, et son garage.
    const jeton = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(jeton);
    const email = (u?.user?.email || '').toLowerCase();
    if (!email) return erreur('Connecte-toi pour rechercher une plaque.');
    const { data: membre } = await admin.from('crm_membres').select('entreprise_id, crm_entreprises(demo)').eq('email', email).maybeSingle();
    if (!membre) return erreur('Compte sans garage : recherche par plaque indisponible.');
    const demo = !!(membre.crm_entreprises as { demo?: boolean } | null)?.demo;

    const body = await req.json().catch(() => ({}));
    const plaque = String(body.plaque || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (plaque.length < 5 || plaque.length > 10) return erreur("Saisis la plaque d'abord.");

    // Plaque déjà cherchée récemment (par n'importe quel garage) : gratuit.
    const { data: cache } = await admin.from('crm_plaque_cache').select('data, cree_le').eq('plaque', plaque).maybeSingle();
    if (cache && Date.now() - new Date(cache.cree_le).getTime() < CACHE_JOURS * 864e5) {
      return reponse({ ...cache.data, cache: true });
    }
    if (demo) return erreur('Recherche par plaque désactivée sur le compte démo : saisis les champs à la main.');

    const fournisseur = env('PLAQUE_UTILISATEUR') ? immatriculationApi : env('PLAQUE_RAPIDAPI_CLE') ? rapidApi : null;
    if (!fournisseur) return erreur("Recherche par plaque pas encore activée : il manque la clé du fournisseur dans Supabase.");

    const limite = parseInt(env('PLAQUE_LIMITE_MOIS') || '30', 10) || 30;
    const { data: n, error: errRes } = await admin.rpc('crm_plaque_reserver', { p_entreprise: membre.entreprise_id, p_limite: limite });
    if (errRes) return erreur('Compteur indisponible : relance le script supabase.sql.');
    if (n == null) return erreur(`Limite de ${limite} recherches par plaque atteinte ce mois-ci pour ton garage.`);

    let r: Resultat | string;
    try { r = await fournisseur(plaque); } catch { r = ''; }
    if (typeof r === 'string') {
      // Pas de réponse ou refus du fournisseur : la recherche n'est pas comptée.
      if (!r || !/introuvable/i.test(r)) await admin.rpc('crm_plaque_rendre', { p_entreprise: membre.entreprise_id });
      return erreur(r || 'Le service de plaque ne répond pas, réessaie dans un instant.');
    }
    await admin.from('crm_plaque_cache').upsert({ plaque, data: r, cree_le: new Date().toISOString() });
    return reponse({ ...r, cache: false, utilisees: n, limite });
  } catch (e) {
    return erreur('Erreur du service de plaque : ' + (e instanceof Error ? e.message : String(e)));
  }
});
