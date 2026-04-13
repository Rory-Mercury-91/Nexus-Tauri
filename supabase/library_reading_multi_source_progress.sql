-- =============================================================================
-- Progression multi-sources (MAL / AniList / Mihon / Nexus) — évite l’écrasement
-- du statut canonique : chaque source écrit sa tranche dans un jsonb ; le
-- `read_status` / `watch_status` affiché est recalculé selon la priorité profil.
-- Exécuter après library_mal.sql et families_storage_avatars.sql (profiles existe).
-- =============================================================================

alter table public.profiles
  add column if not exists library_list_status_priority text[]
  not null default array['mal','anilist','mihon','nexus']::text[];

comment on column public.profiles.library_list_status_priority is
  'Réservé (extensions futures). La résolution canonique suit : Nexus si chapitres/épisodes > max(MAL,AniList), sinon MAL, sinon AniList, sinon Mihon si pas de distant, sinon Nexus.';

alter table public.library_reading
  add column if not exists reading_progress_by_source jsonb not null default '{}'::jsonb;

comment on column public.library_reading.reading_progress_by_source is
  'Progression par source : mal, anilist, mihon, nexus — chaque clé peut contenir read_status, updated_at, etc.';

alter table public.library_anime
  add column if not exists watch_progress_by_source jsonb not null default '{}'::jsonb;

comment on column public.library_anime.watch_progress_by_source is
  'Progression visionnage par source : mal, anilist, nexus — watch_status par source.';

-- Rétrocompat : copier le statut actuel comme source « nexus » (état déjà affiché).
update public.library_reading
set reading_progress_by_source = jsonb_build_object(
  'nexus',
  jsonb_build_object(
    'read_status',
    read_status,
    'updated_at',
    coalesce(updated_at, now())
  )
)
where reading_progress_by_source = '{}'::jsonb
  and read_status is not null;

update public.library_anime
set watch_progress_by_source = jsonb_build_object(
  'nexus',
  jsonb_build_object(
    'watch_status',
    watch_status,
    'updated_at',
    coalesce(updated_at, now())
  )
)
where watch_progress_by_source = '{}'::jsonb
  and watch_status is not null;
