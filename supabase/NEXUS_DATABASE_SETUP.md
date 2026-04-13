# Base de données Nexus-Tauri — installation complète

Ce dossier contient des scripts SQL à exécuter dans le **SQL Editor** Supabase (idéalement avec un compte ayant les droits sur le schéma `public`).

## Repartir de zéro (environnement de test)

1. **`reset_full_database.sql`** — vide les tables applicatives et les utilisateurs Auth.  
   **À ne jamais lancer en production sans sauvegarde.**

2. Enchaîner ensuite la liste **Ordre d’installation (projet neuf)** ci-dessous.

---

## Ordre d’installation (projet neuf)

Exécuter **dans cet ordre**, un script après l’autre :

| # | Fichier | Rôle |
|---|---------|------|
| 1 | `set_updated_at_search_path.sql` | (Si présent) Sécurise `search_path` sur `set_updated_at`. |
| 2 | `init.sql` | Profils, RLS, `set_updated_at`, trigger inscription `handle_new_user`. |
| 3 | `families_storage_avatars.sql` | Foyers, membres, fonctions `user_family_ids`, politiques profils / storage. |
| 4 | `library_mal.sql` | `library_anime`, `library_reading` + RLS. |
| 5 | `reading_mihon_presence.sql` | Présence Mihon par lecture. |
| 6 | `library_public_state.sql` | `library_*_public`, triggers sync user → public **et propagation public → toutes les fiches `library_reading` du même manga**, RPC `upsert_library_*`, vue **(ancienne définition vue)**. |
| 7 | **`nexus_install_volumes_v2.sql`** | **Obligatoire pour le modèle actuel** : supprime `reading_volumes` / `reading_volume_owners`, crée catalogue tomes + foyer + état perso, RPC catalogue, recrée `library_reading_resolved_v1`. |
| 8 | `search_profiles_invite.sql` | (Optionnel) Recherche de profils pour invitations. |
| 9 | `mihon_sources.sql` | (Optionnel) Sources Mihon. |
| 10 | `library_sync_jobs.sql` | (Optionnel) File de sync. |
| 11 | `oauth_integrations.sql` | (Optionnel) OAuth. |
| 12 | `subscriptions.sql` + `subscriptions_rls_fix.sql` | (Optionnel) Abonnements. |

### Scripts à **ne plus exécuter** sur un nouveau déploiement (remplacés par la v2)

- **`reading_volumes.sql`** — ancien modèle (tomes dupliqués par `reading_id`). Remplacé par `nexus_install_volumes_v2.sql`.
- **`family_reading_volume_sync.sql`** — RPC de synchro inter-fiches v1. Inutile après la v2.
- **`reading_volume_catalog_schema_v2.sql`** — brouillon ; le contenu définitif est **fusionné dans** `nexus_install_volumes_v2.sql`.

---

## Métadonnées lecture partagées (foyer / plusieurs comptes)

Après `library_public_state.sql` (version avec propagation), **chaque mise à jour** d’une ligne `library_reading` fusionne d’abord vers `library_reading_public`, puis **recopie** titre, couverture, snapshots Jikan / MAL « œuvre » vers **toutes** les autres entrées `library_reading` avec le même `mal_manga_id`.  
**Ne sont pas écrasés** : `read_status`, `user_notes`, `is_favorite`, et dans `mal_official_snapshot` le bloc **`list_entry`** (progression liste MAL / volumes lus côté API).

Si ta base a été créée **avant** cette logique, exécuter une fois **`library_reading_public_propagate.sql`** (remplace les fonctions + trigger + aligne toutes les fiches existantes).

---

## Projet déjà en production (migration vers tomes v2)

1. Sauvegarder la base (dump).
2. Migrer les données `reading_volumes` → `library_manga_volume_catalog` + `user_manga_volume_state` + `family_manga_volume_owner` (script dédié à écrire selon ton historique).
3. Exécuter **`nexus_install_volumes_v2.sql`** (il supprime les anciennes tables tomes).
4. Déployer la version de l’app qui utilise les nouvelles tables / RPC.

---

## Cible métier (rappel)

| Couche | Tables |
|--------|--------|
| Catalogue œuvre | `library_reading_public` |
| Catalogue tomes VF | `library_manga_volume_catalog` |
| Possession / parts (foyer) | `family_manga_volume_owner` |
| Lu / Mihon / perso | `user_manga_volume_state` |
| Collection utilisateur | `library_reading` |

RPC utiles : `upsert_manga_volume_catalog_row(...)`, `refresh_reading_mal_snapshot_volumes_read(uuid)` (aussi déclenché par trigger sur `user_manga_volume_state`).

---

## Storage

Après `init.sql`, créer le bucket **`avatars`** et appliquer les politiques décrites en commentaire dans `init.sql` / `families_storage_avatars.sql`.
