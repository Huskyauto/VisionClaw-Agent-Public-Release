import { getClientForModel } from "./providers";

import { logSilentCatch } from "./lib/silent-catch";
export interface PriceBar { date: string; open: number; high: number; low: number; close: number; volume: number; }
export interface ForecastResult {
  symbol: string;
  horizonDays: number;
  trend: "bullish" | "bearish" | "neutral";
  confidence: number;
  reasoning: string;
  recentBars: PriceBar[];
  asOf: string;
}
export interface PortfolioAnalysis {
  totalValueUsd: number;
  positions: Array<{ symbol: string; shares: number; lastPrice: number; valueUsd: number; weightPct: number; }>;
  concentrationRisk: string;
  diversificationScore: number;
  recommendations: string[];
  asOf: string;
}

const MARKET_DATA_TIMEOUT_MS = 8_000;
const MAX_BARS = 90;

function normalizeStooqSymbol(symbol: string): string {
  const s = symbol.trim().toLowerCase();
  if (s.includes(".")) return s;
  if (/^[a-z]+$/.test(s) && s.length <= 5) return `${s}.us`;
  return s;
}

const STOOQ_CACHE = new Map<string, { bars: PriceBar[]; expiresAt: number }>();
const STOOQ_CACHE_TTL_MS = 5 * 60 * 1000;

function normalizeYahooSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.US$/i, "").replace(".", "-");
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positivePrice(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function isValidOhlc(open: number, high: number, low: number, close: number): boolean {
  return low <= open && low <= close && high >= open && high >= close;
}

function toPriceBars(payload: unknown, symbol: string): PriceBar[] {
  const result = (payload as any)?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp;
  if (!Array.isArray(timestamps) || !quote || !Array.isArray(quote.close)) {
    const reason = (payload as any)?.chart?.error?.description;
    throw new Error(reason ? `Yahoo returned no price history: ${String(reason).slice(0, 160)}` : `Yahoo returned no price history for "${symbol}"`);
  }

  const bars: PriceBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const timestamp = Number(timestamps[i]);
    const open = positivePrice(quote.open?.[i]);
    const high = positivePrice(quote.high?.[i]);
    const low = positivePrice(quote.low?.[i]);
    const close = positivePrice(quote.close[i]);
    if (!Number.isFinite(timestamp) || open === null || high === null || low === null || close === null || !isValidOhlc(open, high, low, close)) continue;
    bars.push({
      date: new Date(timestamp * 1_000).toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume: finiteNumber(quote.volume?.[i]) || 0,
    });
  }
  if (!bars.length) throw new Error(`Yahoo returned no usable daily bars for "${symbol}"`);
  return bars.slice(-MAX_BARS);
}

async function fetchYahooHistory(symbol: string): Promise<PriceBar[]> {
  const yahooSymbol = normalizeYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=6mo&interval=1d&events=history`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MARKET_DATA_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "VisionClaw-Treasury/1.0", Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
    return toPriceBars(await res.json(), symbol);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStooqHistory(symbol: string): Promise<PriceBar[]> {
  const stooqSym = normalizeStooqSymbol(symbol);
  const apikey = process.env.STOOQ_API_KEY;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSym)}&i=d${apikey ? `&apikey=${encodeURIComponent(apikey)}` : ""}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), MARKET_DATA_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "VisionClaw-Treasury/1.0" } });
    if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);
    const csv = await res.text();
    if (!csv || csv.startsWith("No data") || csv.length < 50) {
      throw new Error(`No data for symbol "${symbol}" (tried "${stooqSym}")`);
    }
    const lines = csv.trim().split("\n");
    const header = lines[0].toLowerCase();
    if (!header.includes("date") || !header.includes("close")) {
      throw new Error("Stooq returned a non-CSV response");
    }
    const bars: PriceBar[] = [];
    for (const line of lines.slice(1)) {
      const cols = line.split(",");
      if (cols.length < 6) continue;
      const date = cols[0].trim();
      const open = positivePrice(cols[1]);
      const high = positivePrice(cols[2]);
      const low = positivePrice(cols[3]);
      const close = positivePrice(cols[4]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || open === null || high === null || low === null || close === null || !isValidOhlc(open, high, low, close)) continue;
      bars.push({
        date,
        open,
        high,
        low,
        close,
        volume: finiteNumber(cols[5]) || 0,
      });
    }
    if (!bars.length) throw new Error(`No usable price history for symbol "${symbol}" from Stooq`);
    return bars.slice(-MAX_BARS);
  } finally {
    clearTimeout(t);
  }
}

export async function fetchPriceHistory(symbol: string): Promise<PriceBar[]> {
  const cacheKey = normalizeYahooSymbol(symbol);
  const cached = STOOQ_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.bars;

  let bars: PriceBar[];
  try {
    bars = await fetchYahooHistory(symbol);
  } catch (yahooError) {
    try {
      bars = await fetchStooqHistory(symbol);
    } catch (stooqError) {
      throw new Error(`Market data unavailable for "${symbol}": Yahoo (${(yahooError as Error).message}); Stooq (${(stooqError as Error).message})`);
    }
  }

  STOOQ_CACHE.set(cacheKey, { bars, expiresAt: Date.now() + STOOQ_CACHE_TTL_MS });
  return bars;
}

function safeParseJsonObject(raw: string): any {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (_silentErr) { logSilentCatch("server/treasury.ts", _silentErr); }
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch (_silentErr) { logSilentCatch("server/treasury.ts", _silentErr); }
  }
  return {};
}

function summarizeBars(bars: PriceBar[]): { sma20: number; sma50: number; volatilityPct: number; periodReturnPct: number; recent: PriceBar[] } {
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const sma = (k: number) => {
    if (n < k) return 0;
    const slice = closes.slice(-k);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  };
  const sma20 = sma(20), sma50 = sma(50);
  const returns = closes.slice(1).map((c, i) => (c - closes[i]) / closes[i]);
  const mean = returns.reduce((a, b) => a + b, 0) / Math.max(returns.length, 1);
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(returns.length, 1);
  const volatilityPct = Math.sqrt(variance) * Math.sqrt(252) * 100;
  const periodReturnPct = n >= 2 ? ((closes[n - 1] - closes[0]) / closes[0]) * 100 : 0;
  return { sma20, sma50, volatilityPct, periodReturnPct, recent: bars.slice(-10) };
}

export async function forecastTicker(symbol: string, horizonDays: number = 30, tenantId?: number): Promise<ForecastResult> {
  const bars = await fetchPriceHistory(symbol);
  if (bars.length < 5) {
    throw new Error(`Insufficient price history for ${symbol} (got ${bars.length} bars, need >=5)`);
  }
  const stats = summarizeBars(bars);
  const lastClose = bars[bars.length - 1].close;
  const horizon = Math.max(1, Math.min(horizonDays, 365));

  const prompt = `You are a quantitative market analyst. Given the technical snapshot below, output a directional forecast for the next ${horizon} trading days. Be calibrated; do NOT pretend to predict exact prices.

Symbol: ${symbol.toUpperCase()}
Bars analyzed: ${bars.length} daily
Last close: $${lastClose.toFixed(2)}
20-day SMA: $${stats.sma20.toFixed(2)}
50-day SMA: $${stats.sma50.toFixed(2)}
Annualized volatility: ${stats.volatilityPct.toFixed(1)}%
Period return: ${stats.periodReturnPct.toFixed(2)}%

Recent 10 closes: ${stats.recent.map(b => `${b.date}=$${b.close.toFixed(2)}`).join(", ")}

Respond as STRICT JSON with this schema (no markdown, no commentary outside JSON):
{"trend":"bullish"|"bearish"|"neutral","confidence":0.0-1.0,"reasoning":"2-3 sentences citing specific indicators above"}`;

  const { client, actualModelId } = await getClientForModel("gpt-5-mini", tenantId);
  const r = await client.chat.completions.create({
    model: actualModelId,
    messages: [
      { role: "system", content: "You are a calibrated market analyst. Output strict JSON only. NEVER guarantee prices." },
      { role: "user", content: prompt },
    ],
    max_tokens: 400,
    temperature: 0.2,
    response_format: { type: "json_object" },
  });
  const raw = r?.choices?.[0]?.message?.content || "{}";
  let parsed: any = safeParseJsonObject(raw);
  if (!parsed || typeof parsed !== "object" || !("trend" in parsed)) {
    parsed = { trend: "neutral", confidence: 0, reasoning: "LLM returned unparseable output: " + raw.slice(0, 100) };
  }
  const trend = (["bullish", "bearish", "neutral"].includes(parsed.trend) ? parsed.trend : "neutral") as ForecastResult["trend"];
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));

  return {
    symbol: symbol.toUpperCase(),
    horizonDays: horizon,
    trend, confidence,
    reasoning: String(parsed.reasoning || "").slice(0, 800),
    recentBars: stats.recent,
    asOf: new Date().toISOString(),
  };
}

export async function analyzePortfolio(holdings: Array<{ symbol: string; shares: number }>, tenantId?: number): Promise<PortfolioAnalysis> {
  if (!Array.isArray(holdings) || holdings.length === 0) {
    throw new Error("holdings must be a non-empty array of {symbol, shares}");
  }
  const trimmed = holdings.slice(0, 25);
  const positions: PortfolioAnalysis["positions"] = [];

  for (const h of trimmed) {
    if (!h.symbol || typeof h.shares !== "number" || h.shares <= 0) continue;
    try {
      const bars = await fetchPriceHistory(h.symbol);
      const lastPrice = bars.at(-1)?.close;
      if (!Number.isFinite(lastPrice) || !lastPrice || lastPrice <= 0) {
        throw new Error("no valid latest closing price");
      }
      positions.push({
        symbol: h.symbol.toUpperCase(),
        shares: h.shares,
        lastPrice,
        valueUsd: lastPrice * h.shares,
        weightPct: 0,
      });
    } catch (e) {
      throw new Error(`Unable to price ${h.symbol.toUpperCase()}: ${(e as Error).message}`);
    }
  }
  const totalValueUsd = positions.reduce((a, p) => a + p.valueUsd, 0);
  for (const p of positions) p.weightPct = totalValueUsd > 0 ? (p.valueUsd / totalValueUsd) * 100 : 0;
  const sorted = [...positions].sort((a, b) => b.weightPct - a.weightPct);
  const top1 = sorted[0]?.weightPct || 0;
  const top3 = sorted.slice(0, 3).reduce((a, p) => a + p.weightPct, 0);
  const concentrationRisk = top1 > 50 ? "HIGH" : top3 > 75 ? "MODERATE" : "LOW";
  const hhi = positions.reduce((a, p) => a + (p.weightPct / 100) ** 2, 0);
  const diversificationScore = Math.max(0, Math.min(100, Math.round((1 - hhi) * 100)));

  const summary = positions.map(p => `${p.symbol}: ${p.shares} sh @ $${p.lastPrice.toFixed(2)} = $${p.valueUsd.toFixed(2)} (${p.weightPct.toFixed(1)}%)`).join("\n");
  let recommendations: string[] = [];
  try {
    const { client, actualModelId } = await getClientForModel("gpt-5-mini", tenantId);
    const r = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: "You are a portfolio analyst. Output strict JSON only. NEVER give buy/sell advice — only structural observations." },
        { role: "user", content: `Portfolio total: $${totalValueUsd.toFixed(2)}\nConcentration: ${concentrationRisk} (top=${top1.toFixed(1)}%, top3=${top3.toFixed(1)}%)\nDiversification score: ${diversificationScore}/100\n\n${summary}\n\nReturn STRICT JSON: {"recommendations":["str", ...]} with 3-5 short structural recommendations (rebalancing, sector exposure, position-sizing). NO buy/sell advice.` },
      ],
      max_tokens: 500, temperature: 0.3,
      response_format: { type: "json_object" },
    });
    const parsed = safeParseJsonObject(r?.choices?.[0]?.message?.content || "{}");
    recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 5).map(String) : [];
  } catch (e) {
    recommendations = [`(advisor LLM unavailable: ${(e as Error).message})`];
  }

  return {
    totalValueUsd: Math.round(totalValueUsd * 100) / 100,
    positions, concentrationRisk, diversificationScore, recommendations,
    asOf: new Date().toISOString(),
  };
}
