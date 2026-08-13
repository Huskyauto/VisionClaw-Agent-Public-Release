/**
 * Speculative read-only tool prefetch (arXiv:2607.25816 adaptation).
 *
 * The paper ("Speculate While You Reason", UCSB/LinkedIn 2026) hides tool-call
 * latency by predicting the agent's next tool call and pre-executing it. Their
 * mechanism (joint agent-speculator RL on shared weights) is impossible on API
 * models, but the platform has a stronger predictor for repeat work: a LOOP
 * plan-replay hit tells us EXACTLY which tools the plan's steps will use
 * (each step's toolChain). This module pre-executes the read-only, zero-arg
 * subset of those tools at replay-hit time and lets executeTool consume the
 * cached result when the step's eventual call matches exactly.
 *
 * Safety posture (non-negotiable):
 *  - STRICT allowlist: only tools in SPECULATION_ALLOWLIST, which must also be
 *    risk:"safe" (or unlisted => "safe" default) in TOOL_POLICIES at runtime,
 *    never irreversible / requiresApproval. A mispredicted read costs latency;
 *    a mispredicted write is an incident — so writes are structurally excluded.
 *  - The prefetch goes through the FULL executeToolWithTimeout path (all
 *    guards run at prefetch time with the same tenant + same public args), so
 *    consuming a hit is equivalent to the guarded execution that produced it.
 *  - Fail-open everywhere: any error disables nothing but this optimization.
 *  - Single-use consume + short TTL: a result is served at most once and never
 *    stale beyond TTL_MS.
 *  - Kill switch: SPEC_PREFETCH_DISABLED=1 turns the whole feature off.
 */

import { logSilentCatch } from "./lib/silent-catch";

/** Tools safe AND meaningful to pre-execute with zero public args.
 *  Must be a subset of tool-mutation.ts READ_ONLY_TOOLS; runtime-checked
 *  against TOOL_POLICIES too (belt and suspenders). */
export const SPECULATION_ALLOWLIST: ReadonlySet<string> = new Set([
  "check_system_status",
  "delivery_status",
  "list_models",
  "list_conversations",
  "sessions_list",
  "list_custom_tools",
  "get_experiments",
  "get_daily_notes",
  // check_inbox deliberately EXCLUDED — inbox freshness matters more than the
  // saved round-trip (architect review: stale operational data risk).
]);

const TTL_MS = 45_000;
const MAX_ENTRIES = 64;
const MAX_PREFETCH_PER_PLAN = 4;

interface SpecEntry {
  result: any;
  storedAt: number;
  /** Wall-clock ms the underlying guarded tool call took at prefetch time —
   *  the latency a consuming hit avoids. */
  toolLatencyMs: number;
}

const cache = new Map<string, SpecEntry>();

// Observability counters (surfaced via getSpeculationStats for health tools).
let statHits = 0;
let statMisses = 0;
let statPrefetches = 0;
// Sum of the prefetch-time tool latencies of every consumed hit — the real
// wall-clock time this optimization has avoided (in-memory, fail-open).
let statSavedMs = 0;

export function getSpeculationStats() {
  return {
    prefetches: statPrefetches,
    hits: statHits,
    misses: statMisses,
    cached: cache.size,
    savedMs: statSavedMs,
  };
}

function killSwitchOn(): boolean {
  return process.env.SPEC_PREFETCH_DISABLED === "1";
}

/** Hash of PUBLIC params only — underscore-prefixed keys are dispatcher-stamped
 *  trust/plumbing signals (_tenantId, _personaId, _rateLimitChecked, …) and
 *  must not affect speculation identity. Key order-insensitive. */
export function publicParamsHash(params: Record<string, any> | null | undefined): string {
  const pub: Record<string, any> = {};
  for (const k of Object.keys(params || {}).sort()) {
    if (!k.startsWith("_")) pub[k] = (params as any)[k];
  }
  return JSON.stringify(pub);
}

function cacheKey(tenantId: number, tool: string, paramsHash: string): string {
  return `${tenantId}:${tool}:${paramsHash}`;
}

function evictExpired(now: number): void {
  for (const [k, v] of cache) {
    if (now - v.storedAt > TTL_MS) cache.delete(k);
  }
  // Size bound: drop oldest first (Map preserves insertion order).
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Runtime policy re-check: refuse to speculate anything TOOL_POLICIES marks
 *  as non-safe, irreversible, or approval-gated — even if the allowlist above
 *  drifts. Fail CLOSED (refuse to speculate) on any lookup error. */
async function policyAllowsSpeculation(tool: string): Promise<boolean> {
  try {
    const { TOOL_POLICIES } = await import("./safety/destructive-tool-policy");
    const p = (TOOL_POLICIES as Record<string, any>)[tool];
    if (!p) return true; // unlisted tools default to "safe" in the policy engine
    if (p.risk !== "safe") return false;
    if (p.irreversible || p.requiresApproval || p.trustedPersonasOnly) return false;
    return true;
  } catch (err) {
    logSilentCatch("server/speculative-prefetch.ts", err);
    return false;
  }
}

type Executor = (name: string, params: Record<string, any>) => Promise<any>;

async function defaultExecutor(name: string, params: Record<string, any>): Promise<any> {
  const { executeToolWithTimeout } = await import("./tools");
  return executeToolWithTimeout(name, params);
}

/**
 * Fire speculative prefetches for a replayed plan's read-only zero-arg tools.
 * Fire-and-forget; never throws; never blocks plan execution.
 * `executor` is injectable for tests (default: real executeToolWithTimeout).
 */
export function prefetchForReplayPlan(
  steps: Array<{ toolChain?: string[] | null }>,
  tenantId: number,
  executor: Executor = defaultExecutor,
): void {
  if (killSwitchOn()) return;
  if (!Number.isInteger(tenantId) || tenantId <= 0) return;

  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const step of steps || []) {
    for (const tool of step?.toolChain || []) {
      if (typeof tool !== "string" || seen.has(tool)) continue;
      seen.add(tool);
      if (SPECULATION_ALLOWLIST.has(tool)) candidates.push(tool);
      if (candidates.length >= MAX_PREFETCH_PER_PLAN) break;
    }
    if (candidates.length >= MAX_PREFETCH_PER_PLAN) break;
  }
  if (candidates.length === 0) return;

  void (async () => {
    for (const tool of candidates) {
      try {
        if (!(await policyAllowsSpeculation(tool))) continue;
        const params = { _tenantId: tenantId, _speculativePrefetch: true } as Record<string, any>;
        const startedAt = Date.now();
        const result = await executor(tool, params);
        const toolLatencyMs = Math.max(0, Date.now() - startedAt);
        // Never cache error envelopes — a guard block or failure must re-run live.
        if (result && typeof result === "object" && "error" in result) continue;
        const now = Date.now();
        cache.set(cacheKey(tenantId, tool, publicParamsHash(params)), { result, storedAt: now, toolLatencyMs });
        // Evict AFTER insert so the size bound holds (architect finding:
        // pre-insert eviction allowed a persistent 65th entry).
        evictExpired(now);
        statPrefetches++;
        console.log(`[spec-prefetch] warmed ${tool} for tenant ${tenantId}`);
      } catch (err) {
        logSilentCatch("server/speculative-prefetch.ts", err);
      }
    }
  })();
}

/**
 * Consume a speculative result for an incoming live call. Returns
 * { hit: true, result } at most ONCE per prefetch (deleted on consume),
 * only within TTL, only for allowlisted tools, only on an exact
 * (tenant, tool, public-args) match. Anything else: { hit: false }.
 */
export function consumeSpeculativeResult(
  tool: string,
  params: Record<string, any> | null | undefined,
): { hit: boolean; result?: any } {
  if (killSwitchOn()) return { hit: false };
  if (!SPECULATION_ALLOWLIST.has(tool)) return { hit: false };
  const tenantId = typeof params?._tenantId === "number" ? params._tenantId : NaN;
  if (!Number.isInteger(tenantId) || tenantId <= 0) return { hit: false };

  const key = cacheKey(tenantId, tool, publicParamsHash(params));
  const entry = cache.get(key);
  if (!entry) { statMisses++; return { hit: false }; }
  cache.delete(key); // single-use
  if (Date.now() - entry.storedAt > TTL_MS) { statMisses++; return { hit: false }; }
  statHits++;
  // Accrue the avoided latency. Guard non-finite shapes (fail-open counter).
  const saved = typeof entry.toolLatencyMs === "number" && Number.isFinite(entry.toolLatencyMs)
    ? Math.max(0, entry.toolLatencyMs)
    : 0;
  statSavedMs += saved;
  console.log(`[spec-prefetch] HIT ${tool} tenant ${tenantId} (age ${Date.now() - entry.storedAt}ms, saved ~${saved}ms)`);
  return { hit: true, result: entry.result };
}

/** Test hook — clears all state. */
export function _resetSpeculationStateForTests(): void {
  cache.clear();
  statHits = 0;
  statMisses = 0;
  statPrefetches = 0;
  statSavedMs = 0;
}
