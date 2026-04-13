import type { FullReadingDiagnosticsResult } from "@/services/library/readingListDiagnosticsService";
import type { FamilyMemberWithRole } from "@/services/family/familyService";

const PREFIX = "nexus:settings:";

const READING_LIST_DIAGNOSTICS = `${PREFIX}readingListDiagnostics:v1`;
const SECURITY_LOGS = `${PREFIX}securityLogs:v1`;
const MIHON_INDEX_STATS = `${PREFIX}mihonIndexStats:v1`;
const FAMILY_PANEL = `${PREFIX}familyPanel:v1`;

/** Durée de réutilisation des journaux sans refetch automatique (changement d’onglet). */
export const SECURITY_LOGS_CACHE_TTL_MS = 120_000;
/** Index MIHON : stats locales, TTL plus long. */
export const MIHON_INDEX_CACHE_TTL_MS = 300_000;
/** Foyer : évite de recharger à chaque retour sur l’onglet. */
export const FAMILY_PANEL_CACHE_TTL_MS = 300_000;

type ReadingDiagEnvelope = {
  userId: string;
  cachedAt: number;
  payload: FullReadingDiagnosticsResult;
};

export function readReadingListDiagnosticsCache(
  userId: string
): { payload: FullReadingDiagnosticsResult; cachedAt: number } | null {
  if (!userId) return null;
  try {
    const raw = sessionStorage.getItem(READING_LIST_DIAGNOSTICS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReadingDiagEnvelope;
    if (parsed.userId !== userId || !parsed.payload) return null;
    return { payload: parsed.payload, cachedAt: parsed.cachedAt };
  } catch {
    return null;
  }
}

export function writeReadingListDiagnosticsCache(
  userId: string,
  payload: FullReadingDiagnosticsResult
): void {
  if (!userId) return;
  try {
    const env: ReadingDiagEnvelope = {
      userId,
      cachedAt: Date.now(),
      payload,
    };
    sessionStorage.setItem(READING_LIST_DIAGNOSTICS, JSON.stringify(env));
  } catch {
    // quota
  }
}

export type SecurityLogItemCache = {
  id: string;
  at: string;
  level: "error" | "warn" | "info";
  source: "client" | "supabase-sync";
  scope: string;
  message: string;
};

type SecurityLogsEnvelope = {
  userId: string;
  cachedAt: number;
  items: SecurityLogItemCache[];
};

export function readSecurityLogsCache(
  userId: string
): { items: SecurityLogItemCache[]; cachedAt: number } | null {
  if (!userId) return null;
  try {
    const raw = sessionStorage.getItem(SECURITY_LOGS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SecurityLogsEnvelope;
    if (parsed.userId !== userId || !Array.isArray(parsed.items)) return null;
    return { items: parsed.items, cachedAt: parsed.cachedAt };
  } catch {
    return null;
  }
}

export function writeSecurityLogsCache(userId: string, items: SecurityLogItemCache[]): void {
  if (!userId) return;
  try {
    const env: SecurityLogsEnvelope = {
      userId,
      cachedAt: Date.now(),
      items,
    };
    sessionStorage.setItem(SECURITY_LOGS, JSON.stringify(env));
  } catch {
    // ignore
  }
}

type MihonStatsEnvelope = {
  userId: string;
  cachedAt: number;
  stats: { total: number; lastFetchedAt: string | null };
};

export function readMihonIndexStatsCache(
  userId: string
): { stats: { total: number; lastFetchedAt: string | null }; cachedAt: number } | null {
  if (!userId) return null;
  try {
    const raw = sessionStorage.getItem(MIHON_INDEX_STATS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MihonStatsEnvelope;
    if (parsed.userId !== userId || !parsed.stats) return null;
    return { stats: parsed.stats, cachedAt: parsed.cachedAt };
  } catch {
    return null;
  }
}

export function writeMihonIndexStatsCache(
  userId: string,
  stats: { total: number; lastFetchedAt: string | null }
): void {
  if (!userId) return;
  try {
    const env: MihonStatsEnvelope = {
      userId,
      cachedAt: Date.now(),
      stats,
    };
    sessionStorage.setItem(MIHON_INDEX_STATS, JSON.stringify(env));
  } catch {
    // ignore
  }
}

export type FamilySettingsCachePayload = {
  adminFamilyId: string | null;
  visibleFamilyId: string | null;
  familyName: string;
  members: FamilyMemberWithRole[];
};

type FamilyEnvelope = {
  userId: string;
  cachedAt: number;
} & FamilySettingsCachePayload;

export function readFamilySettingsCache(
  userId: string
): { payload: FamilySettingsCachePayload; cachedAt: number } | null {
  if (!userId) return null;
  try {
    const raw = sessionStorage.getItem(FAMILY_PANEL);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FamilyEnvelope;
    if (parsed.userId !== userId) return null;
    return {
      cachedAt: parsed.cachedAt,
      payload: {
        adminFamilyId: parsed.adminFamilyId,
        visibleFamilyId: parsed.visibleFamilyId,
        familyName: parsed.familyName,
        members: parsed.members ?? [],
      },
    };
  } catch {
    return null;
  }
}

export function writeFamilySettingsCache(userId: string, payload: FamilySettingsCachePayload): void {
  if (!userId) return;
  try {
    const env: FamilyEnvelope = {
      userId,
      cachedAt: Date.now(),
      ...payload,
    };
    sessionStorage.setItem(FAMILY_PANEL, JSON.stringify(env));
  } catch {
    // ignore
  }
}
