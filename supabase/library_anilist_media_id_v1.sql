-- =============================================================================
-- Entrées AniList sans lien MAL (idMal absent) : anilist_media_id + MAL nullable
-- À exécuter après library_mal.sql / installs existantes.
-- =============================================================================

-- --- library_reading ---
alter table public.library_reading add column if not exists anilist_media_id integer;

alter table public.library_reading drop constraint if exists library_reading_user_mal_unique;

-- Index non-partiel : PostgreSQL autorise plusieurs NULL distincts, pas de conflit.
-- ON CONFLICT (user_id, mal_manga_id) fonctionne uniquement avec un index non-partiel.
create unique index if not exists library_reading_user_mal_unique
  on public.library_reading (user_id, mal_manga_id);

create unique index if not exists library_reading_user_anilist_unique
  on public.library_reading (user_id, anilist_media_id);

alter table public.library_reading alter column mal_manga_id drop not null;

alter table public.library_reading drop constraint if exists library_reading_mal_or_anilist_chk;

alter table public.library_reading
  add constraint library_reading_mal_or_anilist_chk
  check (mal_manga_id is not null or anilist_media_id is not null);

create index if not exists library_reading_anilist_idx on public.library_reading (anilist_media_id)
  where anilist_media_id is not null;

comment on column public.library_reading.anilist_media_id is
  'Identifiant média AniList quand aucun MAL ID (mal_manga_id null).';

comment on column public.library_reading.mal_manga_id is
  'Identifiant fiche manga MAL ; null si entrée uniquement AniList.';

-- --- library_anime ---
alter table public.library_anime add column if not exists anilist_media_id integer;

alter table public.library_anime drop constraint if exists library_anime_user_mal_unique;

-- Index non-partiel : compatible ON CONFLICT (user_id, mal_id).
create unique index if not exists library_anime_user_mal_unique
  on public.library_anime (user_id, mal_id);

create unique index if not exists library_anime_user_anilist_unique
  on public.library_anime (user_id, anilist_media_id);

alter table public.library_anime alter column mal_id drop not null;

alter table public.library_anime drop constraint if exists library_anime_mal_or_anilist_chk;

alter table public.library_anime
  add constraint library_anime_mal_or_anilist_chk
  check (mal_id is not null or anilist_media_id is not null);

create index if not exists library_anime_anilist_idx on public.library_anime (anilist_media_id)
  where anilist_media_id is not null;

comment on column public.library_anime.anilist_media_id is
  'Identifiant média AniList quand aucun MAL ID (mal_id null).';

comment on column public.library_anime.mal_id is
  'Identifiant fiche anime MAL ; null si entrée uniquement AniList.';
