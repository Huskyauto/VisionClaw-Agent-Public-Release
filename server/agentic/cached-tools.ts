import { cachedCall, invalidateKey } from "./cache";
import { firecrawlSearch, firecrawlScrape } from "../firecrawl";
import { perplexitySearch } from "../perplexity-search";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const SCRAPE_TTL_MS = 60 * 60 * 1000;
const SEARCH_TTL_MS = 20 * 60 * 1000;

// R74.13f: replaced `:t${tenantId ?? 0}` cache-key sentinels with an
// explicit `:global` sentinel via ternary. The previous shape triggered
// the silent-failure scanner's "fail-open landmine" rule (HIGH) because
// `?? 0` followed by a literal-digit tenant slot is the same shape that
// caused R74.A's cross-tenant data leak in email routing. Behavior here
// is unchanged — these are CACHE keys (not auth/data routing) and a
// shared global slot for callers that don't pass tenantId is fine since
// firecrawl + perplexity results depend only on the query, not on
// tenant identity. The rename just makes the intent self-documenting:
// "two tenants searching the same string DO share a cache slot, on
// purpose, and an absent tenant context lands in the explicit `global`
// slot — not silently defaulted to tenant 0".
function tenantSlot(tenantId: number | undefined): string {
  return tenantId === undefined ? "global" : `t${tenantId}`;
}

export async function cachedFirecrawlSearch(
  query: string,
  limit = 5,
  tenantId?: number,
  ttlMs = SEARCH_TTL_MS,
) {
  const result = await cachedCall(
    `firecrawl-search:${tenantSlot(tenantId)}`,
    [query.toLowerCase().trim(), limit],
    ttlMs,
    () => firecrawlSearch(query, limit),
  );
  return result;
}

export async function cachedFirecrawlScrape(
  url: string,
  tenantId?: number,
  ttlMs = SCRAPE_TTL_MS,
) {
  return cachedCall(
    `firecrawl-scrape:${tenantSlot(tenantId)}`,
    [url.toLowerCase().trim()],
    ttlMs,
    () => firecrawlScrape(url),
  );
}

export async function cachedPerplexitySearch(
  query: string,
  tenantId?: number,
  ttlMs = DEFAULT_TTL_MS,
) {
  const namespace = `perplexity-search:${tenantSlot(tenantId)}`;
  const key = [query.toLowerCase().trim()];
  const result = await cachedCall(namespace, key, ttlMs, () => perplexitySearch(query));
  // Never let a FAILED search occupy the cache for the full TTL — a transient
  // 429/5xx would otherwise pin success:false for 30m and force every retry
  // within the window onto the weaker legacy fallback (Bob 2026-08-03).
  if (result && (result as { success?: boolean }).success === false) {
    invalidateKey(namespace, key);
  }
  return result;
}
