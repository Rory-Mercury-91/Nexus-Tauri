-- =============================================================================
-- Nexus-Tauri — Installation « tomes v2 » (catalogue global + foyer + perso)
-- -----------------------------------------------------------------------------
-- À exécuter APRÈS : init.sql, families_storage_avatars.sql, library_mal.sql,
--                   reading_mihon_presence.sql, library_public_state.sql
--
-- Ce script :
--   1) Supprime l’ancien modèle reading_volumes / reading_volume_owners
--   2) Supprime les fonctions RPC de synchro inter-fiches (v1)
--   3) Recrée la vue library_reading_resolved_v1 (sans dépendre des anciennes tables)
--   4) Crée le catalogue tomes + possession foyer + état perso
--   5) Ajoute RPC d’upsert catalogue (merge collaboratif) + refresh snapshot MAL
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) Nettoyage schéma v1 (tomes dupliqués par reading_id)
-- -----------------------------------------------------------------------------
-- Ne pas utiliser DROP POLICY / DROP TRIGGER sur ces tables : si elles n’ont
-- jamais existé (base neuve sans reading_volumes.sql), la commande échoue.
-- CASCADE sur la table supprime policies, triggers et dépendances.
drop view if exists public.library_reading_resolved_v1;

drop table if exists public.reading_volume_owners cascade;
drop table if exists public.reading_volumes cascade;

drop function if exists public.sync_reading_volume_to_family_peers(uuid, integer, uuid);
drop function if exists public.refresh_reading_mal_snapshot_volumes_read(uuid);
drop function if exists public.user_is_owner_of_reading_volume(uuid);

-- -----------------------------------------------------------------------------
-- B) Catalogue tomes VF (global par mal_manga_id + n°)
-- -----------------------------------------------------------------------------
create table if not exists public.library_manga_volume_catalog (
  id uuid primary key default gen_random_uuid(),
  mal_manga_id integer not null,
  volume_number integer not null check (volume_number > 0),
  volume_type text not null default 'standard',
  image_url text,
  release_date_vf date,
  price_euros numeric(10, 2) not null default 0 check (price_euros >= 0),
  source text not null default 'manual',
  import_payload jsonb,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mal_manga_id, volume_number)
);

comment on table public.library_manga_volume_catalog is
  'Catalogue VF : une ligne par (mal_manga_id, volume_number). Import Nautiljon / saisie.';

create index if not exists library_manga_volume_catalog_mal_idx
  on public.library_manga_volume_catalog (mal_manga_id, volume_number);

drop trigger if exists library_manga_volume_catalog_set_updated_at
  on public.library_manga_volume_catalog;
create trigger library_manga_volume_catalog_set_updated_at
  before update on public.library_manga_volume_catalog
  for each row execute function public.set_updated_at();

alter table public.library_manga_volume_catalog enable row level security;

drop policy if exists "library_manga_volume_catalog_select_auth"
  on public.library_manga_volume_catalog;
create policy "library_manga_volume_catalog_select_auth"
  on public.library_manga_volume_catalog for select
  using (auth.role() = 'authenticated');

-- Écriture catalogue via RPC uniquement (merge sans doublon, tout utilisateur connecté)
drop policy if exists "library_manga_volume_catalog_insert_auth"
  on public.library_manga_volume_catalog;
drop policy if exists "library_manga_volume_catalog_update_creator"
  on public.library_manga_volume_catalog;

-- -----------------------------------------------------------------------------
-- C) Possession / parts — foyer (référence catalogue)
-- -----------------------------------------------------------------------------
create table if not exists public.family_manga_volume_owner (
  family_id uuid not null references public.families (id) on delete cascade,
  catalog_volume_id uuid not null references public.library_manga_volume_catalog (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  share_euros numeric(10, 2) not null default 0 check (share_euros >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (family_id, catalog_volume_id, user_id)
);

comment on table public.family_manga_volume_owner is
  'Co-propriétaires et parts € par tome catalogue, au niveau du foyer.';

create index if not exists family_manga_volume_owner_family_idx
  on public.family_manga_volume_owner (family_id);

drop trigger if exists family_manga_volume_owner_set_updated_at
  on public.family_manga_volume_owner;
create trigger family_manga_volume_owner_set_updated_at
  before update on public.family_manga_volume_owner
  for each row execute function public.set_updated_at();

alter table public.family_manga_volume_owner enable row level security;

drop policy if exists "family_manga_volume_owner_select_family"
  on public.family_manga_volume_owner;
create policy "family_manga_volume_owner_select_family"
  on public.family_manga_volume_owner for select
  using (family_id in (select public.user_family_ids()));

drop policy if exists "family_manga_volume_owner_write_family"
  on public.family_manga_volume_owner;
create policy "family_manga_volume_owner_write_family"
  on public.family_manga_volume_owner for insert
  with check (family_id in (select public.user_family_ids()));

drop policy if exists "family_manga_volume_owner_update_family"
  on public.family_manga_volume_owner;
create policy "family_manga_volume_owner_update_family"
  on public.family_manga_volume_owner for update
  using (family_id in (select public.user_family_ids()))
  with check (family_id in (select public.user_family_ids()));

drop policy if exists "family_manga_volume_owner_delete_family"
  on public.family_manga_volume_owner;
create policy "family_manga_volume_owner_delete_family"
  on public.family_manga_volume_owner for delete
  using (family_id in (select public.user_family_ids()));

-- -----------------------------------------------------------------------------
-- D) État perso (library_reading + tome catalogue)
-- -----------------------------------------------------------------------------
create table if not exists public.user_manga_volume_state (
  id uuid primary key default gen_random_uuid(),
  reading_id uuid not null references public.library_reading (id) on delete cascade,
  catalog_volume_id uuid not null references public.library_manga_volume_catalog (id) on delete cascade,
  is_owned boolean not null default false,
  is_read boolean not null default false,
  is_mihon boolean not null default false,
  purchase_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reading_id, catalog_volume_id)
);

comment on table public.user_manga_volume_state is
  'Lu / Mihon / possédé perso / date d’achat — par entrée library_reading.';

create index if not exists user_manga_volume_state_reading_idx
  on public.user_manga_volume_state (reading_id);

drop trigger if exists user_manga_volume_state_set_updated_at
  on public.user_manga_volume_state;
create trigger user_manga_volume_state_set_updated_at
  before update on public.user_manga_volume_state
  for each row execute function public.set_updated_at();

alter table public.user_manga_volume_state enable row level security;

drop policy if exists "user_manga_volume_state_select_own_reading"
  on public.user_manga_volume_state;
create policy "user_manga_volume_state_select_own_reading"
  on public.user_manga_volume_state for select
  using (
    exists (
      select 1 from public.library_reading lr
      where lr.id = user_manga_volume_state.reading_id
        and lr.user_id = auth.uid()
    )
  );

drop policy if exists "user_manga_volume_state_insert_own_reading"
  on public.user_manga_volume_state;
create policy "user_manga_volume_state_insert_own_reading"
  on public.user_manga_volume_state for insert
  with check (
    exists (
      select 1 from public.library_reading lr
      where lr.id = user_manga_volume_state.reading_id
        and lr.user_id = auth.uid()
    )
  );

drop policy if exists "user_manga_volume_state_update_own_reading"
  on public.user_manga_volume_state;
create policy "user_manga_volume_state_update_own_reading"
  on public.user_manga_volume_state for update
  using (
    exists (
      select 1 from public.library_reading lr
      where lr.id = user_manga_volume_state.reading_id
        and lr.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.library_reading lr
      where lr.id = user_manga_volume_state.reading_id
        and lr.user_id = auth.uid()
    )
  );

drop policy if exists "user_manga_volume_state_delete_own_reading"
  on public.user_manga_volume_state;
create policy "user_manga_volume_state_delete_own_reading"
  on public.user_manga_volume_state for delete
  using (
    exists (
      select 1 from public.library_reading lr
      where lr.id = user_manga_volume_state.reading_id
        and lr.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- E) Snapshot MAL : nombre de volumes lus (depuis user_manga_volume_state)
-- -----------------------------------------------------------------------------
create or replace function public.refresh_reading_mal_snapshot_volumes_read(p_reading_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_snap jsonb;
  v_list jsonb;
  v_list_status jsonb;
begin
  select count(*)::int into v_count
  from public.user_manga_volume_state u
  where u.reading_id = p_reading_id
    and u.is_read = true;

  select mal_official_snapshot into v_snap
  from public.library_reading
  where id = p_reading_id;

  if not found then
    return;
  end if;

  v_snap := coalesce(v_snap, '{}'::jsonb);
  v_list := coalesce(v_snap->'list_entry', '{}'::jsonb);
  v_list_status := coalesce(v_list->'list_status', '{}'::jsonb);
  v_list_status := jsonb_set(v_list_status, '{num_volumes_read}', to_jsonb(v_count), true);
  v_list := jsonb_set(v_list, '{list_status}', v_list_status);
  v_snap := jsonb_set(v_snap, '{list_entry}', v_list);

  update public.library_reading
  set mal_official_snapshot = v_snap,
      updated_at = now()
  where id = p_reading_id;
end;
$$;

grant execute on function public.refresh_reading_mal_snapshot_volumes_read(uuid) to authenticated;

drop trigger if exists user_manga_volume_state_refresh_mal_after on public.user_manga_volume_state;
drop function if exists public.trg_user_manga_volume_state_refresh_mal();

create or replace function public.trg_user_manga_volume_state_refresh_mal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_reading_mal_snapshot_volumes_read(coalesce(new.reading_id, old.reading_id));
  return coalesce(new, old);
end;
$$;

create trigger user_manga_volume_state_refresh_mal_after
  after insert or update or delete on public.user_manga_volume_state
  for each row execute function public.trg_user_manga_volume_state_refresh_mal();

-- -----------------------------------------------------------------------------
-- F) RPC : upsert catalogue (merge collaboratif, tout utilisateur authentifié)
-- -----------------------------------------------------------------------------
drop function if exists public.upsert_manga_volume_catalog_row(
  integer, integer, text, text, date, numeric, text, jsonb
);

create or replace function public.upsert_manga_volume_catalog_row(
  p_mal_manga_id integer,
  p_volume_number integer,
  p_volume_type text default 'standard',
  p_image_url text default null,
  p_release_date_vf date default null,
  p_price_euros numeric default 0,
  p_source text default 'manual',
  p_import_payload jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_mal_manga_id is null or p_volume_number is null or p_volume_number <= 0 then
    raise exception 'mal_manga_id et volume_number requis';
  end if;

  insert into public.library_manga_volume_catalog (
    mal_manga_id,
    volume_number,
    volume_type,
    image_url,
    release_date_vf,
    price_euros,
    source,
    import_payload,
    created_by
  )
  values (
    p_mal_manga_id,
    p_volume_number,
    coalesce(nullif(trim(p_volume_type), ''), 'standard'),
    p_image_url,
    p_release_date_vf,
    greatest(coalesce(p_price_euros, 0), 0),
    coalesce(nullif(trim(p_source), ''), 'manual'),
    p_import_payload,
    auth.uid()
  )
  on conflict (mal_manga_id, volume_number) do update set
    volume_type = coalesce(excluded.volume_type, library_manga_volume_catalog.volume_type),
    image_url = coalesce(excluded.image_url, library_manga_volume_catalog.image_url),
    release_date_vf = coalesce(excluded.release_date_vf, library_manga_volume_catalog.release_date_vf),
    price_euros = case
      when excluded.price_euros > 0 then excluded.price_euros
      else library_manga_volume_catalog.price_euros
    end,
    source = excluded.source,
    import_payload = coalesce(excluded.import_payload, library_manga_volume_catalog.import_payload),
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.upsert_manga_volume_catalog_row(
  integer, integer, text, text, date, numeric, text, jsonb
) to authenticated;

-- -----------------------------------------------------------------------------
-- G) Vue résolue (indicateur possession partagée = autre membre du foyer sur ce manga)
-- -----------------------------------------------------------------------------
create or replace view public.library_reading_resolved_v1
with (security_invoker = true) as
select
  r.id,
  r.user_id,
  r.mal_manga_id,
  coalesce(r.title, rp.title) as user_title,
  rp.title as public_title,
  rp.title_english as public_title_english,
  coalesce(r.main_picture_url, rp.main_picture_url) as image_url,
  r.read_status,
  r.user_notes,
  r.created_at,
  r.updated_at,
  rp.updated_at as public_updated_at,
  rp.jikan_snapshot as public_jikan_snapshot,
  rp.mal_official_snapshot as public_mal_official_snapshot,
  exists (
    select 1
    from public.family_manga_volume_owner o
    join public.library_manga_volume_catalog c on c.id = o.catalog_volume_id
    where c.mal_manga_id = r.mal_manga_id
      and o.user_id <> r.user_id
      and o.family_id in (select public.user_family_ids())
  ) as has_shared_possession
from public.library_reading r
left join public.library_reading_public rp
  on rp.mal_manga_id = r.mal_manga_id;

grant select on public.library_reading_resolved_v1 to authenticated;

comment on view public.library_reading_resolved_v1 is
  'Lecture user + métadonnées public + possession partagée (foyer, catalogue v2).';

-- =============================================================================
-- Fin installation tomes v2 — Mettre à jour l’app (services + UI) en conséquence.
-- =============================================================================
