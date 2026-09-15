import { retryFetch } from "./retry-utils";

import { logSilentCatch } from "./lib/silent-catch";
const USER_AGENT = "VisionClaw/1.0 (AI research platform)";

interface TrendItem {
  source: string;
  title: string;
  url: string;
  author?: string;
  date?: string;
  engagement?: {
    score?: number;
    comments?: number;
    likes?: number;
    reposts?: number;
    replies?: number;
    volume?: string;
  };
  relevance: number;
  summary?: string;
  topComments?: string[];
}

interface TrendReport {
  topic: string;
  days: number;
  sources: string[];
  items: TrendItem[];
  convergence: { theme: string; sources: string[]; count: number }[];
  summary: string;
  searchedAt: string;
}

const STOPWORDS = new Set([
  "the", "a", "an", "to", "for", "how", "is", "in", "of", "on",
  "and", "with", "from", "by", "at", "this", "that", "it", "my",
  "your", "i", "me", "we", "you", "what", "are", "do", "can",
  "its", "be", "or", "not", "no", "so", "if", "but", "about",
  "all", "just", "get", "has", "have", "was", "will",
]);

const LOW_SIGNAL = new Set([
  "best", "latest", "news", "review", "reviews", "update", "updates",
  "guide", "tutorial", "tips", "opinion", "predictions", "vs",
]);

const VALID_SOURCES = new Set(["reddit", "hackernews", "polymarket", "x"]);

const DEPTH_LIMITS: Record<string, { perSource: number; maxTotal: number }> = {
  quick: { perSource: 10, maxTotal: 25 },
  default: { perSource: 25, maxTotal: 50 },
  deep: { perSource: 50, maxTotal: 100 },
};

function tokenize(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/);
  return new Set(words.filter(w => w.length > 1 && !STOPWORDS.has(w)));
}

function tokenOverlapRelevance(query: string, text: string): number {
  const qTokens = tokenize(query);
  const tTokens = tokenize(text);
  if (qTokens.size === 0) return 0.5;

  const overlap = new Set([...qTokens].filter(t => tTokens.has(t)));
  if (overlap.size === 0) return 0;

  const informative = new Set([...qTokens].filter(t => !LOW_SIGNAL.has(t)));
  const infoSet = informative.size > 0 ? informative : qTokens;
  const infoOverlap = new Set([...infoSet].filter(t => tTokens.has(t)));

  const coverage = overlap.size / qTokens.size;
  const infoCoverage = infoOverlap.size / infoSet.size;
  const precision = overlap.size / Math.min(tTokens.size, qTokens.size + 4 || 1);

  const normalized = query.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const normalizedText = text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const phraseBonus = normalizedText.includes(normalized) ? 0.12 : 0;

  if (informative.size > 0 && infoOverlap.size === 0) {
    return Math.min(0.24, 0.55 * Math.pow(coverage, 1.35) + 0.25 * infoCoverage + 0.20 * precision);
  }

  return Math.min(1.0, 0.55 * Math.pow(coverage, 1.35) + 0.25 * infoCoverage + 0.20 * precision + phraseBonus);
}

function log1p(x: number | undefined | null): number {
  if (!x || x < 0) return 0;
  return Math.log1p(x);
}

function getDateRange(days: number): { from: string; to: string; fromTs: number; toTs: number } {
  const now = new Date();
  const from = new Date(now.getTime() - days * 86400000);
  return {
    from: from.toISOString().split("T")[0],
    to: now.toISOString().split("T")[0],
    fromTs: Math.floor(from.getTime() / 1000),
    toTs: Math.floor(now.getTime() / 1000),
  };
}

function isWithinDateRange(dateStr: string | undefined, fromTs: number): boolean {
  if (!dateStr) return true;
  const ts = new Date(dateStr).getTime() / 1000;
  return ts >= fromTs;
}

async function searchReddit(topic: string, days: number, limit: number): Promise<TrendItem[]> {
  const encoded = encodeURIComponent(topic);
  const timeFilter = days <= 7 ? "week" : days <= 30 ? "month" : "year";
  const fetchLimit = Math.min(limit, 100);
  const url = `https://www.reddit.com/search.json?q=${encoded}&sort=relevance&t=${timeFilter}&limit=${fetchLimit}`;
  const { fromTs } = getDateRange(days);

  try {
    const resp = await retryFetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
      retries: 2,
      delayMs: 2000,
      timeoutMs: 15000,
    });

    if (!resp.ok) return [];
    const data = await resp.json();
    return parseRedditResponse(data, topic, fromTs);
  } catch (err: any) {
    console.warn(`[trend-research] Reddit search failed: ${err.message}`);
    return [];
  }
}

function parseRedditResponse(data: any, topic: string, fromTs: number): TrendItem[] {
  const children = data?.data?.children || [];
  return children
    .filter((c: any) => c.kind === "t3" && c.data)
    .map((c: any) => {
      const d = c.data;
      const dateStr = new Date(d.created_utc * 1000).toISOString().split("T")[0];
      const relevance = tokenOverlapRelevance(topic, `${d.title} ${d.selftext?.slice(0, 200) || ""}`);
      return {
        source: "reddit",
        title: d.title,
        url: `https://reddit.com${d.permalink}`,
        author: d.author,
        date: dateStr,
        engagement: {
          score: d.score,
          comments: d.num_comments,
        },
        relevance: Math.round(relevance * 100) / 100,
        summary: d.selftext?.slice(0, 200) || undefined,
        _createdUtc: d.created_utc,
      } as TrendItem & { _createdUtc: number };
    })
    .filter((item: any) => item.relevance >= 0.2 && item._createdUtc >= fromTs)
    .map(({ _createdUtc, ...item }: any) => item as TrendItem);
}

async function searchHackerNews(topic: string, days: number, limit: number): Promise<TrendItem[]> {
  const { fromTs, toTs } = getDateRange(days);
  const core = topic.replace(/^(what|how|tell me about|research)\s+(is|are|people saying about)?\s*/i, "").trim();
  const fetchLimit = Math.min(limit, 100);
  const params = new URLSearchParams({
    query: core,
    tags: "story",
    numericFilters: `created_at_i>${fromTs},created_at_i<${toTs},points>2`,
    hitsPerPage: String(fetchLimit),
  });

  try {
    const resp = await retryFetch(`https://hn.algolia.com/api/v1/search?${params}`, {
      retries: 2,
      delayMs: 1000,
      timeoutMs: 15000,
    });
    if (!resp.ok) return [];

    const data = await resp.json();
    const hits = data.hits || [];

    return hits.map((hit: any, i: number) => {
      const points = hit.points || 0;
      const numComments = hit.num_comments || 0;
      const dateStr = hit.created_at_i ? new Date(hit.created_at_i * 1000).toISOString().split("T")[0] : undefined;
      const rankScore = Math.max(0.3, 1.0 - i * 0.02);
      const contentScore = tokenOverlapRelevance(topic, hit.title || "");
      const engagementBoost = Math.min(0.2, log1p(points) / 40);
      const relevance = Math.min(1.0, 0.6 * rankScore + 0.4 * contentScore + engagementBoost);

      return {
        source: "hackernews",
        title: hit.title || "",
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        author: hit.author,
        date: dateStr,
        engagement: { score: points, comments: numComments },
        relevance: Math.round(relevance * 100) / 100,
        summary: `HN discussion with ${points} points and ${numComments} comments`,
      } as TrendItem;
    }).filter((item: TrendItem) => item.relevance >= 0.2);
  } catch (err: any) {
    console.warn(`[trend-research] HN search failed: ${err.message}`);
    return [];
  }
}

async function searchPolymarket(topic: string, limit: number): Promise<TrendItem[]> {
  const core = topic.replace(/^(what|how|tell me about|research)\s+(is|are|people saying about)?\s*/i, "").trim();
  const queries = [core];
  const words = core.split(/\s+/);
  if (words.length >= 2) {
    for (const w of words) {
      if (w.length > 2 && !LOW_SIGNAL.has(w.toLowerCase())) queries.push(w);
    }
  }
  const unique = [...new Set(queries)].slice(0, 4);

  const allEvents: Map<string, any> = new Map();

  for (const q of unique) {
    try {
      const params = new URLSearchParams({ q, page: "1", events_status: "active", keep_closed_markets: "0" });
      const resp = await retryFetch(`https://gamma-api.polymarket.com/public-search?${params}`, {
        retries: 1,
        delayMs: 1000,
        timeoutMs: 15000,
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const events = data.events || data || [];
      for (const event of (Array.isArray(events) ? events : [])) {
        const id = event.id || event.slug;
        if (id && !allEvents.has(id)) allEvents.set(id, event);
      }
    } catch (_silentErr) { logSilentCatch("server/trend-research.ts", _silentErr); }
  }

  const items: TrendItem[] = [];
  for (const [, event] of allEvents) {
    const title = event.title || event.question || "";
    const relevance = tokenOverlapRelevance(topic, title);
    if (relevance < 0.15) continue;

    const markets = event.markets || [];
    const topMarket = markets[0];
    const volume = topMarket?.volume_24hr || topMarket?.volume || event.volume;

    items.push({
      source: "polymarket",
      title,
      url: `https://polymarket.com/event/${event.slug || event.id}`,
      date: event.startDate?.split("T")[0] || undefined,
      engagement: { volume: volume ? `$${Number(volume).toLocaleString()}` : undefined },
      relevance: Math.round(relevance * 100) / 100,
      summary: topMarket ? `Current odds: ${(Number(topMarket.outcomePrices?.[0] || topMarket.bestBid || 0) * 100).toFixed(0)}%` : undefined,
    });
  }

  return items.sort((a, b) => b.relevance - a.relevance).slice(0, limit);
}

async function searchXviaXAI(topic: string, days: number, limit: number): Promise<TrendItem[]> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return [];

  const { from, to } = getDateRange(days);
  const fetchCount = Math.min(limit, 25);

  try {
    const resp = await retryFetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4",  // R81 — xAI direct (uses native /v1/responses + web_search tool, NOT routed via OR registry)
        tools: [{ type: "web_search" }],
        input: `Search X/Twitter for posts about: ${topic}\n\nFocus on posts from ${from} to ${to}. Find ${fetchCount} high-quality, relevant posts.\n\nReturn ONLY valid JSON:\n{"items": [{"text": "Post text", "url": "https://x.com/...", "author_handle": "username", "date": "YYYY-MM-DD", "engagement": {"likes": 100, "reposts": 25}, "why_relevant": "Brief explanation", "relevance": 0.85}]}`,
      }),
      retries: 1,
      delayMs: 2000,
      timeoutMs: 45000,
    });

    if (!resp.ok) {
      console.warn(`[trend-research] xAI search failed: ${resp.status}`);
      return [];
    }

    const data = await resp.json();
    const outputText = data.output?.find((o: any) => o.type === "message")?.content?.find((c: any) => c.type === "output_text")?.text || "";
    const jsonMatch = outputText.match(/\{[\s\S]*"items"[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    return (parsed.items || []).map((item: any) => ({
      source: "x",
      title: (item.text || "").slice(0, 200),
      url: item.url || "",
      author: item.author_handle,
      date: item.date,
      engagement: {
        likes: item.engagement?.likes,
        reposts: item.engagement?.reposts,
        replies: item.engagement?.replies,
      },
      relevance: item.relevance || 0.5,
      summary: item.why_relevant,
    } as TrendItem)).filter((i: TrendItem) => i.url);
  } catch (err: any) {
    console.warn(`[trend-research] xAI X search failed: ${err.message}`);
    return [];
  }
}

function deduplicateItems(items: TrendItem[]): TrendItem[] {
  const seen = new Map<string, { ngrams: Set<string>; item: TrendItem }>();

  for (const item of items) {
    const normalized = item.title.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    const ngrams = new Set<string>();
    for (let i = 0; i < normalized.length - 2; i++) {
      ngrams.add(normalized.substring(i, i + 3));
    }

    let isDupe = false;
    for (const [key, existing] of seen) {
      const intersection = new Set([...ngrams].filter(n => existing.ngrams.has(n)));
      const unionSize = ngrams.size + existing.ngrams.size - intersection.size;
      const similarity = unionSize > 0 ? intersection.size / unionSize : 0;

      if (similarity > 0.6) {
        if (item.relevance > existing.item.relevance) {
          seen.delete(key);
          seen.set(normalized, { ngrams, item });
        }
        isDupe = true;
        break;
      }
    }

    if (!isDupe) {
      seen.set(normalized, { ngrams, item });
    }
  }

  return [...seen.values()].map(v => v.item);
}

function detectConvergence(items: TrendItem[]): { theme: string; sources: string[]; count: number }[] {
  const themes: Map<string, { sources: Set<string>; count: number }> = new Map();

  for (const item of items) {
    const tokens = tokenize(item.title);
    const significant = [...tokens].filter(t => !LOW_SIGNAL.has(t) && t.length > 3);

    for (const token of significant) {
      if (!themes.has(token)) {
        themes.set(token, { sources: new Set(), count: 0 });
      }
      const entry = themes.get(token)!;
      entry.sources.add(item.source);
      entry.count++;
    }
  }

  return [...themes.entries()]
    .filter(([, v]) => v.sources.size >= 2 && v.count >= 3)
    .map(([theme, v]) => ({ theme, sources: [...v.sources], count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export async function trendResearch(params: {
  topic: string;
  days?: number;
  sources?: string[];
  depth?: "quick" | "default" | "deep";
  maxResults?: number;
}): Promise<TrendReport> {
  const topic = (params.topic || "").trim();
  if (!topic) {
    return { topic: "", days: 0, sources: [], items: [], convergence: [], summary: "No topic provided.", searchedAt: new Date().toISOString() };
  }

  const days = Math.max(1, Math.min(365, params.days || 30));
  const depth = (params.depth && DEPTH_LIMITS[params.depth]) ? params.depth : "default";
  const limits = DEPTH_LIMITS[depth];
  const maxResults = Math.max(1, Math.min(200, params.maxResults || limits.maxTotal));

  const rawSources = params.sources || ["reddit", "hackernews", "polymarket", "x"];
  const requestedSources = rawSources.filter(s => VALID_SOURCES.has(s));
  if (requestedSources.length === 0) requestedSources.push("reddit", "hackernews");

  console.log(`[trend-research] Searching "${topic}" across ${requestedSources.join(", ")} (${days} days, ${depth}, max ${maxResults})`);

  const searches: Promise<TrendItem[]>[] = [];
  const activeSources: string[] = [];

  if (requestedSources.includes("reddit")) {
    searches.push(searchReddit(topic, days, limits.perSource));
    activeSources.push("reddit");
  }
  if (requestedSources.includes("hackernews")) {
    searches.push(searchHackerNews(topic, days, limits.perSource));
    activeSources.push("hackernews");
  }
  if (requestedSources.includes("polymarket")) {
    searches.push(searchPolymarket(topic, limits.perSource));
    activeSources.push("polymarket");
  }
  if (requestedSources.includes("x")) {
    searches.push(searchXviaXAI(topic, days, limits.perSource));
    activeSources.push("x");
  }

  const results = await Promise.allSettled(searches);
  let allItems: TrendItem[] = [];

  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      console.log(`[trend-research] ${activeSources[i]}: ${result.value.length} items`);
      allItems.push(...result.value);
    } else {
      console.warn(`[trend-research] ${activeSources[i]} failed: ${result.reason}`);
    }
  });

  allItems = deduplicateItems(allItems);

  allItems.sort((a, b) => {
    const aScore = a.relevance * 0.45 + Math.min(1, log1p(a.engagement?.score || a.engagement?.likes || 0) / 10) * 0.30 + (a.date ? 0.25 : 0);
    const bScore = b.relevance * 0.45 + Math.min(1, log1p(b.engagement?.score || b.engagement?.likes || 0) / 10) * 0.30 + (b.date ? 0.25 : 0);
    return bScore - aScore;
  });

  allItems = allItems.slice(0, maxResults);
  const convergence = detectConvergence(allItems);

  const sourceCounts: Record<string, number> = {};
  for (const item of allItems) {
    sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
  }

  const summary = [
    `Found ${allItems.length} relevant items about "${topic}" from the last ${days} days.`,
    `Sources: ${Object.entries(sourceCounts).map(([s, c]) => `${s} (${c})`).join(", ")}.`,
    convergence.length > 0
      ? `Cross-platform themes: ${convergence.slice(0, 3).map(c => `"${c.theme}" (${c.sources.join("+")})`).join(", ")}.`
      : "",
  ].filter(Boolean).join(" ");

  return {
    topic,
    days,
    sources: activeSources,
    items: allItems,
    convergence,
    summary,
    searchedAt: new Date().toISOString(),
  };
}
