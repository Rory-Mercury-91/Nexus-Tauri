-- =============================================================================
-- Migration : propagation library_reading_public → toutes les fiches library_reading
-- -----------------------------------------------------------------------------
-- Contexte : une seule ligne canonique par mal_manga_id (library_reading_public).
-- Après chaque merge user → public, on recopie les métadonnées partagées vers
-- toutes les entrées library_reading du même manga (autres comptes / foyer).
--
-- Préservé par utilisateur : read_status, user_notes, is_favorite, id, user_id.
-- Préservé dans mal_official_snapshot : list_entry (progression / liste MAL).
--
-- À exécuter une fois sur une base qui a déjà library_public_state.sql sans cette
-- logique. Les nouveaux déploiements incluent ce code dans library_public_state.sql.
-- =============================================================================

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

drop trigger if exists library_reading_sync_public_after_write on public.library_reading;
drop function if exists public.trg_sync_reading_public_from_user();
create or replace function public.trg_sync_reading_public_from_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

-- Aligner immédiatement toutes les fiches existantes sur le public courant (optionnel).
do $$
declare
  r record;
begin
  for r in select mal_manga_id from public.library_reading_public
  loop
    perform public.propagate_reading_public_to_user_rows(r.mal_manga_id);
  end loop;
end;
$$;
