import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeEdgeFunction } from "@/services/supabase/edgeFunctionInvoke";
import type { SyncDiffField } from "@/services/library/syncDiffService";
import type { SyncMediaType, SyncSource } from "@/services/library/syncService";

export type SyncImportPreviewMeta = {
  remoteEntryCount: number;
  statusDiffCount: number;
  titleDiffCount: number;
  newEntryCount: number;
  mediaType: SyncMediaType;
  source: SyncSource;
};

export type SyncImportPreviewResult = {
  fields: SyncDiffField[];
  meta: SyncImportPreviewMeta;
};

/**
 * Aperçu agrégé (liste complète) avant sync MAL / AniList — aligné sur la logique du worker d’import.
 */
export async function fetchSyncImportPreview(
  supabase: SupabaseClient,
  params: { source: SyncSource; mediaType: SyncMediaType }
): Promise<SyncImportPreviewResult> {
  const data = await invokeEdgeFunction<{
    ok: boolean;
    fields?: SyncDiffField[];
    meta?: SyncImportPreviewMeta;
    error?: string;
  }>(supabase, "sync-import-preview", {
    source: params.source,
    media_type: params.mediaType,
  });
  if (!data?.ok) {
    throw new Error(data?.error ?? "Aperçu de synchronisation indisponible.");
  }
  return {
    fields: Array.isArray(data.fields) ? data.fields : [],
    meta: data.meta as SyncImportPreviewMeta,
  };
}
