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
import {
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
    model: "gemini-2.5-flash",
    tenantId: ADMIN_TENANT_ID,
    temperature: 0.3,
    timeoutMs: 60000,
    prompt:
      `You tune the operating harness of an LLM agent platform. The model "${modelId}" produced the ` +
      `recurring failures below (clustered, with counts). Propose ONE minimal, concrete, model-specific ` +
      `addendum to add to this model's system prompt that would most reduce these failures.\n\n` +
      `Rules:\n` +
      `- It must be a short behavioral nudge (a few sentences, < 600 chars). NOT a second system prompt.\n` +
      `- It must address a CONCRETE failure pattern below, not generic best-practice filler.\n` +
      `- It must NEVER weaken safety, refuse-handling, or any guard; it ADDS guidance, never overrides.\n` +
      `- No URLs, no secrets, no "ignore previous instructions"-style directives.\n` +
      `- "weakness" is a short (<=8 word) label for the failure pattern you are fixing.`,
    input: { model: modelId, recurringFailures: trainDigest },
    schema: {
      type: "object",
      properties: {
        weakness: { type: "string" },
        addendum: { type: "string" },
      },
      required: ["weakness", "addendum"],
    },
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
    model: "gemini-2.5-flash",
    tenantId: ADMIN_TENANT_ID,
    temperature: 0.1,
    timeoutMs: 60000,
    prompt:
      `Held-out regression check for a proposed system-prompt addendum for model "${modelId}".\n\n` +
      `PROPOSED ADDENDUM:\n"""${addendum}"""\n\n` +
      `For each held-out failure below (which the addendum was NOT derived from), judge honestly whether ` +
      `having this addendum in the system prompt would LIKELY have prevented that specific failure. Be ` +
      `strict: only mark prevents=true when the addendum directly addresses the failure's cause. Return a ` +
      `"results" array with one {index, prevents} per item.`,
    input: { heldOutFailures: items },
    schema: {
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
    },
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

/** Persist a decision row (audit trail for every outcome, not just applied). */
async function recordDelta(row: {
  modelId: string;
  weakness: string;
  addendum: string;
  status: string;
  heldOutPrevention: number | null;
  baselineRate: number | null;
  juryVerdict: string | null;
  juryMajority: number | null;
  evidenceCount: number;
}): Promise<void> {
  await db.execute(
    sql`INSERT INTO model_harness_deltas
        (tenant_id, model_id, weakness, addendum, status, held_out_prevention, baseline_rate, jury_verdict, jury_majority, evidence_count)
        VALUES (${ADMIN_TENANT_ID}, ${row.modelId}, ${row.weakness}, ${row.addendum}, ${row.status},
                ${row.heldOutPrevention}, ${row.baselineRate}, ${row.juryVerdict}, ${row.juryMajority}, ${row.evidenceCount})`,
  );
}

/** Retire any currently-active addendum for the same (model, weakness) before activating a new one. */
async function retirePriorActive(modelId: string, weakness: string): Promise<void> {
  await db.execute(
    sql`UPDATE model_harness_deltas
        SET status = 'retired', updated_at = now()
        WHERE model_id = ${modelId} AND weakness = ${weakness} AND status = 'active'
          AND tenant_id = ${ADMIN_TENANT_ID}`,
  );
}

async function processModel(modelId: string, failures: MinedFailure[], dryRun: boolean): Promise<HarnessEntryResult> {
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

  // Stage 3a — deterministic fail-closed validator.
  const v = validateAddendum(addendum);
  if (!v.ok) {
    if (!dryRun) {
      await recordDelta({ modelId, weakness, addendum: addendum.slice(0, 600), status: "rejected", heldOutPrevention: null, baselineRate: null, juryVerdict: null, juryMajority: null, evidenceCount: failures.length });
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
      await recordDelta({ modelId, weakness, addendum, status: "shadow", heldOutPrevention: prevention, baselineRate: 0, juryVerdict: null, juryMajority: null, evidenceCount: failures.length });
    }
    return { modelId, weakness, status: "shadow", detail: `held-out prevention ${prevention.toFixed(2)} < ${MIN_PREVENTION} (kept as shadow, not injected)` };
  }

  // Stage 3c — the same 3-LLM jury we use for skill upgrades.
  const issueText =
    `Per-model harness adaptation (Self-Harness): add a model-specific system-prompt addendum for "${modelId}".\n\n` +
    `Mined weakness: ${weakness}\n` +
    `Evidence: ${failures.length} recent failures (train ${train.length} / held-out ${heldOut.length}).\n` +
    `Held-out prevention rate: ${prevention.toFixed(2)} (threshold ${MIN_PREVENTION}).\n\n` +
    `Proposed addendum:\n"""${addendum}"""\n\n` +
    `Should this addendum be applied (injected at runtime for this model)? It must address the concrete ` +
    `weakness, stay minimal, and never weaken any safety/guard behavior.`;
  const context =
    `Top mined failure clusters for ${modelId} (train slice):\n${trainDigest}`;
  const decision = await juryTriage({ issueText, context, tenantId: ADMIN_TENANT_ID, invokedVia: "harness-adaptation-nightly" });
  const verdict = decision.verdict;
  const majority = decision.majority;

  if (verdict !== "FIX" || majority < 2) {
    if (!dryRun) {
      await recordDelta({ modelId, weakness, addendum, status: "shadow", heldOutPrevention: prevention, baselineRate: 0, juryVerdict: verdict, juryMajority: majority, evidenceCount: failures.length });
    }
    return { modelId, weakness, status: "held", detail: `jury ${verdict} ${majority}/3 — kept as shadow, not injected` };
  }

  // Apply: retire the prior active addendum for this (model, weakness), activate the new one.
  if (dryRun) {
    return { modelId, weakness, status: "applied", detail: `DRY RUN — would activate (jury FIX ${majority}/3, prevention ${prevention.toFixed(2)})` };
  }
  await retirePriorActive(modelId, weakness);
  await recordDelta({ modelId, weakness, addendum, status: "active", heldOutPrevention: prevention, baselineRate: 0, juryVerdict: verdict, juryMajority: majority, evidenceCount: failures.length });
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
      results.push(await processModel(modelId, failures, dryRun));
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
