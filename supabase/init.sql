-- =============================================================================
-- Nexus-Tauri — schéma initial Supabase
-- Exécuter dans : Tableau de bord Supabase → SQL Editor → New query → Run
-- Ordre : une seule exécution du script entier (ou par sections commentées).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Table profils publics (synchronisée avec auth.users)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Profil applicatif lié à auth.users';

-- -----------------------------------------------------------------------------
-- 2) RLS (Row Level Security)
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- -----------------------------------------------------------------------------
-- 3) Trigger : mise à jour automatique de updated_at
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4) (Optionnel) Profil créé automatiquement à l’inscription
--    Utile si la confirmation e-mail est activée et qu’il n’y a pas encore de session côté app.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', '')
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 5) (Optionnel) Storage — avatars
--    Après exécution : Storage → créer un bucket « avatars » public ou privé selon ton choix.
--    Politiques d’exemple si bucket PRIVÉ nommé « avatars » :
-- -----------------------------------------------------------------------------
-- insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false);
--
-- create policy "avatars_insert_own"
--   on storage.objects for insert
--   with check (
--     bucket_id = 'avatars'
--     and auth.uid()::text = (storage.foldername(name))[1]
--   );
--
-- create policy "avatars_select_own"
--   on storage.objects for select
--   using (
--     bucket_id = 'avatars'
--     and auth.uid()::text = (storage.foldername(name))[1]
--   );
