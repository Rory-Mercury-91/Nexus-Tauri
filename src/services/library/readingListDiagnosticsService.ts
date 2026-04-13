import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeEdgeFunction } from "@/services/supabase/edgeFunctionInvoke";

export type ExternalListDiagnosticsPayload = {
  mal_manga_ids: number[];
  anilist_by_mal_id: Record<string, { anilist_media_id: number; list_status: string }>;
  anilist_entries_without_mal: Array<{ anilist_media_id: number; title: string }>;
  errors: { mal: string | null; anilist: string | null };
};

export type ReadingEntryDiagnostic = {
  rowId: string;
  title: string;
  mal_manga_id: number;
  /** Présent dans la mangalist MAL (API). */
  inMalList: boolean;
  /** Présent sur AniList avec un idMal qui pointe vers ce MAL id. */
  inAnilistList: boolean;
  /** Fiche Nexus sans entrée correspondante dans les deux flux (ni MAL ni AniList lié). */
  nexusOnlyInExternalLists: boolean;
  anilistMediaId: number | null;
  anilistListStatus: string | null;
  /** Dernière source vue dans le snapshot (sync worker). */
  snapshotSource: string | null;
};

/**
 * Interroge MAL + AniList (tokens OAuth) et retourne les jeux d’ids pour comparaison.
 */
export async function fetchExternalReadingListDiagnostics(
  supabase: SupabaseClient
): Promise<ExternalListDiagnosticsPayload> {
  const data = await invokeEdgeFunction<ExternalListDiagnosticsPayload>(
    supabase,
    "reading-list-diagnostics",
    {}
  );
  if (!data || typeof data !== "object") {
    throw new Error("Réponse diagnostic vide.");
  }
  return data;
}

export async function loadFullReadingDiagnostics(supabase: SupabaseClient): Promise<{
  external: ExternalListDiagnosticsPayload;
  entries: ReadingEntryDiagnostic[];
}> {
  const external = await fetchExternalReadingListDiagnostics(supabase);
  const entries = await buildReadingEntryDiagnostics(supabase, external);
  return { external, entries };
}

export type FullReadingDiagnosticsResult = Awaited<ReturnType<typeof loadFullReadingDiagnostics>>;

/**
 * Croise les entrées `library_reading` avec les flux MAL / AniList.
 */
/** Filtre pour le tableau de comparaison Nexus ↔ MAL / AniList. */
export type ReadingListCompareFilter =
  | "all"
  /** Fiches sans `mal_manga_id` (non comparables aux listes distantes). */
  | "nexus_no_mal_id"
  /** Uniquement les fiches avec un MAL id (comparables). */
  | "comparable_only"
  /** MAL id présent : dans la mangalist MAL mais pas sur AniList (lié MAL). */
  | "mal_only_remote"
  /** MAL id présent : sur AniList (idMal) mais pas dans la mangalist MAL. */
  | "anilist_only_remote"
  /** Présent des deux côtés (même MAL id). */
  | "both_remotes"
  /** Dans Nexus avec MAL id mais absent des deux listes distantes. */
  | "nexus_absent_both"
  /** Décroché : présent d’un côté seulement (MAL xor AniList). */
  | "mal_anilist_desync";

export function filterReadingEntryDiagnostics(
  entries: ReadingEntryDiagnostic[],
  filter: ReadingListCompareFilter
): ReadingEntryDiagnostic[] {
  if (filter === "all") {
    return entries;
  }
  return entries.filter((row) => {
    const hasMalId = row.mal_manga_id > 0;
    switch (filter) {
      case "nexus_no_mal_id":
        return !hasMalId;
      case "comparable_only":
        return hasMalId;
      case "mal_only_remote":
        return hasMalId && row.inMalList && !row.inAnilistList;
      case "anilist_only_remote":
        return hasMalId && row.inAnilistList && !row.inMalList;
      case "both_remotes":
        return hasMalId && row.inMalList && row.inAnilistList;
      case "nexus_absent_both":
        return row.nexusOnlyInExternalLists;
      case "mal_anilist_desync":
        return hasMalId && row.inMalList !== row.inAnilistList;
      default:
        return true;
    }
  });
}

export async function buildReadingEntryDiagnostics(
  supabase: SupabaseClient,
  external: ExternalListDiagnosticsPayload
): Promise<ReadingEntryDiagnostic[]> {
  const { data: rows, error } = await supabase
    .from("library_reading")
    .select("id, title, mal_manga_id, mal_official_snapshot")
    .order("title", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }

  const malSet = new Set(external.mal_manga_ids);
  const aniMap = external.anilist_by_mal_id;

  return (rows ?? []).map((row) => {
    const malId = Number((row as { mal_manga_id?: unknown }).mal_manga_id ?? 0);
    const snap = (row as { mal_official_snapshot?: unknown }).mal_official_snapshot as
      | Record<string, unknown>
      | undefined;
    const snapshotSource =
      typeof snap?.source === "string" ? snap.source : snap?.source != null ? String(snap.source) : null;

    const inMal = Number.isFinite(malId) && malId > 0 && malSet.has(malId);
    const ani = Number.isFinite(malId) && malId > 0 ? aniMap[String(malId)] : undefined;
    const inAni = Boolean(ani);

    return {
      rowId: String((row as { id?: unknown }).id ?? ""),
      title: String((row as { title?: unknown }).title ?? "—"),
      mal_manga_id: malId,
      inMalList: inMal,
      inAnilistList: inAni,
      nexusOnlyInExternalLists:
        Number.isFinite(malId) && malId > 0 && !inMal && !inAni,
      anilistMediaId: ani?.anilist_media_id ?? null,
      anilistListStatus: ani?.list_status ?? null,
      snapshotSource,
    };
  });
}
