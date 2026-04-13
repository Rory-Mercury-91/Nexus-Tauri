/**
 * Progression lecture / visionnage multi-sources (MAL, AniList, Mihon, Nexus).
 *
 * Règles d’affichage (statut canonique) :
 * 1. Si la tranche Nexus a une progression mesurée (chapitres / épisodes) **strictement supérieure**
 *    au max(MAL, AniList), le statut Nexus prime.
 * 2. Sinon : statut MAL s’il existe, sinon AniList, sinon Mihon **uniquement** si ni MAL ni AniList n’ont de statut,
 *    sinon statut Nexus (édition locale sans conflit de progression mesurable).
 *
 * La colonne `profiles.library_list_status_priority` est conservée pour d’éventuelles extensions ;
 * la résolution canonique ne suit plus une simple liste ordonnée.
 */

/** Clés reconnues dans `reading_progress_by_source` / `watch_progress_by_source` (JSON). */
export type ReadingProgressSourceKey = "mal" | "anilist" | "mihon" | "nexus";

export type ReadingProgressSourceSlice = {
  read_status?: string | null;
  /** Chapitres lus (manga) — comparaison avec MAL / AniList. */
  chapters_read?: number | null;
  /** Horodatage ISO de la dernière écriture pour cette source. */
  updated_at?: string | null;
  [key: string]: unknown;
};

export type WatchProgressSourceSlice = {
  watch_status?: string | null;
  /** Épisodes vus — comparaison avec MAL / AniList. */
  episodes_watched?: number | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

/** @deprecated Ordre historique ; la résolution utilise les règles ci-dessus. */
export const DEFAULT_LIBRARY_LIST_STATUS_PRIORITY: ReadingProgressSourceKey[] = [
  "mal",
  "anilist",
  "mihon",
  "nexus",
];

export function mapAnilistMediaListStatusToMalCodes(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") {
    return null;
  }
  const u = raw.trim().toUpperCase();
  switch (u) {
    case "CURRENT":
      return "reading";
    case "PLANNING":
      return "plan_to_read";
    case "COMPLETED":
      return "completed";
    case "DROPPED":
      return "dropped";
    case "PAUSED":
      return "on_hold";
    case "REPEATING":
      return "reading";
    default:
      return null;
  }
}

export function mapAnilistMediaListStatusToWatchCodes(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") {
    return null;
  }
  const u = raw.trim().toUpperCase();
  switch (u) {
    case "CURRENT":
      return "watching";
    case "PLANNING":
      return "plan_to_watch";
    case "COMPLETED":
      return "completed";
    case "DROPPED":
      return "dropped";
    case "PAUSED":
      return "on_hold";
    case "REPEATING":
      return "watching";
    default:
      return null;
  }
}

function strField(slice: unknown, key: string): string | null {
  if (!slice || typeof slice !== "object" || Array.isArray(slice)) {
    return null;
  }
  const v = (slice as Record<string, unknown>)[key];
  if (typeof v !== "string" || v.trim().length === 0) {
    return null;
  }
  return v.trim();
}

function numField(slice: unknown, key: string): number | null {
  if (!slice || typeof slice !== "object" || Array.isArray(slice)) {
    return null;
  }
  const v = (slice as Record<string, unknown>)[key];
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Premier nombre fini parmi les candidats (progression pour comparaison Nexus). */
export function coalesceFirstFiniteNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) {
        return n;
      }
    }
  }
  return null;
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null && b == null) {
    return null;
  }
  if (a == null) {
    return b;
  }
  if (b == null) {
    return a;
  }
  return Math.max(a, b);
}

/**
 * Statut lecture canonique (voir règles en tête de fichier).
 * `priority` est ignoré (rétrocompat d’appel).
 */
export function resolveCanonicalReadStatus(
  bySource: Record<string, unknown> | null | undefined,
  _priority?: readonly string[]
): string | null {
  const src = bySource && typeof bySource === "object" ? bySource : {};
  const mal = src.mal;
  const ani = src.anilist;
  const mih = src.mihon;
  const nex = src.nexus;

  const malRs = strField(mal, "read_status");
  const aniRs = strField(ani, "read_status");
  const mihRs = strField(mih, "read_status");
  const nexRs = strField(nex, "read_status");

  const malCh = numField(mal, "chapters_read");
  const aniCh = numField(ani, "chapters_read");
  const nexCh = numField(nex, "chapters_read");
  const maxRemoteCh = maxNullable(malCh, aniCh);

  if (
    nexRs != null &&
    nexCh != null &&
    maxRemoteCh != null &&
    nexCh > maxRemoteCh
  ) {
    return nexRs;
  }

  if (malRs) {
    return malRs;
  }
  if (aniRs) {
    return aniRs;
  }
  if (!malRs && !aniRs && mihRs) {
    return mihRs;
  }
  if (nexRs) {
    return nexRs;
  }
  return null;
}

/**
 * Statut visionnage animé (même logique, champs `watch_status` / `episodes_watched`).
 */
export function resolveCanonicalWatchStatus(
  bySource: Record<string, unknown> | null | undefined,
  _priority?: readonly string[]
): string | null {
  const src = bySource && typeof bySource === "object" ? bySource : {};
  const mal = src.mal;
  const ani = src.anilist;
  const mih = src.mihon;
  const nex = src.nexus;

  const malWs = strField(mal, "watch_status");
  const aniWs = strField(ani, "watch_status");
  const mihWs = strField(mih, "watch_status");
  const nexWs = strField(nex, "watch_status");

  const malEp = numField(mal, "episodes_watched");
  const aniEp = numField(ani, "episodes_watched");
  const nexEp = numField(nex, "episodes_watched");
  const maxRemoteEp = maxNullable(malEp, aniEp);

  if (
    nexWs != null &&
    nexEp != null &&
    maxRemoteEp != null &&
    nexEp > maxRemoteEp
  ) {
    return nexWs;
  }

  if (malWs) {
    return malWs;
  }
  if (aniWs) {
    return aniWs;
  }
  if (!malWs && !aniWs && mihWs) {
    return mihWs;
  }
  if (nexWs) {
    return nexWs;
  }
  return null;
}

export function mergeReadingProgressBySource(
  existing: Record<string, unknown> | null | undefined,
  sourceKey: ReadingProgressSourceKey,
  patch: ReadingProgressSourceSlice
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...existing }
      : {};
  const prevSlice =
    base[sourceKey] && typeof base[sourceKey] === "object" && !Array.isArray(base[sourceKey])
      ? (base[sourceKey] as Record<string, unknown>)
      : {};
  base[sourceKey] = {
    ...prevSlice,
    ...patch,
    updated_at: patch.updated_at ?? new Date().toISOString(),
  };
  return base;
}

/** Ligne de liste au format MAL (priorité à `list_entry_by_source.mal` si présent). */
function getMalShapedListEntryFromSnapshot(
  snap: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const bySource = snap?.list_entry_by_source as Record<string, unknown> | undefined;
  const fromMal = bySource?.mal;
  if (fromMal && typeof fromMal === "object" && !Array.isArray(fromMal)) {
    return fromMal as Record<string, unknown>;
  }
  const legacy = snap?.list_entry as Record<string, unknown> | undefined;
  return legacy;
}

/** Chapitres lus depuis le snapshot MAL OAuth (liste utilisateur). */
export function extractNumChaptersReadFromMalOfficialSnapshot(
  malOfficialSnapshot: unknown
): number | null {
  const snap = malOfficialSnapshot as Record<string, unknown> | undefined;
  const listEntry = getMalShapedListEntryFromSnapshot(snap);
  const listStatus = listEntry?.list_status as Record<string, unknown> | undefined;
  const n = listStatus?.num_chapters_read;
  if (typeof n === "number" && Number.isFinite(n)) {
    return n;
  }
  if (typeof n === "string" && n.trim() !== "") {
    const x = Number(n);
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

/** Épisodes vus depuis le snapshot MAL OAuth (liste animé). */
export function extractNumEpisodesWatchedFromMalOfficialSnapshot(
  malOfficialSnapshot: unknown
): number | null {
  const snap = malOfficialSnapshot as Record<string, unknown> | undefined;
  const listEntry = getMalShapedListEntryFromSnapshot(snap);
  const listStatus = listEntry?.list_status as Record<string, unknown> | undefined;
  const n = listStatus?.num_episodes_watched;
  if (typeof n === "number" && Number.isFinite(n)) {
    return n;
  }
  if (typeof n === "string" && n.trim() !== "") {
    const x = Number(n);
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

export function mergeWatchProgressBySource(
  existing: Record<string, unknown> | null | undefined,
  sourceKey: ReadingProgressSourceKey,
  patch: WatchProgressSourceSlice
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...existing }
      : {};
  const prevSlice =
    base[sourceKey] && typeof base[sourceKey] === "object" && !Array.isArray(base[sourceKey])
      ? (base[sourceKey] as Record<string, unknown>)
      : {};
  base[sourceKey] = {
    ...prevSlice,
    ...patch,
    updated_at: patch.updated_at ?? new Date().toISOString(),
  };
  return base;
}
