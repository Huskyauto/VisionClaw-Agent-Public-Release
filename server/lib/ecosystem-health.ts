// R98.25 — MNEMA Nugget 6: ecosystem health metrics.
//
// MNEMA (Smith, Gentic Lab, EUMAS 2026) §6 argues that any living memory
// system needs a small dashboard of "ecosystem" indicators that reveal
// pathologies invisible to per-row metrics:
//
//   1) DIVERSITY              — distinct authority-decisive sources per category.
//                               Low diversity = an attacker who compromises one
//                               source can poison a whole category.
//   2) COVERAGE               — fraction of categories served by at least one
//                               "adult" (mature, repeatedly-cited) source.
//                               Low coverage = blind spots.
//   3) CONTRADICTION DENSITY  — fraction of recent jury votes returning
//                               low-concordance (Nugget 3 κ < 0.5).
//                               High contradiction = retrieval is mixing facts
//                               from incompatible regimes (e.g. pre/post a
//                               policy change).
//   4) FRESHNESS MEDIAN       — median age of canonical (status='active')
//                               memory entries per category. High median = the
//                               knowledge base is drifting stale.
//
// All four are computable from data we already have:
//   diversity        ← memory_entries.provenance_triple->>'extractorFamily'
//   coverage         ← memory_entries.category presence
//   contradiction    ← moa_logs concordance distribution (R98.24 added the field)
//   freshness        ← memory_entries.created_at vs NOW
//
// Threshold defaults (tweakable):
//   diversity:    ≥ 3 distinct families per category
//   coverage:     ≥ 80% of categories have ≥ 5 active rows
//   contradiction: ≤ 15% of last-100 ensemble votes had κ<0.5
//   freshness:    median age of last-100 active rows ≤ 90 days

import { db } from "../db";
import { logSilentCatch } from "./silent-catch";
import { sql } from "drizzle-orm";
// Pure, side-effect-free default shape — statically imported so it is ALWAYS
// available for the degraded fallback even if the probe's dynamic import fails
// (no circular dep: token-efficiency does not import ecosystem-health).
import { defaultTokenEfficiency } from "./token-efficiency";

// Per-probe wall-clock bound. A single stalled summarize*() must not hang the
// whole /api/admin/ecosystem-health request to the outer request timeout — it
// should reject, the caller's catch marks that one probe `degraded`, and the
// rest of the dashboard still returns. (post-edit-code-review 2026-06-11.)
const PROBE_TIMEOUT_MS = 5000;
async function withProbeTimeout<T>(p: Promise<T>, label: string, ms = PROBE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`ecosystem-health probe timeout: ${label} (${ms}ms)`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface EcosystemHealth {
  tenantId: number;
  computedAt: string;
  diversity: {
    perCategory: Array<{ category: string; distinctFamilies: number; rowCount: number }>;
    averageFamilies: number;
    threshold: number;
    breached: boolean;
  };
  coverage: {
    totalCategories: number;
    matureCategories: number;
    coverageRatio: number;
    threshold: number;
    breached: boolean;
  };
  contradiction: {
    sampleSize: number;
    lowConcordanceCount: number;
    contradictionRatio: number;
    threshold: number;
    breached: boolean;
  };
  // Forge Field Manual No.08 "The Crucible Loop" (validation, not import) — jury
  // concordance health PER task-class. κ already lives in moa_responses; this
  // buckets recent ensemble runs by task-class into theater (auditors always agree
  // = rubber-stamp) / useful (splits carry signal) / noise (always split). The
  // cross-model disagreement "vital sign" Forge notes nobody publishes. Degraded-safe.
  juryHealth: {
    window: number;
    minSamples: number;
    classes: Array<{
      taskClass: string;
      sampleSize: number;
      meanKappa: number;
      escalationRate: number;
      health: JuryHealthClass;
    }>;
    theaterCount: number;
    usefulCount: number;
    noiseCount: number;
    breached: boolean;
  };
  freshness: {
    sampleSize: number;
    medianAgeDays: number;
    threshold: number;
    breached: boolean;
  };
  // arXiv:2605.22687 — "illusory AI productivity": how well the platform's own
  // predicted time/cost matched reality, and how often the heavy-loop guard
  // advised the cheaper direct path on a trivial task.
  efficiency: {
    sampleSize: number;
    predictedMedianMs: number;
    actualMedianMs: number;
    predictionGapRatio: number;
    predictedMedianCostUsd: number;
    actualMedianCostUsd: number;
    heavyLoopCount: number;
    skipAdvisedCount: number;
    upRouteCount: number;
    threshold: number;
    breached: boolean;
    // arXiv:2606.24937 (Roitman) — process-quality / trajectory grading.
    processQuality: {
      sampleSize: number;
      medianQuality: number;
      medianCompletionRate: number;
      lowQualityCount: number;
      threshold: number;
      breached: boolean;
    };
  };
  // Anthropic Institute "When AI builds itself" (2026) — self-repair loop
  // catch-rate: of all incidents the loop saw, how many it auto-closed vs
  // escalated to the owner vs held by a fail-closed safety guard.
  selfImprovement: import("./self-improvement-metrics").SelfImprovementSummary;
  // Hermes SOUL.md charter (triaged 2026-06-07) — "don't generate artifacts for
  // the graveyard": of the work the platform surfaced to the owner (capability
  // gaps + scheduled follow-ups), how much got acted on vs is sitting stale.
  feedbackLoop: import("../feedback-loop-accountability").FeedbackLoopSummary;
  // SSRN 6859839 (MIT 2026) — produce -> ship -> adopt funnel. Output volume is
  // a vanity metric; this surfaces the shipping + adoption weak links (how much
  // of what's produced actually ships, and how much of what ships gets fetched).
  deliveryFunnel: import("../delivery-funnel").DeliveryFunnelSummary;
  // Self-improvement OUTPUT over time — proposals shipped + findings closed per
  // week. Surfaces whether the self-improvement loop is still climbing or stalled.
  climbTracker: import("../climb-tracker").ClimbTrackerSummary;
  // Training-Free GRPO (arXiv:2510.08191) SHADOW MODE — comparative "semantic
  // advantage" lessons distilled from divergent jury rollouts, collected for
  // inspection. NOT injected into any live prompt yet (injectionLive=false).
  juryExperiences: import("./jury-experience").JuryExperienceSummary;
  // Tool-output compressor impact (2026-06-13) — input tokens saved on REAL
  // traffic vs the old head-slice it replaced, plus a rough USD estimate.
  // Informational: never contributes to anyBreached (it's a win, not a pathology).
  toolCompression: import("./tool-compression-stats").ToolCompressionSummary;
  // "Code as Agent Harness" (Ning et al., UIUC/Meta/Stanford, arXiv:2605.18747)
  // — the survey's open challenge "evaluation beyond final task success". Process
  // quality of the execute-verify-repair loop (repo-surgeon attempt grain):
  // verifier land-rate, first-pass yield, rework depth. Distinct from the
  // incident-grain Self-Improvement card.
  harnessHealth: import("../harness-health").HarnessHealthSummary;
  // microsoft/AI-Engineering-Coach (validation, not import) — three token-cost
  // overhead probes: cache-hit-starvation (large prompts re-sent uncached),
  // instruction-bloat (always-injected base system-prompt text), and
  // mcp-tool-bloat (serialized tool-catalog JSON sent every request). Cache-hit
  // is historical (agent_cost_ledger); fixed-overhead is a deterministic
  // point-in-time measurement. Degraded-safe.
  tokenEfficiency: import("./token-efficiency").TokenEfficiencySummary;
  // PROOF_LOOPS §10 (Boucher, Montreal.AI 2026) — Chronicle precision: of the
  // skills promoted from the proposed_skills queue into the durable skills
  // Chronicle, what fraction later proved out (survived AND was actually
  // reused by the skill-RAG lane)? Low precision = the promotion gate is
  // admitting skills that never earn their keep. Telemetry only.
  chroniclePrecision: import("./chronicle-precision").ChroniclePrecisionSummary;
  // Pre-Flight Capability Review (PFCR) reuse-vs-rebuild — directive+telemetry
  // enforcement (Bob 2026-06-28). Of the kickoff reviews that surfaced an
  // existing native TOOL for the task, how often the agent actually called it
  // (reuse) vs ignored it. Low reuse rate = agents bypassing PFCR. Degraded-safe.
  capabilityReuse: import("../capability-review").CapabilityReviewSummary;
  // Tool Forge Phase 1 (docs/tool-forge-spec.md) — Unmet Capabilities: the
  // demand signal from capability_gaps. Every time an agent reaches for a tool
  // that doesn't exist, detectGap() records/increments the gap; this card ranks
  // the open gaps by miss_count so Bob can see which tools tenants actually
  // need. Observability only — no code generation (Phases 2–3 need sign-off).
  unmetCapabilities: {
    openCount: number;
    totalMisses: number;
    hotCount: number; // open gaps whose miss_count >= hotThreshold
    resolvedCount: number;
    topGaps: Array<{ description: string; source: string; status: string; missCount: number; lastSeenAt: string | null }>;
    hotThreshold: number;
    breached: boolean;
  };
  // Names of the scalar probes (diversity/coverage/contradiction/freshness/
  // efficiency/selfImprovement/feedbackLoop) that fell back to their default
  // zeros because the underlying query/import threw — surfaced so the card can
  // show an honest "telemetry unavailable" state instead of healthy-looking
  // zeros. The object-shaped probes (deliveryFunnel/climbTracker/juryExperiences/
  // toolCompression/harnessHealth) carry their own per-card `degraded` flag.
  probesDegraded: string[];
  anyBreached: boolean;
}

const DEFAULTS = {
  diversityMinFamilies: 3,
  coverageMinRowsPerCategory: 5,
  coverageMinRatio: 0.8,
  contradictionWindow: 100,
  contradictionMaxRatio: 0.15,
  freshnessWindow: 100,
  freshnessMaxMedianDays: 90,
  // Jury concordance health (Forge Field Manual No.08 "The Crucible Loop" —
  // validation, not import: κ already lives in moa_responses.concordance). The
  // per-task-class κ distribution is a "vital sign": a class whose auditors ALWAYS
  // agree pays for a multi-model jury that yields a single opinion (verification
  // theater); a class whose auditors ALWAYS split runs on noise. The useful zone is
  // in between, where a split is a signal worth escalating. Heuristic + advisory.
  juryHealthWindow: 400,     // scan the last N ensemble rows across all task-classes
  juryHealthMinSamples: 12,  // per-class floor to classify (else "insufficient")
  juryTheaterKappa: 0.93,    // mean κ ≥ this AND ...
  juryTheaterMaxEsc: 0.02,   // ... escalation ≤ this ⇒ rubber-stamp / theater
  juryNoiseKappa: 0.30,      // mean κ < this OR ...
  juryNoiseEsc: 0.60,        // ... escalation ≥ this ⇒ auditors are noise
  // Tool Forge Phase 1 — an open capability gap missed this many times is
  // "hot" (real demand, not a one-off hallucinated tool name) and breaches
  // the Unmet Capabilities card so it surfaces on the dashboard.
  unmetHotMissThreshold: 3,
  unmetTopN: 5,
};

export type JuryHealthClass = "theater" | "useful" | "noise" | "insufficient";

// Pure, query-free classifier so it can be unit-tested without a DB (a real query
// keeps the pg pool open and hangs node:test — see run.sh). Advisory only.
// Degradation is conservative, not uniformly "insufficient": a non-finite sampleSize
// (we can't trust the count) ⇒ "insufficient", but a non-finite mean-κ / escalation
// coerces to 0, which surfaces as "noise" — a degraded reading is shown as a problem,
// never silently laundered into a healthy "useful".
export function classifyJuryHealth(
  m: { sampleSize: number; meanKappa: number; escalationRate: number },
  d: {
    juryHealthMinSamples: number; juryTheaterKappa: number; juryTheaterMaxEsc: number;
    juryNoiseKappa: number; juryNoiseEsc: number;
  } = DEFAULTS,
): JuryHealthClass {
  if (!Number.isFinite(m.sampleSize) || m.sampleSize < d.juryHealthMinSamples) return "insufficient";
  const k = Number.isFinite(m.meanKappa) ? m.meanKappa : 0;
  const e = Number.isFinite(m.escalationRate) ? m.escalationRate : 0;
  if (k >= d.juryTheaterKappa && e <= d.juryTheaterMaxEsc) return "theater";
  if (k < d.juryNoiseKappa || e >= d.juryNoiseEsc) return "noise";
  return "useful";
}

export async function computeEcosystemHealth(tenantId: number): Promise<EcosystemHealth | null> {
  if (!tenantId || !Number.isInteger(tenantId) || tenantId <= 0) return null;

  // Scalar probes that fail fall back to default zeros; record which ones so the
  // dashboard can mark them degraded instead of presenting zeros as healthy.
  const probesDegraded: string[] = [];

  // 1) Diversity per category — count distinct extractor families.
  // Categories with no provenance metadata (legacy rows) report distinctFamilies=0;
  // they don't fail the dashboard but flag as a gap.
  // Per-probe bounded: a slow/locked memory_entries scan must NOT hang (or 500)
  // the whole admin endpoint — fall back to an empty sample (card shows no data)
  // rather than blocking telemetry behind it.
  let dRows: any[] = [];
  try {
    const diversityRows = await withProbeTimeout(db.execute(sql`
      SELECT
        category,
        COUNT(*)::int AS row_count,
        COUNT(DISTINCT (provenance_triple->>'extractorFamily'))::int AS distinct_families
      FROM memory_entries
      WHERE tenant_id = ${tenantId}
        AND status = 'active'
      GROUP BY category
      ORDER BY row_count DESC
      LIMIT 50
    `), "diversity");
    dRows = ((diversityRows as any).rows || diversityRows) as any[];
  } catch (_silentErr) { logSilentCatch("server/lib/ecosystem-health.ts", _silentErr); probesDegraded.push("diversity", "coverage"); }
  const perCategory = dRows.map(r => ({
    category: r.category,
    distinctFamilies: Number(r.distinct_families) || 0,
    rowCount: Number(r.row_count) || 0,
  }));
  const avgFamilies = perCategory.length > 0
    ? perCategory.reduce((s, c) => s + c.distinctFamilies, 0) / perCategory.length
    : 0;

  // 2) Coverage — what fraction of categories has at least N active rows.
  const totalCategories = perCategory.length;
  const matureCategories = perCategory.filter(c => c.rowCount >= DEFAULTS.coverageMinRowsPerCategory).length;
  const coverageRatio = totalCategories > 0 ? matureCategories / totalCategories : 1;

  // 3) Contradiction density — fraction of recent ensemble votes that fell
  //    below the κ<0.5 escalation threshold. We read from moa_logs which
  //    moa.ts populates; if it doesn't exist yet, treat as 0.
  let contradictionSample = 0, lowConcordance = 0;
  try {
    const cRows = await withProbeTimeout(db.execute(sql`
      SELECT concordance
      FROM moa_responses
      WHERE tenant_id = ${tenantId}
        AND concordance IS NOT NULL
      ORDER BY id DESC
      LIMIT ${DEFAULTS.contradictionWindow}
    `), "contradiction");
    const rows = ((cRows as any).rows || cRows) as any[];
    contradictionSample = rows.length;
    lowConcordance = rows.filter(r => Number(r.concordance) < 0.5).length;
  } catch (_silentErr) { logSilentCatch("server/lib/ecosystem-health.ts", _silentErr); probesDegraded.push("contradiction"); }
  const contradictionRatio = contradictionSample > 0 ? lowConcordance / contradictionSample : 0;

  // 3b) Jury concordance health — per task-class κ distribution (Forge No.08).
  //     Reads the SAME moa_responses κ the contradiction probe uses, but grouped by
  //     the task-class (base of invoked_via, before any |pool= / |restate suffix).
  let juryClasses: EcosystemHealth["juryHealth"]["classes"] = [];
  try {
    const jRows = await withProbeTimeout(db.execute(sql`
      WITH recent AS (
        SELECT split_part(COALESCE(invoked_via, 'unknown'), '|', 1) AS task_class,
               concordance,
               should_escalate
        FROM moa_responses
        WHERE tenant_id = ${tenantId}
          AND concordance IS NOT NULL
        ORDER BY id DESC
        LIMIT ${DEFAULTS.juryHealthWindow}
      )
      SELECT task_class,
             COUNT(*)::int AS sample_size,
             AVG(concordance)::float AS mean_kappa,
             AVG(CASE WHEN should_escalate THEN 1 ELSE 0 END)::float AS escalation_rate
      FROM recent
      GROUP BY task_class
      ORDER BY sample_size DESC
      LIMIT 20
    `), "juryHealth");
    const rows = ((jRows as any).rows || jRows) as any[];
    juryClasses = rows.map(r => {
      const sampleSize = Number(r.sample_size) || 0;
      const meanKappa = Math.round((Number(r.mean_kappa) || 0) * 1000) / 1000;
      const escalationRate = Math.round((Number(r.escalation_rate) || 0) * 1000) / 1000;
      return {
        taskClass: String(r.task_class || "unknown"),
        sampleSize,
        meanKappa,
        escalationRate,
        health: classifyJuryHealth({ sampleSize, meanKappa, escalationRate }),
      };
    });
  } catch (_silentErr) { logSilentCatch("server/lib/ecosystem-health.ts", _silentErr); probesDegraded.push("juryHealth"); }
  const juryTheaterCount = juryClasses.filter(c => c.health === "theater").length;
  const juryNoiseCount = juryClasses.filter(c => c.health === "noise").length;
  const juryUsefulCount = juryClasses.filter(c => c.health === "useful").length;
  const juryHealthBreached = juryTheaterCount > 0 || juryNoiseCount > 0;

  // 4) Freshness median — how old is the median active memory row.
  let fRow: any = {};
  try {
    const fRows = await withProbeTimeout(db.execute(sql`
      WITH recent AS (
        SELECT EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0 AS age_days
        FROM memory_entries
        WHERE tenant_id = ${tenantId}
          AND status = 'active'
        ORDER BY created_at DESC
        LIMIT ${DEFAULTS.freshnessWindow}
      )
      SELECT
        COUNT(*)::int AS sample,
        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY age_days), 0) AS median_age
      FROM recent
    `), "freshness");
    fRow = (((fRows as any).rows || fRows) as any[])[0] || {};
  } catch (_silentErr) { logSilentCatch("server/lib/ecosystem-health.ts", _silentErr); probesDegraded.push("freshness"); }
  const freshnessSample = Number(fRow.sample) || 0;
  const medianAgeDays = Number(fRow.median_age) || 0;

  // 5) Efficiency — arXiv:2605.22687 predicted-vs-actual + heavy-loop guard.
  let efficiency = {
    sampleSize: 0, predictedMedianMs: 0, actualMedianMs: 0, predictionGapRatio: 0,
    predictedMedianCostUsd: 0, actualMedianCostUsd: 0, heavyLoopCount: 0,
    skipAdvisedCount: 0, upRouteCount: 0, threshold: 0.5, breached: false,
    processQuality: {
      sampleSize: 0, medianQuality: 0, medianCompletionRate: 0,
      lowQualityCount: 0, threshold: 0.7, breached: false,
    },
  };
  try {
    const { summarizeOrchestrationEfficiency } = await import("../orchestration-efficiency");
    efficiency = await withProbeTimeout(summarizeOrchestrationEfficiency(tenantId), "efficiency");
  } catch (_silentErr) { logSilentCatch("server/lib/ecosystem-health.ts", _silentErr); probesDegraded.push("efficiency"); }

  // 5b) Unmet Capabilities — Tool Forge Phase 1 (docs/tool-forge-spec.md).
  //     Aggregates capability_gaps (tenant-scoped) into a demand-ranked view.
  //     Fail-open: a degraded probe shows "telemetry unavailable", never blocks.
  //     TERMINAL statuses are ONLY ('resolved','safety_blocked') — the same set
  //     the detectGap() writer and the idx_capability_gaps_dedup partial unique
  //     index use. 'not_feasible' is NOT terminal: the dedup index makes such a
  //     row keep absorbing repeat misses, so renewed demand on a not_feasible
  //     gap must stay visible here (architect finding, 2026-07-14).
  const unmetCapabilities = {
    openCount: 0, totalMisses: 0, hotCount: 0, resolvedCount: 0,
    topGaps: [] as Array<{ description: string; source: string; status: string; missCount: number; lastSeenAt: string | null }>,
    hotThreshold: DEFAULTS.unmetHotMissThreshold, breached: false,
  };
  try {
    const gapAggRows = await withProbeTimeout(db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('resolved','safety_blocked'))::int AS open_count,
        COALESCE(SUM(miss_count) FILTER (WHERE status NOT IN ('resolved','safety_blocked')), 0)::int AS total_misses,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved','safety_blocked') AND miss_count >= ${DEFAULTS.unmetHotMissThreshold})::int AS hot_count,
        COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved_count
      FROM capability_gaps WHERE tenant_id = ${tenantId}
    `), "unmetCapabilities");
    const agg = (((gapAggRows as any).rows || gapAggRows) as any[])[0] || {};
    unmetCapabilities.openCount = Number(agg.open_count) || 0;
    unmetCapabilities.totalMisses = Number(agg.total_misses) || 0;
    unmetCapabilities.hotCount = Number(agg.hot_count) || 0;
    unmetCapabilities.resolvedCount = Number(agg.resolved_count) || 0;
    if (unmetCapabilities.openCount > 0) {
      const topRows = await withProbeTimeout(db.execute(sql`
        SELECT gap_description, source, status, miss_count, last_seen_at
        FROM capability_gaps
        WHERE tenant_id = ${tenantId} AND status NOT IN ('resolved','safety_blocked')
        ORDER BY miss_count DESC, last_seen_at DESC
        LIMIT ${DEFAULTS.unmetTopN}
      `), "unmetCapabilities:top");
      unmetCapabilities.topGaps = (((topRows as any).rows || topRows) as any[]).map((r) => ({
        description: String(r.gap_description || "").slice(0, 200),
        source: String(r.source || "auto"),
        status: String(r.status || "detected"),
        missCount: Number(r.miss_count) || 0,
        lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
      }));
    }
    unmetCapabilities.breached = unmetCapabilities.hotCount > 0;
  } catch (_silentErr) { logSilentCatch("server/lib/ecosystem-health.ts", _silentErr); probesDegraded.push("unmetCapabilities"); }

  // 6) Self-improvement loop catch-rate — Anthropic Institute (2026). How much
  //    of the platform's incident load the CI self-healer + architect/jury loop
  //    auto-closes vs escalates vs safety-holds.
  let selfImprovement: import("./self-improvement-metrics").SelfImprovementSummary = {
    sampleSize: 0, autoResolved: 0, escalated: 0, safetyHeld: 0, autoResolveRate: 0,
    escalationRate: 0, byClassification: [], recentResolveRate: 0, priorResolveRate: 0,
    trendDelta: 0, threshold: 0.33, breached: false,
  };
  try {
    const { summarizeSelfImprovement } = await import("./self-improvement-metrics");
    selfImprovement = await withProbeTimeout(summarizeSelfImprovement(tenantId), "selfImprovement");
  } catch (_silentErr) { logSilentCatch("server/lib/ecosystem-health.ts", _silentErr); probesDegraded.push("selfImprovement"); }

  // 6b) Chronicle precision — PROOF_LOOPS §10. Promoted-skill prove-out rate
  //     (survived ∧ reused / promoted). Null precision when nothing promoted.
  let chroniclePrecision: import("./chronicle-precision").ChroniclePrecisionSummary = {
    promotedCount: 0, survivedCount: 0, reusedCount: 0, provenCount: 0,
    precision: null, pendingCount: 0, threshold: 0.5, breached: false,
  };
  try {
    const { summarizeChroniclePrecision } = await import("./chronicle-precision");
    chroniclePrecision = await withProbeTimeout(summarizeChroniclePrecision(tenantId), "chroniclePrecision");
  } catch (_silentErr) { logSilentCatch("server/lib/ecosystem-health.ts", _silentErr); probesDegraded.push("chroniclePrecision"); }

  // 7) Feedback-loop accountability — Hermes SOUL.md charter. Surfaced-vs-acted-on
  //    on capability gaps + scheduled follow-ups; flags the "graveyard" of work
  //    the platform raised that the owner never acted on.
  let feedbackLoop: import("../feedback-loop-accountability").FeedbackLoopSummary = {
    surfaced: 0, actedOn: 0, actedRatio: 1, staleCount: 0, oldestStaleDays: 0,
    gaps: { open: 0, resolved: 0, stale: 0 },
    followups: { pending: 0, completed: 0, overdue: 0 },
    threshold: 0.5, breached: false,
  };
  try {
    const { summarizeFeedbackLoop } = await import("../feedback-loop-accountability");
    feedbackLoop = await withProbeTimeout(summarizeFeedbackLoop(tenantId), "feedbackLoop");
  } catch (_silentErr) { logSilentCatch("server/lib/ecosystem-health.ts", _silentErr); probesDegraded.push("feedbackLoop"); }

  // 8) Delivery funnel — SSRN 6859839 (MIT 2026). produce -> ship -> adopt: of
  //    what the platform PRODUCES, how much actually ships, and of what ships,
  //    how much the recipient actually fetched. Output volume is a vanity
  //    metric; this surfaces the shipping + adoption weak links.
  let deliveryFunnel: import("../delivery-funnel").DeliveryFunnelSummary = {
    produced: 0, shipped: 0, adopted: 0, shipRatio: 0, adoptRatio: 0,
    windowDays: 90, shipThreshold: 0.7, adoptThreshold: 0.5, breached: false,
    degraded: false,
  };
  try {
    const { summarizeDeliveryFunnel } = await import("../delivery-funnel");
    deliveryFunnel = await withProbeTimeout(summarizeDeliveryFunnel(tenantId), "deliveryFunnel");
  } catch (_silentErr) {
    logSilentCatch("server/lib/ecosystem-health.ts", _silentErr);
    // Import/compute failed entirely — mark degraded so the card shows an
    // honest "telemetry unavailable" state instead of healthy-looking zeros.
    deliveryFunnel = { ...deliveryFunnel, degraded: true };
  }

  // 9) Climb tracker — self-improvement OUTPUT over time (proposals shipped +
  //    findings closed per week). Flags a STALLED climb (prior output, recent zero);
  //    zero-everywhere is "no data", not a breach. Degraded on a failed query.
  let climbTracker: import("../climb-tracker").ClimbTrackerSummary = {
    windowWeeks: 8, weekly: [], thisWeekTotal: 0, priorAvgTotal: 0, trendDelta: 0,
    totalOutput: 0, recentWeeks: 2, threshold: 1, breached: false, degraded: false,
  };
  try {
    const { summarizeClimbTracker } = await import("../climb-tracker");
    climbTracker = await withProbeTimeout(summarizeClimbTracker(tenantId), "climbTracker");
  } catch (_silentErr) {
    logSilentCatch("server/lib/ecosystem-health.ts", _silentErr);
    climbTracker = { ...climbTracker, degraded: true };
  }

  // 10) Training-Free GRPO (arXiv:2510.08191) SHADOW MODE — comparative
  //     "semantic advantage" lessons distilled from divergent jury rollouts.
  //     Collection-only; NOT injected into any live prompt yet. Informational
  //     card (never contributes to anyBreached).
  let juryExperiences: import("./jury-experience").JuryExperienceSummary = {
    total: 0, shadow: 0, validated: 0, rejected: 0, byClass: [], recent: [],
    injectionLive: false, degraded: false, threshold: 0, breached: false,
  };
  try {
    const { summarizeJuryExperiences } = await import("./jury-experience");
    juryExperiences = await withProbeTimeout(summarizeJuryExperiences(tenantId), "juryExperiences");
  } catch (_silentErr) {
    logSilentCatch("server/lib/ecosystem-health.ts", _silentErr);
    juryExperiences = { ...juryExperiences, degraded: true };
  }

  // 11) Tool-output compressor impact — input tokens saved on real traffic vs
  //     the old head-slice. Informational; degraded-safe.
  let toolCompression: import("./tool-compression-stats").ToolCompressionSummary = {
    windowDays: 30, calls: 0, compressedCalls: 0, tokensSavedVsBaseline: 0,
    tokensSavedVsRaw: 0, savingsRatio: 0, estCostSavedUsd: 0,
    inputUsdPerMTok: Number(process.env.TOOL_COMPRESSION_INPUT_USD_PER_MTOK) || 5,
    degraded: false,
  };
  try {
    const { summarizeToolCompression } = await import("./tool-compression-stats");
    toolCompression = await withProbeTimeout(summarizeToolCompression(tenantId), "toolCompression");
  } catch (_silentErr) {
    logSilentCatch("server/lib/ecosystem-health.ts", _silentErr);
    toolCompression = { ...toolCompression, degraded: true };
  }

  // 12) Harness Health — arXiv:2605.18747 "evaluation beyond final task
  //     success". Process quality of the code-as-harness execute-verify-repair
  //     loop (repo_surgeon_attempts attempt grain): of the fixes the harness
  //     proposed AND tested, how often they passed the verifier and stuck
  //     (land-rate), got it right first try (first-pass yield), and how many
  //     iterations it burned to converge (rework depth). Degraded-safe.
  let harnessHealth: import("../harness-health").HarnessHealthSummary = {
    windowDays: 90, attempts: 0, incidents: 0, landed: 0, rolledBack: 0, noFix: 0,
    blocked: 0, ranAttempts: 0, landRate: 0, stalls: 0, valveFires: 0, valveFireRate: 0,
    firstPassYield: 0, avgReworkDepth: 0, threshold: 0.5, breached: false, degraded: false,
  };
  try {
    const { summarizeHarnessHealth } = await import("../harness-health");
    harnessHealth = await withProbeTimeout(summarizeHarnessHealth(tenantId), "harnessHealth");
  } catch (_silentErr) {
    logSilentCatch("server/lib/ecosystem-health.ts", _silentErr);
    harnessHealth = { ...harnessHealth, degraded: true };
  }

  // 13) Token efficiency — microsoft/AI-Engineering-Coach (validation, not
  //     import). Cache-hit-starvation + instruction-bloat + mcp-tool-bloat.
  //     Read-only; degraded-safe. cacheHit + fixedOverhead each carry their own
  //     breach flag (the catalog tax is a component of fixedOverhead).
  // Start from the FULL default shape so every consumer (anyBreached + the admin
  // frontend, which reads nested fields like cacheHit.largePromptTokenThreshold
  // even when degraded) always gets a complete TokenEfficiencySummary.
  let tokenEfficiency = defaultTokenEfficiency();
  try {
    // Lazy-load only the probe itself INSIDE the try so a module-load failure
    // degrades just this probe (fail-soft) instead of throwing the whole
    // computeEcosystemHealth call.
    const { summarizeTokenEfficiency } = await import("./token-efficiency");
    tokenEfficiency = await withProbeTimeout(summarizeTokenEfficiency(tenantId), "tokenEfficiency");
  } catch (_silentErr) {
    logSilentCatch("server/lib/ecosystem-health.ts", _silentErr);
    tokenEfficiency = { ...tokenEfficiency, degraded: true };
  }

  // 14) PFCR reuse-vs-rebuild — directive+telemetry enforcement (Bob 2026-06-28).
  //     Of kickoff capability reviews that surfaced an existing native TOOL, how
  //     often the agent reused it vs ignored it. Read-only, degraded-safe.
  let capabilityReuse: import("../capability-review").CapabilityReviewSummary = {
    sampleSize: 0, withRebuildRisk: 0, rebuildRiskRatio: 0, reuseEligible: 0,
    reusedCount: 0, reuseRate: 0, topSurfaced: [], windowDays: 30,
    threshold: 0.5, breached: false, degraded: false,
  };
  try {
    const { summarizeCapabilityReviews } = await import("../capability-review");
    capabilityReuse = await withProbeTimeout(summarizeCapabilityReviews(tenantId), "capabilityReuse");
  } catch (_silentErr) {
    logSilentCatch("server/lib/ecosystem-health.ts", _silentErr);
    capabilityReuse = { ...capabilityReuse, degraded: true };
  }

  const diversityBreached = perCategory.some(c => c.distinctFamilies < DEFAULTS.diversityMinFamilies && c.rowCount >= DEFAULTS.coverageMinRowsPerCategory);
  const coverageBreached = totalCategories > 0 && coverageRatio < DEFAULTS.coverageMinRatio;
  const contradictionBreached = contradictionSample >= 10 && contradictionRatio > DEFAULTS.contradictionMaxRatio;
  const freshnessBreached = freshnessSample >= 10 && medianAgeDays > DEFAULTS.freshnessMaxMedianDays;

  return {
    tenantId,
    computedAt: new Date().toISOString(),
    diversity: {
      perCategory,
      averageFamilies: Math.round(avgFamilies * 100) / 100,
      threshold: DEFAULTS.diversityMinFamilies,
      breached: diversityBreached,
    },
    coverage: {
      totalCategories,
      matureCategories,
      coverageRatio: Math.round(coverageRatio * 100) / 100,
      threshold: DEFAULTS.coverageMinRatio,
      breached: coverageBreached,
    },
    contradiction: {
      sampleSize: contradictionSample,
      lowConcordanceCount: lowConcordance,
      contradictionRatio: Math.round(contradictionRatio * 100) / 100,
      threshold: DEFAULTS.contradictionMaxRatio,
      breached: contradictionBreached,
    },
    juryHealth: {
      window: DEFAULTS.juryHealthWindow,
      minSamples: DEFAULTS.juryHealthMinSamples,
      classes: juryClasses,
      theaterCount: juryTheaterCount,
      usefulCount: juryUsefulCount,
      noiseCount: juryNoiseCount,
      breached: juryHealthBreached,
    },
    freshness: {
      sampleSize: freshnessSample,
      medianAgeDays: Math.round(medianAgeDays * 10) / 10,
      threshold: DEFAULTS.freshnessMaxMedianDays,
      breached: freshnessBreached,
    },
    efficiency,
    selfImprovement,
    chroniclePrecision,
    feedbackLoop,
    deliveryFunnel,
    climbTracker,
    juryExperiences,
    toolCompression,
    harnessHealth,
    tokenEfficiency,
    capabilityReuse,
    unmetCapabilities,
    probesDegraded,
    anyBreached: diversityBreached || coverageBreached || contradictionBreached || juryHealthBreached || freshnessBreached || efficiency.breached || selfImprovement.breached || chroniclePrecision.breached || feedbackLoop.breached || deliveryFunnel.breached || climbTracker.breached || harnessHealth.breached || tokenEfficiency.cacheHit.breached || tokenEfficiency.fixedOverhead.breached || capabilityReuse.breached || unmetCapabilities.breached,
  };
}
