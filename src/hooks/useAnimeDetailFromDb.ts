import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { JikanAnimeFull } from "@/services/jikan/jikanTypes";

type LocalReport = {
  full: JikanAnimeFull;
  pictures: { ok: boolean; data?: { data: Array<{ jpg: { image_url?: string; large_image_url?: string } }> }; message?: string };
  episodes: { ok: boolean; data?: { data: Array<{ mal_id: number; title: string; filler?: boolean; recap?: boolean }> }; message?: string };
};

export type FranchiseDetailEntry = {
  rowId: string;
  media: "anime" | "reading";
  malId: number;
  title: string;
  statusLabel: string;
  progressLabel: string;
  watchStatus: string | null;
  isFavorite: boolean;
  episodesSeen: number;
  episodesTotal: number;
  imageUrl: string;
};

export type UseAnimeDetailFromDbState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      rowId: string;
      report: LocalReport;
      watchStatus: string | null;
      isFavorite: boolean;
      malSnapshot: Record<string, unknown> | null;
      franchiseEntries: FranchiseDetailEntry[];
    };

function getWatchedEpisodesFromSnapshot(malSnapshot: Record<string, unknown> | null): number {
  if (!malSnapshot) {
    return 0;
  }
  const listEntry = (malSnapshot.list_entry as Record<string, unknown> | undefined) ?? {};
  const listStatus = (listEntry.list_status as Record<string, unknown> | undefined) ?? {};
  const myListStatus = (malSnapshot.my_list_status as Record<string, unknown> | undefined) ?? {};
  const raw =
    listStatus.num_episodes_watched ??
    myListStatus.num_episodes_watched ??
    malSnapshot.num_episodes_watched ??
    0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function getReadChaptersFromSnapshot(malSnapshot: Record<string, unknown> | null): number {
  if (!malSnapshot) {
    return 0;
  }
  const listEntry = (malSnapshot.list_entry as Record<string, unknown> | undefined) ?? {};
  const listStatus = (listEntry.list_status as Record<string, unknown> | undefined) ?? {};
  const myListStatus = (malSnapshot.my_list_status as Record<string, unknown> | undefined) ?? {};
  const raw =
    listStatus.num_chapters_read ??
    myListStatus.num_chapters_read ??
    malSnapshot.num_chapters_read ??
    0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function mapWatchStatusToFr(raw: string | null): string {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");
  switch (key) {
    case "watching":
      return "En cours";
    case "completed":
      return "Terminé";
    case "on_hold":
    case "onhold":
      return "En pause";
    case "dropped":
      return "Abandonné";
    default:
      return "Planifié";
  }
}

function mapReadStatusToFr(raw: string | null): string {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");
  switch (key) {
    case "reading":
      return "En cours";
    case "completed":
      return "Terminé";
    case "on_hold":
    case "onhold":
      return "En pause";
    case "dropped":
      return "Abandonné";
    default:
      return "Planifié";
  }
}

function collectRelatedIdsFromSnapshots(
  jikanSnapshot: Record<string, unknown>,
  malSnapshot: Record<string, unknown>,
  animeIds: Set<number>,
  readingIds: Set<number>
) {
  const full = (jikanSnapshot.full ?? {}) as Record<string, unknown>;
  const jikanRelations = Array.isArray(full.relations) ? (full.relations as Array<Record<string, unknown>>) : [];
  jikanRelations.forEach((relation) => {
    const entries = Array.isArray(relation.entry) ? (relation.entry as Array<Record<string, unknown>>) : [];
    entries.forEach((entry) => {
      const entryId = Number(entry.mal_id);
      if (!Number.isFinite(entryId) || entryId <= 0) {
        return;
      }
      const entryType = String(entry.type ?? "").toLowerCase();
      if (entryType === "anime") {
        animeIds.add(entryId);
      } else if (entryType === "manga") {
        readingIds.add(entryId);
      }
    });
  });

  const malRelatedAnime = Array.isArray(malSnapshot.related_anime)
    ? (malSnapshot.related_anime as Array<{ node?: { id?: unknown } }>)
    : [];
  malRelatedAnime.forEach((relation) => {
    const entryId = Number(relation.node?.id);
    if (Number.isFinite(entryId) && entryId > 0) {
      animeIds.add(entryId);
    }
  });

  const malRelatedManga = Array.isArray(malSnapshot.related_manga)
    ? (malSnapshot.related_manga as Array<{ node?: { id?: unknown } }>)
    : [];
  malRelatedManga.forEach((relation) => {
    const entryId = Number(relation.node?.id);
    if (Number.isFinite(entryId) && entryId > 0) {
      readingIds.add(entryId);
    }
  });
}

export function useAnimeDetailFromDb(malId: number | null): UseAnimeDetailFromDbState {
  const [state, setState] = useState<UseAnimeDetailFromDbState>({ status: "idle" });

  useEffect(() => {
    if (malId === null || !Number.isFinite(malId) || malId <= 0) {
      setState({ status: "error", message: "Identifiant animé invalide." });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("library_anime")
        .select("id, mal_id, watch_status, is_favorite, jikan_snapshot, mal_official_snapshot")
        .eq("mal_id", malId)
        .limit(1)
        .maybeSingle();
      if (cancelled) {
        return;
      }
      if (error) {
        setState({ status: "error", message: error.message });
        return;
      }
      if (!data) {
        setState({ status: "error", message: "Entrée absente de la base. Lance une synchronisation." });
        return;
      }

      const jikanSnapshot = (data.jikan_snapshot ?? {}) as Record<string, unknown>;
      const full = (jikanSnapshot.full ?? null) as JikanAnimeFull | null;
      if (!full) {
        setState({ status: "error", message: "Snapshot Jikan incomplet. Lance un enrichissement." });
        return;
      }

      const pictureRows = Array.isArray(jikanSnapshot.pictures)
        ? (jikanSnapshot.pictures as Array<{ jpg: { image_url?: string; large_image_url?: string } }>)
        : [];
      const episodeRows = Array.isArray(jikanSnapshot.episodes)
        ? (jikanSnapshot.episodes as Array<{ mal_id: number; title: string; filler?: boolean; recap?: boolean }>)
        : [];

      const report: LocalReport = {
        full,
        pictures: pictureRows.length
          ? { ok: true, data: { data: pictureRows } }
          : { ok: false, message: "Galerie non encore enrichie en base." },
        episodes: episodeRows.length
          ? { ok: true, data: { data: episodeRows } }
          : { ok: false, message: "Épisodes non encore enrichis en base." },
      };

      const relatedAnimeIds = new Set<number>([malId]);
      const relatedReadingIds = new Set<number>();
      const malSnapshot = (data.mal_official_snapshot as Record<string, unknown> | null) ?? null;
      collectRelatedIdsFromSnapshots(jikanSnapshot, malSnapshot ?? {}, relatedAnimeIds, relatedReadingIds);

      // Étend la franchise d'un niveau supplémentaire pour récupérer les liens indirects
      // (ex: saison 1 -> manga -> saison 3) quand ces entrées existent déjà en base.
      if (relatedAnimeIds.size > 0) {
        const { data: expandAnimeRows } = await supabase
          .from("library_anime")
          .select("jikan_snapshot, mal_official_snapshot")
          .in("mal_id", Array.from(relatedAnimeIds));
        (expandAnimeRows ?? []).forEach((row) => {
          collectRelatedIdsFromSnapshots(
            ((row as { jikan_snapshot?: unknown }).jikan_snapshot ?? {}) as Record<string, unknown>,
            ((row as { mal_official_snapshot?: unknown }).mal_official_snapshot ?? {}) as Record<string, unknown>,
            relatedAnimeIds,
            relatedReadingIds
          );
        });
      }
      if (relatedReadingIds.size > 0) {
        const { data: expandReadingRows } = await supabase
          .from("library_reading")
          .select("jikan_snapshot, mal_official_snapshot")
          .in("mal_manga_id", Array.from(relatedReadingIds));
        (expandReadingRows ?? []).forEach((row) => {
          collectRelatedIdsFromSnapshots(
            ((row as { jikan_snapshot?: unknown }).jikan_snapshot ?? {}) as Record<string, unknown>,
            ((row as { mal_official_snapshot?: unknown }).mal_official_snapshot ?? {}) as Record<string, unknown>,
            relatedAnimeIds,
            relatedReadingIds
          );
        });
      }

      const franchiseEntries: FranchiseDetailEntry[] = [];
      if (relatedAnimeIds.size > 0) {
        const { data: animeRows, error: animeRowsError } = await supabase
          .from("library_anime")
          .select("id, mal_id, title, watch_status, is_favorite, main_picture_url, jikan_snapshot, mal_official_snapshot")
          .in("mal_id", Array.from(relatedAnimeIds));
        if (animeRowsError) {
          setState({ status: "error", message: animeRowsError.message });
          return;
        }
        (animeRows ?? []).forEach((row) => {
          const rowMalId = Number(row.mal_id);
          const rowJikan = (row.jikan_snapshot ?? {}) as Record<string, unknown>;
          const rowFull = (rowJikan.full ?? {}) as Record<string, unknown>;
          const rowMalSnapshot = (row.mal_official_snapshot ?? {}) as Record<string, unknown>;
          const episodesTotal = Number(rowFull.episodes ?? rowMalSnapshot.num_episodes ?? 0);
          const episodesSeen = getWatchedEpisodesFromSnapshot(rowMalSnapshot);
          const statusLabel = mapWatchStatusToFr((row.watch_status as string | null) ?? null);
          franchiseEntries.push({
            rowId: String(row.id),
            media: "anime",
            malId: rowMalId,
            title: String(row.title ?? `MAL ${rowMalId}`),
            statusLabel,
            progressLabel: `${episodesSeen}/${Number.isFinite(episodesTotal) ? episodesTotal : 0} ép.`,
            watchStatus: (row.watch_status as string | null) ?? null,
            isFavorite: Boolean(row.is_favorite ?? false),
            episodesSeen,
            episodesTotal: Number.isFinite(episodesTotal) ? episodesTotal : 0,
            imageUrl: String(
              row.main_picture_url ??
                ((rowFull.images as Record<string, unknown> | undefined)?.jpg as Record<string, unknown> | undefined)
                  ?.large_image_url ??
                ""
            ),
          });
        });
      }
      if (relatedReadingIds.size > 0) {
        const { data: readingRows, error: readingRowsError } = await supabase
          .from("library_reading")
          .select("id, mal_manga_id, title, read_status, main_picture_url, jikan_snapshot, mal_official_snapshot")
          .in("mal_manga_id", Array.from(relatedReadingIds));
        if (readingRowsError) {
          setState({ status: "error", message: readingRowsError.message });
          return;
        }
        (readingRows ?? []).forEach((row) => {
          const rowMalId = Number(row.mal_manga_id);
          const rowJikan = (row.jikan_snapshot ?? {}) as Record<string, unknown>;
          const rowFull = (rowJikan.full ?? {}) as Record<string, unknown>;
          const rowMalSnapshot = (row.mal_official_snapshot ?? {}) as Record<string, unknown>;
          const chaptersTotal = Number(rowFull.chapters ?? rowMalSnapshot.num_chapters ?? 0);
          const chaptersRead = getReadChaptersFromSnapshot(rowMalSnapshot);
          const statusLabel = mapReadStatusToFr((row.read_status as string | null) ?? null);
          franchiseEntries.push({
            rowId: String(row.id),
            media: "reading",
            malId: rowMalId,
            title: String(row.title ?? `MAL ${rowMalId}`),
            statusLabel,
            progressLabel: `${chaptersRead}/${Number.isFinite(chaptersTotal) ? chaptersTotal : 0} ch.`,
            watchStatus: null,
            isFavorite: false,
            episodesSeen: 0,
            episodesTotal: 0,
            imageUrl: String(
              row.main_picture_url ??
                ((rowFull.images as Record<string, unknown> | undefined)?.jpg as Record<string, unknown> | undefined)
                  ?.large_image_url ??
                ""
            ),
          });
        });
      }

      franchiseEntries.sort((a, b) => {
        if (a.media !== b.media) {
          return a.media === "anime" ? -1 : 1;
        }
        return a.title.localeCompare(b.title);
      });

      setState({
        status: "ready",
        rowId: String(data.id),
        report,
        watchStatus: (data.watch_status as string | null) ?? null,
        isFavorite: Boolean(data.is_favorite ?? false),
        malSnapshot,
        franchiseEntries,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [malId]);

  return state;
}
