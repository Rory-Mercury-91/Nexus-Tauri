/**
 * Aligné sur `src/services/library/readingProgressResolution.ts`.
 */

export type ReadingProgressSourceKey = "mal" | "anilist" | "mihon" | "nexus";

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

  if (nexRs != null && nexCh != null && maxRemoteCh != null && nexCh > maxRemoteCh) {
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

  if (nexWs != null && nexEp != null && maxRemoteEp != null && nexEp > maxRemoteEp) {
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
  patch: { read_status?: string | null; chapters_read?: number | null; updated_at?: string; [key: string]: unknown }
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

export function mergeWatchProgressBySource(
  existing: Record<string, unknown> | null | undefined,
  sourceKey: ReadingProgressSourceKey,
  patch: { watch_status?: string | null; episodes_watched?: number | null; updated_at?: string; [key: string]: unknown }
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
