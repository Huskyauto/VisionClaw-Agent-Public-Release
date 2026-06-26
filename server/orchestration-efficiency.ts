/**
 * Orchestration Efficiency — arXiv:2605.22687 (MIT / Stanford / NYU / Princeton)
 *
 * "Illusory AI productivity": people PREDICT large time savings from reaching for
 * AI (the study measured a 55.7s expected vs 7.5s actual gap) and, once they use
 * it, become MORE likely to use it again — even on trivial tasks where doing the
 * work directly is as fast or faster. The danger isn't dramatic dependence, it's
 * "quiet recalibration": losing the judgment of when your own mind is the faster
 * tool.
 *
 * For a 384-tool agent platform the structural analog is: routing a trivial
 * request through an expensive heavy loop (ensemble_query / jury_triage / a full
 * multi-agent plan) when a direct answer would be just as good. This module makes
 * that bias (a) MEASURABLE — record predicted-vs-actual duration/cost per
 * orchestration and surface the gap on /admin/ecosystem-health — and (b)
 * GUARDABLE — a cheap, no-LLM pre-check that flags when the heavy-loop overhead
 * likely exceeds the task value.
 *
 * Design invariants:
 *  - The guard is ADVISORY and fail-open. It only ever down-routes the AUTO
 *    invocation path; it NEVER silently skips an explicit ensemble_query /
 *    jury_triage call (those are deliberate and valued).
 *  - Recording is fire-and-forget telemetry: every write is wrapped so it can
 *    never block, slow, or throw into the orchestration hot path.
 */

import { db } from "./db";
import { logSilentCatch } from "./lib/silent-catch";
import { sql } from "drizzle-orm";

export type GuardVerdict = "worth" | "skip" | "neutral";

export interface HeavyLoopAssessment {
  verdict: GuardVerdict;
  /** 0..1 — how trivially-doable the request looked (higher = more trivial). */
  triviality: number;
  reason: string;
}

export interface AssessHeavyLoopInput {
  message: string;
  wordCount?: number;
  hasCodeBlock?: boolean;
}

// Cheap markers that a task is the kind the paper calls "simple": basic
// arithmetic, spelling, recall, short rewriting — work where the prompt-and-check
// loop costs more than just doing it.
const TRIVIAL_MARKERS: RegExp[] = [
  /^[\s\d+\-*/%().,=^]+\??$/, // pure arithmetic expression
  /^(what(?:'s| is)|whats)\s+\d+[\d\s+\-*/%().,=^]*\??$/i, // "what is 12 * 7"
  /^(spell|how do you spell|define)\s+\w+[\s.!?]*$/i,
  /^(what|when|where|who)\s+(is|are|was|were)\s+[\w\s]{1,30}\??$/i, // short factoid
  /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|got it|cool|nice|yep|nope)[\s.!?]*$/i,
  /^(translate|capitalize|uppercase|lowercase)\s+["']?[\w\s]{1,40}["']?[\s.!?]*$/i,
];

// Markers that the heavy loop is genuinely warranted: real complexity / ambiguity
// / cross-domain reasoning where multi-model synthesis adds value.
const COMPLEX_MARKERS: RegExp[] = [
  /\b(architect(?:ure)?|refactor|trade[-\s]?offs?|design\s+(?:a|the)\s+system)\b/i,
  /\b(compare|versus|vs\.?|pros\s+and\s+cons|implications?|consequences?)\b/i,
  /\b(strategy|roadmap|analy[sz]e|comprehensive|deep[-\s]?dive|holistic)\b/i,
  /\b(security|migration|concurrenc|race\s+condition|scalab(?:le|ility))\b/i,
  /\b(why\s+(?:is|does|would|should)|how\s+(?:does|should|would)\b)/i,
];

/**
 * Cheap, deterministic, no-LLM verdict on whether a heavy loop is worth it.
 * Pure function — unit-testable, sub-millisecond.
 */
export function assessHeavyLoopWorth(input: AssessHeavyLoopInput): HeavyLoopAssessment {
  const msg = (input.message || "").trim();
  if (!msg) {
    return { verdict: "skip", triviality: 1, reason: "empty request" };
  }

  const wordCount = input.wordCount ?? msg.split(/\s+/).filter(Boolean).length;
  const hasCodeBlock = input.hasCodeBlock ?? /```[\s\S]*```/.test(msg);

  let triviality = 0;
  const reasons: string[] = [];

  for (const re of TRIVIAL_MARKERS) {
    if (re.test(msg)) {
      triviality += 0.6;
      reasons.push("trivial-pattern");
      break;
    }
  }
  if (wordCount <= 6) {
    triviality += 0.3;
    reasons.push(`very short (${wordCount}w)`);
  } else if (wordCount <= 12) {
    triviality += 0.15;
    reasons.push(`short (${wordCount}w)`);
  }

  let complexHits = 0;
  for (const re of COMPLEX_MARKERS) {
    if (re.test(msg)) complexHits++;
  }
  if (hasCodeBlock) complexHits++;
  if (wordCount > 60) complexHits++;

  // Complexity discounts triviality: a long, technical, multi-clause request is
  // exactly where the heavy loop earns its cost.
  triviality = Math.max(0, Math.min(1, triviality - complexHits * 0.25));

  let verdict: GuardVerdict;
  if (triviality >= 0.6) {
    verdict = "skip";
    reasons.push("heavy-loop overhead likely exceeds task value");
  } else if (complexHits >= 2) {
    verdict = "worth";
    reasons.push(`${complexHits} complexity signal(s)`);
  } else {
    verdict = "neutral";
  }

  return {
    verdict,
    triviality: Math.round(triviality * 100) / 100,
    reason: reasons.length ? reasons.join("; ") : "no strong signal",
  };
}

export interface AdaptiveRouteInput {
  /** Did the auto-ensemble trigger fire (decision.invoke)? */
  ensembleTriggered: boolean;
  /** Verdict from assessHeavyLoopWorth on this message. */
  worthVerdict: GuardVerdict;
  /** Has the user explicitly pinned a non-"auto" model on this conversation? */
  userPinnedModel: boolean;
  /** Kill switch — defaults to enabled when undefined. */
  enabled?: boolean;
}

/**
 * Adaptive "up-route" decision — the symmetric complement to the down-route
 * guard. When a request is GENUINELY complex (assessHeavyLoopWorth === "worth")
 * but did NOT clear the auto-ensemble trigger threshold, and the user has left
 * the model on "auto", promote that single turn to one reasonable-cost high-end
 * model instead of the cheap auto pick. Cheaper than the full 4-LLM ensemble,
 * stronger than the free default.
 *
 * Invariants (mirror the down-route guard):
 *  - NEVER fires when the ensemble already ran (no double spend).
 *  - NEVER overrides an explicitly user-pinned model.
 *  - Conservative: only on the "worth" verdict (>=2 complexity signals), never
 *    on "neutral".
 *  - Pure + fail-safe: returns false on the kill switch.
 */
export function shouldUpRouteToHardModel(input: AdaptiveRouteInput): boolean {
  if (input.enabled === false) return false;
  if (input.userPinnedModel) return false;
  if (input.ensembleTriggered) return false; // ensemble already handles the hard path
  return input.worthVerdict === "worth";
}

export interface OrchestrationEfficiencyRecord {
  tenantId: number;
  requestClass: string;
  label?: string;
  predictedDurationMs?: number | null;
  predictedCostUsd?: number | null;
  actualDurationMs?: number | null;
  actualCostUsd?: number | null;
  heavyLoopUsed?: boolean;
  guardVerdict?: GuardVerdict | null;
  triviality?: number | null;
}

/**
 * Fire-and-forget telemetry write. Never blocks, never throws into the caller.
 * Call WITHOUT awaiting on the hot path (or await in a detached context).
 */
export async function recordOrchestrationEfficiency(rec: OrchestrationEfficiencyRecord): Promise<void> {
  try {
    if (!rec || !Number.isInteger(rec.tenantId) || rec.tenantId <= 0) return;
    await db.execute(sql`
      INSERT INTO orchestration_efficiency
        (tenant_id, request_class, label, predicted_duration_ms, predicted_cost_usd,
         actual_duration_ms, actual_cost_usd, heavy_loop_used, guard_verdict, triviality)
      VALUES (
        ${rec.tenantId},
        ${rec.requestClass || "open-ended"},
        ${rec.label ?? null},
        ${rec.predictedDurationMs ?? null},
        ${rec.predictedCostUsd ?? null},
        ${rec.actualDurationMs ?? null},
        ${rec.actualCostUsd ?? null},
        ${rec.heavyLoopUsed ?? false},
        ${rec.guardVerdict ?? null},
        ${rec.triviality ?? null}
      )
    `);
  } catch (_silentErr) {
    logSilentCatch("server/orchestration-efficiency.ts", _silentErr);
  }
}

export interface EfficiencySummary {
  sampleSize: number;
  predictedMedianMs: number;
  actualMedianMs: number;
  /** median absolute relative error between predicted and actual duration (0..1+). */
  predictionGapRatio: number;
  predictedMedianCostUsd: number;
  actualMedianCostUsd: number;
  heavyLoopCount: number;
  /** how many times the guard advised skipping a heavy loop on a trivial task. */
  skipAdvisedCount: number;
  /** how many times a hard-but-sub-ensemble request was UP-routed to the high-end model. */
  upRouteCount: number;
  threshold: number;
  breached: boolean;
}

const GAP_THRESHOLD = 0.5; // predictions off by >50% (median) = the felt-vs-real illusion is large

/**
 * Dashboard summary: how accurate the platform's own time/cost predictions are,
 * and how often the guard caught a heavy loop that wasn't worth it. Read-only.
 */
export async function summarizeOrchestrationEfficiency(tenantId: number): Promise<EfficiencySummary> {
  const empty: EfficiencySummary = {
    sampleSize: 0,
    predictedMedianMs: 0,
    actualMedianMs: 0,
    predictionGapRatio: 0,
    predictedMedianCostUsd: 0,
    actualMedianCostUsd: 0,
    heavyLoopCount: 0,
    skipAdvisedCount: 0,
    upRouteCount: 0,
    threshold: GAP_THRESHOLD,
    breached: false,
  };
  if (!tenantId || !Number.isInteger(tenantId)) return empty;

  try {
    const res = await db.execute(sql`
      WITH recent AS (
        SELECT predicted_duration_ms, actual_duration_ms,
               predicted_cost_usd, actual_cost_usd,
               heavy_loop_used, guard_verdict, request_class
        FROM orchestration_efficiency
        WHERE tenant_id = ${tenantId}
        ORDER BY id DESC
        LIMIT 200
      )
      SELECT
        COUNT(*)::int AS sample,
        COALESCE(percentile_cont(0.5) WITHIN GROUP (
          ORDER BY predicted_duration_ms) FILTER (WHERE predicted_duration_ms IS NOT NULL), 0) AS pred_ms,
        COALESCE(percentile_cont(0.5) WITHIN GROUP (
          ORDER BY actual_duration_ms) FILTER (WHERE actual_duration_ms IS NOT NULL), 0) AS act_ms,
        COALESCE(percentile_cont(0.5) WITHIN GROUP (
          ORDER BY ABS(actual_duration_ms - predicted_duration_ms)::float
                   / GREATEST(predicted_duration_ms, 1))
          FILTER (WHERE predicted_duration_ms IS NOT NULL AND actual_duration_ms IS NOT NULL), 0) AS gap,
        COALESCE(percentile_cont(0.5) WITHIN GROUP (
          ORDER BY predicted_cost_usd) FILTER (WHERE predicted_cost_usd IS NOT NULL), 0) AS pred_cost,
        COALESCE(percentile_cont(0.5) WITHIN GROUP (
          ORDER BY actual_cost_usd) FILTER (WHERE actual_cost_usd IS NOT NULL), 0) AS act_cost,
        COALESCE(SUM(CASE WHEN heavy_loop_used THEN 1 ELSE 0 END), 0)::int AS heavy,
        COALESCE(SUM(CASE WHEN guard_verdict = 'skip' THEN 1 ELSE 0 END), 0)::int AS skips,
        COALESCE(SUM(CASE WHEN request_class = 'adaptive-hard-route' THEN 1 ELSE 0 END), 0)::int AS uproutes
      FROM recent
    `);
    const row = (((res as any).rows || res) as any[])[0] || {};
    const sample = Number(row.sample) || 0;
    const gap = Number(row.gap) || 0;
    return {
      sampleSize: sample,
      predictedMedianMs: Math.round(Number(row.pred_ms) || 0),
      actualMedianMs: Math.round(Number(row.act_ms) || 0),
      predictionGapRatio: Math.round(gap * 100) / 100,
      predictedMedianCostUsd: Math.round((Number(row.pred_cost) || 0) * 1e6) / 1e6,
      actualMedianCostUsd: Math.round((Number(row.act_cost) || 0) * 1e6) / 1e6,
      heavyLoopCount: Number(row.heavy) || 0,
      skipAdvisedCount: Number(row.skips) || 0,
      upRouteCount: Number(row.uproutes) || 0,
      threshold: GAP_THRESHOLD,
      breached: sample >= 10 && gap > GAP_THRESHOLD,
    };
  } catch (_silentErr) {
    logSilentCatch("server/orchestration-efficiency.ts", _silentErr);
    return empty;
  }
}
