import type { SupabaseClient } from "@supabase/supabase-js";
import {
  coalesceFirstFiniteNumber,
  extractNumEpisodesWatchedFromMalOfficialSnapshot,
  mergeWatchProgressBySource,
  resolveCanonicalWatchStatus,
} from "@/services/library/readingProgressResolution";
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

const PG_INT_MAX = 2_147_483_647;
const MANUAL_ID_MIN = 1_900_000_000;
const MANUAL_ID_MAX = 2_100_000_000;

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

export async function fetchAnimeCollectionStamp(
  supabase: SupabaseClient
): Promise<{ latestUpdatedAt: string | null; count: number }> {
  const [{ data: latestRows, error: latestError }, { count, error: countError }] = await Promise.all([
    supabase
      .from("library_anime")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1),
    supabase
      .from("library_anime")
      .select("id", { count: "exact", head: true }),
  ]);
  if (latestError) {
    throw new Error(latestError.message);
  }
  if (countError) {
    throw new Error(countError.message);
  }
  return {
    latestUpdatedAt: latestRows?.[0]?.updated_at ?? null,
    count: Number(count ?? 0),
  };
}

export async function updateAnimeWatchStatus(
  supabase: SupabaseClient,
  rowId: string,
  userStatus: AnimeCollectionEntry["userStatus"]
) {
  const watchStatus = mapUserStatusToWatchStatus(userStatus);
  const { data: row } = await supabase
    .from("library_anime")
    .select("watch_progress_by_source, mal_official_snapshot")
    .eq("id", rowId)
    .maybeSingle();
  const prevBy = (row?.watch_progress_by_source ?? {}) as Record<string, unknown>;
  let merged = mergeWatchProgressBySource(prevBy, "nexus", {
    watch_status: watchStatus,
    updated_at: new Date().toISOString(),
  });
  const nex = { ...(merged.nexus as Record<string, unknown> | undefined) };
  if (nex.episodes_watched == null) {
    const ep = coalesceFirstFiniteNumber(
      (prevBy.nexus as Record<string, unknown> | undefined)?.episodes_watched,
      (merged.mal as Record<string, unknown> | undefined)?.episodes_watched,
      extractNumEpisodesWatchedFromMalOfficialSnapshot(row?.mal_official_snapshot)
    );
    if (ep != null) {
      nex.episodes_watched = ep;
    }
  }
  merged = { ...merged, nexus: nex };
  const canonical = resolveCanonicalWatchStatus(merged) ?? watchStatus;
  const { error } = await supabase
    .from("library_anime")
    .update({
      watch_progress_by_source: merged,
      watch_status: canonical,
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

function buildManualAnimeFull(malId: number, title: string, imageUrl: string): Record<string, unknown> {
  return {
    mal_id: malId,
    url: `https://myanimelist.net/anime/${malId}`,
    title,
    title_english: title,
    title_japanese: "",
    title_synonyms: [],
    type: "TV",
    status: "Not yet aired",
    rating: "PG-13",
    source: "Unknown",
    episodes: 0,
    duration: "",
    synopsis: "",
    aired: { string: "" },
    trailer: { embed_url: "" },
    images: {
      jpg: {
        image_url: imageUrl,
        large_image_url: imageUrl,
      },
      webp: {
        image_url: imageUrl,
        large_image_url: imageUrl,
      },
    },
    genres: [],
    themes: [],
    demographics: [],
    studios: [],
    producers: [],
    licensors: [],
    relations: [],
  };
}

export async function createManualAnimeEntry(
  supabase: SupabaseClient,
  input: {
    title: string;
    malId?: number;
    imageUrl?: string;
    titleEnglish?: string;
    titleJapanese?: string;
    titleAlternatives?: string[];
    mediaType?: string;
    workStatus?: string;
    source?: string;
    episodes?: number;
    duration?: string;
    synopsis?: string;
    synopsisFr?: string;
    rating?: string;
    seasonLabel?: string;
    linkMal?: string;
    linkNautiljon?: string;
    linkAnilist?: string;
    streamCrunchyroll?: string;
    streamPrimeVideo?: string;
    streamDisneyPlus?: string;
    streamAdn?: string;
    streamAnimeSama?: string;
    trailerUrl?: string;
    userStatus?: AnimeCollectionEntry["userStatus"];
    favorite?: boolean;
  }
): Promise<number> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Le titre est obligatoire.");
  }
  const malId = await resolveManualAnimeMalId(supabase, input.malId);
  const imageUrl = (input.imageUrl ?? "").trim();
  const full = buildManualAnimeFull(malId, title, imageUrl);
  full.title_english = input.titleEnglish?.trim() || title;
  full.title_japanese = input.titleJapanese?.trim() || "";
  full.title_synonyms = input.titleAlternatives ?? [];
  full.type = input.mediaType?.trim() || "TV";
  full.status = input.workStatus?.trim() || "Not yet aired";
  full.source = input.source?.trim() || "Unknown";
  full.rating = input.rating?.trim() || "PG-13";
  full.season = input.seasonLabel?.trim() || "";
  full.episodes = Math.max(0, Number(input.episodes ?? 0));
  full.duration = input.duration?.trim() || "";
  full.synopsis = input.synopsis?.trim() || "";
  full.url = input.linkMal?.trim() || `https://myanimelist.net/anime/${malId}`;
  full.trailer = {
    embed_url: input.trailerUrl?.trim() || "",
  };
  const userStatus = input.userStatus ?? "Planifié";
  const favorite = Boolean(input.favorite ?? false);
  const malSnapshot = {
    list_entry: {
      list_status: {
        status: mapUserStatusToWatchStatus(userStatus),
        score: 0,
        num_episodes_watched: 0,
        is_favorite: favorite,
      },
    },
    manual_overrides: {
      title_fr: title,
      synopsis_fr: input.synopsisFr?.trim() || "",
      locked_field_ids: ["title", "status", "episodes", "synopsis"],
      links: {
        mal: input.linkMal?.trim() || "",
        nautiljon: input.linkNautiljon?.trim() || "",
        anilist: input.linkAnilist?.trim() || "",
        crunchyroll: input.streamCrunchyroll?.trim() || "",
        prime_video: input.streamPrimeVideo?.trim() || "",
        disney_plus: input.streamDisneyPlus?.trim() || "",
        adn: input.streamAdn?.trim() || "",
        anime_sama: input.streamAnimeSama?.trim() || "",
      },
    },
  };
  const { error } = await supabase.rpc("upsert_library_anime_entry", {
    p_mal_id: malId,
    p_title: title,
    p_title_english: String(full.title_english ?? title),
    p_main_picture_url: imageUrl || null,
    p_jikan_snapshot: { full, pictures: [], episodes: [] },
    p_mal_official_snapshot: malSnapshot,
    p_watch_status: mapUserStatusToWatchStatus(userStatus),
    p_is_favorite: favorite,
    p_user_notes: "",
  });
  if (error) {
    throw new Error(error.message);
  }
  return malId;
}

async function resolveManualAnimeMalId(
  supabase: SupabaseClient,
  preferredMalId?: number
): Promise<number> {
  if (Number.isFinite(preferredMalId) && (preferredMalId ?? 0) > 0) {
    const value = Number(preferredMalId);
    if (value > PG_INT_MAX) {
      throw new Error("Le MAL ID manuel dépasse la limite autorisée.");
    }
    return value;
  }
  for (let i = 0; i < 16; i += 1) {
    const candidate =
      MANUAL_ID_MIN + Math.floor(Math.random() * (MANUAL_ID_MAX - MANUAL_ID_MIN));
    const { data, error } = await supabase
      .from("library_anime")
      .select("id")
      .eq("mal_id", candidate)
      .maybeSingle();
    if (error) {
      throw new Error(error.message);
    }
    if (!data) {
      return candidate;
    }
  }
  throw new Error("Impossible de générer un identifiant manuel unique.");
}

export async function deleteAnimeEntry(
  supabase: SupabaseClient,
  rowId: string
): Promise<void> {
  const { error } = await supabase.from("library_anime").delete().eq("id", rowId);
  if (error) {
    throw new Error(error.message);
  }
}
