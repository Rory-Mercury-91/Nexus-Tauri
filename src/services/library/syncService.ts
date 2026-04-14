import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeEdgeFunction } from "@/services/supabase/edgeFunctionInvoke";

export type SyncSource = "mal" | "anilist";
export type SyncMediaType = "anime" | "reading";

/** Compteurs d’import manga (clé `reading` dans import_report). */
export type SyncReadingImportReport = {
  from_mal_created?: number;
  from_mal_updated?: number;
  from_anilist_created?: number;
  from_anilist_updated?: number;
  anilist_skipped_has_mal_id?: number;
  mal_also_on_anilist?: number;
  anilist_no_mal_id_count?: number;
  anilist_no_mal_id_titles?: string[];
};

export type SyncImportReportBundle = {
  reading?: SyncReadingImportReport;
  anime?: SyncReadingImportReport;
};

export type SyncRun = {
  id: string;
  source: SyncSource;
  media_type: SyncMediaType;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  current_stage: "import" | "enrich" | "translate" | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  import_report?: SyncImportReportBundle | null;
};

export type SyncProgressRow = {
  stage: "import" | "enrich" | "translate";
  total: number;
  processed: number;
  created_count: number;
  updated_count: number;
  error_count: number;
  current_item_label: string | null;
  rate_per_min: number | null;
  eta_seconds: number | null;
  updated_at: string;
};

export type SyncStatusPayload = {
  active_run: SyncRun | null;
  active_progress: SyncProgressRow[];
  recent_runs: SyncRun[];
};

export type SyncStartOptions = {
  selectedFieldIds?: string[];
  targetMalId?: number;
};

export async function startAnimeSync(
  supabase: SupabaseClient,
  source: SyncSource,
  options?: SyncStartOptions
): Promise<{ run_id: string; reused: boolean }> {
  const selected = Array.isArray(options?.selectedFieldIds)
    ? options?.selectedFieldIds.filter((id) => typeof id === "string" && id.trim().length > 0)
    : [];
  const targetMalId =
    Number.isFinite(options?.targetMalId) && Number(options?.targetMalId) > 0
      ? Math.floor(Number(options?.targetMalId))
      : null;
  let data: { ok: boolean; run_id: string; reused?: boolean };
  try {
    data = await invokeEdgeFunction<{ ok: boolean; run_id: string; reused?: boolean }>(
      supabase,
      "sync-start",
      {
        source,
        media_type: "anime",
        selected_field_ids: selected,
        target_mal_id: targetMalId,
      }
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Erreur inconnue";
    throw new Error(
      `[sync-start] media=anime source=${source} target_mal_id=${targetMalId ?? "null"} — ${reason}`
    );
  }
  if (!data?.ok || !data.run_id) {
    throw new Error("Impossible de démarrer la synchronisation.");
  }
  return { run_id: data.run_id, reused: Boolean(data.reused) };
}

export async function startReadingSync(
  supabase: SupabaseClient,
  source: SyncSource,
  options?: SyncStartOptions
): Promise<{ run_id: string; reused: boolean }> {
  const selected = Array.isArray(options?.selectedFieldIds)
    ? options?.selectedFieldIds.filter((id) => typeof id === "string" && id.trim().length > 0)
    : [];
  const targetMalId =
    Number.isFinite(options?.targetMalId) && Number(options?.targetMalId) > 0
      ? Math.floor(Number(options?.targetMalId))
      : null;
  let data: { ok: boolean; run_id: string; reused?: boolean };
  try {
    data = await invokeEdgeFunction<{ ok: boolean; run_id: string; reused?: boolean }>(
      supabase,
      "sync-start",
      {
        source,
        media_type: "reading",
        selected_field_ids: selected,
        target_mal_id: targetMalId,
      }
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Erreur inconnue";
    throw new Error(
      `[sync-start] media=reading source=${source} target_mal_id=${targetMalId ?? "null"} — ${reason}`
    );
  }
  if (!data?.ok || !data.run_id) {
    throw new Error("Impossible de démarrer la synchronisation lectures.");
  }
  return { run_id: data.run_id, reused: Boolean(data.reused) };
}

export async function getAnimeSyncStatus(supabase: SupabaseClient): Promise<SyncStatusPayload> {
  const data = await invokeEdgeFunction<{ ok: boolean } & SyncStatusPayload>(supabase, "sync-status", {});
  if (!data?.ok) {
    throw new Error("Impossible de récupérer l’état de synchronisation.");
  }
  return {
    active_run: data.active_run ?? null,
    active_progress: data.active_progress ?? [],
    recent_runs: data.recent_runs ?? [],
  };
}

export async function getReadingSyncStatus(supabase: SupabaseClient): Promise<SyncStatusPayload> {
  const data = await invokeEdgeFunction<{ ok: boolean } & SyncStatusPayload>(supabase, "sync-status", {
    media_type: "reading",
  });
  if (!data?.ok) {
    throw new Error("Impossible de récupérer l’état de synchronisation lectures.");
  }
  return {
    active_run: data.active_run ?? null,
    active_progress: data.active_progress ?? [],
    recent_runs: data.recent_runs ?? [],
  };
}

export async function tickSyncWorker(supabase: SupabaseClient): Promise<void> {
  await invokeEdgeFunction(supabase, "sync-worker", {});
}

/**
 * Annule le run actif (queued/running) pour ce type de média : jobs en file passent en cancelled ;
 * le job déjà « running » s’arrête au prochain contrôle côté worker.
 */
export async function cancelActiveSyncRun(
  supabase: SupabaseClient,
  mediaType: SyncMediaType
): Promise<{ cancelled: boolean; run_id?: string; message?: string }> {
  const data = await invokeEdgeFunction<{
    ok: boolean;
    cancelled?: boolean;
    run_id?: string;
    message?: string;
    error?: string;
  }>(supabase, "sync-cancel", { media_type: mediaType });
  if (!data?.ok) {
    throw new Error(data?.error ?? "Annulation impossible.");
  }
  return {
    cancelled: Boolean(data.cancelled),
    run_id: data.run_id,
    message: data.message,
  };
}
