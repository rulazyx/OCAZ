// Fonction Supabase « revision » : rappels de révision 11 mois après la vente.
// Appelée chaque jour par la base (pg_cron, voir supabase.sql) : pour chaque garage, chaque vente livrée arrivée à son
// délai (11 mois par défaut, Paramètres > Révisions) envoie un mail au client, une seule fois par vente.
// Le lien « ne plus recevoir » du mail rappelle cette fonction avec ?stop=… et inscrit le client dans crm_revision_stop.
//
// Secrets (Supabase > Edge Functions > Secrets) :
//   RESEND_API_KEY        clé du compte resend.com (domaine ocaz.re vérifié)
//   REVISION_EXPEDITEUR   adresse d'envoi, « rappel@ocaz.re » par défaut
// Réglage de la fonction : « Verify JWT » désactivé (la base l'appelle sans compte ; envoyer deux fois est impossible).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const env = (k: string) => (Deno.env.get(k) || '').trim();
const base = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const ADRESSE = env('SUPABASE_URL') + '/functions/v1/revision';
// Une vente dont le délai est passé depuis plus de 30 jours ne déclenche plus de mail (anciennes ventes importées).
const RATTRAPAGE_JOURS = 30;

type Fiche = Record<string, any>;
const DEFAUTS = { actif: true, mail: true, delaiMois: 11, cout: '', margeType: 'pourcentage', margeValeur: 30, prixDansMail: true };

const num = (v: unknown) => { const n = Number(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const euros = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
const iso = (d: Date) => d.toISOString().slice(0, 10);
function plusMois(date: string, mois: number) {
  const d = new Date(date + 'T12:00:00Z');
  const jour = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + mois);
  d.setUTCDate(Math.min(jour, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return iso(d);
}
const plusJours = (date: string, n: number) => iso(new Date(new Date(date + 'T12:00:00Z').getTime() + n * 864e5));

// Même calcul que revision.js : coût de la révision (vidange de la préparation du véhicule, sinon coût du garage) + marge.
function prix(r: typeof DEFAUTS, v: Fiche | undefined) {
  const vidange = (v?.prepa || []).find((p: Fiche) => /vidange|r[ée]vision/i.test(p.nom || '') && num(p.montant) > 0);
  const cout = vidange ? num(vidange.montant) : num(r.cout);
  if (!cout) return 0;
  const marge = r.margeType === 'fixe' ? num(r.margeValeur) : cout * num(r.margeValeur) / 100;
  return Math.round((cout + marge) / 5) * 5;
}
const dateVente = (o: Fiche) => String(o.dateLivree || o.dateLivraison || o.date || '').slice(0, 10);

function mail(g: Fiche, c: Fiche, v: Fiche | undefined, montant: number, stop: string) {
  const vehicule = [v?.marque, v?.modele].filter(Boolean).join(' ') || 'votre véhicule';
  const garage = g.nom || 'votre garage';
  const adresse = [g.adresse, [g.codePostal, g.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const bonjour = 'Bonjour' + (c.prenom ? ' ' + c.prenom : c.nom ? ' ' + [c.civilite, c.nom].filter(Boolean).join(' ') : '') + ',';
  const contact = [g.telephone && `appelez-nous au ${g.telephone}`, g.email && 'répondez simplement à ce mail'].filter(Boolean).join(' ou ')
    || 'contactez-nous';
  const lignes = [
    `Il y a bientôt un an, vous êtes reparti(e) de chez ${garage} avec votre ${vehicule}. Nous espérons qu'il vous donne entière satisfaction.`,
    `C'est le bon moment pour sa révision : vidange, filtres et contrôle des points de sécurité, pour qu'il reste fiable et garde sa valeur.`,
    montant ? `Nous vous la proposons à ${euros(montant)} TTC.` : '',
    `Pour prendre rendez-vous, ${contact}.`,
  ].filter(Boolean);
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f3f1;font-family:Arial,Helvetica,sans-serif;color:#222">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#1c1c1e;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0;font-size:20px;font-weight:bold">${esc(garage)}</div>
  <div style="background:#fff;padding:22px;border-radius:0 0 10px 10px;line-height:1.55;font-size:15px">
    <p>${esc(bonjour)}</p>
    ${lignes.map(l => `<p>${esc(l)}</p>`).join('\n    ')}
    <p>À bientôt,<br><strong>${esc(garage)}</strong>${adresse ? `<br>${esc(adresse)}` : ''}${g.telephone ? `<br>${esc(g.telephone)}` : ''}</p>
  </div>
  <p style="font-size:12px;color:#777;text-align:center;line-height:1.5">Vous recevez ce rappel car vous avez acheté votre véhicule chez ${esc(garage)}.<br>
    <a href="${esc(stop)}" style="color:#777">Ne plus recevoir de rappel d'entretien</a></p>
</div></body></html>`;
  const texte = [bonjour, '', ...lignes, '', 'À bientôt,', garage, adresse, g.telephone, '', `Ne plus recevoir de rappel d'entretien : ${stop}`]
    .filter(l => l !== undefined).join('\n');
  return { sujet: `${vehicule[0].toUpperCase() + vehicule.slice(1)} : c'est l'heure de sa révision`, html, texte };
}

async function envoyer(de: string, a: string, repondre: string, m: { sujet: string; html: string; texte: string }, stop: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env('RESEND_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: de, to: [a], subject: m.sujet, html: m.html, text: m.texte,
      ...(repondre ? { reply_to: repondre } : {}),
      headers: { 'List-Unsubscribe': `<${stop}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status} : ${(await res.text()).slice(0, 300)}`);
}

// Tournée du jour : tous les garages (sauf la démo), toutes les ventes livrées arrivées à leur délai.
async function tournee() {
  if (!env('RESEND_API_KEY')) return { erreur: 'Secret RESEND_API_KEY manquant.' };
  const expediteur = env('REVISION_EXPEDITEUR') || 'rappel@ocaz.re';
  const auj = iso(new Date());
  const bilan = { garages: 0, envoyes: 0, erreurs: [] as string[] };
  const { data: garages, error } = await base.from('crm_entreprises').select('id, nom, data, config').eq('demo', false);
  if (error) return { erreur: error.message };
  for (const e of garages || []) {
    const d: Fiche = e.data || {};
    const r = { ...DEFAUTS, ...(d.parametres?.revision || {}) };
    if (!r.actif || !r.mail) continue;
    bilan.garages++;
    // Infos du garage : celles de l'administrateur priment (comme dans l'appli).
    const infos = Object.fromEntries(Object.entries(e.config?.infos || {}).filter(([, v]) => v !== '' && v != null));
    const g: Fiche = { ...(d.parametres?.garage || {}), ...infos, nom: infos.nom || d.parametres?.garage?.nom || e.nom };
    const supprimes = d.supprimes || {};
    const clients = new Map((d.clients || []).map((c: Fiche) => [c.id, c]));
    const vehicules = new Map((d.vehicules || []).map((v: Fiche) => [v.id, v]));
    const dues = (d.commandes || []).filter((o: Fiche) => {
      if (o.statut !== 'Livrée' || supprimes[o.id] || !dateVente(o)) return false;
      const echeance = plusMois(dateVente(o), num(r.delaiMois) || 11);
      return echeance <= auj && plusJours(echeance, RATTRAPAGE_JOURS) >= auj;
    });
    if (!dues.length) continue;
    const { data: stops } = await base.from('crm_revision_stop').select('email').eq('entreprise_id', e.id);
    const refus = new Set((stops || []).map(s => s.email));
    for (const o of dues) {
      const c = clients.get(o.clientId) as Fiche | undefined;
      const email = String(c?.email || '').trim().toLowerCase();
      if (!c || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || c.pasDeRappel || refus.has(email)) continue;
      // La ligne est réservée avant l'envoi : deux tournées en même temps ne peuvent pas envoyer deux fois.
      const { data: ligne, error: dejaFait } = await base.from('crm_revision_envois')
        .insert({ entreprise_id: e.id, commande_id: o.id, client_id: c.id, email }).select('id').single();
      if (dejaFait || !ligne) continue;
      const stop = `${ADRESSE}?stop=${ligne.id}`;
      const v = vehicules.get(o.vehiculeId) as Fiche | undefined;
      try {
        await envoyer(`${String(g.nom).replace(/["<>]/g, '')} <${expediteur}>`, email, g.email || '', mail(g, c, v, r.prixDansMail ? prix(r, v) : 0, stop), stop);
        await base.from('crm_revision_envois').update({ statut: 'envoye' }).eq('id', ligne.id);
        bilan.envoyes++;
      } catch (err) {
        // Échec : la ligne est retirée pour retenter demain (dans la limite du rattrapage).
        await base.from('crm_revision_envois').delete().eq('id', ligne.id);
        bilan.erreurs.push(`${e.nom} · ${o.numero || o.id} : ${(err as Error).message}`);
      }
    }
  }
  return bilan;
}

// Désinscription : le client clique sur le lien du mail (GET) ou sa messagerie le fait pour lui (POST un clic).
async function desinscrire(id: string) {
  const { data } = await base.from('crm_revision_envois').select('entreprise_id, email').eq('id', id).maybeSingle();
  if (!data) return "Ce lien n'est plus valable.";
  await base.from('crm_revision_stop').upsert({ entreprise_id: data.entreprise_id, email: data.email });
  await base.from('crm_revision_envois').update({ stop_le: new Date().toISOString() }).eq('id', id);
  return "C'est noté : vous ne recevrez plus de rappel d'entretien de ce garage.";
}

Deno.serve(async req => {
  const stop = new URL(req.url).searchParams.get('stop');
  if (stop) {
    const texte = /^[0-9a-f-]{36}$/i.test(stop) ? await desinscrire(stop) : "Ce lien n'est plus valable.";
    return new Response(texte, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (req.method !== 'POST') return new Response('Méthode non prise en charge', { status: 405 });
  const bilan = await tournee();
  console.log(JSON.stringify(bilan));
  return new Response(JSON.stringify(bilan), { headers: { 'Content-Type': 'application/json' } });
});
