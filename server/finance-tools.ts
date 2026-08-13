const NEWSNOW_BASE = "https://newsnow.busiyi.world";
const EASTMONEY_KLINE_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const EASTMONEY_LIST_URL = "https://push2.eastmoney.com/api/qt/clist/get";
const EASTMONEY_UT = "fa5fd1943c7b386f172d6893dbfba10b";

const NEWS_SOURCES: Record<string, { name: string; category: string }> = {
  cls: { name: "Cailian Press", category: "finance" },
  wallstreetcn: { name: "WallStreetCN", category: "finance" },
  xueqiu: { name: "Xueqiu (Snowball)", category: "finance" },
  weibo: { name: "Weibo Hot", category: "social" },
  zhihu: { name: "Zhihu Hot", category: "social" },
  baidu: { name: "Baidu Hot", category: "social" },
  toutiao: { name: "Toutiao", category: "news" },
  thepaper: { name: "The Paper", category: "news" },
  "36kr": { name: "36Kr", category: "tech" },
  hackernews: { name: "Hacker News", category: "tech" },
};

interface NewsItem {
  rank: number;
  title: string;
  url: string;
  source: string;
  sourceName: string;
  publishTime?: string;
}

interface StockKline {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  changePercent: number;
}

interface StockInfo {
  code: string;
  name: string;
}

const newsCache = new Map<string, { time: number; data: NewsItem[] }>();
const CACHE_TTL_MS = 300_000;

function getSecId(ticker: string): string {
  if (ticker.length === 5 && /^\d+$/.test(ticker)) return `116.${ticker}`;
  if (ticker.startsWith("6") || ticker.startsWith("9")) return `1.${ticker}`;
  return `0.${ticker}`;
}

export async function fetchFinanceNews(
  sources?: string[],
  count: number = 10
): Promise<{ news: NewsItem[]; sourcesSummary: string }> {
  const defaults = ["cls", "wallstreetcn", "hackernews"];
  const validSources = sources?.filter(s => NEWS_SOURCES[s]) || [];
  const targetSources = validSources.length > 0 ? validSources : defaults;
  const allNews: NewsItem[] = [];

  const fetches = targetSources.map(async (sourceId) => {
    const cacheKey = `${sourceId}_${count}`;
    const cached = newsCache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const resp = await fetch(`${NEWSNOW_BASE}/api/s?id=${sourceId}`, {
        headers: { "User-Agent": "VisionClaw/1.0" },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const items: NewsItem[] = (data.items || []).slice(0, count).map((item: any, i: number) => ({
        rank: i + 1,
        title: item.title || "",
        url: item.url || "",
        source: sourceId,
        sourceName: NEWS_SOURCES[sourceId]?.name || sourceId,
        publishTime: item.publish_time || item.pubDate || undefined,
      }));

      newsCache.set(cacheKey, { time: Date.now(), data: items });
      return items;
    } catch (err: any) {
      console.error(`[finance-news] Failed to fetch ${sourceId}: ${err.message}`);
      if (cached) return cached.data;
      return [];
    }
  });

  const results = await Promise.all(fetches);
  for (const items of results) allNews.push(...items);

  const sourcesSummary = targetSources
    .map(s => `${NEWS_SOURCES[s]?.name || s} (${s})`)
    .join(", ");

  return { news: allNews, sourcesSummary };
}

export async function fetchStockPrice(
  ticker: string,
  days: number = 30
): Promise<{ ticker: string; klines: StockKline[]; summary: string }> {
  const safeTicker = String(ticker || "").trim();
  const safeDays = Number.isFinite(days) ? days : 30;

  if (!safeTicker || !/^[0-9]{4,6}$/.test(safeTicker)) {
    return { ticker: safeTicker, klines: [], summary: `Invalid ticker "${safeTicker}". Must be a 4-6 digit numeric code (e.g., '600519' for Moutai, '00700' for Tencent).` };
  }

  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - safeDays);
    const startStr = start.toISOString().slice(0, 10).replace(/-/g, "");
    const endStr = end.toISOString().slice(0, 10).replace(/-/g, "");

    const params = new URLSearchParams({
      secid: getSecId(safeTicker),
      fields1: "f1,f2,f3,f4,f5,f6",
      fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
      klt: "101",
      fqt: "1",
      beg: startStr,
      end: endStr,
      lmt: "1000",
      ut: EASTMONEY_UT,
    });

    const resp = await fetch(`${EASTMONEY_KLINE_URL}?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const data = json.data;
    if (!data || !data.klines || data.klines.length === 0) {
      return { ticker: safeTicker, klines: [], summary: `No data found for ticker ${safeTicker}. It may be invalid or delisted.` };
    }

    const stockName = data.name || safeTicker;
    const klines: StockKline[] = [];
    for (const k of data.klines) {
      const parts = String(k).split(",");
      if (parts.length < 9) continue;
      const open = parseFloat(parts[1]);
      const close = parseFloat(parts[2]);
      const high = parseFloat(parts[3]);
      const low = parseFloat(parts[4]);
      const volume = parseInt(parts[5]);
      const changePercent = parseFloat(parts[8]);
      if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
      klines.push({ date: parts[0], open, close, high, low, volume, changePercent });
    }

    if (klines.length === 0) {
      return { ticker: safeTicker, klines: [], summary: `Received data for ${safeTicker} but all rows were malformed.` };
    }

    const latest = klines[klines.length - 1];
    const first = klines[0];
    const periodChange = first.open > 0 ? ((latest.close - first.open) / first.open * 100).toFixed(2) : "N/A";
    const high = Math.max(...klines.map(k => k.high));
    const low = Math.min(...klines.map(k => k.low));

    const summary = `${stockName} (${safeTicker}): ${klines.length} trading days from ${first.date} to ${latest.date}. ` +
      `Latest close: ¥${latest.close.toFixed(2)}, period change: ${periodChange}%, ` +
      `range: ¥${low.toFixed(2)} - ¥${high.toFixed(2)}, latest volume: ${latest.volume.toLocaleString()}`;

    return { ticker: safeTicker, klines, summary };
  } catch (err: any) {
    return { ticker: safeTicker, klines: [], summary: `Failed to fetch stock data for ${safeTicker}: ${err.message}` };
  }
}

export async function searchStocks(
  query: string,
  market: string = "a"
): Promise<{ results: StockInfo[]; count: number }> {
  const fs = market === "hk"
    ? "m:128+t:3,m:128+t:4,m:128+t:1,m:128+t:2"
    : "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23";

  try {
    const params = new URLSearchParams({
      pn: "1",
      pz: "100",
      po: "1",
      np: "1",
      fltt: "2",
      invt: "2",
      fid: "f12",
      fs,
      fields: "f12,f14",
      ut: EASTMONEY_UT,
    });

    const resp = await fetch(`${EASTMONEY_LIST_URL}?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const diff = json.data?.diff || [];

    const queryLower = query.toLowerCase();
    const matches: StockInfo[] = diff
      .filter((item: any) => {
        const code = (item.f12 || "").toLowerCase();
        const name = (item.f14 || "").toLowerCase();
        return code.includes(queryLower) || name.includes(queryLower);
      })
      .slice(0, 20)
      .map((item: any) => ({
        code: item.f12 || "",
        name: item.f14 || "",
      }));

    return { results: matches, count: matches.length };
  } catch (err: any) {
    console.error(`[finance-stock] Search failed: ${err.message}`);
    return { results: [], count: 0 };
  }
}

export async function getMarketOverview(): Promise<{
  indices: { name: string; value: string; change: string }[];
  summary: string;
}> {
  try {
    const params = new URLSearchParams({
      pn: "1",
      pz: "20",
      po: "1",
      np: "1",
      fltt: "2",
      invt: "2",
      fid: "f3",
      fs: "m:1+s:2,m:0+t:5",
      fields: "f12,f14,f2,f3,f4",
      ut: EASTMONEY_UT,
    });

    const resp = await fetch(`${EASTMONEY_LIST_URL}?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const diff = json.data?.diff || [];

    const indices = diff.slice(0, 10).map((item: any) => ({
      name: item.f14 || "",
      value: String(item.f2 || ""),
      change: `${(item.f3 || 0) > 0 ? "+" : ""}${item.f3 || 0}%`,
    }));

    const summary = indices.map((i: any) => `${i.name}: ${i.value} (${i.change})`).join(" | ");

    return { indices, summary };
  } catch (err: any) {
    return { indices: [], summary: `Failed to fetch market overview: ${err.message}` };
  }
}
