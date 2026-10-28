-- À coller dans Supabase > SQL Editor > New query. AVANT « Run », remplace TON_EMAIL_ICI (plus bas,
-- section Super-admin) par l'email de ton compte. Peut être relancé sans risque.
-- Chaque garage inscrit a sa propre entreprise : ses données, ses photos et ses documents
-- ne sont visibles que par les comptes de cette entreprise (règles RLS vérifiées par la base).
-- Pas d'inscription libre : le super-admin (Anthony) crée chaque garage depuis l'appli, avec un mot de passe
-- de départ (12345678) que le garage change à sa première connexion. Aucun email n'est envoyé.
-- Le super-admin est désigné par son email dans ce script (jamais le compte démo).

-- Nettoyage des tables de la version précédente (aucune donnée réelle n'y avait encore été mise).
drop table if exists public.crm_garage;
drop table if exists public.crm_data;
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'crm_membres')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_membres' and column_name = 'entreprise_id') then
    drop table public.crm_membres;
  end if;
end $$;

-- Entreprises : une ligne par garage, avec toutes ses données du CRM en JSON.
create table if not exists public.crm_entreprises (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at text not null default '',
  cree_le timestamptz not null default now()
);

-- Comptes : chaque email appartient à une seule entreprise, avec un rôle.
create table if not exists public.crm_membres (
  email text primary key,
  entreprise_id uuid not null references public.crm_entreprises (id) on delete cascade,
  role text not null default 'vendeur' check (role in ('admin', 'vendeur')),
  doit_changer_mdp boolean not null default false,
  ajoute_le timestamptz not null default now()
);
alter table public.crm_membres add column if not exists doit_changer_mdp boolean not null default false;
alter table public.crm_entreprises add column if not exists demo boolean not null default false;
-- Réglages posés par l'administrateur pour chaque revendeur (infos légales, droits, packs) : le revendeur les lit,
-- il ne peut pas les modifier (voir les droits de modification plus bas).
alter table public.crm_entreprises add column if not exists config jsonb not null default '{}'::jsonb;

-- Super-admin : crée les comptes des garages clients.
create table if not exists public.crm_superadmins (email text primary key);
alter table public.crm_superadmins enable row level security;
-- ⬇️ Remplace TON_EMAIL_ICI par l'email de ton compte (garde les apostrophes).
insert into public.crm_superadmins (email)
  select lower(trim(x)) from (values ('anthony.lamer@hotmail.fr')) v (x) where x like '%@%'
  on conflict do nothing;
delete from public.crm_superadmins where email like '%@demo.crmzx.re';

-- Ton compte créé avant cette version n'a plus besoin de confirmer son email.
update auth.users set email_confirmed_at = now()
  where email_confirmed_at is null and lower(email) in (select email from public.crm_superadmins);

-- Entreprise et rôle du compte connecté (null s'il n'appartient à aucune entreprise).
create or replace function public.crm_entreprise() returns uuid
language sql stable security definer set search_path = public as $$
  select entreprise_id from public.crm_membres where email = lower(auth.jwt() ->> 'email');
$$;
create or replace function public.crm_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.crm_membres where email = lower(auth.jwt() ->> 'email');
$$;

-- Crée un compte de connexion (email + mot de passe) sans envoyer d'email. Réservée aux fonctions ci-dessous.
create or replace function public.crm__utilisateur(p_email text, p_mdp text) returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is not null then return uid; end if;
  uid := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', lower(p_email),
    extensions.crypt(p_mdp, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
    jsonb_build_object('sub', uid::text, 'email', lower(p_email), 'email_verified', true), 'email', now(), now(), now());
  return uid;
end $$;
revoke execute on function public.crm__utilisateur(text, text) from public, anon, authenticated;

create or replace function public.crm_est_superadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select lower(auth.jwt() ->> 'email') not like '%@demo.crmzx.re'
    and exists (select 1 from public.crm_superadmins where lower(trim(email)) = lower(auth.jwt() ->> 'email'));
$$;

-- Appelée par l'appli à la connexion : renvoie le rôle, l'entreprise, et s'il faut changer le mot de passe.
-- Le super-admin reçoit sa propre entreprise à sa première connexion.
-- (l'ancienne version renvoyait du texte : on la retire avant de la recréer)
drop function if exists public.crm_moi();
create or replace function public.crm_moi() returns json
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(auth.jwt() ->> 'email');
  m public.crm_membres%rowtype;
  eid uuid;
  ap boolean := false;
begin
  if auth.uid() is null then return null; end if;
  select * into m from public.crm_membres where lower(email) = e;
  if m.email is null and public.crm_est_superadmin() then
    insert into public.crm_entreprises (nom)
      values (coalesce(nullif(trim(auth.jwt() -> 'user_metadata' ->> 'entreprise'), ''), 'Mon garage')) returning id into eid;
    insert into public.crm_membres (email, entreprise_id, role) values (e, eid, 'admin') returning * into m;
  end if;
  -- Le compte est-il aussi apporteur d'affaires ? (table créée plus bas, dans la partie « Réseau Ocaz »)
  if to_regclass('public.crm_apporteurs') is not null then
    execute 'select exists (select 1 from public.crm_apporteurs where email = $1)' into ap using e;
  end if;
  if m.email is null then
    -- Apporteur d'affaires seul : l'appli ouvre son espace (apporteur.html).
    if ap then return json_build_object('apporteur', true); end if;
    return null;
  end if;
  return json_build_object('role', m.role, 'apporteur', ap, 'entreprise_id', m.entreprise_id, 'doit_changer_mdp', m.doit_changer_mdp,
    'superadmin', public.crm_est_superadmin(),
    'nom', (select nom from public.crm_entreprises where id = m.entreprise_id),
    'demo', (select demo from public.crm_entreprises where id = m.entreprise_id),
    'config', (select config from public.crm_entreprises where id = m.entreprise_id));
end $$;

drop function if exists public.crm_compte_existe(text);

-- Après le changement de mot de passe.
create or replace function public.crm_mdp_change() returns void
language sql security definer set search_path = public as $$
  update public.crm_membres set doit_changer_mdp = false where email = lower(auth.jwt() ->> 'email');
$$;

-- Super-admin : crée un garage client (entreprise + compte admin, mot de passe 12345678).
create or replace function public.crm_creer_garage(p_nom text, p_email text) returns json
language plpgsql security definer set search_path = public as $$
declare eid uuid; e text := lower(trim(p_email));
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé au super-admin'; end if;
  if coalesce(trim(p_nom), '') = '' or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Nom ou email invalide'; end if;
  if exists (select 1 from public.crm_membres where email = e) then raise exception 'Cet email a déjà un compte'; end if;
  perform public.crm__utilisateur(e, '12345678');
  insert into public.crm_entreprises (nom) values (trim(p_nom)) returning id into eid;
  insert into public.crm_membres (email, entreprise_id, role, doit_changer_mdp) values (e, eid, 'admin', true);
  return json_build_object('entreprise_id', eid, 'email', e);
end $$;

-- Super-admin : liste des garages clients (nom et comptes seulement, jamais leurs données).
create or replace function public.crm_garages() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé au super-admin'; end if;
  return coalesce((select json_agg(g order by g.cree_le desc) from (
    select en.id, en.nom, en.demo, en.cree_le,
      (select json_agg(json_build_object('email', mb.email, 'role', mb.role, 'doit_changer_mdp', mb.doit_changer_mdp) order by mb.ajoute_le)
         from public.crm_membres mb where mb.entreprise_id = en.id) as comptes
    from public.crm_entreprises en) g), '[]'::json);
end $$;

-- Admin d'un garage : ajoute un collègue (compte créé avec le mot de passe 12345678).
create or replace function public.crm_ajouter_membre(p_email text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if public.crm_role() <> 'admin' then raise exception 'Réservé à l''admin du garage'; end if;
  if (select demo from public.crm_entreprises where id = public.crm_entreprise()) then raise exception 'Indisponible en démo'; end if;
  if p_role not in ('admin', 'vendeur') or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email invalide'; end if;
  if exists (select 1 from public.crm_membres where email = e) then raise exception 'Cet email a déjà un compte'; end if;
  perform public.crm__utilisateur(e, '12345678');
  insert into public.crm_membres (email, entreprise_id, role, doit_changer_mdp) values (e, public.crm_entreprise(), p_role, true);
end $$;

-- Remet le mot de passe d'un compte à 12345678 (super-admin, ou admin pour son équipe).
create or replace function public.crm_reinit_mdp(p_email text) returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
declare e text := lower(trim(p_email));
begin
  if not (public.crm_est_superadmin()
          or (public.crm_role() = 'admin' and exists (select 1 from public.crm_membres where email = e and entreprise_id = public.crm_entreprise()))) then
    raise exception 'Non autorisé';
  end if;
  update auth.users set encrypted_password = extensions.crypt('12345678', extensions.gen_salt('bf')), updated_at = now() where lower(email) = e;
  update public.crm_membres set doit_changer_mdp = true where email = e;
end $$;

revoke execute on function public.crm_creer_garage(text, text), public.crm_garages(), public.crm_ajouter_membre(text, text),
  public.crm_reinit_mdp(text), public.crm_moi(), public.crm_mdp_change() from public, anon;

-- Compte démo : identifiant « revendeur », mot de passe « test » (garage fictif, données d'exemple ajoutées par l'appli).
-- Il s'appelait « test » avant le 27/10/2026 : on le renomme. Ce n'est plus un compte admin.
do $$
declare eid uuid;
begin
  if exists (select 1 from auth.users where lower(email) = 'test@demo.crmzx.re')
     and not exists (select 1 from auth.users where lower(email) = 'revendeur@demo.crmzx.re') then
    update auth.users set email = 'revendeur@demo.crmzx.re', updated_at = now() where lower(email) = 'test@demo.crmzx.re';
    update auth.identities set identity_data = identity_data || '{"email": "revendeur@demo.crmzx.re"}'::jsonb
      where provider = 'email' and lower(identity_data ->> 'email') = 'test@demo.crmzx.re';
  end if;
  if not exists (select 1 from public.crm_membres where email = 'revendeur@demo.crmzx.re') then
    update public.crm_membres set email = 'revendeur@demo.crmzx.re' where email = 'test@demo.crmzx.re';
  end if;
  perform public.crm__utilisateur('revendeur@demo.crmzx.re', 'test');
  if not exists (select 1 from public.crm_membres where email = 'revendeur@demo.crmzx.re') then
    insert into public.crm_entreprises (nom, demo) values ('Garage Démo', true) returning id into eid;
    insert into public.crm_membres (email, entreprise_id, role) values ('revendeur@demo.crmzx.re', eid, 'vendeur');
  end if;
  update public.crm_membres set role = 'vendeur', doit_changer_mdp = false where email = 'revendeur@demo.crmzx.re';
  -- La démo a tous les droits, pour tout montrer.
  update public.crm_entreprises set config = jsonb_build_object(
      'infos', jsonb_build_object('nom', 'Garage Démo', 'adresse', '12 rue du Port', 'codePostal', '97420', 'ville', 'Le Port',
        'telephone', '0262 00 00 00', 'email', 'demo@ocaz.re', 'siret', '12345678900011'),
      'droits', jsonb_build_object('reseau', true, 'depot', true, 'achat', true),
      'reseau', jsonb_build_object('commissionType', 'fixe', 'commissionValeur', 300, 'commissionMin', 0))
    where demo and config = '{}'::jsonb;
end $$;

alter table public.crm_entreprises enable row level security;
alter table public.crm_membres enable row level security;

-- Une entreprise ne voit et ne modifie que sa propre ligne. Création uniquement via les fonctions.
drop policy if exists "Entreprise : lecture" on public.crm_entreprises;
create policy "Entreprise : lecture" on public.crm_entreprises for select to authenticated
  using (id = public.crm_entreprise());
drop policy if exists "Entreprise : modification" on public.crm_entreprises;
create policy "Entreprise : modification" on public.crm_entreprises for update to authenticated
  using (id = public.crm_entreprise()) with check (id = public.crm_entreprise());
-- Le revendeur ne modifie que ses données de travail : le nom, les droits et les infos légales viennent de l'administrateur.
revoke update on public.crm_entreprises from anon, authenticated;
grant update (data, updated_at) on public.crm_entreprises to authenticated;

-- L'équipe voit ses collègues ; seul l'admin retire, et seulement dans sa propre entreprise.
drop policy if exists "Membres : lecture" on public.crm_membres;
create policy "Membres : lecture" on public.crm_membres for select to authenticated
  using (entreprise_id = public.crm_entreprise());
-- Ajouts et changements de rôle passent par les fonctions ci-dessus (création du compte de connexion).
drop policy if exists "Membres : ajout par l'admin" on public.crm_membres;
drop policy if exists "Membres : modification par l'admin" on public.crm_membres;
drop policy if exists "Membres : retrait par l'admin" on public.crm_membres;
create policy "Membres : retrait par l'admin" on public.crm_membres for delete to authenticated
  using (public.crm_role() = 'admin' and entreprise_id = public.crm_entreprise() and email <> lower(auth.jwt() ->> 'email'));

-- Mise à jour en direct entre le téléphone et l'ordinateur.
do $$ begin
  alter publication supabase_realtime add table public.crm_entreprises;
exception when duplicate_object then null; end $$;

-- Fichiers privés : photos des véhicules et documents (RIB…). Chaque fichier est rangé dans
-- un dossier au nom de l'entreprise, et seule cette entreprise peut y accéder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "Photos : équipe" on storage.objects;
drop policy if exists "Fichiers : entreprise" on storage.objects;
create policy "Fichiers : entreprise" on storage.objects for all to authenticated
  using (bucket_id in ('photos', 'documents') and (storage.foldername(name))[1] = public.crm_entreprise()::text)
  with check (bucket_id in ('photos', 'documents') and (storage.foldername(name))[1] = public.crm_entreprise()::text);

-- Vitrine en ligne : une page publique par garage, avec ses véhicules disponibles (copie publiée par l'appli,
-- sans prix d'achat ni données clients). Les visiteurs ne lisent que cette copie, par une fonction.
create table if not exists public.crm_vitrine (
  entreprise_id uuid primary key references public.crm_entreprises (id) on delete cascade,
  slug text unique not null,
  actif boolean not null default true,
  data jsonb not null default '{}'::jsonb,
  photos text[] not null default '{}',
  maj_le timestamptz not null default now()
);
alter table public.crm_vitrine enable row level security;
drop policy if exists "Vitrine : équipe" on public.crm_vitrine;
create policy "Vitrine : équipe" on public.crm_vitrine for select to authenticated
  using (entreprise_id = public.crm_entreprise());

create or replace function public.crm_vitrine_publier(p_slug text, p_actif boolean, p_data jsonb, p_photos text[]) returns json
language plpgsql security definer set search_path = public as $$
declare eid uuid := public.crm_entreprise(); s text := lower(trim(p_slug));
begin
  if eid is null then raise exception 'Compte non rattaché à un garage'; end if;
  if s !~ '^[a-z0-9][a-z0-9-]{2,39}$' then raise exception 'Adresse invalide : 3 à 40 lettres, chiffres ou tirets'; end if;
  if exists (select 1 from public.crm_vitrine where slug = s and entreprise_id <> eid) then raise exception 'Cette adresse est déjà prise par un autre garage'; end if;
  insert into public.crm_vitrine (entreprise_id, slug, actif, data, photos, maj_le)
  values (eid, s, p_actif, p_data,
    (select coalesce(array_agg(x), '{}') from unnest(p_photos) x where x like eid::text || '/%'), now())
  on conflict (entreprise_id) do update set slug = excluded.slug, actif = excluded.actif, data = excluded.data, photos = excluded.photos, maj_le = now();
  return json_build_object('slug', s);
end $$;

create or replace function public.crm_vitrine_lire(p_slug text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('data', data, 'maj_le', maj_le) from public.crm_vitrine where slug = lower(trim(p_slug)) and actif;
$$;
grant execute on function public.crm_vitrine_lire(text) to anon, authenticated;

-- Les photos des véhicules publiés sont lisibles par les visiteurs de la vitrine (et seulement celles-là).
create or replace function public.crm_photo_publique(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.crm_vitrine where actif and p_name = any (photos));
$$;
grant execute on function public.crm_photo_publique(text) to anon, authenticated;
drop policy if exists "Photos : vitrine" on storage.objects;
create policy "Photos : vitrine" on storage.objects for select to anon
  using (bucket_id = 'photos' and public.crm_photo_publique(name));

-- Demandes envoyées depuis la vitrine : arrivent dans l'appli du garage (en direct).
create table if not exists public.crm_demandes (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references public.crm_entreprises (id) on delete cascade,
  cree_le timestamptz not null default now(),
  nom text not null,
  telephone text not null default '',
  email text not null default '',
  message text not null default '',
  vehicule_id text not null default '',
  vehicule text not null default '',
  traite boolean not null default false
);
alter table public.crm_demandes enable row level security;
drop policy if exists "Demandes : équipe" on public.crm_demandes;
create policy "Demandes : équipe" on public.crm_demandes for all to authenticated
  using (entreprise_id = public.crm_entreprise()) with check (entreprise_id = public.crm_entreprise());

create or replace function public.crm_vitrine_demande(p_slug text, p_nom text, p_tel text, p_email text, p_message text, p_vid text, p_vehicule text)
returns boolean language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  select entreprise_id into eid from public.crm_vitrine where slug = lower(trim(p_slug)) and actif;
  if eid is null then raise exception 'Vitrine introuvable'; end if;
  if length(trim(coalesce(p_nom, ''))) not between 1 and 80 or length(coalesce(p_tel, '')) > 30 or length(coalesce(p_email, '')) > 120
     or length(coalesce(p_message, '')) > 1000 or (trim(coalesce(p_tel, '')) = '' and trim(coalesce(p_email, '')) = '') then
    raise exception 'Demande incomplète';
  end if;
  -- Garde-fou contre les envois en rafale.
  if (select count(*) from public.crm_demandes where entreprise_id = eid and cree_le > now() - interval '1 hour') >= 30 then
    raise exception 'Trop de demandes, réessayez plus tard';
  end if;
  insert into public.crm_demandes (entreprise_id, nom, telephone, email, message, vehicule_id, vehicule)
  values (eid, trim(p_nom), trim(coalesce(p_tel, '')), trim(coalesce(p_email, '')), trim(coalesce(p_message, '')), coalesce(p_vid, ''), left(coalesce(p_vehicule, ''), 160));
  return true;
end $$;
grant execute on function public.crm_vitrine_demande(text, text, text, text, text, text, text) to anon, authenticated;
revoke execute on function public.crm_vitrine_publier(text, boolean, jsonb, text[]) from public, anon;
grant execute on function public.crm_vitrine_publier(text, boolean, jsonb, text[]) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.crm_demandes;
exception when duplicate_object then null; end $$;

-- =====================================================================================================
-- Réseau Ocaz : véhicules partagés par les garages, apporteurs d'affaires (accès gratuit) et leads.
-- Chaque garage choisit les véhicules qu'il partage et le montant de la commission. Un apporteur inscrit
-- (statut d'apporteur d'affaires, contrat signé en ligne) transmet un client intéressé : le lead arrive
-- dans l'appli du garage, qui verse lui-même la commission à l'apporteur après la vente. Ocaz calcule
-- la commission et prépare la facture de l'apporteur, aucun argent ne passe par Ocaz.
-- =====================================================================================================

-- Copie publiée par l'appli de chaque garage : infos publiques du garage et véhicules partagés (avec commission).
create table if not exists public.crm_reseau (
  entreprise_id uuid primary key references public.crm_entreprises (id) on delete cascade,
  actif boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  photos text[] not null default '{}',
  maj_le timestamptz not null default now()
);
alter table public.crm_reseau enable row level security;
drop policy if exists "Réseau : équipe" on public.crm_reseau;
create policy "Réseau : équipe" on public.crm_reseau for select to authenticated
  using (entreprise_id = public.crm_entreprise());

create or replace function public.crm_reseau_publier(p_actif boolean, p_data jsonb, p_photos text[]) returns boolean
language plpgsql security definer set search_path = public as $$
declare eid uuid := public.crm_entreprise();
begin
  if eid is null then raise exception 'Compte non rattaché à un garage'; end if;
  insert into public.crm_reseau (entreprise_id, actif, data, photos, maj_le)
  values (eid, p_actif, coalesce(p_data, '{}'::jsonb),
    (select coalesce(array_agg(x), '{}') from unnest(coalesce(p_photos, '{}')) x where x like eid::text || '/%'), now())
  on conflict (entreprise_id) do update set actif = excluded.actif, data = excluded.data, photos = excluded.photos, maj_le = now();
  return true;
end $$;
revoke execute on function public.crm_reseau_publier(boolean, jsonb, text[]) from public, anon;
grant execute on function public.crm_reseau_publier(boolean, jsonb, text[]) to authenticated;

-- Site public du réseau : tous les garages actifs (sauf la démo), sans la commission.
create or replace function public.crm_reseau_lire() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('entreprise_id', r.entreprise_id, 'garage', r.data -> 'garage',
      'vehicules', (select coalesce(jsonb_agg(v - 'commission' - 'commissionTexte'), '[]'::jsonb) from jsonb_array_elements(coalesce(r.data -> 'vehicules', '[]'::jsonb)) v),
      'maj_le', r.maj_le) order by r.maj_le desc), '[]'::json)
  from public.crm_reseau r join public.crm_entreprises e on e.id = r.entreprise_id
  where r.actif and not e.demo;
$$;
grant execute on function public.crm_reseau_lire() to anon, authenticated;

-- Photos : celles des véhicules partagés au réseau sont lisibles comme celles de la vitrine.
create or replace function public.crm_photo_publique(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.crm_vitrine where actif and p_name = any (photos))
      or exists (select 1 from public.crm_reseau where actif and p_name = any (photos));
$$;
grant execute on function public.crm_photo_publique(text) to anon, authenticated;
drop policy if exists "Photos : vitrine" on storage.objects;
create policy "Photos : vitrine" on storage.objects for select to anon, authenticated
  using (bucket_id = 'photos' and public.crm_photo_publique(name));

-- Apporteurs d'affaires : inscription libre et gratuite, avec le contrat signé en ligne.
create table if not exists public.crm_apporteurs (
  email text primary key,
  statut text not null default 'actif' check (statut in ('actif', 'suspendu')),
  prenom text not null default '',
  nom text not null default '',
  telephone text not null default '',
  adresse text not null default '',
  code_postal text not null default '',
  ville text not null default '',
  forme text not null default 'micro' check (forme in ('micro', 'societe', 'en_cours')),
  raison_sociale text not null default '',
  siret text not null default '',
  tva text not null default '',
  iban text not null default '',
  bic text not null default '',
  titulaire text not null default '',
  contrat_version text not null default '',
  contrat_signe_le timestamptz,
  signature text not null default '',
  factures_seq integer not null default 0,
  demo boolean not null default false,
  cree_le timestamptz not null default now()
);
alter table public.crm_apporteurs enable row level security;
drop policy if exists "Apporteur : lecture" on public.crm_apporteurs;
create policy "Apporteur : lecture" on public.crm_apporteurs for select to authenticated
  using (email = lower(auth.jwt() ->> 'email'));

create or replace function public.crm_est_apporteur() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.crm_apporteurs where email = lower(auth.jwt() ->> 'email') and statut = 'actif');
$$;

-- Champs que l'apporteur peut remplir lui-même (inscription et Paramètres).
create or replace function public.crm__apporteur_champs(p jsonb) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'prenom', left(trim(p ->> 'prenom'), 60), 'nom', left(trim(p ->> 'nom'), 60), 'telephone', left(trim(p ->> 'telephone'), 30),
    'adresse', left(trim(p ->> 'adresse'), 160), 'code_postal', left(trim(p ->> 'code_postal'), 10), 'ville', left(trim(p ->> 'ville'), 60),
    'forme', case when p ->> 'forme' in ('micro', 'societe', 'en_cours') then p ->> 'forme' end,
    'raison_sociale', left(trim(p ->> 'raison_sociale'), 120), 'siret', left(regexp_replace(coalesce(p ->> 'siret', ''), '\s', '', 'g'), 14),
    'tva', left(trim(p ->> 'tva'), 20), 'iban', left(upper(regexp_replace(coalesce(p ->> 'iban', ''), '\s', '', 'g')), 34),
    'bic', left(upper(trim(p ->> 'bic')), 11), 'titulaire', left(trim(p ->> 'titulaire'), 80)));
$$;

-- Plus d'inscription libre (2026-10-27) : c'est l'administrateur qui crée chaque apporteur (fonctions en fin de script).
drop function if exists public.crm_apporteur_inscription(text, text, jsonb, text, text);
drop function if exists public.crm_apporteur_activer(jsonb, text, text);

-- Fiche de l'apporteur connecté (null s'il n'en est pas un).
create or replace function public.crm_apporteur_moi() returns json
language sql stable security definer set search_path = public as $$
  select row_to_json(a) from public.crm_apporteurs a where email = lower(auth.jwt() ->> 'email');
$$;
create or replace function public.crm_apporteur_maj(p_infos jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare e text := lower(auth.jwt() ->> 'email'); c jsonb := public.crm__apporteur_champs(coalesce(p_infos, '{}'::jsonb));
begin
  if not exists (select 1 from public.crm_apporteurs where email = e) then raise exception 'Compte apporteur introuvable'; end if;
  if c ->> 'forme' in ('micro', 'societe') and coalesce(c ->> 'siret', '') !~ '^\d{14}$' then raise exception 'Le SIRET doit faire 14 chiffres.'; end if;
  update public.crm_apporteurs set
    prenom = coalesce(nullif(c ->> 'prenom', ''), prenom), nom = coalesce(nullif(c ->> 'nom', ''), nom),
    telephone = coalesce(nullif(c ->> 'telephone', ''), telephone), adresse = coalesce(c ->> 'adresse', adresse),
    code_postal = coalesce(c ->> 'code_postal', code_postal), ville = coalesce(c ->> 'ville', ville), forme = coalesce(c ->> 'forme', forme),
    raison_sociale = coalesce(c ->> 'raison_sociale', raison_sociale), siret = coalesce(c ->> 'siret', siret), tva = coalesce(c ->> 'tva', tva),
    iban = coalesce(c ->> 'iban', iban), bic = coalesce(c ->> 'bic', bic), titulaire = coalesce(c ->> 'titulaire', titulaire)
  where email = e;
  return public.crm_apporteur_moi();
end $$;

-- Véhicules du réseau vus par un apporteur actif, avec la commission de chaque garage.
-- Un compte apporteur de démo ne voit que les garages de démo (et inversement).
create or replace function public.crm_reseau_apporteur() returns json
language plpgsql stable security definer set search_path = public as $$
declare d boolean;
begin
  if not public.crm_est_apporteur() then raise exception 'Réservé aux apporteurs du réseau'; end if;
  select demo into d from public.crm_apporteurs where email = lower(auth.jwt() ->> 'email');
  return coalesce((select json_agg(json_build_object('entreprise_id', r.entreprise_id, 'garage', r.data -> 'garage', 'vehicules', r.data -> 'vehicules',
      'maj_le', r.maj_le) order by r.maj_le desc)
    from public.crm_reseau r join public.crm_entreprises e on e.id = r.entreprise_id
    where r.actif and e.demo = d), '[]'::json);
end $$;

-- Leads : un client intéressé par un véhicule du réseau, transmis par un apporteur au garage.
-- Statuts : nouveau (envoyé), en_cours (pris en charge par le garage), vendu (terminé), perdu (clos sans vente).
create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  cree_le timestamptz not null default now(),
  apporteur_email text not null references public.crm_apporteurs (email) on delete cascade,
  entreprise_id uuid not null references public.crm_entreprises (id) on delete cascade,
  vehicule_id text not null,
  vehicule text not null default '',
  vehicule_prix numeric,
  commission numeric not null default 0,
  commission_texte text not null default '',
  client_prenom text not null default '',
  client_nom text not null,
  client_tel text not null,
  client_email text not null default '',
  message text not null default '',
  reprise jsonb,
  consentement boolean not null,
  consentement_le timestamptz not null default now(),
  statut text not null default 'nouveau' check (statut in ('nouveau', 'en_cours', 'vendu', 'perdu')),
  statut_le timestamptz not null default now(),
  pris_le timestamptz,
  motif text not null default '',
  note_garage text not null default '',
  client_id text not null default '',
  prix_vente numeric,
  commission_finale numeric,
  vendu_le date,
  facture_numero text not null default '',
  payee boolean not null default false,
  payee_le date
);
alter table public.crm_leads enable row level security;
drop policy if exists "Leads : apporteur et garage" on public.crm_leads;
create policy "Leads : apporteur et garage" on public.crm_leads for select to authenticated
  using (apporteur_email = lower(auth.jwt() ->> 'email') or entreprise_id = public.crm_entreprise());
do $$ begin
  alter publication supabase_realtime add table public.crm_leads;
exception when duplicate_object then null; end $$;

-- L'apporteur crée un lead : véhicule, prix et commission sont repris de la copie publiée par le garage.
create or replace function public.crm_lead_creer(p_garage uuid, p_vid text, p_prenom text, p_nom text, p_tel text, p_email text,
  p_message text, p_reprise jsonb, p_consentement boolean) returns json
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(auth.jwt() ->> 'email');
  a public.crm_apporteurs%rowtype;
  v jsonb;
  l public.crm_leads%rowtype;
begin
  select * into a from public.crm_apporteurs where email = e;
  if a.email is null or a.statut <> 'actif' then raise exception 'Ton compte apporteur n''est pas actif.'; end if;
  if not coalesce(p_consentement, false) then raise exception 'Le client doit accepter que tu transmettes ses coordonnées.'; end if;
  if length(trim(coalesce(p_nom, ''))) not between 1 and 80 or length(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g')) not between 6 and 15
     or length(coalesce(p_email, '')) > 120 or length(coalesce(p_message, '')) > 1000 then
    raise exception 'Nom et téléphone du client obligatoires.';
  end if;
  select x into v from public.crm_reseau r join public.crm_entreprises en on en.id = r.entreprise_id,
    jsonb_array_elements(coalesce(r.data -> 'vehicules', '[]'::jsonb)) x
    where r.entreprise_id = p_garage and r.actif and en.demo = a.demo and x ->> 'id' = p_vid;
  if v is null then raise exception 'Ce véhicule n''est plus disponible dans le réseau.'; end if;
  if coalesce((v ->> 'reserve')::boolean, false) then raise exception 'Ce véhicule est déjà réservé.'; end if;
  if exists (select 1 from public.crm_leads where entreprise_id = p_garage and vehicule_id = p_vid and statut in ('nouveau', 'en_cours')
             and regexp_replace(client_tel, '\D', '', 'g') = regexp_replace(p_tel, '\D', '', 'g')) then
    raise exception 'Ce client a déjà un lead en cours pour ce véhicule.';
  end if;
  if (select count(*) from public.crm_leads where apporteur_email = e and cree_le > now() - interval '1 day') >= 30 then
    raise exception 'Limite de 30 leads par jour atteinte.';
  end if;
  insert into public.crm_leads (apporteur_email, entreprise_id, vehicule_id, vehicule, vehicule_prix, commission, commission_texte,
    client_prenom, client_nom, client_tel, client_email, message, reprise, consentement)
  values (e, p_garage, p_vid, left(concat_ws(' ', v ->> 'marque', v ->> 'modele', v ->> 'finition'), 160), nullif(v ->> 'prix', '')::numeric,
    coalesce(nullif(v ->> 'commission', '')::numeric, 0), coalesce(v ->> 'commissionTexte', ''),
    left(trim(coalesce(p_prenom, '')), 60), left(trim(p_nom), 80), left(trim(p_tel), 30), left(trim(coalesce(p_email, '')), 120),
    left(trim(coalesce(p_message, '')), 1000), case when p_reprise is null or p_reprise = '{}'::jsonb then null else p_reprise end, true)
  returning * into l;
  return row_to_json(l);
end $$;

-- Leads de l'apporteur connecté, avec les coordonnées du garage.
create or replace function public.crm_leads_apporteur() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('lead', l, 'garage', coalesce(r.data -> 'garage', jsonb_build_object('nom', en.nom)),
      'garage_facture', en.data -> 'parametres' -> 'garage') order by l.cree_le desc), '[]'::json)
  from public.crm_leads l join public.crm_entreprises en on en.id = l.entreprise_id
  left join public.crm_reseau r on r.entreprise_id = l.entreprise_id
  where l.apporteur_email = lower(auth.jwt() ->> 'email');
$$;

-- Leads reçus par le garage connecté, avec la fiche de l'apporteur (RIB seulement quand la vente est faite).
create or replace function public.crm_leads_garage() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('lead', l, 'apporteur', json_build_object(
      'prenom', a.prenom, 'nom', a.nom, 'telephone', a.telephone, 'email', a.email, 'forme', a.forme, 'raison_sociale', a.raison_sociale,
      'siret', a.siret, 'tva', a.tva, 'adresse', a.adresse, 'code_postal', a.code_postal, 'ville', a.ville,
      'iban', case when l.statut = 'vendu' then a.iban else '' end, 'bic', case when l.statut = 'vendu' then a.bic else '' end,
      'titulaire', case when l.statut = 'vendu' then a.titulaire else '' end)) order by l.cree_le desc), '[]'::json)
  from public.crm_leads l join public.crm_apporteurs a on a.email = l.apporteur_email
  where l.entreprise_id = public.crm_entreprise();
$$;

-- Le garage fait avancer un lead. Vente : commission finale (celle annoncée par défaut) et numéro de facture de l'apporteur.
create or replace function public.crm_lead_statut(p_id uuid, p_statut text, p_motif text default '', p_prix numeric default null,
  p_commission numeric default null, p_client_id text default null, p_note text default null) returns json
language plpgsql security definer set search_path = public as $$
declare l public.crm_leads%rowtype; n integer;
begin
  select * into l from public.crm_leads where id = p_id and entreprise_id = public.crm_entreprise() for update;
  if l.id is null then raise exception 'Lead introuvable'; end if;
  if p_statut not in ('nouveau', 'en_cours', 'vendu', 'perdu') then raise exception 'Statut invalide'; end if;
  if l.payee and p_statut <> 'vendu' then raise exception 'La commission est déjà versée : ce lead ne peut plus changer.'; end if;
  if p_statut = 'vendu' and l.facture_numero = '' then
    update public.crm_apporteurs set factures_seq = factures_seq + 1 where email = l.apporteur_email returning factures_seq into n;
    l.facture_numero := 'COM-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 4, '0');
  end if;
  update public.crm_leads set
    statut = p_statut, statut_le = case when statut <> p_statut then now() else statut_le end,
    pris_le = case when p_statut <> 'nouveau' then coalesce(pris_le, now()) else pris_le end,
    motif = case when p_statut = 'perdu' then left(coalesce(p_motif, ''), 200) else '' end,
    prix_vente = case when p_statut = 'vendu' then coalesce(p_prix, prix_vente, vehicule_prix) else null end,
    commission_finale = case when p_statut = 'vendu' then greatest(0, coalesce(p_commission, commission_finale, commission)) else null end,
    vendu_le = case when p_statut = 'vendu' then coalesce(vendu_le, current_date) else null end,
    facture_numero = l.facture_numero,
    client_id = coalesce(p_client_id, client_id), note_garage = coalesce(left(p_note, 500), note_garage)
  where id = p_id returning * into l;
  return row_to_json(l);
end $$;

-- Le garage indique qu'il a versé la commission à l'apporteur.
create or replace function public.crm_lead_payee(p_id uuid, p_payee boolean) returns json
language plpgsql security definer set search_path = public as $$
declare l public.crm_leads%rowtype;
begin
  update public.crm_leads set payee = p_payee, payee_le = case when p_payee then current_date else null end
    where id = p_id and entreprise_id = public.crm_entreprise() and statut = 'vendu' returning * into l;
  if l.id is null then raise exception 'Lead introuvable ou pas encore vendu'; end if;
  return row_to_json(l);
end $$;

-- Super-admin : liste des apporteurs, suspension ou réactivation.
create or replace function public.crm_apporteurs_liste() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé au super-admin'; end if;
  return coalesce((select json_agg(json_build_object('email', a.email, 'statut', a.statut, 'prenom', a.prenom, 'nom', a.nom, 'telephone', a.telephone,
      'ville', a.ville, 'forme', a.forme, 'siret', a.siret, 'cree_le', a.cree_le, 'demo', a.demo,
      'leads', (select count(*) from public.crm_leads l where l.apporteur_email = a.email),
      'ventes', (select count(*) from public.crm_leads l where l.apporteur_email = a.email and l.statut = 'vendu')) order by a.cree_le desc)
    from public.crm_apporteurs a), '[]'::json);
end $$;
create or replace function public.crm_apporteur_statut(p_email text, p_statut text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé au super-admin'; end if;
  if p_statut not in ('actif', 'suspendu') then raise exception 'Statut invalide'; end if;
  update public.crm_apporteurs set statut = p_statut where email = lower(trim(p_email));
end $$;

revoke execute on function public.crm_apporteur_moi(), public.crm_apporteur_maj(jsonb), public.crm_reseau_apporteur(),
  public.crm_lead_creer(uuid, text, text, text, text, text, text, jsonb, boolean), public.crm_leads_apporteur(), public.crm_leads_garage(),
  public.crm_lead_statut(uuid, text, text, numeric, numeric, text, text), public.crm_lead_payee(uuid, boolean),
  public.crm_apporteurs_liste(), public.crm_apporteur_statut(text, text) from public, anon;
grant execute on function public.crm_apporteur_moi(), public.crm_apporteur_maj(jsonb), public.crm_reseau_apporteur(),
  public.crm_lead_creer(uuid, text, text, text, text, text, text, jsonb, boolean), public.crm_leads_apporteur(), public.crm_leads_garage(),
  public.crm_lead_statut(uuid, text, text, numeric, numeric, text, text), public.crm_lead_payee(uuid, boolean),
  public.crm_apporteurs_liste(), public.crm_apporteur_statut(text, text) to authenticated;

-- Apporteur de démo : identifiant « apporteur », mot de passe « test ». Il ne voit que le garage de démo.
do $$ begin
  perform public.crm__utilisateur('apporteur@demo.crmzx.re', 'test');
  insert into public.crm_apporteurs (email, prenom, nom, telephone, adresse, code_postal, ville, forme, siret, iban, bic, titulaire, contrat_version, contrat_signe_le, signature, demo)
  values ('apporteur@demo.crmzx.re', 'Alex', 'Démo', '0692 00 00 00', '1 rue de Paris', '97400', 'Saint-Denis', 'micro', '12345678900011', 'FR7630004000031234567890143', 'BNPAFRPPXXX',
    'Alex Démo', '2026-10', now(), 'Alex Démo', true)
  on conflict (email) do nothing;
end $$;

-- Site du réseau : demandes des visiteurs (reseau.html). Les véhicules partagés sont dans crm_reseau (section « Réseau Ocaz »).
-- La demande arrive dans l'appli du garage propriétaire du véhicule, comme celles de sa vitrine.
-- D'où vient la demande : vitrine du garage ou site du réseau.
alter table public.crm_demandes add column if not exists origine text not null default 'vitrine';

create or replace function public.crm_reseau_demande(p_garage uuid, p_nom text, p_tel text, p_email text, p_message text, p_vid text, p_vehicule text, p_accord boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.crm_reseau r join public.crm_entreprises e on e.id = r.entreprise_id
      where r.entreprise_id = p_garage and r.actif and not e.demo) then
    raise exception 'Garage introuvable';
  end if;
  if coalesce(p_vid, '') <> '' and not exists (select 1 from public.crm_reseau r, jsonb_array_elements(r.data -> 'vehicules') v
      where r.entreprise_id = p_garage and v ->> 'id' = p_vid) then
    raise exception 'Véhicule introuvable';
  end if;
  -- Le visiteur accepte que ses coordonnées soient transmises au garage (RGPD).
  if not coalesce(p_accord, false) then raise exception 'Accord du visiteur manquant'; end if;
  if length(trim(coalesce(p_nom, ''))) not between 1 and 80 or length(coalesce(p_tel, '')) > 30 or length(coalesce(p_email, '')) > 120
     or length(coalesce(p_message, '')) > 1000 or (trim(coalesce(p_tel, '')) = '' and trim(coalesce(p_email, '')) = '') then
    raise exception 'Demande incomplète';
  end if;
  if (select count(*) from public.crm_demandes where entreprise_id = p_garage and cree_le > now() - interval '1 hour') >= 30 then
    raise exception 'Trop de demandes, réessayez plus tard';
  end if;
  insert into public.crm_demandes (entreprise_id, nom, telephone, email, message, vehicule_id, vehicule, origine)
  values (p_garage, trim(p_nom), trim(coalesce(p_tel, '')), trim(coalesce(p_email, '')), trim(coalesce(p_message, '')), coalesce(p_vid, ''), left(coalesce(p_vehicule, ''), 160), 'reseau');
  return true;
end $$;
grant execute on function public.crm_reseau_demande(uuid, text, text, text, text, text, text, boolean) to anon, authenticated;

-- Aperçu du site du réseau avec le garage de démonstration (reseau.html?demo=1) : réservé à ce lien,
-- les visiteurs du site normal ne voient jamais la démo. Mêmes infos que crm_reseau_lire().
create or replace function public.crm_reseau_demo() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('entreprise_id', r.entreprise_id, 'garage', r.data -> 'garage',
      'vehicules', (select coalesce(jsonb_agg(v - 'commission' - 'commissionTexte'), '[]'::jsonb) from jsonb_array_elements(coalesce(r.data -> 'vehicules', '[]'::jsonb)) v),
      'maj_le', r.maj_le) order by r.maj_le desc), '[]'::json)
  from public.crm_reseau r join public.crm_entreprises e on e.id = r.entreprise_id
  where r.actif and e.demo;
$$;
grant execute on function public.crm_reseau_demo() to anon, authenticated;

-- ===== Recherche par plaque (fonction Supabase « plaque ») =====
-- La clé du fournisseur reste dans les secrets Supabase : l'appli appelle la fonction, jamais le fournisseur.
-- Résultats gardés 180 jours : rechercher deux fois la même plaque ne coûte qu'une fois.
create table if not exists public.crm_plaque_cache (
  plaque text primary key,
  data jsonb not null,
  cree_le timestamptz not null default now()
);
-- Nombre de recherches payantes par garage et par mois.
create table if not exists public.crm_plaque_compteur (
  entreprise_id uuid not null references public.crm_entreprises (id) on delete cascade,
  mois text not null,
  nb integer not null default 0,
  primary key (entreprise_id, mois)
);
alter table public.crm_plaque_cache enable row level security;
alter table public.crm_plaque_compteur enable row level security;
drop policy if exists "Plaque : compteur du garage" on public.crm_plaque_compteur;
create policy "Plaque : compteur du garage" on public.crm_plaque_compteur for select to authenticated
  using (entreprise_id = public.crm_entreprise());

-- Réserve une recherche pour le garage si sa limite du mois n'est pas atteinte. Réservée à la fonction Supabase.
create or replace function public.crm_plaque_reserver(p_entreprise uuid, p_limite integer) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.crm_plaque_compteur (entreprise_id, mois, nb) values (p_entreprise, to_char(now(), 'YYYY-MM'), 1)
  on conflict (entreprise_id, mois) do update set nb = crm_plaque_compteur.nb + 1
    where crm_plaque_compteur.nb < p_limite
  returning nb into n;
  return n; -- null : limite atteinte
end $$;
-- Rend la recherche si le fournisseur n'a pas répondu.
create or replace function public.crm_plaque_rendre(p_entreprise uuid) returns void
language sql security definer set search_path = public as $$
  update public.crm_plaque_compteur set nb = greatest(nb - 1, 0)
  where entreprise_id = p_entreprise and mois = to_char(now(), 'YYYY-MM');
$$;
revoke execute on function public.crm_plaque_reserver(uuid, integer), public.crm_plaque_rendre(uuid) from public, anon, authenticated;

-- =====================================================================================================
-- Comptes créés par l'administrateur (2026-10-27) : interface admin.html réservée au super-admin.
-- Revendeurs : infos légales, droits (réseau Ocaz, dépôt-vente, achat-revente) et packs livraison posés par l'admin.
-- Apporteurs : créés par l'admin avec le mot de passe de départ 12345678, ils signent leur contrat dans l'appli.
-- =====================================================================================================

-- Connexion par identifiant court (ex. « admin ») : l'appli demande l'email correspondant.
create table if not exists public.crm_identifiants (
  identifiant text primary key,
  email text not null
);
alter table public.crm_identifiants enable row level security;
create or replace function public.crm_identifiant(p_id text) returns text
language sql stable security definer set search_path = public as $$
  select email from public.crm_identifiants where identifiant = lower(trim(p_id));
$$;
grant execute on function public.crm_identifiant(text) to anon, authenticated;

-- Compte administrateur : identifiant « admin », mot de passe de départ « admin » (posé une seule fois,
-- relancer le script ne le remet pas). ⚠️ À changer avant le lancement (Paramètres > Compte).
do $$
declare neuf boolean;
begin
  perform public.crm__utilisateur('anthony.lamer@hotmail.fr', 'admin');
  insert into public.crm_identifiants (identifiant, email) values ('admin', 'anthony.lamer@hotmail.fr')
    on conflict (identifiant) do nothing returning true into neuf;
  if neuf then
    update auth.users set encrypted_password = extensions.crypt('admin', extensions.gen_salt('bf')), updated_at = now(),
      email_confirmed_at = coalesce(email_confirmed_at, now())
      where lower(email) = 'anthony.lamer@hotmail.fr';
    update public.crm_membres set doit_changer_mdp = false where email = 'anthony.lamer@hotmail.fr';
  end if;
end $$;

-- Super-admin : liste des revendeurs avec leurs réglages et leurs comptes (jamais leurs données).
create or replace function public.crm_admin_revendeurs() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  return coalesce((select json_agg(g order by g.demo, g.cree_le desc) from (
    select en.id, en.nom, en.demo, en.cree_le, en.config,
      exists (select 1 from public.crm_membres m join public.crm_superadmins s on s.email = m.email where m.entreprise_id = en.id) as admin,
      (select coalesce(json_agg(json_build_object('email', mb.email, 'role', mb.role, 'doit_changer_mdp', mb.doit_changer_mdp) order by mb.ajoute_le), '[]'::json)
         from public.crm_membres mb where mb.entreprise_id = en.id) as comptes
    from public.crm_entreprises en) g), '[]'::json);
end $$;

-- Super-admin : crée un revendeur (entreprise + compte, mot de passe 12345678) ou enregistre ses réglages.
-- Avec un id et un email nouveau : ajoute un compte de connexion à ce revendeur.
create or replace function public.crm_admin_revendeur_enregistrer(p_id uuid, p_email text, p_config jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  eid uuid := p_id;
  e text := lower(trim(coalesce(p_email, '')));
  n text := left(trim(coalesce(p_config -> 'infos' ->> 'nom', '')), 120);
  c jsonb := coalesce(p_config, '{}'::jsonb);
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  if n = '' then raise exception 'Le nom de l''entreprise est obligatoire.'; end if;
  if length(c::text) > 20000 then raise exception 'Réglages trop longs.'; end if;
  if e <> '' and e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email de connexion invalide.'; end if;
  if e <> '' and exists (select 1 from public.crm_membres where email = e) then raise exception 'Cet email a déjà un compte revendeur.'; end if;
  if eid is null then
    if e = '' then raise exception 'L''email de connexion est obligatoire.'; end if;
    insert into public.crm_entreprises (nom, config) values (n, c) returning id into eid;
  else
    update public.crm_entreprises set nom = n, config = c where id = eid;
    if not found then raise exception 'Revendeur introuvable.'; end if;
  end if;
  if e <> '' then
    perform public.crm__utilisateur(e, '12345678');
    insert into public.crm_membres (email, entreprise_id, role, doit_changer_mdp) values (e, eid, 'admin', true);
  end if;
  return json_build_object('id', eid);
end $$;

-- Super-admin : retire un compte de connexion d'un revendeur.
create or replace function public.crm_admin_compte_retirer(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  if lower(trim(p_email)) = lower(auth.jwt() ->> 'email') then raise exception 'Tu ne peux pas retirer ton propre compte.'; end if;
  delete from public.crm_membres where email = lower(trim(p_email));
end $$;

-- Apporteurs : mot de passe de départ à changer, contrat signé dans l'appli après la création par l'admin.
alter table public.crm_apporteurs add column if not exists doit_changer_mdp boolean not null default false;

create or replace function public.crm_admin_apporteur_enregistrer(p_email text, p_infos jsonb, p_nouveau boolean) returns json
language plpgsql security definer set search_path = public, auth as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  c jsonb := public.crm__apporteur_champs(coalesce(p_infos, '{}'::jsonb));
  existe boolean;
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  if coalesce(c ->> 'nom', '') = '' or coalesce(c ->> 'prenom', '') = '' then raise exception 'Prénom et nom obligatoires.'; end if;
  if coalesce(c ->> 'siret', '') <> '' and c ->> 'siret' !~ '^\d{14}$' then raise exception 'Le SIRET doit faire 14 chiffres.'; end if;
  if p_nouveau then
    if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or e like '%@demo.crmzx.re' then raise exception 'Email invalide.'; end if;
    if exists (select 1 from public.crm_apporteurs where email = e) then raise exception 'Cet apporteur existe déjà.'; end if;
    select exists (select 1 from auth.users where lower(email) = e) into existe;
    perform public.crm__utilisateur(e, '12345678');
    insert into public.crm_apporteurs (email, prenom, nom, telephone, adresse, code_postal, ville, forme, raison_sociale, siret, tva,
      iban, bic, titulaire, doit_changer_mdp)
    values (e, c ->> 'prenom', c ->> 'nom', coalesce(c ->> 'telephone', ''), coalesce(c ->> 'adresse', ''), coalesce(c ->> 'code_postal', ''),
      coalesce(c ->> 'ville', ''), coalesce(c ->> 'forme', 'micro'), coalesce(c ->> 'raison_sociale', ''), coalesce(c ->> 'siret', ''),
      coalesce(c ->> 'tva', ''), coalesce(c ->> 'iban', ''), coalesce(c ->> 'bic', ''), coalesce(c ->> 'titulaire', ''), not existe);
  else
    update public.crm_apporteurs set prenom = c ->> 'prenom', nom = c ->> 'nom', telephone = coalesce(c ->> 'telephone', ''),
      adresse = coalesce(c ->> 'adresse', ''), code_postal = coalesce(c ->> 'code_postal', ''), ville = coalesce(c ->> 'ville', ''),
      forme = coalesce(c ->> 'forme', forme), raison_sociale = coalesce(c ->> 'raison_sociale', ''), siret = coalesce(c ->> 'siret', ''),
      tva = coalesce(c ->> 'tva', ''), iban = coalesce(c ->> 'iban', ''), bic = coalesce(c ->> 'bic', ''), titulaire = coalesce(c ->> 'titulaire', '')
    where email = e;
    if not found then raise exception 'Apporteur introuvable.'; end if;
  end if;
  return (select row_to_json(a) from public.crm_apporteurs a where email = e);
end $$;

-- Super-admin : liste complète des apporteurs (pour les modifier).
create or replace function public.crm_apporteurs_liste() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé au super-admin'; end if;
  return coalesce((select json_agg((to_jsonb(a) || jsonb_build_object(
      'leads', (select count(*) from public.crm_leads l where l.apporteur_email = a.email),
      'ventes', (select count(*) from public.crm_leads l where l.apporteur_email = a.email and l.statut = 'vendu'))) order by a.demo, a.cree_le desc)
    from public.crm_apporteurs a), '[]'::json);
end $$;

-- L'apporteur ne modifie lui-même que son téléphone et son RIB (le reste passe par l'administrateur).
create or replace function public.crm_apporteur_maj(p_infos jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare e text := lower(auth.jwt() ->> 'email'); c jsonb := public.crm__apporteur_champs(coalesce(p_infos, '{}'::jsonb));
begin
  if not exists (select 1 from public.crm_apporteurs where email = e) then raise exception 'Compte apporteur introuvable'; end if;
  update public.crm_apporteurs set telephone = coalesce(nullif(c ->> 'telephone', ''), telephone),
    iban = coalesce(c ->> 'iban', iban), bic = coalesce(c ->> 'bic', bic), titulaire = coalesce(c ->> 'titulaire', titulaire)
  where email = e;
  return public.crm_apporteur_moi();
end $$;

-- L'apporteur signe son contrat en ligne (une seule fois).
create or replace function public.crm_apporteur_signer(p_contrat text, p_signature text) returns json
language plpgsql security definer set search_path = public as $$
declare e text := lower(auth.jwt() ->> 'email');
begin
  if coalesce(trim(p_signature), '') = '' or coalesce(p_contrat, '') = '' then raise exception 'Signe le contrat en tapant ton prénom et ton nom.'; end if;
  update public.crm_apporteurs set contrat_version = left(p_contrat, 20), contrat_signe_le = now(), signature = left(trim(p_signature), 120)
    where email = e and contrat_signe_le is null;
  return public.crm_apporteur_moi();
end $$;
create or replace function public.crm_apporteur_mdp_change() returns void
language sql security definer set search_path = public as $$
  update public.crm_apporteurs set doit_changer_mdp = false where email = lower(auth.jwt() ->> 'email');
$$;

-- Remet le mot de passe d'un compte à 12345678 (super-admin pour tous, admin de garage pour son équipe).
create or replace function public.crm_reinit_mdp(p_email text) returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
declare e text := lower(trim(p_email));
begin
  if not (public.crm_est_superadmin()
          or (public.crm_role() = 'admin' and exists (select 1 from public.crm_membres where email = e and entreprise_id = public.crm_entreprise()))) then
    raise exception 'Non autorisé';
  end if;
  update auth.users set encrypted_password = extensions.crypt('12345678', extensions.gen_salt('bf')), updated_at = now() where lower(email) = e;
  update public.crm_membres set doit_changer_mdp = true where email = e;
  update public.crm_apporteurs set doit_changer_mdp = true where email = e;
end $$;

-- Véhicules partenaires : ceux que les autres garages du réseau partagent (sans la commission des apporteurs).
-- La démo voit aussi ses propres véhicules, pour avoir quelque chose à montrer.
create or replace function public.crm_reseau_partenaires() returns json
language plpgsql stable security definer set search_path = public as $$
declare eid uuid := public.crm_entreprise(); d boolean;
begin
  if eid is null then raise exception 'Compte non rattaché à un garage'; end if;
  select demo into d from public.crm_entreprises where id = eid;
  return coalesce((select json_agg(json_build_object('entreprise_id', r.entreprise_id, 'garage', r.data -> 'garage',
      'vehicules', (select coalesce(jsonb_agg(v - 'commission' - 'commissionTexte'), '[]'::jsonb) from jsonb_array_elements(coalesce(r.data -> 'vehicules', '[]'::jsonb)) v),
      'maj_le', r.maj_le) order by r.maj_le desc)
    from public.crm_reseau r join public.crm_entreprises e on e.id = r.entreprise_id
    where r.actif and e.demo = d and (r.entreprise_id <> eid or d)), '[]'::json);
end $$;

revoke execute on function public.crm_admin_revendeurs(), public.crm_admin_revendeur_enregistrer(uuid, text, jsonb), public.crm_admin_compte_retirer(text),
  public.crm_admin_apporteur_enregistrer(text, jsonb, boolean), public.crm_apporteurs_liste(), public.crm_apporteur_maj(jsonb),
  public.crm_apporteur_signer(text, text), public.crm_apporteur_mdp_change(), public.crm_reinit_mdp(text), public.crm_reseau_partenaires() from public, anon;
grant execute on function public.crm_admin_revendeurs(), public.crm_admin_revendeur_enregistrer(uuid, text, jsonb), public.crm_admin_compte_retirer(text),
  public.crm_admin_apporteur_enregistrer(text, jsonb, boolean), public.crm_apporteurs_liste(), public.crm_apporteur_maj(jsonb),
  public.crm_apporteur_signer(text, text), public.crm_apporteur_mdp_change(), public.crm_reinit_mdp(text), public.crm_reseau_partenaires() to authenticated;

-- =====================================================================================================
-- Admin : prospection des garages, tableau de bord du réseau, leads de tous les garages, annonces.
-- Tout passe par des fonctions réservées au super-admin (les tables n'ont aucune règle de lecture directe).
-- =====================================================================================================

-- Prospection : les garages à signer et l'étape où en est chacun.
create table if not exists public.crm_prospects (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  ville text not null default '',
  telephone text not null default '',
  email text not null default '',
  contact text not null default '',
  lot text not null default '',
  etape text not null default 'a_contacter'
    check (etape in ('a_contacter', 'appele', 'demo_prevue', 'demo_faite', 'essai', 'signe', 'pas_interesse')),
  note text not null default '',
  relance date,
  entreprise_id uuid references public.crm_entreprises (id) on delete set null,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
alter table public.crm_prospects enable row level security;
-- Fiche d'entretien remplie pendant la visite (réponses aux questions du speech, par points).
alter table public.crm_prospects add column if not exists entretien jsonb not null default '{}'::jsonb;

create or replace function public.crm_admin_prospects() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  return coalesce((select json_agg(p order by p.relance nulls last, p.maj_le desc) from public.crm_prospects p), '[]'::json);
end $$;

-- Crée (sans id) ou met à jour (avec id) un prospect.
create or replace function public.crm_admin_prospect_enregistrer(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid := nullif(p ->> 'id', '')::uuid;
  n text := left(trim(coalesce(p ->> 'nom', '')), 120);
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  if n = '' then raise exception 'Le nom du garage est obligatoire.'; end if;
  if pid is null then
    insert into public.crm_prospects (nom) values (n) returning id into pid;
  end if;
  update public.crm_prospects set nom = n,
    ville = left(coalesce(p ->> 'ville', ''), 80), telephone = left(coalesce(p ->> 'telephone', ''), 40),
    email = left(coalesce(p ->> 'email', ''), 120), contact = left(coalesce(p ->> 'contact', ''), 120),
    lot = left(coalesce(p ->> 'lot', ''), 20), etape = coalesce(nullif(p ->> 'etape', ''), 'a_contacter'),
    note = left(coalesce(p ->> 'note', ''), 4000), relance = nullif(p ->> 'relance', '')::date,
    entreprise_id = nullif(p ->> 'entreprise_id', '')::uuid,
    entretien = case when jsonb_typeof(p -> 'entretien') = 'object' and length((p -> 'entretien')::text) <= 20000 then p -> 'entretien' else entretien end,
    maj_le = now()
  where id = pid;
  if not found then raise exception 'Prospect introuvable.'; end if;
  return pid;
end $$;

create or replace function public.crm_admin_prospect_supprimer(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  delete from public.crm_prospects where id = p_id;
end $$;

-- Import d'une liste (fichier CSV lu par l'appli) : les garages déjà présents (même nom) sont ignorés.
create or replace function public.crm_admin_prospects_importer(p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare x jsonb; n integer := 0; v_nom text;
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 1000 then raise exception 'Liste invalide.'; end if;
  for x in select * from jsonb_array_elements(p) loop
    v_nom := left(trim(coalesce(x ->> 'nom', '')), 120);
    continue when v_nom = '' or exists (select 1 from public.crm_prospects p where lower(p.nom) = lower(v_nom));
    insert into public.crm_prospects (nom, ville, telephone, email, lot, etape, note)
    values (v_nom, left(coalesce(x ->> 'ville', ''), 80), left(coalesce(x ->> 'telephone', ''), 40), left(coalesce(x ->> 'email', ''), 120),
      left(coalesce(x ->> 'lot', ''), 20),
      case when x ->> 'etape' in ('a_contacter', 'appele', 'demo_prevue', 'demo_faite', 'essai', 'signe', 'pas_interesse') then x ->> 'etape' else 'a_contacter' end,
      left(coalesce(x ->> 'note', ''), 4000));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Tableau de bord : l'activité de chaque garage (dernière connexion, stock, ventes et leads des 30 derniers jours).
create or replace function public.crm_admin_tableau() returns json
language plpgsql stable security definer set search_path = public as $$
declare depuis text := to_char(current_date - 30, 'YYYY-MM-DD');
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  return json_build_object(
    'garages', coalesce((select json_agg(g order by g.derniere_connexion desc nulls last) from (
      select en.id, en.nom, en.demo, en.config -> 'abonnement' ->> 'statut' as abonnement, nullif(en.updated_at, '') as maj_donnees,
        exists (select 1 from public.crm_membres m join public.crm_superadmins s on s.email = m.email where m.entreprise_id = en.id) as admin,
        (select max(u.last_sign_in_at) from public.crm_membres m join auth.users u on lower(u.email) = m.email where m.entreprise_id = en.id) as derniere_connexion,
        (select count(*) from jsonb_array_elements(coalesce(en.data -> 'vehicules', '[]'::jsonb)) v
          where v ->> 'statut' in ('En stock', 'En préparation', 'Réservé')) as stock,
        (select count(*) from jsonb_array_elements(coalesce(en.data -> 'vehicules', '[]'::jsonb)) v
          where v ->> 'statut' = 'Vendu' and coalesce(v ->> 'dateVente', '') >= depuis) as ventes_30j,
        (select count(*) from jsonb_array_elements(coalesce(en.data -> 'commandes', '[]'::jsonb)) o
          where coalesce(o ->> 'date', '') >= depuis) as offres_30j,
        coalesce((select case when r.actif then jsonb_array_length(coalesce(r.data -> 'vehicules', '[]'::jsonb)) else 0 end
          from public.crm_reseau r where r.entreprise_id = en.id), 0) as en_ligne,
        (select count(*) from public.crm_leads l where l.entreprise_id = en.id and l.cree_le > now() - interval '30 days') as leads_30j,
        (select count(*) from public.crm_leads l where l.entreprise_id = en.id and l.statut = 'nouveau') as leads_attente
      from public.crm_entreprises en) g), '[]'::json),
    'apporteurs', (select count(*) from public.crm_apporteurs where statut = 'actif' and not coalesce(demo, false)),
    'leads_30j', (select count(*) from public.crm_leads l join public.crm_entreprises en on en.id = l.entreprise_id where not en.demo and l.cree_le > now() - interval '30 days'),
    'ventes_reseau_30j', (select count(*) from public.crm_leads l join public.crm_entreprises en on en.id = l.entreprise_id where not en.demo and l.statut = 'vendu' and l.statut_le > now() - interval '30 days'));
end $$;

-- Leads réseau : les 500 derniers leads de tous les garages, sans les coordonnées du client.
create or replace function public.crm_admin_leads() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  return coalesce((select json_agg(x order by x.cree_le desc) from (
    select l.id, l.numero, l.cree_le, l.statut, l.statut_le, l.pris_le, l.vehicule, l.vehicule_prix, l.commission, l.commission_finale, l.payee,
      l.motif, en.nom as garage, en.demo, trim(coalesce(a.prenom, '') || ' ' || coalesce(a.nom, '')) as apporteur,
      trim(l.client_prenom || ' ' || left(l.client_nom, 1) || '.') as client
    from public.crm_leads l join public.crm_entreprises en on en.id = l.entreprise_id
      left join public.crm_apporteurs a on a.email = l.apporteur_email
    order by l.cree_le desc limit 500) x), '[]'::json);
end $$;

-- Annonces : un message de l'administrateur affiché en bandeau chez les revendeurs, les apporteurs, ou tous.
create table if not exists public.crm_annonces (
  id uuid primary key default gen_random_uuid(),
  titre text not null,
  texte text not null default '',
  cible text not null default 'tous' check (cible in ('tous', 'revendeurs', 'apporteurs')),
  actif boolean not null default true,
  fin date,
  cree_le timestamptz not null default now()
);
alter table public.crm_annonces enable row level security;

create or replace function public.crm_admin_annonces() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  return coalesce((select json_agg(a order by a.cree_le desc) from public.crm_annonces a), '[]'::json);
end $$;

create or replace function public.crm_admin_annonce_enregistrer(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare aid uuid := nullif(p ->> 'id', '')::uuid; t text := left(trim(coalesce(p ->> 'titre', '')), 140);
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  if t = '' then raise exception 'Le titre est obligatoire.'; end if;
  if aid is null then insert into public.crm_annonces (titre) values (t) returning id into aid; end if;
  update public.crm_annonces set titre = t, texte = left(coalesce(p ->> 'texte', ''), 2000),
    cible = coalesce(nullif(p ->> 'cible', ''), 'tous'), actif = coalesce((p ->> 'actif')::boolean, true), fin = nullif(p ->> 'fin', '')::date
  where id = aid;
  if not found then raise exception 'Annonce introuvable.'; end if;
  return aid;
end $$;

create or replace function public.crm_admin_annonce_supprimer(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  delete from public.crm_annonces where id = p_id;
end $$;

-- Annonces en cours pour le compte connecté (revendeur, apporteur ou les deux).
create or replace function public.crm_annonces_lire() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', a.id, 'titre', a.titre, 'texte', a.texte, 'cree_le', a.cree_le) order by a.cree_le desc), '[]'::json)
  from public.crm_annonces a
  where a.actif and (a.fin is null or a.fin >= current_date)
    and (a.cible = 'tous'
      or (a.cible = 'revendeurs' and public.crm_entreprise() is not null)
      or (a.cible = 'apporteurs' and exists (select 1 from public.crm_apporteurs where email = lower(auth.jwt() ->> 'email'))));
$$;

revoke execute on function public.crm_admin_prospects(), public.crm_admin_prospect_enregistrer(jsonb), public.crm_admin_prospect_supprimer(uuid),
  public.crm_admin_prospects_importer(jsonb), public.crm_admin_tableau(), public.crm_admin_leads(), public.crm_admin_annonces(),
  public.crm_admin_annonce_enregistrer(jsonb), public.crm_admin_annonce_supprimer(uuid), public.crm_annonces_lire() from public, anon;
grant execute on function public.crm_admin_prospects(), public.crm_admin_prospect_enregistrer(jsonb), public.crm_admin_prospect_supprimer(uuid),
  public.crm_admin_prospects_importer(jsonb), public.crm_admin_tableau(), public.crm_admin_leads(), public.crm_admin_annonces(),
  public.crm_admin_annonce_enregistrer(jsonb), public.crm_admin_annonce_supprimer(uuid), public.crm_annonces_lire() to authenticated;

-- Messagerie entre partenaires (2026-10-28) : les garages s'écrivent entre eux et avec les apporteurs d'affaires.
-- Un participant est un garage (« g:<id de l'entreprise> », partagé par toute son équipe) ou un apporteur (« a:<email> »).
-- Deux apporteurs ne peuvent pas s'écrire. La démo ne parle qu'à la démo.
-- L'administrateur écrit au nom d'Ocaz (« o:ocaz ») à n'importe quel revendeur ou apporteur, et chacun peut écrire à Ocaz.
-- Modération : le destinataire peut signaler un message ; l'administrateur ne voit que les messages signalés
-- (avec la conversation autour) et peut bloquer l'envoi d'un participant. Il ne lit jamais les autres conversations.
-- =====================================================================================================

create table if not exists public.crm_conversations (
  id uuid primary key default gen_random_uuid(),
  cle_a text not null,
  cle_b text not null,
  cree_le timestamptz not null default now(),
  dernier_le timestamptz not null default now(),
  dernier_texte text not null default '',
  lu_a timestamptz not null default 'epoch',
  lu_b timestamptz not null default 'epoch',
  constraint crm_conversations_ordre check (cle_a < cle_b),
  constraint crm_conversations_paire unique (cle_a, cle_b)
);
create index if not exists crm_conversations_b on public.crm_conversations (cle_b);

create table if not exists public.crm_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.crm_conversations (id) on delete cascade,
  auteur_cle text not null,
  auteur_email text not null,
  texte text not null,
  contexte text not null default '',
  cree_le timestamptz not null default now(),
  signale_le timestamptz,
  signale_par text not null default '',
  signale_motif text not null default '',
  traite boolean not null default false
);
create index if not exists crm_messages_conv on public.crm_messages (conversation_id, id desc);
create index if not exists crm_messages_auteur on public.crm_messages (auteur_email, cree_le desc);
create index if not exists crm_messages_signales on public.crm_messages (signale_le) where signale_le is not null and not traite;

-- Participants bloqués par l'administrateur : ils lisent encore leurs messages mais ne peuvent plus en envoyer.
create table if not exists public.crm_msg_bloques (
  cle text primary key,
  motif text not null default '',
  bloque_le timestamptz not null default now()
);
alter table public.crm_conversations enable row level security;
alter table public.crm_messages enable row level security;
alter table public.crm_msg_bloques enable row level security;

-- Identités de messagerie du compte connecté (son garage et/ou son espace apporteur actif).
create or replace function public.crm__msg_mes_cles() returns text[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[
    (select 'g:' || public.crm_entreprise()::text),
    (select 'a:' || email from public.crm_apporteurs where email = lower(auth.jwt() ->> 'email') and statut = 'actif'),
    (select 'o:ocaz' where public.crm_est_superadmin())], null);
$$;

-- Infos d'un participant : nom, ligne de détail, démo, actif (null s'il n'existe pas).
create or replace function public.crm__msg_participant(p_cle text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if p_cle like 'g:%' then
    select jsonb_build_object('cle', p_cle, 'type', 'garage',
        'nom', coalesce(nullif(rs.data -> 'garage' ->> 'nom', ''), nullif(en.config -> 'infos' ->> 'nom', ''), en.nom),
        'sous', coalesce(nullif(rs.data -> 'garage' ->> 'ville', ''), nullif(en.config -> 'infos' ->> 'ville', ''), 'Garage'),
        'demo', en.demo, 'actif', true)
      into r from public.crm_entreprises en left join public.crm_reseau rs on rs.entreprise_id = en.id
      where en.id::text = substr(p_cle, 3);
  elsif p_cle = 'o:ocaz' then
    r := jsonb_build_object('cle', p_cle, 'type', 'ocaz', 'nom', 'Ocaz', 'sous', 'L''équipe Ocaz', 'demo', null, 'actif', true);
  elsif p_cle like 'a:%' then
    select jsonb_build_object('cle', p_cle, 'type', 'apporteur', 'nom', trim(concat_ws(' ', a.prenom, a.nom)),
        'sous', 'Apporteur d''affaires' || case when a.ville <> '' then ' · ' || a.ville else '' end,
        'demo', a.demo, 'actif', a.statut = 'actif')
      into r from public.crm_apporteurs a where a.email = substr(p_cle, 3);
  end if;
  return r;
end $$;

-- Règle de qui peut écrire à qui (changer ici si besoin).
create or replace function public.crm__msg_autorise(p_moi text, p_autre text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare a jsonb := public.crm__msg_participant(p_moi); b jsonb := public.crm__msg_participant(p_autre);
begin
  if a is null or b is null or p_moi = p_autre then return false; end if;
  -- Ocaz écrit à tout le monde (démo comprise) et tout le monde peut écrire à Ocaz.
  if 'o:ocaz' in (p_moi, p_autre) then return (b ->> 'actif')::boolean; end if;
  if (a ->> 'demo')::boolean <> (b ->> 'demo')::boolean then return false; end if;
  if not (b ->> 'actif')::boolean then return false; end if;
  if a ->> 'type' = 'apporteur' and b ->> 'type' = 'apporteur' then return false; end if;
  return true;
end $$;

create or replace function public.crm__msg_verifier_moi(p_moi text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_moi is null or not (p_moi = any (public.crm__msg_mes_cles())) then raise exception 'Messagerie indisponible pour ce compte.'; end if;
end $$;

-- Lecture directe (temps réel) : seulement les conversations dont on fait partie.
drop policy if exists "Messagerie : mes conversations" on public.crm_conversations;
create policy "Messagerie : mes conversations" on public.crm_conversations for select to authenticated
  using (cle_a = any (public.crm__msg_mes_cles()) or cle_b = any (public.crm__msg_mes_cles()));
drop policy if exists "Messagerie : mes messages" on public.crm_messages;
create policy "Messagerie : mes messages" on public.crm_messages for select to authenticated
  using (exists (select 1 from public.crm_conversations c where c.id = conversation_id
    and (c.cle_a = any (public.crm__msg_mes_cles()) or c.cle_b = any (public.crm__msg_mes_cles()))));
do $$ begin
  alter publication supabase_realtime add table public.crm_messages;
exception when duplicate_object or undefined_object then null; end $$;

-- Annuaire : à qui je peux écrire. Garage : les autres garages et les apporteurs. Apporteur : les garages du réseau.
create or replace function public.crm_msg_contacts(p_moi text) returns json
language plpgsql stable security definer set search_path = public as $$
declare d boolean;
begin
  perform public.crm__msg_verifier_moi(p_moi);
  -- Ocaz : tous les revendeurs et tous les apporteurs actifs (démo comprise).
  if p_moi = 'o:ocaz' then
    return coalesce((select json_agg(p order by p ->> 'type' desc, (p ->> 'demo')::boolean, p ->> 'nom') from (
      select public.crm__msg_participant('g:' || en.id::text) p from public.crm_entreprises en
        where not exists (select 1 from public.crm_membres m join public.crm_superadmins s on s.email = m.email where m.entreprise_id = en.id)
      union all
      select public.crm__msg_participant('a:' || a.email) from public.crm_apporteurs a where a.statut = 'actif') x), '[]'::json);
  end if;
  d := (public.crm__msg_participant(p_moi) ->> 'demo')::boolean;
  return coalesce((select json_agg(p order by p ->> 'type' = 'ocaz' desc, p ->> 'type' desc, p ->> 'nom') from (
    select public.crm__msg_participant('o:ocaz') p
    union all
    select public.crm__msg_participant('g:' || en.id::text) from public.crm_entreprises en
      where en.demo = d and 'g:' || en.id::text <> p_moi
        and (p_moi like 'g:%' or exists (select 1 from public.crm_reseau r where r.entreprise_id = en.id and r.actif))
        and not exists (select 1 from public.crm_membres m join public.crm_superadmins s on s.email = m.email where m.entreprise_id = en.id)
    union all
    select public.crm__msg_participant('a:' || a.email) from public.crm_apporteurs a
      where p_moi like 'g:%' and a.demo = d and a.statut = 'actif') x), '[]'::json);
end $$;

-- Mes conversations, la plus récente d'abord, avec le nombre de messages non lus.
create or replace function public.crm_msg_conversations(p_moi text) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm__msg_verifier_moi(p_moi);
  return coalesce((select json_agg(json_build_object('id', c.id, 'dernier_le', c.dernier_le, 'dernier_texte', c.dernier_texte,
      'autre', public.crm__msg_participant(case when c.cle_a = p_moi then c.cle_b else c.cle_a end),
      'non_lus', (select count(*) from public.crm_messages m where m.conversation_id = c.id and m.auteur_cle <> p_moi
        and m.cree_le > case when c.cle_a = p_moi then c.lu_a else c.lu_b end)) order by c.dernier_le desc)
    from public.crm_conversations c where p_moi in (c.cle_a, c.cle_b)), '[]'::json);
end $$;

-- Ouvre (ou crée) la conversation avec un partenaire.
create or replace function public.crm_msg_ouvrir(p_moi text, p_autre text) returns uuid
language plpgsql security definer set search_path = public as $$
declare x text := least(p_moi, p_autre); y text := greatest(p_moi, p_autre); cid uuid;
begin
  perform public.crm__msg_verifier_moi(p_moi);
  select id into cid from public.crm_conversations where cle_a = x and cle_b = y;
  if cid is not null then return cid; end if;
  if not public.crm__msg_autorise(p_moi, p_autre) then raise exception 'Tu ne peux pas écrire à ce partenaire.'; end if;
  insert into public.crm_conversations (cle_a, cle_b) values (x, y)
    on conflict on constraint crm_conversations_paire do update set cle_a = excluded.cle_a returning id into cid;
  return cid;
end $$;

-- Messages d'une conversation (les 50 plus récents, ou ceux avant p_avant), et marque la conversation lue.
create or replace function public.crm_msg_lire(p_conv uuid, p_moi text, p_avant bigint default null) returns json
language plpgsql security definer set search_path = public as $$
declare c public.crm_conversations%rowtype;
begin
  perform public.crm__msg_verifier_moi(p_moi);
  select * into c from public.crm_conversations where id = p_conv and p_moi in (cle_a, cle_b);
  if c.id is null then raise exception 'Conversation introuvable.'; end if;
  if p_avant is null then
    update public.crm_conversations set lu_a = case when cle_a = p_moi then now() else lu_a end,
      lu_b = case when cle_b = p_moi then now() else lu_b end where id = p_conv;
  end if;
  return json_build_object('id', c.id,
    'autre', public.crm__msg_participant(case when c.cle_a = p_moi then c.cle_b else c.cle_a end),
    'lu_autre', case when c.cle_a = p_moi then c.lu_b else c.lu_a end,
    'bloque', exists (select 1 from public.crm_msg_bloques where cle = p_moi),
    'messages', coalesce((select json_agg(json_build_object('id', m.id, 'moi', m.auteur_cle = p_moi, 'texte', m.texte, 'contexte', m.contexte,
        'cree_le', m.cree_le, 'signale', m.signale_le is not null and m.auteur_cle <> p_moi) order by m.id)
      from (select * from public.crm_messages where conversation_id = p_conv and (p_avant is null or id < p_avant) order by id desc limit 50) m), '[]'::json));
end $$;

create or replace function public.crm_msg_envoyer(p_conv uuid, p_moi text, p_texte text, p_contexte text default '') returns json
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(auth.jwt() ->> 'email');
  c public.crm_conversations%rowtype;
  t text := trim(coalesce(p_texte, ''));
  m public.crm_messages%rowtype;
begin
  perform public.crm__msg_verifier_moi(p_moi);
  select * into c from public.crm_conversations where id = p_conv and p_moi in (cle_a, cle_b);
  if c.id is null then raise exception 'Conversation introuvable.'; end if;
  if exists (select 1 from public.crm_msg_bloques where cle = p_moi) then
    raise exception 'Ta messagerie a été suspendue par Ocaz. Contacte contact@ocaz.re.';
  end if;
  if not public.crm__msg_autorise(p_moi, case when c.cle_a = p_moi then c.cle_b else c.cle_a end) then
    raise exception 'Ce partenaire ne peut plus recevoir de messages.';
  end if;
  if length(t) = 0 then raise exception 'Message vide.'; end if;
  if length(t) > 2000 then raise exception 'Message trop long (2000 caractères maximum).'; end if;
  if (select count(*) from public.crm_messages where auteur_email = e and cree_le > now() - interval '10 minutes') >= 60 then
    raise exception 'Trop de messages d''affilée : attends quelques minutes.';
  end if;
  -- Messages envoyés au nom d'Ocaz : signés automatiquement par Anthony (le même message ne reçoit qu'une signature).
  insert into public.crm_messages (conversation_id, auteur_cle, auteur_email, texte, contexte)
    values (p_conv, p_moi, e, case when p_moi = 'o:ocaz' and t not like '%Anthony Payet-Lamer' || chr(10) || 'OCAZ'
        then t || chr(10) || chr(10) || 'Anthony Payet-Lamer' || chr(10) || 'OCAZ' else t end,
      left(trim(coalesce(p_contexte, '')), 200)) returning * into m;
  update public.crm_conversations set dernier_le = m.cree_le, dernier_texte = left(t, 140),
    lu_a = case when cle_a = p_moi then m.cree_le else lu_a end, lu_b = case when cle_b = p_moi then m.cree_le else lu_b end
    where id = p_conv;
  return json_build_object('id', m.id, 'moi', true, 'texte', m.texte, 'contexte', m.contexte, 'cree_le', m.cree_le, 'signale', false);
end $$;

-- Le destinataire signale un message à l'administrateur.
create or replace function public.crm_msg_signaler(p_id bigint, p_moi text, p_motif text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.crm__msg_verifier_moi(p_moi);
  update public.crm_messages m set signale_le = now(), signale_par = p_moi, signale_motif = left(trim(coalesce(p_motif, '')), 300), traite = false
    from public.crm_conversations c
    where m.id = p_id and c.id = m.conversation_id and p_moi in (c.cle_a, c.cle_b) and m.auteur_cle <> p_moi;
  if not found then raise exception 'Message introuvable.'; end if;
end $$;

-- Administrateur : messages signalés à traiter (avec les messages autour), et participants bloqués.
create or replace function public.crm_msg_admin() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  return json_build_object(
    'signalements', coalesce((select json_agg(json_build_object('id', m.id, 'texte', m.texte, 'cree_le', m.cree_le,
        'signale_le', m.signale_le, 'motif', m.signale_motif, 'auteur', public.crm__msg_participant(m.auteur_cle),
        'par', public.crm__msg_participant(m.signale_par), 'auteur_bloque', exists (select 1 from public.crm_msg_bloques b where b.cle = m.auteur_cle),
        'autour', (select json_agg(json_build_object('id', x.id, 'texte', x.texte, 'cree_le', x.cree_le,
            'auteur', public.crm__msg_participant(x.auteur_cle) ->> 'nom') order by x.id)
          from (select * from public.crm_messages y where y.conversation_id = m.conversation_id order by abs(y.id - m.id) limit 11) x)) order by m.signale_le)
      from public.crm_messages m where m.signale_le is not null and not m.traite), '[]'::json),
    'bloques', coalesce((select json_agg(public.crm__msg_participant(b.cle) || jsonb_build_object('cle', b.cle, 'motif', b.motif, 'bloque_le', b.bloque_le)
        order by b.bloque_le desc) from public.crm_msg_bloques b), '[]'::json));
end $$;

-- Administrateur : classe un signalement (« ignorer ») ou bloque l'auteur (« bloquer »), ou débloque un participant.
create or replace function public.crm_msg_admin_traiter(p_id bigint, p_action text, p_cle text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m public.crm_messages%rowtype;
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  if p_action = 'debloquer' then delete from public.crm_msg_bloques where cle = p_cle; return; end if;
  select * into m from public.crm_messages where id = p_id;
  if m.id is null then raise exception 'Message introuvable.'; end if;
  if p_action = 'bloquer' then
    insert into public.crm_msg_bloques (cle, motif) values (m.auteur_cle, left('Message signalé : ' || m.signale_motif, 300))
      on conflict (cle) do nothing;
  elsif p_action <> 'ignorer' then raise exception 'Action inconnue.';
  end if;
  update public.crm_messages set traite = true where id = p_id;
end $$;

revoke execute on function public.crm__msg_mes_cles(), public.crm__msg_participant(text), public.crm__msg_autorise(text, text),
  public.crm__msg_verifier_moi(text) from public, anon;
grant execute on function public.crm__msg_mes_cles() to authenticated; -- utilisée par les règles de lecture
revoke execute on function public.crm_msg_contacts(text), public.crm_msg_conversations(text), public.crm_msg_ouvrir(text, text),
  public.crm_msg_lire(uuid, text, bigint), public.crm_msg_envoyer(uuid, text, text, text), public.crm_msg_signaler(bigint, text, text),
  public.crm_msg_admin(), public.crm_msg_admin_traiter(bigint, text, text) from public, anon;
grant execute on function public.crm_msg_contacts(text), public.crm_msg_conversations(text), public.crm_msg_ouvrir(text, text),
  public.crm_msg_lire(uuid, text, bigint), public.crm_msg_envoyer(uuid, text, text, text), public.crm_msg_signaler(bigint, text, text),
  public.crm_msg_admin(), public.crm_msg_admin_traiter(bigint, text, text) to authenticated;

-- Réglages de l'administrateur (par exemple ses étapes affichées sur le tableau de bord).
create table if not exists public.crm_admin_reglages (
  cle text primary key,
  valeur jsonb not null default '{}'::jsonb,
  maj_le timestamptz not null default now()
);
alter table public.crm_admin_reglages enable row level security;

create or replace function public.crm_admin_reglage_lire(p_cle text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  return (select valeur from public.crm_admin_reglages where cle = p_cle);
end $$;

create or replace function public.crm_admin_reglage_ecrire(p_cle text, p_valeur jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.crm_est_superadmin() then raise exception 'Réservé à l''administrateur'; end if;
  if length(coalesce(p_valeur, '{}'::jsonb)::text) > 50000 then raise exception 'Trop long.'; end if;
  insert into public.crm_admin_reglages (cle, valeur, maj_le) values (left(p_cle, 60), coalesce(p_valeur, '{}'::jsonb), now())
  on conflict (cle) do update set valeur = excluded.valeur, maj_le = now();
end $$;

revoke execute on function public.crm_admin_reglage_lire(text), public.crm_admin_reglage_ecrire(text, jsonb) from public, anon;
grant execute on function public.crm_admin_reglage_lire(text), public.crm_admin_reglage_ecrire(text, jsonb) to authenticated;
