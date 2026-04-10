import type { JikanMalMini } from "./jikanTypes";

/** Types Jikan usuels pour les entrées « lecture » (manga, LN, etc.). */
const READING_LIKE = new Set([
  "manga",
  "novel",
  "light novel",
  "one-shot",
  "doujinshi",
  "manhwa",
  "manhua",
]);

/**
 * Route interne Nexus pour une entrée de relation Jikan (animé ↔ source / dérivés).
 * Retourne null si l’entrée n’est pas routée (ex. personnage, producteur).
 */
export function getNexusPathForJikanRelationEntry(
  entry: JikanMalMini
): string | null {
  const t = entry.type.toLowerCase();
  if (t === "anime") {
    return `/anime/${entry.mal_id}`;
  }
  if (READING_LIKE.has(t)) {
    return `/lectures/${entry.mal_id}`;
  }
  if (t.includes("novel")) {
    return `/lectures/${entry.mal_id}`;
  }
  return null;
}
