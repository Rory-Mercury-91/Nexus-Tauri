-- =============================================================================
-- RESET TOTAL NEXUS-TAURI (SUPABASE)
-- =============================================================================
-- ⚠️ DANGER : ce script supprime TOUTES les données applicatives et TOUS les utilisateurs.
-- ⚠️ À exécuter uniquement en environnement de test.
-- ⚠️ Le bucket Storage doit être vidé manuellement (comme prévu).
--
-- Exécution recommandée:
-- 1) Supabase SQL Editor
-- 2) Compte admin / service role
-- 3) Run
-- =============================================================================

begin;

-- 1) Purge de toutes les tables du schéma public (données applicatives)
do $$
declare
  row_record record;
begin
  for row_record in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename <> 'spatial_ref_sys'
  loop
    execute format('truncate table public.%I restart identity cascade', row_record.tablename);
  end loop;
end $$;

-- 2) Purge des utilisateurs Auth (et identités associées)
delete from auth.identities;
delete from auth.users;

commit;

-- Vérification rapide (optionnelle)
-- select count(*) as users_count from auth.users;
-- select count(*) as profiles_count from public.profiles;
