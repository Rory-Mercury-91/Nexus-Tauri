import pako from "pako";
import protobuf from "protobufjs";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { getMihonSourceById } from "@/services/library/mihonSourceIndexService";

const PG_INT_MAX = 2_147_483_647;
const MANUAL_ID_MIN = 1_900_000_000;
const MANUAL_ID_MAX = 2_100_000_000;

const MIHON_SIMPLE_PROTO = `
syntax = "proto3";
message Backup {
  repeated BackupManga backupManga = 1;
}
message BackupManga {
  int64 source = 1;
  string url = 2;
  string title = 3;
  string author = 5;
  string description = 6;
  repeated string genre = 7;
  int32 status = 8;
  string thumbnailUrl = 9;
  repeated BackupChapter chapters = 16;
  repeated BackupTracking tracking = 18;
}
message BackupChapter {
  bool read = 4;
}
message BackupTracking {
  int32 syncId = 1;
  int32 mediaIdInt = 3;
  string title = 5;
  float score = 8;
  int32 status = 9;
  int64 mediaId = 100;
}
`;

type MihonTracking = {
  syncId?: number;
  mediaIdInt?: number;
  mediaId?: string | number;
  title?: string;
  score?: number;
  status?: number;
};

type MihonManga = {
  source?: string | number;
  url?: string;
  title?: string;
  author?: string;
  description?: string;
  genre?: string[];
  status?: number;
  thumbnailUrl?: string;
  chapters?: Array<{ read?: boolean }>;
  tracking?: MihonTracking[];
};

export type MihonImportProgress = {
  total: number;
  current: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  item: string;
};

export type MihonImportResult = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  withMalId: number;
  details: Array<{ title: string; error: string }>;
};

function buildSourceUrl(baseUrl: string | null, path: string | undefined): string | null {
  const rawPath = String(path ?? "").trim();
  if (!rawPath) return null;
  if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) {
    return rawPath;
  }
  if (!baseUrl) return null;
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return `${normalizedBase}${normalizedPath}`;
}

function mapMihonTrackingStatusToReadStatus(status: number | undefined): string {
  switch (Number(status ?? 0)) {
    case 1:
      return "reading";
    case 2:
      return "completed";
    case 3:
      return "on_hold";
    case 4:
      return "dropped";
    case 6:
    default:
      return "plan_to_read";
  }
}

function normalizeMangaStatus(status: number | undefined): string {
  switch (Number(status ?? 0)) {
    case 2:
    case 4:
      return "Finished";
    case 6:
      return "Discontinued";
    case 1:
    case 7:
    case 3:
    case 0:
    default:
      return "Publishing";
  }
}

function createMinimalSnapshot(params: {
  malId: number;
  title: string;
  imageUrl: string;
  genres: string[];
  synopsis: string;
  chaptersTotal: number;
  score: number;
  mediaType: string;
  status: string;
  sourceUrl: string | null;
  sourceId: string | null;
}): Record<string, unknown> {
  return {
    full: {
      mal_id: params.malId,
      url: params.malId < MANUAL_ID_MIN ? `https://myanimelist.net/manga/${params.malId}` : "",
      title: params.title,
      title_english: params.title,
      title_japanese: "",
      title_synonyms: [],
      type: params.mediaType,
      status: params.status,
      score: Number.isFinite(params.score) ? params.score : 0,
      synopsis: params.synopsis,
      chapters: params.chaptersTotal,
      volumes: 0,
      images: {
        jpg: {
          image_url: params.imageUrl,
          large_image_url: params.imageUrl,
        },
      },
      genres: params.genres.map((name) => ({ name })),
      authors: [],
      serializations: [],
      relations: [],
      external: [],
    },
    source: "mihon_import",
    source_url: params.sourceUrl,
    source_id: params.sourceId,
  };
}

async function resolveManualReadingMalId(existingMalIds: Set<number>): Promise<number> {
  const supabase = getSupabaseClient();
  for (let i = 0; i < 20; i += 1) {
    const candidate =
      MANUAL_ID_MIN + Math.floor(Math.random() * (MANUAL_ID_MAX - MANUAL_ID_MIN));
    if (existingMalIds.has(candidate)) {
      continue;
    }
    const { data, error } = await supabase
      .from("library_reading")
      .select("id")
      .eq("mal_manga_id", candidate)
      .maybeSingle();
    if (error) {
      throw new Error(error.message);
    }
    if (!data) {
      existingMalIds.add(candidate);
      return candidate;
    }
  }
  throw new Error("Impossible de générer un MAL ID manuel unique.");
}

async function decodeBackupFile(file: File): Promise<MihonManga[]> {
  const buffer = await file.arrayBuffer();
  const inflated = pako.ungzip(new Uint8Array(buffer));
  const root = protobuf.parse(MIHON_SIMPLE_PROTO, { keepCase: true }).root;
  const Backup = root.lookupType("Backup");
  const message = Backup.decode(inflated);
  const json = Backup.toObject(message, {
    longs: String,
    enums: String,
    defaults: true,
    arrays: true,
    objects: true,
  }) as { backupManga?: MihonManga[] };
  return Array.isArray(json.backupManga) ? json.backupManga : [];
}

export async function importMihonBackupFile(
  file: File,
  onProgress?: (progress: MihonImportProgress) => void
): Promise<MihonImportResult> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) {
    throw new Error(authError.message);
  }
  if (!user?.id) {
    throw new Error("Utilisateur non connecté.");
  }

  const backupMangas = await decodeBackupFile(file);
  const total = backupMangas.length;
  const result: MihonImportResult = {
    total,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    withMalId: 0,
    details: [],
  };

  const existingMalIds = new Set<number>();
  const progressBase: Omit<MihonImportProgress, "current" | "item"> = {
    total,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };

  for (let index = 0; index < backupMangas.length; index += 1) {
    const manga = backupMangas[index];
    const title = String(manga.title ?? "Sans titre").trim() || "Sans titre";

    try {
      const tracking = Array.isArray(manga.tracking) ? manga.tracking : [];
      const malTracking = tracking.find((t) => Number(t.syncId ?? 0) === 1);
      const rawMalId = Number(malTracking?.mediaId ?? malTracking?.mediaIdInt ?? 0);
      let malId =
        Number.isFinite(rawMalId) && rawMalId > 0 && rawMalId <= PG_INT_MAX
          ? Math.floor(rawMalId)
          : null;
      if (malId) {
        result.withMalId += 1;
        existingMalIds.add(malId);
      } else {
        malId = await resolveManualReadingMalId(existingMalIds);
      }

      const sourceId = String(manga.source ?? "").trim() || null;
      const sourceEntry = sourceId ? await getMihonSourceById(sourceId) : null;
      const sourceUrl = buildSourceUrl(sourceEntry?.sourceBaseUrl ?? null, manga.url);
      const chapters = Array.isArray(manga.chapters) ? manga.chapters : [];
      const chaptersTotal = chapters.length;
      const chaptersRead = chapters.filter((chapter) => Boolean(chapter.read)).length;
      const readStatus =
        malTracking?.status !== undefined
          ? mapMihonTrackingStatusToReadStatus(malTracking.status)
          : chaptersRead > 0
            ? "reading"
            : "plan_to_read";
      const imageUrl = String(manga.thumbnailUrl ?? "").trim();
      const genres = Array.isArray(manga.genre)
        ? manga.genre.map((v) => String(v).trim()).filter(Boolean)
        : [];
      const synopsis = String(manga.description ?? "").trim();
      const score = Number(malTracking?.score ?? 0);
      const mediaType = genres.some((g) =>
        ["webtoon", "manhwa", "manhua"].some((needle) => g.toLowerCase().includes(needle))
      )
        ? "Manhwa"
        : "Manga";
      const workStatus = normalizeMangaStatus(manga.status);

      const snapshot = createMinimalSnapshot({
        malId,
        title,
        imageUrl,
        genres,
        synopsis,
        chaptersTotal,
        score,
        mediaType,
        status: workStatus,
        sourceUrl,
        sourceId,
      });

      const malSnapshot = {
        list_entry: {
          list_status: {
            status: readStatus,
            score: Number.isFinite(score) ? score : 0,
            num_chapters_read: chaptersRead,
            num_volumes_read: 0,
            is_favorite: false,
          },
        },
        manual_overrides: {
          links: {
            mal: malId < MANUAL_ID_MIN ? `https://myanimelist.net/manga/${malId}` : "",
            mihon_source: sourceUrl ?? "",
          },
          mihon_source_id: sourceId,
        },
      };

      const { data: existingRow, error: existingError } = await supabase
        .from("library_reading")
        .select("id")
        .eq("user_id", user.id)
        .eq("mal_manga_id", malId)
        .maybeSingle();
      if (existingError) {
        throw new Error(existingError.message);
      }

      const { data: upsertedRows, error: upsertError } = await supabase
        .from("library_reading")
        .upsert(
          {
            user_id: user.id,
            mal_manga_id: malId,
            title,
            title_english: malTracking?.title ? String(malTracking.title) : title,
            main_picture_url: imageUrl || null,
            read_status: readStatus,
            jikan_snapshot: snapshot,
            mal_official_snapshot: malSnapshot,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,mal_manga_id" }
        )
        .select("id")
        .limit(1);
      if (upsertError) {
        throw new Error(upsertError.message);
      }
      const readingId = String(
        upsertedRows?.[0]?.id ?? existingRow?.id ?? ""
      );
      if (readingId) {
        const { error: presenceError } = await supabase
          .from("reading_mihon_presence")
          .upsert(
            {
              reading_id: readingId,
              user_id: user.id,
              chapters_read: chaptersRead,
              chapters_total: Math.max(chaptersTotal, chaptersRead),
              source_id: sourceId,
              source_url: sourceUrl,
              prefer_mihon_progress: true,
            },
            { onConflict: "reading_id,user_id" }
          );
        if (presenceError) {
          throw new Error(presenceError.message);
        }
      }

      if (existingRow?.id) {
        result.updated += 1;
      } else {
        result.created += 1;
      }
    } catch (error) {
      result.errors += 1;
      result.details.push({
        title,
        error: error instanceof Error ? error.message : "Erreur inconnue",
      });
    } finally {
      onProgress?.({
        ...progressBase,
        current: index + 1,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
        item: title,
      });
    }
  }

  return result;
}
