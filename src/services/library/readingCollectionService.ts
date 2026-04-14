import type { SupabaseClient } from "@supabase/supabase-js";
import {
  coalesceFirstFiniteNumber,
  extractNumChaptersReadFromMalOfficialSnapshot,
  mergeReadingProgressBySource,
  resolveCanonicalReadStatus,
} from "@/services/library/readingProgressResolution";
import { translateLibraryTerms } from "@/services/library/termTranslations";
import { listFamilyVisibleProfiles } from "@/services/family/familyService";

export type ReadingCollectionEntry = {
  id: string;
  /** MAL manga id ; 0 si entrée uniquement AniList. */
  malId: number;
  /** Présent si mal_manga_id est null (sync AniList sans idMal). */
  anilistMediaId: number | null;
  title: string;
  type: "Manga" | "Manhwa" | "Manhua" | "Light novel" | "Roman" | "One-shot" | "Doujinshi" | "Inconnu";
  userStatus: "Planifié" | "En cours" | "En pause" | "Terminé" | "Abandonné";
  workStatus: "En cours" | "Terminé" | "Abandonné" | "À venir";
  score: number;
  favorite: boolean;
  chaptersRead: number;
  chaptersTotal: number;
  volumesRead: number;
  volumesTotal: number;
  genres: string[];
  themes: string[];
  imageUrl: string;
  addedAt: string;
  hasFamilyOwners: boolean;
  nautiljonNeedsManualImport: boolean;
  /** Lien Nautiljon défini ou import Nautiljon associé. */
  hasNautiljonData: boolean;
  malChaptersRead: number;
  malChaptersTotal: number;
  mihonChaptersRead: number;
  mihonChaptersTotal: number;
  mihonEnabledByCurrentUser: boolean;
  preferMihonProgress: boolean;
  mihonUsers: string[];
  mihonUserBadges: Array<{ name: string; avatarPath: string | null }>;
  mihonSources: string[];
  hasMihonInFamily: boolean;
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

function mapReadStatus(raw: unknown): ReadingCollectionEntry["userStatus"] {
  const value = normalizeStatus(raw);
  switch (value) {
    case "reading":
      return "En cours";
    case "completed":
      return "Terminé";
    case "on_hold":
    case "onhold":
      return "En pause";
    case "dropped":
      return "Abandonné";
    case "plan_to_read":
    case "plantoread":
    default:
      return "Planifié";
  }
}

export function mapUserStatusToReadStatus(raw: ReadingCollectionEntry["userStatus"]): string {
  switch (raw) {
    case "En cours":
      return "reading";
    case "Terminé":
      return "completed";
    case "En pause":
      return "on_hold";
    case "Abandonné":
      return "dropped";
    default:
      return "plan_to_read";
  }
}

function mapMediaType(raw: unknown): ReadingCollectionEntry["type"] {
  const value = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  if (value === "manga") return "Manga";
  if (value === "manhwa") return "Manhwa";
  if (value === "manhua") return "Manhua";
  if (value === "lightnovel" || value === "light_novel" || value === "light novel") return "Light novel";
  if (value === "novel") return "Roman";
  if (value === "one_shot" || value === "one-shot") return "One-shot";
  if (value === "doujinshi") return "Doujinshi";
  return "Inconnu";
}

function mapWorkStatus(raw: unknown, fallbackReadStatus: unknown): ReadingCollectionEntry["workStatus"] {
  const value = normalizeStatus(raw);
  if (value === "publishing") return "En cours";
  if (value === "finished") return "Terminé";
  if (value === "discontinued" || value === "abandoned") return "Abandonné";
  if (value === "not_yet_published") return "À venir";
  if (normalizeStatus(fallbackReadStatus) === "reading") {
    return "En cours";
  }
  return "Terminé";
}

function toListStatus(snapshot: Record<string, unknown>): Record<string, unknown> {
  const listEntry = (snapshot.list_entry ?? {}) as Record<string, unknown>;
  return (listEntry.list_status ?? snapshot.my_list_status ?? {}) as Record<string, unknown>;
}

/** Route React Router vers la fiche détail (MAL, AniList-only, ou id de ligne). */
export function readingEntryDetailPath(
  entry: Pick<ReadingCollectionEntry, "id" | "malId" | "anilistMediaId">
): string {
  if (entry.malId > 0) {
    return `/lectures/${entry.malId}`;
  }
  if (entry.anilistMediaId != null && entry.anilistMediaId > 0) {
    return `/lectures/anilist/${entry.anilistMediaId}`;
  }
  return `/lectures/${entry.id}`;
}

export async function fetchReadingCollection(supabase: SupabaseClient): Promise<ReadingCollectionEntry[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id ?? "";

  const { data, error } = await supabase
    .from("library_reading")
    .select(
      "id, mal_manga_id, anilist_media_id, title, main_picture_url, read_status, created_at, mal_official_snapshot, jikan_snapshot"
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = data ?? [];
  
  // Récupérer les familles de l'utilisateur
  const { data: familyData } = await supabase
    .from("family_members")
    .select("family_id")
    .eq("user_id", userId);
  
  const familyIds = (familyData ?? []).map(f => f.family_id);
  
  // Récupérer tous les membres de ces familles (en incluant toujours l'utilisateur actuel)
  let familyMemberIds: string[] = [userId];
  if (familyIds.length > 0) {
    const { data: membersData } = await supabase
      .from("family_members")
      .select("user_id")
      .in("family_id", familyIds);
    
    // S'assurer que l'utilisateur actuel est toujours dans la liste
    familyMemberIds = Array.from(new Set([userId, ...(membersData ?? []).map(m => m.user_id)]));
  }
  const visibleProfiles = await listFamilyVisibleProfiles(supabase);
  const profileNameById = new Map(
    visibleProfiles.map((profile) => [
      profile.id,
      profile.display_name?.trim() || profile.id.slice(0, 8),
    ])
  );
  const profileAvatarById = new Map(
    visibleProfiles.map((profile) => [profile.id, profile.avatar_storage_path ?? null])
  );
  
  // Récupérer les volumes avec propriétaires pour toutes les lectures
  const readingIds = rows.map(r => r.id);
  const volumeOwnersMap = new Map<string, Set<string>>();
  const volumesByReadingId = new Map<string, Array<{ is_read: boolean }>>();
  const mihonPresenceByReadingId = new Map<
    string,
    Array<{
      userId: string;
      chaptersRead: number;
      chaptersTotal: number;
      preferMihonProgress: boolean;
      sourceId: string;
    }>
  >();
  
  if (readingIds.length > 0) {
    const BATCH_SIZE = 50;
    for (let i = 0; i < readingIds.length; i += BATCH_SIZE) {
      const batch = readingIds.slice(i, i + BATCH_SIZE);
      const { data: volumesData } = await supabase
        .from("user_manga_volume_state")
        .select("reading_id, is_read")
        .in("reading_id", batch);

      type StateRow = {
        reading_id?: string | null;
        is_read?: boolean | null;
      };
      (volumesData ?? []).forEach((vol) => {
        const typedVol = vol as StateRow;
        const readingId = String(typedVol.reading_id ?? "");
        if (!readingId) {
          return;
        }
        if (!volumesByReadingId.has(readingId)) {
          volumesByReadingId.set(readingId, []);
        }
        volumesByReadingId.get(readingId)!.push({ is_read: Boolean(typedVol.is_read) });
      });
    }

    const malIds = Array.from(
      new Set(
        rows
          .map((r) => Number((r as { mal_manga_id?: unknown }).mal_manga_id ?? 0))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    );
    const catalogIdToMal = new Map<string, number>();
    if (malIds.length > 0) {
      for (let i = 0; i < malIds.length; i += BATCH_SIZE) {
        const batch = malIds.slice(i, i + BATCH_SIZE);
        const { data: catRows } = await supabase
          .from("library_manga_volume_catalog")
          .select("id, mal_manga_id")
          .in("mal_manga_id", batch);
        (catRows ?? []).forEach((c) => {
          const row = c as { id?: string | null; mal_manga_id?: number | null };
          const id = String(row.id ?? "").trim();
          const mal = Number(row.mal_manga_id ?? 0);
          if (id && Number.isFinite(mal) && mal > 0) {
            catalogIdToMal.set(id, mal);
          }
        });
      }
    }

    const readingsByMal = new Map<number, string[]>();
    for (const r of rows) {
      const rid = String((r as { id?: unknown }).id ?? "");
      const mal = Number((r as { mal_manga_id?: unknown }).mal_manga_id ?? 0);
      if (!rid || !Number.isFinite(mal) || mal <= 0) continue;
      if (!readingsByMal.has(mal)) readingsByMal.set(mal, []);
      readingsByMal.get(mal)!.push(rid);
    }

    const catalogIds = [...catalogIdToMal.keys()];
    if (familyIds.length > 0 && catalogIds.length > 0) {
      for (let i = 0; i < catalogIds.length; i += BATCH_SIZE) {
        const batch = catalogIds.slice(i, i + BATCH_SIZE);
        const { data: ownRows } = await supabase
          .from("family_manga_volume_owner")
          .select("catalog_volume_id, user_id")
          .in("family_id", familyIds)
          .in("catalog_volume_id", batch);
        (ownRows ?? []).forEach((o) => {
          const row = o as { catalog_volume_id?: string | null; user_id?: string | null };
          const cid = String(row.catalog_volume_id ?? "").trim();
          const uid = String(row.user_id ?? "").trim();
          if (!cid || !uid) return;
          const mal = catalogIdToMal.get(cid);
          if (mal === undefined) return;
          const targetReadings = readingsByMal.get(mal) ?? [];
          for (const readingId of targetReadings) {
            if (!volumeOwnersMap.has(readingId)) {
              volumeOwnersMap.set(readingId, new Set());
            }
            volumeOwnersMap.get(readingId)!.add(uid);
          }
        });
      }
    }

    for (let i = 0; i < readingIds.length; i += BATCH_SIZE) {
      const batch = readingIds.slice(i, i + BATCH_SIZE);
      const { data: mihonData } = await supabase
        .from("reading_mihon_presence")
        .select(
          "reading_id, user_id, chapters_read, chapters_total, prefer_mihon_progress, source_id"
        )
        .in("reading_id", batch);

      type MihonPresenceRow = {
        reading_id?: string | null;
        user_id?: string | null;
        chapters_read?: number | null;
        chapters_total?: number | null;
        prefer_mihon_progress?: boolean | null;
        source_id?: string | null;
      };
      (mihonData ?? []).forEach((row) => {
        const typedRow = row as MihonPresenceRow;
        const readingId = String(typedRow.reading_id ?? "");
        if (!readingId) return;
        if (!mihonPresenceByReadingId.has(readingId)) {
          mihonPresenceByReadingId.set(readingId, []);
        }
        mihonPresenceByReadingId.get(readingId)!.push({
          userId: String(typedRow.user_id ?? ""),
          chaptersRead: Number(typedRow.chapters_read ?? 0),
          chaptersTotal: Number(typedRow.chapters_total ?? 0),
          preferMihonProgress: Boolean(typedRow.prefer_mihon_progress ?? true),
          sourceId: String(typedRow.source_id ?? "").trim(),
        });
      });
    }
  }
  const mihonSourceIds = Array.from(
    new Set(
      Array.from(mihonPresenceByReadingId.values())
        .flat()
        .map((entry) => String((entry as { sourceId?: string }).sourceId ?? "").trim())
        .filter((id) => id.length > 0)
    )
  );
  const sourceNameById = new Map<string, string>();
  if (mihonSourceIds.length > 0) {
    const { data: sourceRows } = await supabase
      .from("mihon_sources")
      .select("source_id, source_name")
      .in("source_id", mihonSourceIds);
    (sourceRows ?? []).forEach((row) => {
      const typed = row as { source_id?: string | null; source_name?: string | null };
      const id = String(typed.source_id ?? "").trim();
      if (!id) return;
      sourceNameById.set(id, String(typed.source_name ?? id));
    });
  }
  
  return rows.map((row) => {
    const malSnapshot = (row.mal_official_snapshot ?? {}) as Record<string, unknown>;
    const jikanSnapshot = (row.jikan_snapshot ?? {}) as Record<string, unknown>;
    const full = (jikanSnapshot.full ?? jikanSnapshot.data ?? {}) as Record<string, unknown>;
    const manualOverrides = (malSnapshot.manual_overrides ?? {}) as Record<string, unknown>;
    const listEntry = (malSnapshot.list_entry ?? {}) as Record<string, unknown>;
    const listStatus = toListStatus(malSnapshot);
    const rawReadStatus = (row.read_status as string | null) ?? listStatus.status ?? null;
    const malChaptersRead = Number(listStatus.num_chapters_read ?? listStatus.num_chapters_readed ?? 0);
    
    // Utiliser exactement la même logique que homeDashboardService
    // Ajouter jikanSnapshot.chapters comme fallback supplémentaire
    let chaptersTotal = Number(
      full.chapters ?? 
      jikanSnapshot.chapters ?? 
      malSnapshot.num_chapters ?? 
      listEntry.num_chapters ?? 
      malSnapshot.chapters ?? 
      0
    );
    
    // Heuristique: si chaptersTotal est 0 mais qu'on a lu des chapitres,
    // utiliser chaptersRead comme valeur minimale (les données Jikan peuvent être incomplètes)
    if (chaptersTotal === 0 && malChaptersRead > 0) {
      chaptersTotal = malChaptersRead;
    }
    
    // Pour les volumes : utiliser la même logique que ReadingDetailPage
    const readingId = row.id as string;
    const volumes = volumesByReadingId.get(readingId) ?? [];
    
    // Compter les volumes réellement marqués comme lus
    const volumesRead = volumes.filter((vol) => vol.is_read === true).length;
    
    // Utiliser volumesVf en priorité, sinon volumes VO
    const manualVolumesVf = Number(manualOverrides.volumes_vf ?? 0);
    const totalVolumesVo = Number(
      full.volumes ?? 
      jikanSnapshot.volumes ?? 
      malSnapshot.num_volumes ?? 
      listEntry.num_volumes ?? 
      malSnapshot.volumes ?? 
      0
    );
    let volumesTotal = manualVolumesVf > 0 ? manualVolumesVf : totalVolumesVo;
    
    // Heuristique: si volumesTotal est 0 mais qu'on a lu des volumes
    if (volumesTotal === 0 && volumesRead > 0) {
      volumesTotal = volumesRead;
    }
    const genres = Array.isArray(full.genres)
      ? (full.genres as Array<Record<string, unknown>>).map((g) => String(g.name ?? "")).filter(Boolean)
      : [];
    const themes = Array.isArray(full.themes)
      ? (full.themes as Array<Record<string, unknown>>).map((g) => String(g.name ?? "")).filter(Boolean)
      : [];
    const score = Number(listStatus.score ?? malSnapshot.mean ?? full.score ?? 0);
    const favorite = Boolean(listStatus.is_favorite ?? (row as { is_favorite?: unknown }).is_favorite ?? false);
    const type = mapMediaType(full.type ?? malSnapshot.media_type);
    const workStatus = mapWorkStatus(full.status ?? malSnapshot.status, rawReadStatus);
    const imageUrl =
      row.main_picture_url ||
      String(((full.images as Record<string, unknown> | undefined)?.jpg as Record<string, unknown> | undefined)?.large_image_url ?? "") ||
      "";

    const owners = volumeOwnersMap.get(readingId) ?? new Set();
    // "Collection famille" = au moins un propriétaire du foyer autre que l'utilisateur courant.
    const hasFamilyOwners = Array.from(owners).some(
      (ownerId) => ownerId !== userId && familyMemberIds.includes(ownerId)
    );
    
    const mihonEntries = mihonPresenceByReadingId.get(readingId) ?? [];
    const currentUserMihon = mihonEntries.find((entry) => entry.userId === userId) ?? null;
    const hasMihonInFamily = mihonEntries.some((entry) => familyMemberIds.includes(entry.userId));
    const mihonUsers = mihonEntries
      .filter((entry) => familyMemberIds.includes(entry.userId))
      .map((entry) =>
        entry.userId === userId
          ? "Moi"
          : profileNameById.get(entry.userId) ?? `Membre ${entry.userId.slice(0, 8)}`
      );
    const mihonUserBadges = mihonEntries
      .filter((entry) => familyMemberIds.includes(entry.userId))
      .map((entry) => ({
        name:
          entry.userId === userId
            ? "Moi"
            : profileNameById.get(entry.userId) ?? `Membre ${entry.userId.slice(0, 8)}`,
        avatarPath: profileAvatarById.get(entry.userId) ?? null,
      }));
    const mihonSources = Array.from(
      new Set(
        mihonEntries
          .filter((entry) => familyMemberIds.includes(entry.userId))
          .map((entry) => {
            const sourceId = String((entry as { sourceId?: string }).sourceId ?? "").trim();
            if (!sourceId) return "";
            // Si le nom n'est pas résolu (index non rafraîchi ou extension hors Keiyoushi),
            // on n'expose pas l'ID numérique brut dans les filtres.
            return sourceNameById.get(sourceId) ?? "";
          })
          .filter((label) => label.length > 0)
      )
    );
    const mihonChaptersRead = Math.max(0, Number(currentUserMihon?.chaptersRead ?? 0));
    const mihonChaptersTotal = Math.max(
      0,
      Number(currentUserMihon?.chaptersTotal ?? currentUserMihon?.chaptersRead ?? 0)
    );
    const preferMihonProgress = Boolean(currentUserMihon?.preferMihonProgress ?? false);
    const chaptersRead = preferMihonProgress ? mihonChaptersRead : malChaptersRead;
    const chaptersTotalResolved = preferMihonProgress
      ? (mihonChaptersTotal > 0 ? mihonChaptersTotal : chaptersTotal)
      : chaptersTotal;

    const malMangaNum = Number(row.mal_manga_id ?? 0);
    const rawAnilistId = (row as Record<string, unknown>).anilist_media_id;
    const aniMediaNum = rawAnilistId != null ? Number(rawAnilistId) : NaN;
    const aniMedia = Number.isFinite(aniMediaNum) && aniMediaNum > 0 ? aniMediaNum : null;
    return {
      id: readingId,
      malId: Number.isFinite(malMangaNum) && malMangaNum > 0 ? malMangaNum : 0,
      anilistMediaId: aniMedia,
      title: String(row.title),
      type,
      userStatus: mapReadStatus(rawReadStatus),
      workStatus,
      score: Number.isFinite(score) ? score : 0,
      favorite,
      chaptersRead: Number.isFinite(chaptersRead) ? chaptersRead : 0,
      chaptersTotal: Number.isFinite(chaptersTotalResolved) ? chaptersTotalResolved : 0,
      volumesRead: Number.isFinite(volumesRead) ? volumesRead : 0,
      volumesTotal: Number.isFinite(volumesTotal) ? volumesTotal : 0,
      genres: translateLibraryTerms("genre", genres),
      themes: translateLibraryTerms("theme", themes),
      imageUrl,
      addedAt: String(row.created_at),
      hasFamilyOwners,
      nautiljonNeedsManualImport: Boolean(manualOverrides.nautiljon_needs_manual_import ?? false),
      hasNautiljonData: Boolean(
        manualOverrides.nautiljon_needs_manual_import ||
        String(((manualOverrides.links ?? {}) as Record<string, unknown>).nautiljon ?? "").trim()
      ),
      malChaptersRead: Number.isFinite(malChaptersRead) ? malChaptersRead : 0,
      malChaptersTotal: Number.isFinite(chaptersTotal) ? chaptersTotal : 0,
      mihonChaptersRead,
      mihonChaptersTotal,
      mihonEnabledByCurrentUser: Boolean(currentUserMihon),
      preferMihonProgress,
      mihonUsers: Array.from(new Set(mihonUsers)),
      mihonUserBadges,
      mihonSources,
      hasMihonInFamily,
    };
  });
}

export async function setReadingMihonState(
  supabase: SupabaseClient,
  rowId: string,
  enabled: boolean,
  payload?: { chaptersRead?: number; chaptersTotal?: number; preferMihonProgress?: boolean }
): Promise<void> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) {
    throw new Error(userError.message);
  }
  if (!user?.id) {
    throw new Error("Utilisateur non connecté.");
  }

  if (!enabled) {
    const { error } = await supabase
      .from("reading_mihon_presence")
      .delete()
      .eq("reading_id", rowId)
      .eq("user_id", user.id);
    if (error) {
      throw new Error(error.message);
    }
    return;
  }

  const { error } = await supabase.rpc("upsert_reading_mihon_presence", {
    p_reading_id: rowId,
    p_chapters_read: Math.max(0, Number(payload?.chaptersRead ?? 0)),
    p_chapters_total: Math.max(
      0,
      Number(payload?.chaptersTotal ?? payload?.chaptersRead ?? 0)
    ),
    p_prefer_mihon_progress: Boolean(payload?.preferMihonProgress ?? true),
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function fetchReadingCollectionStamp(
  supabase: SupabaseClient
): Promise<{ latestUpdatedAt: string | null; count: number }> {
  const [{ data: latestRows, error: latestError }, { count, error: countError }] = await Promise.all([
    supabase
      .from("library_reading")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1),
    supabase
      .from("library_reading")
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

export async function updateReadingStatus(
  supabase: SupabaseClient,
  rowId: string,
  userStatus: ReadingCollectionEntry["userStatus"]
) {
  const readStatus = mapUserStatusToReadStatus(userStatus);
  const { data: row } = await supabase
    .from("library_reading")
    .select("reading_progress_by_source, mal_official_snapshot")
    .eq("id", rowId)
    .maybeSingle();
  const prevBy = (row?.reading_progress_by_source ?? {}) as Record<string, unknown>;
  let merged = mergeReadingProgressBySource(prevBy, "nexus", {
    read_status: readStatus,
    updated_at: new Date().toISOString(),
  });
  const nex = { ...(merged.nexus as Record<string, unknown> | undefined) };
  if (nex.chapters_read == null) {
    const ch = coalesceFirstFiniteNumber(
      (prevBy.nexus as Record<string, unknown> | undefined)?.chapters_read,
      (merged.mal as Record<string, unknown> | undefined)?.chapters_read,
      extractNumChaptersReadFromMalOfficialSnapshot(row?.mal_official_snapshot)
    );
    if (ch != null) {
      nex.chapters_read = ch;
    }
  }
  merged = { ...merged, nexus: nex };
  const canonical = resolveCanonicalReadStatus(merged) ?? readStatus;
  const { error } = await supabase
    .from("library_reading")
    .update({
      reading_progress_by_source: merged,
      read_status: canonical,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rowId);
  if (error) {
    throw new Error(error.message);
  }
}

export async function updateReadingFavorite(
  supabase: SupabaseClient,
  rowId: string,
  favorite: boolean
) {
  const { data: existingRow } = await supabase
    .from("library_reading")
    .select("mal_official_snapshot")
    .eq("id", rowId)
    .maybeSingle();
  
  if (!existingRow) {
    throw new Error("Entrée lecture introuvable.");
  }
  
  const baseMalSnapshot = ((existingRow.mal_official_snapshot ?? {}) as Record<string, unknown>);
  const baseListEntry = ((baseMalSnapshot.list_entry ?? {}) as Record<string, unknown>);
  const baseListStatus = ((baseListEntry.list_status ?? {}) as Record<string, unknown>);
  
  const nextMalSnapshot = {
    ...baseMalSnapshot,
    list_entry: {
      ...baseListEntry,
      list_status: {
        ...baseListStatus,
        is_favorite: favorite,
      },
    },
  };
  
  const { error } = await supabase
    .from("library_reading")
    .update({
      mal_official_snapshot: nextMalSnapshot,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rowId);
  if (error) {
    throw new Error(error.message);
  }
}

function buildManualReadingFull(malId: number, title: string, imageUrl: string): Record<string, unknown> {
  return {
    mal_id: malId,
    url: `https://myanimelist.net/manga/${malId}`,
    title,
    title_english: title,
    title_japanese: "",
    title_synonyms: [],
    type: "Manga",
    status: "Publishing",
    score: 0,
    synopsis: "",
    chapters: 0,
    volumes: 0,
    published: { from: null, to: null, string: "" },
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
    authors: [],
    serializations: [],
    relations: [],
    external: [],
  };
}

export async function createManualReadingEntry(
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
    chapters?: number;
    volumes?: number;
    synopsis?: string;
    synopsisFr?: string;
    score?: number;
    authors?: string;
    scenarist?: string;
    dessinateur?: string;
    traducteur?: string;
    serializations?: string;
    prepublie?: string;
    editeurVf?: string;
    editeurVo?: string;
    publishedString?: string;
    anneeVf?: string;
    anneeVo?: string;
    volumesVf?: number;
    ageConseille?: string;
    groupe?: string;
    linkMal?: string;
    linkNautiljon?: string;
    linkAnilist?: string;
    userStatus?: ReadingCollectionEntry["userStatus"];
    favorite?: boolean;
  }
): Promise<number> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Le titre est obligatoire.");
  }
  const malId = await resolveManualReadingMalId(supabase, input.malId);
  const imageUrl = (input.imageUrl ?? "").trim();
  const full = buildManualReadingFull(malId, title, imageUrl);
  full.title_english = input.titleEnglish?.trim() || title;
  full.title_japanese = input.titleJapanese?.trim() || "";
  full.title_synonyms = input.titleAlternatives ?? [];
  full.type = input.mediaType?.trim() || "Manga";
  full.status = input.workStatus?.trim() || "Publishing";
  full.chapters = Math.max(0, Number(input.chapters ?? 0));
  full.volumes = Math.max(0, Number(input.volumes ?? 0));
  full.synopsis = input.synopsis?.trim() || "";
  full.score = Number(input.score ?? 0);
  full.url = input.linkMal?.trim() || `https://myanimelist.net/manga/${malId}`;
  full.authors = String(input.authors ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
  full.serializations = String(input.serializations ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
  full.published = {
    from: null,
    to: null,
    string: input.publishedString?.trim() || "",
  };
  const userStatus = input.userStatus ?? "Planifié";
  const favorite = Boolean(input.favorite ?? false);
  const malSnapshot = {
    list_entry: {
      list_status: {
        status: mapUserStatusToReadStatus(userStatus),
        score: 0,
        num_chapters_read: 0,
        num_volumes_read: 0,
        is_favorite: favorite,
      },
    },
    manual_overrides: {
      title_fr: title,
      synopsis_fr: input.synopsisFr?.trim() || "",
      titre_original: input.titleJapanese?.trim() || "",
      volumes_vf:
        Number.isFinite(input.volumesVf) && Number(input.volumesVf) > 0
          ? Number(input.volumesVf)
          : null,
      editeur_vf: input.editeurVf?.trim() || "",
      editeur_vo: input.editeurVo?.trim() || "",
      annee_vf: input.anneeVf?.trim() || "",
      annee_vo: input.anneeVo?.trim() || "",
      traducteur: input.traducteur?.trim() || "",
      scenarist: input.scenarist?.trim() || "",
      dessinateur: input.dessinateur?.trim() || "",
      age_conseille: input.ageConseille?.trim() || "",
      groupe: input.groupe?.trim() || "",
      prepublie: input.prepublie?.trim() || "",
      locked_field_ids: ["title", "status", "chapters", "volumes", "synopsis"],
      links: {
        mal: input.linkMal?.trim() || "",
        nautiljon: input.linkNautiljon?.trim() || "",
        anilist: input.linkAnilist?.trim() || "",
      },
    },
  };
  const { error } = await supabase.rpc("upsert_library_reading_entry", {
    p_mal_manga_id: malId,
    p_title: title,
    p_title_english: String(full.title_english ?? title),
    p_main_picture_url: imageUrl || null,
    p_jikan_snapshot: { full },
    p_mal_official_snapshot: malSnapshot,
    p_read_status: mapUserStatusToReadStatus(userStatus),
    p_user_notes: "",
  });
  if (error) {
    throw new Error(error.message);
  }
  return malId;
}

async function resolveManualReadingMalId(
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
      .from("library_reading")
      .select("id")
      .eq("mal_manga_id", candidate)
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

export async function deleteReadingEntry(
  supabase: SupabaseClient,
  rowId: string
): Promise<void> {
  const { error } = await supabase.from("library_reading").delete().eq("id", rowId);
  if (error) {
    throw new Error(error.message);
  }
}
