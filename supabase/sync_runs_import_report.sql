-- Rapport d’import par run (priorité MAL, stats AniList, etc.) — lu par sync-status.
alter table public.sync_runs add column if not exists import_report jsonb not null default '{}'::jsonb;

comment on column public.sync_runs.import_report is
  'Compteurs et échantillons (reading / anime) : imports MAL, ignorés AniList, chevauchements, etc.';
