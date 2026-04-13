/** Plage d’ids MAL locaux (fiches manuelles), non valides sur les API MAL / AniList. */
const MAL_SYNTHETIC_MIN = 1_900_000_000;
const MAL_SYNTHETIC_MAX = 2_100_000_000;

export function isMalSyntheticId(id: number): boolean {
  return Number.isFinite(id) && id >= MAL_SYNTHETIC_MIN && id <= MAL_SYNTHETIC_MAX;
}
