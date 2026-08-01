import crypto from "crypto";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<any>>();
const stats = { hits: 0, misses: 0, evictions: 0 };

const MAX_ENTRIES = 500;

function evictIfFull() {
  if (cache.size < MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of cache.entries()) {
    if (v.expiresAt < now) {
      cache.delete(k);
      stats.evictions++;
    }
  }
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
      stats.evictions++;
    }
  }
}

export function hashKey(parts: unknown[]): string {
  const canonical = JSON.stringify(parts, Object.keys(parts).sort());
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export async function cachedCall<T>(
  namespace: string,
  key: string | unknown[],
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const cacheKey = `${namespace}:${Array.isArray(key) ? hashKey(key) : key}`;
  const existing = cache.get(cacheKey);
  const now = Date.now();

  if (existing && existing.expiresAt > now) {
    stats.hits++;
    return existing.value as T;
  }

  stats.misses++;
  const value = await fn();
  evictIfFull();
  cache.set(cacheKey, { value, expiresAt: now + ttlMs });
  return value;
}

export function invalidateNamespace(namespace: string): number {
  let count = 0;
  const prefix = `${namespace}:`;
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) {
      cache.delete(k);
      count++;
    }
  }
  return count;
}

export function getCacheStats() {
  return {
    ...stats,
    size: cache.size,
    hitRate: stats.hits + stats.misses === 0 ? 0 : stats.hits / (stats.hits + stats.misses),
  };
}

export function clearAgenticCache(): void {
  cache.clear();
  stats.hits = 0;
  stats.misses = 0;
  stats.evictions = 0;
}
