export type CollectionStamp = {
  latestUpdatedAt: string | null;
  count: number;
};

type CachedCollectionPayload<T> = {
  version: 1;
  cachedAt: string;
  stamp: CollectionStamp;
  items: T[];
};

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore silencieusement (quota, mode privé, etc.)
  }
}

export function readCachedCollection<T>(cacheKey: string): CachedCollectionPayload<T> | null {
  const payload = readJson<CachedCollectionPayload<T>>(cacheKey);
  if (!payload || payload.version !== 1 || !Array.isArray(payload.items)) {
    return null;
  }
  return payload;
}

export function writeCachedCollection<T>(
  cacheKey: string,
  items: T[],
  stamp: CollectionStamp
): void {
  const payload: CachedCollectionPayload<T> = {
    version: 1,
    cachedAt: new Date().toISOString(),
    stamp,
    items,
  };
  writeJson(cacheKey, payload);
}

export function isSameCollectionStamp(a: CollectionStamp | null, b: CollectionStamp | null): boolean {
  if (!a || !b) {
    return false;
  }
  return a.latestUpdatedAt === b.latestUpdatedAt && a.count === b.count;
}

