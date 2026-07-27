/**
 * Tools-layer-split — shared retry helper.
 *
 * Extracted verbatim from the module-scope `retryWithBackoff` in
 * `server/tools.ts` per the census "extract-as-ONE-module" rule (same rule
 * that produced `server/tools/lib/safe-fetch.ts`). It is consumed by BOTH the
 * legacy facade (still-legacy arms) AND migrated domain handlers (e.g. the web
 * domain's `firecrawl_crawl`), so it lives in a leaf lib module with no
 * dependencies — trivially acyclic. Body is byte-identical to the original.
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, opts?: { retries?: number; delayMs?: number; label?: string }): Promise<T> {
  const { retries = 2, delayMs = 1000, label = "operation" } = opts || {};
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (i < retries) {
        const wait = delayMs * Math.pow(2, i);
        console.warn(`[retry] ${label} attempt ${i + 1} failed: ${err.message?.slice(0, 120)}, retrying in ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}
