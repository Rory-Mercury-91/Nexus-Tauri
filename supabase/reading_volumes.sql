-- =============================================================================
-- Nexus-Tauri — Lectures: tomes + répartition des coûts par propriétaire
-- =============================================================================
-- ⚠️ DÉPRÉCIÉ — Ne pas utiliser sur les nouveaux déploiements.
-- Remplacé par : nexus_install_volumes_v2.sql (catalogue + foyer + état perso).
-- Voir supabase/NEXUS_DATABASE_SETUP.md
-- =============================================================================

create table if not exists public.reading_volumes (
  id uuid primary key default gen_random_uuid(),
  reading_id uuid not null references public.library_reading (id) on delete cascade,
  family_id uuid references public.families (id) on delete set null,
  volume_number integer not null check (volume_number > 0),
  volume_type text not null default 'standard',
  image_url text,
  release_date_vf date,
  purchase_date date,
  price_euros numeric(10,2) not null default 0 check (price_euros >= 0),
  is_owned boolean not null default false,
  is_read boolean not null default false,
  is_mihon boolean not null default false,
  created_by uuid not null references auth.users (id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reading_id, volume_number)
);

create table if not exists public.reading_volume_owners (
  volume_id uuid not null references public.reading_volumes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  family_id uuid references public.families (id) on delete set null,
  share_euros numeric(10,2) not null default 0 check (share_euros >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (volume_id, user_id)
);

create index if not exists reading_volumes_reading_idx
  on public.reading_volumes (reading_id, volume_number);
create index if not exists reading_volumes_family_idx
  on public.reading_volumes (family_id);
create index if not exists reading_volume_owners_user_idx
  on public.reading_volume_owners (user_id);

drop trigger if exists reading_volumes_set_updated_at on public.reading_volumes;
create trigger reading_volumes_set_updated_at
  before update on public.reading_volumes
  for each row execute function public.set_updated_at();

drop trigger if exists reading_volume_owners_set_updated_at on public.reading_volume_owners;
create trigger reading_volume_owners_set_updated_at
  before update on public.reading_volume_owners
  for each row execute function public.set_updated_at();

alter table public.reading_volumes enable row level security;
alter table public.reading_volume_owners enable row level security;

drop function if exists public.user_is_owner_of_reading_volume(uuid);
create or replace function public.user_is_owner_of_reading_volume(
  p_volume_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.reading_volume_owners o
    where o.volume_id = p_volume_id
      and o.user_id = auth.uid()
  );
$$;

grant execute on function public.user_is_owner_of_reading_volume(uuid) to authenticated;

drop policy if exists "reading_volumes_select_owner" on public.reading_volumes;
create policy "reading_volumes_select_owner"
  on public.reading_volumes for select
  using (
    created_by = auth.uid()
    or public.user_is_owner_of_reading_volume(id)
    or (
      family_id is not null
      and family_id in (select public.user_family_ids())
    )
  );

drop policy if exists "reading_volumes_insert_owner" on public.reading_volumes;
create policy "reading_volumes_insert_owner"
  on public.reading_volumes for insert
  with check (
    created_by = auth.uid()
    and (
      family_id is null
      or family_id in (select public.user_family_ids())
    )
  );

drop policy if exists "reading_volumes_update_owner" on public.reading_volumes;
create policy "reading_volumes_update_owner"
  on public.reading_volumes for update
  using (
    created_by = auth.uid()
    or public.user_is_owner_of_reading_volume(id)
    or (
      family_id is not null
      and family_id in (select public.user_family_ids())
    )
  )
  with check (
    family_id is null
    or family_id in (select public.user_family_ids())
  );

drop policy if exists "reading_volumes_delete_owner" on public.reading_volumes;
create policy "reading_volumes_delete_owner"
  on public.reading_volumes for delete
  using (
    created_by = auth.uid()
    or public.user_is_owner_of_reading_volume(id)
  );

drop policy if exists "reading_volume_owners_select_related" on public.reading_volume_owners;
create policy "reading_volume_owners_select_related"
  on public.reading_volume_owners for select
  using (
    user_id = auth.uid()
    or public.user_is_owner_of_reading_volume(volume_id)
    or (
      family_id is not null
      and family_id in (select public.user_family_ids())
    )
  );

drop policy if exists "reading_volume_owners_insert_related" on public.reading_volume_owners;
create policy "reading_volume_owners_insert_related"
  on public.reading_volume_owners for insert
  with check (
    public.user_is_owner_of_reading_volume(volume_id)
    or user_id = auth.uid()
    or (
      family_id is not null
      and family_id in (select public.user_family_ids())
    )
  );

drop policy if exists "reading_volume_owners_update_related" on public.reading_volume_owners;
create policy "reading_volume_owners_update_related"
  on public.reading_volume_owners for update
  using (
    public.user_is_owner_of_reading_volume(volume_id)
    or user_id = auth.uid()
  )
  with check (
    family_id is null
    or family_id in (select public.user_family_ids())
  );

drop policy if exists "reading_volume_owners_delete_related" on public.reading_volume_owners;
create policy "reading_volume_owners_delete_related"
  on public.reading_volume_owners for delete
  using (
    public.user_is_owner_of_reading_volume(volume_id)
    or user_id = auth.uid()
  );
