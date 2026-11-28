import fs from "fs";
import path from "path";
import { setTimeout as sleep } from "node:timers/promises";
import { db } from "./db";
import { scrapedPages } from "@shared/schema";
import { eq, and, ilike, desc, sql } from "drizzle-orm";
import { fetchWithTimeout } from "./lib/fetch-with-timeout";
import { readResponseTextBounded } from "./lib/bounded-response";
import { getCurrentToolAbortSignal } from "./lib/tool-abort-context";

export interface FirecrawlConfig {
  apiKey: string;
  baseUrl: string;
  onlyMainContent: boolean;
  maxAgeMs: number;
  timeoutSeconds: number;
  enabled: boolean;
}

const CONFIG_PATH = path.resolve(process.cwd(), "data", "firecrawl-config.json");
const FIRECRAWL_API = "/v2";

const DEFAULT_CONFIG: FirecrawlConfig = {
  apiKey: "",
  baseUrl: "https://api.firecrawl.dev",
  onlyMainContent: true,
  maxAgeMs: 172800000,
  timeoutSeconds: 60,
  enabled: true,
};

let cachedConfig: FirecrawlConfig | null = null;

export function loadFirecrawlConfig(): FirecrawlConfig {
  if (cachedConfig) return cachedConfig;

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      cachedConfig = { ...DEFAULT_CONFIG, ...data };
      return cachedConfig!;
    }
  } catch (err) {
    console.error("[firecrawl] Failed to load config:", err);
  }

  const envKey = process.env.FIRECRAWL_API_KEY;
  if (envKey) {
    cachedConfig = { ...DEFAULT_CONFIG, apiKey: envKey };
    return cachedConfig;
  }

  cachedConfig = { ...DEFAULT_CONFIG };
  return cachedConfig;
}

// SSRF hardening (72h-review MEDIUM): the admin-configurable baseUrl is used
// for server-side fetches carrying the Firecrawl bearer token. Validate at
// write-time: https only, no localhost / private / link-local / internal
// hostnames or IP-literal targets. Fail CLOSED on anything suspicious.
function assertSafeFirecrawlBaseUrl(baseUrl: string): void {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error("Invalid Firecrawl baseUrl: not a valid URL");
  }
  if (u.protocol !== "https:") throw new Error("Invalid Firecrawl baseUrl: https required");
  if (u.username || u.password) throw new Error("Invalid Firecrawl baseUrl: credentials not allowed");
  const host = u.hostname.toLowerCase();
  const isIpV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isIpV6 = host.includes(":");
  if (isIpV4 || isIpV6) throw new Error("Invalid Firecrawl baseUrl: IP-literal hosts not allowed");
  if (
    host === "localhost" || host.endsWith(".localhost") ||
    host.endsWith(".local") || host.endsWith(".internal") ||
    host.endsWith(".railway.internal") || !host.includes(".")
  ) {
    throw new Error("Invalid Firecrawl baseUrl: internal/localhost hosts not allowed");
  }
}

export function saveFirecrawlConfig(update: Partial<FirecrawlConfig>): FirecrawlConfig {
  if (typeof update.baseUrl === "string") {
    assertSafeFirecrawlBaseUrl(update.baseUrl);
  }
  const current = loadFirecrawlConfig();
  const updated = { ...current, ...update };

  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));
  cachedConfig = updated;
  return updated;
}

export function isFirecrawlAvailable(): boolean {
  const config = loadFirecrawlConfig();
  return config.enabled && !!config.apiKey;
}

export interface FirecrawlResult {
  success: boolean;
  content?: string;
  title?: string;
  sourceUrl?: string;
  status?: number;
  retryAfter?: string;
  retryAfterMs?: number;
  error?: string;
  cached?: boolean;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function firecrawlEndpoint(baseUrl: string, route: string): string {
  assertSafeFirecrawlBaseUrl(baseUrl);
  const base = new URL(baseUrl);
  if (base.search || base.hash) throw new Error("Invalid Firecrawl baseUrl: query or fragment not allowed");
  base.pathname = base.pathname.replace(/\/+$/, "").replace(/\/v(?:1|2)$/, "") + FIRECRAWL_API + route;
  return base.href;
}

function firstText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((item): item is string => typeof item === "string" && item.trim().length > 0);
    return first?.trim() || "";
  }
  return "";
}

const resultCache = new Map<string, { result: FirecrawlResult; timestamp: number }>();

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/https?:\/\//, "").split("/")[0] || url;
  }
}

// R-review SSRF guard — every URL-taking Firecrawl entry point must validate
// through the same isUrlSafe gate as web_fetch (private IPs, metadata,
// localhost, DNS-to-private all rejected). Call-time dynamic import keeps the
// tools-lib package acyclicity invariant. Fail CLOSED on guard error.
async function assertFirecrawlUrlSafe(url: string): Promise<{ safe: boolean; error?: string }> {
  try {
    const { isUrlSafe } = await import("./tools/lib/safe-fetch");
    const check = await isUrlSafe(url);
    if (!check.safe) return { safe: false, error: `URL blocked by SSRF guard: ${check.error || "unsafe URL"}` };
    return { safe: true };
  } catch (err: any) {
    return { safe: false, error: `SSRF guard unavailable (fail-closed): ${err?.message?.slice(0, 120)}` };
  }
}

export async function firecrawlScrape(url: string): Promise<FirecrawlResult> {
  const guard = await assertFirecrawlUrlSafe(url);
  if (!guard.safe) return { success: false, error: guard.error };
  const config = loadFirecrawlConfig();

  if (!config.enabled || !config.apiKey) {
    return { success: false, error: "Firecrawl not configured" };
  }

  const cached = resultCache.get(url);
  if (cached && Date.now() - cached.timestamp < config.maxAgeMs) {
    return { ...cached.result, cached: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);
  try {

    const response = await fetch(firecrawlEndpoint(config.baseUrl, "/scrape"), {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: config.onlyMainContent,
        proxy: "auto",
        storeInCache: true,
        maxAge: config.maxAgeMs,
        waitFor: 3000,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after") || undefined;
      const errText = await readResponseTextBounded(response, 256_000, () => controller.abort()).catch(() => "");
      return {
        success: false,
        status: response.status,
        retryAfter,
        retryAfterMs: parseRetryAfter(retryAfter || null),
        error: `Firecrawl HTTP ${response.status}: ${errText.slice(0, 200)}`,
      };
    }

    const responseText = await readResponseTextBounded(response, 6 * 1024 * 1024, () => controller.abort());
    const data = JSON.parse(responseText) as any;

    if (!data.success) {
      return { success: false, error: data.error || "Firecrawl extraction failed" };
    }

    const markdown = data.data?.markdown || "";
    const title = firstText(data.data?.metadata?.title);
    const sourceUrl = data.data?.metadata?.sourceURL || url;

    if (!markdown.trim()) {
      return { success: false, error: "Firecrawl returned empty content" };
    }

    const result: FirecrawlResult = {
      success: true,
      status: response.status,
      content: markdown,
      title,
      sourceUrl,
    };

    resultCache.set(url, { result, timestamp: Date.now() });

    if (resultCache.size > 500) {
      const oldest = [...resultCache.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 100);
      for (const [key] of oldest) resultCache.delete(key);
    }

    return result;
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { success: false, error: `Firecrawl timeout (${config.timeoutSeconds}s)` };
    }
    return { success: false, error: `Firecrawl error: ${err.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

export async function firecrawlScrapeAndStore(
  url: string,
  tenantId: number,
  tags?: string[]
): Promise<{ success: boolean; pageId?: number; title?: string; contentLength?: number; error?: string }> {
  const result = await firecrawlScrape(url);
  if (!result.success || !result.content) {
    return { success: false, error: result.error || "Scrape returned no content" };
  }

  const domain = extractDomain(url);

  const existing = await db.select({ id: scrapedPages.id })
    .from(scrapedPages)
    .where(and(eq(scrapedPages.url, result.sourceUrl || url), eq(scrapedPages.tenantId, tenantId)))
    .limit(1);

  if (existing.length > 0) {
    await db.update(scrapedPages)
      .set({
        title: result.title || null,
        content: result.content,
        contentLength: result.content.length,
        tags: tags || null,
        scrapedAt: new Date(),
      })
      .where(eq(scrapedPages.id, existing[0].id));
    console.log(`[firecrawl] Updated existing page ${existing[0].id}: ${url}`);
    return { success: true, pageId: existing[0].id, title: result.title, contentLength: result.content.length };
  }

  const [inserted] = await db.insert(scrapedPages).values({
    tenantId,
    url: result.sourceUrl || url,
    domain,
    title: result.title || null,
    content: result.content,
    contentLength: result.content.length,
    tags: tags || null,
    metadata: { scrapedVia: "single" },
  }).returning({ id: scrapedPages.id });

  console.log(`[firecrawl] Stored page ${inserted.id}: ${url} (${result.content.length} chars)`);
  return { success: true, pageId: inserted.id, title: result.title, contentLength: result.content.length };
}

export async function firecrawlCrawlSite(
  url: string,
  tenantId: number,
  options: { limit?: number; maxDepth?: number; includePaths?: string[]; excludePaths?: string[]; tags?: string[] } = {}
): Promise<{ success: boolean; pagesScraped?: number; pages?: { url: string; title: string; contentLength: number }[]; error?: string }> {
  const crawlGuard = await assertFirecrawlUrlSafe(url);
  if (!crawlGuard.safe) return { success: false, error: crawlGuard.error };
  const config = loadFirecrawlConfig();
  if (!config.enabled || !config.apiKey) {
    return { success: false, error: "Firecrawl not configured" };
  }

  const limit = options.limit ?? 20;
  const maxDepth = options.maxDepth ?? 3;
  if (!Number.isSafeInteger(limit) || limit < 1) return { success: false, error: "Invalid crawl page limit" };
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 100) {
    return { success: false, error: "Invalid crawl path depth (expected an integer from 0 to 100)" };
  }
  const pageLimit = Math.min(limit, 100);

  try {
    const crawlEndpoint = firecrawlEndpoint(config.baseUrl, "/crawl");
    console.log(`[firecrawl] Starting crawl: ${url} (limit: ${pageLimit}, path depth: ${maxDepth})`);

    // The v1 field counted URL path segments, not hops between links.
    // When callers supply their own include filters, preserve them and enforce
    // depth independently with an extra exclusion.
    const depthPattern = `^(/+[^/]+){0,${maxDepth}}`;
    const crawlBody = {
      url,
      limit: pageLimit,
      regexOnFullURL: false,
      includePaths: options.includePaths?.length
        ? options.includePaths
        : [`${depthPattern}/*$`, `${depthPattern}/+index\\.(html|php)/*$`],
      excludePaths: [
        ...(options.excludePaths ?? []),
        ...(options.includePaths?.length ? [`^(/+[^/]+){${maxDepth + 1}}`] : []),
      ],
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
      },
    };

    const startResponse = await fetchWithTimeout(crawlEndpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(crawlBody),
      timeoutMs: 30_000,
    });

    if (!startResponse.ok) {
      const errText = await startResponse.text().catch(() => "");
      return { success: false, error: `Crawl start failed HTTP ${startResponse.status}: ${errText.slice(0, 200)}` };
    }

    const startData = await startResponse.json() as any;
    if (!startData.success || typeof startData.id !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(startData.id)) {
      return { success: false, error: startData.error || "Crawl failed to start" };
    }

    const crawlId = startData.id;
    console.log(`[firecrawl] Crawl job started: ${crawlId}`);

    const maxWaitMs = Math.max(pageLimit * 15000, 120000);
    const pollInterval = 5000;
    const startTime = Date.now();
    const statusUrl = `${crawlEndpoint}/${crawlId}`;
    const callerSignal = getCurrentToolAbortSignal();
    let lastPollError: string | undefined;
    async function readStatusPage(pageUrl: string, maxBytes: number) {
      const remaining = maxWaitMs - (Date.now() - startTime);
      if (remaining <= 0) throw new Error("Crawl deadline exceeded");
      const deadline = AbortSignal.timeout(Math.min(20_000, remaining));
      const signal = callerSignal ? AbortSignal.any([deadline, callerSignal]) : deadline;
      let response: Response;
      try {
        response = await fetch(pageUrl, {
          headers: { "Authorization": `Bearer ${config.apiKey}` },
          redirect: "error",
          signal,
        });
      } catch {
        callerSignal?.throwIfAborted();
        return { kind: "transport", error: deadline.aborted ? "status poll timed out" : "status request failed" } as const;
      }
      if (!response.ok) {
        const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        await response.body?.cancel();
        return { kind: "http", status: response.status, retryAfterMs } as const;
      }
      const text = await readResponseTextBounded(response, maxBytes);
      return { kind: "page", data: JSON.parse(text) as any, bytes: Buffer.byteLength(text) } as const;
    }
    const maxPageBytes = 12 * 1024 * 1024;
    const allPages: any[] = [];
    let finished = false;

    while (Date.now() - startTime < maxWaitMs) {
      callerSignal?.throwIfAborted();
      await new Promise(r => setTimeout(r, pollInterval));
      const response = await readStatusPage(statusUrl, maxPageBytes);
      if (response.kind === "transport") {
        lastPollError = response.error;
        continue;
      }
      if (response.kind === "http") {
        if (response.status === 429 || response.status >= 500) {
          lastPollError = `HTTP ${response.status}`;
          continue;
        }
        return { success: false, error: `Crawl status failed HTTP ${response.status}` };
      }
      let statusData = response.data;
      if (typeof statusData?.status !== "string") throw new Error("Invalid crawl status response");

      if (statusData.status === "completed") {
        let bytesRemaining = 32 * 1024 * 1024 - response.bytes;
        const visited = new Set([statusUrl]);
        for (;;) {
          if (statusData.status !== "completed" || !Array.isArray(statusData.data)) {
            throw new Error("Invalid completed crawl page");
          }
          for (const page of statusData.data) {
            if (allPages.length === pageLimit) break;
            allPages.push(page);
          }
          if (statusData.next == null || statusData.next === "" || allPages.length === pageLimit) break;
          if (typeof statusData.next !== "string" || visited.size >= 16 || bytesRemaining <= 0) {
            throw new Error("Crawl pagination exceeded safe limits or returned an invalid cursor");
          }
          const next = new URL(statusData.next, statusUrl);
          const job = new URL(statusUrl);
          if (next.origin !== job.origin || next.pathname !== job.pathname ||
              next.username || next.password || next.hash || !next.search || visited.has(next.href)) {
            throw new Error("Invalid crawl pagination cursor");
          }
          visited.add(next.href);
          const readContinuation = () => readStatusPage(next.href, Math.min(maxPageBytes, bytesRemaining));
          let continuation = await readContinuation();
          if (continuation.kind === "transport" ||
              (continuation.kind === "http" && (continuation.status === 429 || continuation.status >= 500))) {
            const waitMs = continuation.kind === "http" ? continuation.retryAfterMs ?? 1_000 : 1_000;
            // Retry just the read of this completed job, never submit another crawl.
            if (waitMs <= 10_000 && Date.now() - startTime + waitMs < maxWaitMs) {
              await sleep(waitMs, undefined, { signal: callerSignal });
              continuation = await readContinuation();
            }
          }
          if (continuation.kind === "transport") throw new Error(`Crawl pagination: ${continuation.error}`);
          if (continuation.kind === "http") throw new Error(`Crawl pagination failed HTTP ${continuation.status}`);
          statusData = continuation.data;
          bytesRemaining -= continuation.bytes;
        }
        finished = true;
        break;
      } else if (statusData.status === "failed" || statusData.status === "cancelled") {
        return { success: false, error: `Crawl ${statusData.status}: ${statusData.error || "unknown"}` };
      }

      console.log(`[firecrawl] Crawl ${crawlId} status: ${statusData.status} (${statusData.completed || 0}/${statusData.total || "?"})`);
    }

    if (!finished) return { success: false, error: `Crawl deadline exceeded${lastPollError ? ` (${lastPollError})` : ""}` };
    if (allPages.length === 0) {
      return { success: false, error: "Crawl completed but returned no pages" };
    }

    const domain = extractDomain(url);
    const storedPages: { url: string; title: string; contentLength: number }[] = [];

    for (const page of allPages) {
      const markdown = typeof page?.markdown === "string" ? page.markdown : "";
      if (!markdown.trim()) continue;

      const pageUrl = firstText(page.metadata?.sourceURL) || firstText(page.url) || url;
      const pageTitle = firstText(page.metadata?.title);

      const existing = await db.select({ id: scrapedPages.id })
        .from(scrapedPages)
        .where(and(eq(scrapedPages.url, pageUrl), eq(scrapedPages.tenantId, tenantId)))
        .limit(1);

      if (existing.length > 0) {
        await db.update(scrapedPages)
          .set({
            title: pageTitle || null,
            content: markdown,
            contentLength: markdown.length,
            crawlJobId: crawlId,
            tags: options.tags || null,
            scrapedAt: new Date(),
          })
          .where(and(eq(scrapedPages.id, existing[0].id), eq(scrapedPages.tenantId, tenantId)));
      } else {
        await db.insert(scrapedPages).values({
          tenantId,
          url: pageUrl,
          domain,
          title: pageTitle || null,
          content: markdown,
          contentLength: markdown.length,
          crawlJobId: crawlId,
          tags: options.tags || null,
          metadata: { scrapedVia: "crawl", crawlRoot: url },
        });
      }

      storedPages.push({ url: pageUrl, title: pageTitle, contentLength: markdown.length });
    }

    if (storedPages.length === 0) return { success: false, error: "Crawl returned no usable markdown" };
    console.log(`[firecrawl] Crawl complete: ${storedPages.length} pages stored from ${url}`);
    return { success: true, pagesScraped: storedPages.length, pages: storedPages };

  } catch (err: any) {
    return { success: false, error: `Crawl error: ${err.message}` };
  }
}

export async function firecrawlMapSite(
  url: string
): Promise<{ success: boolean; urls?: string[]; error?: string }> {
  const mapGuard = await assertFirecrawlUrlSafe(url);
  if (!mapGuard.safe) return { success: false, error: mapGuard.error };
  const config = loadFirecrawlConfig();
  if (!config.enabled || !config.apiKey) {
    return { success: false, error: "Firecrawl not configured" };
  }

  try {
    const response = await fetchWithTimeout(firecrawlEndpoint(config.baseUrl, "/map"), {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ url }),
      timeoutMs: 30_000,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return { success: false, error: `Map failed HTTP ${response.status}: ${errText.slice(0, 200)}` };
    }

    const data = await response.json() as any;
    if (!data.success) {
      return { success: false, error: data.error || "Map failed" };
    }

    if (!Array.isArray(data.links)) return { success: false, error: "Invalid Firecrawl map results" };
    return { success: true, urls: data.links
      .map((entry: unknown) => typeof entry === "string" ? entry : (entry as { url?: unknown } | null)?.url)
      .filter((entry: unknown): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .slice(0, 200) };
  } catch (err: any) {
    return { success: false, error: `Map error: ${err.message}` };
  }
}

export async function queryScrapedPages(
  tenantId: number,
  options: { domain?: string; search?: string; tags?: string[]; limit?: number; offset?: number } = {}
): Promise<{ success: boolean; pages?: { id: number; url: string; domain: string; title: string | null; contentPreview: string; contentLength: number; tags: string[] | null; scrapedAt: Date }[]; total?: number; error?: string }> {
  try {
    const conditions = [eq(scrapedPages.tenantId, tenantId)];
    if (options.domain) {
      conditions.push(ilike(scrapedPages.domain, `%${options.domain}%`));
    }
    if (options.search) {
      conditions.push(sql`(${scrapedPages.content} ILIKE ${'%' + options.search + '%'} OR ${scrapedPages.title} ILIKE ${'%' + options.search + '%'})`);
    }

    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(scrapedPages)
      .where(whereClause!);

    const queryLimit = Math.min(options.limit || 20, 50);
    const queryOffset = options.offset || 0;

    const rows = await db.select()
      .from(scrapedPages)
      .where(whereClause!)
      .orderBy(desc(scrapedPages.scrapedAt))
      .limit(queryLimit)
      .offset(queryOffset);

    const pages = rows.map(r => ({
      id: r.id,
      url: r.url,
      domain: r.domain,
      title: r.title,
      contentPreview: (r.content || "").slice(0, 500),
      contentLength: r.contentLength,
      tags: r.tags,
      scrapedAt: r.scrapedAt,
    }));

    return { success: true, pages, total: countResult.count };
  } catch (err: any) {
    return { success: false, error: `Query error: ${err.message}` };
  }
}

export async function getScrapedPageContent(
  pageId: number,
  tenantId: number
): Promise<{ success: boolean; page?: { id: number; url: string; domain: string; title: string | null; content: string; tags: string[] | null; scrapedAt: Date }; error?: string }> {
  try {
    const [row] = await db.select()
      .from(scrapedPages)
      .where(and(eq(scrapedPages.id, pageId), eq(scrapedPages.tenantId, tenantId)))
      .limit(1);

    if (!row) return { success: false, error: `Page ${pageId} not found` };

    return {
      success: true,
      page: {
        id: row.id,
        url: row.url,
        domain: row.domain,
        title: row.title,
        content: row.content,
        tags: row.tags,
        scrapedAt: row.scrapedAt,
      },
    };
  } catch (err: any) {
    return { success: false, error: `Read error: ${err.message}` };
  }
}

export async function deleteScrapedPages(
  tenantId: number,
  options: { pageIds?: number[]; domain?: string; olderThanDays?: number }
): Promise<{ success: boolean; deleted?: number; error?: string }> {
  try {
    const conditions = [eq(scrapedPages.tenantId, tenantId)];

    if (options.pageIds?.length) {
      conditions.push(sql`${scrapedPages.id} = ANY(${options.pageIds})`);
    }
    if (options.domain) {
      conditions.push(eq(scrapedPages.domain, options.domain));
    }
    if (options.olderThanDays) {
      const days = Math.max(1, Math.min(Math.floor(Number(options.olderThanDays)), 3650));
      if (isNaN(days)) return { success: false, error: "olderThanDays must be a valid number" };
      conditions.push(sql`${scrapedPages.scrapedAt} < NOW() - make_interval(days => ${days})`);
    }

    if (conditions.length === 1) {
      return { success: false, error: "Must specify pageIds, domain, or olderThanDays filter" };
    }

    const result = await db.delete(scrapedPages).where(and(...conditions));
    const deleted = (result as any).rowCount || 0;
    return { success: true, deleted };
  } catch (err: any) {
    return { success: false, error: `Delete error: ${err.message}` };
  }
}

export async function firecrawlSearch(query: string, limit = 5): Promise<{ success: boolean; results?: { title: string; url: string; markdown: string }[]; error?: string }> {
  const config = loadFirecrawlConfig();
  if (!config.enabled || !config.apiKey) {
    return { success: false, error: "Firecrawl not configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);
  try {
    const response = await fetch(firecrawlEndpoint(config.baseUrl, "/search"), {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        query,
        limit,
        sources: ["web"],
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await readResponseTextBounded(response, 256_000, () => controller.abort()).catch(() => "");
      return { success: false, error: `Firecrawl HTTP ${response.status}: ${errText.slice(0, 200)}` };
    }

    const data = JSON.parse(await readResponseTextBounded(response, 6 * 1024 * 1024, () => controller.abort())) as any;
    if (!data.success) {
      return { success: false, error: data.error || "Firecrawl search failed" };
    }

    if (!Array.isArray(data.data?.web)) return { success: false, error: "Invalid Firecrawl web search results" };
    const results = data.data.web.flatMap((item: any) => {
      const url = firstText(item?.url) || firstText(item?.metadata?.sourceURL);
      if (!url) return [];
      return [{
        title: firstText(item?.title) || firstText(item?.metadata?.title) || url,
        url,
        markdown: typeof item?.markdown === "string" ? item.markdown.slice(0, 3000) : "",
      }];
    });

    return { success: true, results };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { success: false, error: `Firecrawl search timeout (${config.timeoutSeconds}s)` };
    }
    return { success: false, error: `Firecrawl search error: ${err.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

export function clearFirecrawlCache() {
  resultCache.clear();
}

export function getFirecrawlCacheStats() {
  return {
    entries: resultCache.size,
    urls: [...resultCache.keys()].slice(0, 20),
  };
}
