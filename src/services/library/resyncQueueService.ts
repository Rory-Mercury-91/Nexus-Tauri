import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAnimeSyncDiffFields, buildReadingSyncDiffFields, type SyncDiffField } from "./syncDiffService";

export type ResyncQueueEntry = {
  id: string;
  malId: number;
  title: string;
  mediaType: "anime" | "reading";
  fields: SyncDiffField[];
};

/**
 * Détecte les entrées qui ont des différences entre leur snapshot actuel et un nouveau snapshot MAL/Jikan
 */
export async function detectResyncChanges(
  supabase: SupabaseClient,
  userId: string,
  mediaType: "anime" | "reading",
  source: "mal" | "anilist"
): Promise<ResyncQueueEntry[]> {
  const tableName = mediaType === "anime" ? "library_anime" : "library_reading";
  const malIdCol = mediaType === "anime" ? "mal_id" : "mal_manga_id";
  
  const { data, error } = await supabase
    .from(tableName)
    .select("id, title, mal_official_snapshot, jikan_snapshot, " + malIdCol)
    .eq("user_id", userId);
  
  if (error) {
    throw new Error(error.message);
  }
  
  const entries = data ?? [];
  const queue: ResyncQueueEntry[] = [];
  
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const malId = Number((entry as Record<string, unknown>)[malIdCol]);
    if (!Number.isFinite(malId) || malId <= 0) {
      continue;
    }
    
    // Ajouter un délai pour respecter le rate limit de Jikan (3 req/sec)
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    
    // Récupérer les données live de MAL/Jikan
    const [malData, jikanData] = await Promise.all([
      source === "mal" ? fetchMalData(malId, mediaType) : null,
      fetchJikanData(malId, mediaType),
    ]);
    
    if (!malData && !jikanData) {
      continue;
    }
    
    const currentMalSnapshot = (entry.mal_official_snapshot ?? {}) as Record<string, unknown>;
    const currentJikanSnapshot = (entry.jikan_snapshot ?? {}) as Record<string, unknown>;
    const currentJikanFull = (currentJikanSnapshot.full ?? {}) as Record<string, unknown>;
    
    // Créer des snapshots temporaires avec les nouvelles données
    const newMalSnapshot = malData ? { ...currentMalSnapshot, ...malData } : currentMalSnapshot;
    const newJikanFull = jikanData ? { ...currentJikanFull, ...jikanData } : currentJikanFull;
    const newJikanSnapshot = { ...currentJikanSnapshot, full: newJikanFull };
    
    // Détecter les différences
    const fields = mediaType === "anime"
      ? buildAnimeSyncDiffFields({
          malCurrent: currentMalSnapshot,
          malIncoming: newMalSnapshot,
          jikanCurrent: currentJikanSnapshot,
          jikanIncoming: newJikanSnapshot,
        })
      : buildReadingSyncDiffFields({
          malCurrent: currentMalSnapshot,
          malIncoming: newMalSnapshot,
          jikanCurrent: currentJikanSnapshot,
          jikanIncoming: newJikanSnapshot,
        });
    
    // Si des différences existent, ajouter à la queue
    if (fields.length > 0) {
      queue.push({
        id: String(entry.id),
        malId,
        title: String(entry.title),
        mediaType,
        fields,
      });
    }
  }
  
  return queue;
}

/**
 * Applique les changements sélectionnés pour une entrée
 */
export async function applyResyncChanges(
  supabase: SupabaseClient,
  entryId: string,
  mediaType: "anime" | "reading",
  selectedFieldIds: string[],
  newMalSnapshot: Record<string, unknown>,
  newJikanSnapshot: Record<string, unknown>
): Promise<void> {
  const tableName = mediaType === "anime" ? "library_anime" : "library_reading";
  
  // Récupérer l'entrée actuelle
  const { data: existing, error: existingError } = await supabase
    .from(tableName)
    .select("mal_official_snapshot, jikan_snapshot")
    .eq("id", entryId)
    .single();
  
  if (existingError || !existing) {
    throw new Error("Entrée introuvable.");
  }
  
  const currentMal = (existing.mal_official_snapshot ?? {}) as Record<string, unknown>;
  const currentJikan = (existing.jikan_snapshot ?? {}) as Record<string, unknown>;
  const currentJikanFull = (currentJikan.full ?? {}) as Record<string, unknown>;
  const newJikanFull = (newJikanSnapshot.full ?? {}) as Record<string, unknown>;
  
  // Merger sélectivement les champs
  const mergedMal = mergeBySelectedFields(currentMal, newMalSnapshot, selectedFieldIds);
  const mergedJikanFull = mergeBySelectedFields(currentJikanFull, newJikanFull, selectedFieldIds);
  const mergedJikan = {
    ...currentJikan,
    ...newJikanSnapshot,
    full: mergedJikanFull,
  };
  
  // Sauvegarder
  const { error: updateError } = await supabase
    .from(tableName)
    .update({
      mal_official_snapshot: mergedMal,
      jikan_snapshot: mergedJikan,
      updated_at: new Date().toISOString(),
    })
    .eq("id", entryId);
  
  if (updateError) {
    throw new Error(updateError.message);
  }
}

function mergeBySelectedFields(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  selectedFieldIds: string[]
): Record<string, unknown> {
  const merged = { ...current };
  
  if (selectedFieldIds.length === 0) {
    return merged;
  }
  
  // Mapper les fieldIds aux propriétés du snapshot
  const fieldMap: Record<string, string[]> = {
    title: ["title", "title_english", "title_japanese", "title_synonyms"],
    synopsis: ["synopsis", "background"],
    status: ["status"],
    score: ["score", "scored_by", "rank", "popularity", "members", "favorites"],
    chapters: ["chapters"],
    volumes: ["volumes"],
    episodes: ["episodes"],
    genres: ["genres"],
    themes: ["themes"],
    demographics: ["demographics"],
    aired: ["aired"],
    broadcast: ["broadcast"],
    producers: ["producers"],
    licensors: ["licensors"],
    studios: ["studios"],
    source: ["source"],
    duration: ["duration"],
    rating: ["rating"],
  };
  
  for (const fieldId of selectedFieldIds) {
    const props = fieldMap[fieldId] ?? [fieldId];
    for (const prop of props) {
      if (prop in incoming) {
        merged[prop] = incoming[prop];
      }
    }
  }
  
  return merged;
}

async function fetchMalData(malId: number, mediaType: "anime" | "reading"): Promise<Record<string, unknown> | null> {
  // TODO: Implémenter l'appel à l'API MAL si nécessaire
  // Pour l'instant, on se base uniquement sur Jikan
  return null;
}

async function fetchJikanData(malId: number, mediaType: "anime" | "reading"): Promise<Record<string, unknown> | null> {
  const endpoint = mediaType === "anime" 
    ? `https://api.jikan.moe/v4/anime/${malId}/full`
    : `https://api.jikan.moe/v4/manga/${malId}/full`;
  
  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      console.warn(`Jikan API returned ${response.status} for MAL ID ${malId}`);
      return null;
    }
    const json = await response.json() as { data?: Record<string, unknown> };
    return json.data ?? null;
  } catch (error) {
    console.warn(`Failed to fetch Jikan data for MAL ID ${malId}:`, error);
    return null;
  }
}
