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
  // Single-flight coalescing (architect 2026-08-03): concurrent identical
  // misses previously ALL invoked the provider before any result was cached —
  // an orchestrated fan-out of the same query became a synchronized provider
  // burst (rate-limit amplifier). First caller does the work; the rest await
  // the same promise. Cleared in finally so a rejected fn never wedges the key.
  const inflightKey = cacheKey;
  const existing2 = inflight.get(inflightKey);
  if (existing2) return existing2 as Promise<T>;
  const p = (async () => {
    const value = await fn();
    evictIfFull();
    cache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
    return value;
  })().finally(() => { inflight.delete(inflightKey); });
  inflight.set(inflightKey, p);
  return p;
}

const inflight = new Map<string, Promise<unknown>>();

// Targeted single-entry invalidation — used by cached wrappers that must not
// let a FAILED provider result (e.g. perplexity success:false after a 429)
// occupy a cache slot for the full TTL and suppress retries.
export function invalidateKey(namespace: string, key: string | unknown[]): boolean {
  const cacheKey = `${namespace}:${Array.isArray(key) ? hashKey(key) : key}`;
  return cache.delete(cacheKey);
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
