import {
  corsHeaders,
  jsonResponse,
  requireUserId,
} from "../_shared/integration-helpers.ts";
import {
  mapAnilistMediaListStatusToMalCodes,
  mapAnilistMediaListStatusToWatchCodes,
  mergeReadingProgressBySource,
  mergeWatchProgressBySource,
  resolveCanonicalReadStatus,
  resolveCanonicalWatchStatus,
} from "../_shared/reading-progress-resolve.ts";
import { createServiceSupabaseClient, nowIso, type SyncSource } from "../_shared/sync-helpers.ts";

type Body = {
  source?: SyncSource;
  media_type?: "anime" | "reading";
};

const MAL_API = "https://api.myanimelist.net/v2";
/** Aligné sur sync-worker (pagination MAL). */
const IMPORT_PAGE_SIZE = 25;
const MAX_MAL_PAGES = 80;

function normalizeComparable(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function fetchJson(url: string, init?: RequestInit) {
  const resp = await fetch(url, init);
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as unknown;
}

async function mapMalPage(accessToken: string, offset: number, limit = IMPORT_PAGE_SIZE) {
  const url = new URL(`${MAL_API}/users/@me/animelist`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("fields", "list_status,node{id,title,main_picture,alternative_titles}");
  url.searchParams.set("nsfw", "true");
  const json = (await fetchJson(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })) as { data?: Array<Record<string, unknown>>; paging?: { next?: string } };
  const rows = json.data ?? [];
  const hasNext = Boolean(json.paging?.next) && rows.length > 0;
  return { rows, hasNext };
}

async function mapMalReadingPage(accessToken: string, offset: number, limit = IMPORT_PAGE_SIZE) {
  const url = new URL(`${MAL_API}/users/@me/mangalist`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set(
    "fields",
    "list_status,node{id,title,main_picture,alternative_titles,media_type,status,num_chapters,num_volumes,genres,synopsis}"
  );
  url.searchParams.set("nsfw", "true");
  const json = (await fetchJson(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })) as { data?: Array<Record<string, unknown>>; paging?: { next?: string } };
  const rows = json.data ?? [];
  const hasNext = Boolean(json.paging?.next) && rows.length > 0;
  return { rows, hasNext };
}

async function mapAniListRows(accessToken: string) {
  const viewerJson = (await fetchJson("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query: "query { Viewer { id } }" }),
  })) as { data?: { Viewer?: { id?: number } } };
  const viewerId = Number(viewerJson.data?.Viewer?.id);
  if (!Number.isFinite(viewerId) || viewerId <= 0) {
    throw new Error("Impossible de récupérer le profil AniList connecté.");
  }
  const query = `
    query ($userId: Int) {
      MediaListCollection(type: ANIME, userId: $userId) {
        lists { entries { status progress media { idMal title { romaji english } coverImage { large medium } } } }
      }
    }
  `;
  const json = (await fetchJson("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query, variables: { userId: viewerId } }),
  })) as { data?: { MediaListCollection?: { lists?: Array<{ entries?: Array<Record<string, unknown>> }> } } };
  const lists = json.data?.MediaListCollection?.lists ?? [];
  return lists.flatMap((l) => l.entries ?? []);
}

async function mapAniListReadingRows(accessToken: string) {
  const viewerJson = (await fetchJson("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query: "query { Viewer { id } }" }),
  })) as { data?: { Viewer?: { id?: number } } };
  const viewerId = Number(viewerJson.data?.Viewer?.id);
  if (!Number.isFinite(viewerId) || viewerId <= 0) {
    throw new Error("Impossible de récupérer le profil AniList connecté.");
  }
  const query = `
    query ($userId: Int) {
      MediaListCollection(type: MANGA, userId: $userId) {
        lists { entries { status progress media { idMal title { romaji english } coverImage { large medium } chapters volumes } } }
      }
    }
  `;
  const json = (await fetchJson("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query, variables: { userId: viewerId } }),
  })) as { data?: { MediaListCollection?: { lists?: Array<{ entries?: Array<Record<string, unknown>> }> } } };
  const lists = json.data?.MediaListCollection?.lists ?? [];
  return lists.flatMap((l) => l.entries ?? []);
}

async function loadAllMalRows(accessToken: string, mediaType: "anime" | "reading") {
  const rows: Array<Record<string, unknown>> = [];
  let offset = 0;
  for (let page = 0; page < MAX_MAL_PAGES; page += 1) {
    const pageResult =
      mediaType === "reading"
        ? await mapMalReadingPage(accessToken, offset)
        : await mapMalPage(accessToken, offset);
    rows.push(...pageResult.rows);
    if (!pageResult.hasNext) {
      break;
    }
    offset += IMPORT_PAGE_SIZE;
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Méthode non autorisée." }, 405);
  }

  try {
    const userId = await requireUserId(req);
    const body = (await req.json().catch(() => ({}))) as Body;
    const source = body.source;
    const mediaType = body.media_type ?? "anime";
    if (
      (source !== "mal" && source !== "anilist") ||
      (mediaType !== "anime" && mediaType !== "reading")
    ) {
      return jsonResponse({ error: "Paramètres invalides." }, 400);
    }

    const admin = createServiceSupabaseClient();

    const { data: conn, error: connError } = await admin
      .from("oauth_connections")
      .select("access_token")
      .eq("user_id", userId)
      .eq("provider", source)
      .maybeSingle();
    if (connError) {
      return jsonResponse({ error: `Erreur vérification OAuth: ${connError.message}` }, 500);
    }
    if (!conn?.access_token) {
      return jsonResponse({ error: `Aucun compte ${source.toUpperCase()} connecté.` }, 400);
    }

    const remoteRows =
      source === "mal"
        ? await loadAllMalRows(conn.access_token, mediaType)
        : mediaType === "reading"
        ? await mapAniListReadingRows(conn.access_token)
        : await mapAniListRows(conn.access_token);

    const targetTable = mediaType === "reading" ? "library_reading" : "library_anime";
    const malIdCol = mediaType === "reading" ? "mal_manga_id" : "mal_id";
    const existingSelect =
      mediaType === "reading"
        ? "title, read_status, reading_progress_by_source"
        : "title, watch_status, watch_progress_by_source";

    const malIds: number[] = [];
    for (const row of remoteRows) {
      const node = source === "mal"
        ? (row.node as Record<string, unknown> | undefined)
        : (row.media as Record<string, unknown> | undefined);
      const malId = Number(source === "mal" ? node?.id : node?.idMal);
      if (Number.isFinite(malId) && malId > 0) {
        malIds.push(malId);
      }
    }
    const uniqueMalIds = [...new Set(malIds)];

    const { data: existingWithIds } = await admin
      .from(targetTable)
      .select(`${malIdCol}, ${existingSelect}`)
      .eq("user_id", userId)
      .in(malIdCol, uniqueMalIds.length > 0 ? uniqueMalIds : [-1]);

    const byMalId = new Map<number, Record<string, unknown>>();
    for (const row of existingWithIds ?? []) {
      const r = row as Record<string, unknown>;
      const id = Number(r[malIdCol]);
      if (Number.isFinite(id)) {
        byMalId.set(id, r);
      }
    }

    const ts = nowIso();
    const sourceKey = source === "mal" ? "mal" : "anilist";
    let statusDiffCount = 0;
    let titleDiffCount = 0;
    let newEntryCount = 0;

    for (const row of remoteRows) {
      const node = source === "mal"
        ? (row.node as Record<string, unknown> | undefined)
        : (row.media as Record<string, unknown> | undefined);
      const malId = Number(source === "mal" ? node?.id : node?.idMal);
      if (!Number.isFinite(malId) || malId <= 0) {
        continue;
      }
      const title = String(source === "mal" ? node?.title ?? "" : (node?.title as Record<string, unknown> | undefined)?.romaji ?? "");
      if (!title) {
        continue;
      }

      const malListStatusRaw = source === "mal"
        ? String((row.list_status as Record<string, unknown> | undefined)?.status ?? "")
        : "";
      const aniListStatusRaw = source === "anilist" ? String(row.status ?? "") : "";

      let incomingReadStatus: string | null = null;
      let incomingWatchStatus: string | null = null;
      if (mediaType === "reading") {
        if (source === "mal") {
          incomingReadStatus = malListStatusRaw || null;
        } else {
          incomingReadStatus = mapAnilistMediaListStatusToMalCodes(aniListStatusRaw);
        }
      } else if (source === "mal") {
        incomingWatchStatus = malListStatusRaw || null;
      } else {
        incomingWatchStatus = mapAnilistMediaListStatusToWatchCodes(aniListStatusRaw);
      }

      let incomingChaptersRead: number | null = null;
      let incomingEpisodesWatched: number | null = null;
      if (mediaType === "reading") {
        if (source === "mal") {
          const ls = row.list_status as Record<string, unknown> | undefined;
          const n = ls?.num_chapters_read;
          incomingChaptersRead =
            typeof n === "number" ? n : typeof n === "string" ? Number(n) : null;
          if (incomingChaptersRead != null && !Number.isFinite(incomingChaptersRead)) {
            incomingChaptersRead = null;
          }
        } else {
          const p = row.progress;
          incomingChaptersRead =
            typeof p === "number" ? p : typeof p === "string" ? Number(p) : null;
          if (incomingChaptersRead != null && !Number.isFinite(incomingChaptersRead)) {
            incomingChaptersRead = null;
          }
        }
      } else if (source === "mal") {
        const ls = row.list_status as Record<string, unknown> | undefined;
        const n = ls?.num_episodes_watched;
        incomingEpisodesWatched =
          typeof n === "number" ? n : typeof n === "string" ? Number(n) : null;
        if (incomingEpisodesWatched != null && !Number.isFinite(incomingEpisodesWatched)) {
          incomingEpisodesWatched = null;
        }
      } else {
        const p = row.progress;
        incomingEpisodesWatched =
          typeof p === "number" ? p : typeof p === "string" ? Number(p) : null;
        if (incomingEpisodesWatched != null && !Number.isFinite(incomingEpisodesWatched)) {
          incomingEpisodesWatched = null;
        }
      }

      const existing = byMalId.get(malId) ?? null;
      if (!existing) {
        newEntryCount += 1;
        titleDiffCount += 1;
        statusDiffCount += 1;
        continue;
      }

      const nextTitle = title.trim();
      const existingTitle = String(existing.title ?? "").trim();
      if (normalizeComparable(existingTitle) !== normalizeComparable(nextTitle)) {
        titleDiffCount += 1;
      }

      let nextReadingProgress: Record<string, unknown> =
        mediaType === "reading"
          ? ((existing.reading_progress_by_source as Record<string, unknown> | undefined) ?? {})
          : {};
      let nextWatchProgress: Record<string, unknown> =
        mediaType === "anime"
          ? ((existing.watch_progress_by_source as Record<string, unknown> | undefined) ?? {})
          : {};

      if (mediaType === "reading" && incomingReadStatus) {
        const patch: Record<string, unknown> = {
          read_status: incomingReadStatus,
          updated_at: ts,
        };
        if (incomingChaptersRead !== null) {
          patch.chapters_read = incomingChaptersRead;
        }
        nextReadingProgress = mergeReadingProgressBySource(nextReadingProgress, sourceKey, patch);
      }
      if (mediaType === "anime" && incomingWatchStatus) {
        const patch: Record<string, unknown> = {
          watch_status: incomingWatchStatus,
          updated_at: ts,
        };
        if (incomingEpisodesWatched !== null) {
          patch.episodes_watched = incomingEpisodesWatched;
        }
        nextWatchProgress = mergeWatchProgressBySource(nextWatchProgress, sourceKey, patch);
      }

      const canonicalNext =
        mediaType === "reading"
          ? resolveCanonicalReadStatus(nextReadingProgress)
          : resolveCanonicalWatchStatus(nextWatchProgress);
      const currentStatus =
        mediaType === "reading"
          ? String(existing.read_status ?? "").trim()
          : String(existing.watch_status ?? "").trim();
      const nextStr = canonicalNext != null ? String(canonicalNext).trim() : "";

      if (normalizeComparable(currentStatus) !== normalizeComparable(nextStr)) {
        statusDiffCount += 1;
      }
    }

    const labelSource = source === "mal" ? "MyAnimeList" : "AniList";
    const mediaLabel = mediaType === "reading" ? "lectures" : "animés";

    const fields: Array<{
      id: string;
      label: string;
      currentValue: string;
      incomingValue: string;
    }> = [];

    if (statusDiffCount > 0) {
      fields.push({
        id: "status",
        label: `Statut de progression (liste) — ${statusDiffCount} entrée(s)`,
        currentValue: `État actuel dans Nexus (canon après fusion).`,
        incomingValue: `Après sync ${labelSource} : le canon sera recalculé à partir des listes fusionnées (comme le worker d’import).`,
      });
    }
    if (titleDiffCount > 0) {
      fields.push({
        id: "title",
        label: `Titres et affiches — ${titleDiffCount} entrée(s)`,
        currentValue: `Titres / vignettes actuels en base.`,
        incomingValue: `Titres et images issus de la liste ${labelSource} (nouvelles entrées : ${newEntryCount}).`,
      });
    }

    return jsonResponse({
      ok: true,
      fields,
      meta: {
        remoteEntryCount: remoteRows.length,
        statusDiffCount,
        titleDiffCount,
        newEntryCount,
        mediaType,
        source,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return jsonResponse({ error: message }, 500);
  }
});
