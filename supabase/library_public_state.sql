-- =============================================================================
-- Nexus-Tauri — Modèle d'état public/family/user (migration non destructive)
-- -----------------------------------------------------------------------------
-- Objectif:
-- - public: métadonnées globales 1 ligne par oeuvre (anime / lecture)
-- - user:   conserve les états personnels (tables library_* existantes)
-- - family: possession/coût (modèle tomes v2 : nexus_install_volumes_v2.sql)
--
-- Cette migration n'altère pas les flux actuels: elle ajoute des tables + triggers
-- pour consolider les métadonnées publiques automatiquement depuis l'existant.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) CATALOGUE PUBLIC ANIME
-- -----------------------------------------------------------------------------
create table if not exists public.library_anime_public (
  mal_id integer primary key,
  title text not null,
  title_english text,
  main_picture_url text,
  jikan_snapshot jsonb not null default '{}'::jsonb,
  jikan_snapshot_at timestamptz,
  mal_official_snapshot jsonb not null default '{}'::jsonb,
  mal_official_snapshot_at timestamptz,
  source_tag text not null default 'user_sync',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists library_anime_public_updated_idx
  on public.library_anime_public (updated_at desc);

drop trigger if exists library_anime_public_set_updated_at on public.library_anime_public;
create trigger library_anime_public_set_updated_at
  before update on public.library_anime_public
  for each row execute function public.set_updated_at();

alter table public.library_anime_public enable row level security;

drop policy if exists "library_anime_public_select_authenticated" on public.library_anime_public;
create policy "library_anime_public_select_authenticated"
  on public.library_anime_public for select
  using (auth.role() = 'authenticated');

-- -----------------------------------------------------------------------------
-- 2) CATALOGUE PUBLIC LECTURE
-- -----------------------------------------------------------------------------
create table if not exists public.library_reading_public (
  mal_manga_id integer primary key,
  title text not null,
  title_english text,
  main_picture_url text,
  jikan_snapshot jsonb not null default '{}'::jsonb,
  jikan_snapshot_at timestamptz,
  mal_official_snapshot jsonb not null default '{}'::jsonb,
  mal_official_snapshot_at timestamptz,
  source_tag text not null default 'user_sync',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists library_reading_public_updated_idx
  on public.library_reading_public (updated_at desc);

drop trigger if exists library_reading_public_set_updated_at on public.library_reading_public;
create trigger library_reading_public_set_updated_at
  before update on public.library_reading_public
  for each row execute function public.set_updated_at();

alter table public.library_reading_public enable row level security;

drop policy if exists "library_reading_public_select_authenticated" on public.library_reading_public;
create policy "library_reading_public_select_authenticated"
  on public.library_reading_public for select
  using (auth.role() = 'authenticated');

-- -----------------------------------------------------------------------------
-- 3) FONCTIONS UPSERT CATALOGUE PUBLIC DEPUIS L'ETAT USER
-- -----------------------------------------------------------------------------
drop function if exists public.upsert_anime_public_from_user_row(public.library_anime);
create or replace function public.upsert_anime_public_from_user_row(
  p_row public.library_anime
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_row.mal_id is null then
    return;
  end if;

  insert into public.library_anime_public (
    mal_id,
    title,
    title_english,
    main_picture_url,
    jikan_snapshot,
    jikan_snapshot_at,
    mal_official_snapshot,
    mal_official_snapshot_at,
    source_tag
  )
  values (
    p_row.mal_id,
    p_row.title,
    p_row.title_english,
    p_row.main_picture_url,
    coalesce(p_row.jikan_snapshot, '{}'::jsonb),
    p_row.jikan_snapshot_at,
    coalesce(p_row.mal_official_snapshot, '{}'::jsonb),
    p_row.mal_official_snapshot_at,
    'user_sync'
  )
  on conflict (mal_id) do update
    set title = coalesce(excluded.title, library_anime_public.title),
        title_english = coalesce(excluded.title_english, library_anime_public.title_english),
        main_picture_url = coalesce(excluded.main_picture_url, library_anime_public.main_picture_url),
        jikan_snapshot =
          case
            when coalesce(excluded.jikan_snapshot_at, '-infinity'::timestamptz)
                 >= coalesce(library_anime_public.jikan_snapshot_at, '-infinity'::timestamptz)
              then excluded.jikan_snapshot
            else library_anime_public.jikan_snapshot
          end,
        jikan_snapshot_at = greatest(
          coalesce(excluded.jikan_snapshot_at, '-infinity'::timestamptz),
          coalesce(library_anime_public.jikan_snapshot_at, '-infinity'::timestamptz)
        ),
        mal_official_snapshot =
          case
            when coalesce(excluded.mal_official_snapshot_at, '-infinity'::timestamptz)
                 >= coalesce(library_anime_public.mal_official_snapshot_at, '-infinity'::timestamptz)
              then excluded.mal_official_snapshot
            else library_anime_public.mal_official_snapshot
          end,
        mal_official_snapshot_at = greatest(
          coalesce(excluded.mal_official_snapshot_at, '-infinity'::timestamptz),
          coalesce(library_anime_public.mal_official_snapshot_at, '-infinity'::timestamptz)
        ),
        source_tag = 'user_sync',
        updated_at = now();
end;
$$;

-- Pousse la ligne canonique (library_reading_public) vers toutes les fiches
-- library_reading du même mal_manga_id. Préserve list_entry (progression MAL liste)
-- sur chaque fiche utilisateur ; read_status / user_notes / is_favorite inchangés.
drop function if exists public.propagate_reading_public_to_user_rows(integer);
create or replace function public.propagate_reading_public_to_user_rows(p_mal_manga_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_mal_manga_id is null then
    return;
  end if;

  if not exists (
    select 1 from public.library_reading_public rp where rp.mal_manga_id = p_mal_manga_id
  ) then
    return;
  end if;

  perform set_config('app.skip_reading_public_sync', '1', true);

  update public.library_reading lr
  set
    title = rp.title,
    title_english = rp.title_english,
    main_picture_url = rp.main_picture_url,
    jikan_snapshot = coalesce(rp.jikan_snapshot, '{}'::jsonb),
    jikan_snapshot_at = rp.jikan_snapshot_at,
    mal_official_snapshot = jsonb_set(
      coalesce(rp.mal_official_snapshot, '{}'::jsonb),
      '{list_entry}',
      coalesce(
        lr.mal_official_snapshot->'list_entry',
        rp.mal_official_snapshot->'list_entry'
      ),
      true
    ),
    mal_official_snapshot_at = rp.mal_official_snapshot_at
  from public.library_reading_public rp
  where rp.mal_manga_id = p_mal_manga_id
    and lr.mal_manga_id = p_mal_manga_id;

  perform set_config('app.skip_reading_public_sync', '', true);
end;
$$;

drop function if exists public.upsert_reading_public_from_user_row(public.library_reading);
create or replace function public.upsert_reading_public_from_user_row(
  p_row public.library_reading
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_row.mal_manga_id is null then
    return;
  end if;

  insert into public.library_reading_public (
    mal_manga_id,
    title,
    title_english,
    main_picture_url,
    jikan_snapshot,
    jikan_snapshot_at,
    mal_official_snapshot,
    mal_official_snapshot_at,
    source_tag
  )
  values (
    p_row.mal_manga_id,
    p_row.title,
    p_row.title_english,
    p_row.main_picture_url,
    coalesce(p_row.jikan_snapshot, '{}'::jsonb),
    p_row.jikan_snapshot_at,
    coalesce(p_row.mal_official_snapshot, '{}'::jsonb),
    p_row.mal_official_snapshot_at,
    'user_sync'
  )
  on conflict (mal_manga_id) do update
    set title = coalesce(excluded.title, library_reading_public.title),
        title_english = coalesce(excluded.title_english, library_reading_public.title_english),
        main_picture_url = coalesce(excluded.main_picture_url, library_reading_public.main_picture_url),
        jikan_snapshot =
          case
            when coalesce(excluded.jikan_snapshot_at, '-infinity'::timestamptz)
                 >= coalesce(library_reading_public.jikan_snapshot_at, '-infinity'::timestamptz)
              then excluded.jikan_snapshot
            else library_reading_public.jikan_snapshot
          end,
        jikan_snapshot_at = greatest(
          coalesce(excluded.jikan_snapshot_at, '-infinity'::timestamptz),
          coalesce(library_reading_public.jikan_snapshot_at, '-infinity'::timestamptz)
        ),
        mal_official_snapshot =
          case
            when coalesce(excluded.mal_official_snapshot_at, '-infinity'::timestamptz)
                 >= coalesce(library_reading_public.mal_official_snapshot_at, '-infinity'::timestamptz)
              then excluded.mal_official_snapshot
            else library_reading_public.mal_official_snapshot
          end,
        mal_official_snapshot_at = greatest(
          coalesce(excluded.mal_official_snapshot_at, '-infinity'::timestamptz),
          coalesce(library_reading_public.mal_official_snapshot_at, '-infinity'::timestamptz)
        ),
        source_tag = 'user_sync',
        updated_at = now();

  perform public.propagate_reading_public_to_user_rows(p_row.mal_manga_id);
end;
$$;

grant execute on function public.upsert_anime_public_from_user_row(public.library_anime) to authenticated;
grant execute on function public.upsert_reading_public_from_user_row(public.library_reading) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) TRIGGERS AUTO (sync user -> public)
-- -----------------------------------------------------------------------------
drop trigger if exists library_anime_sync_public_after_write on public.library_anime;
drop function if exists public.trg_sync_anime_public_from_user();
create or replace function public.trg_sync_anime_public_from_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.upsert_anime_public_from_user_row(new);
  return new;
end;
$$;

create trigger library_anime_sync_public_after_write
  after insert or update on public.library_anime
  for each row
  execute function public.trg_sync_anime_public_from_user();

drop trigger if exists library_reading_sync_public_after_write on public.library_reading;
drop function if exists public.trg_sync_reading_public_from_user();
create or replace function public.trg_sync_reading_public_from_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Évite boucle infinie : la propagation public → users réécrit library_reading.
  if coalesce(current_setting('app.skip_reading_public_sync', true), '') = '1' then
    return new;
  end if;
  perform public.upsert_reading_public_from_user_row(new);
  return new;
end;
$$;

create trigger library_reading_sync_public_after_write
  after insert or update on public.library_reading
  for each row
  execute function public.trg_sync_reading_public_from_user();

-- -----------------------------------------------------------------------------
-- 5) BACKFILL INITIAL
-- -----------------------------------------------------------------------------
insert into public.library_anime_public (
  mal_id, title, title_english, main_picture_url,
  jikan_snapshot, jikan_snapshot_at,
  mal_official_snapshot, mal_official_snapshot_at,
  source_tag
)
select distinct on (a.mal_id)
  a.mal_id,
  a.title,
  a.title_english,
  a.main_picture_url,
  coalesce(a.jikan_snapshot, '{}'::jsonb),
  a.jikan_snapshot_at,
  coalesce(a.mal_official_snapshot, '{}'::jsonb),
  a.mal_official_snapshot_at,
  'backfill'
from public.library_anime a
order by a.mal_id, coalesce(a.updated_at, a.created_at) desc
on conflict (mal_id) do nothing;

insert into public.library_reading_public (
  mal_manga_id, title, title_english, main_picture_url,
  jikan_snapshot, jikan_snapshot_at,
  mal_official_snapshot, mal_official_snapshot_at,
  source_tag
)
select distinct on (r.mal_manga_id)
  r.mal_manga_id,
  r.title,
  r.title_english,
  r.main_picture_url,
  coalesce(r.jikan_snapshot, '{}'::jsonb),
  r.jikan_snapshot_at,
  coalesce(r.mal_official_snapshot, '{}'::jsonb),
  r.mal_official_snapshot_at,
  'backfill'
from public.library_reading r
order by r.mal_manga_id, coalesce(r.updated_at, r.created_at) desc
on conflict (mal_manga_id) do nothing;

-- -----------------------------------------------------------------------------
-- 6) Vue library_reading_resolved_v1
-- -----------------------------------------------------------------------------
-- Créée dans nexus_install_volumes_v2.sql (nécessite library_manga_volume_catalog +
-- family_manga_volume_owner). Exécuter ce script APRÈS le présent fichier.

-- -----------------------------------------------------------------------------
-- 7) FONCTIONS CANONIQUES D'UPSERT (ANTI-DOUBLONS EN CONCURRENCE)
-- -----------------------------------------------------------------------------
-- Ces fonctions permettent d'écrire côté application avec une seule opération
-- atomique. Même si l'utilisateur clique plusieurs fois, l'UNIQUE + ON CONFLICT
-- garantissent une seule entrée par couple (user_id, mal_id).

drop function if exists public.upsert_library_reading_entry(
  integer, text, text, text, jsonb, timestamptz, jsonb, timestamptz, text, text
);
create or replace function public.upsert_library_reading_entry(
  p_mal_manga_id integer,
  p_title text default '',
  p_title_english text default null,
  p_main_picture_url text default null,
  p_jikan_snapshot jsonb default '{}'::jsonb,
  p_jikan_snapshot_at timestamptz default null,
  p_mal_official_snapshot jsonb default '{}'::jsonb,
  p_mal_official_snapshot_at timestamptz default null,
  p_read_status text default null,
  p_user_notes text default null
) returns public.library_reading
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.library_reading;
begin
  if p_mal_manga_id is null then
    raise exception 'p_mal_manga_id est requis';
  end if;

  insert into public.library_reading (
    user_id,
    mal_manga_id,
    title,
    title_english,
    main_picture_url,
    jikan_snapshot,
    jikan_snapshot_at,
    mal_official_snapshot,
    mal_official_snapshot_at,
    read_status,
    user_notes
  )
  values (
    auth.uid(),
    p_mal_manga_id,
    coalesce(nullif(trim(p_title), ''), format('MAL #%s', p_mal_manga_id)),
    p_title_english,
    p_main_picture_url,
    coalesce(p_jikan_snapshot, '{}'::jsonb),
    p_jikan_snapshot_at,
    coalesce(p_mal_official_snapshot, '{}'::jsonb),
    p_mal_official_snapshot_at,
    p_read_status,
    coalesce(p_user_notes, '')
  )
  on conflict (user_id, mal_manga_id) do update
    set title = excluded.title,
        title_english = coalesce(excluded.title_english, library_reading.title_english),
        main_picture_url = coalesce(excluded.main_picture_url, library_reading.main_picture_url),
        jikan_snapshot = coalesce(excluded.jikan_snapshot, library_reading.jikan_snapshot),
        jikan_snapshot_at = greatest(
          coalesce(excluded.jikan_snapshot_at, '-infinity'::timestamptz),
          coalesce(library_reading.jikan_snapshot_at, '-infinity'::timestamptz)
        ),
        mal_official_snapshot = coalesce(excluded.mal_official_snapshot, library_reading.mal_official_snapshot),
        mal_official_snapshot_at = greatest(
          coalesce(excluded.mal_official_snapshot_at, '-infinity'::timestamptz),
          coalesce(library_reading.mal_official_snapshot_at, '-infinity'::timestamptz)
        ),
        read_status = coalesce(excluded.read_status, library_reading.read_status),
        user_notes = coalesce(excluded.user_notes, library_reading.user_notes),
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.upsert_library_reading_entry(
  integer, text, text, text, jsonb, timestamptz, jsonb, timestamptz, text, text
) to authenticated;

drop function if exists public.upsert_library_anime_entry(
  integer, text, text, text, jsonb, timestamptz, jsonb, timestamptz, text, boolean, text
);
create or replace function public.upsert_library_anime_entry(
  p_mal_id integer,
  p_title text default '',
  p_title_english text default null,
  p_main_picture_url text default null,
  p_jikan_snapshot jsonb default '{}'::jsonb,
  p_jikan_snapshot_at timestamptz default null,
  p_mal_official_snapshot jsonb default '{}'::jsonb,
  p_mal_official_snapshot_at timestamptz default null,
  p_watch_status text default null,
  p_is_favorite boolean default null,
  p_user_notes text default null
) returns public.library_anime
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.library_anime;
begin
  if p_mal_id is null then
    raise exception 'p_mal_id est requis';
  end if;

  insert into public.library_anime (
    user_id,
    mal_id,
    title,
    title_english,
    main_picture_url,
    jikan_snapshot,
    jikan_snapshot_at,
    mal_official_snapshot,
    mal_official_snapshot_at,
    watch_status,
    is_favorite,
    user_notes
  )
  values (
    auth.uid(),
    p_mal_id,
    coalesce(nullif(trim(p_title), ''), format('MAL #%s', p_mal_id)),
    p_title_english,
    p_main_picture_url,
    coalesce(p_jikan_snapshot, '{}'::jsonb),
    p_jikan_snapshot_at,
    coalesce(p_mal_official_snapshot, '{}'::jsonb),
    p_mal_official_snapshot_at,
    p_watch_status,
    coalesce(p_is_favorite, false),
    coalesce(p_user_notes, '')
  )
  on conflict (user_id, mal_id) do update
    set title = excluded.title,
        title_english = coalesce(excluded.title_english, library_anime.title_english),
        main_picture_url = coalesce(excluded.main_picture_url, library_anime.main_picture_url),
        jikan_snapshot = coalesce(excluded.jikan_snapshot, library_anime.jikan_snapshot),
        jikan_snapshot_at = greatest(
          coalesce(excluded.jikan_snapshot_at, '-infinity'::timestamptz),
          coalesce(library_anime.jikan_snapshot_at, '-infinity'::timestamptz)
        ),
        mal_official_snapshot = coalesce(excluded.mal_official_snapshot, library_anime.mal_official_snapshot),
        mal_official_snapshot_at = greatest(
          coalesce(excluded.mal_official_snapshot_at, '-infinity'::timestamptz),
          coalesce(library_anime.mal_official_snapshot_at, '-infinity'::timestamptz)
        ),
        watch_status = coalesce(excluded.watch_status, library_anime.watch_status),
        is_favorite = coalesce(excluded.is_favorite, library_anime.is_favorite),
        user_notes = coalesce(excluded.user_notes, library_anime.user_notes),
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.upsert_library_anime_entry(
  integer, text, text, text, jsonb, timestamptz, jsonb, timestamptz, text, boolean, text
) to authenticated;

comment on function public.upsert_library_reading_entry(
  integer, text, text, text, jsonb, timestamptz, jsonb, timestamptz, text, text
) is
  'Upsert atomique d''une entrée lecture utilisateur (anti-doublons user_id+mal_manga_id).';

comment on function public.upsert_library_anime_entry(
  integer, text, text, text, jsonb, timestamptz, jsonb, timestamptz, text, boolean, text
) is
  'Upsert atomique d''une entrée anime utilisateur (anti-doublons user_id+mal_id).';

drop function if exists public.upsert_reading_mihon_presence(
  uuid, integer, integer, text, text, boolean
);
create or replace function public.upsert_reading_mihon_presence(
  p_reading_id uuid,
  p_chapters_read integer default 0,
  p_chapters_total integer default 0,
  p_source_id text default null,
  p_source_url text default null,
  p_prefer_mihon_progress boolean default true
) returns public.reading_mihon_presence
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.reading_mihon_presence;
begin
  if p_reading_id is null then
    raise exception 'p_reading_id est requis';
  end if;

  insert into public.reading_mihon_presence (
    reading_id,
    user_id,
    chapters_read,
    chapters_total,
    source_id,
    source_url,
    prefer_mihon_progress
  )
  values (
    p_reading_id,
    auth.uid(),
    greatest(coalesce(p_chapters_read, 0), 0),
    greatest(coalesce(p_chapters_total, 0), 0),
    p_source_id,
    p_source_url,
    coalesce(p_prefer_mihon_progress, true)
  )
  on conflict (reading_id, user_id) do update
    set chapters_read = excluded.chapters_read,
        chapters_total = excluded.chapters_total,
        source_id = coalesce(excluded.source_id, reading_mihon_presence.source_id),
        source_url = coalesce(excluded.source_url, reading_mihon_presence.source_url),
        prefer_mihon_progress = excluded.prefer_mihon_progress,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.upsert_reading_mihon_presence(
  uuid, integer, integer, text, text, boolean
) to authenticated;

comment on function public.upsert_reading_mihon_presence(
  uuid, integer, integer, text, text, boolean
) is
  'Upsert atomique de la présence Mihon (anti-doublons reading_id+user_id).';
