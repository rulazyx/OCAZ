# Ocaz

Ocaz, le logiciel des petits marchands de véhicules d'occasion (La Réunion), utilisable sur téléphone et sur PC.

## Version 1

- **Clients** : plus d'onglet depuis le 27/10/2026 ; un client se crée dans l'offre (bloc « Nouveau client ») et sa fiche s'ouvre
  depuis les leads, les révisions et le Tableau de bord. Le Planning n'a plus d'écran non plus : les relances et rappels
  (`planning` dans les données) servent toujours au Tableau de bord et aux offres.
- **Véhicules** : parcours Reprise à étudier → validée (En préparation / En stock) ou refusée → Réservé → Vendu.
  Fiche reprise : vendeur, état, cote estimée, frais, prix proposé, avec des liens vers les cotes gratuites (La Centrale, L'argus, Leboncoin).
  Idem pour lister et modifier, avec plaque, VIN, prix d'achat/vente, statut (En stock, Réservé, Vendu…).
  Le VIN remplit gratuitement la marque et l'année. La plaque remplit marque, modèle, version et l'image du modèle
  via la fonction Supabase `plaque` (voir plus bas).
- **Commandes** : relie un client et un véhicule, prix, acompte, statut. Le statut du véhicule suit la commande
  (En cours → Réservé, Livrée → Vendu, Annulée → En stock).

## Ocaz Pro (ocaz.re)

Ce dépôt est l'appli des pros, à l'adresse `ocaz.re`. Le site public (véhicules du réseau, vitrines des garages, `integrer.js`,
pages légales, `rejoindre`, `outils`) est dans le dépôt `SITE-VITRINE-` (ex-`ocaz`, ex-`CRM-ZX`), à l'adresse `reseau.ocaz.re`.
- L'appli n'est pas référencée : `robots.txt` interdit tout, et chaque page a `<meta name="robots" content="noindex">`.
  Aucun lien du site public ne mène ici : Anthony envoie lui-même l'adresse aux pros. La vraie protection reste la connexion.
- L'appli s'ouvre directement sur la connexion unique, sans choix de profil ; l'espace (garage ou apporteur) dépend du compte.
- Un compte qui est à la fois garage et apporteur passe d'un espace à l'autre avec le bouton ⇄ de l'en-tête.
- `/apporteur` sans connexion renvoie vers la connexion (plus d'inscription en ligne : voir « Comptes et droits »).
- Les liens de vitrine et le code d'intégration générés dans Paramètres pointent vers `https://reseau.ocaz.re/`.
- Jusqu'au 27/10/2026 le site public était sur `ocaz.re` : `404.html` renvoie toute autre adresse (`/reseau`, `/vitrine?g=…`,
  pages légales…) vers reseau.ocaz.re, et `integrer.js` reste ici pour les codes déjà collés sur des sites de garages.

## Comptes et droits (administrateur)

- Plus d'inscription libre : l'administrateur (super-admin) crée tous les comptes depuis `admin.html` (`/admin`), où il arrive
  directement à la connexion. Identifiant court `admin` (table `crm_identifiants`), mot de passe de départ `admin` à changer avant le lancement.
- Onglet **Partenaires** (ex-Commercial) : **Revendeurs** (infos légales, email de connexion, droits, packs livraison, comptes) et **Apporteurs** (fiche complète,
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
- **Administratif** (`administratif.js`) : toute la paperasse. *À faire* (déclarations d'achat et de cession au SIV sous 15 jours,
  CT de moins de 6 mois, factures à éditer, mandats qui expirent, reversements, W garage et assurance qui arrivent à échéance),
  *Véhicules* (dossier de chaque véhicule : livre de police, cession, déclaration d'achat, CT, bon de commande, facture),
  *Registres* (livre de police, factures et export comptable, mandats) et *Garage* (habilitations, échéances, documents du garage).
  Champs ajoutés : `daSiv`, `cessionSiv`, `ctDate` sur les véhicules, `parametres.administratif` pour le garage. Pas de SQL à lancer.

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
Les données de chaque garage sont dans Supabase (une ligne JSON par garage, table `crm_entreprises`, voir `sync.js`),
avec une copie dans le navigateur (`localStorage`) ; tout passe par l'objet `db` dans `app.js`.

### Mises à jour et ouverture rapide

- `sw.js` garde une copie de l'appli sur l'appareil : elle s'ouvre depuis cette copie, sans redemander chaque fichier au serveur.
- `version.json` change à chaque mise en ligne : l'action GitHub `.github/workflows/version.yml` le réécrit toute seule
  après chaque fusion dans `main` (commit « Version publiée … » du robot). Ne pas le modifier à la main.
- `maj.js` lit `version.json` toutes les 5 minutes : nouvelle version → bandeau « Mettre à jour ». À l'ouverture, si la copie
  du téléphone est plus ancienne que la version en ligne, elle est jetée et l'appli se recharge tout de suite.
- Les fichiers rarement utilisés se chargent à la demande (`chargerScript` dans `app.js`) : `qrcode.js`, `demo.js`,
  et dans `vendor/` le PDF et l'Excel ; la lecture des documents (Tesseract) vient d'internet.

Pour l'essayer en local : ouvrir `index.html` dans un navigateur.

## Adresse ocaz.re

Le fichier `CNAME` (contenu : `ocaz.re`) relie ce dépôt au domaine (zone DNS OVH : 4 `A` sur `@` vers GitHub Pages, `www` en CNAME).
- GitHub > Settings > Pages : Source = Deploy from a branch, `main`, `/ (root)` ; Custom domain = `ocaz.re` ; Enforce HTTPS.
  Le domaine doit d'abord être retiré des réglages Pages du dépôt `ocaz` (un domaine ne peut servir qu'un dépôt).
- Supabase > Authentication > URL Configuration : Site URL = `https://ocaz.re`, Redirect URLs `https://ocaz.re/**`.
Les données gardées dans le navigateur dépendent de l'adresse : en changeant d'adresse, il faut se reconnecter une fois.

## Base Supabase

- Projet `CRMZX`. L'adresse et la clé publique sont dans `config.js` (clé publique, faite pour être visible).
- `supabase.sql` crée ou met à jour toute la base et peut être relancé sans risque (SQL Editor > Run).
- Toutes les données d'un garage sont dans sa ligne JSON de `crm_entreprises`, protégée par les règles d'accès (RLS).
  Quand deux appareils modifient en même temps, la synchronisation fusionne fiche par fiche (`sync.js`).

## Recherche par plaque (fonction Supabase `plaque`)

- `supabase/functions/plaque/index.ts` interroge le fournisseur (immatriculationapi.com conseillé, 0,20 € la recherche ;
  ou une API plaque RapidAPI). La clé est un **secret Supabase**, jamais dans l'appli ni dans ce dépôt.
- Secrets : `PLAQUE_UTILISATEUR` (immatriculationapi.com) ou `PLAQUE_RAPIDAPI_CLE` (+ `PLAQUE_RAPIDAPI_HOST`),
  et `PLAQUE_LIMITE_MOIS` (30 recherches payantes par garage et par mois par défaut).
- Une plaque déjà cherchée (par n'importe quel garage, moins de 180 jours) est resservie gratuitement depuis `crm_plaque_cache`.
- Compte démo : seulement les plaques déjà en cache. Tables et compteur : fin de `supabase.sql`.
- Installation : Supabase > Edge Functions > Deploy a new function > Via Editor, nom `plaque`, coller `index.ts`,
  décocher « Verify JWT » (la fonction vérifie elle-même le compte connecté).
