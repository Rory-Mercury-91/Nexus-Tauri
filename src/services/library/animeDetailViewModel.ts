import type { JikanAnimeFull, JikanMalMini } from "@/services/jikan/jikanTypes";
import type { MalOfficialBundlePayload } from "@/services/mal/malOfficialBundleService";

type MalAnimeRelationRow = {
  node?: { id?: number; title?: string };
  relation_type_formatted?: string;
};

type MalAnimeDetail = {
  title?: string;
  alternative_titles?: {
    en?: string;
    ja?: string;
    synonyms?: string[];
  };
  synopsis?: string;
  mean?: number;
  status?: string;
  media_type?: string;
  source?: string;
  num_episodes?: number;
  average_episode_duration?: number;
  rating?: string;
  start_date?: string;
  end_date?: string;
  start_season?: { year?: number; season?: string };
  main_picture?: { large?: string; medium?: string };
  related_anime?: MalAnimeRelationRow[];
  related_manga?: MalAnimeRelationRow[];
};

const STATUS_FR: Record<string, string> = {
  finished_airing: "Terminé",
  currently_airing: "En cours",
  not_yet_aired: "À venir",
};

const MEDIA_TYPE_FR: Record<string, string> = {
  tv: "TV",
  movie: "Film",
  ova: "OVA",
  ona: "ONA",
  special: "Spécial",
  music: "Musique",
};

const SOURCE_FR: Record<string, string> = {
  original: "Original",
  manga: "Manga",
  light_novel: "Light novel",
  novel: "Roman",
  web_manga: "Web manga",
  game: "Jeu vidéo",
  visual_novel: "Visual novel",
  mixed_media: "Média mixte",
  other: "Autre",
  unknown: "Inconnue",
};

const RATING_FR: Record<string, string> = {
  g: "Tout public",
  pg: "Supervision parentale",
  pg_13: "PG-13 (13+)",
  r: "R (17+)",
  r_plus: "R+ (nudité légère)",
  rx: "Rx (hentai)",
};

const SEASON_FR: Record<string, string> = {
  winter: "Hiver",
  spring: "Printemps",
  summer: "Été",
  fall: "Automne",
};

export type ResolvedRelationGroup = {
  relation: string;
  entry: JikanMalMini[];
};

export type AnimeDetailResolvedFields = {
  title: string;
  titleEnglish: string | null;
  titleJapanese: string | null;
  titleAlternatives: string[];
  synopsis: string | null;
  score: number | null;
  status: string;
  mediaType: string;
  source: string;
  episodes: number | null;
  duration: string;
  rating: string;
  aired: string;
  seasonLabel: string;
  posterUrl: string | null;
  relations: ResolvedRelationGroup[];
};

function getMalAnimeDetail(payload: MalOfficialBundlePayload | null): MalAnimeDetail | null {
  if (!payload) {
    return null;
  }
  const part = payload.parts.anime_detail;
  if (!part.ok || !part.data || typeof part.data !== "object") {
    return null;
  }
  return part.data as MalAnimeDetail;
}

function mapMALStatus(raw: string | undefined): string {
  if (!raw) {
    return "—";
  }
  const key = raw.toLowerCase();
  return STATUS_FR[key] ?? raw.replaceAll("_", " ");
}

function mapMALMediaType(raw: string | undefined): string {
  if (!raw) {
    return "—";
  }
  const key = raw.toLowerCase();
  return MEDIA_TYPE_FR[key] ?? raw.toUpperCase();
}

function mapMALRating(raw: string | undefined): string {
  if (!raw) {
    return "—";
  }
  const key = raw.toLowerCase();
  return RATING_FR[key] ?? raw.replaceAll("_", " ").toUpperCase();
}

function mapMALSource(raw: string | undefined): string {
  if (!raw) {
    return "—";
  }
  const key = raw.toLowerCase();
  return SOURCE_FR[key] ?? raw.replaceAll("_", " ");
}

function formatIsoDateFr(raw?: string): string | null {
  if (!raw) {
    return null;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return raw;
  }
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

function malAiredLabel(startDate?: string, endDate?: string): string {
  if (!startDate && !endDate) {
    return "—";
  }
  return `${formatIsoDateFr(startDate) ?? "?"} → ${formatIsoDateFr(endDate) ?? "?"}`;
}

function malSeasonLabel(startSeason?: { year?: number; season?: string }): string {
  if (!startSeason?.season && !startSeason?.year) {
    return "—";
  }
  const season = startSeason?.season ? SEASON_FR[startSeason.season] ?? startSeason.season : "";
  return `${season} ${startSeason.year ?? ""}`.trim();
}

function malDurationLabel(averageEpisodeDuration?: number): string | null {
  if (!averageEpisodeDuration || averageEpisodeDuration <= 0) {
    return null;
  }
  const minutes = Math.round(averageEpisodeDuration / 60);
  return `${minutes} min par ep`;
}

function mapMALRelations(mal: MalAnimeDetail | null): ResolvedRelationGroup[] | null {
  if (!mal) {
    return null;
  }
  const grouped = new Map<string, JikanMalMini[]>();
  const pushRow = (row: MalAnimeRelationRow, type: "anime" | "manga") => {
    const id = row.node?.id;
    const title = row.node?.title;
    if (!id || !title) {
      return;
    }
    const relation = row.relation_type_formatted ?? "Other";
    const url =
      type === "anime"
        ? `https://myanimelist.net/anime/${id}`
        : `https://myanimelist.net/manga/${id}`;
    const current = grouped.get(relation) ?? [];
    current.push({
      mal_id: id,
      type,
      name: title,
      url,
    });
    grouped.set(relation, current);
  };
  mal.related_anime?.forEach((row) => pushRow(row, "anime"));
  mal.related_manga?.forEach((row) => pushRow(row, "manga"));
  if (grouped.size === 0) {
    return null;
  }
  return Array.from(grouped.entries()).map(([relation, entry]) => ({
    relation,
    entry,
  }));
}

/**
 * Résout les champs de fiche avec priorité MAL officiel puis fallback Jikan.
 */
export function buildAnimeDetailResolvedFields(
  jikan: JikanAnimeFull,
  malPayload: MalOfficialBundlePayload | null
): AnimeDetailResolvedFields {
  const mal = getMalAnimeDetail(malPayload);
  const jikanPoster =
    jikan.images.webp.large_image_url ||
    jikan.images.jpg.large_image_url ||
    jikan.images.jpg.image_url;
  const mappedRelations = mapMALRelations(mal);
  return {
    title: mal?.title || jikan.title,
    titleEnglish: mal?.alternative_titles?.en ?? jikan.title_english ?? null,
    titleJapanese: mal?.alternative_titles?.ja ?? jikan.title_japanese ?? null,
    titleAlternatives: mal?.alternative_titles?.synonyms ?? jikan.title_synonyms ?? [],
    synopsis: mal?.synopsis ?? jikan.synopsis ?? null,
    score: typeof mal?.mean === "number" ? mal.mean : jikan.score ?? null,
    status: mapMALStatus(mal?.status) || jikan.status,
    mediaType: mapMALMediaType(mal?.media_type) || jikan.type,
    source: mapMALSource(mal?.source ?? jikan.source),
    episodes:
      typeof mal?.num_episodes === "number" ? mal.num_episodes : jikan.episodes ?? null,
    duration: malDurationLabel(mal?.average_episode_duration) ?? jikan.duration ?? "—",
    rating: mapMALRating(mal?.rating) || jikan.rating,
    aired: malAiredLabel(mal?.start_date, mal?.end_date) || jikan.aired?.string || "—",
    seasonLabel: malSeasonLabel(mal?.start_season) || (jikan.season ? `${jikan.season} ${jikan.year ?? ""}`.trim() : "—"),
    posterUrl: mal?.main_picture?.large ?? mal?.main_picture?.medium ?? jikanPoster,
    relations: mappedRelations ?? jikan.relations,
  };
}

