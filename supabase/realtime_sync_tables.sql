-- =============================================================================
-- Realtime : progression de synchronisation (barre latérale)
-- =============================================================================
-- À exécuter une fois dans le SQL Editor Supabase si les mises à jour « live »
-- ne partent pas (le client s’abonne à sync_runs + sync_progress).
-- En cas de « relation already member of publication », ignorer la ligne concernée.

alter publication supabase_realtime add table public.sync_runs;
alter publication supabase_realtime add table public.sync_progress;
