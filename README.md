# Ocaz

Ocaz, le logiciel des petits marchands de véhicules d'occasion (La Réunion), utilisable sur téléphone et sur PC.

## Version 1

- **Clients** : lister, rechercher, ajouter, modifier, supprimer.
- **Véhicules** : parcours Reprise à étudier → validée (En préparation / En stock) ou refusée → Réservé → Vendu.
  Fiche reprise : vendeur, état, cote estimée, frais, prix proposé, avec des liens vers les cotes gratuites (La Centrale, L'argus, Leboncoin).
  Idem pour lister et modifier, avec plaque, VIN, prix d'achat/vente, statut (En stock, Réservé, Vendu…).
  Le VIN remplit gratuitement la marque et l'année. La plaque remplit marque, modèle et finition via api-plaque.com (RapidAPI) :
  la clé se saisit dans le menu ⋯ de l'appli et reste sur l'appareil, elle n'est jamais dans ce dépôt.
- **Commandes** : relie un client et un véhicule, prix, acompte, statut. Le statut du véhicule suit la commande
  (En cours → Réservé, Livrée → Vendu, Annulée → En stock).
- Sauvegarde : export / import d'un fichier `.json` (menu ⋯).

## Ocaz Pro (pro.ocaz.re)

Ce dépôt est l'appli des pros, à l'adresse `pro.ocaz.re`. Le site public (véhicules du réseau, vitrines des garages, `integrer.js`,
pages légales, `rejoindre`, `outils`) est dans le dépôt `ocaz` (ex-`CRM-ZX`), à l'adresse `ocaz.re`.
- L'appli n'est pas référencée : `robots.txt` interdit tout, et chaque page a `<meta name="robots" content="noindex">`.
  Aucun lien du site public ne mène ici : Anthony envoie lui-même l'adresse aux pros. La vraie protection reste la connexion.
- L'appli s'ouvre directement sur la connexion unique, sans choix de profil ; l'espace (garage ou apporteur) dépend du compte.
- Un compte qui est à la fois garage et apporteur passe d'un espace à l'autre avec le bouton ⇄ de l'en-tête.
  Un garage ouvre son espace apporteur depuis Paramètres > Réseau Ocaz (`/apporteur?inscription`, contrat signé, même compte).
- `/apporteur` sans connexion renvoie vers la connexion ; `/apporteur?inscription` ouvre l'inscription (lien donné par les garages).
- Les liens de vitrine et le code d'intégration générés dans Paramètres pointent vers `https://ocaz.re/`.
- `404.html` renvoie toute autre adresse vers ocaz.re.

## Réseau Ocaz (apporteurs d'affaires et leads)

- **Garage** : Paramètres > Réseau Ocaz (rejoindre, commission fixe ou en %, partage d'office ou véhicule par véhicule).
  Chaque fiche véhicule a une case « Partager au réseau » et une commission propre si besoin. Onglet **Leads** : clients
  transmis par les apporteurs, prise en charge (fiche client, reprise à étudier, relance), vendu ou clos, commission versée,
  facture de l'apporteur. Le garage verse la commission lui-même : rien ne passe par Ocaz.
- **Apporteur** (`apporteur.html`, gratuit, inscription sur `/apporteur?inscription`) : inscription avec statut d'apporteur d'affaires et contrat signé en ligne,
  Suivi leads (en cours, clos, terminés), Données (commissions, ventes, leads en souffrance, taux de transformation),
  Réseau (choisir un véhicule et envoyer un client, avec son accord RGPD et une reprise éventuelle), Paramètres (infos, RIB,
  factures de commission, contrat). Démo : identifiant `apporteur`, mot de passe `test`.

## Technique

Appli web statique (HTML, CSS, JavaScript, sans build), hébergeable gratuitement sur GitHub Pages.
Les données sont pour l'instant stockées dans le navigateur de l'appareil (`localStorage`) ; tout passe par l'objet `db`
dans `app.js` pour pouvoir brancher une base en ligne (Supabase) et synchroniser téléphone et PC.

Pour l'essayer en local : ouvrir `index.html` dans un navigateur.

## Adresse pro.ocaz.re

Le fichier `CNAME` (contenu : `pro.ocaz.re`) relie ce dépôt au sous-domaine.
- OVH, zone DNS de `ocaz.re` : 1 `CNAME` sur `pro` vers `rulazyx.github.io.`
- GitHub > Settings > Pages : Source = Deploy from a branch, `main`, `/ (root)` ; Custom domain = `pro.ocaz.re` ; Enforce HTTPS.
- Supabase > Authentication > URL Configuration : ajouter `https://pro.ocaz.re/**` aux Redirect URLs.
Les données gardées dans le navigateur dépendent de l'adresse : sur pro.ocaz.re il faut se reconnecter une fois.

## Synchronisation PC / téléphone (Supabase)

1. Créer un compte gratuit sur supabase.com puis un projet.
2. Dans SQL Editor, coller le contenu de `supabase.sql` et cliquer sur Run.
3. Dans Authentication > URL Configuration, mettre l'adresse de l'appli dans Site URL et Redirect URLs.
4. Dans Project Settings > API, copier Project URL et la clé publique (anon / publishable), puis les coller dans le menu ⋯ de l'appli
   sur chaque appareil. Se connecter avec son email (lien de connexion reçu par email).

Toutes les données d'un compte sont dans une ligne JSON de la table `crm_data`, protégée par une règle d'accès (RLS).
La modification la plus récente l'emporte.
