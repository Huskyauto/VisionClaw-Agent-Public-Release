import { db } from "./db";
import { sql } from "drizzle-orm";

interface RateLimitConfig {
  maxPerMinute: number;
  maxPerHour: number;
  maxPerDay: number;
}

const EXPENSIVE_TOOLS: Record<string, RateLimitConfig> = {
  deep_research:        { maxPerMinute: 1, maxPerHour: 5,  maxPerDay: 15 },
  produce_video:        { maxPerMinute: 1, maxPerHour: 3,  maxPerDay: 10 },
  generate_audio:       { maxPerMinute: 2, maxPerHour: 10, maxPerDay: 30 },
  create_slideshow_video: { maxPerMinute: 1, maxPerHour: 5,  maxPerDay: 15 },
  browser:              { maxPerMinute: 3, maxPerHour: 20, maxPerDay: 60 },
  firecrawl_crawl:      { maxPerMinute: 2, maxPerHour: 10, maxPerDay: 40 },
  firecrawl_scrape:     { maxPerMinute: 5, maxPerHour: 30, maxPerDay: 100 },
  orchestrate:          { maxPerMinute: 1, maxPerHour: 5,  maxPerDay: 20 },
  plan_and_execute:     { maxPerMinute: 1, maxPerHour: 5,  maxPerDay: 20 },
  debate:               { maxPerMinute: 1, maxPerHour: 5,  maxPerDay: 15 },
  tree_of_thought:      { maxPerMinute: 1, maxPerHour: 5,  maxPerDay: 15 },
  analyze_pdf:          { maxPerMinute: 3, maxPerHour: 15, maxPerDay: 50 },
  web_search:           { maxPerMinute: 8, maxPerHour: 40, maxPerDay: 150 },
  web_fetch:            { maxPerMinute: 8, maxPerHour: 40, maxPerDay: 150 },
  finance_news:         { maxPerMinute: 3, maxPerHour: 15, maxPerDay: 60 },
  finance_stock_price:  { maxPerMinute: 5, maxPerHour: 30, maxPerDay: 100 },
  finance_stock_search: { maxPerMinute: 5, maxPerHour: 20, maxPerDay: 80 },
  finance_market_overview: { maxPerMinute: 3, maxPerHour: 12, maxPerDay: 40 },
  generate_social_image: { maxPerMinute: 2, maxPerHour: 10, maxPerDay: 30 },
};

const HIGHER_LIMIT_TOOLS: Record<string, RateLimitConfig> = {
  project:   { maxPerMinute: 20, maxPerHour: 120, maxPerDay: 400 },
  exec:      { maxPerMinute: 15, maxPerHour: 80,  maxPerDay: 300 },
  read_file: { maxPerMinute: 20, maxPerHour: 120, maxPerDay: 400 },
};

const DEFAULT_LIMIT: RateLimitConfig = { maxPerMinute: 10, maxPerHour: 60, maxPerDay: 200 };

interface UsageEntry {
  timestamp: number;
}

const usageCache = new Map<string, UsageEntry[]>();

const CLEANUP_INTERVAL_MS = 300_000;
let lastCleanup = Date.now();

function cleanupStaleEntries(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  const dayAgo = now - 86_400_000;
  for (const [key, entries] of usageCache) {
    const filtered = entries.filter(e => e.timestamp > dayAgo);
    if (filtered.length === 0) {
      usageCache.delete(key);
    } else {
      usageCache.set(key, filtered);
    }
  }
}

function getCacheKey(tenantId: number, toolName: string): string {
  return `${tenantId}:${toolName}`;
}

function countInWindow(entries: UsageEntry[], windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  return entries.filter(e => e.timestamp > cutoff).length;
}

export function checkToolRateLimit(
  tenantId: number,
  toolName: string
): { allowed: boolean; reason?: string; retryAfterMs?: number } {
  cleanupStaleEntries();

  const config = EXPENSIVE_TOOLS[toolName] || HIGHER_LIMIT_TOOLS[toolName] || DEFAULT_LIMIT;
  const key = getCacheKey(tenantId, toolName);
  const entries = usageCache.get(key) || [];

  const lastMinute = countInWindow(entries, 60_000);
  if (lastMinute >= config.maxPerMinute) {
    const oldestInWindow = entries
      .filter(e => e.timestamp > Date.now() - 60_000)
      .sort((a, b) => a.timestamp - b.timestamp)[0];
    const retryAfterMs = oldestInWindow
      ? (oldestInWindow.timestamp + 60_000) - Date.now()
      : 60_000;
    return {
      allowed: false,
      reason: `Rate limit: "${toolName}" called ${lastMinute}/${config.maxPerMinute} times in the last minute. Wait ${Math.ceil(retryAfterMs / 1000)}s.`,
      retryAfterMs,
    };
  }

  const lastHour = countInWindow(entries, 3_600_000);
  if (lastHour >= config.maxPerHour) {
    return {
      allowed: false,
      reason: `Rate limit: "${toolName}" called ${lastHour}/${config.maxPerHour} times in the last hour. Try a different approach or wait.`,
      retryAfterMs: 300_000,
    };
  }

  const lastDay = countInWindow(entries, 86_400_000);
  if (lastDay >= config.maxPerDay) {
    return {
      allowed: false,
      reason: `Daily limit: "${toolName}" called ${lastDay}/${config.maxPerDay} times today. Use a different tool or wait until tomorrow.`,
      retryAfterMs: 3_600_000,
    };
  }

  return { allowed: true };
}

export function recordToolUsage(tenantId: number, toolName: string): void {
  const key = getCacheKey(tenantId, toolName);
  const entries = usageCache.get(key) || [];
  entries.push({ timestamp: Date.now() });
  usageCache.set(key, entries);
}

export function getToolUsageStats(tenantId: number, toolName?: string): Record<string, { lastMinute: number; lastHour: number; lastDay: number; limit: RateLimitConfig }> {
  const stats: Record<string, { lastMinute: number; lastHour: number; lastDay: number; limit: RateLimitConfig }> = {};

  for (const [key, entries] of usageCache) {
    if (!key.startsWith(`${tenantId}:`)) continue;
    const tool = key.split(":")[1];
    if (toolName && tool !== toolName) continue;

    stats[tool] = {
      lastMinute: countInWindow(entries, 60_000),
      lastHour: countInWindow(entries, 3_600_000),
      lastDay: countInWindow(entries, 86_400_000),
      limit: EXPENSIVE_TOOLS[tool] || HIGHER_LIMIT_TOOLS[tool] || DEFAULT_LIMIT,
    };
  }

  return stats;
}

export function getRateLimitConfig(toolName: string): RateLimitConfig {
  return EXPENSIVE_TOOLS[toolName] || HIGHER_LIMIT_TOOLS[toolName] || DEFAULT_LIMIT;
}

export function isExpensiveTool(toolName: string): boolean {
  return toolName in EXPENSIVE_TOOLS;
}
