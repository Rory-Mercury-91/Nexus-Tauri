-- =============================================================================
-- À exécuter APRÈS supabase/init.sql (SQL Editor Supabase)
-- Familles + visibilité profils / avatars + bucket « avatars » privé
--
-- IMPORTANT : les politiques ne doivent PAS sous-requêter family_members sous RLS
-- (sinon « infinite recursion detected in policy for relation family_members »).
-- Les contrôles passent par des fonctions SECURITY DEFINER (bypass RLS interne).
-- =============================================================================

-- Colonne : chemin objet dans le bucket (ex. uuid/avatar.webp)
alter table public.profiles
  add column if not exists avatar_storage_path text;

comment on column public.profiles.avatar_storage_path is
  'Chemin dans le bucket Storage « avatars » (dossier = id utilisateur).';

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Foyer',
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete cascade
);

create table if not exists public.family_members (
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  primary key (family_id, user_id),
  constraint family_members_role_chk check (role in ('admin', 'member'))
);

alter table public.families enable row level security;
alter table public.family_members enable row level security;

-- -----------------------------------------------------------------------------
-- Supprimer anciennes politiques / fonctions (ré-exécution sûre)
-- -----------------------------------------------------------------------------
drop policy if exists "families_select_member" on public.families;
drop policy if exists "families_insert_creator" on public.families;

drop policy if exists "family_members_select_related" on public.family_members;
drop policy if exists "family_members_insert_self_or_admin" on public.family_members;
drop policy if exists "family_members_insert_rules" on public.family_members;
drop policy if exists "family_members_delete_self_or_admin" on public.family_members;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_visible" on public.profiles;

drop policy if exists "avatars_select_own_or_family" on storage.objects;

drop function if exists public.user_family_ids();
drop function if exists public.is_family_creator_of(uuid);
drop function if exists public.is_family_admin_of(uuid);
drop function if exists public.user_shares_family_with(uuid);
drop function if exists public.can_read_avatar_object(text);

-- -----------------------------------------------------------------------------
-- Fonctions helper (SECURITY DEFINER — pas de récursion RLS)
-- -----------------------------------------------------------------------------
create or replace function public.user_family_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select family_id from public.family_members where user_id = auth.uid();
$$;

create or replace function public.is_family_creator_of(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.families f
    where f.id = p_family_id and f.created_by = auth.uid()
  );
$$;

create or replace function public.is_family_admin_of(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.family_members fm
    where fm.family_id = p_family_id
      and fm.user_id = auth.uid()
      and fm.role = 'admin'
  );
$$;

create or replace function public.user_shares_family_with(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.family_members a
    join public.family_members b on a.family_id = b.family_id
    where a.user_id = auth.uid() and b.user_id = p_other
  );
$$;

create or replace function public.can_read_avatar_object(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  folder text;
  owner_id uuid;
begin
  folder := (storage.foldername(object_name))[1];
  if folder is null or folder = '' then
    return false;
  end if;
  if folder = auth.uid()::text then
    return true;
  end if;
  begin
    owner_id := folder::uuid;
  exception
    when invalid_text_representation then
      return false;
  end;
  return public.user_shares_family_with(owner_id);
end;
$$;

grant execute on function public.user_family_ids() to authenticated;
grant execute on function public.is_family_creator_of(uuid) to authenticated;
grant execute on function public.is_family_admin_of(uuid) to authenticated;
grant execute on function public.user_shares_family_with(uuid) to authenticated;
grant execute on function public.can_read_avatar_object(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Politiques families
-- -----------------------------------------------------------------------------
create policy "families_select_member"
  on public.families for select
  using (
    created_by = auth.uid()
    or id in (select public.user_family_ids())
  );

create policy "families_insert_creator"
  on public.families for insert
  with check (created_by = auth.uid());

-- -----------------------------------------------------------------------------
-- Politiques family_members (sans sous-requête RLS sur soi-même)
-- -----------------------------------------------------------------------------
create policy "family_members_select_by_family"
  on public.family_members for select
  using (family_id in (select public.user_family_ids()));

create policy "family_members_insert_rules"
  on public.family_members for insert
  with check (
    (
      user_id = auth.uid()
      and (
        public.is_family_creator_of(family_id)
        or public.is_family_admin_of(family_id)
      )
    )
    or (
      user_id <> auth.uid()
      and public.is_family_admin_of(family_id)
    )
  );

create policy "family_members_delete_self_or_admin"
  on public.family_members for delete
  using (
    user_id = auth.uid()
    or public.is_family_admin_of(family_id)
  );

-- -----------------------------------------------------------------------------
-- Profils : lecture (soi + même famille) sans jointure RLS directe
-- -----------------------------------------------------------------------------
create policy "profiles_select_visible"
  on public.profiles for select
  using (
    id = auth.uid()
    or public.user_shares_family_with(id)
  );

-- -----------------------------------------------------------------------------
-- Storage : bucket privé « avatars »
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "avatars_select_own_or_family" on storage.objects;
create policy "avatars_select_own_or_family"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and public.can_read_avatar_object(name)
  );

drop policy if exists "avatars_insert_own_folder" on storage.objects;
create policy "avatars_insert_own_folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own_folder" on storage.objects;
create policy "avatars_update_own_folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own_folder" on storage.objects;
create policy "avatars_delete_own_folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
