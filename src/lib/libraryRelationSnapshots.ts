/**
 * Extraction des IDs liés (MAL + relations AniList stockées dans le snapshot) pour franchise / navigation.
 */

export type CollectRelatedIdsOptions = {
  /** IDs AniList des animés liés quand idMal est absent côté relation AniList. */
  animeAnilistIds?: Set<number>;
  /** IDs AniList des mangas liés quand idMal est absent. */
  readingAnilistIds?: Set<number>;
};

/**
 * Remplit les sets MAL (anime / lecture) et optionnellement les sets AniList à partir des snapshots Jikan + MAL/AniList.
 * `anilist_relations` est produit par sync-worker lors de l’import AniList-only (voir mergedSnapshot).
 */
export function collectRelatedIdsFromSnapshots(
  jikanSnapshot: Record<string, unknown>,
  malSnapshot: Record<string, unknown>,
  animeMalIds: Set<number>,
  readingMalIds: Set<number>,
  options?: CollectRelatedIdsOptions
): void {
  const full = (jikanSnapshot.full ?? jikanSnapshot.data ?? {}) as Record<string, unknown>;
  const jikanRelations = Array.isArray(full.relations) ? (full.relations as Array<Record<string, unknown>>) : [];
  jikanRelations.forEach((relation) => {
    const entries = Array.isArray(relation.entry) ? (relation.entry as Array<Record<string, unknown>>) : [];
    entries.forEach((entry) => {
      const entryId = Number(entry.mal_id);
      if (!Number.isFinite(entryId) || entryId <= 0) {
        return;
      }
      const entryType = String(entry.type ?? "").toLowerCase();
      if (entryType === "anime") {
        animeMalIds.add(entryId);
      } else if (entryType === "manga") {
        readingMalIds.add(entryId);
      }
    });
  });

  const malRelatedAnime = Array.isArray(malSnapshot.related_anime)
    ? (malSnapshot.related_anime as Array<{ node?: { id?: unknown } }>)
    : [];
  malRelatedAnime.forEach((relation) => {
    const entryId = Number(relation.node?.id);
    if (Number.isFinite(entryId) && entryId > 0) {
      animeMalIds.add(entryId);
    }
  });

  const malRelatedManga = Array.isArray(malSnapshot.related_manga)
    ? (malSnapshot.related_manga as Array<{ node?: { id?: unknown } }>)
    : [];
  malRelatedManga.forEach((relation) => {
    const entryId = Number(relation.node?.id);
    if (Number.isFinite(entryId) && entryId > 0) {
      readingMalIds.add(entryId);
    }
  });

  const aniAnime = options?.animeAnilistIds;
  const aniReading = options?.readingAnilistIds;
  const aniRels = Array.isArray(malSnapshot.anilist_relations)
    ? (malSnapshot.anilist_relations as Array<Record<string, unknown>>)
    : [];
  aniRels.forEach((rel) => {
    const idMal = Number(rel.idMal ?? rel.mal_id);
    const anilistId = Number(rel.id ?? rel.anilist_id);
    const typeRaw = String(rel.type ?? "").toUpperCase();
    if (Number.isFinite(idMal) && idMal > 0) {
      if (typeRaw === "ANIME") {
        animeMalIds.add(idMal);
      } else if (typeRaw === "MANGA") {
        readingMalIds.add(idMal);
      }
      return;
    }
    if (!aniAnime || !aniReading || !Number.isFinite(anilistId) || anilistId <= 0) {
      return;
    }
    if (typeRaw === "ANIME") {
      aniAnime.add(anilistId);
    } else if (typeRaw === "MANGA") {
      aniReading.add(anilistId);
    }
  });
}
