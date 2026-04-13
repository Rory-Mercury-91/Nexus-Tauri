-- =============================================================================
-- Catalogue tomes VF : clé AniList en plus de MAL (séries sans id MAL)
-- -----------------------------------------------------------------------------
-- Prérequis : colonne public.library_reading.anilist_media_id
--             (ex. script library_anilist_media_id_v1.sql).
-- À appliquer sur une base qui a déjà nexus_install_volumes_v2.sql (ancienne
-- variante avec mal_manga_id NOT NULL + unique (mal_manga_id, volume_number)).
-- Après migration : RPC upsert_manga_volume_catalog_row accepte p_anilist_media_id.
-- =============================================================================

-- 1) Colonne AniList + MAL nullable (lignes catalogue « AniList-only »)
alter table public.library_manga_volume_catalog
  add column if not exists anilist_media_id integer null;

alter table public.library_manga_volume_catalog
  drop constraint if exists library_manga_volume_catalog_mal_manga_id_volume_number_key;

alter table public.library_manga_volume_catalog
  alter column mal_manga_id drop not null;

-- Au moins une clé catalogue (MAL ou AniList)
alter table public.library_manga_volume_catalog
  drop constraint if exists library_manga_volume_catalog_mal_or_anilist_chk;

alter table public.library_manga_volume_catalog
  add constraint library_manga_volume_catalog_mal_or_anilist_chk
  check (
    (mal_manga_id is not null and mal_manga_id > 0)
    or (anilist_media_id is not null and anilist_media_id > 0)
  );

create unique index if not exists library_manga_volume_catalog_mal_vol_uq
  on public.library_manga_volume_catalog (mal_manga_id, volume_number)
  where mal_manga_id is not null and mal_manga_id > 0;

create unique index if not exists library_manga_volume_catalog_anilist_vol_uq
  on public.library_manga_volume_catalog (anilist_media_id, volume_number)
  where anilist_media_id is not null and anilist_media_id > 0;

create index if not exists library_manga_volume_catalog_anilist_idx
  on public.library_manga_volume_catalog (anilist_media_id, volume_number)
  where anilist_media_id is not null;

comment on column public.library_manga_volume_catalog.anilist_media_id is
  'Si renseigné (sans MAL), ligne catalogue pour imports / tomes AniList-only.';

-- 2) RPC : merge par MAL ou par AniList (select + insert/update, pas ON CONFLICT)
drop function if exists public.upsert_manga_volume_catalog_row(
  integer, integer, text, text, date, numeric, text, jsonb
);

create or replace function public.upsert_manga_volume_catalog_row(
  p_mal_manga_id integer default null,
  p_volume_number integer default null,
  p_volume_type text default 'standard',
  p_image_url text default null,
  p_release_date_vf date default null,
  p_price_euros numeric default 0,
  p_source text default 'manual',
  p_import_payload jsonb default null,
  p_anilist_media_id integer default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_use_mal boolean;
  v_use_ani boolean;
begin
  v_use_mal := p_mal_manga_id is not null and p_mal_manga_id > 0;
  v_use_ani := p_anilist_media_id is not null and p_anilist_media_id > 0;

  if p_volume_number is null or p_volume_number <= 0 then
    raise exception 'volume_number requis';
  end if;

  if v_use_mal and v_use_ani then
    v_use_ani := false;
  end if;

  if not v_use_mal and not v_use_ani then
    raise exception 'mal_manga_id ou anilist_media_id requis';
  end if;

  if v_use_mal then
    select c.id into v_id
    from public.library_manga_volume_catalog c
    where c.mal_manga_id = p_mal_manga_id
      and c.volume_number = p_volume_number
    limit 1;

    if v_id is not null then
      update public.library_manga_volume_catalog c
      set
        volume_type = coalesce(nullif(trim(p_volume_type), ''), c.volume_type),
        image_url = coalesce(p_image_url, c.image_url),
        release_date_vf = coalesce(p_release_date_vf, c.release_date_vf),
        price_euros = case
          when coalesce(p_price_euros, 0) > 0 then greatest(coalesce(p_price_euros, 0), 0)
          else c.price_euros
        end,
        source = coalesce(nullif(trim(p_source), ''), c.source),
        import_payload = coalesce(p_import_payload, c.import_payload),
        updated_at = now()
      where c.id = v_id;
      return v_id;
    end if;

    insert into public.library_manga_volume_catalog (
      mal_manga_id,
      anilist_media_id,
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
      null,
      p_volume_number,
      coalesce(nullif(trim(p_volume_type), ''), 'standard'),
      p_image_url,
      p_release_date_vf,
      greatest(coalesce(p_price_euros, 0), 0),
      coalesce(nullif(trim(p_source), ''), 'manual'),
      p_import_payload,
      auth.uid()
    )
    returning id into v_id;

    return v_id;
  end if;

  -- Branche AniList-only
  select c.id into v_id
  from public.library_manga_volume_catalog c
  where c.anilist_media_id = p_anilist_media_id
    and c.volume_number = p_volume_number
  limit 1;

  if v_id is not null then
    update public.library_manga_volume_catalog c
    set
      volume_type = coalesce(nullif(trim(p_volume_type), ''), c.volume_type),
      image_url = coalesce(p_image_url, c.image_url),
      release_date_vf = coalesce(p_release_date_vf, c.release_date_vf),
      price_euros = case
        when coalesce(p_price_euros, 0) > 0 then greatest(coalesce(p_price_euros, 0), 0)
        else c.price_euros
      end,
      source = coalesce(nullif(trim(p_source), ''), c.source),
      import_payload = coalesce(p_import_payload, c.import_payload),
      updated_at = now()
    where c.id = v_id;
    return v_id;
  end if;

  insert into public.library_manga_volume_catalog (
    mal_manga_id,
    anilist_media_id,
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
    null,
    p_anilist_media_id,
    p_volume_number,
    coalesce(nullif(trim(p_volume_type), ''), 'standard'),
    p_image_url,
    p_release_date_vf,
    greatest(coalesce(p_price_euros, 0), 0),
    coalesce(nullif(trim(p_source), ''), 'manual'),
    p_import_payload,
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.upsert_manga_volume_catalog_row(
  integer, integer, text, text, date, numeric, text, jsonb, integer
) to authenticated;

-- 3) Vue résolue : possession partagée aussi pour le même id AniList catalogue
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
    where o.user_id <> r.user_id
      and o.family_id in (select public.user_family_ids())
      and (
        (r.mal_manga_id is not null and r.mal_manga_id > 0 and c.mal_manga_id = r.mal_manga_id)
        or (
          r.anilist_media_id is not null
          and r.anilist_media_id > 0
          and c.anilist_media_id is not null
          and c.anilist_media_id = r.anilist_media_id
        )
      )
  ) as has_shared_possession
from public.library_reading r
left join public.library_reading_public rp
  on rp.mal_manga_id = r.mal_manga_id;

grant select on public.library_reading_resolved_v1 to authenticated;

comment on view public.library_reading_resolved_v1 is
  'Lecture user + métadonnées public + possession partagée (foyer, catalogue v2, MAL ou AniList).';
