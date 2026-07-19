/**
 * Tools-layer-split S9 — web-domain migrated handlers.
 *
 * Selection per plan.md smallest-safe-batch precedent: the 8 web tools with
 * clean trust needs migrate — `web_fetch`, `web_search`, and the R125+35
 * public-API live-data pack (`fetch_weather`, `fetch_crypto_price`,
 * `fetch_exchange_rate`, `fetch_wikipedia`, `fetch_hacker_news`,
 * `lookup_ip_geo`; fetch_wikipedia was S8's declared stay-legacy — it moves
 * NOW because it shares the pack's single arm body). None read tenant/persona
 * context. The scholarly-search cluster (`academic_search` + the 4 per-source
 * arms `arxiv_search` / `pubmed_search` / `openalex_search` /
 * `crossref_lookup`) migrated in a LATER web slice via the shared
 * `academicSearchDispatch(name, params)` arm — a byte-identical move of the
 * legacy fall-through case (only the two dynamic-import paths adjusted for
 * depth); none read tenant/persona context. The Firecrawl/readability cluster
 * (`firecrawl_search` / `firecrawl_scrape` / `readability_extract` /
 * `firecrawl_crawl` / `firecrawl_map`) migrated in a still-later slice as
 * mechanical moves: `firecrawl_scrape` / `firecrawl_crawl` read tenant context
 * (`params._tenantId`→`ctx.tenantId`, same fail-closed guard); `firecrawl_scrape`
 * keeps its exact web_fetch fallback by CALL-TIME importing the facade
 * `executeTool` (dynamic — no static cycle; same precedent as security's
 * `TOOL_DEFINITIONS` import); `firecrawl_crawl` uses the shared retry helper
 * extracted to `../../lib/retry` (census extract-as-one-module, still consumed
 * by a legacy arm too). Remaining web-adjacent mixed tools (browser/camofox
 * tools, template_scrape / scraped_pages_*, deep_research, generate_design_doc)
 * stay in the legacy switch for later slices.
 *
 * The module-scope helpers `webFetch`, `webSearchLegacy`, and `webSearch`
 * moved here with their handlers (census-verified: helper-census.md "Web"
 * group + `webSearch` "moves with the web domain slice"). `webSearch` is
 * EXPORTED because the legacy `firecrawl_search` arm still uses it as its
 * no-Firecrawl / empty-result fallback (facade → domain import; the reverse
 * is forbidden). The SSRF cluster they consume was extracted as ONE module to
 * `server/tools/lib/safe-fetch.ts` per the census rule — never split.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change). App-module imports are DYNAMIC
 * (call-time), mirroring the legacy arms and preserving the package acyclic
 * static import graph.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { isUrlSafe, safeFetchFollowRedirects } from "../../lib/safe-fetch";
import { retryWithBackoff } from "../../lib/retry";
import {
  webFetchDefinition,
  webSearchDefinition,
  fetchWeatherDefinition,
  fetchCryptoPriceDefinition,
  fetchExchangeRateDefinition,
  fetchWikipediaDefinition,
  fetchHackerNewsDefinition,
  lookupIpGeoDefinition,
  academicSearchDefinition,
  arxivSearchDefinition,
  pubmedSearchDefinition,
  openalexSearchDefinition,
  crossrefLookupDefinition,
  firecrawlSearchDefinition,
  firecrawlScrapeDefinition,
  readabilityExtractDefinition,
  firecrawlCrawlDefinition,
  firecrawlMapDefinition,
  scrapedPagesQueryDefinition,
  scrapedPageReadDefinition,
  scrapedPagesDeleteDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Module-scope helpers moved from server/tools.ts (webFetch/webSearchLegacy:
// legacy switch was the only caller; webSearch: also the legacy
// firecrawl_search fallback, which now imports it from here). Bodies verbatim
// except: firecrawl/perplexity/external-content-security imports are
// call-time dynamic (package acyclicity); isUrlSafe/safeFetchFollowRedirects
// come from ../../lib/safe-fetch (S9 extraction).
// ---------------------------------------------------------------------------

async function webFetch(url: string) {
  const check = await isUrlSafe(url);
  if (!check.safe) return { success: false, url, error: check.error };

  const { wrapExternalContent } = await import("../../../external-content-security");

  let extractionMethod = "defuddle";

  // R125+13 — Tier 0: defuddle (kepano/obsidian-skills, agentskills.io spec).
  // Local linkedom-based extractor — no API key, no per-call cost, no external
  // network dependency for the parse step itself. Typical 60–80% token reduction
  // on cluttered article pages vs raw HTML. Uses our SSRF-safe redirect-follower
  // for the fetch so isUrlSafe is honoured on every hop. Falls through to the
  // Jina (Tier 1) → Firecrawl (Tier 2) → basic HTML (Tier 3) cascade if the
  // page is JS-heavy / bot-protected / yields <300 chars of cleaned content.
  try {
    const { getRealisticHeaders } = await import("../../../lib/realistic-headers");
    const headers = await getRealisticHeaders({ url, acceptOverride: "text/html,application/xhtml+xml" });
    const resp = await safeFetchFollowRedirects(url, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ctype = resp.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml/i.test(ctype)) {
      throw new Error(`Non-HTML content-type ${ctype.slice(0, 40)}`);
    }
    const html = await resp.text();
    const { Defuddle } = await import("defuddle/node");
    // Convert HTML → markdown via defuddle. String input path uses linkedom
    // (NOT jsdom — no script-execution concerns per replit.md gotcha).
    const parsed: any = await Defuddle(html, url, { markdown: true });
    const md = String(parsed?.content || "").trim();
    if (md.length < 300) throw new Error(`Defuddle returned insufficient content (${md.length} chars)`);
    const truncated = md.slice(0, 8000);
    const { wrapped, suspicious } = wrapExternalContent(truncated, "web_fetch", { url });
    if (suspicious.length > 0) {
      console.log(`[security] Suspicious patterns in defuddle content from ${url}:`, suspicious.map(s => s.label));
    }
    return {
      success: true, url, content: wrapped,
      truncated: md.length > 8000,
      suspiciousPatterns: suspicious.length,
      extractionMethod,
      title: parsed?.title || undefined,
      byline: parsed?.author || undefined,
      wordCount: parsed?.wordCount || undefined,
    };
  } catch (defuddleErr: any) {
    console.log(`[web_fetch] Defuddle failed for ${url}: ${defuddleErr.message}`);
  }

  extractionMethod = "readability";
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const resp = await fetch(jinaUrl, {
      headers: { "Accept": "text/plain", "X-Return-Format": "text" },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`Jina HTTP ${resp.status}`);
    const text = await resp.text();
    if (text.trim().length < 100) throw new Error("Readability returned insufficient content");
    const truncated = text.slice(0, 8000);
    const { wrapped, suspicious } = wrapExternalContent(truncated, "web_fetch", { url });
    if (suspicious.length > 0) {
      console.log(`[security] Suspicious patterns in fetched content from ${url}:`, suspicious.map(s => s.label));
    }
    return { success: true, url, content: wrapped, truncated: text.length > 8000, suspiciousPatterns: suspicious.length, extractionMethod };
  } catch (jinaErr: any) {
    console.log(`[web_fetch] Readability failed for ${url}: ${jinaErr.message}`);
  }

  const { isFirecrawlAvailable, firecrawlScrape } = await import("../../../firecrawl");
  if (isFirecrawlAvailable()) {
    extractionMethod = "firecrawl";
    try {
      const result = await firecrawlScrape(url);
      if (result.success && result.content) {
        const truncated = result.content.slice(0, 8000);
        const { wrapped, suspicious } = wrapExternalContent(truncated, "web_fetch", { url });
        if (suspicious.length > 0) {
          console.log(`[security] Suspicious patterns in Firecrawl content from ${url}:`, suspicious.map(s => s.label));
        }
        return {
          success: true, url, content: wrapped,
          truncated: result.content.length > 8000,
          suspiciousPatterns: suspicious.length,
          extractionMethod,
          cached: result.cached || false,
          title: result.title,
        };
      }
      console.log(`[web_fetch] Firecrawl failed for ${url}: ${result.error}`);
    } catch (fcErr: any) {
      console.log(`[web_fetch] Firecrawl error for ${url}: ${fcErr.message}`);
    }
  }

  extractionMethod = "basic";
  try {
    const { getRealisticHeaders } = await import("../../../lib/realistic-headers");
    const headers = await getRealisticHeaders({ url, acceptOverride: "text/html,text/plain,application/json" });
    const resp = await safeFetchFollowRedirects(url, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    const cleaned = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
    const truncated = cleaned.slice(0, 8000);
    const { wrapped, suspicious } = wrapExternalContent(truncated, "web_fetch", { url });
    if (suspicious.length > 0) {
      console.log(`[security] Suspicious patterns in basic-fetched content from ${url}:`, suspicious.map(s => s.label));
    }
    return { success: true, url, content: wrapped, truncated: cleaned.length > 8000, suspiciousPatterns: suspicious.length, extractionMethod };
  } catch (basicErr: any) {
    return { success: false, url, error: `All extraction methods failed. Last: ${basicErr.message}`, extractionMethod: "none" };
  }
}

async function webSearchLegacy(query: string) {
  const { wrapExternalContent } = await import("../../../external-content-security");
  const results: { source: string; content: string }[] = [];

  try {
    const wikiQuery = encodeURIComponent(query);
    const wikiResp = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${wikiQuery}&format=json&srlimit=3&utf8=`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (wikiResp.ok) {
      const wikiData = await wikiResp.json();
      const wikiResults = wikiData?.query?.search || [];
      for (const r of wikiResults) {
        const snippet = r.snippet?.replace(/<[^>]*>/g, "") || "";
        results.push({ source: `Wikipedia: ${r.title}`, content: `${snippet} — https://en.wikipedia.org/wiki/${encodeURIComponent(r.title)}` });
      }
    }
  } catch (_silentErr) { const { logSilentCatch } = await import("../../../lib/silent-catch"); logSilentCatch("server/tools/domains/web/handlers.ts", _silentErr); }

  try {
    const jinaUrl = `https://s.jina.ai/${encodeURIComponent(query)}`;
    const jinaResp = await fetch(jinaUrl, {
      headers: { "Accept": "text/plain", "X-Return-Format": "text" },
      signal: AbortSignal.timeout(12000),
    });
    if (jinaResp.ok) {
      const text = await jinaResp.text();
      results.push({ source: "Web Search", content: text.slice(0, 5000) });
    }
  } catch (_silentErr) { const { logSilentCatch } = await import("../../../lib/silent-catch"); logSilentCatch("server/tools/domains/web/handlers.ts", _silentErr); }

  if (results.length === 0) {
    return { success: false, query, error: "No results found", provider: "legacy" };
  }

  const wrappedResults = results.map(r => {
    const { wrapped } = wrapExternalContent(r.content, "web_search");
    return { source: r.source, content: wrapped };
  });

  return { success: true, query, resultCount: wrappedResults.length, results: wrappedResults, provider: "legacy" };
}

export async function webSearch(query: string) {
  const { isPerplexityAvailable, perplexitySearch } = await import("../../../perplexity-search");
  if (isPerplexityAvailable()) {
    const result = await perplexitySearch(query);
    if (result.success && result.answer) {
      const { wrapExternalContent } = await import("../../../external-content-security");
      const { wrapped } = wrapExternalContent(result.answer, "web_search");
      const citationList = result.citations?.length
        ? result.citations.map((c, i) => `[${i + 1}] ${c}`).join("\n")
        : "";
      return {
        success: true,
        query,
        provider: "perplexity",
        model: result.model,
        resultCount: 1,
        results: [
          {
            source: `Perplexity Sonar (${result.model})`,
            content: wrapped + (citationList ? `\n\nSources:\n${citationList}` : ""),
          },
        ],
      };
    }
    console.log(`[web_search] Perplexity failed (${result.error}), falling back to legacy search`);
  }

  return webSearchLegacy(query);
}

// ---------------------------------------------------------------------------
// Handlers (mechanical moves of the legacy switch arms)
// ---------------------------------------------------------------------------

async function webFetchHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { annotateWebToolResult } = await import("../../../camofox-tool");
  return annotateWebToolResult(await webFetch(params.url), "web_fetch");
}

async function webSearchHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  return webSearch(params.query || "");
}

async function publicApiPackHandler(
  name: string,
  params: Record<string, any>,
): Promise<ToolResult> {
  // R125+35 — Public-API live-data pack. Host is hardcoded per handler; the
  // LLM only supplies validated+encoded query params (no SSRF). Text-bearing
  // sources (Wikipedia extract, HN titles) are fenced via wrapExternalContent
  // before reaching the model — same prompt-injection defense as academic_search.
  const { PUBLIC_API_HANDLERS } = await import("../../../public-api-tools");
  const { wrapExternalContent } = await import("../../../external-content-security");
  const handler = PUBLIC_API_HANDLERS[name];
  if (!handler) return { error: `No handler for ${name}` };
  const res = await handler(params || {});
  if (!res.ok) return { ok: false, error: res.error };
  const { wrapped } = wrapExternalContent(JSON.stringify(res.data), "web_fetch", { url: `public-api://${res.source}` });
  return { ok: true, source: res.source, fenced: wrapped };
}

async function academicSearchDispatch(
  name: string,
  params: Record<string, any>,
): Promise<ToolResult> {
  // R125+4 — Legitimate scholarly search. All 5 tools share the same
  // post-processing: wrap remote-fetched text via wrapExternalContent so any
  // adversarial abstract can't smuggle tool-call-shaped strings or verdict
  // channels back into the calling LLM's next turn.
  const lib = await import("../../../lib/academic-search");
  const { wrapExternalContent } = await import("../../../external-content-security");
  const q = String(params.query || "").trim();
  if (!q) return { error: "query is required" };
  try {
    let raw: any;
    let sourceLabel: string;
    if (name === "academic_search") {
      const allowedSources = ["arxiv", "pubmed", "openalex", "crossref"] as const;
      const sources = Array.isArray(params.sources)
        ? params.sources.filter((s: any) => (allowedSources as readonly string[]).includes(s))
        : undefined;
      raw = await lib.academicSearchAll(q, {
        maxResultsPerSource: params.max_per_source,
        sources: sources as any,
        openAccessOnly: !!params.open_access_only,
      });
      sourceLabel = "academic://all";
    } else if (name === "arxiv_search") {
      raw = { query: q, results: await lib.searchArxiv(q, params.max_results) };
      sourceLabel = "academic://arxiv";
    } else if (name === "pubmed_search") {
      raw = { query: q, results: await lib.searchPubmed(q, params.max_results) };
      sourceLabel = "academic://pubmed";
    } else if (name === "openalex_search") {
      raw = { query: q, results: await lib.searchOpenalex(q, params.max_results, { openAccessOnly: !!params.open_access_only }) };
      sourceLabel = "academic://openalex";
    } else {
      raw = { query: q, results: await lib.searchCrossref(q, params.max_results) };
      sourceLabel = "academic://crossref";
    }
    // R125+4+sec — architect FAIL on initial wiring: returning `raw` alongside
    // `fenced` defeats the fence, because chat-engine JSON.stringifies the
    // whole tool result into the model's tool-message channel and the raw
    // abstracts (untrusted publisher text) end up outside the fence anyway.
    // Fix: return ONLY the fenced wrapper for LLM-visible callers. Pre-fence
    // structured signal (counts, source health, source labels) is safe because
    // it's all locally-generated metadata, never publisher-controlled.
    const meta: any = { ok: true, source: sourceLabel, result_count: raw.results?.length ?? 0 };
    if (raw.sources_queried) meta.sources_queried = raw.sources_queried;
    if (raw.source_errors) meta.source_errors = raw.source_errors;
    if (typeof raw.total_before_dedup === "number") meta.total_before_dedup = raw.total_before_dedup;
    const { wrapped } = wrapExternalContent(JSON.stringify(raw), "web_fetch", { url: sourceLabel });
    return { ...meta, fenced: wrapped };
  } catch (e: any) {
    return { error: `${name} failed: ${e?.message || String(e)}` };
  }
}

async function firecrawlSearchHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  // Tools-layer-split S9: webSearch moved to the web domain; the fallback
  // imports it call-time (facade → domain is the allowed direction).
  const { isFirecrawlAvailable } = await import("../../../firecrawl");
  const { wrapExternalContent } = await import("../../../external-content-security");
  if (!isFirecrawlAvailable()) {
    return webSearch(params.query || "");
  }
  const { cachedFirecrawlSearch } = await import("../../../agentic/cached-tools");
  const fcResult = await cachedFirecrawlSearch(params.query || "", Math.min(params.limit || 5, 10));
  if (!fcResult.success || !fcResult.results?.length) {
    return webSearch(params.query || "");
  }
  const wrappedFcResults = fcResult.results.map(r => {
    const { wrapped } = wrapExternalContent(r.markdown, "firecrawl_search" as any, { url: r.url });
    return { title: r.title, url: r.url, content: wrapped };
  });
  return { success: true, query: params.query, provider: "firecrawl", resultCount: wrappedFcResults.length, results: wrappedFcResults };
}

async function readabilityExtractHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { readabilityExtract } = await import("../../../structured-extraction");
  return readabilityExtract(params.url);
}

async function firecrawlScrapeHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for firecrawl_scrape" };
  const tenantId = ctx.tenantId;
  const { firecrawlScrapeAndStore, getScrapedPageContent } = await import("../../../firecrawl");
  const { annotateWebToolResult: annotateFc } = await import("../../../camofox-tool");
  try {
    const scrapeResult = await firecrawlScrapeAndStore(params.url, tenantId, params.tags);
    if (!scrapeResult.success) throw new Error(scrapeResult.error || "Firecrawl scrape failed");
    const fullPage = await getScrapedPageContent(scrapeResult.pageId!, tenantId);
    // R96.1+architect-HIGH-#4 fix: success path now ALSO gets annotated
    // — a "successful" scrape that returned a Cloudflare interstitial
    // page used to slip through with success:true.
    return annotateFc({
      success: true,
      pageId: scrapeResult.pageId,
      title: scrapeResult.title,
      contentLength: scrapeResult.contentLength,
      content: fullPage.page?.content?.slice(0, 8000) || "",
      storedInDatabase: true,
    }, "firecrawl_scrape");
  } catch (fcErr: any) {
    console.warn(`[firecrawl_scrape] Firecrawl failed: ${fcErr.message}, falling back to web_fetch`);
    const { annotateWebToolResult } = await import("../../../camofox-tool");
    try {
      const { executeTool } = await import("../../../tools");
      const fallbackResult = await (executeTool as any)("web_fetch", { url: params.url, _tenantId: tenantId });
      return annotateWebToolResult({ ...fallbackResult, _fallback: "web_fetch", _firecrawlError: fcErr.message?.slice(0, 100) }, "firecrawl_scrape");
    } catch (fbErr: any) {
      return annotateWebToolResult({ error: `Firecrawl failed: ${fcErr.message?.slice(0, 150)}. Fallback web_fetch also failed: ${fbErr.message?.slice(0, 150)}` }, "firecrawl_scrape");
    }
  }
}

async function firecrawlCrawlHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for firecrawl_crawl" };
  const tenantId = ctx.tenantId;
  const { firecrawlCrawlSite } = await import("../../../firecrawl");
  try {
    return await retryWithBackoff(
      () => firecrawlCrawlSite(params.url, tenantId, {
        limit: params.limit,
        maxDepth: params.maxDepth,
        includePaths: params.includePaths,
        excludePaths: params.excludePaths,
        tags: params.tags,
      }),
      { retries: 1, delayMs: 3000, label: "firecrawl_crawl" }
    );
  } catch (err: any) {
    return { error: `Firecrawl crawl failed after retry: ${err.message?.slice(0, 200)}` };
  }
}

async function firecrawlMapHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { firecrawlMapSite } = await import("../../../firecrawl");
  return firecrawlMapSite(params.url);
}

// Tools-layer-split S25s: scraped-page store ops migrated from the legacy
// facade switch. Backed by ./firecrawl (call-time dynamic import — acyclicity).
// Seam: legacy arms read the dispatcher-STRIPPED `params._tenantId`; handlers
// read `ctx.tenantId` under the same fail-closed guard.
async function scrapedPagesQueryHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for scraped_pages_query" };
  const tenantId = ctx.tenantId;
  const { queryScrapedPages } = await import("../../../firecrawl");
  return queryScrapedPages(tenantId, {
    domain: params.domain,
    search: params.search,
    limit: params.limit,
    offset: params.offset,
  });
}

async function scrapedPageReadHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for scraped_page_read" };
  const tenantId = ctx.tenantId;
  const { getScrapedPageContent } = await import("../../../firecrawl");
  return getScrapedPageContent(params.pageId, tenantId);
}

async function scrapedPagesDeleteHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for scraped_pages_delete" };
  const tenantId = ctx.tenantId;
  const { deleteScrapedPages } = await import("../../../firecrawl");
  return deleteScrapedPages(tenantId, {
    pageIds: params.pageIds,
    domain: params.domain,
    olderThanDays: params.olderThanDays,
  });
}

/** Registered by ./index.ts at import time. */
export const webDomainTools: RegisteredTool[] = [
  defineTool(webFetchDefinition, webFetchHandler),
  defineTool(webSearchDefinition, webSearchHandler),
  defineTool(fetchWeatherDefinition, (p, _c) => publicApiPackHandler("fetch_weather", p)),
  defineTool(fetchCryptoPriceDefinition, (p, _c) => publicApiPackHandler("fetch_crypto_price", p)),
  defineTool(fetchExchangeRateDefinition, (p, _c) => publicApiPackHandler("fetch_exchange_rate", p)),
  defineTool(fetchWikipediaDefinition, (p, _c) => publicApiPackHandler("fetch_wikipedia", p)),
  defineTool(fetchHackerNewsDefinition, (p, _c) => publicApiPackHandler("fetch_hacker_news", p)),
  defineTool(lookupIpGeoDefinition, (p, _c) => publicApiPackHandler("lookup_ip_geo", p)),
  defineTool(academicSearchDefinition, (p, _c) => academicSearchDispatch("academic_search", p)),
  defineTool(arxivSearchDefinition, (p, _c) => academicSearchDispatch("arxiv_search", p)),
  defineTool(pubmedSearchDefinition, (p, _c) => academicSearchDispatch("pubmed_search", p)),
  defineTool(openalexSearchDefinition, (p, _c) => academicSearchDispatch("openalex_search", p)),
  defineTool(crossrefLookupDefinition, (p, _c) => academicSearchDispatch("crossref_lookup", p)),
  defineTool(firecrawlSearchDefinition, firecrawlSearchHandler),
  defineTool(readabilityExtractDefinition, readabilityExtractHandler),
  defineTool(firecrawlScrapeDefinition, firecrawlScrapeHandler),
  defineTool(firecrawlCrawlDefinition, firecrawlCrawlHandler),
  defineTool(firecrawlMapDefinition, firecrawlMapHandler),
  defineTool(scrapedPagesQueryDefinition, scrapedPagesQueryHandler),
  defineTool(scrapedPageReadDefinition, scrapedPageReadHandler),
  defineTool(scrapedPagesDeleteDefinition, scrapedPagesDeleteHandler),
];
