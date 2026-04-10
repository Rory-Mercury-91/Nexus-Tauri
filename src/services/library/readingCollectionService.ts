import type { SupabaseClient } from "@supabase/supabase-js";
import { translateLibraryTerms } from "@/services/library/termTranslations";

export type ReadingCollectionEntry = {
  id: string;
  malId: number;
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
};

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

export async function fetchReadingCollection(supabase: SupabaseClient): Promise<ReadingCollectionEntry[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id ?? "";

  const { data, error } = await supabase
    .from("library_reading")
    .select("id, mal_manga_id, title, main_picture_url, read_status, created_at, mal_official_snapshot, jikan_snapshot")
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
  
  // Récupérer les volumes avec propriétaires pour toutes les lectures
  const readingIds = rows.map(r => r.id);
  const volumeOwnersMap = new Map<string, Set<string>>();
  const volumesByReadingId = new Map<string, Array<{ is_read: boolean }>>();
  
  if (readingIds.length > 0) {
    const BATCH_SIZE = 50;
    for (let i = 0; i < readingIds.length; i += BATCH_SIZE) {
      const batch = readingIds.slice(i, i + BATCH_SIZE);
      const { data: volumesData } = await supabase
        .from("reading_volumes")
        .select("reading_id, is_read, reading_volume_owners(user_id)")
        .in("reading_id", batch);
      
      (volumesData ?? []).forEach((vol: any) => {
        const readingId = vol.reading_id as string;
        
        // Stocker les propriétaires
        if (!volumeOwnersMap.has(readingId)) {
          volumeOwnersMap.set(readingId, new Set());
        }
        const owners = Array.isArray(vol.reading_volume_owners) ? vol.reading_volume_owners : [];
        owners.forEach((owner: any) => {
          if (owner.user_id) {
            volumeOwnersMap.get(readingId)!.add(owner.user_id);
          }
        });
        
        // Stocker les volumes pour calculer les volumes lus
        if (!volumesByReadingId.has(readingId)) {
          volumesByReadingId.set(readingId, []);
        }
        volumesByReadingId.get(readingId)!.push({ is_read: Boolean(vol.is_read) });
      });
    }
  }
  
  return rows.map((row) => {
    const malSnapshot = (row.mal_official_snapshot ?? {}) as Record<string, unknown>;
    const jikanSnapshot = (row.jikan_snapshot ?? {}) as Record<string, unknown>;
    const full = (jikanSnapshot.full ?? jikanSnapshot.data ?? {}) as Record<string, unknown>;
    const manualOverrides = (malSnapshot.manual_overrides ?? {}) as Record<string, unknown>;
    const listEntry = (malSnapshot.list_entry ?? {}) as Record<string, unknown>;
    const listStatus = toListStatus(malSnapshot);
    const rawReadStatus = (row.read_status as string | null) ?? listStatus.status ?? null;
    const chaptersRead = Number(listStatus.num_chapters_read ?? listStatus.num_chapters_readed ?? 0);
    
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
    if (chaptersTotal === 0 && chaptersRead > 0) {
      chaptersTotal = chaptersRead;
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
    const hasFamilyOwners = familyMemberIds.some(memberId => owners.has(memberId));
    
    return {
      id: readingId,
      malId: Number(row.mal_manga_id),
      title: String(row.title),
      type,
      userStatus: mapReadStatus(rawReadStatus),
      workStatus,
      score: Number.isFinite(score) ? score : 0,
      favorite,
      chaptersRead: Number.isFinite(chaptersRead) ? chaptersRead : 0,
      chaptersTotal: Number.isFinite(chaptersTotal) ? chaptersTotal : 0,
      volumesRead: Number.isFinite(volumesRead) ? volumesRead : 0,
      volumesTotal: Number.isFinite(volumesTotal) ? volumesTotal : 0,
      genres: translateLibraryTerms("genre", genres),
      themes: translateLibraryTerms("theme", themes),
      imageUrl,
      addedAt: String(row.created_at),
      hasFamilyOwners,
    };
  });
}

export async function updateReadingStatus(
  supabase: SupabaseClient,
  rowId: string,
  userStatus: ReadingCollectionEntry["userStatus"]
) {
  const readStatus = mapUserStatusToReadStatus(userStatus);
  const { error } = await supabase
    .from("library_reading")
    .update({
      read_status: readStatus,
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
