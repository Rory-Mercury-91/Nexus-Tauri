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
  anilistMediaId: number | null;
  /** Présent dans la mangalist MAL (API). */
  inMalList: boolean;
  /** Présent sur AniList avec un idMal qui pointe vers ce MAL id. */
  inAnilistList: boolean;
  anilistListStatus: string | null;
  /** Fiche Nexus sans entrée correspondante dans les deux flux (ni MAL ni AniList lié). */
  nexusOnlyInExternalLists: boolean;
  /** Dernière source vue dans le snapshot (sync worker). */
  snapshotSource: string | null;
  /** A des données Mihon (tracking Mihon associé à cette fiche). */
  hasMihon: boolean;
  /** A un lien / des données Nautiljon (import Nautiljon effectué). */
  hasNautiljon: boolean;
  /** Même mal_manga_id que d'autres fiches Nexus (doublon local). */
  isDuplicateMalId: boolean;
};

/**
 * Interroge MAL + AniList (tokens OAuth) et retourne les jeux d'ids pour comparaison.
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

/** Filtre pour le tableau de comparaison Nexus ↔ listes distantes. */
export type ReadingListCompareFilter =
  | "all"
  /** Fiches sans `mal_manga_id` (non comparables aux listes distantes). */
  | "nexus_no_mal_id"
  /** Uniquement les fiches avec un MAL id (comparables). */
  | "comparable_only"
  /** Dans la mangalist MAL et sur AniList. */
  | "both_remotes"
  /** MAL id présent : dans la mangalist MAL mais pas sur AniList (lié MAL). */
  | "mal_only_remote"
  /** MAL id présent : sur AniList (idMal) mais pas dans la mangalist MAL. */
  | "anilist_only_remote"
  /** Dans Nexus avec MAL id mais absent des deux listes distantes. */
  | "nexus_absent_both"
  /** Décroché : présent d'un côté seulement (MAL xor AniList). */
  | "mal_anilist_desync"
  /** A un tracking Mihon associé. */
  | "has_mihon"
  /** A un import Nautiljon associé. */
  | "has_nautiljon"
  /** Même mal_manga_id que d'autres fiches (doublons locaux). */
  | "duplicate_malid"
  /** Aucune source externe connue (pas MAL, AniList, Mihon ni Nautiljon). */
  | "no_source"
  /** Source Mihon uniquement — pas de présence MAL ni AniList. */
  | "mihon_only_source"
  /** Source Nautiljon uniquement — pas de présence MAL ni AniList. */
  | "nautiljon_only_source";

export function filterReadingEntryDiagnostics(
  entries: ReadingEntryDiagnostic[],
  filter: ReadingListCompareFilter
): ReadingEntryDiagnostic[] {
  if (filter === "all") return entries;
  return entries.filter((row) => {
    const hasMalId = row.mal_manga_id > 0;
    switch (filter) {
      case "nexus_no_mal_id":       return !hasMalId;
      case "comparable_only":       return hasMalId;
      case "both_remotes":          return hasMalId && row.inMalList && row.inAnilistList;
      case "mal_only_remote":       return hasMalId && row.inMalList && !row.inAnilistList;
      case "anilist_only_remote":   return hasMalId && row.inAnilistList && !row.inMalList;
      case "nexus_absent_both":     return row.nexusOnlyInExternalLists;
      case "mal_anilist_desync":    return hasMalId && row.inMalList !== row.inAnilistList;
      case "has_mihon":             return row.hasMihon;
      case "has_nautiljon":         return row.hasNautiljon;
      case "duplicate_malid":       return row.isDuplicateMalId;
      case "no_source":
        return !row.inMalList && !row.inAnilistList && !row.hasMihon && !row.hasNautiljon;
      case "mihon_only_source":
        return row.hasMihon && !row.inMalList && !row.inAnilistList;
      case "nautiljon_only_source":
        return row.hasNautiljon && !row.inMalList && !row.inAnilistList;
      default:
        return true;
    }
  });
}

/**
 * Croise les entrées `library_reading` avec les flux MAL / AniList,
 * et détecte la présence Mihon, Nautiljon et les doublons MAL id locaux.
 */
export async function buildReadingEntryDiagnostics(
  supabase: SupabaseClient,
  external: ExternalListDiagnosticsPayload
): Promise<ReadingEntryDiagnostic[]> {
  const { data: rows, error } = await supabase
    .from("library_reading")
    .select("id, title, mal_manga_id, anilist_media_id, mal_official_snapshot")
    .order("title", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }

  const malSet = new Set(external.mal_manga_ids);
  const aniMap = external.anilist_by_mal_id;

  // Passe 1 : compter les mal_manga_id pour détecter les doublons locaux
  const malIdCount = new Map<number, number>();
  for (const row of rows ?? []) {
    const id = Number((row as Record<string, unknown>).mal_manga_id ?? 0);
    if (id > 0) {
      malIdCount.set(id, (malIdCount.get(id) ?? 0) + 1);
    }
  }

  // Passe 2 : construire les diagnostics
  return (rows ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const malId = Number(r.mal_manga_id ?? 0);
    const anilistMediaIdRaw = Number(r.anilist_media_id ?? 0);
    const anilistMediaId = Number.isFinite(anilistMediaIdRaw) && anilistMediaIdRaw > 0
      ? anilistMediaIdRaw
      : null;

    const snap = (r.mal_official_snapshot ?? {}) as Record<string, unknown>;
    const snapshotSource =
      typeof snap.source === "string" ? snap.source : snap.source != null ? String(snap.source) : null;

    const overrides = (snap.manual_overrides ?? {}) as Record<string, unknown>;
    const links = (overrides.links ?? {}) as Record<string, unknown>;

    // Mihon : lien source Mihon dans les overrides
    const hasMihon = Boolean(
      overrides.mihon_source_id ||
      String(links.mihon_source ?? "").trim()
    );
    // Nautiljon : lien Nautiljon dans les overrides
    const hasNautiljon = Boolean(String(links.nautiljon ?? "").trim());

    const inMal = Number.isFinite(malId) && malId > 0 && malSet.has(malId);
    const ani = Number.isFinite(malId) && malId > 0 ? aniMap[String(malId)] : undefined;
    const inAni = Boolean(ani);

    return {
      rowId: String(r.id ?? ""),
      title: String(r.title ?? "—"),
      mal_manga_id: malId,
      anilistMediaId: ani?.anilist_media_id ?? anilistMediaId,
      inMalList: inMal,
      inAnilistList: inAni,
      anilistListStatus: ani?.list_status ?? null,
      nexusOnlyInExternalLists: Number.isFinite(malId) && malId > 0 && !inMal && !inAni,
      snapshotSource,
      hasMihon,
      hasNautiljon,
      isDuplicateMalId: Number.isFinite(malId) && malId > 0 && (malIdCount.get(malId) ?? 0) > 1,
    };
  });
}
