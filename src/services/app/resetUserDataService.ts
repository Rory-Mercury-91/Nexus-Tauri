import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeEdgeFunction } from "@/services/supabase/edgeFunctionInvoke";

export type ResetScope = "anime" | "reading" | "sync" | "all";

export type ResetResult = {
  ok: boolean;
  scope: ResetScope;
  /** Nombre de lignes supprimées par table. */
  deleted: Record<string, number>;
};

type ResetPayload = {
  ok?: boolean;
  scope?: string;
  deleted?: Record<string, number>;
  error?: string;
};

/**
 * Purge les données de l'utilisateur connecté pour le scope choisi.
 * Retourne les compteurs de lignes supprimées par table.
 */
export async function resetUserData(
  supabase: SupabaseClient,
  scope: ResetScope
): Promise<ResetResult> {
  const payload = await invokeEdgeFunction<ResetPayload>(supabase, "reset-user-data", {
    scope,
    confirm: true,
  });
  if (!payload?.ok) {
    throw new Error(payload?.error?.trim() || "Réinitialisation échouée.");
  }
  return {
    ok: true,
    scope,
    deleted: payload.deleted ?? {},
  };
}

/** Retourne un libellé lisible pour un scope. */
export function resetScopeLabel(scope: ResetScope): string {
  switch (scope) {
    case "anime":   return "Collection animés";
    case "reading": return "Collection lectures";
    case "sync":    return "Historique sync";
    case "all":     return "Toutes les données";
  }
}

/** Retourne la description des tables affectées pour un scope. */
export function resetScopeTables(scope: ResetScope): string {
  switch (scope) {
    case "anime":
      return "library_anime";
    case "reading":
      return "library_reading, reading_mihon_presence, family_manga_volume_owner, user_manga_volume_state";
    case "sync":
      return "sync_runs, sync_progress, sync_jobs";
    case "all":
      return "library_anime, library_reading, reading_mihon_presence, family_manga_volume_owner, user_manga_volume_state, sync_runs, sync_progress, sync_jobs";
  }
}
