/**
 * URLs publiques des fiches manga sur MAL / AniList (aperçu navigateur).
 */
export function getMalMangaCatalogUrl(malMangaId: number): string | null {
  if (!Number.isFinite(malMangaId) || malMangaId <= 0) {
    return null;
  }
  return `https://myanimelist.net/manga/${malMangaId}`;
}

export function getAnilistMangaCatalogUrl(anilistMediaId: number | null): string | null {
  if (anilistMediaId == null || !Number.isFinite(anilistMediaId) || anilistMediaId <= 0) {
    return null;
  }
  return `https://anilist.co/manga/${anilistMediaId}`;
}
