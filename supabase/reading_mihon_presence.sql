-- =============================================================================
-- Nexus-Tauri — Présence MIHON par utilisateur pour les lectures
-- =============================================================================

create table if not exists public.reading_mihon_presence (
  reading_id uuid not null references public.library_reading (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  chapters_read integer not null default 0 check (chapters_read >= 0),
  chapters_total integer not null default 0 check (chapters_total >= 0),
  source_id text,
  source_url text,
  prefer_mihon_progress boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (reading_id, user_id)
);

comment on table public.reading_mihon_presence is
  'Indique quels membres de la famille possèdent une entrée sur MIHON et leur progression chapitres.';

create index if not exists reading_mihon_presence_user_idx
  on public.reading_mihon_presence (user_id);

create index if not exists reading_mihon_presence_reading_idx
  on public.reading_mihon_presence (reading_id);

drop trigger if exists reading_mihon_presence_set_updated_at on public.reading_mihon_presence;
create trigger reading_mihon_presence_set_updated_at
  before update on public.reading_mihon_presence
  for each row execute function public.set_updated_at();

alter table public.reading_mihon_presence enable row level security;

drop policy if exists "reading_mihon_presence_select_family" on public.reading_mihon_presence;
create policy "reading_mihon_presence_select_family"
  on public.reading_mihon_presence for select
  using (
    user_id = auth.uid()
    or public.user_shares_family_with(user_id)
  );

drop policy if exists "reading_mihon_presence_insert_self" on public.reading_mihon_presence;
create policy "reading_mihon_presence_insert_self"
  on public.reading_mihon_presence for insert
  with check (user_id = auth.uid());

drop policy if exists "reading_mihon_presence_update_self" on public.reading_mihon_presence;
create policy "reading_mihon_presence_update_self"
  on public.reading_mihon_presence for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "reading_mihon_presence_delete_self" on public.reading_mihon_presence;
create policy "reading_mihon_presence_delete_self"
  on public.reading_mihon_presence for delete
  using (user_id = auth.uid());
