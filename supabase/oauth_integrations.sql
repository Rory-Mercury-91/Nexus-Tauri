-- =============================================================================
-- Nexus-Tauri — OAuth intégrations (MAL + AniList)
-- Exécuter dans Supabase SQL Editor
-- =============================================================================

create table if not exists public.oauth_connections (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('mal', 'anilist')),
  account_label text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

comment on table public.oauth_connections is
'Tokens OAuth par utilisateur et par provider (MAL, AniList).';

create table if not exists public.oauth_connect_states (
  id bigserial primary key,
  state text not null unique,
  provider text not null check (provider in ('mal', 'anilist')),
  user_id uuid not null references auth.users (id) on delete cascade,
  code_verifier text not null,
  redirect_uri text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

comment on table public.oauth_connect_states is
'Etats OAuth temporaires (PKCE/state) utilisés entre start-connect et callback.';

create index if not exists idx_oauth_connect_states_expires_at
  on public.oauth_connect_states (expires_at);

alter table public.oauth_connections enable row level security;
alter table public.oauth_connect_states enable row level security;

drop policy if exists "oauth_connections_select_own" on public.oauth_connections;
create policy "oauth_connections_select_own"
  on public.oauth_connections for select
  using (auth.uid() = user_id);

drop policy if exists "oauth_connections_insert_own" on public.oauth_connections;
create policy "oauth_connections_insert_own"
  on public.oauth_connections for insert
  with check (auth.uid() = user_id);

drop policy if exists "oauth_connections_update_own" on public.oauth_connections;
create policy "oauth_connections_update_own"
  on public.oauth_connections for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "oauth_connections_delete_own" on public.oauth_connections;
create policy "oauth_connections_delete_own"
  on public.oauth_connections for delete
  using (auth.uid() = user_id);

drop policy if exists "oauth_connect_states_select_own" on public.oauth_connect_states;
create policy "oauth_connect_states_select_own"
  on public.oauth_connect_states for select
  using (auth.uid() = user_id);

drop policy if exists "oauth_connect_states_insert_own" on public.oauth_connect_states;
create policy "oauth_connect_states_insert_own"
  on public.oauth_connect_states for insert
  with check (auth.uid() = user_id);

drop policy if exists "oauth_connect_states_update_own" on public.oauth_connect_states;
create policy "oauth_connect_states_update_own"
  on public.oauth_connect_states for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "oauth_connect_states_delete_own" on public.oauth_connect_states;
create policy "oauth_connect_states_delete_own"
  on public.oauth_connect_states for delete
  using (auth.uid() = user_id);

drop trigger if exists oauth_connections_set_updated_at on public.oauth_connections;
create trigger oauth_connections_set_updated_at
  before update on public.oauth_connections
  for each row
  execute function public.set_updated_at();
