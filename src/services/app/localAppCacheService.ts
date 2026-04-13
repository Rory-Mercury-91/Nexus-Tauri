import type { SupabaseClient } from "@supabase/supabase-js";
import { clearClientLogs } from "@/services/observability/clientLogService";

/**
 * Préfixes de clés localStorage gérées par Nexus (hors session Supabase, nettoyée par signOut).
 */
const LOCAL_STORAGE_KEY_PREFIXES = [
  "nexus",
  "library:",
  "sync:",
  "anime-collection",
  "reading-collection",
  "reading-detail",
  "app:scroll",
  "nautiljon:",
] as const;

function removeNexusLocalStorageEntries(): void {
  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (LOCAL_STORAGE_KEY_PREFIXES.some((p) => key.startsWith(p))) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // quota / accès refusé
  }
}

/**
 * Vide les caches applicatifs (logs client, collections, préférences UI, sessionStorage)
 * puis déconnecte l’utilisateur Supabase.
 */
export async function clearLocalCachesAndSignOut(supabase: SupabaseClient): Promise<void> {
  clearClientLogs();
  await supabase.auth.signOut();
  removeNexusLocalStorageEntries();
  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
}
