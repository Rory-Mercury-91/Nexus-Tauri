import { jikanGet, type JikanGetFail } from "./jikanClient";

const MAX_RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BACKOFF_BASE_MS = 1400;

export type JikanLoaded<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; status?: number };

export type JikanMangaImageSet = {
  jpg: {
    image_url: string | null;
    small_image_url: string | null;
    large_image_url: string | null;
  };
  webp: {
    image_url: string | null;
    small_image_url: string | null;
    large_image_url: string | null;
  };
};

export type JikanMangaSearchItem = {
  mal_id: number;
  url: string;
  images: JikanMangaImageSet;
  title: string;
  type: string;
  status: string;
  chapters: number | null;
  volumes: number | null;
  score: number | null;
  published?: { from: string | null; to: string | null; string: string | null };
};

export type JikanMangaSearchResponse = {
  pagination: {
    last_visible_page: number;
    has_next_page: boolean;
  };
  data: JikanMangaSearchItem[];
};

export type JikanMangaFull = {
  mal_id: number;
  url: string;
  images: JikanMangaImageSet;
  title: string;
  title_english: string | null;
  title_japanese: string | null;
  title_synonyms: string[];
  type: string;
  status: string;
  score: number | null;
  scored_by: number | null;
  rank: number | null;
  popularity: number | null;
  members: number | null;
  favorites: number | null;
  synopsis: string | null;
  background: string | null;
  chapters: number | null;
  volumes: number | null;
  publishing: boolean;
  published: {
    from: string | null;
    to: string | null;
    string: string | null;
  };
  authors: Array<{ mal_id: number; type: string; name: string; url: string }>;
  serializations: Array<{ mal_id: number; type: string; name: string; url: string }>;
  genres: Array<{ mal_id: number; type: string; name: string; url: string }>;
  themes: Array<{ mal_id: number; type: string; name: string; url: string }>;
  demographics: Array<{ mal_id: number; type: string; name: string; url: string }>;
  relations: Array<{
    relation: string;
    entry: Array<{ mal_id: number; type: string; name: string; url: string }>;
  }>;
  external: Array<{ name: string; url: string }>;
};

export type JikanMangaByIdResponse = { data: JikanMangaFull };
export type JikanMangaFullResponse = { data: JikanMangaFull };
export type JikanMangaPicturesResponse = {
  data: Array<{
    jpg: {
      image_url: string | null;
      small_image_url: string | null;
      large_image_url: string | null;
    };
    webp?: {
      image_url: string | null;
      small_image_url: string | null;
      large_image_url: string | null;
    };
  }>;
};

function failFromJikan(r: JikanGetFail): JikanLoaded<never> {
  return { ok: false, message: r.message, status: r.status };
}

function mapOk<T>(r: Awaited<ReturnType<typeof jikanGet<T>>>): JikanLoaded<T> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function jikanGetWithRetry<T>(
  path: string
): Promise<Awaited<ReturnType<typeof jikanGet<T>>>> {
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    if (attempt > 0) {
      const backoffMs = RATE_LIMIT_BACKOFF_BASE_MS * 2 ** (attempt - 1);
      await sleep(backoffMs);
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

export async function searchReading(
  query: string,
  limit = 15
): Promise<JikanLoaded<JikanMangaSearchResponse>> {
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
  const r = await jikanGetWithRetry<JikanMangaSearchResponse>(`/manga?${params.toString()}`);
  return mapOk(r);
}

export async function getReadingByMalId(
  malId: number
): Promise<JikanLoaded<JikanMangaByIdResponse>> {
  if (!Number.isFinite(malId) || malId <= 0) {
    return { ok: false, message: "Identifiant MAL invalide." };
  }
  const r = await jikanGetWithRetry<JikanMangaByIdResponse>(`/manga/${malId}`);
  return mapOk(r);
}

export async function fetchReadingFull(
  malId: number
): Promise<JikanLoaded<JikanMangaFullResponse>> {
  if (!Number.isFinite(malId) || malId <= 0) {
    return { ok: false, message: "Identifiant MAL invalide." };
  }
  const r = await jikanGetWithRetry<JikanMangaFullResponse>(`/manga/${malId}/full`);
  return mapOk(r);
}

export async function fetchReadingPictures(
  malId: number
): Promise<JikanLoaded<JikanMangaPicturesResponse>> {
  if (!Number.isFinite(malId) || malId <= 0) {
    return { ok: false, message: "Identifiant MAL invalide." };
  }
  const r = await jikanGetWithRetry<JikanMangaPicturesResponse>(`/manga/${malId}/pictures`);
  return mapOk(r);
}
