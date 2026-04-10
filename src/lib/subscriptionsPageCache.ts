import type { FamilyMemberProfile, FamilySummary } from "@/services/family/familyService";
import type {
  OneOffPurchaseRow,
  RecurringSubscriptionRow,
} from "@/services/subscriptions/subscriptionService";

const STORAGE_PREFIX = "nexus.subscriptionsPage.v1";
/** Durée de validité du cache (évite des allers-retours Supabase à chaque navigation). */
export const SUBSCRIPTIONS_PAGE_CACHE_TTL_MS = 120_000;

export type CachedSubscriptionsPagePayload = {
  families: FamilySummary[];
  recurring: RecurringSubscriptionRow[];
  oneOff: OneOffPurchaseRow[];
  sites: string[];
  profilesRecord: Record<string, FamilyMemberProfile>;
  cachedAt: number;
};

function key(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

function safeParse(raw: string | null): CachedSubscriptionsPagePayload | null {
  if (!raw) {
    return null;
  }
  try {
    const v = JSON.parse(raw) as CachedSubscriptionsPagePayload;
    if (
      !v ||
      typeof v.cachedAt !== "number" ||
      !Array.isArray(v.families) ||
      !Array.isArray(v.recurring) ||
      !Array.isArray(v.oneOff) ||
      !Array.isArray(v.sites) ||
      typeof v.profilesRecord !== "object" ||
      v.profilesRecord === null
    ) {
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

export function getSubscriptionsPageCache(
  userId: string
): CachedSubscriptionsPagePayload | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }
  try {
    return safeParse(sessionStorage.getItem(key(userId)));
  } catch {
    return null;
  }
}

export function isSubscriptionsCacheFresh(
  payload: CachedSubscriptionsPagePayload,
  ttlMs: number = SUBSCRIPTIONS_PAGE_CACHE_TTL_MS
): boolean {
  return Date.now() - payload.cachedAt < ttlMs;
}

export function setSubscriptionsPageCache(
  userId: string,
  data: Omit<CachedSubscriptionsPagePayload, "cachedAt">
): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  try {
    const payload: CachedSubscriptionsPagePayload = {
      ...data,
      cachedAt: Date.now(),
    };
    sessionStorage.setItem(key(userId), JSON.stringify(payload));
  } catch {
    // Quota ou mode privé : ignorer silencieusement
  }
}

/** Après création / mise à jour / suppression côté Supabase. */
export function invalidateSubscriptionsPageCache(userId: string): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  try {
    sessionStorage.removeItem(key(userId));
  } catch {
    /* ignore */
  }
}
