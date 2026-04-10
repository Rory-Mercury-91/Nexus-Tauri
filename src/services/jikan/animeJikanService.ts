import { jikanDelay, jikanGet, type JikanGetFail } from "./jikanClient";
import type {
  JikanAnimeByIdResponse,
  JikanAnimeCharactersResponse,
  JikanAnimeEpisodesResponse,
  JikanAnimeFull,
  JikanAnimeFullResponse,
  JikanAnimeNewsResponse,
  JikanAnimePicturesResponse,
  JikanAnimeRecommendationsResponse,
  JikanAnimeReviewsResponse,
  JikanAnimeSearchResponse,
  JikanAnimeStaffResponse,
  JikanAnimeStatisticsResponse,
  JikanAnimeUserUpdatesResponse,
  JikanAnimeVideosResponse,
} from "./jikanTypes";

/** Délai minimal entre deux appels Jikan (évite les rafales). */
const BETWEEN_REQUEST_MS = 900;
/** Nombre max de tentatives supplémentaires en cas de 429. */
const MAX_RATE_LIMIT_RETRIES = 3;
/** Base d'attente exponentielle pour 429. */
const RATE_LIMIT_BACKOFF_BASE_MS = 1400;

export type JikanLoaded<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; status?: number };

function failFromJikan(r: JikanGetFail): JikanLoaded<never> {
  return { ok: false, message: r.message, status: r.status };
}

function mapOk<T>(
  r: Awaited<ReturnType<typeof jikanGet<T>>>
): JikanLoaded<T> {
  if (r.ok) {
    return { ok: true, data: r.data };
  }
  return failFromJikan(r);
}

function isRateLimitedFail(r: JikanGetFail): boolean {
  if (r.status === 429) {
    return true;
  }
  return /rate-limited/i.test(r.message);
}

/**
 * Requête Jikan robuste: temporisation + retry exponentiel sur 429.
 */
async function jikanGetWithRetry<T>(
  path: string
): Promise<Awaited<ReturnType<typeof jikanGet<T>>>> {
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    if (attempt > 0) {
      const backoffMs = RATE_LIMIT_BACKOFF_BASE_MS * 2 ** (attempt - 1);
      await jikanDelay(backoffMs);
    }
    const result = await jikanGet<T>(path);
    if (result.ok) {
      return result;
    }
    if (!isRateLimitedFail(result) || attempt === MAX_RATE_LIMIT_RETRIES) {
      return result;
    }
  }
  return {
    ok: false,
    status: 429,
    message: "Limite de débit Jikan atteinte.",
  };
}

/**
 * Recherche d’animés par titre (aperçu MAL via Jikan).
 */
export async function searchAnime(
  query: string,
  limit = 15
): Promise<JikanLoaded<JikanAnimeSearchResponse>> {
  const q = query.trim();
  if (!q) {
    return { ok: false, message: "Requête vide." };
  }
  const params = new URLSearchParams({
    q,
    limit: String(limit),
    order_by: "popularity",
    sort: "asc",
  });
  const r = await jikanGetWithRetry<JikanAnimeSearchResponse>(
    `/anime?${params.toString()}`
  );
  return mapOk(r);
}

/**
 * Fiche animé par identifiant MAL (GET /anime/{id}).
 */
export async function getAnimeByMalId(
  malId: number
): Promise<JikanLoaded<JikanAnimeByIdResponse>> {
  if (!Number.isFinite(malId) || malId <= 0) {
    return { ok: false, message: "Identifiant MAL invalide." };
  }
  const r = await jikanGetWithRetry<JikanAnimeByIdResponse>(`/anime/${malId}`);
  return mapOk(r);
}

/**
 * Fiche « full » : synopsis, relations, thèmes, liens externes, etc.
 */
export async function fetchAnimeFull(
  malId: number
): Promise<JikanLoaded<JikanAnimeFullResponse>> {
  if (!Number.isFinite(malId) || malId <= 0) {
    return { ok: false, message: "Identifiant MAL invalide." };
  }
  const r = await jikanGetWithRetry<JikanAnimeFullResponse>(`/anime/${malId}/full`);
  return mapOk(r);
}

export type AnimeJikanCompleteReport = {
  malId: number;
  fetchedAtIso: string;
  /** Toujours défini si le rapport est renvoyé (échec avant agrégation sinon). */
  full: JikanAnimeFull;
  characters: JikanLoaded<JikanAnimeCharactersResponse["data"]>;
  staff: JikanLoaded<JikanAnimeStaffResponse["data"]>;
  episodes: JikanLoaded<JikanAnimeEpisodesResponse>;
  news: JikanLoaded<JikanAnimeNewsResponse>;
  pictures: JikanLoaded<JikanAnimePicturesResponse>;
  videos: JikanLoaded<JikanAnimeVideosResponse>;
  statistics: JikanLoaded<JikanAnimeStatisticsResponse>;
  recommendations: JikanLoaded<JikanAnimeRecommendationsResponse>;
  reviews: JikanLoaded<JikanAnimeReviewsResponse>;
  userUpdates: JikanLoaded<JikanAnimeUserUpdatesResponse>;
};

/**
 * Agrège le maximum de données publiques Jikan pour un animé (équivalent des fiches publiques MAL).
 */
export async function fetchAnimeCompleteReport(
  malId: number
): Promise<
  | { ok: true; report: AnimeJikanCompleteReport }
  | { ok: false; error: string; status?: number }
> {
  if (!Number.isFinite(malId) || malId <= 0) {
    return { ok: false, error: "Identifiant MAL invalide." };
  }

  const fullRes = await jikanGetWithRetry<JikanAnimeFullResponse>(
    `/anime/${malId}/full`
  );
  if (!fullRes.ok) {
    return {
      ok: false,
      error: fullRes.message,
      status: fullRes.status,
    };
  }

  const fullData = fullRes.data.data;
  const base = `/anime/${malId}`;

  const request = async <T>(
    endpointPath: string
  ): Promise<Awaited<ReturnType<typeof jikanGet<T>>>> => {
    await jikanDelay(BETWEEN_REQUEST_MS);
    return jikanGetWithRetry<T>(endpointPath);
  };

  const charactersRes = await request<JikanAnimeCharactersResponse>(
    `${base}/characters`
  );
  const staffRes = await request<JikanAnimeStaffResponse>(`${base}/staff`);
  const episodesRes = await request<JikanAnimeEpisodesResponse>(
    `${base}/episodes?page=1`
  );
  const newsRes = await request<JikanAnimeNewsResponse>(`${base}/news`);
  const picturesRes = await request<JikanAnimePicturesResponse>(
    `${base}/pictures`
  );
  const videosRes = await request<JikanAnimeVideosResponse>(`${base}/videos`);
  const statisticsRes = await request<JikanAnimeStatisticsResponse>(
    `${base}/statistics`
  );
  const recommendationsRes = await request<JikanAnimeRecommendationsResponse>(
    `${base}/recommendations`
  );
  const reviewsRes = await request<JikanAnimeReviewsResponse>(
    `${base}/reviews?page=1`
  );
  const userUpdatesRes = await request<JikanAnimeUserUpdatesResponse>(
    `${base}/userupdates?page=1`
  );

  const unwrapList = <T>(
    r: Awaited<ReturnType<typeof jikanGetWithRetry<{ data: T }>>>
  ): JikanLoaded<T> => {
    const m = mapOk(r);
    if (!m.ok) {
      return m;
    }
    return { ok: true, data: m.data.data };
  };

  const report: AnimeJikanCompleteReport = {
    malId,
    fetchedAtIso: new Date().toISOString(),
    full: fullData,
    characters: unwrapList(charactersRes),
    staff: unwrapList(staffRes),
    episodes: mapOk(episodesRes),
    news: mapOk(newsRes),
    pictures: mapOk(picturesRes),
    videos: mapOk(videosRes),
    statistics: mapOk(statisticsRes),
    recommendations: mapOk(recommendationsRes),
    reviews: mapOk(reviewsRes),
    userUpdates: mapOk(userUpdatesRes),
  };

  return { ok: true, report };
}
