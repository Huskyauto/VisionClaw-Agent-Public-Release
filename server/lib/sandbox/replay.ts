/**
 * Simulation Sandbox — replay engine core (Slice S2).
 * Contract: data/feature-contracts/simulation-sandbox/spec.md
 *
 * Replays the safety corpus (historical security_intent_checks rows) through
 * the LIVE intent gate under an override bundle, inside the S1 side-effect
 * firewall, in evaluate-only mode (auditWrites:false — zero writes to the
 * production audit trail, decline telemetry, or the gate's shared cache).
 *
 * Invariants:
 * - tenant_id is passed explicitly on EVERY INSERT (no defaults).
 * - was-blocked → now-allowed is ALWAYS severity=critical.
 * - The report never silently drops items: skipped/errored counts surface.
 * - ALS note: the firewall context does NOT cross process/queue boundaries;
 *   this engine runs in-process. Any future worker fan-out must re-enter
 *   runInSimulation at each worker entry.
 */
import { pool } from "../../db";
import { runInSimulation } from "./firewall";
import { runIntentGate, type IntentGateMode } from "../../safety/intent-gate";
import {
  loadSafetyCorpus, type SafetyCorpusItem,
  loadConversationCorpus, loadOrchestrationCorpus, type ModelSwapCorpusItem,
} from "./corpora";
import { gradeSimilarity, summarizeSimilarity, type SimilarityStats, SIMILARITY_DRIFT_THRESHOLD } from "./grade";
import { claimAutonomousBudget } from "../../agentic/autonomous-budget";

/** Hard ceiling from the spec — a run may never exceed this many items. */
export const SAMPLE_CEILING = 200;

export interface SafetyOverrides {
  /** Intent-gate level to test (e.g. moderate → strict). */
  intentGateMode: IntentGateMode;
  /** Restricted categories to test; defaults to the historical row's flagged set union. */
  restrictedCategories: string[];
}

export type Flip = "none" | "block_to_allow" | "allow_to_block";
export type Severity = "critical" | "warn" | "info";

/** Pure: classify a baseline→simulated verdict pair. block→allow is CRITICAL. */
export function classifyFlip(baseline: "allow" | "block", simulated: "allow" | "block"): { flip: Flip; severity: Severity } {
  if (baseline === simulated) return { flip: "none", severity: "info" };
  if (baseline === "block" && simulated === "allow") return { flip: "block_to_allow", severity: "critical" };
  return { flip: "allow_to_block", severity: "warn" };
}

export interface ItemOutcome {
  itemRef: string;
  baselineAction: "allow" | "block";
  simulatedAction: "allow" | "block";
  flip: Flip;
  severity: Severity;
}

export interface SafetyReport {
  corpus: "safety";
  overrides: SafetyOverrides;
  totals: {
    requested: number;
    replayed: number;
    errored: number;
    skippedNoContent: number;
    totalCandidates: number;
  };
  flips: {
    none: number;
    block_to_allow: number;
    allow_to_block: number;
  };
  /** Every critical flip, listed individually — never buried in a count. */
  criticalFlips: Array<{ itemRef: string; baselineCategories: string[]; simulatedCategories: string[] }>;
  stubbedToolCalls: number;
  verdict: "CRITICAL" | "CHANGES" | "NO_CHANGE";
}

/** Pure: aggregate per-item outcomes into the report shape. */
export function buildSafetyReport(
  overrides: SafetyOverrides,
  requested: number,
  outcomes: ItemOutcome[],
  meta: { errored: number; skippedNoContent: number; totalCandidates: number; stubbedToolCalls: number; criticalDetails: SafetyReport["criticalFlips"] },
): SafetyReport {
  const flips = { none: 0, block_to_allow: 0, allow_to_block: 0 };
  for (const o of outcomes) flips[o.flip]++;
  return {
    corpus: "safety",
    overrides,
    totals: {
      requested,
      replayed: outcomes.length,
      errored: meta.errored,
      skippedNoContent: meta.skippedNoContent,
      totalCandidates: meta.totalCandidates,
    },
    flips,
    criticalFlips: meta.criticalDetails,
    stubbedToolCalls: meta.stubbedToolCalls,
    verdict: flips.block_to_allow > 0 ? "CRITICAL" : (flips.allow_to_block > 0 ? "CHANGES" : "NO_CHANGE"),
  };
}

export interface RunSafetyReplayOptions {
  tenantId: number;
  sampleSize: number;
  overrides: SafetyOverrides;
}

export interface RunSafetyReplayResult {
  runId: number;
  report: SafetyReport;
}

/**
 * Full safety-corpus replay: creates the sandbox_runs row, replays each item
 * through the live gate (evaluate-only, inside the firewall), persists
 * per-item sandbox_results rows and the aggregate report.
 */
export async function runSafetyReplay(opts: RunSafetyReplayOptions): Promise<RunSafetyReplayResult> {
  const { tenantId, overrides } = opts;
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error(`runSafetyReplay: invalid tenantId ${tenantId}`);
  if (!Number.isInteger(opts.sampleSize) || opts.sampleSize <= 0) throw new Error(`runSafetyReplay: invalid sampleSize ${opts.sampleSize}`);
  if (opts.sampleSize > SAMPLE_CEILING) throw new Error(`runSafetyReplay: sampleSize ${opts.sampleSize} exceeds ceiling ${SAMPLE_CEILING}`);
  if (!overrides || (overrides.intentGateMode !== "off" && overrides.intentGateMode !== "moderate" && overrides.intentGateMode !== "strict")) {
    throw new Error(`runSafetyReplay: invalid intentGateMode`);
  }

  const runRow = await pool.query(
    `INSERT INTO sandbox_runs (tenant_id, corpus, status, overrides, sample_size)
     VALUES ($1, 'safety', 'running', $2::jsonb, $3) RETURNING id`,
    [tenantId, JSON.stringify(overrides), opts.sampleSize],
  );
  const runId: number = runRow.rows[0].id;

  try {
    const corpus = await loadSafetyCorpus(tenantId, opts.sampleSize);
    const outcomes: ItemOutcome[] = [];
    const criticalDetails: SafetyReport["criticalFlips"] = [];
    let errored = 0;
    let stubbedToolCalls = 0;

    const { sim } = await runInSimulation(`sandbox-run-${runId}`, async () => {
      for (const item of corpus.items) {
        try {
          const outcome = await replayOneSafetyItem(item, tenantId, overrides);
          outcomes.push(outcome);
          if (outcome.severity === "critical") {
            criticalDetails.push({
              itemRef: item.itemRef,
              baselineCategories: item.baseline.flaggedCategories,
              simulatedCategories: outcome.simulatedCategories,
            });
          }
          await pool.query(
            `INSERT INTO sandbox_results (tenant_id, run_id, item_ref, baseline, simulated, flip, severity)
             VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)`,
            [
              tenantId,
              runId,
              item.itemRef,
              JSON.stringify(item.baseline),
              JSON.stringify({ action: outcome.simulatedAction, flaggedCategories: outcome.simulatedCategories, classifier: outcome.classifier }),
              outcome.flip,
              outcome.severity,
            ],
          );
        } catch (err: any) {
          errored++;
          console.warn(`[sandbox-replay] run=${runId} item=${item.itemRef} errored: ${err?.message}`);
        }
      }
      return null;
    });
    stubbedToolCalls = sim.stubbedCalls.length;

    const report = buildSafetyReport(overrides, opts.sampleSize, outcomes, {
      errored,
      skippedNoContent: corpus.skippedNoContent,
      totalCandidates: corpus.totalCandidates,
      stubbedToolCalls,
      criticalDetails,
    });

    await pool.query(
      `UPDATE sandbox_runs SET status = 'complete', report = $1::jsonb, completed_at = now()
        WHERE id = $2 AND tenant_id = $3`,
      [JSON.stringify(report), runId, tenantId],
    );
    return { runId, report };
  } catch (err: any) {
    await pool.query(
      `UPDATE sandbox_runs SET status = 'failed', error = $1, completed_at = now()
        WHERE id = $2 AND tenant_id = $3`,
      [String(err?.message || err).slice(0, 500), runId, tenantId],
    ).catch(() => {});
    throw err;
  }
}

interface OneItemOutcome extends ItemOutcome {
  simulatedCategories: string[];
  classifier: string;
}

async function replayOneSafetyItem(item: SafetyCorpusItem, tenantId: number, overrides: SafetyOverrides): Promise<OneItemOutcome> {
  // Categories under test: the override set when provided, else the union the
  // gate historically watched (baseline flags are the only recoverable proxy).
  const categories = overrides.restrictedCategories.length > 0
    ? overrides.restrictedCategories
    : item.baseline.flaggedCategories;

  const result = await runIntentGate(item.content, {
    tenantId,
    personaId: item.baseline.personaId,
    source: "sandbox_replay",
    mode: overrides.intentGateMode,
    restrictedCategories: categories,
    auditWrites: false, // evaluate-only: zero production writes
  });

  const { flip, severity } = classifyFlip(item.baseline.action, result.action);
  return {
    itemRef: item.itemRef,
    baselineAction: item.baseline.action,
    simulatedAction: result.action,
    flip,
    severity,
    simulatedCategories: result.flaggedCategories,
    classifier: result.classifier,
  };
}

// ── Model-swap replay (Slice S3) ───────────────────────────────────────────

/** Default per-run LLM spend cap (spec: $5). */
export const DEFAULT_PER_RUN_CAP_USD = 5;

/** Hard ceiling for a caller-supplied per-run cap — matches the Zod schema max(5). */
export const MAX_PER_RUN_CAP_USD = 5;

/**
 * Conservative worst-case cost of a SINGLE replay completion, used as a
 * pre-call reservation against the per-run cap so the last call can never
 * overshoot it (reserve-then-settle; observed real cost ≈ $0.001–0.002/item).
 */
export const WORST_CASE_ITEM_USD = 0.25;

export type ModelSwapCorpusKind = "conversation" | "orchestration";

export interface ModelSwapOverrides {
  /** Model id to replay under (resolved via getClientForModel). */
  model: string;
}

export interface CompletionOutcome {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
}

/**
 * Injectable collaborators — tests substitute these so no live DB pool /
 * metered LLM call is needed to pin the bounding semantics.
 */
export interface ModelSwapDeps {
  claim?: typeof claimAutonomousBudget;
  completeOne?: (messages: ModelSwapCorpusItem["messages"], model: string, tenantId: number) => Promise<CompletionOutcome>;
  grade?: (baseline: string, simulated: string) => Promise<number | null>;
}

/** Default completion: canonical client resolution + usage-based cost estimate.
 * NOTE: create() MUST be called with the RETURNED actualModelId (the $0-policy
 * swap can remap the requested id; the original id then 400s silently). No
 * max_tokens / temperature — several lanes reject non-default sampling params. */
async function defaultCompleteOne(
  messages: ModelSwapCorpusItem["messages"],
  model: string,
  tenantId: number,
): Promise<CompletionOutcome> {
  const { getClientForModel } = await import("../../providers");
  const { estimateCostUsd } = await import("../../agentic/cost-ledger");
  const { client, actualModelId } = await getClientForModel(model, tenantId);
  const started = Date.now();
  const res = await client.chat.completions.create({ model: actualModelId, messages });
  const latencyMs = Date.now() - started;
  const tokensIn = res.usage?.prompt_tokens ?? 0;
  const tokensOut = res.usage?.completion_tokens ?? 0;
  return {
    text: res.choices?.[0]?.message?.content ?? "",
    tokensIn,
    tokensOut,
    costUsd: estimateCostUsd(actualModelId, tokensIn, tokensOut),
    latencyMs,
  };
}

export interface ModelSwapReport {
  corpus: ModelSwapCorpusKind;
  overrides: ModelSwapOverrides;
  totals: {
    requested: number;
    replayed: number;
    errored: number;
    /** Items not attempted because the accumulated cost hit the per-run cap. */
    capStopped: number;
    skippedNoContent: number;
    totalCandidates: number;
  };
  similarity: SimilarityStats;
  similarityDriftThreshold: number;
  cost: {
    perRunCapUsd: number;
    totalCostUsd: number;
    tokensIn: number;
    tokensOut: number;
    meanLatencyMs: number | null;
  };
  stubbedToolCalls: number;
  verdict: "DRIFT" | "CHANGES" | "NO_CHANGE";
}

interface ModelSwapItemOutcome {
  itemRef: string;
  similarity: number | null;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

/** Pure: aggregate model-swap item outcomes into the report shape. */
export function buildModelSwapReport(
  corpus: ModelSwapCorpusKind,
  overrides: ModelSwapOverrides,
  requested: number,
  outcomes: ModelSwapItemOutcome[],
  meta: { errored: number; capStopped: number; skippedNoContent: number; totalCandidates: number; stubbedToolCalls: number; perRunCapUsd: number },
): ModelSwapReport {
  const similarity = summarizeSimilarity(outcomes.map((o) => o.similarity));
  const totalCostUsd = outcomes.reduce((a, o) => a + o.costUsd, 0);
  const latencies = outcomes.map((o) => o.latencyMs).filter((l) => Number.isFinite(l) && l >= 0);
  const verdict: ModelSwapReport["verdict"] =
    similarity.belowThreshold > 0 ? "DRIFT"
    : (similarity.graded > 0 && similarity.mean !== null && similarity.mean < 0.9) ? "CHANGES"
    : "NO_CHANGE";
  return {
    corpus,
    overrides,
    totals: {
      requested,
      replayed: outcomes.length,
      errored: meta.errored,
      capStopped: meta.capStopped,
      skippedNoContent: meta.skippedNoContent,
      totalCandidates: meta.totalCandidates,
    },
    similarity,
    similarityDriftThreshold: SIMILARITY_DRIFT_THRESHOLD,
    cost: {
      perRunCapUsd: meta.perRunCapUsd,
      totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
      tokensIn: outcomes.reduce((a, o) => a + o.tokensIn, 0),
      tokensOut: outcomes.reduce((a, o) => a + o.tokensOut, 0),
      meanLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    },
    stubbedToolCalls: meta.stubbedToolCalls,
    verdict,
  };
}

export interface RunModelSwapReplayOptions {
  tenantId: number;
  corpus: ModelSwapCorpusKind;
  sampleSize: number;
  overrides: ModelSwapOverrides;
  /** Per-run LLM spend cap (USD). Default $5 (spec). */
  perRunCapUsd?: number;
}

export interface RunModelSwapReplayResult {
  runId: number;
  report: ModelSwapReport;
}

/**
 * Model-swap replay over the conversation or orchestration corpus.
 *
 * Bounding invariants (spec acceptance #3/#4):
 * - Sample ceiling checked BEFORE any DB write.
 * - Budget is claimed via the atomic CAS (claimAutonomousBudget) BEFORE the
 *   sandbox_runs row is created and before ANY LLM call — a refused claim
 *   means zero completions fire. Fails CLOSED.
 * - The accumulated estimated spend is re-checked before EVERY item; hitting
 *   the per-run cap stops the run cleanly (remaining items counted as
 *   capStopped, surfaced in the report — never silently dropped).
 */
export async function runModelSwapReplay(
  opts: RunModelSwapReplayOptions,
  deps: ModelSwapDeps = {},
): Promise<RunModelSwapReplayResult> {
  const { tenantId, overrides } = opts;
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error(`runModelSwapReplay: invalid tenantId ${tenantId}`);
  if (!Number.isInteger(opts.sampleSize) || opts.sampleSize <= 0) throw new Error(`runModelSwapReplay: invalid sampleSize ${opts.sampleSize}`);
  if (opts.sampleSize > SAMPLE_CEILING) throw new Error(`runModelSwapReplay: sampleSize ${opts.sampleSize} exceeds ceiling ${SAMPLE_CEILING}`);
  if (opts.corpus !== "conversation" && opts.corpus !== "orchestration") throw new Error(`runModelSwapReplay: invalid corpus`);
  if (!overrides || typeof overrides.model !== "string" || !overrides.model.trim()) throw new Error(`runModelSwapReplay: overrides.model required`);

  const perRunCapUsd = (typeof opts.perRunCapUsd === "number" && Number.isFinite(opts.perRunCapUsd) && opts.perRunCapUsd > 0)
    ? Math.min(opts.perRunCapUsd, MAX_PER_RUN_CAP_USD)
    : DEFAULT_PER_RUN_CAP_USD;

  // Claim-before-spend CAS: reserve the whole per-run cap up front. A refused
  // claim aborts BEFORE any sandbox_runs row or LLM call exists.
  const claim = deps.claim ?? claimAutonomousBudget;
  const claimRes = await claim({
    tenantId,
    estimatedUsd: perRunCapUsd,
    label: `sandbox-modelswap-${opts.corpus}`,
  });
  if (!claimRes.ok) {
    throw new Error(
      `runModelSwapReplay: budget claim REFUSED (${claimRes.reason || "cap"}) — spent $${claimRes.spentUsd.toFixed(2)} of $${claimRes.capUsd.toFixed(2)} daily cap. No LLM calls were made.`,
    );
  }

  const completeOne = deps.completeOne ?? defaultCompleteOne;
  const grade = deps.grade ?? gradeSimilarity;

  const runRow = await pool.query(
    `INSERT INTO sandbox_runs (tenant_id, corpus, status, overrides, sample_size)
     VALUES ($1, $2, 'running', $3::jsonb, $4) RETURNING id`,
    [tenantId, opts.corpus, JSON.stringify({ ...overrides, perRunCapUsd }), opts.sampleSize],
  );
  const runId: number = runRow.rows[0].id;

  try {
    const corpus = opts.corpus === "conversation"
      ? await loadConversationCorpus(tenantId, opts.sampleSize)
      : await loadOrchestrationCorpus(tenantId, opts.sampleSize);

    const outcomes: ModelSwapItemOutcome[] = [];
    let errored = 0;
    let capStopped = 0;
    let accruedUsd = 0;

    const { sim } = await runInSimulation(`sandbox-run-${runId}`, async () => {
      for (let i = 0; i < corpus.items.length; i++) {
        const item = corpus.items[i];
        // Pre-call worst-case reservation: stop while the NEXT call could still
        // overshoot the cap, not just after accrual crosses it (reserve-then-settle).
        if (accruedUsd + WORST_CASE_ITEM_USD > perRunCapUsd) { capStopped = corpus.items.length - i; break; }
        try {
          const out = await completeOne(item.messages, overrides.model, tenantId);
          accruedUsd += out.costUsd;
          const similarity = await grade(item.baselineOutput, out.text);
          const outcome: ModelSwapItemOutcome = {
            itemRef: item.itemRef,
            similarity,
            costUsd: out.costUsd,
            tokensIn: out.tokensIn,
            tokensOut: out.tokensOut,
            latencyMs: out.latencyMs,
          };
          outcomes.push(outcome);
          await pool.query(
            `INSERT INTO sandbox_results (tenant_id, run_id, item_ref, baseline, simulated, flip, severity)
             VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)`,
            [
              tenantId,
              runId,
              item.itemRef,
              JSON.stringify({ output: item.baselineOutput.slice(0, 2000), personaId: item.personaId }),
              JSON.stringify({
                output: out.text.slice(0, 2000),
                similarity,
                costUsd: out.costUsd,
                tokensIn: out.tokensIn,
                tokensOut: out.tokensOut,
                latencyMs: out.latencyMs,
                model: overrides.model,
              }),
              "none",
              similarity !== null && similarity < SIMILARITY_DRIFT_THRESHOLD ? "warn" : "info",
            ],
          );
        } catch (err: any) {
          errored++;
          console.warn(`[sandbox-replay] run=${runId} item=${item.itemRef} errored: ${err?.message}`);
        }
      }
      return null;
    });

    const report = buildModelSwapReport(opts.corpus, overrides, opts.sampleSize, outcomes, {
      errored,
      capStopped,
      skippedNoContent: corpus.skippedNoContent,
      totalCandidates: corpus.totalCandidates,
      stubbedToolCalls: sim.stubbedCalls.length,
      perRunCapUsd,
    });

    await pool.query(
      `UPDATE sandbox_runs SET status = 'complete', report = $1::jsonb, completed_at = now()
        WHERE id = $2 AND tenant_id = $3`,
      [JSON.stringify(report), runId, tenantId],
    );
    return { runId, report };
  } catch (err: any) {
    await pool.query(
      `UPDATE sandbox_runs SET status = 'failed', error = $1, completed_at = now()
        WHERE id = $2 AND tenant_id = $3`,
      [String(err?.message || err).slice(0, 500), runId, tenantId],
    ).catch(() => {});
    throw err;
  }
}
