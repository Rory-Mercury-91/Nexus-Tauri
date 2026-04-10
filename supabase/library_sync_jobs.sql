-- =============================================================================
-- Nexus-Tauri — Pipeline de synchronisation persistante (animés + lectures)
-- =============================================================================

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('mal', 'anilist')),
  media_type text not null check (media_type in ('anime', 'reading')),
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')) default 'queued',
  current_stage text check (current_stage in ('import', 'enrich', 'translate')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text
);

create index if not exists sync_runs_user_created_idx
  on public.sync_runs (user_id, created_at desc);
create index if not exists sync_runs_status_idx
  on public.sync_runs (status, created_at desc);

create table if not exists public.sync_progress (
  id bigserial primary key,
  run_id uuid not null references public.sync_runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  stage text not null check (stage in ('import', 'enrich', 'translate')),
  total integer not null default 0,
  processed integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  error_count integer not null default 0,
  current_item_label text,
  rate_per_min numeric,
  eta_seconds integer,
  updated_at timestamptz not null default now(),
  unique (run_id, stage)
);

create index if not exists sync_progress_run_stage_idx
  on public.sync_progress (run_id, stage);
create index if not exists sync_progress_user_updated_idx
  on public.sync_progress (user_id, updated_at desc);

create table if not exists public.sync_jobs (
  id bigserial primary key,
  run_id uuid not null references public.sync_runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  stage text not null check (stage in ('import', 'enrich', 'translate')),
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('queued', 'running', 'done', 'failed', 'retry', 'cancelled')) default 'queued',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sync_jobs_run_stage_idx
  on public.sync_jobs (run_id, stage);
create index if not exists sync_jobs_status_available_idx
  on public.sync_jobs (status, available_at asc, id asc);
create index if not exists sync_jobs_user_idx
  on public.sync_jobs (user_id, created_at desc);

drop trigger if exists sync_jobs_set_updated_at on public.sync_jobs;
create trigger sync_jobs_set_updated_at
  before update on public.sync_jobs
  for each row
  execute function public.set_updated_at();

alter table public.sync_runs enable row level security;
alter table public.sync_progress enable row level security;
alter table public.sync_jobs enable row level security;

drop policy if exists "sync_runs_select_own" on public.sync_runs;
create policy "sync_runs_select_own"
  on public.sync_runs for select
  using (auth.uid() = user_id);

drop policy if exists "sync_runs_insert_own" on public.sync_runs;
create policy "sync_runs_insert_own"
  on public.sync_runs for insert
  with check (auth.uid() = user_id);

drop policy if exists "sync_runs_update_own" on public.sync_runs;
create policy "sync_runs_update_own"
  on public.sync_runs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "sync_progress_select_own" on public.sync_progress;
create policy "sync_progress_select_own"
  on public.sync_progress for select
  using (auth.uid() = user_id);

drop policy if exists "sync_progress_insert_own" on public.sync_progress;
create policy "sync_progress_insert_own"
  on public.sync_progress for insert
  with check (auth.uid() = user_id);

drop policy if exists "sync_progress_update_own" on public.sync_progress;
create policy "sync_progress_update_own"
  on public.sync_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- sync_jobs n'est pas exposée au client (usage service role via Edge Functions).
drop policy if exists "sync_jobs_deny_all" on public.sync_jobs;
create policy "sync_jobs_deny_all"
  on public.sync_jobs for all
  using (false)
  with check (false);

alter table public.sync_runs alter column user_id set default auth.uid();
alter table public.sync_progress alter column user_id set default auth.uid();
alter table public.sync_jobs alter column user_id set default auth.uid();

-- Compatibilité base existante: élargit la contrainte media_type si déjà créée.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'sync_runs_media_type_check'
      and conrelid = 'public.sync_runs'::regclass
  ) then
    alter table public.sync_runs drop constraint sync_runs_media_type_check;
  end if;
  alter table public.sync_runs
    add constraint sync_runs_media_type_check
    check (media_type in ('anime', 'reading'));
end $$;
