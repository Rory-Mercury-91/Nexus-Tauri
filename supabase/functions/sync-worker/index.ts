import { corsHeaders, jsonResponse } from "../_shared/integration-helpers.ts";
import {
  mapAnilistMediaListStatusToMalCodes,
  mapAnilistMediaListStatusToWatchCodes,
  mergeReadingProgressBySource,
  mergeWatchProgressBySource,
  resolveCanonicalReadStatus,
  resolveCanonicalWatchStatus,
} from "../_shared/reading-progress-resolve.ts";
import { createServiceSupabaseClient, nowIso, type SyncSource } from "../_shared/sync-helpers.ts";

type JobRow = {
  id: number;
  run_id: string;
  user_id: string;
  stage: "import" | "enrich" | "translate";
  attempts: number;
  payload: Record<string, unknown>;
};

function getSelectedFieldIds(payload: Record<string, unknown>): string[] {
  const raw = payload.selected_field_ids;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function canUpdateField(selectedFieldIds: string[], fieldId: string): boolean {
  if (selectedFieldIds.length === 0) {
    return true;
  }
  return selectedFieldIds.includes(fieldId);
}

function mergeJikanFullBySelection(
  mediaType: "anime" | "reading",
  previousFull: Record<string, unknown>,
  nextFull: Record<string, unknown>,
  selectedFieldIds: string[]
): Record<string, unknown> {
  if (selectedFieldIds.length === 0) {
    return nextFull;
  }
  const merged = { ...previousFull, ...nextFull };
  if (!canUpdateField(selectedFieldIds, "title")) {
    merged.title = previousFull.title;
    merged.title_english = previousFull.title_english;
    merged.title_japanese = previousFull.title_japanese;
    merged.title_synonyms = previousFull.title_synonyms;
  }
  if (!canUpdateField(selectedFieldIds, "status")) {
    merged.status = previousFull.status;
  }
  if (!canUpdateField(selectedFieldIds, "score")) {
    merged.score = previousFull.score;
    merged.scored_by = previousFull.scored_by;
    merged.rank = previousFull.rank;
    merged.popularity = previousFull.popularity;
    merged.members = previousFull.members;
    merged.favorites = previousFull.favorites;
  }
  if (!canUpdateField(selectedFieldIds, "synopsis")) {
    merged.synopsis = previousFull.synopsis;
    merged.background = previousFull.background;
  }
  if (mediaType === "anime" && !canUpdateField(selectedFieldIds, "episodes")) {
    merged.episodes = previousFull.episodes;
  }
  if (mediaType === "reading") {
    if (!canUpdateField(selectedFieldIds, "chapters")) {
      merged.chapters = previousFull.chapters;
    }
    if (!canUpdateField(selectedFieldIds, "volumes")) {
      merged.volumes = previousFull.volumes;
    }
  }
  return merged;
}

const JIKAN_API = "https://api.jikan.moe/v4";
const MAL_API = "https://api.myanimelist.net/v2";
const MAX_RETRIES = 3;
const MAX_JOBS_PER_TICK = 25;
/** Jobs « running » sans mise à jour (crash / timeout Edge) → repasse en retry après ce délai. */
const RUNNING_STALE_MS = 3 * 60 * 1000;
/** Lots courts : un job d’import doit finir sous la limite Edge (~150s) ; 100 lignes × plusieurs allers-retours DB dépassaient souvent. */
const IMPORT_PAGE_SIZE = 25;
const IMPORT_ANILIST_CHUNK_SIZE = 25;
const MAX_EPISODE_PAGES = 40;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RUN_CANCELLED_MSG = "RUN_CANCELLED";

async function isRunCancelled(runId: string): Promise<boolean> {
  const admin = createServiceSupabaseClient();
  const { data: run } = await admin.from("sync_runs").select("status").eq("id", runId).maybeSingle();
  return String(run?.status ?? "") === "cancelled";
}

async function fetchJson(url: string, init?: RequestInit) {
  const resp = await fetch(url, init);
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as unknown;
}

async function upsertProgress(
  runId: string,
  userId: string,
  stage: "import" | "enrich" | "translate",
  patch: Partial<{
    total: number;
    processed: number;
    created_count: number;
    updated_count: number;
    error_count: number;
    current_item_label: string | null;
  }>
) {
  const admin = createServiceSupabaseClient();
  const { data: current } = await admin
    .from("sync_progress")
    .select("*")
    .eq("run_id", runId)
    .eq("stage", stage)
    .maybeSingle();
  await admin.from("sync_progress").upsert(
    {
      run_id: runId,
      user_id: userId,
      stage,
      total: patch.total ?? current?.total ?? 0,
      processed: patch.processed ?? current?.processed ?? 0,
      created_count: patch.created_count ?? current?.created_count ?? 0,
      updated_count: patch.updated_count ?? current?.updated_count ?? 0,
      error_count: patch.error_count ?? current?.error_count ?? 0,
      current_item_label: patch.current_item_label ?? current?.current_item_label ?? null,
      updated_at: nowIso(),
    },
    { onConflict: "run_id,stage" }
  );
}

async function getStageJobTotal(
  runId: string,
  stage: "import" | "enrich" | "translate"
): Promise<number> {
  const admin = createServiceSupabaseClient();
  const { count } = await admin
    .from("sync_jobs")
    .select("*", { head: true, count: "exact" })
    .eq("run_id", runId)
    .eq("stage", stage);
  return count ?? 0;
}

async function syncStageProgressFromJobs(
  runId: string,
  userId: string,
  stage: "enrich" | "translate",
  currentItemLabel?: string
) {
  const admin = createServiceSupabaseClient();
  const { data: jobs } = await admin
    .from("sync_jobs")
    .select("status")
    .eq("run_id", runId)
    .eq("stage", stage);
  const total = jobs?.length ?? 0;
  const done = (jobs ?? []).filter((job) => job.status === "done").length;
  const failed = (jobs ?? []).filter((job) => job.status === "failed").length;
  await upsertProgress(runId, userId, stage, {
    total,
    processed: done + failed,
    updated_count: done,
    error_count: failed,
    current_item_label: currentItemLabel ?? null,
  });
}

async function claimNextJob(): Promise<JobRow | null> {
  const admin = createServiceSupabaseClient();
  const staleIso = new Date(Date.now() - RUNNING_STALE_MS).toISOString();
  const { data: staleRunning } = await admin
    .from("sync_jobs")
    .select("id, attempts")
    .eq("status", "running")
    .lt("updated_at", staleIso)
    .limit(20);
  for (const stale of staleRunning ?? []) {
    const attempts = Number(stale.attempts ?? 0) + 1;
    const nextStatus = attempts >= MAX_RETRIES ? "failed" : "retry";
    await admin
      .from("sync_jobs")
      .update({
        status: nextStatus,
        attempts,
        started_at: null,
        finished_at: nextStatus === "failed" ? nowIso() : null,
        available_at: nowIso(),
        last_error: "Reprise auto: job running expiré.",
        updated_at: nowIso(),
      })
      .eq("id", stale.id)
      .eq("status", "running");
  }

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const { data: candidate } = await admin
      .from("sync_jobs")
      .select("id, run_id, user_id, stage, attempts, payload, status, available_at")
      .in("status", ["queued", "retry"])
      .lte("available_at", nowIso())
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!candidate) {
      return null;
    }
    const { data: run } = await admin.from("sync_runs").select("status").eq("id", candidate.run_id).maybeSingle();
    if (!run) {
      await admin
        .from("sync_jobs")
        .update({
          status: "failed",
          finished_at: nowIso(),
          last_error: "Run introuvable.",
          updated_at: nowIso(),
        })
        .eq("id", candidate.id);
      continue;
    }
    if (run.status === "cancelled") {
      await admin
        .from("sync_jobs")
        .update({
          status: "cancelled",
          finished_at: nowIso(),
          last_error: "Run annulé.",
          updated_at: nowIso(),
        })
        .eq("id", candidate.id);
      continue;
    }
    const { data: locked } = await admin
      .from("sync_jobs")
      .update({
        status: "running",
        started_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("id", candidate.id)
      .in("status", ["queued", "retry"])
      .select("id, run_id, user_id, stage, attempts, payload")
      .maybeSingle();
    if (!locked) {
      continue;
    }
    return locked as JobRow;
  }
  return null;
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

type JikanEnrichPayload = {
  full: Record<string, unknown>;
  pictures: Array<Record<string, unknown>>;
  episodes: Array<Record<string, unknown>>;
};

async function fetchJikanEnrichPayload(
  malId: number,
  onHeartbeat?: () => Promise<void>
): Promise<JikanEnrichPayload> {
  await sleep(900);
  const fullJson = (await fetchJson(`${JIKAN_API}/anime/${malId}/full`)) as { data?: Record<string, unknown> };

  await sleep(900);
  const picturesJson = (await fetchJson(`${JIKAN_API}/anime/${malId}/pictures`)) as { data?: Array<Record<string, unknown>> };
  const pictures = Array.isArray(picturesJson.data) ? picturesJson.data : [];

  const episodes: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= MAX_EPISODE_PAGES; page += 1) {
    await sleep(900);
    const episodesJson = (await fetchJson(`${JIKAN_API}/anime/${malId}/episodes?page=${page}`)) as {
      data?: Array<Record<string, unknown>>;
      pagination?: { has_next_page?: boolean };
    };
    const chunk = Array.isArray(episodesJson.data) ? episodesJson.data : [];
    episodes.push(...chunk);
    if (!episodesJson.pagination?.has_next_page || chunk.length === 0) {
      break;
    }
    if (onHeartbeat && page % 3 === 0) {
      await onHeartbeat().catch(() => undefined);
    }
  }

  return {
    full: fullJson.data ?? {},
    pictures,
    episodes,
  };
}

async function fetchJikanReadingEnrichPayload(
  malId: number,
  onHeartbeat?: () => Promise<void>
): Promise<Record<string, unknown>> {
  await sleep(900);
  await onHeartbeat?.().catch(() => undefined);
  const fullJson = (await fetchJson(`${JIKAN_API}/manga/${malId}/full`)) as { data?: Record<string, unknown> };
  return { full: fullJson.data ?? {} };
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

async function enqueue(runId: string, userId: string, stage: "enrich" | "translate", payload: Record<string, unknown>) {
  const admin = createServiceSupabaseClient();
  await admin.from("sync_jobs").insert({
    run_id: runId,
    user_id: userId,
    stage,
    status: "queued",
    attempts: 0,
    payload,
    available_at: nowIso(),
  });
}

async function processImport(job: JobRow) {
  const source = String(job.payload.source ?? "mal") as SyncSource;
  const mediaType = String(job.payload.media_type ?? "anime") as "anime" | "reading";
  const selectedFieldIds = getSelectedFieldIds(job.payload);
  const rawTarget = job.payload.target_mal_id;
  const targetMalId = Number(rawTarget);
  const hasTarget = Number.isFinite(targetMalId) && targetMalId > 0;
  const admin = createServiceSupabaseClient();
  const { data: conn, error: connError } = await admin
    .from("oauth_connections")
    .select("access_token")
    .eq("user_id", job.user_id)
    .eq("provider", source)
    .maybeSingle();
  if (connError || !conn?.access_token) {
    throw new Error(`Connexion ${source} manquante.`);
  }
  const { data: currentImportProgress } = await admin
    .from("sync_progress")
    .select("total, processed, created_count, updated_count, error_count")
    .eq("run_id", job.run_id)
    .eq("stage", "import")
    .maybeSingle();
  let processed = currentImportProgress?.processed ?? 0;
  let created = currentImportProgress?.created_count ?? 0;
  let updated = currentImportProgress?.updated_count ?? 0;

  let rows: Array<Record<string, unknown>> = [];
  let hasNextImportBatch = false;
  let nextPayload: Record<string, unknown> | null = null;
  let batchTotalHint = 0;
  if (source === "mal") {
    const offset = Number(job.payload.offset ?? 0);
    const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
    const page =
      mediaType === "reading"
        ? await mapMalReadingPage(conn.access_token, safeOffset)
        : await mapMalPage(conn.access_token, safeOffset);
    rows = page.rows;
    hasNextImportBatch = page.hasNext;
    // Hint progressif sans sur-gonfler le total: offset parcouru + taille page (+1 si page suivante).
    batchTotalHint = safeOffset + rows.length + (hasNextImportBatch ? 1 : 0);
    if (hasNextImportBatch) {
      nextPayload = {
        source,
        media_type: mediaType,
        offset: safeOffset + IMPORT_PAGE_SIZE,
        selected_field_ids: selectedFieldIds,
        ...(hasTarget ? { target_mal_id: targetMalId } : {}),
      };
    }
  } else {
    const startIndex = Number(job.payload.start_index ?? 0);
    const allRows =
      mediaType === "reading"
        ? await mapAniListReadingRows(conn.access_token)
        : await mapAniListRows(conn.access_token);
    const safeStart = Number.isFinite(startIndex) ? Math.max(0, startIndex) : 0;
    if (hasTarget) {
      const hit = allRows.find((row) => {
        const node = row.media as Record<string, unknown> | undefined;
        const mid = Number(node?.idMal);
        return Number.isFinite(mid) && mid === targetMalId;
      });
      if (hit) {
        rows = [hit];
        hasNextImportBatch = false;
        nextPayload = null;
      } else {
        rows = [];
        hasNextImportBatch = false;
        nextPayload = null;
      }
      batchTotalHint = allRows.length;
    } else {
      rows = allRows.slice(safeStart, safeStart + IMPORT_ANILIST_CHUNK_SIZE);
      hasNextImportBatch = safeStart + IMPORT_ANILIST_CHUNK_SIZE < allRows.length;
      batchTotalHint = allRows.length;
      if (hasNextImportBatch) {
        nextPayload = {
          source,
          media_type: mediaType,
          start_index: safeStart + IMPORT_ANILIST_CHUNK_SIZE,
          selected_field_ids: selectedFieldIds,
        };
      }
    }
  }
  const importTotal = Math.max(currentImportProgress?.total ?? 0, batchTotalHint, processed);
  await upsertProgress(job.run_id, job.user_id, "import", {
    total: importTotal,
    processed,
    created_count: created,
    updated_count: updated,
    error_count: currentImportProgress?.error_count ?? 0,
    current_item_label: null,
  });

  let targetMatched = false;
  /** Enrich/traduction en fin de lot : le job « import » suivant doit être inséré avant (id plus petit) pour finir toute la liste avant Jikan. */
  const deferredEnrich: Array<{ mal_id: number; title: string; media_type: "anime" | "reading" }> = [];
  const deferredTranslate: Array<{ mal_id: number; title: string; media_type: "anime" | "reading" }> = [];
  for (const row of rows) {
    if (await isRunCancelled(job.run_id)) {
      throw new Error(RUN_CANCELLED_MSG);
    }
    const node = source === "mal" ? (row.node as Record<string, unknown> | undefined) : (row.media as Record<string, unknown> | undefined);
    const malId = Number(source === "mal" ? node?.id : node?.idMal);
    if (!Number.isFinite(malId) || malId <= 0) {
      continue;
    }
    if (hasTarget && malId !== targetMalId) {
      continue;
    }
    if (hasTarget) {
      targetMatched = true;
    }
    const title = String(source === "mal" ? node?.title ?? "" : (node?.title as Record<string, unknown> | undefined)?.romaji ?? "");
    if (!title) {
      continue;
    }
    const titleEnglish = source === "mal"
      ? ((node?.alternative_titles as Record<string, unknown> | undefined)?.en as string | undefined) ?? null
      : ((node?.title as Record<string, unknown> | undefined)?.english as string | undefined) ?? null;
    const picture = source === "mal"
      ? ((node?.main_picture as Record<string, unknown> | undefined)?.medium as string | undefined) ?? null
      : ((node?.coverImage as Record<string, unknown> | undefined)?.large as string | undefined) ?? null;
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

    const targetTable = mediaType === "reading" ? "library_reading" : "library_anime";
    const malIdCol = mediaType === "reading" ? "mal_manga_id" : "mal_id";
    const statusCol = mediaType === "reading" ? "read_status" : "watch_status";

    const existingSelect =
      mediaType === "reading"
        ? "id, title, title_english, main_picture_url, read_status, mal_official_snapshot, reading_progress_by_source"
        : "id, title, title_english, main_picture_url, watch_status, mal_official_snapshot, watch_progress_by_source";
    const { data: existing } = await admin
      .from(targetTable)
      .select(existingSelect)
      .eq("user_id", job.user_id)
      .eq(malIdCol, malId)
      .maybeSingle();

    const { data: cachedByMal } = await admin
      .from(targetTable)
      .select("jikan_snapshot, jikan_snapshot_at, main_picture_url")
      .eq(malIdCol, malId)
      .not("jikan_snapshot", "is", null)
      .order("jikan_snapshot_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const cachedJikanSnapshot = (cachedByMal?.jikan_snapshot ?? null) as Record<string, unknown> | null;

    const existingSnapshot = (existing?.mal_official_snapshot ?? {}) as Record<string, unknown>;
    const incomingSnapshot = { source, list_entry: row } as Record<string, unknown>;
    const mergedSnapshot = selectedFieldIds.length === 0
      ? incomingSnapshot
      : {
          ...existingSnapshot,
          source,
          list_entry: row,
        };
    const nextTitle = canUpdateField(selectedFieldIds, "title")
      ? title
      : String(existing?.title ?? title);
    const nextTitleEnglish = canUpdateField(selectedFieldIds, "title")
      ? titleEnglish
      : ((existing?.title_english as string | null | undefined) ?? titleEnglish);
    const nextPicture = canUpdateField(selectedFieldIds, "title")
      ? (picture || cachedByMal?.main_picture_url || null)
      : ((existing?.main_picture_url as string | null | undefined) ?? picture ?? cachedByMal?.main_picture_url ?? null);

    const sourceKey = source === "mal" ? "mal" : "anilist";
    const ts = nowIso();

    let nextReadingProgress: Record<string, unknown> =
      mediaType === "reading"
        ? ((existing as { reading_progress_by_source?: unknown } | null)?.reading_progress_by_source as Record<
            string,
            unknown
          >) ?? {}
        : {};
    let nextWatchProgress: Record<string, unknown> =
      mediaType === "anime"
        ? ((existing as { watch_progress_by_source?: unknown } | null)?.watch_progress_by_source as Record<
            string,
            unknown
          >) ?? {}
        : {};

    if (mediaType === "reading" && canUpdateField(selectedFieldIds, "status") && incomingReadStatus) {
      const patch: Record<string, unknown> = {
        read_status: incomingReadStatus,
        updated_at: ts,
      };
      if (incomingChaptersRead !== null) {
        patch.chapters_read = incomingChaptersRead;
      }
      nextReadingProgress = mergeReadingProgressBySource(nextReadingProgress, sourceKey, patch);
    }
    if (mediaType === "anime" && canUpdateField(selectedFieldIds, "status") && incomingWatchStatus) {
      const patch: Record<string, unknown> = {
        watch_status: incomingWatchStatus,
        updated_at: ts,
      };
      if (incomingEpisodesWatched !== null) {
        patch.episodes_watched = incomingEpisodesWatched;
      }
      nextWatchProgress = mergeWatchProgressBySource(nextWatchProgress, sourceKey, patch);
    }

    const canonicalRead = resolveCanonicalReadStatus(nextReadingProgress);
    const canonicalWatch = resolveCanonicalWatchStatus(nextWatchProgress);

    const nextStatus = canUpdateField(selectedFieldIds, "status")
      ? (mediaType === "reading"
        ? (canonicalRead ?? (existing?.read_status as string | null | undefined) ?? null)
        : (canonicalWatch ?? (existing?.watch_status as string | null | undefined) ?? null))
      : mediaType === "reading"
      ? ((existing?.read_status as string | null | undefined) ?? null)
      : ((existing?.watch_status as string | null | undefined) ?? null);

    const upsertPayload: Record<string, unknown> = {
      user_id: job.user_id,
      [malIdCol]: malId,
      title: nextTitle,
      title_english: nextTitleEnglish,
      main_picture_url: nextPicture,
      [statusCol]: nextStatus,
      jikan_snapshot: cachedJikanSnapshot ?? {},
      jikan_snapshot_at: cachedByMal?.jikan_snapshot_at ?? null,
      mal_official_snapshot: mergedSnapshot,
      mal_official_snapshot_at: nowIso(),
    };
    if (mediaType === "reading") {
      upsertPayload.reading_progress_by_source = nextReadingProgress;
    } else {
      upsertPayload.watch_progress_by_source = nextWatchProgress;
    }

    await admin.from(targetTable).upsert(upsertPayload, {
      onConflict: mediaType === "reading" ? "user_id,mal_manga_id" : "user_id,mal_id",
    });
    processed += 1;
    if (existing) {
      updated += 1;
    } else {
      created += 1;
    }
    const enrichMeta = (cachedJikanSnapshot?.enrich_meta ?? {}) as Record<string, unknown>;
    const hasFull = Boolean(
      cachedJikanSnapshot &&
      typeof cachedJikanSnapshot === "object" &&
      cachedJikanSnapshot.full &&
      typeof cachedJikanSnapshot.full === "object"
    );
    const hasPicturesFetched =
      enrichMeta.pictures_fetched === true ||
      Array.isArray(cachedJikanSnapshot?.pictures);
    const hasEpisodesFetched =
      enrichMeta.episodes_fetched === true ||
      Array.isArray(cachedJikanSnapshot?.episodes);
    const hasTranslatedSynopsis = Boolean(
      cachedJikanSnapshot &&
      typeof cachedJikanSnapshot.synopsis_fr_auto === "string" &&
      cachedJikanSnapshot.synopsis_fr_auto.trim().length > 0
    );
    const needsAnimeEnrich = !hasFull || !hasPicturesFetched || !hasEpisodesFetched;
    const needsReadingEnrich = !hasFull;
    if ((mediaType === "anime" && needsAnimeEnrich) || (mediaType === "reading" && needsReadingEnrich)) {
      deferredEnrich.push({ mal_id: malId, title, media_type: mediaType });
    } else if (!hasTranslatedSynopsis) {
      deferredTranslate.push({ mal_id: malId, title, media_type: mediaType });
    }
    await upsertProgress(job.run_id, job.user_id, "import", {
      total: importTotal,
      processed,
      created_count: created,
      updated_count: updated,
      current_item_label: title,
    });
    if (processed % 5 === 0) {
      await admin
        .from("sync_jobs")
        .update({ updated_at: nowIso() })
        .eq("id", job.id)
        .eq("status", "running");
    }
  }
  if (hasTarget && targetMatched) {
    hasNextImportBatch = false;
    nextPayload = null;
  }
  if (await isRunCancelled(job.run_id)) {
    throw new Error(RUN_CANCELLED_MSG);
  }
  if (nextPayload) {
    await admin.from("sync_jobs").insert({
      run_id: job.run_id,
      user_id: job.user_id,
      stage: "import",
      status: "queued",
      attempts: 0,
      payload: nextPayload,
      available_at: nowIso(),
    });
  }
  for (const p of deferredEnrich) {
    await enqueue(job.run_id, job.user_id, "enrich", {
      mal_id: p.mal_id,
      title: p.title,
      media_type: p.media_type,
      selected_field_ids: selectedFieldIds,
    });
  }
  for (const p of deferredTranslate) {
    await enqueue(job.run_id, job.user_id, "translate", {
      mal_id: p.mal_id,
      title: p.title,
      media_type: p.media_type,
      selected_field_ids: selectedFieldIds,
    });
  }
  await upsertProgress(job.run_id, job.user_id, "enrich", {
    total: await getStageJobTotal(job.run_id, "enrich"),
  });
  await upsertProgress(job.run_id, job.user_id, "translate", {
    total: await getStageJobTotal(job.run_id, "translate"),
  });
  if (!hasNextImportBatch) {
    const { data: finalImportProgress } = await admin
      .from("sync_progress")
      .select("processed")
      .eq("run_id", job.run_id)
      .eq("stage", "import")
      .maybeSingle();
    await upsertProgress(job.run_id, job.user_id, "import", {
      total: finalImportProgress?.processed ?? processed,
    });
  }
}

async function processEnrich(job: JobRow) {
  const malId = Number(job.payload.mal_id);
  const mediaType = String(job.payload.media_type ?? "anime") as "anime" | "reading";
  const selectedFieldIds = getSelectedFieldIds(job.payload);
  if (!Number.isFinite(malId) || malId <= 0) {
    throw new Error("mal_id enrich invalide.");
  }
  const admin = createServiceSupabaseClient();
  const targetTable = mediaType === "reading" ? "library_reading" : "library_anime";
  const malIdCol = mediaType === "reading" ? "mal_manga_id" : "mal_id";
  const { data: anime } = await admin
    .from(targetTable)
    .select("id, title, jikan_snapshot")
    .eq("user_id", job.user_id)
    .eq(malIdCol, malId)
    .maybeSingle();
  if (!anime) {
    throw new Error("Entrée introuvable.");
  }
  if (await isRunCancelled(job.run_id)) {
    throw new Error(RUN_CANCELLED_MSG);
  }
  const titleLabel = String(anime.title ?? job.payload.title ?? "");
  const heartbeat = async () => {
    if (await isRunCancelled(job.run_id)) {
      throw new Error(RUN_CANCELLED_MSG);
    }
    await admin
      .from("sync_jobs")
      .update({ updated_at: nowIso() })
      .eq("id", job.id)
      .eq("status", "running");
    await upsertProgress(job.run_id, job.user_id, "enrich", {
      current_item_label: titleLabel,
    });
  };
  await heartbeat();
  const payload = mediaType === "reading"
    ? await fetchJikanReadingEnrichPayload(malId, heartbeat)
    : await fetchJikanEnrichPayload(malId, heartbeat);
  const previousSnapshot = (anime.jikan_snapshot ?? {}) as Record<string, unknown>;
  const previousEnrichMeta = (previousSnapshot.enrich_meta ?? {}) as Record<string, unknown>;
  const previousFull = (previousSnapshot.full ?? {}) as Record<string, unknown>;
  const nextFullRaw =
    mediaType === "reading"
      ? ((payload as { full?: Record<string, unknown> }).full ?? {})
      : ((payload as JikanEnrichPayload).full ?? {});
  const nextFull = mergeJikanFullBySelection(mediaType, previousFull, nextFullRaw, selectedFieldIds);
  const enrichPatch =
    mediaType === "reading"
      ? {
          full: nextFull,
          enrich_meta: {
            ...previousEnrichMeta,
            full_fetched: true,
            enriched_at: nowIso(),
          },
        }
      : {
          full: nextFull,
          pictures: (payload as JikanEnrichPayload).pictures,
          episodes: (payload as JikanEnrichPayload).episodes,
          enrich_meta: {
            ...previousEnrichMeta,
            full_fetched: true,
            pictures_fetched: true,
            episodes_fetched: true,
            enriched_at: nowIso(),
          },
        };
  await admin
    .from(targetTable)
    .update({
      jikan_snapshot: {
        ...previousSnapshot,
        ...enrichPatch,
        updated_at: nowIso(),
      },
      jikan_snapshot_at: nowIso(),
    })
    .eq("id", anime.id);
  await enqueue(job.run_id, job.user_id, "translate", {
    mal_id: malId,
    title: anime.title,
    media_type: mediaType,
    selected_field_ids: selectedFieldIds,
  });
  await syncStageProgressFromJobs(job.run_id, job.user_id, "translate", anime.title);
}

async function processTranslate(job: JobRow) {
  const malId = Number(job.payload.mal_id);
  const mediaType = String(job.payload.media_type ?? "anime") as "anime" | "reading";
  const selectedFieldIds = getSelectedFieldIds(job.payload);
  if (!Number.isFinite(malId) || malId <= 0) {
    throw new Error("mal_id translate invalide.");
  }
  const admin = createServiceSupabaseClient();
  const targetTable = mediaType === "reading" ? "library_reading" : "library_anime";
  const malIdCol = mediaType === "reading" ? "mal_manga_id" : "mal_id";
  const { data: anime } = await admin
    .from(targetTable)
    .select("id, title, jikan_snapshot, mal_official_snapshot")
    .eq("user_id", job.user_id)
    .eq(malIdCol, malId)
    .maybeSingle();
  if (!anime) {
    throw new Error("Entrée introuvable.");
  }
  if (await isRunCancelled(job.run_id)) {
    throw new Error(RUN_CANCELLED_MSG);
  }
  const sourceSynopsis =
    String((anime.mal_official_snapshot as Record<string, unknown> | undefined)?.synopsis ?? "") ||
    String(((anime.jikan_snapshot as Record<string, unknown> | undefined)?.full as Record<string, unknown> | undefined)?.synopsis ?? "");
  if (sourceSynopsis && canUpdateField(selectedFieldIds, "synopsis")) {
    await sleep(500);
    const endpoint = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=fr&dt=t&q=${encodeURIComponent(sourceSynopsis)}`;
    const data = (await fetchJson(endpoint)) as unknown[];
    const translated = (Array.isArray(data[0]) ? (data[0] as unknown[]) : [])
      .map((chunk) => (Array.isArray(chunk) ? String(chunk[0] ?? "") : ""))
      .join("");
    await admin
      .from(targetTable)
      .update({
        jikan_snapshot: {
          ...(anime.jikan_snapshot as Record<string, unknown> ?? {}),
          synopsis_fr_auto: translated,
          synopsis_fr_auto_at: nowIso(),
        },
        jikan_snapshot_at: nowIso(),
      })
      .eq("id", anime.id);
  }

}

async function ensureTranslateTotal(runId: string, userId: string) {
  const admin = createServiceSupabaseClient();
  const { count } = await admin
    .from("sync_jobs")
    .select("*", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("stage", "translate");
  await upsertProgress(runId, userId, "translate", { total: count ?? 0, processed: 0, updated_count: 0, error_count: 0 });
}

async function completeOrFailRun(runId: string) {
  const admin = createServiceSupabaseClient();
  const { data: run } = await admin.from("sync_runs").select("status").eq("id", runId).maybeSingle();
  if (String(run?.status ?? "") === "cancelled") {
    return;
  }
  const { data: jobs } = await admin.from("sync_jobs").select("status").eq("run_id", runId);
  const statuses = (jobs ?? []).map((j) => String(j.status));
  if (statuses.some((s) => s === "queued" || s === "running" || s === "retry")) {
    return;
  }
  const failed = statuses.some((s) => s === "failed");
  await admin
    .from("sync_runs")
    .update({
      status: failed ? "failed" : "completed",
      finished_at: nowIso(),
    })
    .eq("id", runId)
    .in("status", ["queued", "running"]);
}

async function failOrRetryJob(job: JobRow, message: string): Promise<"failed" | "retry"> {
  const admin = createServiceSupabaseClient();
  const attempts = job.attempts + 1;
  const nextStatus: "failed" | "retry" = attempts >= MAX_RETRIES ? "failed" : "retry";
  await admin
    .from("sync_jobs")
    .update({
      status: nextStatus,
      attempts,
      last_error: message.slice(0, 1000),
      available_at: new Date(Date.now() + 5000 * attempts).toISOString(),
      finished_at: nextStatus === "failed" ? nowIso() : null,
      updated_at: nowIso(),
    })
    .eq("id", job.id);
  return nextStatus;
}

async function processJob(job: JobRow) {
  const admin = createServiceSupabaseClient();
  if (await isRunCancelled(job.run_id)) {
    await admin
      .from("sync_jobs")
      .update({
        status: "cancelled",
        finished_at: nowIso(),
        last_error: "Run annulé.",
        updated_at: nowIso(),
      })
      .eq("id", job.id);
    return;
  }
  const { data: runPatch } = await admin
    .from("sync_runs")
    .update({
      status: "running",
      current_stage: job.stage,
      started_at: nowIso(),
    })
    .eq("id", job.run_id)
    .in("status", ["queued", "running"])
    .select("id")
    .maybeSingle();
  if (!runPatch) {
    await admin
      .from("sync_jobs")
      .update({
        status: "cancelled",
        finished_at: nowIso(),
        last_error: "Run annulé ou terminé.",
        updated_at: nowIso(),
      })
      .eq("id", job.id);
    return;
  }

  try {
    if (job.stage === "import") {
      await processImport(job);
      await ensureTranslateTotal(job.run_id, job.user_id);
    } else if (job.stage === "enrich") {
      await processEnrich(job);
    } else {
      await processTranslate(job);
    }
    await admin
      .from("sync_jobs")
      .update({ status: "done", finished_at: nowIso(), updated_at: nowIso() })
      .eq("id", job.id);
    if (job.stage === "enrich" || job.stage === "translate") {
      await syncStageProgressFromJobs(
        job.run_id,
        job.user_id,
        job.stage,
        String(job.payload.title ?? job.payload.mal_id ?? "")
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === RUN_CANCELLED_MSG) {
      await admin
        .from("sync_jobs")
        .update({
          status: "cancelled",
          finished_at: nowIso(),
          last_error: "Annulé.",
          updated_at: nowIso(),
        })
        .eq("id", job.id);
      return;
    }
    const errText = error instanceof Error ? error.message : "Erreur job";
    const nextStatus = await failOrRetryJob(job, errText);
    if ((job.stage === "enrich" || job.stage === "translate") && nextStatus === "failed") {
      await syncStageProgressFromJobs(
        job.run_id,
        job.user_id,
        job.stage,
        String(job.payload.title ?? job.payload.mal_id ?? "")
      );
    }
  } finally {
    await completeOrFailRun(job.run_id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ error: "Méthode non autorisée." }, 405);
  }
  try {
    let processed = 0;
    for (let i = 0; i < MAX_JOBS_PER_TICK; i += 1) {
      const job = await claimNextJob();
      if (!job) {
        break;
      }
      await processJob(job);
      processed += 1;
    }
    if (processed === 0) {
      return jsonResponse({ ok: true, message: "Aucun job à traiter." }, 200);
    }
    return jsonResponse({ ok: true, processed_jobs: processed }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return jsonResponse({ error: message }, 500);
  }
});
