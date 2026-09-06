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
create table if not exists thyro_users (
  thyro_id              uuid primary key default gen_random_uuid(),
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
-- Inscription
-- ---------------------------------------------------------
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
returns table(thyro_id uuid, thyro_username citext)
language plpgsql
security definer
as $$
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

  return query
  insert into thyro_users (
    thyro_username, thyro_first_name, thyro_last_name,
    thyro_email, thyro_phone, thyro_password_hash, thyro_pin_hash, thyro_birthdate
  ) values (
    p_username, p_first_name, p_last_name,
    p_email, p_phone, thyro_hash_secret(p_password), thyro_hash_secret(p_pin), p_birthdate
  )
  returning thyro_users.thyro_id, thyro_users.thyro_username;
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
-- Droits d'exécution pour le rôle anon (formulaires publics)
-- ---------------------------------------------------------
grant execute on function thyro_username_available(citext) to anon;
grant execute on function thyro_email_available(citext) to anon;
grant execute on function thyro_phone_available(text) to anon;
grant execute on function thyro_signup(citext, text, text, citext, text, text, text, date) to anon;
grant execute on function thyro_login(text, text, text) to anon;
grant execute on function thyro_generate_recovery_code(uuid) to anon;
