import { db } from "./db";
import { sql } from "drizzle-orm";

interface RateLimitConfig {
  maxPerMinute: number;
  maxPerHour: number;
  maxPerDay: number;
}

const EXPENSIVE_TOOLS: Record<string, RateLimitConfig> = {
  deep_research:        { maxPerMinute: 1, maxPerHour: 5,  maxPerDay: 15 },
  // R125+129 follow-up — evidence-docket assembly fans out to many tenant-scoped
  // DB queries + markdown/HTML render and is registered very_slow; throttle to
  // match deep_research so it can't be hammered from any persona surface.
  generate_evidence_docket: { maxPerMinute: 1, maxPerHour: 5, maxPerDay: 20 },
  // R125+45 — generate_design_doc fans out to external fetches + a synthesis LLM
  // pass under a 90s deadline and is ALWAYS_INCLUDE (reachable from every persona,
  // incl. low-trust/public surfaces). Without an explicit cap it fell to the
  // default 10/min — a cost/abuse gap. Throttle to match deep_research.
  generate_design_doc:  { maxPerMinute: 1, maxPerHour: 5,  maxPerDay: 20 },
  // R109 — Monid is paid-per-call against an org-level API key shared across all tenants.
  // Without an explicit ceiling a runaway agent could burn org credit fast; throttle hard.
  // discover/inspect are catalog reads (cheap, but still external HTTP); run is the spender.
  monid_run:            { maxPerMinute: 2, maxPerHour: 10, maxPerDay: 50 },
  monid_discover:       { maxPerMinute: 5, maxPerHour: 30, maxPerDay: 150 },
  monid_inspect:        { maxPerMinute: 8, maxPerHour: 40, maxPerDay: 200 },
  ensemble_query:       { maxPerMinute: 2, maxPerHour: 10, maxPerDay: 30 },
  // R74.13z-bis: each recursive_synthesize run can fan out to 50 sub-calls and
  // hold the modelfarm semaphore for ~30-90s. Free-tier today, but throttle
  // matches deep_research to keep the platform responsive if many personas
  // reach for it at once.
  recursive_synthesize: { maxPerMinute: 1, maxPerHour: 5,  maxPerDay: 15 },
  produce_video:        { maxPerMinute: 1, maxPerHour: 3,  maxPerDay: 10 },
  // R110.6 — bumped from 2/10/30 (set when ElevenLabs was primary and expensive).
  // Fish Audio s2-pro is now primary (R110.3) at ~$0.001/scene with ~10 req/s
  // headroom. Old limits made `mpeg_produce_parallel` impossible: a 6-scene video
  // fired 6 parallel TTS calls, only 2 won the per-minute slot, the other 4
  // failed instantly with "Rate limit: generate_audio called 2/2 times" (Bob's
  // 2026-05-10 BWB build hit this — Fish was working perfectly, our own quota
  // killed it). New limits support 4-worker parallel chapters * ~10 scenes
  // each in a single video. Aggregate hourly/daily budget keeps a runaway
  // agent from burning Fish credit unsupervised.
  generate_audio:       { maxPerMinute: 60, maxPerHour: 600, maxPerDay: 2000 },
  // R110.9 — bumped from 1/5/15 (set when each render took 5+ min on the OLD
  // single-threaded encoder). Now ~30-90s per slideshow, and Felix legitimately
  // needs 2-3 retries when the first attempt hits a missing-image or a
  // transient ffmpeg burp. Old 1/min meant ANY retry forced a 49s wait, which
  // the agent surfaced to Bob as "RATE LIMITED — wait 49s" (2026-05-10
  // YouTube intro build hit this — first attempt failed on missing slide
  // image, agent couldn't even retry to recover). New limits give breathing
  // room for retries + parallel chapter assembly without enabling abuse.
  create_slideshow_video: { maxPerMinute: 10, maxPerHour: 60, maxPerDay: 200 },
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
  forecast_ticker:      { maxPerMinute: 4, maxPerHour: 20, maxPerDay: 60 },
  // R74.13y: surfaced by tool-registry audit after fixing the require()-in-ESM
  // bug that had silently disabled the very_slow coverage check. Both are
  // very_slow tools (cross_critique runs an N-way LLM ensemble; video_transcribe_words
  // runs Whisper word-level transcription) — without explicit limits they were
  // falling through to DEFAULT_LIMIT (10/min) which is way too generous.
  cross_critique:       { maxPerMinute: 1, maxPerHour: 5,  maxPerDay: 15 },
  video_transcribe_words: { maxPerMinute: 1, maxPerHour: 3, maxPerDay: 10 },
  analyze_portfolio:    { maxPerMinute: 3, maxPerHour: 15, maxPerDay: 40 },
  // R110.7 — bumped from 2/10/30 (architect-flagged HIGH). mpeg-engine fans out
  // 4 parallel image bakes (MAX_PARALLEL_IMAGES=4) plus best-of-N hero candidates
  // (default 3) per scene. Old limit silently forced fallback-image quality
  // collapse on any video with >2 scenes. New limits sized for ~20-scene video.
  generate_social_image: { maxPerMinute: 30, maxPerHour: 300, maxPerDay: 1000 },
  // Round 23 architect-flagged: very_slow tools that lacked explicit limits
  mpeg_produce:                 { maxPerMinute: 1, maxPerHour: 3,  maxPerDay: 10 },
  mpeg_produce_parallel:        { maxPerMinute: 1, maxPerHour: 3,  maxPerDay: 10 },
  // R110.7 — architect-flagged: heavy orchestration endpoints had no explicit
  // limits (fell through to DEFAULT_LIMIT 10/min — way too generous for tools
  // that spawn long background workers).
  start_video_job:              { maxPerMinute: 1, maxPerHour: 3,  maxPerDay: 10 },
  finalize_video:               { maxPerMinute: 2, maxPerHour: 8,  maxPerDay: 20 },
  build_presentation_distributed: { maxPerMinute: 1, maxPerHour: 4, maxPerDay: 12 },
  create_slides:                { maxPerMinute: 2, maxPerHour: 8,  maxPerDay: 25 },
  run_supervisor:               { maxPerMinute: 2, maxPerHour: 10, maxPerDay: 30 },
  delegate_task:                { maxPerMinute: 5, maxPerHour: 30, maxPerDay: 100 },
  google_workspace:             { maxPerMinute: 3, maxPerHour: 15, maxPerDay: 50 },
  // R98.27.5 — deliver_product reclassified normal→very_slow (architect HIGH).
  // Wraps deliverDigitalProduct(): Drive upload + retry + email; legitimately
  // 30-90s per call. Throttle matches generate_audio (downstream of most
  // deliveries) so a runaway agent can't queue 100 deliveries in a minute.
  deliver_product:              { maxPerMinute: 2, maxPerHour: 15, maxPerDay: 50 },
  // R98.25 — surfaced by startup tool-registry audit. run_ab_eval fans out
  // configs.length × runs_per_config LLM calls plus N grade_deliverable runs.
  // Default 4 configs × 3 runs = 24 LLM calls per invocation; throttle hard.
  run_ab_eval:                  { maxPerMinute: 1, maxPerHour: 3,  maxPerDay: 10 },
  // R98.25.1+sec — Architect HIGH (whole-app review pass 2): propose_skill is
  // writable by any authenticated/agent caller and inserts a row into
  // proposed_skills with no per-tenant ceiling. Repeated invocation could fill
  // the review queue / DB. Each row is length-capped at insert (server/tools.ts
  // ~L15701-L15723) but row-count was unbounded. Cap to 5 proposals/min, 20/hr,
  // 60/day per tenant. Genuine skill emission is rare; this is plenty.
  propose_skill:                { maxPerMinute: 5, maxPerHour: 20, maxPerDay: 60 },
  // R125+14+sec4 — surfaced by the startup tool-registry very_slow audit (both
  // were falling through to DEFAULT_LIMIT 10/min, far too generous).
  // jury_triage runs a 3-frontier-model vote (~5x the cost of a normal call per
  // replit.md); bwb_weekly_build kicks off a full weekly Built-With-Bob video
  // render. Both are heavy + rare — throttle hard.
  jury_triage:                  { maxPerMinute: 1, maxPerHour: 5,  maxPerDay: 15 },
  bwb_weekly_build:             { maxPerMinute: 1, maxPerHour: 2,  maxPerDay: 5  },
  // R125+52.41 — surfaced by the startup tool-registry very_slow audit (was
  // falling through to DEFAULT_LIMIT 10/min). second_opinion calls OpenRouter
  // Fusion (managed panel→judge→synthesize): metered (~$0.5/call), very_slow
  // (up to 90s on-demand / 45s auto), and owner-only under a HARD $25/day cap.
  // The atomic budget reserve already prevents overspend, but a per-minute cap
  // keeps a runaway on-demand caller from saturating the OpenRouter lane.
  second_opinion:               { maxPerMinute: 1, maxPerHour: 5,  maxPerDay: 20 },
  // venture_discovery is an owner-only, slow, networked 9-stage HITL business-
  // discovery loop whose live (dryRun:false) path spends against a HARD daily cap
  // (server/venture-discovery/budget.ts). The cap already prevents overspend, but
  // it's heavy + rare like jury_triage/bwb_weekly_build — throttle hard so a
  // runaway caller can't saturate the ideation/persona LLM lanes.
  venture_discovery:            { maxPerMinute: 1, maxPerHour: 5,  maxPerDay: 20 },
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

// R98.5+rl — Refund the most-recent usage entry. Use when a tool rejected
// the call at a pre-work validator (no TTS spend, no FFmpeg, no image gen)
// so the rate-limit slot doesn't get burned by quick fixable mistakes.
// Felix kept burning all 3 produce_video/hour slots on R98.5 validator
// rejections and had nothing left for the actual successful build.
export function refundToolUsage(tenantId: number, toolName: string): void {
  const key = getCacheKey(tenantId, toolName);
  const entries = usageCache.get(key) || [];
  if (entries.length === 0) return;
  // Remove the most recent entry (the one just recorded by the dispatcher).
  entries.sort((a, b) => a.timestamp - b.timestamp);
  entries.pop();
  if (entries.length === 0) usageCache.delete(key);
  else usageCache.set(key, entries);
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

// R110.11 — exported snapshot of expensive tool names. Used by executeTool's
// fail-CLOSED backstop in server/tools.ts so the rate-limit posture survives
// limiter-module classifier failure (when isExpensiveTool itself can't run).
// Frozen array; mutate EXPENSIVE_TOOLS above and this re-derives on next load.
export const EXPENSIVE_TOOL_NAMES: readonly string[] = Object.freeze(Object.keys(EXPENSIVE_TOOLS));
