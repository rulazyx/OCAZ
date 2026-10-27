# Ocaz

Ocaz, le logiciel des petits marchands de véhicules d'occasion (La Réunion), utilisable sur téléphone et sur PC.

## Version 1

- **Clients** : lister, rechercher, ajouter, modifier, supprimer.
- **Véhicules** : parcours Reprise à étudier → validée (En préparation / En stock) ou refusée → Réservé → Vendu.
  Fiche reprise : vendeur, état, cote estimée, frais, prix proposé, avec des liens vers les cotes gratuites (La Centrale, L'argus, Leboncoin).
  Idem pour lister et modifier, avec plaque, VIN, prix d'achat/vente, statut (En stock, Réservé, Vendu…).
  Le VIN remplit gratuitement la marque et l'année. La plaque remplit marque, modèle, version et l'image du modèle
  via la fonction Supabase `plaque` (voir plus bas).
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
- `/apporteur` sans connexion renvoie vers la connexion (plus d'inscription en ligne : voir « Comptes et droits »).
- Les liens de vitrine et le code d'intégration générés dans Paramètres pointent vers `https://ocaz.re/`.
- `404.html` renvoie toute autre adresse vers ocaz.re.

## Comptes et droits (administrateur)

- Plus d'inscription libre : l'administrateur (super-admin) crée tous les comptes depuis `admin.html` (`/admin`), où il arrive
  directement à la connexion. Identifiant court `admin` (table `crm_identifiants`), mot de passe de départ `admin` à changer avant le lancement.
- Onglet **Commercial** : **Revendeurs** (infos légales, email de connexion, droits, packs livraison, comptes) et **Apporteurs** (fiche complète,
  suspension, réinitialisation du mot de passe). Mot de passe de départ des comptes créés : `12345678`.
- Droits d'un revendeur (`crm_entreprises.config`, lu par `droits.js`) : réseau Ocaz (+ commission), dépôt-vente, achat-revente.
  Achat-revente seul : pas d'onglet Dépôt vente. Dépôt-vente seul : pas d'onglet Reprise, Stock limité aux véhicules partenaires.
  Le Stock a toujours un sous-onglet **Partenaires** (véhicules partagés par les autres garages du réseau).
- Paramètres du revendeur : logo modifiable, autres infos grisées (contacter l'administrateur), documents (télécharger, envoyer par mail, ajouter).
- Paramètres de l'apporteur : téléphone et RIB seulement, contrat (signé à la première connexion), factures.

## Reprises et dépôt-vente

- **Reprise** : onglets En cours / Validées / Annulées. Création : Retour, Enregistrer pour plus tard, Valider. « Valider » range la reprise
  dans les validées sans la passer en préparation ; elle se choisit ensuite dans une offre (menu déroulant), et c'est la commande qui la fait entrer en préparation.
- **Dépôt vente** (onglet à part, `depotvente.js`) : En stock / Réservés / Vendus (+ À compléter). Nouveau dépôt en 4 étapes :
  client, véhicule, prix et commission (validable dès cette étape), documents (CNI, carte grise, justificatif de domicile, RIB),
  téléversés ou photographiés l'un après l'autre sur téléphone (`scan.js`, lecture automatique Tesseract chargée à la demande).

## Réseau Ocaz (apporteurs d'affaires et leads)

- **Garage** : adhésion et commission réglées par l'administrateur (partage d'office, ou véhicule par véhicule).
  Chaque fiche véhicule a une case « Partager au réseau » et une commission propre si besoin. Onglet **Leads** : clients
  transmis par les apporteurs, prise en charge (fiche client, reprise à étudier, relance), vendu ou clos, commission versée,
  facture de l'apporteur. Le garage verse la commission lui-même : rien ne passe par Ocaz.
- **Apporteur** (`apporteur.html`, gratuit, compte créé par l'administrateur) : contrat signé en ligne à la première connexion,
  Suivi leads (en cours, clos, terminés), Données (commissions, ventes, leads en souffrance, taux de transformation),
  Réseau (choisir un véhicule et envoyer un client, avec son accord RGPD et une reprise éventuelle), Paramètres (infos, RIB,
  factures de commission, contrat). Démo : identifiant `apporteur`, mot de passe `test`.

## Rappels de révision (leads « Révision »)

- 11 mois après une commande livrée (délai réglable dans Paramètres > Révisions), le client apparaît dans l'onglet **Leads > Révisions**
  (« À appeler », avec « À venir » pour le mois suivant, puis RDV / Faites / Closes) et sur l'accueil (Données). L'onglet Leads est donc
  visible pour tous les revendeurs ; la bascule Réseau / Révisions n'apparaît qu'avec le droit réseau.
- Prix proposé = coût de la révision + marge du garage, arrondi à 5 €. Le coût est la ligne « Vidange et filtres » de la préparation
  du véhicule vendu (son tarif prépa), sinon le coût réglé dans Paramètres. Le suivi est gardé sur la commande (`revision`).
- Aucun mail n'est envoyé au client : c'est le garage qui l'appelle. Rien à installer côté Supabase.

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

## Recherche par plaque (fonction Supabase `plaque`)

- `supabase/functions/plaque/index.ts` interroge le fournisseur (immatriculationapi.com conseillé, 0,20 € la recherche ;
  ou une API plaque RapidAPI). La clé est un **secret Supabase**, jamais dans l'appli ni dans ce dépôt.
- Secrets : `PLAQUE_UTILISATEUR` (immatriculationapi.com) ou `PLAQUE_RAPIDAPI_CLE` (+ `PLAQUE_RAPIDAPI_HOST`),
  et `PLAQUE_LIMITE_MOIS` (30 recherches payantes par garage et par mois par défaut).
- Une plaque déjà cherchée (par n'importe quel garage, moins de 180 jours) est resservie gratuitement depuis `crm_plaque_cache`.
- Compte démo : seulement les plaques déjà en cache. Tables et compteur : fin de `supabase.sql`.
- Installation : Supabase > Edge Functions > Deploy a new function > Via Editor, nom `plaque`, coller `index.ts`,
  décocher « Verify JWT » (la fonction vérifie elle-même le compte connecté).
