/**
 * Plan Executor (Round 26)
 *
 * The keystone that closes the planner→approve→execute loop.
 *
 * Before this module, decidePlan would CAS-flip a plan to 'approved' and
 * emit `plan.approved`, but no consumer dispatched the steps. Plans
 * stalled forever — the system could plan and decide, never deliver.
 *
 * Design notes:
 *   - CAS on 'approved' → 'executing' so reentry / concurrent kicks
 *     can't double-execute a plan.
 *   - Steps run sequentially in `n` order. `depends_on` and
 *     `parallel_eligible` are respected loosely (sequential is a strict
 *     subset of any DAG honoring depends_on). Future: real DAG runner.
 *   - Each step is a JSON-only LLM call via runLlmTask, scoped to the
 *     step's allowed tools. v0 does not actually invoke side-effecting
 *     tools — it asks the persona to *plan and report* what it would do.
 *     This is intentional: the planner→executor handshake must be
 *     proven safe before we wire it to real send_email / stripe_charge
 *     calls. v0.5 will add a tools allowlist dispatcher.
 *   - execution_log is appended atomically via jsonb `||` so concurrent
 *     observers see consistent state.
 *   - Boot recovery: any plan stuck in 'executing' with a stale
 *     updated_at (> 10 min) is reset and retried. Prevents permanent
 *     stalls after a process crash mid-execution.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { emitEvent } from "./event-bus";
import { runLlmTask } from "./llm-task";
import { recordStepReward } from "./agentic/step-reward";

import { logSilentCatch } from "./lib/silent-catch";
const STEP_MODEL = "gemini-2.5-flash"; // cheap and reliable for v0
const STEP_TIMEOUT_MS = 60_000;
const STALE_EXECUTING_MIN = 10;
const MAX_CONCURRENT_PLANS = 2;
// R125+14 — continuous replanning. On a step failure the executor asks the
// planner to revise the REMAINING steps in light of what actually happened,
// rather than aborting the whole plan. Bounded so a pathological objective
// can't loop forever.
const MAX_REPLANS = 2;
const REPLAN_MODEL = "anthropic/claude-sonnet-4.5";

interface PlanRow {
  id: number;
  tenant_id: number;
  objective: string;
  status: string;
  plan_json: any;
  execution_log: any;
}

interface StepResult {
  step: number;
  agent: string;
  started_at: string;
  ended_at: string;
  durationMs: number;
  model?: string;
  success: boolean;
  summary?: string;
  output?: any;
  notes?: string;
  error?: string;
}

const inFlight = new Set<number>();

// R57 — deferred queue. Previously when MAX_CONCURRENT_PLANS was hit,
// executePlan would silently return and the approved plan sat untouched
// until the next process restart triggered resumeStuckPlans(). Now we
// requeue with a 30s backoff; the CAS in the claim step makes reentry
// safe and the executor naturally drains as in-flight slots free up.
const deferred = new Set<number>();
const DEFER_RETRY_MS = 30_000;
function scheduleDeferred(planId: number) {
  if (deferred.has(planId)) return;
  deferred.add(planId);
  setTimeout(() => {
    deferred.delete(planId);
    executePlan(planId).catch(e =>
      console.warn(`[plan-executor] deferred retry of plan #${planId} failed: ${e?.message ?? e}`)
    );
  }, DEFER_RETRY_MS);
}

// Exported for /api/admin/concurrency observability — read-only snapshot.
export function getPlanExecutorStats() {
  return {
    inFlight: inFlight.size,
    deferred: deferred.size,
    maxConcurrent: MAX_CONCURRENT_PLANS,
  };
}

function nowIso() { return new Date().toISOString(); }

async function appendExecutionLog(planId: number, entry: any) {
  await db.execute(sql`
    UPDATE plans
    SET execution_log = COALESCE(execution_log, '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${planId}
  `);
}

async function runStep(plan: PlanRow, step: any, priorResults: StepResult[]): Promise<StepResult> {
  const t0 = Date.now();
  const startedIso = nowIso();
  // R63.16 — priorContext now carries the full `output` payload from each prior
  // step (not just `summary`). Previously personas saw only meta-descriptions
  // like "Identified 3 compounds" without the actual compounds, so downstream
  // steps had nothing concrete to act on. Per-step output is capped so a
  // pathological multi-MB step doesn't blow the next prompt's token budget.
  const PRIOR_OUTPUT_CAP = 3000;
  const priorContext = priorResults
    .filter(r => r.success)
    .map(r => {
      const parts: string[] = [`### Step ${r.step} (${r.agent}) — ${r.summary || "(no summary)"}`];
      if (r.output !== undefined && r.output !== null && r.output !== "") {
        const outStr = typeof r.output === "string" ? r.output : JSON.stringify(r.output, null, 2);
        const clipped = outStr.length > PRIOR_OUTPUT_CAP
          ? `${outStr.slice(0, PRIOR_OUTPUT_CAP)}\n…(truncated, original was ${outStr.length} chars)`
          : outStr;
        parts.push(`Output:\n${clipped}`);
      }
      if (r.notes) parts.push(`Notes: ${String(r.notes).slice(0, 500)}`);
      return parts.join("\n");
    })
    .join("\n\n");

  const prompt = [
    `You are ${step.agent}, executing step ${step.n} of an approved plan.`,
    ``,
    `Plan objective: ${plan.objective}`,
    ``,
    `Your task for this step: ${step.task}`,
    ``,
    `Tools you may reference (do not invent others): ${(step.tools || []).join(", ") || "(none specified)"}`,
    priorContext ? `\nPrior step results (full content from earlier personas — use as your inputs):\n${priorContext}` : "",
    ``,
    `Return a JSON object describing exactly what you did for this step.`,
    `IMPORTANT — Downstream personas will only see your "summary" and "output" fields, not your reasoning. Therefore:`,
    `  • "summary" — one-line description of what you accomplished (e.g. "Drafted 3 candidate titles").`,
    `  • "output" — the ACTUAL content the next persona needs as input (the list, draft, findings, decision, data, etc.). NOT a meta-description. If your task was to identify three things, "output" must contain those three things in full. Treat "output" as the payload of your handoff.`,
    `  • "notes" — optional caveats or context for the next persona.`,
    `Be concrete. If you cannot complete this step, set success=false and explain in "summary".`,
  ].join("\n");

  const schema = {
    type: "object",
    required: ["success", "summary"],
    properties: {
      success: { type: "boolean" },
      summary: { type: "string" },
      output: {},
      notes: { type: "string" },
    },
  };

  // Round 31 — register the step with the process watchdog so a step
  // that hangs past its hard cap (e.g. provider stuck holding the
  // socket open past STEP_TIMEOUT_MS) gets force-cancelled by the
  // watchdog scan and emits a process.cancelled event Felix can act
  // on. hardCap = STEP_TIMEOUT_MS + 10s buffer (runLlmTask's own
  // timeout is the primary brake).
  const watchdogRunId = `plan-${plan.id}-step-${step.n}-${t0}`;
  let watchdogRegistered = false;
  try {
    const wd = await import("./process-watchdog");
    wd.register({
      runId: watchdogRunId,
      kind: "plan-step",
      label: `plan #${plan.id} step ${step.n} (${step.agent})`,
      hardCapMs: STEP_TIMEOUT_MS + 10_000,
      meta: { planId: plan.id, stepN: step.n, agent: step.agent },
    });
    watchdogRegistered = true;
  } catch (_silentErr) { logSilentCatch("server/plan-executor.ts", _silentErr); }

  let res: any;
  try {
    res = await runLlmTask({
      prompt,
      model: STEP_MODEL,
      timeoutMs: STEP_TIMEOUT_MS,
      schema,
      temperature: 0.2,
      maxTokens: 4096,
      // R64.C — bill plan-step LLM calls to the plan's owning tenant.
      tenantId: plan.tenant_id,
    });
  } finally {
    if (watchdogRegistered) {
      try {
        const wd = await import("./process-watchdog");
        wd.complete(watchdogRunId);
      } catch (_silentErr) { logSilentCatch("server/plan-executor.ts", _silentErr); }
    }
  }

  const endedIso = nowIso();
  const durationMs = Date.now() - t0;

  if (!res.success) {
    return {
      step: step.n,
      agent: step.agent,
      started_at: startedIso,
      ended_at: endedIso,
      durationMs,
      success: false,
      error: res.error || "step llm failed",
      model: res.model,
    };
  }

  const j = res.json || {};
  return {
    step: step.n,
    agent: step.agent,
    started_at: startedIso,
    ended_at: endedIso,
    durationMs,
    model: res.model,
    success: j.success !== false,
    summary: j.summary || "",
    output: j.output,
    notes: j.notes,
  };
}

/**
 * R125+14 — Continuous replanning. Given the failed step + everything that ran
 * so far, ask the planner to produce a REVISED set of remaining steps that routes
 * around the failure (retry differently, substitute an approach, or drop a now-
 * impossible step). Returns null if no viable revision (caller then fails the plan).
 * Revised steps keep the same {n, agent, task, tools} shape runStep expects, and
 * are renumbered to continue after the failed step.
 */
async function replanRemainingSteps(
  plan: PlanRow,
  priorResults: StepResult[],
  failedStep: any,
  remainingSteps: any[],
  attempt: number,
): Promise<any[] | null> {
  const done = priorResults
    .map(r => `- step ${r.step} (${r.agent}): ${r.success ? "OK" : "FAILED"} — ${r.summary || r.error || ""}`)
    .join("\n");
  const remaining = remainingSteps
    .map(s => `- step ${s.n} (${s.agent}): ${s.task}`)
    .join("\n") || "(none — the failed step was the last)";

  const prompt = [
    `You are the planner for an autonomous AI corporation revising a plan mid-execution (replan attempt ${attempt}/${MAX_REPLANS}).`,
    ``,
    `Objective: ${plan.objective}`,
    ``,
    `Steps already executed:\n${done}`,
    ``,
    `The step that JUST FAILED: step ${failedStep.n} (${failedStep.agent}) — "${failedStep.task}". Failure: ${priorResults[priorResults.length - 1]?.error || priorResults[priorResults.length - 1]?.summary || "unknown"}`,
    ``,
    `Originally-remaining steps after it:\n${remaining}`,
    ``,
    `Produce a REVISED list of remaining steps that achieves the objective despite the failure. You may: retry the failed work with a different approach, substitute a different agent/tool, reorder, or drop steps made impossible by the failure. Reuse outputs from completed steps. If the objective is genuinely unachievable now, return an empty steps array.`,
    `Return STRICT JSON: { "steps": [ { "agent": "persona name", "task": "what to do", "tools": ["tool", ...] } ], "rationale": "1 sentence" }`,
  ].join("\n");

  const res = await runLlmTask({
    prompt,
    model: REPLAN_MODEL,
    timeoutMs: STEP_TIMEOUT_MS,
    temperature: 0.3,
    maxTokens: 2000,
    tenantId: plan.tenant_id,
    schema: {
      type: "object",
      required: ["steps"],
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            required: ["agent", "task"],
            properties: {
              agent: { type: "string" },
              task: { type: "string" },
              tools: { type: "array", items: { type: "string" } },
            },
          },
        },
        rationale: { type: "string" },
      },
    },
  });

  if (!res.success || !res.json) return null;
  const revised = (res.json.steps || []) as any[];
  if (!Array.isArray(revised) || revised.length === 0) return null;
  // Renumber to continue after the failed step so step ids stay monotonic.
  let n = (failedStep.n ?? priorResults.length) + 1;
  return revised.map(s => ({ n: n++, agent: s.agent, task: s.task, tools: Array.isArray(s.tools) ? s.tools : [] }));
}

/**
 * Execute an approved plan. Idempotent on its own status — uses CAS to
 * claim the plan; later reentries no-op.
 */
export async function executePlan(planId: number): Promise<void> {
  if (inFlight.has(planId)) return;
  if (inFlight.size >= MAX_CONCURRENT_PLANS) {
    console.log(`[plan-executor] concurrency cap reached, deferring plan #${planId} (retry in ${DEFER_RETRY_MS / 1000}s)`);
    scheduleDeferred(planId);
    return;
  }
  inFlight.add(planId);
  try {
    // CAS: only proceed if plan is currently 'approved'. Recovery path
    // (resumeStuckPlans) flips 'executing' → 'approved' before re-firing.
    const claim: any = await db.execute(sql`
      UPDATE plans
      SET status = 'executing', updated_at = CURRENT_TIMESTAMP
      WHERE id = ${planId} AND status = 'approved'
      RETURNING id, tenant_id, objective, plan_json, execution_log
    `);
    const row: PlanRow | undefined = (claim.rows ?? claim)[0];
    if (!row) {
      console.log(`[plan-executor] plan #${planId} not in 'approved' status — skipping`);
      return;
    }

    const steps = (row.plan_json?.steps || []) as any[];
    if (!Array.isArray(steps) || steps.length === 0) {
      await db.execute(sql`UPDATE plans SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ${planId}`);
      await emitEvent({
        type: "plan.failed",
        source: "plan-executor",
        tenantId: row.tenant_id,
        data: { planId, reason: "no steps in plan_json" },
      });
      return;
    }

    await appendExecutionLog(planId, { type: "execution.started", at: nowIso(), stepCount: steps.length });

    const results: StepResult[] = [];
    let allOk = true;
    let replanCount = 0;
    let replanned = false;
    // Mutable work queue so continuous replanning can splice in revised steps.
    let queue = [...steps];
    let idx = 0;
    while (idx < queue.length) {
      const step = queue[idx];
      let result: StepResult;
      try {
        result = await runStep(row, step, results);
      } catch (e: any) {
        result = {
          step: step.n,
          agent: step.agent,
          started_at: nowIso(),
          ended_at: nowIso(),
          durationMs: 0,
          success: false,
          error: e?.message || "step threw",
        };
      }
      results.push(result);
      await appendExecutionLog(planId, result);

      // R125+14 — Process Reward Model. Score every intermediate step (LLM-free
      // heuristic PRM) so the system has dense per-step signal, not just terminal
      // success/failure. Fire-and-forget; never blocks or fails the plan.
      recordStepReward({
        tenantId: row.tenant_id,
        planId,
        stepIndex: step.n ?? idx,
        agent: step.agent,
        task: step.task,
        success: result.success,
        summary: result.summary,
        output: result.output,
        error: result.error,
        durationMs: result.durationMs,
      }).catch(e => logSilentCatch("server/plan-executor.ts", e));

      if (!result.success) {
        // R125+14 — Continuous replanning before giving up.
        if (replanCount < MAX_REPLANS) {
          replanCount++;
          let revised: any[] | null = null;
          try {
            revised = await replanRemainingSteps(row, results, step, queue.slice(idx + 1), replanCount);
          } catch (e: any) {
            console.warn(`[plan-executor] replan attempt ${replanCount} threw on plan #${planId}: ${e?.message ?? e}`);
          }
          if (revised && revised.length) {
            replanned = true;
            queue = [...queue.slice(0, idx + 1), ...revised];
            await appendExecutionLog(planId, {
              type: "plan.replanned", at: nowIso(), afterStep: step.n ?? idx, attempt: replanCount, newStepCount: revised.length,
            });
            await emitEvent({
              type: "plan.replanned", source: "plan-executor", tenantId: row.tenant_id,
              data: { planId, afterStep: step.n ?? idx, attempt: replanCount, newSteps: revised.length },
            }).catch(e => logSilentCatch("server/plan-executor.ts", e));
            idx++;
            continue; // proceed into the revised steps; failure is being routed around
          }
        }
        allOk = false;
        break;
      }
      idx++;
    }

    const finalStatus = allOk ? "completed" : "failed";
    await db.execute(sql`
      UPDATE plans
      SET status = ${finalStatus},
          updated_at = CURRENT_TIMESTAMP,
          execution_log = COALESCE(execution_log, '[]'::jsonb) || ${JSON.stringify([{
            type: `execution.${finalStatus}`,
            at: nowIso(),
            okSteps: results.filter(r => r.success).length,
            totalSteps: results.length,
            replanned,
            replanCount,
          }])}::jsonb
      WHERE id = ${planId}
    `);

    await emitEvent({
      type: allOk ? "plan.completed" : "plan.failed",
      source: "plan-executor",
      tenantId: row.tenant_id,
      data: {
        planId,
        objective: row.objective,
        okSteps: results.filter(r => r.success).length,
        totalSteps: results.length,
        replanned,
        failedStep: allOk ? null : results.find(r => !r.success)?.step ?? null,
        failedReason: allOk ? null : results.find(r => !r.success)?.error ?? null,
      },
    });

    console.log(`[plan-executor] plan #${planId} → ${finalStatus} (${results.filter(r => r.success).length}/${results.length} steps${replanned ? `, replanned ${replanCount}x` : ""})`);
  } catch (err: any) {
    console.error(`[plan-executor] fatal error on plan #${planId}:`, err?.message || err);
    try {
      await db.execute(sql`
        UPDATE plans SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ${planId} AND status = 'executing'
      `);
    } catch (_silentErr) { logSilentCatch("server/plan-executor.ts", _silentErr); }
  } finally {
    inFlight.delete(planId);
  }
}

/**
 * Boot-time recovery. Any plan stuck 'executing' with stale updated_at
 * is rolled back to 'approved' and re-fired. Also kicks anything still
 * in 'approved' that never got picked up (e.g., process crashed between
 * decidePlan's emit and the executor kick).
 */
export async function resumeStuckPlans(): Promise<{ resumed: number; restarted: number }> {
  const stale: any = await db.execute(sql`
    UPDATE plans
    SET status = 'approved', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'executing'
      AND updated_at < NOW() - (${STALE_EXECUTING_MIN} * INTERVAL '1 minute')
    RETURNING id
  `);
  const staleRows = (stale.rows ?? stale) as any[];

  const pending: any = await db.execute(sql`
    SELECT id FROM plans WHERE status = 'approved' ORDER BY id ASC LIMIT 50
  `);
  const pendingRows = (pending.rows ?? pending) as any[];

  for (const r of pendingRows) {
    setImmediate(() => { executePlan(r.id).catch(() => {}); });
  }

  if (staleRows.length || pendingRows.length) {
    console.log(`[plan-executor] boot recovery: reset ${staleRows.length} stuck, kicked ${pendingRows.length} pending`);
  }
  return { resumed: pendingRows.length, restarted: staleRows.length };
}
