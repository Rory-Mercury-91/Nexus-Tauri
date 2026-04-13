# Déploiement Supabase (SQL + Edge Functions)

## 1. Prérequis

- [Supabase CLI](https://supabase.com/docs/guides/cli) installée (`supabase --version`).
- Connexion : `supabase login`
- Lier le projet local au projet cloud :  
  `supabase link --project-ref <TON_PROJECT_REF>`  
  (le ref se trouve dans le dashboard : *Settings → General → Reference ID*.)

## 2. Migrations SQL (dashboard ou `psql`)

À appliquer **dans l’ordre** sur la base (SQL Editor Supabase ou client PostgreSQL) :

1. `supabase/library_anilist_media_id_v1.sql` — colonnes `anilist_media_id`, MAL nullable, index uniques partiels.
2. `supabase/sync_runs_import_report.sql` — si ce n’est pas déjà fait (`import_report` sur `sync_runs`).
3. `supabase/library_sync_jobs.sql` — pour une install neuve ; en prod, ne ré-exécuter que les blocs manquants (éviter les `CREATE TABLE` déjà présents).

## 3. Déployer les Edge Functions

Depuis la **racine du dépôt** (là où se trouve le dossier `supabase/functions/`) :

```bash
cd "f:\Projet GitHub\Nexus-Tauri"
```

Déployer **chaque** fonction (les noms correspondent aux dossiers sous `supabase/functions/`) :

```bash
supabase functions deploy sync-start --project-ref <TON_PROJECT_REF>
supabase functions deploy sync-status --project-ref <TON_PROJECT_REF>
supabase functions deploy sync-worker --project-ref <TON_PROJECT_REF>
supabase functions deploy sync-cancel --project-ref <TON_PROJECT_REF>
```

Si le projet est déjà lié (`supabase link`), tu peux omettre `--project-ref` :

```bash
supabase functions deploy sync-start
supabase functions deploy sync-status
supabase functions deploy sync-worker
supabase functions deploy sync-cancel
```

### JWT / auth

Les fonctions invoquées **avec la session utilisateur** (header `Authorization: Bearer <access_token>`) utilisent en général la **vérification JWT** activée par défaut.  
N’utilise `--no-verify-jwt` **que** si tu as configuré explicitement des fonctions publiques sans JWT (souvent pour des webhooks) — ce n’est en principe **pas** le cas pour sync-start / sync-status / sync-worker / sync-cancel côté app Nexus.

Pour vérifier les secrets (URL Supabase, clé service, etc.) :

```bash
supabase secrets list
```

## 4. Vérification rapide

- Dashboard Supabase → **Edge Functions** : les 4 fonctions apparaissent avec une date de déploiement récente.
- Test manuel : lancer une sync depuis l’app et regarder les logs **Edge Functions → sync-worker** en cas d’erreur.

## 5. Fichiers secrets / variables

Si le worker utilise des appels sortants déjà configurés (OAuth MAL/AniList, etc.), rien à changer côté déploiement des seules fonctions ; les variables sensibles restent dans **Project Settings → Edge Functions** ou **Secrets** selon ton setup actuel.
