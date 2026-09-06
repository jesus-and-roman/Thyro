-- =========================================================
-- THYRO — schéma d'authentification (connexion + inscription)
-- Convention de nommage : préfixe thyro_ sur toutes les tables
-- et colonnes (un "." littéral n'est pas un identifiant Postgres
-- valide sans le quoter partout, ce qui casserait PostgREST/RLS).
-- =========================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------
-- Table principale des comptes
-- ---------------------------------------------------------
create sequence if not exists thyro_nid_seq start 1;

create table if not exists thyro_users (
  thyro_id              uuid primary key default gen_random_uuid(),
  -- uID : code aléatoire à 9 chiffres, identifiant public du compte
  thyro_uid             text unique not null,
  -- nID : rang de création du compte, toujours sur au moins 4 chiffres (0092, 10000, ...)
  thyro_nid             text unique not null,
  thyro_username        citext not null unique,
  thyro_first_name      text not null,
  thyro_last_name       text not null,
  thyro_email           citext unique,
  thyro_phone           text unique,
  -- Le mot de passe et le NIP sont d'abord réduits en sha256 (hex, longueur fixe)
  -- avant le bcrypt : bcrypt tronque silencieusement tout ce qui dépasse 72
  -- octets, ce qui serait dangereux vu qu'aucune limite de longueur n'est
  -- imposée au mot de passe. Ce pré-hash élimine le problème.
  thyro_password_hash   text not null,
  thyro_pin_hash        text not null,
  thyro_birthdate       date not null,
  -- Hash sha256 du code de récupération 520 caractères (jamais stocké en clair)
  thyro_recovery_hash   text unique,
  thyro_created_at      timestamptz not null default now(),

  constraint thyro_email_or_phone check (thyro_email is not null or thyro_phone is not null),
  constraint thyro_birthdate_valid check (
    thyro_birthdate >= date '1926-01-01'
    and thyro_birthdate <= (current_date - interval '13 years')
  ),
  constraint thyro_uid_format check (thyro_uid ~ '^[0-9]{9}$'),
  constraint thyro_nid_format check (thyro_nid ~ '^[0-9]{4,}$'),
  constraint thyro_username_format check (thyro_username ~ '^[A-Za-z0-9_.-]{3,20}$'),
  -- Latin de base + Latin-1 Supplement + Latin Extended-A, lettres seulement
  constraint thyro_first_name_format check (thyro_first_name ~ '^[A-Za-zÀ-ÖØ-öø-ÿĀ-ſ]{1,20}$'),
  constraint thyro_last_name_format  check (thyro_last_name  ~ '^[A-Za-zÀ-ÖØ-öø-ÿĀ-ſ]{1,20}$')
);

-- Sessions custom (on ne passe pas par Supabase Auth, donc on gère
-- nous-mêmes un jeton d'session opaque, stocké côté client)
create table if not exists thyro_sessions (
  thyro_token       text primary key default encode(gen_random_bytes(32), 'hex'),
  thyro_user_id     uuid not null references thyro_users(thyro_id) on delete cascade,
  thyro_created_at  timestamptz not null default now(),
  thyro_expires_at  timestamptz not null default (now() + interval '30 days')
);

alter table thyro_users enable row level security;
alter table thyro_sessions enable row level security;
-- Volontairement aucune policy : l'accès direct (anon/authenticated) est
-- refusé par défaut. Tout passe par les fonctions SECURITY DEFINER ci-dessous.

-- ---------------------------------------------------------
-- Utilitaires internes
-- ---------------------------------------------------------
create or replace function thyro_prehash(p_secret text)
returns text
language sql
immutable
as $$
  select encode(digest(p_secret, 'sha256'), 'hex');
$$;

create or replace function thyro_hash_secret(p_secret text)
returns text
language sql
as $$
  select crypt(thyro_prehash(p_secret), gen_salt('bf'));
$$;

create or replace function thyro_secret_matches(p_secret text, p_hash text)
returns boolean
language sql
as $$
  select p_hash = crypt(thyro_prehash(p_secret), p_hash);
$$;

-- ---------------------------------------------------------
-- Disponibilité (vérifications en direct dans les formulaires)
-- ---------------------------------------------------------
create or replace function thyro_username_available(p_username citext)
returns boolean language sql security definer as $$
  select not exists(select 1 from thyro_users where thyro_username = p_username);
$$;

create or replace function thyro_email_available(p_email citext)
returns boolean language sql security definer as $$
  select not exists(select 1 from thyro_users where thyro_email = p_email);
$$;

create or replace function thyro_phone_available(p_phone text)
returns boolean language sql security definer as $$
  select not exists(select 1 from thyro_users where thyro_phone = p_phone);
$$;

-- ---------------------------------------------------------
-- Génération du uID (9 chiffres, unique)
-- ---------------------------------------------------------
create or replace function thyro_generate_uid()
returns text
language plpgsql
as $$
declare
  v_uid text;
  v_attempt int := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    v_uid := lpad(floor(random() * 1000000000)::bigint::text, 9, '0');
    exit when not exists(select 1 from thyro_users where thyro_uid = v_uid) or v_attempt > 15;
  end loop;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------
-- Inscription
-- ---------------------------------------------------------
drop function if exists thyro_signup(
  citext,
  text,
  text,
  citext,
  text,
  text,
  text,
  date
);
create or replace function thyro_signup(
  p_username    citext,
  p_first_name  text,
  p_last_name   text,
  p_email       citext,
  p_phone       text,
  p_password    text,
  p_pin         text,
  p_birthdate   date
)
returns table(thyro_id uuid, thyro_username citext, thyro_uid text, thyro_nid text)
language plpgsql
security definer
as $$
declare
  v_uid text;
  v_nid text;
begin
  if p_password is null or length(p_password) < 8 then
    raise exception 'password_too_short' using errcode = 'P0001';
  end if;

  if p_pin is null or length(p_pin) < 6 or length(p_pin) > 12 then
    raise exception 'pin_invalid_length' using errcode = 'P0001';
  end if;

  if position(lower(p_username) in lower(p_password)) > 0 then
    raise exception 'password_contains_username' using errcode = 'P0001';
  end if;

  if p_email is null and p_phone is null then
    raise exception 'email_or_phone_required' using errcode = 'P0001';
  end if;

  v_uid := thyro_generate_uid();
  v_nid := lpad(nextval('thyro_nid_seq')::text, 4, '0');

  return query
  insert into thyro_users (
    thyro_uid, thyro_nid, thyro_username, thyro_first_name, thyro_last_name,
    thyro_email, thyro_phone, thyro_password_hash, thyro_pin_hash, thyro_birthdate
  ) values (
    v_uid, v_nid, p_username, p_first_name, p_last_name,
    p_email, p_phone, thyro_hash_secret(p_password), thyro_hash_secret(p_pin), p_birthdate
  )
  returning thyro_users.thyro_id, thyro_users.thyro_username, thyro_users.thyro_uid, thyro_users.thyro_nid;
exception
  when unique_violation then
    raise exception 'already_taken' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------
-- Connexion (email ou téléphone)
-- ---------------------------------------------------------
create or replace function thyro_login(
  p_mode        text, -- 'email' | 'phone'
  p_identifier  text,
  p_password    text
)
returns table(thyro_token text, thyro_id uuid, thyro_username citext, thyro_first_name text)
language plpgsql
security definer
as $$
declare
  v_user thyro_users%rowtype;
  v_token text;
begin
  if p_mode = 'phone' then
    select * into v_user from thyro_users where thyro_phone = p_identifier;
  else
    select * into v_user from thyro_users where thyro_email = p_identifier::citext;
  end if;

  if v_user.thyro_id is null or not thyro_secret_matches(p_password, v_user.thyro_password_hash) then
    raise exception 'invalid_credentials' using errcode = 'P0001';
  end if;

  insert into thyro_sessions (thyro_user_id) values (v_user.thyro_id)
  returning thyro_sessions.thyro_token into v_token;

  return query select v_token, v_user.thyro_id, v_user.thyro_username, v_user.thyro_first_name;
end;
$$;

-- ---------------------------------------------------------
-- Génération du code de récupération (520 caractères)
-- ---------------------------------------------------------
create or replace function thyro_generate_recovery_code(p_user_id uuid)
returns text
language plpgsql
security definer
as $$
declare
  v_alphabet text := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#!"/$%?&*()-+_=';
  v_code text;
  v_hash text;
  v_attempt int := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    select string_agg(
      substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1),
      ''
    ) into v_code
    from generate_series(1, 520);

    v_hash := encode(digest(v_code, 'sha256'), 'hex');

    exit when not exists(select 1 from thyro_users where thyro_recovery_hash = v_hash) or v_attempt > 5;
  end loop;

  update thyro_users set thyro_recovery_hash = v_hash where thyro_id = p_user_id;
  return v_code; -- seule et unique fois où le code existe en clair
end;
$$;

-- ---------------------------------------------------------
-- Mot de passe oublié — codes par email / SMS
-- ---------------------------------------------------------
-- NB : cette table ne fait qu'émettre et vérifier des codes. L'envoi
-- réel du courriel/SMS doit être déclenché par une Edge Function
-- (fournisseur type Resend/Twilio) — voir supabase/functions/thyro-send-code.
create table if not exists thyro_reset_requests (
  thyro_id           uuid primary key default gen_random_uuid(),
  thyro_user_id      uuid not null references thyro_users(thyro_id) on delete cascade,
  thyro_channel      text not null check (thyro_channel in ('email', 'sms')),
  thyro_identifier   text not null,
  thyro_code_hash    text not null,
  thyro_consumed     boolean not null default false,
  thyro_created_at   timestamptz not null default now(),
  thyro_expires_at   timestamptz not null default (now() + interval '10 minutes')
);

alter table thyro_reset_requests enable row level security;

-- Limite horaire "maison" : Supabase n'expose pas de compteur de quota
-- interrogeable par le client, donc on émule la limite nous-mêmes.
create or replace function thyro_reset_channel_available(p_channel text)
returns boolean
language sql
security definer
as $$
  select count(*) < 20
  from thyro_reset_requests
  where thyro_channel = p_channel
    and thyro_created_at > now() - interval '1 hour';
$$;

-- Vérifie si l'identifiant existe, respecte la limite horaire, génère
-- un code à 6 chiffres et crée la demande.
create or replace function thyro_request_reset(p_channel text, p_identifier text)
returns text -- 'sent' | 'not_found' | 'rate_limited'
language plpgsql
security definer
as $$
declare
  v_user thyro_users%rowtype;
  v_code text;
begin
  if not thyro_reset_channel_available(p_channel) then
    return 'rate_limited';
  end if;

  if p_channel = 'email' then
    select * into v_user from thyro_users where thyro_email = p_identifier::citext;
  else
    select * into v_user from thyro_users where thyro_phone = p_identifier;
  end if;

  if v_user.thyro_id is null then
    return 'not_found';
  end if;

  v_code := lpad(floor(random() * 1000000)::int::text, 6, '0');

  insert into thyro_reset_requests (thyro_user_id, thyro_channel, thyro_identifier, thyro_code_hash)
  values (v_user.thyro_id, p_channel, p_identifier, encode(digest(v_code, 'sha256'), 'hex'));

  -- TODO : déclencher ici l'Edge Function thyro-send-code (pg_net.http_post)
  -- avec p_identifier, p_channel et v_code pour l'envoi réel.

  return 'sent';
end;
$$;

-- Vérifie le code reçu par email/SMS et change le mot de passe
create or replace function thyro_confirm_reset(
  p_channel text, p_identifier text, p_code text, p_new_password text
)
returns boolean
language plpgsql
security definer
as $$
declare
  v_request thyro_reset_requests%rowtype;
begin
  if p_new_password is null or length(p_new_password) < 8 then
    raise exception 'password_too_short' using errcode = 'P0001';
  end if;

  select * into v_request
  from thyro_reset_requests
  where thyro_channel = p_channel
    and thyro_identifier = p_identifier
    and thyro_code_hash = encode(digest(p_code, 'sha256'), 'hex')
    and thyro_consumed = false
    and thyro_expires_at > now()
  order by thyro_created_at desc
  limit 1;

  if v_request.thyro_id is null then
    raise exception 'invalid_or_expired_code' using errcode = 'P0001';
  end if;

  update thyro_users set thyro_password_hash = thyro_hash_secret(p_new_password)
  where thyro_id = v_request.thyro_user_id;

  update thyro_reset_requests set thyro_consumed = true where thyro_id = v_request.thyro_id;

  return true;
end;
$$;

-- ---------------------------------------------------------
-- Mot de passe oublié — fichier de récupération (520 caractères)
-- ---------------------------------------------------------
create or replace function thyro_confirm_reset_with_file(
  p_username citext, p_code text, p_new_password text
)
returns boolean
language plpgsql
security definer
as $$
declare
  v_user thyro_users%rowtype;
begin
  if p_new_password is null or length(p_new_password) < 8 then
    raise exception 'password_too_short' using errcode = 'P0001';
  end if;

  select * into v_user from thyro_users where thyro_username = p_username;

  if v_user.thyro_id is null
     or v_user.thyro_recovery_hash is null
     or v_user.thyro_recovery_hash <> encode(digest(p_code, 'sha256'), 'hex') then
    raise exception 'invalid_recovery_file' using errcode = 'P0001';
  end if;

  update thyro_users set thyro_password_hash = thyro_hash_secret(p_new_password)
  where thyro_id = v_user.thyro_id;

  return true;
end;
$$;

-- ---------------------------------------------------------
-- Droits d'exécution pour le rôle anon (formulaires publics)
-- ---------------------------------------------------------
grant execute on function thyro_username_available(citext) to anon;
grant execute on function thyro_email_available(citext) to anon;
grant execute on function thyro_phone_available(text) to anon;
grant execute on function thyro_signup(citext, text, text, citext, text, text, text, date) to anon;
grant execute on function thyro_login(text, text, text) to anon;
grant execute on function thyro_generate_recovery_code(uuid) to anon;
grant execute on function thyro_reset_channel_available(text) to anon;
grant execute on function thyro_request_reset(text, text) to anon;
grant execute on function thyro_confirm_reset(text, text, text, text) to anon;
grant execute on function thyro_confirm_reset_with_file(citext, text, text) to anon;
