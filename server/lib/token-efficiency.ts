// Token Efficiency telemetry — three READ-ONLY cost-overhead probes surfaced on
// /admin/ecosystem-health. Validation (NOT import) of the three genuine gaps the
// microsoft/AI-Engineering-Coach rule-set flagged that actually apply to a server
// platform:
//   1) cache-hit-starvation — large prompts re-sent uncached pay the full prefix
//      price every turn (instruction-bloat's expensive cousin).
//   2) instruction-bloat    — the always-injected base system-prompt TEXT every
//      request carries before any task content.
//   3) mcp-tool-bloat       — the serialized tool-catalog JSON schema sent on
//      every tool-enabled request.
//
// Honesty principle (platform-wide): never fabricate. Cache-hit is HISTORICAL,
// read from agent_cost_ledger which already captures cachedTokensIn/tokensIn per
// request (providers.ts::extractUsageTokens). Fixed-overhead is a deterministic
// POINT-IN-TIME measurement of what every request carries: the assembled base
// system-prompt text (instruction) + the serialized tool-definition JSON
// (catalog). "Share" is that fixed floor over the MEDIAN real input-token count
// from the ledger. Where a measurement can't be taken (probe throws / no sample)
// the field is marked unmeasured/degraded rather than presenting a healthy-
// looking zero.

import { db } from "../db";
import { logSilentCatch } from "./silent-catch";
import { sql } from "drizzle-orm";

// Token estimator — kept in lockstep with server/compaction.ts::estimateTokens
// (ceil(len/3.5)). Inlined deliberately so this telemetry module stays decoupled
// from the heavy compaction import chain (same convention as tool-output-compressor.ts).
function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 3.5);
}

// A "large" prompt is where prompt-cache starvation actually costs money: a big
// reusable prefix that, if uncached, pays full input rate every turn.
const LARGE_PROMPT_TOKENS = 5000;
const CACHE_WINDOW_DAYS = 30;
// Min large-prompt sample before the cache-hit signal is allowed to breach.
const CACHE_MIN_SAMPLE = 20;
// Below this hit-rate (%) on large prompts = starvation.
const CACHE_HIT_MIN_PCT = 20;
// Above this share (%) of a typical request's input being FIXED overhead = bloat.
const FIXED_SHARE_MAX_PCT = 50;
// Reference input price for the rough per-request $ estimate. Reuses the same
// env knob as the tool-compression card so both cost estimates agree.
const REF_INPUT_USD_PER_MTOK = Number(process.env.TOOL_COMPRESSION_INPUT_USD_PER_MTOK) || 5;
// Internal bound on the buildSystemPrompt measurement so a slow assembly can't
// eat the whole probe budget — the fast cache-hit + catalog numbers still return.
const INSTRUCTION_PROBE_MS = 3000;

export interface TokenEfficiencySummary {
  // 1) cache-hit-starvation (historical, from agent_cost_ledger).
  cacheHit: {
    windowDays: number;
    largePromptTokenThreshold: number;
    largePromptSample: number;
    hitRatePct: number;
    starvedCount: number;
    starvedPct: number;
    threshold: number;
    breached: boolean;
  };
  // 2) instruction-bloat + 3) mcp-tool-bloat -> fixed overhead per request.
  fixedOverhead: {
    instructionTokens: number;
    instructionMeasured: boolean;
    toolCount: number;
    toolCatalogTokens: number;
    fixedTokens: number;
    medianActualTokensIn: number;
    sharePct: number;
    usdPerRequest: number;
    usdPerMTok: number;
    threshold: number;
    breached: boolean;
  };
  degraded: boolean;
}

export function defaultTokenEfficiency(): TokenEfficiencySummary {
  return {
    cacheHit: {
      windowDays: CACHE_WINDOW_DAYS,
      largePromptTokenThreshold: LARGE_PROMPT_TOKENS,
      largePromptSample: 0,
      hitRatePct: 0,
      starvedCount: 0,
      starvedPct: 0,
      threshold: CACHE_HIT_MIN_PCT,
      breached: false,
    },
    fixedOverhead: {
      instructionTokens: 0,
      instructionMeasured: false,
      toolCount: 0,
      toolCatalogTokens: 0,
      fixedTokens: 0,
      medianActualTokensIn: 0,
      sharePct: 0,
      usdPerRequest: 0,
      usdPerMTok: REF_INPUT_USD_PER_MTOK,
      threshold: FIXED_SHARE_MAX_PCT,
      breached: false,
    },
    degraded: false,
  };
}

function withLocalTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`token-efficiency probe timeout: ${label} (${ms}ms)`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => { if (timer) clearTimeout(timer); }) as Promise<T>;
}

/**
 * Read-only token-efficiency summary. Never throws — a failed core query marks
 * the card degraded; the catalog + instruction measurements are independent and
 * each fail-soft to "unmeasured" rather than to a fabricated zero.
 */
export async function summarizeTokenEfficiency(tenantId: number): Promise<TokenEfficiencySummary> {
  const out = defaultTokenEfficiency();
  if (!tenantId || !Number.isInteger(tenantId) || tenantId <= 0) {
    out.degraded = true;
    return out;
  }

  // ── 1) Cache-hit + median actual input, from the ledger (historical) ──────
  try {
    const res = await db.execute(sql`
      WITH chat AS (
        SELECT tokens_in, COALESCE(cached_tokens_in, 0) AS cached_in
        FROM agent_cost_ledger
        WHERE tenant_id = ${tenantId}
          AND created_at >= NOW() - make_interval(days => ${CACHE_WINDOW_DAYS})
          AND operation LIKE 'chat.completions%'
          AND tokens_in > 0
      )
      SELECT
        COUNT(*) FILTER (WHERE tokens_in >= ${LARGE_PROMPT_TOKENS})::int AS large_sample,
        COALESCE(SUM(tokens_in) FILTER (WHERE tokens_in >= ${LARGE_PROMPT_TOKENS}), 0)::bigint AS large_in,
        COALESCE(SUM(cached_in) FILTER (WHERE tokens_in >= ${LARGE_PROMPT_TOKENS}), 0)::bigint AS large_cached,
        COUNT(*) FILTER (WHERE tokens_in >= ${LARGE_PROMPT_TOKENS} AND cached_in < 0.1 * tokens_in)::int AS starved,
        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY tokens_in), 0) AS median_in
      FROM chat
    `);
    const row = (((res as any).rows || res) as any[])[0] || {};
    const largeSample = Number(row.large_sample) || 0;
    const largeIn = Number(row.large_in) || 0;
    const largeCached = Number(row.large_cached) || 0;
    const starved = Number(row.starved) || 0;
    const hitRatePct = largeIn > 0 ? Math.round((largeCached / largeIn) * 1000) / 10 : 0;
    out.cacheHit.largePromptSample = largeSample;
    out.cacheHit.hitRatePct = hitRatePct;
    out.cacheHit.starvedCount = starved;
    out.cacheHit.starvedPct = largeSample > 0 ? Math.round((starved / largeSample) * 1000) / 10 : 0;
    out.cacheHit.breached = largeSample >= CACHE_MIN_SAMPLE && hitRatePct < CACHE_HIT_MIN_PCT;
    out.fixedOverhead.medianActualTokensIn = Math.round(Number(row.median_in) || 0);
  } catch (_silentErr) {
    logSilentCatch("server/lib/token-efficiency.ts", _silentErr);
    out.degraded = true;
  }

  // ── 3) Tool-catalog token tax — serialize the REAL tool-definition set ────
  try {
    const { getAllToolDefinitions } = await import("../tools");
    const defs = await getAllToolDefinitions(tenantId);
    out.fixedOverhead.toolCount = Array.isArray(defs) ? defs.length : 0;
    out.fixedOverhead.toolCatalogTokens = estimateTokensFromChars(JSON.stringify(defs || []).length);
  } catch (_silentErr) {
    logSilentCatch("server/lib/token-efficiency.ts", _silentErr);
  }

  // ── 2) Instruction bloat — measure the always-injected base system prompt ──
  // Synthetic minimal persona + empty memories/skills/knowledge so we capture
  // ONLY the fixed scaffolding (corporate identity, protocols, platform contract)
  // every request carries, NOT any task/persona/memory-specific content. The
  // tool catalog is sent separately (the API `tools` param), measured above —
  // so there's no double count. Bounded + fail-soft to "unmeasured".
  try {
    const { buildSystemPrompt } = await import("../chat-engine");
    const built = await withLocalTimeout(
      buildSystemPrompt(
        { name: "telemetry-probe", systemPrompt: "" },
        [], {}, [], [], false, undefined, undefined, tenantId,
      ),
      INSTRUCTION_PROBE_MS,
      "buildSystemPrompt",
    );
    const promptText = (built && typeof built.prompt === "string") ? built.prompt : "";
    if (promptText) {
      out.fixedOverhead.instructionTokens = estimateTokensFromChars(promptText.length);
      out.fixedOverhead.instructionMeasured = true;
    }
  } catch (_silentErr) {
    logSilentCatch("server/lib/token-efficiency.ts", _silentErr);
  }

  // ── Derive the fixed-overhead totals ──────────────────────────────────────
  const fo = out.fixedOverhead;
  fo.fixedTokens = fo.instructionTokens + fo.toolCatalogTokens;
  fo.sharePct = fo.medianActualTokensIn > 0
    ? Math.round((fo.fixedTokens / fo.medianActualTokensIn) * 1000) / 10
    : 0;
  fo.usdPerRequest = Math.round((fo.fixedTokens / 1e6) * REF_INPUT_USD_PER_MTOK * 1e6) / 1e6;
  // Only breach on a COMPLETE measurement (instruction measured) — a catalog-only
  // share is an undercount and must not raise a false alarm.
  fo.breached = fo.instructionMeasured && fo.medianActualTokensIn > 0 && fo.sharePct > FIXED_SHARE_MAX_PCT;

  return out;
}
