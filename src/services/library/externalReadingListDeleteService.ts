import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationProvider } from "@/services/integrations/integrationService";
import { invokeEdgeFunction } from "@/services/supabase/edgeFunctionInvoke";

type DeletePayload = {
  ok?: boolean;
  error?: string;
};

/** Catalogue MAL / AniList : mangas ou animés. */
export type ExternalListCatalog = "manga" | "anime";

/**
 * Retire une entrée de la liste MAL ou AniList (idMal côté AniList = id MAL).
 */
export async function removeFromExternalList(
  supabase: SupabaseClient,
  input: { provider: IntegrationProvider; malMediaId: number; catalog: ExternalListCatalog }
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const payload = await invokeEdgeFunction<DeletePayload>(supabase, "external-reading-list-delete", {
      provider: input.provider,
      mal_manga_id: input.malMediaId,
      media_catalog: input.catalog,
    });
    if (!payload?.ok) {
      return {
        ok: false,
        error: payload?.error?.trim() || "Réponse serveur invalide.",
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Suppression impossible.",
    };
  }
}

/**
 * Retire une entrée de la mangalist MAL ou de la liste manga AniList (via idMal = mal_manga_id).
 */
export async function removeReadingFromExternalList(
  supabase: SupabaseClient,
  input: { provider: IntegrationProvider; malMangaId: number }
): Promise<{ ok: true } | { ok: false; error: string }> {
  return removeFromExternalList(supabase, {
    provider: input.provider,
    malMediaId: input.malMangaId,
    catalog: "manga",
  });
}
