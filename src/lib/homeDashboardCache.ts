import type { FamilyMemberProfile } from "@/services/family/familyService";
import type { LibraryProgressSnapshot } from "@/services/dashboard/homeDashboardService";
import type {
  OneOffPurchaseRow,
  RecurringSubscriptionRow,
} from "@/services/subscriptions/subscriptionService";

const STORAGE_PREFIX = "nexus.homeDashboard.v1";
export const HOME_DASHBOARD_CACHE_TTL_MS = 300_000;

export type CachedHomeDashboardPayload = {
  recurring: RecurringSubscriptionRow[];
  oneOff: OneOffPurchaseRow[];
  profilesRecord: Record<string, FamilyMemberProfile>;
  memberIds: string[];
  readingVolumes: Array<{ ownerId: string; volumeCount: number; totalCost: number }>;
  libraryProgress: LibraryProgressSnapshot | null;
  cachedAt: number;
};

function key(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

function safeParse(raw: string | null): CachedHomeDashboardPayload | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as CachedHomeDashboardPayload;
    if (!value || typeof value.cachedAt !== "number") return null;
    if (!Array.isArray(value.recurring) || !Array.isArray(value.oneOff)) return null;
    if (!Array.isArray(value.memberIds) || !Array.isArray(value.readingVolumes)) return null;
    if (typeof value.profilesRecord !== "object" || value.profilesRecord === null) return null;
    return value;
  } catch {
    return null;
  }
}

export function getHomeDashboardCache(userId: string): CachedHomeDashboardPayload | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return safeParse(sessionStorage.getItem(key(userId)));
  } catch {
    return null;
  }
}

export function isHomeDashboardCacheFresh(
  payload: CachedHomeDashboardPayload,
  ttlMs: number = HOME_DASHBOARD_CACHE_TTL_MS
): boolean {
  return Date.now() - payload.cachedAt < ttlMs;
}

export function setHomeDashboardCache(
  userId: string,
  data: Omit<CachedHomeDashboardPayload, "cachedAt">
): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      key(userId),
      JSON.stringify({
        ...data,
        cachedAt: Date.now(),
      } satisfies CachedHomeDashboardPayload)
    );
  } catch {
    // Ignore silently (quota/private mode)
  }
}

