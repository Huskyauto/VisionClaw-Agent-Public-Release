/**
 * server/agentic/harness-adaptation.ts — NIGHTLY side of per-model harness
 * adaptation (Self-Harness, arXiv:2606.09498, CC BY 4.0 — pattern, not code).
 *
 * The paper's one genuine delta over VisionClaw's existing nightly self-
 * improvement stack is PER-MODEL adaptation. This module instantiates the
 * paper's three stages on OUR own infrastructure, reusing everything we already
 * have — no new workflow:
 *
 *   1. Weakness Mining  — pull recent failure/declined trace spans, GROUP BY the
 *                         originating model id (agent_trace_spans.metadata.modelId).
 *   2. Harness Proposal — for each model with enough evidence, split the failures
 *                         train/held-out, digest the TRAIN slice, and ask an LLM
 *                         for ONE minimal, model-specific system-prompt addendum.
 *   3. Proposal Validation — (a) deterministic addendum validator (fail-closed
 *                         forbidden surfaces + minimality bound), (b) a held-out
 *                         regression check: an LLM judge rates how many HELD-OUT
 *                         failures the addendum would likely have prevented; must
 *                         clear MIN_PREVENTION, and (c) the SAME 3-LLM jury gate
 *                         we use for skill upgrades (2-of-3 FIX to apply).
 *
 * Accepted addenda are written `active` and injected at runtime by
 * harness-injection.ts keyed on the model id. Everything is ADMIN/platform-owned.
 * Invoked from scripts/skill-optimize-nightly.ts (the existing nightly run).
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { LEGACY_MODEL_ALIASES } from "../providers";
import { runLlmTask } from "../llm-task";
import { juryTriage } from "../lib/jury-triage";
import { ADMIN_TENANT_ID } from "../tenant-constants";
import { clearHarnessCache } from "./harness-injection";
import { captureHarnessManifest } from "../lib/harness-manifest";
import { buildHarnessManifest } from "../lib/harness-manifest-core";
import {
  HARNESS_FORBIDDEN_PATTERNS,
  MAX_ADDENDUM_CHARS,
  MIN_ADDENDUM_CHARS,
  validateAddendum,
  splitFailures,
  digestFailures,
  type FailureSample,
} from "./harness-addendum-lib";

const DEFAULT_WINDOW_DAYS = 14;
const MIN_EVIDENCE_FAILURES = 6;   // need enough to split train/held-out meaningfully
const HELD_OUT_RATIO = 0.4;
const MIN_PREVENTION = 0.5;        // held-out prevention rate the addendum must clear
const MAX_MODELS_PER_RUN = 5;      // cap paid LLM spend per nightly run
const MAX_HELD_OUT_JUDGED = 12;    // cap judge prompt size
const SPLIT_SEED = 0x5e1f;         // deterministic split seed (Self-Harness reproducibility)
const ADAPTATION_MODEL = "gemini-2.5-flash";
const PROPOSER_TEMPERATURE = 0.3;
const PROPOSER_MAX_TOKENS = 1200;
const PROPOSER_TIMEOUT_MS = 60_000;
const HELD_OUT_JUDGE_TEMPERATURE = 0.1;
const HELD_OUT_JUDGE_MAX_TOKENS = 1200;
const HELD_OUT_JUDGE_TIMEOUT_MS = 60_000;
const VALIDATION_POLICY_VERSION = "harness-addendum-validator-v1";

const PROPOSER_PROMPT_TEMPLATE =
  `You tune the operating harness of an LLM agent platform. The model "{{modelId}}" produced the ` +
  `recurring failures below (clustered, with counts). Propose ONE minimal, concrete, model-specific ` +
  `addendum to add to this model's system prompt that would most reduce these failures.\n\n` +
  `Rules:\n` +
  `- It must be a short behavioral nudge (a few sentences, < 600 chars). NOT a second system prompt.\n` +
  `- It must address a CONCRETE failure pattern below, not generic best-practice filler.\n` +
  `- It must NEVER weaken safety, refuse-handling, or any guard; it ADDS guidance, never overrides.\n` +
  `- No URLs, no secrets, no "ignore previous instructions"-style directives.\n` +
  `- "weakness" is a short (<=8 word) label for the failure pattern you are fixing.`;
const PROPOSER_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    weakness: { type: "string" },
    addendum: { type: "string" },
  },
  required: ["weakness", "addendum"],
};
const HELD_OUT_JUDGE_PROMPT_TEMPLATE =
  `Held-out regression check for a proposed system-prompt addendum for model "{{modelId}}".\n\n` +
  `PROPOSED ADDENDUM:\n"""{{addendum}}"""\n\n` +
  `For each held-out failure below (which the addendum was NOT derived from), judge honestly whether ` +
  `having this addendum in the system prompt would LIKELY have prevented that specific failure. Be ` +
  `strict: only mark prevents=true when the addendum directly addresses the failure's cause. Return a ` +
  `"results" array with one {index, prevents} per item.`;
const HELD_OUT_JUDGE_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "number" }, prevents: { type: "boolean" } },
        required: ["index", "prevents"],
      },
    },
  },
  required: ["results"],
};
const JURY_ISSUE_TEMPLATE =
  `Per-model harness adaptation (Self-Harness): add a model-specific system-prompt addendum for "{{modelId}}".\n\n` +
  `Mined weakness: {{weakness}}\n` +
  `Evidence: {{failureCount}} recent failures (train {{trainCount}} / held-out {{heldOutCount}}).\n` +
  `Held-out prevention rate: {{prevention}} (threshold {{minimumPrevention}}).\n\n` +
  `Proposed addendum:\n"""{{addendum}}"""\n\n` +
  `Should this addendum be applied (injected at runtime for this model)? It must address the concrete ` +
  `weakness, stay minimal, and never weaken any safety/guard behavior.`;
const JURY_CONTEXT_TEMPLATE = `Top mined failure clusters for {{modelId}} (train slice):\n{{trainDigest}}`;

function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ""));
}

function hashContract(contract: unknown): string {
  return buildHarnessManifest({ contract }).hash;
}

function buildJuryExecution(voters: Array<{ model?: string; provider?: string }> = []) {
  return {
    pool: "frontier",
    invokedVia: "harness-adaptation-nightly",
    meteredOverride: false,
    roster: voters.map((voter) => ({
      model: String(voter.model || ""),
      provider: String(voter.provider || ""),
    })).sort((a, b) => `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`)),
  };
}

function buildAdaptationTaskContracts(juryExecution = buildJuryExecution()) {
  return {
    proposerPromptHash: hashContract(PROPOSER_PROMPT_TEMPLATE),
    proposerSchemaHash: hashContract(PROPOSER_OUTPUT_SCHEMA),
    heldOutJudgePromptHash: hashContract(HELD_OUT_JUDGE_PROMPT_TEMPLATE),
    heldOutJudgeSchemaHash: hashContract(HELD_OUT_JUDGE_SCHEMA),
    validationPolicyHash: hashContract({
      version: VALIDATION_POLICY_VERSION,
      minChars: MIN_ADDENDUM_CHARS,
      maxChars: MAX_ADDENDUM_CHARS,
      forbiddenPatterns: HARNESS_FORBIDDEN_PATTERNS.map((pattern) => ({
        source: pattern.source,
        flags: pattern.flags,
      })),
    }),
    juryContractHash: hashContract({
      issueTemplate: JURY_ISSUE_TEMPLATE,
      contextTemplate: JURY_CONTEXT_TEMPLATE,
      requiredVerdict: "FIX",
      requiredMajority: 2,
      invokedVia: "harness-adaptation-nightly",
    }),
    proposerExecution: {
      model: ADAPTATION_MODEL,
      temperature: PROPOSER_TEMPERATURE,
      maxTokens: PROPOSER_MAX_TOKENS,
      timeoutMs: PROPOSER_TIMEOUT_MS,
      requiresTools: true,
    },
    heldOutJudgeExecution: {
      model: ADAPTATION_MODEL,
      temperature: HELD_OUT_JUDGE_TEMPERATURE,
      maxTokens: HELD_OUT_JUDGE_MAX_TOKENS,
      timeoutMs: HELD_OUT_JUDGE_TIMEOUT_MS,
      requiresTools: true,
    },
    heldOutSampleCap: MAX_HELD_OUT_JUDGED,
    juryExecution,
  };
}

function buildAdaptationManifestProfile(
  modelId: string,
  weakness: string,
  addendum: string,
  windowDays: number,
  juryExecution?: ReturnType<typeof buildJuryExecution>,
) {
  return {
    kind: "harness-adaptation" as const,
    modelId,
    weakness,
    candidateAddendumHash: buildHarnessManifest({ addendum }).hash,
    proposerModel: ADAPTATION_MODEL,
    maxCandidateChars: MAX_ADDENDUM_CHARS,
    evidenceWindowDays: windowDays,
    minEvidenceFailures: MIN_EVIDENCE_FAILURES,
    heldOutRatio: HELD_OUT_RATIO,
    splitSeed: SPLIT_SEED,
    heldOutJudgeModel: ADAPTATION_MODEL,
    minimumPrevention: MIN_PREVENTION,
    juryRequiredMajority: 2,
    taskContracts: buildAdaptationTaskContracts(juryExecution),
  };
}

export type HarnessEntryStatus = "applied" | "shadow" | "rejected" | "held" | "no-evidence" | "error";

export interface HarnessEntryResult {
  modelId: string;
  status: HarnessEntryStatus;
  detail: string;
  weakness?: string;
}

export interface HarnessRunResult {
  scanned: number;
  modelsConsidered: number;
  applied: number;
  results: HarnessEntryResult[];
}

interface MinedFailure extends FailureSample {
  rawModelId: string;
}

/** Stage 1 — pull recent failure/declined spans that carry a model id. */
async function mineFailures(windowDays: number): Promise<Map<string, MinedFailure[]>> {
  const res: any = await db.execute(
    sql`SELECT metadata->>'modelId' AS model_id, tool_name, summary, status
        FROM agent_trace_spans
        WHERE status IN ('error', 'declined')
          AND metadata->>'modelId' IS NOT NULL
          AND tenant_id = ${ADMIN_TENANT_ID}
          AND started_at > now() - (${windowDays} || ' days')::interval
        ORDER BY started_at DESC
        LIMIT 4000`,
  );
  const rows: any[] = (res as any).rows || res || [];
  const byModel = new Map<string, MinedFailure[]>();
  for (const r of rows) {
    const raw = String(r.model_id || "").trim();
    if (!raw) continue;
    // Normalize through the same alias map the runtime resolver uses, so a mined
    // legacy id and the runtime requested id key to the SAME addendum.
    const modelId = LEGACY_MODEL_ALIASES[raw] || raw;
    if (!byModel.has(modelId)) byModel.set(modelId, []);
    byModel.get(modelId)!.push({
      rawModelId: raw,
      toolName: r.tool_name ?? null,
      summary: r.summary ?? null,
      status: r.status ?? null,
    });
  }
  return byModel;
}

/** Stage 2 — propose ONE minimal model-specific addendum from the train digest. */
async function proposeAddendum(
  modelId: string,
  trainDigest: string,
): Promise<{ weakness: string; addendum: string } | null> {
  const r = await runLlmTask({
    model: ADAPTATION_MODEL,
    tenantId: ADMIN_TENANT_ID,
    temperature: PROPOSER_TEMPERATURE,
    maxTokens: PROPOSER_MAX_TOKENS,
    timeoutMs: PROPOSER_TIMEOUT_MS,
    requiresTools: true,
    prompt: fillTemplate(PROPOSER_PROMPT_TEMPLATE, { modelId }),
    input: { model: modelId, recurringFailures: trainDigest },
    schema: PROPOSER_OUTPUT_SCHEMA,
  });
  if (!r.success || !r.json) return null;
  const weakness = String(r.json.weakness || "").trim().slice(0, 80);
  const addendum = String(r.json.addendum || "").trim();
  if (!weakness || !addendum) return null;
  return { weakness, addendum };
}

/** Stage 3b — held-out regression check: fraction of held-out failures the addendum would prevent. */
async function heldOutPreventionRate(
  modelId: string,
  addendum: string,
  heldOut: MinedFailure[],
): Promise<number | null> {
  const sample = heldOut.slice(0, MAX_HELD_OUT_JUDGED);
  if (sample.length === 0) return null;
  const items = sample.map((f, i) => `${i}. ${f.toolName ? f.toolName + ": " : ""}${(f.summary || "(no summary)").slice(0, 200)}`);
  const r = await runLlmTask({
    model: ADAPTATION_MODEL,
    tenantId: ADMIN_TENANT_ID,
    temperature: HELD_OUT_JUDGE_TEMPERATURE,
    maxTokens: HELD_OUT_JUDGE_MAX_TOKENS,
    timeoutMs: HELD_OUT_JUDGE_TIMEOUT_MS,
    requiresTools: true,
    prompt: fillTemplate(HELD_OUT_JUDGE_PROMPT_TEMPLATE, { modelId, addendum }),
    input: { heldOutFailures: items },
    schema: HELD_OUT_JUDGE_SCHEMA,
  });
  if (!r.success || !r.json || !Array.isArray(r.json.results)) return null;
  let prevented = 0;
  const seen = new Set<number>();
  for (const res of r.json.results) {
    const idx = Number(res?.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= sample.length || seen.has(idx)) continue;
    seen.add(idx);
    if (res?.prevents === true) prevented++;
  }
  if (seen.size === 0) return null;
  return prevented / sample.length;
}

interface DeltaRecord {
  harnessManifestId: number | null;
  modelId: string;
  weakness: string;
  addendum: string;
  status: string;
  heldOutPrevention: number | null;
  baselineRate: number | null;
  juryVerdict: string | null;
  juryMajority: number | null;
  evidenceCount: number;
}

function insertDeltaStatement(row: DeltaRecord) {
  return sql`INSERT INTO model_harness_deltas
      (tenant_id, harness_manifest_id, model_id, weakness, addendum, status, held_out_prevention, baseline_rate, jury_verdict, jury_majority, evidence_count)
      VALUES (${ADMIN_TENANT_ID}, ${row.harnessManifestId}, ${row.modelId}, ${row.weakness}, ${row.addendum}, ${row.status},
              ${row.heldOutPrevention}, ${row.baselineRate}, ${row.juryVerdict}, ${row.juryMajority}, ${row.evidenceCount})`;
}

/** Persist a decision row (audit trail for every outcome, not just applied). */
async function recordDelta(row: DeltaRecord): Promise<void> {
  await db.execute(insertDeltaStatement(row));
}

/**
 * Swap a live addendum atomically. A failed replacement insert must preserve
 * the previous active row; otherwise a transient DB error silently weakens the
 * running harness while the nightly loop reports only a soft error.
 */
async function activateDelta(row: DeltaRecord): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`UPDATE model_harness_deltas
          SET status = 'retired', updated_at = now()
          WHERE model_id = ${row.modelId} AND weakness = ${row.weakness} AND status = 'active'
            AND tenant_id = ${ADMIN_TENANT_ID}`,
    );
    await tx.execute(insertDeltaStatement(row));
  });
}

async function processModel(
  modelId: string,
  failures: MinedFailure[],
  dryRun: boolean,
  windowDays: number,
): Promise<HarnessEntryResult> {
  if (failures.length < MIN_EVIDENCE_FAILURES) {
    return { modelId, status: "no-evidence", detail: `only ${failures.length} failures (< ${MIN_EVIDENCE_FAILURES})` };
  }
  const { train, heldOut } = splitFailures(failures, HELD_OUT_RATIO, SPLIT_SEED);
  if (train.length === 0 || heldOut.length === 0) {
    return { modelId, status: "no-evidence", detail: `split left an empty slice (train=${train.length}, heldOut=${heldOut.length})` };
  }

  // Stage 2 — proposal from the TRAIN slice only.
  const trainDigest = digestFailures(train);
  const proposal = await proposeAddendum(modelId, trainDigest);
  if (!proposal) return { modelId, status: "error", detail: "proposer returned no usable addendum" };
  const { weakness, addendum } = proposal;
  // Persisted candidates must carry a full, content-addressed runtime context.
  // The candidate text itself stays in model_harness_deltas; the manifest stores
  // only its hash plus the active addendum fingerprints it was evaluated beside.
  // A capture error intentionally aborts this model's update before any decision
  // row can claim reproducibility without a manifest.
  let manifest = dryRun
    ? null
    : await captureHarnessManifest({
        tenantId: ADMIN_TENANT_ID,
        profile: buildAdaptationManifestProfile(modelId, weakness, addendum, windowDays),
      });

  // Stage 3a — deterministic fail-closed validator.
  const v = validateAddendum(addendum);
  if (!v.ok) {
    if (!dryRun) {
      await recordDelta({ harnessManifestId: manifest?.id ?? null, modelId, weakness, addendum: addendum.slice(0, 600), status: "rejected", heldOutPrevention: null, baselineRate: null, juryVerdict: null, juryMajority: null, evidenceCount: failures.length });
    }
    return { modelId, weakness, status: "rejected", detail: `validator: ${v.reasons.join("; ")}` };
  }

  // Stage 3b — held-out regression check on the HELD-OUT slice.
  const prevention = await heldOutPreventionRate(modelId, addendum, heldOut);
  if (prevention === null) {
    return { modelId, weakness, status: "error", detail: "held-out judge returned no usable result" };
  }
  if (prevention < MIN_PREVENTION) {
    if (!dryRun) {
      await recordDelta({ harnessManifestId: manifest?.id ?? null, modelId, weakness, addendum, status: "shadow", heldOutPrevention: prevention, baselineRate: 0, juryVerdict: null, juryMajority: null, evidenceCount: failures.length });
    }
    return { modelId, weakness, status: "shadow", detail: `held-out prevention ${prevention.toFixed(2)} < ${MIN_PREVENTION} (kept as shadow, not injected)` };
  }

  // Stage 3c — the same 3-LLM jury we use for skill upgrades.
  const issueText = fillTemplate(JURY_ISSUE_TEMPLATE, {
    modelId,
    weakness,
    failureCount: failures.length,
    trainCount: train.length,
    heldOutCount: heldOut.length,
    prevention: prevention.toFixed(2),
    minimumPrevention: MIN_PREVENTION,
    addendum,
  });
  const context = fillTemplate(JURY_CONTEXT_TEMPLATE, { modelId, trainDigest });
  const decision = await juryTriage({ issueText, context, tenantId: ADMIN_TENANT_ID, invokedVia: "harness-adaptation-nightly" });
  const verdict = decision.verdict;
  const majority = decision.majority;
  if (!dryRun) {
    // The configured pool is captured before the jury runs. Replace the final
    // decision record's provenance with an immutable snapshot of the actual
    // roster that made this decision, too.
    manifest = await captureHarnessManifest({
      tenantId: ADMIN_TENANT_ID,
      profile: buildAdaptationManifestProfile(
        modelId,
        weakness,
        addendum,
        windowDays,
        buildJuryExecution(decision.votes),
      ),
    });
  }

  if (verdict !== "FIX" || majority < 2) {
    if (!dryRun) {
      await recordDelta({ harnessManifestId: manifest?.id ?? null, modelId, weakness, addendum, status: "shadow", heldOutPrevention: prevention, baselineRate: 0, juryVerdict: verdict, juryMajority: majority, evidenceCount: failures.length });
    }
    return { modelId, weakness, status: "held", detail: `jury ${verdict} ${majority}/3 — kept as shadow, not injected` };
  }

  // Apply: retire the prior active addendum for this (model, weakness), activate the new one.
  if (dryRun) {
    return { modelId, weakness, status: "applied", detail: `DRY RUN — would activate (jury FIX ${majority}/3, prevention ${prevention.toFixed(2)})` };
  }
  await activateDelta({ harnessManifestId: manifest?.id ?? null, modelId, weakness, addendum, status: "active", heldOutPrevention: prevention, baselineRate: 0, juryVerdict: verdict, juryMajority: majority, evidenceCount: failures.length });
  clearHarnessCache();
  return { modelId, weakness, status: "applied", detail: `activated (jury FIX ${majority}/3, held-out prevention ${prevention.toFixed(2)})` };
}

/**
 * Run one nightly pass of per-model harness adaptation. Caller (the nightly
 * script) is responsible for the autonomous-budget gate. Returns a structured
 * summary; throws only on a mining-query failure (so the script can fail-closed).
 */
export async function runHarnessAdaptation(opts?: { windowDays?: number; dryRun?: boolean }): Promise<HarnessRunResult> {
  const windowDays = opts?.windowDays ?? DEFAULT_WINDOW_DAYS;
  const dryRun = opts?.dryRun ?? false;

  const byModel = await mineFailures(windowDays);
  const scanned = [...byModel.values()].reduce((n, arr) => n + arr.length, 0);

  // Process the models with the most evidence first; cap per-run spend.
  const ordered = [...byModel.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, MAX_MODELS_PER_RUN);

  const results: HarnessEntryResult[] = [];
  for (const [modelId, failures] of ordered) {
    try {
      results.push(await processModel(modelId, failures, dryRun, windowDays));
    } catch (e) {
      results.push({ modelId, status: "error", detail: (e as Error)?.message || String(e) });
    }
  }

  return {
    scanned,
    modelsConsidered: ordered.length,
    applied: results.filter((r) => r.status === "applied").length,
    results,
  };
}
