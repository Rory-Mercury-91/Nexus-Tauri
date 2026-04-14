import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAnimeSyncDiffFields, buildReadingSyncDiffFields, type SyncDiffField } from "./syncDiffService";

export type ResyncQueueEntry = {
  id: string;
  malId: number;
  title: string;
  mediaType: "anime" | "reading";
  fields: SyncDiffField[];
};

// Interface pour typer proprement le retour de Supabase
interface LibraryEntry {
  id: string;
  title: string;
  mal_official_snapshot: Record<string, unknown> | null;
  jikan_snapshot: Record<string, unknown> | null;
  mal_id?: number;
  mal_manga_id?: number;
}

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
    .select(`id, title, mal_official_snapshot, jikan_snapshot, ${malIdCol}`)
    .eq("user_id", userId);
  
  if (error) {
    throw new Error(error.message);
  }
  
  // On force le type ici pour éviter l'erreur GenericStringError
  const entries = (data as unknown as LibraryEntry[]) ?? [];
  const queue: ResyncQueueEntry[] = [];
  
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    // Accès sécurisé à l'ID MAL selon le type de média
    const malId = mediaType === "anime" ? entry.mal_id : entry.mal_manga_id;
    
    if (!malId || !Number.isFinite(malId) || malId <= 0) {
      continue;
    }
    
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    
const [malData, jikanData] = await Promise.all([
  source === "mal" ? fetchMalData(malId, mediaType) : null,
  fetchJikanData(malId, mediaType),
]);

// On continue seulement si on a reçu des données d'une des deux sources
if (!malData && !jikanData) {
  continue;
}

const currentMalSnapshot = (entry.mal_official_snapshot ?? {}) as Record<string, unknown>;
const newMalSnapshot = malData ? { ...currentMalSnapshot, ...malData } : currentMalSnapshot;

// Détecter les différences
// Note : On ne construit plus les snapshots Jikan ici car ils ne sont pas acceptés 
// par buildAnimeSyncDiffFields/buildReadingSyncDiffFields pour le moment.
const fields = mediaType === "anime"
  ? buildAnimeSyncDiffFields({
      malSnapshot: currentMalSnapshot,
      liveFull: newMalSnapshot,
    })
  : buildReadingSyncDiffFields({
      dbRow: currentMalSnapshot,
      livePayload: newMalSnapshot,
    });
    
    if (fields.length > 0) {
      queue.push({
        id: entry.id,
        malId,
        title: entry.title,
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
  
  const { data, error: existingError } = await supabase
    .from(tableName)
    .select("mal_official_snapshot, jikan_snapshot")
    .eq("id", entryId)
    .single();
  
  if (existingError || !data) {
    throw new Error("Entrée introuvable.");
  }

  const existing = data as LibraryEntry;
  
  const currentMal = (existing.mal_official_snapshot ?? {}) as Record<string, unknown>;
  const currentJikan = (existing.jikan_snapshot ?? {}) as Record<string, unknown>;
  const currentJikanFull = (currentJikan.full ?? {}) as Record<string, unknown>;
  const newJikanFull = (newJikanSnapshot.full ?? {}) as Record<string, unknown>;
  
  const mergedMal = mergeBySelectedFields(currentMal, newMalSnapshot, selectedFieldIds);
  const mergedJikanFull = mergeBySelectedFields(currentJikanFull, newJikanFull, selectedFieldIds);
  const mergedJikan = {
    ...currentJikan,
    ...newJikanSnapshot,
    full: mergedJikanFull,
  };
  
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

/**
 * TODO: implémenter l'appel MAL OAuth via Supabase Edge Function lorsque
 * l'endpoint `/users/@me/animelist` ou `/manga/${malId}` sera exposé.
 * Pour l'instant, seule la source Jikan (publique) est utilisée.
 */
async function fetchMalData(_malId: number, _mediaType: "anime" | "reading"): Promise<Record<string, unknown> | null> {
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