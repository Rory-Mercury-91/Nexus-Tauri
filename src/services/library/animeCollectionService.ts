import type { SupabaseClient } from "@supabase/supabase-js";
import { translateLibraryTerms } from "@/services/library/termTranslations";

export type AnimeCollectionEntry = {
  id: string;
  malId: number;
  title: string;
  type: "TV" | "Film" | "ONA" | "OVA" | "Spécial";
  userStatus: "Planifié" | "En cours" | "En pause" | "Terminé" | "Abandonné";
  workStatus: "En cours" | "Terminé" | "Abandonné" | "À venir";
  score: number;
  favorite: boolean;
  episodesSeen: number;
  episodesTotal: number;
  genres: string[];
  themes: string[];
  imageUrl: string;
  addedAt: string;
  relatedAnimeIds: number[];
};

function normalizeStatus(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");
}

function mapWatchStatus(raw: unknown): AnimeCollectionEntry["userStatus"] {
  const value = normalizeStatus(raw);
  switch (value) {
    case "watching":
      return "En cours";
    case "completed":
      return "Terminé";
    case "on_hold":
    case "onhold":
      return "En pause";
    case "dropped":
      return "Abandonné";
    case "plan_to_watch":
    case "plantowatch":
    default:
      return "Planifié";
  }
}

export function mapUserStatusToWatchStatus(raw: AnimeCollectionEntry["userStatus"]): string {
  switch (raw) {
    case "En cours":
      return "watching";
    case "Terminé":
      return "completed";
    case "En pause":
      return "on_hold";
    case "Abandonné":
      return "dropped";
    default:
      return "plan_to_watch";
  }
}

function mapMediaType(raw: unknown): AnimeCollectionEntry["type"] {
  const value = typeof raw === "string" ? raw.toLowerCase() : "";
  if (value === "movie") return "Film";
  if (value === "ona") return "ONA";
  if (value === "ova") return "OVA";
  if (value === "special") return "Spécial";
  return "TV";
}

function mapWorkStatus(raw: unknown, fallbackWatchStatus: unknown): AnimeCollectionEntry["workStatus"] {
  const value = normalizeStatus(raw);
  if (value === "currently_airing") return "En cours";
  if (value === "finished_airing") return "Terminé";
  if (value === "not_yet_aired") return "À venir";
  if (value === "abandoned") return "Abandonné";
  // Fallback: si le statut de l'oeuvre est absent, on évite de perdre les entrées "watching".
  if (normalizeStatus(fallbackWatchStatus) === "watching") {
    return "En cours";
  }
  return "Terminé";
}

export async function fetchAnimeCollection(supabase: SupabaseClient): Promise<AnimeCollectionEntry[]> {
  const { data, error } = await supabase
    .from("library_anime")
    .select("id, mal_id, title, title_english, main_picture_url, watch_status, is_favorite, created_at, mal_official_snapshot, jikan_snapshot")
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  const rows = data ?? [];
  return rows.map((row) => {
    const malSnapshot = (row.mal_official_snapshot ?? {}) as Record<string, unknown>;
    const jikanSnapshot = (row.jikan_snapshot ?? {}) as Record<string, unknown>;
    const full = (jikanSnapshot.full ?? {}) as Record<string, unknown>;
    const episodes = Number(full.episodes ?? malSnapshot.num_episodes ?? 0);
    const listEntry = (malSnapshot.list_entry ?? {}) as Record<string, unknown>;
    const listStatus = (listEntry.list_status ?? {}) as Record<string, unknown>;
    const myListStatus = (malSnapshot.my_list_status ?? {}) as Record<string, unknown>;
    const rawWatchStatus = (row.watch_status as string | null) ?? listStatus.status ?? myListStatus.status ?? null;
    const progress = Number(listStatus.num_episodes_watched ?? 0);
    const genres = Array.isArray(full.genres)
      ? (full.genres as Array<Record<string, unknown>>).map((g) => String(g.name ?? "")).filter(Boolean)
      : [];
    const themes = Array.isArray(full.themes)
      ? (full.themes as Array<Record<string, unknown>>).map((g) => String(g.name ?? "")).filter(Boolean)
      : [];
    const score = Number(
      listStatus.score ??
        malSnapshot.mean ??
        full.score ??
        0
    );
    const favorite = Boolean((row as { is_favorite?: unknown }).is_favorite ?? listStatus.is_rewatching ?? false);
    const type = mapMediaType(full.type ?? malSnapshot.media_type);
    const workStatus = mapWorkStatus(full.status ?? malSnapshot.status, rawWatchStatus);
    const imageUrl =
      row.main_picture_url ||
      String(((full.images as Record<string, unknown> | undefined)?.jpg as Record<string, unknown> | undefined)?.large_image_url ?? "") ||
      "";
    const relations = Array.isArray(full.relations) ? (full.relations as Array<Record<string, unknown>>) : [];
    const relatedAnimeIds = relations
      .filter((relation) => {
        const type = String(relation.relation ?? "").toLowerCase();
        return type === "prequel" || type === "sequel";
      })
      .flatMap((relation) =>
        Array.isArray(relation.entry)
          ? (relation.entry as Array<Record<string, unknown>>)
              .filter((entry) => String(entry.type ?? "").toLowerCase() === "anime")
              .map((entry) => Number(entry.mal_id))
              .filter((id) => Number.isFinite(id) && id > 0)
          : []
      );

    return {
      id: row.id as string,
      malId: Number(row.mal_id),
      title: String(row.title),
      type,
      userStatus: mapWatchStatus(rawWatchStatus),
      workStatus,
      score: Number.isFinite(score) ? score : 0,
      favorite,
      episodesSeen: Number.isFinite(progress) ? progress : 0,
      episodesTotal: Number.isFinite(episodes) ? episodes : 0,
      genres: translateLibraryTerms("genre", genres),
      themes: translateLibraryTerms("theme", themes),
      imageUrl,
      addedAt: String(row.created_at),
      relatedAnimeIds: Array.from(new Set(relatedAnimeIds)),
    };
  });
}

export async function updateAnimeWatchStatus(
  supabase: SupabaseClient,
  rowId: string,
  userStatus: AnimeCollectionEntry["userStatus"]
) {
  const watchStatus = mapUserStatusToWatchStatus(userStatus);
  const { error } = await supabase
    .from("library_anime")
    .update({
      watch_status: watchStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rowId);
  if (error) {
    throw new Error(error.message);
  }
}

export async function updateAnimeFavorite(
  supabase: SupabaseClient,
  rowId: string,
  favorite: boolean
) {
  const { error } = await supabase
    .from("library_anime")
    .update({
      is_favorite: favorite,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rowId);
  if (error) {
    throw new Error(error.message);
  }
}
