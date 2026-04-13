-- =============================================================================
-- Nexus-Tauri — Proposition de schéma « lectures / tomes » v2 (brouillon)
-- -----------------------------------------------------------------------------
-- Contexte actuel (v1) : reading_volumes est rattaché à library_reading (user_id),
-- donc chaque membre du foyer duplique les mêmes métadonnées catalogue (Nautiljon).
--
-- Objectif v2 (séparation claire) :
--
--   ┌─────────────────────────────────────────────────────────────────────────┐
--   │ CATALOGUE GLOBAL (œuvre)     →  library_reading_public (déjà existant)    │
--   │   titres, synopsis agrégé, jikan_snapshot public, etc.                  │
--   └─────────────────────────────────────────────────────────────────────────┘
--   ┌─────────────────────────────────────────────────────────────────────────┐
--   │ CATALOGUE GLOBAL (tomes VF)  →  library_manga_volume_catalog (NOUVEAU)  │
--   │   n°, type, date sortie VF, prix catalogue, image — UNE ligne par       │
--   │   (mal_manga_id, volume_number). Source import Nautiljon / ref prix.   │
--   └─────────────────────────────────────────────────────────────────────────┘
--   ┌─────────────────────────────────────────────────────────────────────────┐
--   │ FOYER (possession partagée)  →  family_manga_volume_owner (NOUVEAU)       │
--   │   qui possède quoi, parts € — clé (family_id, catalog_volume_id, user_id) │
--   └─────────────────────────────────────────────────────────────────────────┘
--   ┌─────────────────────────────────────────────────────────────────────────┐
--   │ UTILISATEUR (progression perso) → user_manga_volume_state (NOUVEAU)        │
--   │   lu / Mihon / date d’achat perso — lié à library_reading (ta collection) │
--   └─────────────────────────────────────────────────────────────────────────┘
--
-- Le script CANONIQUE d’installation est : nexus_install_volumes_v2.sql
-- (supprime l’ancien modèle + crée tables + RPC + vue). Ce fichier sert de
-- référence historique ; préférer nexus_install_volumes_v2.sql + NEXUS_DATABASE_SETUP.md
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Catalogue des tomes (niveau MAL manga, pas par utilisateur)
-- -----------------------------------------------------------------------------
create table if not exists public.library_manga_volume_catalog (
  id uuid primary key default gen_random_uuid(),
  mal_manga_id integer not null,
  volume_number integer not null check (volume_number > 0),
  volume_type text not null default 'standard',
  image_url text,
  release_date_vf date,
  -- Prix « catalogue » (référence import), distinct du partage foyer
  price_euros numeric(10, 2) not null default 0 check (price_euros >= 0),
  source text not null default 'manual',
  -- Métadonnées brutes optionnelles (import Nautiljon, etc.)
  import_payload jsonb,
  -- Créateur de la ligne catalogue (import / saisie) ; défaut = session courante
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mal_manga_id, volume_number)
);

comment on table public.library_manga_volume_catalog is
  'Catalogue VF des tomes par œuvre MAL : une entrée par (mal_manga_id, volume_number). '
  'Alimenté par imports (Nautiljon) ou saisie ; partagé entre tous les utilisateurs.';

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

drop policy if exists "library_manga_volume_catalog_insert_auth"
  on public.library_manga_volume_catalog;
create policy "library_manga_volume_catalog_insert_auth"
  on public.library_manga_volume_catalog for insert
  with check (auth.uid() = created_by);

drop policy if exists "library_manga_volume_catalog_update_creator"
  on public.library_manga_volume_catalog;
create policy "library_manga_volume_catalog_update_creator"
  on public.library_manga_volume_catalog for update
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- -----------------------------------------------------------------------------
-- 2) Possession / coûts au niveau foyer (référence catalogue)
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
  'Répartition des coûts et co-propriétaires par tome, au niveau du foyer '
  '(sans dupliquer les lignes catalogue).';

create index if not exists family_manga_volume_owner_family_idx
  on public.family_manga_volume_owner (family_id);

create index if not exists family_manga_volume_owner_user_idx
  on public.family_manga_volume_owner (user_id);

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
  using (
    family_id in (select public.user_family_ids())
  );

drop policy if exists "family_manga_volume_owner_write_family"
  on public.family_manga_volume_owner;
create policy "family_manga_volume_owner_write_family"
  on public.family_manga_volume_owner for insert
  with check (
    family_id in (select public.user_family_ids())
  );

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
-- 3) État personnel (ta collection library_reading + flags par tome catalogue)
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
  'Progression et options personnelles (lu, Mihon, date d’achat) pour une entrée '
  'library_reading donnée, référencée via le catalogue global des tomes.';

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

-- =============================================================================
-- Prochaines étapes (hors ce fichier)
-- -----------------------------------------------------------------------------
-- 1) Services TS : upsert Nautiljon → library_manga_volume_catalog (+ états user).
-- 2) UI détail lecture : jointure catalog + family_manga_volume_owner + user state.
-- 3) Script de migration : reading_volumes → catalog + user_manga_volume_state +
--    family_manga_volume_owner (mapping family_id depuis reading_volumes.family_id).
-- 4) Retirer sync_reading_volume_to_family_peers une fois le foyer sur la nouvelle table.
-- 5) Supprimer reading_volumes / reading_volume_owners après bascule complète.
-- =============================================================================
