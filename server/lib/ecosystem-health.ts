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
};

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
  };
  try {
    const { summarizeOrchestrationEfficiency } = await import("../orchestration-efficiency");
    efficiency = await withProbeTimeout(summarizeOrchestrationEfficiency(tenantId), "efficiency");
  } catch (_silentErr) { logSilentCatch("server/lib/ecosystem-health.ts", _silentErr); probesDegraded.push("efficiency"); }

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
    blocked: 0, ranAttempts: 0, landRate: 0, firstPassYield: 0, avgReworkDepth: 0,
    threshold: 0.5, breached: false, degraded: false,
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
    freshness: {
      sampleSize: freshnessSample,
      medianAgeDays: Math.round(medianAgeDays * 10) / 10,
      threshold: DEFAULTS.freshnessMaxMedianDays,
      breached: freshnessBreached,
    },
    efficiency,
    selfImprovement,
    feedbackLoop,
    deliveryFunnel,
    climbTracker,
    juryExperiences,
    toolCompression,
    harnessHealth,
    tokenEfficiency,
    probesDegraded,
    anyBreached: diversityBreached || coverageBreached || contradictionBreached || freshnessBreached || efficiency.breached || selfImprovement.breached || feedbackLoop.breached || deliveryFunnel.breached || climbTracker.breached || harnessHealth.breached || tokenEfficiency.cacheHit.breached || tokenEfficiency.fixedOverhead.breached,
  };
}
