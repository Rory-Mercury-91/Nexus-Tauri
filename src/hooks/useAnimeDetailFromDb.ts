import { useEffect, useState } from "react";
import { collectRelatedIdsFromSnapshots } from "@/lib/libraryRelationSnapshots";
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
  anilistMediaId: number | null;
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
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id ?? "";
      if (!userId) {
        setState({ status: "error", message: "Session requise." });
        return;
      }
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

      const relatedAnimeMalIds = new Set<number>([malId]);
      const relatedReadingMalIds = new Set<number>();
      const relatedAnimeAnilistIds = new Set<number>();
      const relatedReadingAnilistIds = new Set<number>();
      const relatedIdOpts = {
        animeAnilistIds: relatedAnimeAnilistIds,
        readingAnilistIds: relatedReadingAnilistIds,
      };
      const malSnapshot = (data.mal_official_snapshot as Record<string, unknown> | null) ?? null;
      collectRelatedIdsFromSnapshots(jikanSnapshot, malSnapshot ?? {}, relatedAnimeMalIds, relatedReadingMalIds, relatedIdOpts);

      // Étend la franchise d'un niveau supplémentaire pour récupérer les liens indirects
      // (ex: saison 1 -> manga -> saison 3) quand ces entrées existent déjà en base.
      if (relatedAnimeMalIds.size > 0 || relatedAnimeAnilistIds.size > 0) {
        const expandChunks: Array<{ jikan_snapshot?: unknown; mal_official_snapshot?: unknown }> = [];
        if (relatedAnimeMalIds.size > 0) {
          const { data: expandAnimeMal } = await supabase
            .from("library_anime")
            .select("jikan_snapshot, mal_official_snapshot")
            .eq("user_id", userId)
            .in("mal_id", Array.from(relatedAnimeMalIds));
          expandChunks.push(...(expandAnimeMal ?? []));
        }
        if (relatedAnimeAnilistIds.size > 0) {
          const { data: expandAnimeAni } = await supabase
            .from("library_anime")
            .select("jikan_snapshot, mal_official_snapshot")
            .eq("user_id", userId)
            .in("anilist_media_id", Array.from(relatedAnimeAnilistIds));
          expandChunks.push(...(expandAnimeAni ?? []));
        }
        expandChunks.forEach((row) => {
          collectRelatedIdsFromSnapshots(
            ((row as { jikan_snapshot?: unknown }).jikan_snapshot ?? {}) as Record<string, unknown>,
            ((row as { mal_official_snapshot?: unknown }).mal_official_snapshot ?? {}) as Record<string, unknown>,
            relatedAnimeMalIds,
            relatedReadingMalIds,
            relatedIdOpts
          );
        });
      }
      if (relatedReadingMalIds.size > 0 || relatedReadingAnilistIds.size > 0) {
        const expandChunks: Array<{ jikan_snapshot?: unknown; mal_official_snapshot?: unknown }> = [];
        if (relatedReadingMalIds.size > 0) {
          const { data: expandReadingMal } = await supabase
            .from("library_reading")
            .select("jikan_snapshot, mal_official_snapshot")
            .eq("user_id", userId)
            .in("mal_manga_id", Array.from(relatedReadingMalIds));
          expandChunks.push(...(expandReadingMal ?? []));
        }
        if (relatedReadingAnilistIds.size > 0) {
          const { data: expandReadingAni } = await supabase
            .from("library_reading")
            .select("jikan_snapshot, mal_official_snapshot")
            .eq("user_id", userId)
            .in("anilist_media_id", Array.from(relatedReadingAnilistIds));
          expandChunks.push(...(expandReadingAni ?? []));
        }
        expandChunks.forEach((row) => {
          collectRelatedIdsFromSnapshots(
            ((row as { jikan_snapshot?: unknown }).jikan_snapshot ?? {}) as Record<string, unknown>,
            ((row as { mal_official_snapshot?: unknown }).mal_official_snapshot ?? {}) as Record<string, unknown>,
            relatedAnimeMalIds,
            relatedReadingMalIds,
            relatedIdOpts
          );
        });
      }

      const franchiseEntries: FranchiseDetailEntry[] = [];
      if (relatedAnimeMalIds.size > 0 || relatedAnimeAnilistIds.size > 0) {
        const animeChunks: Array<Record<string, unknown>> = [];
        if (relatedAnimeMalIds.size > 0) {
          const { data: animeRowsMal, error: animeRowsMalError } = await supabase
            .from("library_anime")
            .select(
              "id, mal_id, anilist_media_id, title, watch_status, is_favorite, main_picture_url, jikan_snapshot, mal_official_snapshot"
            )
            .eq("user_id", userId)
            .in("mal_id", Array.from(relatedAnimeMalIds));
          if (animeRowsMalError) {
            setState({ status: "error", message: animeRowsMalError.message });
            return;
          }
          animeChunks.push(...((animeRowsMal ?? []) as Record<string, unknown>[]));
        }
        if (relatedAnimeAnilistIds.size > 0) {
          const { data: animeRowsAni, error: animeRowsAniError } = await supabase
            .from("library_anime")
            .select(
              "id, mal_id, anilist_media_id, title, watch_status, is_favorite, main_picture_url, jikan_snapshot, mal_official_snapshot"
            )
            .eq("user_id", userId)
            .in("anilist_media_id", Array.from(relatedAnimeAnilistIds));
          if (animeRowsAniError) {
            setState({ status: "error", message: animeRowsAniError.message });
            return;
          }
          animeChunks.push(...((animeRowsAni ?? []) as Record<string, unknown>[]));
        }
        const animeByRow = new Map<string, FranchiseDetailEntry>();
        animeChunks.forEach((row) => {
          const rowMalId = Number(row.mal_id ?? 0);
          const aniRaw = row.anilist_media_id;
          const aniId =
            aniRaw != null && Number.isFinite(Number(aniRaw)) && Number(aniRaw) > 0 ? Number(aniRaw) : null;
          const rowJikan = (row.jikan_snapshot ?? {}) as Record<string, unknown>;
          const rowFull = (rowJikan.full ?? rowJikan.data ?? {}) as Record<string, unknown>;
          const rowMalSnapshot = (row.mal_official_snapshot ?? {}) as Record<string, unknown>;
          const episodesTotal = Number(rowFull.episodes ?? rowMalSnapshot.num_episodes ?? 0);
          const episodesSeen = getWatchedEpisodesFromSnapshot(rowMalSnapshot);
          const statusLabel = mapWatchStatusToFr((row.watch_status as string | null) ?? null);
          animeByRow.set(String(row.id), {
            rowId: String(row.id),
            media: "anime",
            malId: Number.isFinite(rowMalId) && rowMalId > 0 ? rowMalId : 0,
            anilistMediaId: aniId,
            title: String(row.title ?? (rowMalId > 0 ? `MAL ${rowMalId}` : aniId ? `AniList ${aniId}` : "—")),
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
        animeByRow.forEach((v) => franchiseEntries.push(v));
      }
      if (relatedReadingMalIds.size > 0 || relatedReadingAnilistIds.size > 0) {
        const readingChunks: Array<Record<string, unknown>> = [];
        if (relatedReadingMalIds.size > 0) {
          const { data: readingRowsMal, error: readingRowsMalError } = await supabase
            .from("library_reading")
            .select("id, mal_manga_id, anilist_media_id, title, read_status, main_picture_url, jikan_snapshot, mal_official_snapshot")
            .eq("user_id", userId)
            .in("mal_manga_id", Array.from(relatedReadingMalIds));
          if (readingRowsMalError) {
            setState({ status: "error", message: readingRowsMalError.message });
            return;
          }
          readingChunks.push(...((readingRowsMal ?? []) as Record<string, unknown>[]));
        }
        if (relatedReadingAnilistIds.size > 0) {
          const { data: readingRowsAni, error: readingRowsAniError } = await supabase
            .from("library_reading")
            .select("id, mal_manga_id, anilist_media_id, title, read_status, main_picture_url, jikan_snapshot, mal_official_snapshot")
            .eq("user_id", userId)
            .in("anilist_media_id", Array.from(relatedReadingAnilistIds));
          if (readingRowsAniError) {
            setState({ status: "error", message: readingRowsAniError.message });
            return;
          }
          readingChunks.push(...((readingRowsAni ?? []) as Record<string, unknown>[]));
        }
        const readingByRow = new Map<string, FranchiseDetailEntry>();
        readingChunks.forEach((row) => {
          const rowMalId = Number(row.mal_manga_id ?? 0);
          const aniRaw = row.anilist_media_id;
          const aniId =
            aniRaw != null && Number.isFinite(Number(aniRaw)) && Number(aniRaw) > 0 ? Number(aniRaw) : null;
          const rowJikan = (row.jikan_snapshot ?? {}) as Record<string, unknown>;
          const rowFull = (rowJikan.full ?? rowJikan.data ?? {}) as Record<string, unknown>;
          const rowMalSnapshot = (row.mal_official_snapshot ?? {}) as Record<string, unknown>;
          const chaptersTotal = Number(rowFull.chapters ?? rowMalSnapshot.num_chapters ?? 0);
          const chaptersRead = getReadChaptersFromSnapshot(rowMalSnapshot);
          const statusLabel = mapReadStatusToFr((row.read_status as string | null) ?? null);
          readingByRow.set(String(row.id), {
            rowId: String(row.id),
            media: "reading",
            malId: Number.isFinite(rowMalId) && rowMalId > 0 ? rowMalId : 0,
            anilistMediaId: aniId,
            title: String(row.title ?? (rowMalId > 0 ? `MAL ${rowMalId}` : aniId ? `AniList ${aniId}` : "—")),
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
        readingByRow.forEach((v) => franchiseEntries.push(v));
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
