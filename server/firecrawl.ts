import fs from "fs";
import path from "path";
import { db } from "./db";
import { scrapedPages } from "@shared/schema";
import { eq, and, ilike, desc, sql } from "drizzle-orm";

export interface FirecrawlConfig {
  apiKey: string;
  baseUrl: string;
  onlyMainContent: boolean;
  maxAgeMs: number;
  timeoutSeconds: number;
  enabled: boolean;
}

const CONFIG_PATH = path.resolve(process.cwd(), "data", "firecrawl-config.json");

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
  error?: string;
  cached?: boolean;
}

const resultCache = new Map<string, { result: FirecrawlResult; timestamp: number }>();

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/https?:\/\//, "").split("/")[0] || url;
  }
}

export async function firecrawlScrape(url: string): Promise<FirecrawlResult> {
  const config = loadFirecrawlConfig();

  if (!config.enabled || !config.apiKey) {
    return { success: false, error: "Firecrawl not configured" };
  }

  const cached = resultCache.get(url);
  if (cached && Date.now() - cached.timestamp < config.maxAgeMs) {
    return { ...cached.result, cached: true };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);

    const response = await fetch(`${config.baseUrl}/v1/scrape`, {
      method: "POST",
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
        waitFor: 3000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return { success: false, error: `Firecrawl HTTP ${response.status}: ${errText.slice(0, 200)}` };
    }

    const data = await response.json() as any;

    if (!data.success) {
      return { success: false, error: data.error || "Firecrawl extraction failed" };
    }

    const markdown = data.data?.markdown || "";
    const title = data.data?.metadata?.title || "";
    const sourceUrl = data.data?.metadata?.sourceURL || url;

    if (!markdown.trim()) {
      return { success: false, error: "Firecrawl returned empty content" };
    }

    const result: FirecrawlResult = {
      success: true,
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
  const config = loadFirecrawlConfig();
  if (!config.enabled || !config.apiKey) {
    return { success: false, error: "Firecrawl not configured" };
  }

  const limit = Math.min(options.limit || 20, 100);
  const maxDepth = options.maxDepth || 3;

  try {
    console.log(`[firecrawl] Starting crawl: ${url} (limit: ${limit}, depth: ${maxDepth})`);

    const crawlBody: any = {
      url,
      limit,
      maxDepth,
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
      },
    };
    if (options.includePaths?.length) crawlBody.includePaths = options.includePaths;
    if (options.excludePaths?.length) crawlBody.excludePaths = options.excludePaths;

    const startResponse = await fetch(`${config.baseUrl}/v1/crawl`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(crawlBody),
    });

    if (!startResponse.ok) {
      const errText = await startResponse.text().catch(() => "");
      return { success: false, error: `Crawl start failed HTTP ${startResponse.status}: ${errText.slice(0, 200)}` };
    }

    const startData = await startResponse.json() as any;
    if (!startData.success || !startData.id) {
      return { success: false, error: startData.error || "Crawl failed to start" };
    }

    const crawlId = startData.id;
    console.log(`[firecrawl] Crawl job started: ${crawlId}`);

    const maxWaitMs = Math.max(limit * 15000, 120000);
    const pollInterval = 5000;
    const startTime = Date.now();
    let allPages: any[] = [];

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(r => setTimeout(r, pollInterval));

      const statusResponse = await fetch(`${config.baseUrl}/v1/crawl/${crawlId}`, {
        headers: { "Authorization": `Bearer ${config.apiKey}` },
      });

      if (!statusResponse.ok) continue;
      const statusData = await statusResponse.json() as any;

      if (statusData.status === "completed") {
        allPages = statusData.data || [];
        break;
      } else if (statusData.status === "failed" || statusData.status === "cancelled") {
        return { success: false, error: `Crawl ${statusData.status}: ${statusData.error || "unknown"}` };
      }

      console.log(`[firecrawl] Crawl ${crawlId} status: ${statusData.status} (${statusData.completed || 0}/${statusData.total || "?"})`);
    }

    if (allPages.length === 0) {
      return { success: false, error: "Crawl completed but returned no pages (may have timed out)" };
    }

    const domain = extractDomain(url);
    const storedPages: { url: string; title: string; contentLength: number }[] = [];

    for (const page of allPages) {
      const markdown = page.markdown || "";
      if (!markdown.trim()) continue;

      const pageUrl = page.metadata?.sourceURL || page.url || url;
      const pageTitle = page.metadata?.title || "";

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
          .where(eq(scrapedPages.id, existing[0].id));
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

    console.log(`[firecrawl] Crawl complete: ${storedPages.length} pages stored from ${url}`);
    return { success: true, pagesScraped: storedPages.length, pages: storedPages };

  } catch (err: any) {
    return { success: false, error: `Crawl error: ${err.message}` };
  }
}

export async function firecrawlMapSite(
  url: string
): Promise<{ success: boolean; urls?: string[]; error?: string }> {
  const config = loadFirecrawlConfig();
  if (!config.enabled || !config.apiKey) {
    return { success: false, error: "Firecrawl not configured" };
  }

  try {
    const response = await fetch(`${config.baseUrl}/v1/map`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return { success: false, error: `Map failed HTTP ${response.status}: ${errText.slice(0, 200)}` };
    }

    const data = await response.json() as any;
    if (!data.success) {
      return { success: false, error: data.error || "Map failed" };
    }

    return { success: true, urls: (data.links || []).slice(0, 200) };
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

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);

    const response = await fetch(`${config.baseUrl}/v1/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        query,
        limit,
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return { success: false, error: `Firecrawl HTTP ${response.status}: ${errText.slice(0, 200)}` };
    }

    const data = await response.json() as any;
    if (!data.success) {
      return { success: false, error: data.error || "Firecrawl search failed" };
    }

    const results = (data.data || []).map((item: any) => ({
      title: item.metadata?.title || item.url || "",
      url: item.metadata?.sourceURL || item.url || "",
      markdown: (item.markdown || "").slice(0, 3000),
    }));

    return { success: true, results };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { success: false, error: `Firecrawl search timeout (${config.timeoutSeconds}s)` };
    }
    return { success: false, error: `Firecrawl search error: ${err.message}` };
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
