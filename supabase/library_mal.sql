-- =============================================================================
-- Bibliothèque personnelle — entrées synchronisées avec les fiches MAL via Jikan
-- À exécuter APRÈS supabase/init.sql (le trigger public.set_updated_at doit exister).
-- Les IDs MAL « anime » et « manga » sont des espaces distincts : deux tables.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Animés
-- -----------------------------------------------------------------------------
create table if not exists public.library_anime (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mal_id integer not null,
  title text not null,
  title_english text,
  main_picture_url text,
  jikan_snapshot jsonb not null default '{}'::jsonb,
  jikan_snapshot_at timestamptz,
  mal_official_snapshot jsonb not null default '{}'::jsonb,
  mal_official_snapshot_at timestamptz,
  watch_status text
    constraint library_anime_watch_status_chk
      check (
        watch_status is null
        or watch_status in (
          'plan_to_watch',
          'watching',
          'completed',
          'on_hold',
          'dropped'
        )
      ),
  is_favorite boolean not null default false,
  user_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint library_anime_user_mal_unique unique (user_id, mal_id)
);

comment on table public.library_anime is
  'Entrée de collection animé ; mal_id = identifiant fiche anime MyAnimeList.';

comment on column public.library_anime.jikan_snapshot is
  'Instantané Jikan (rapport agrégé ou /full) pour affichage hors-ligne ou historique.';
comment on column public.library_anime.jikan_snapshot_at is
  'Horodatage de la dernière mise à jour de jikan_snapshot.';
comment on column public.library_anime.mal_official_snapshot is
  'Données enrichissement API MyAnimeList officielle (OAuth), ex. node anime + extraits utiles.';
comment on column public.library_anime.mal_official_snapshot_at is
  'Horodatage du dernier enrichissement MAL officiel.';
comment on column public.library_anime.watch_status is
  'Statut de visionnage utilisateur (valeurs alignées sur la liste MAL).';
comment on column public.library_anime.is_favorite is
  'Favori utilisateur local (indépendant des statuts MAL).';

create index if not exists library_anime_user_idx on public.library_anime (user_id);
create index if not exists library_anime_mal_idx on public.library_anime (mal_id);

-- -----------------------------------------------------------------------------
-- Lectures (manga, light novel, etc. — fiches manga MAL)
-- -----------------------------------------------------------------------------
create table if not exists public.library_reading (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mal_manga_id integer not null,
  title text not null,
  title_english text,
  main_picture_url text,
  jikan_snapshot jsonb not null default '{}'::jsonb,
  jikan_snapshot_at timestamptz,
  mal_official_snapshot jsonb not null default '{}'::jsonb,
  mal_official_snapshot_at timestamptz,
  read_status text
    constraint library_reading_read_status_chk
      check (
        read_status is null
        or read_status in (
          'plan_to_read',
          'reading',
          'completed',
          'on_hold',
          'dropped'
        )
      ),
  user_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint library_reading_user_mal_unique unique (user_id, mal_manga_id)
);

comment on table public.library_reading is
  'Entrée de collection lecture ; mal_manga_id = identifiant fiche manga MyAnimeList.';

comment on column public.library_reading.jikan_snapshot is
  'Instantané Jikan (fiche manga / relations) pour affichage hors-ligne ou historique.';
comment on column public.library_reading.jikan_snapshot_at is
  'Horodatage de la dernière mise à jour de jikan_snapshot.';
comment on column public.library_reading.mal_official_snapshot is
  'Données enrichissement API MAL officielle (fiche manga / liste).';
comment on column public.library_reading.mal_official_snapshot_at is
  'Horodatage du dernier enrichissement MAL officiel.';
comment on column public.library_reading.read_status is
  'Statut de lecture utilisateur (valeurs alignées sur la liste MAL manga).';

create index if not exists library_reading_user_idx on public.library_reading (user_id);
create index if not exists library_reading_mal_idx on public.library_reading (mal_manga_id);

-- -----------------------------------------------------------------------------
-- Triggers updated_at
-- -----------------------------------------------------------------------------
drop trigger if exists library_anime_set_updated_at on public.library_anime;
create trigger library_anime_set_updated_at
  before update on public.library_anime
  for each row
  execute function public.set_updated_at();

drop trigger if exists library_reading_set_updated_at on public.library_reading;
create trigger library_reading_set_updated_at
  before update on public.library_reading
  for each row
  execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS : chaque utilisateur ne voit que ses lignes
-- -----------------------------------------------------------------------------
alter table public.library_anime enable row level security;
alter table public.library_reading enable row level security;

drop policy if exists "library_anime_select_own" on public.library_anime;
create policy "library_anime_select_own"
  on public.library_anime for select
  using (auth.uid() = user_id);

drop policy if exists "library_anime_insert_own" on public.library_anime;
create policy "library_anime_insert_own"
  on public.library_anime for insert
  with check (auth.uid() = user_id);

drop policy if exists "library_anime_update_own" on public.library_anime;
create policy "library_anime_update_own"
  on public.library_anime for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "library_anime_delete_own" on public.library_anime;
create policy "library_anime_delete_own"
  on public.library_anime for delete
  using (auth.uid() = user_id);

drop policy if exists "library_reading_select_own" on public.library_reading;
create policy "library_reading_select_own"
  on public.library_reading for select
  using (auth.uid() = user_id);

drop policy if exists "library_reading_insert_own" on public.library_reading;
create policy "library_reading_insert_own"
  on public.library_reading for insert
  with check (auth.uid() = user_id);

drop policy if exists "library_reading_update_own" on public.library_reading;
create policy "library_reading_update_own"
  on public.library_reading for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "library_reading_delete_own" on public.library_reading;
create policy "library_reading_delete_own"
  on public.library_reading for delete
  using (auth.uid() = user_id);

-- Valeur par défaut créateur (cohérent avec les autres tables Nexus)
alter table public.library_anime
  alter column user_id set default (auth.uid());

alter table public.library_reading
  alter column user_id set default (auth.uid());

-- -----------------------------------------------------------------------------
-- Si tu avais déjà exécuté une version sans colonnes d’enrichissement MAL / renommage snapshot Jikan
-- -----------------------------------------------------------------------------
alter table public.library_anime
  add column if not exists jikan_snapshot_at timestamptz;
alter table public.library_anime
  add column if not exists is_favorite boolean not null default false;
alter table public.library_anime
  add column if not exists mal_official_snapshot jsonb not null default '{}'::jsonb;
alter table public.library_anime
  add column if not exists mal_official_snapshot_at timestamptz;

-- Ancien nom éventuel (migration douce depuis snapshot_at unique)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'library_anime'
      and column_name = 'snapshot_at'
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'library_anime'
      and column_name = 'jikan_snapshot_at'
  ) then
    execute 'alter table public.library_anime rename column snapshot_at to jikan_snapshot_at';
  end if;
end $$;

alter table public.library_reading
  add column if not exists jikan_snapshot_at timestamptz;
alter table public.library_reading
  add column if not exists mal_official_snapshot jsonb not null default '{}'::jsonb;
alter table public.library_reading
  add column if not exists mal_official_snapshot_at timestamptz;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'library_reading'
      and column_name = 'snapshot_at'
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'library_reading'
      and column_name = 'jikan_snapshot_at'
  ) then
    execute 'alter table public.library_reading rename column snapshot_at to jikan_snapshot_at';
  end if;
end $$;
