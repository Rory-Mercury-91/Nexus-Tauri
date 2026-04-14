-- ============================================================
-- Auto-sync serveur — Nexus Tauri
-- ============================================================
--
-- Ce fichier crée :
--   1. La fonction PL/pgSQL `schedule_auto_sync()` qui détecte
--      les utilisateurs éligibles et insère les sync_runs/sync_jobs.
--   2. Les deux tâches pg_cron :
--        • auto-sync-schedule  (toutes les 15 min)  → crée les jobs
--        • tick-sync-worker    (toutes les minutes)  → traite les jobs
--
-- Prérequis : pg_cron et pg_net activés dans le projet Supabase.
--   (Dashboard → Database → Extensions → pg_cron, pg_net)
--
-- AVANT D'EXÉCUTER :
--   Remplace SUPABASE_URL par l'URL de ton projet, ex :
--   https://obsvzcewfyrsvvofsmbm.supabase.co
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Fonction de planification des syncs automatiques
-- ─────────────────────────────────────────────────────────────
create or replace function public.schedule_auto_sync()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Intervalle minimum entre deux syncs complètes (3 heures)
  v_threshold  timestamptz := now() - interval '3 hours';
  -- Limite du nombre de runs créés par appel (évite les rafales)
  v_max_per_tick constant int := 20;
  v_now  timestamptz := now();
  v_run_id       uuid;
  v_count        int := 0;
  rec            record;
begin
  -- Parcourt les utilisateurs éligibles :
  --   • ont déjà complété au moins un sync (run status=completed)
  --   • ce dernier sync date de plus de 3 h
  --   • aucun run actif en cours pour ce media_type
  --   • ont un jeton OAuth valide (MAL en priorité, sinon AniList)
  for rec in
    with
    -- Dernier run complété par utilisateur + media_type
    last_done as (
      select
        user_id,
        media_type,
        max(finished_at) as last_at
      from sync_runs
      where status = 'completed'
      group by user_id, media_type
    ),
    -- Runs actifs (à exclure)
    active as (
      select distinct user_id, media_type
      from sync_runs
      where status in ('queued', 'running')
    ),
    -- Meilleure source OAuth disponible par utilisateur
    best_source as (
      select
        oc.user_id,
        -- MAL prioritaire
        case
          when bool_or(oc.provider = 'mal'     and oc.access_token is not null and oc.access_token <> '') then 'mal'
          when bool_or(oc.provider = 'anilist'  and oc.access_token is not null and oc.access_token <> '') then 'anilist'
          else null
        end as src
      from oauth_connections oc
      group by oc.user_id
    )
    select
      ld.user_id,
      ld.media_type,
      bs.src as source
    from last_done ld
    join best_source bs on bs.user_id = ld.user_id
    where
      ld.last_at < v_threshold                           -- sync trop ancienne
      and bs.src is not null                             -- OAuth disponible
      and not exists (                                   -- pas de run actif
        select 1 from active a
        where a.user_id = ld.user_id
          and a.media_type = ld.media_type
      )
    order by ld.last_at asc                              -- les plus anciens en premier
    limit v_max_per_tick
  loop
    -- Crée le run (même structure que sync-start)
    insert into sync_runs (user_id, source, media_type, status, current_stage)
    values (rec.user_id, rec.source, rec.media_type, 'queued', 'import')
    returning id into v_run_id;

    -- Crée le premier job d'import
    -- MAL sans cible : prefetch d'abord (pour obtenir le total exact)
    -- AniList : import direct
    insert into sync_jobs (
      run_id, user_id, stage, status, attempts,
      available_at, payload, created_at, updated_at
    )
    values (
      v_run_id,
      rec.user_id,
      'import',
      'queued',
      0,
      v_now,
      jsonb_build_object(
        'source',            rec.source,
        'media_type',        rec.media_type,
        'selected_field_ids', '[]'::jsonb,
        'is_prefetch',       (rec.source = 'mal')
      ),
      v_now,
      v_now
    );

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'scheduled', v_count,
    'threshold', v_threshold,
    'at',        v_now
  );
end;
$$;

-- Permissions : seul le rôle postgres (service-role) peut appeler cette fonction
revoke execute on function public.schedule_auto_sync() from public, anon, authenticated;
grant  execute on function public.schedule_auto_sync() to postgres;


-- ─────────────────────────────────────────────────────────────
-- 2. Crons pg_cron
-- ─────────────────────────────────────────────────────────────

-- Supprime les anciens crons si on ré-exécute ce script
select cron.unschedule('auto-sync-schedule') where exists (
  select 1 from cron.job where jobname = 'auto-sync-schedule'
);
select cron.unschedule('tick-sync-worker') where exists (
  select 1 from cron.job where jobname = 'tick-sync-worker'
);

-- Cron 1 : planifie les syncs auto toutes les 15 minutes
-- Appel SQL direct → pas de HTTP, pas de secrets exposés
select cron.schedule(
  'auto-sync-schedule',
  '*/15 * * * *',
  $cron$
    select public.schedule_auto_sync();
  $cron$
);

-- Cron 2 : tique le worker chaque minute pour traiter les jobs en file
-- Même comportement que le polling client, mais côté serveur.
-- REMPLACE https://SUPABASE_URL par l'URL de ton projet Supabase.
select cron.schedule(
  'tick-sync-worker',
  '* * * * *',
  $cron$
    select net.http_post(
      url     := 'https://SUPABASE_URL/functions/v1/sync-worker',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $cron$
);

-- ─────────────────────────────────────────────────────────────
-- Vérification : liste les crons actifs
-- ─────────────────────────────────────────────────────────────
select jobname, schedule, active from cron.job order by jobname;
