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
 *   - Steps run as a topological WAVE schedule (R125+67): each iteration
 *     runs every step whose `depends_on` are satisfied; `parallel_eligible`
 *     ready steps run concurrently, otherwise we advance one step at a time
 *     in `n` order. A plan with no deps / no parallel flags reduces exactly
 *     to the old sequential walk, so this is backward-compatible. Malformed
 *     dependency graphs fail closed before any step runs.
 *   - Each step is a JSON-only LLM call via runLlmTask, scoped to the
 *     step's allowed tools. This executor deliberately does NOT invoke
 *     side-effecting tools — it asks the persona to *plan and report* what
 *     it would do. That is intentional and remains so: the place real,
 *     guarded, fail-CLOSED tool execution already lives is `task-planner.ts`
 *     (it runs `enforceToolPolicy` → `executeTool`). Wiring autonomous
 *     send_email / stripe_charge into THIS loop is a deliberate, owner-gated
 *     decision, not a silent default — keep the plan-and-report boundary
 *     unless that decision is explicitly made.
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
import { recordStepReward, heuristicStepScore, decideDegradingReplan } from "./agentic/step-reward";
import { executeToolWithTimeout } from "./tools";
import { ADMIN_TENANT_ID } from "./auth";
import { resolvePlanStepPolicyPersona } from "./safety/plan-step-authz";
import {
  isPlanStateGroundingEnabled,
  preparePlanGoalStateAdvisory,
  type PlanGoalStateInput,
} from "./lib/plan-goal-state";
import {
  PLAN_STEP_MAX_TOTAL_MS,
  runPlanStepTaskWithRetry,
  shouldRecoverStalePlan,
  shouldRecoverTransientPlan,
} from "./lib/plan-step-resilience";
import {
  isPlanReadinessShadowEnabled,
  preparePlanReadinessShadow,
  preparePlanRepairShadow,
} from "./lib/plan-readiness-shadow";
import { getToolTimeoutMs, getToolWatchdogHardCapMs } from "./lib/tool-timeout-policy";
import {
  normalizeLegacyExecutablePlanStepIds,
  validateExecutablePlanStructure,
} from "./lib/executable-plan-structure";

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
  // Finding 1A — authoritative persona for guarded tool execution. The plans
  // table has no separate "invoker" column, so the plan's persisted
  // tenant_id + planner_persona_id ARE the authorization identity used to
  // stamp tool-step args (see runToolStep). NEVER taken from plan_json.
  planner_persona_id?: number | null;
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

async function appendExecutionLog(planId: number, tenantId: number, entry: any) {
  const rowsFromResult = (result: any): any[] => {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.rows)) return result.rows;
    throw new Error("unexpected database result shape while appending execution log");
  };
  const eventId = typeof entry?.eventId === "string" ? entry.eventId : null;
  if (eventId) {
    const updated: any = await db.execute(sql`
      UPDATE plans
      SET execution_log = COALESCE(execution_log, '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${planId} AND tenant_id = ${tenantId}
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(execution_log, '[]'::jsonb)) AS existing
          WHERE existing->>'eventId' = ${eventId}
        )
      RETURNING id
    `);
    if (rowsFromResult(updated).length > 0) return;
    const duplicate: any = await db.execute(sql`
      SELECT 1
      FROM plans
      WHERE id = ${planId} AND tenant_id = ${tenantId}
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(execution_log, '[]'::jsonb)) AS existing
          WHERE existing->>'eventId' = ${eventId}
        )
      LIMIT 1
    `);
    if (rowsFromResult(duplicate).length === 0) {
      throw new Error("execution log event did not match the claimed tenant-plan row");
    }
    return;
  }
  await db.execute(sql`
      UPDATE plans
      SET execution_log = COALESCE(execution_log, '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${planId} AND tenant_id = ${tenantId}
    `);
}

async function appendPlanGoalState(
  planId: number,
  tenantId: number,
  input: PlanGoalStateInput,
): Promise<string> {
  return preparePlanGoalStateAdvisory(input, {
    enabled: isPlanStateGroundingEnabled(),
    persist: (event) => appendExecutionLog(planId, tenantId, event),
    onError: (error) => logSilentCatch("server/plan-executor.ts", error),
  });
}

/**
 * Finding 1A (Manus review) — REAL, side-effecting, GUARDED tool execution.
 *
 * A plan step that explicitly declares a string `tool` is a STRUCTURED TOOL
 * STEP: it is executed for real against `executeTool`, but ONLY after the AHB
 * destructive-tool policy clears it (fail CLOSED). Steps with no `tool` keep the
 * original LLM plan-and-report behavior, so every pre-existing plan and every
 * replan-produced step (which never carries `tool`) is byte-for-byte unchanged.
 *
 * SAFETY MODEL (mirrors the proven server/task-planner.ts pattern):
 *  • Authorization signals (`_tenantId`/`_personaId`/`_conversationId`/
 *    `_approvedByGate`) are NEVER trusted from `plan_json` (it is LLM/planner-
 *    authored DATA). They are stripped, then re-stamped from the plan's OWN
 *    persisted identity (`tenant_id` + `planner_persona_id`).
 *  • The plans table has no separate "invoker" column, so the plan's tenant_id
 *    IS the authorization tenant: the admin/owner tenant runs as the trusted
 *    "system" persona (autonomous corp ops); any NON-admin tenant gets no
 *    trusted persona name ⇒ trusted-only / approval-required / owner-only tools
 *    fail CLOSED.
 *  • `hasApproval` is hard-false: a blanket CEO plan-approval is NOT a per-action
 *    approval, so approval-required tools (money / customer / mass-comms /
 *    destructive) still fail CLOSED even on an admin-tenant plan.
 *  • We deliberately AVOID executeGuardedTool — its HITL confirmation await would
 *    deadlock an autonomous plan — and call enforceToolPolicy directly instead.
 *  • Kill switch: PLAN_EXECUTOR_LIVE_TOOLS_OFF=1 downgrades tool steps back to
 *    plan-and-report (no side effects).
 */
async function runToolStep(plan: PlanRow, step: any, priorResults: StepResult[]): Promise<StepResult> {
  const t0 = Date.now();
  const startedIso = nowIso();
  const toolName = String(step.tool).trim();

  // Step args are DATA, never authorization. Shallow-copy so we never mutate the
  // shared plan_json object.
  const args: Record<string, any> = (step.args && typeof step.args === "object" && !Array.isArray(step.args))
    ? { ...step.args }
    : {};

  // {{prev}} substitution — let a tool step pull concrete outputs from
  // successful prior steps into its string args (same convention as task-planner).
  const TOOL_PRIOR_OUTPUT_CAP = 800;
  const priorBlobRaw = priorResults
    .filter(r => r.success)
    .map(r => {
      const out = r.output === undefined || r.output === null
        ? ""
        : (typeof r.output === "string" ? r.output : JSON.stringify(r.output));
      return `### Step ${r.step} (${r.agent}) — ${r.summary || "(no summary)"}${out ? `\n${out}` : ""}`;
    })
    .join("\n\n");
  const priorBlob = priorBlobRaw.length > TOOL_PRIOR_OUTPUT_CAP
    ? `${priorBlobRaw.slice(0, TOOL_PRIOR_OUTPUT_CAP)}\n…(prior evidence truncated)`
    : priorBlobRaw;
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.includes("{{prev}}")) {
      args[k] = v.replace(/\{\{prev\}\}/g, priorBlob);
    }
  }

  // Strip every model-supplied authorization signal, then stamp authoritative
  // values derived from the plan's persisted identity.
  delete (args as Record<string, any>)._tenantId;
  delete (args as Record<string, any>)._personaId;
  delete (args as Record<string, any>)._conversationId;
  delete (args as Record<string, any>)._approvedByGate;

  const endFail = (error: string, summary?: string): StepResult => ({
    step: step.n,
    agent: step.agent,
    started_at: startedIso,
    ended_at: nowIso(),
    durationMs: Date.now() - t0,
    success: false,
    error,
    summary,
  });

  // Plan identity drives the policy persona + tenant-scope stamp. plans.tenant_id is
  // NOT NULL (schema) so a non-numeric value here means corrupt/forged plan identity —
  // fail CLOSED rather than defaulting to ADMIN_TENANT_ID (which would convert a
  // malformed plan into trusted-admin execution context).
  if (typeof plan.tenant_id !== "number") {
    return endFail("Plan has no valid numeric tenant identity; refusing to execute step (fail-closed).", `tool ${toolName} blocked`);
  }
  const authTenant = plan.tenant_id;
  args._tenantId = authTenant;
  if (typeof plan.planner_persona_id === "number") args._personaId = plan.planner_persona_id;

  // Watchdog backstop: use the SAME authoritative timeout policy as
  // executeToolWithTimeout. A fixed 70s cap falsely labelled legitimate
  // delegate_task work CANCELLED even though its guarded dispatch is allowed
  // 16 minutes. The watchdog remains observational; the actual Promise.race +
  // AbortController in executeToolWithTimeout settles the step and releases the
  // executor slot.
  const watchdogRunId = `plan-${plan.id}-tool-${step.n}-${t0}`;
  const authoritativeToolTimeoutMs = getToolTimeoutMs(toolName);
  const toolWatchdogHardCapMs = getToolWatchdogHardCapMs(toolName);
  let watchdogRegistered = false;
  try {
    const wd = await import("./process-watchdog");
    wd.register({
      runId: watchdogRunId,
      kind: "plan-step",
      label: `plan #${plan.id} step ${step.n} tool ${toolName}`,
      hardCapMs: toolWatchdogHardCapMs,
      meta: {
        planId: plan.id,
        stepN: step.n,
        tool: toolName,
        authoritativeToolTimeoutMs,
        toolWatchdogHardCapMs,
      },
    });
    watchdogRegistered = true;
  } catch (_silentErr) { logSilentCatch("server/plan-executor.ts", _silentErr); }

  try {
    // AHB destructive-tool policy — fail CLOSED. executeTool() does NOT run the
    // policy itself; enforce it here. Admin/owner tenant runs as trusted
    // "system"; any non-admin tenant gets no trusted name ⇒ destructive tools
    // fail closed. A policy-check THROW is treated as a block.
    let policyBlockReason: string | null = null;
    try {
      const { enforceToolPolicy } = await import("./safety/destructive-tool-policy");
      const personaName = resolvePlanStepPolicyPersona(authTenant, ADMIN_TENANT_ID);
      const pol = await enforceToolPolicy(toolName, args, {
        tenantId: authTenant,
        personaId: typeof plan.planner_persona_id === "number" ? plan.planner_persona_id : null,
        personaName,
        invokedVia: "plan-executor",
        hasApproval: false,
      });
      if (pol.action === "block") policyBlockReason = `Blocked by destructive-tool policy: ${pol.reason}`;
    } catch (_polErr: any) {
      policyBlockReason = `Destructive-tool policy check failed for '${toolName}'. Refusing to execute.`;
    }
    if (policyBlockReason) return endFail(policyBlockReason, `tool ${toolName} blocked`);

    const result = await executeToolWithTimeout(toolName, args);
    const endedIso = nowIso();
    const durationMs = Date.now() - t0;
    if (result && typeof result === "object" && (result as any).error) {
      return endFail(String((result as any).error), `tool ${toolName} failed`);
    }
    return {
      step: step.n,
      agent: step.agent,
      started_at: startedIso,
      ended_at: endedIso,
      durationMs,
      success: true,
      summary: `Executed ${toolName}`,
      output: result,
    };
  } catch (err: any) {
    return endFail(err?.message || `tool ${toolName} execution failed`, `tool ${toolName} threw`);
  } finally {
    if (watchdogRegistered) {
      try {
        const wd = await import("./process-watchdog");
        wd.complete(watchdogRunId);
      } catch (_silentErr) { logSilentCatch("server/plan-executor.ts", _silentErr); }
    }
  }
}

async function runStep(
  plan: PlanRow,
  step: any,
  priorResults: StepResult[],
  verifiedGoalStateContext = "",
): Promise<StepResult> {
  // Finding 1A — a step that explicitly declares a `tool` is executed for real
  // through the guarded path. Everything else stays LLM plan-and-report, so
  // existing plans and replanned steps are unchanged. The kill switch downgrades
  // tool steps back to plan-and-report.
  if (
    step && typeof step.tool === "string" && step.tool.trim() &&
    process.env.PLAN_EXECUTOR_LIVE_TOOLS_OFF !== "1"
  ) {
    return runToolStep(plan, step, priorResults);
  }

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
    verifiedGoalStateContext ? `\n${verifiedGoalStateContext}` : "",
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
      hardCapMs: PLAN_STEP_MAX_TOTAL_MS + 10_000,
      meta: { planId: plan.id, stepN: step.n, agent: step.agent },
    });
    watchdogRegistered = true;
  } catch (_silentErr) { logSilentCatch("server/plan-executor.ts", _silentErr); }

  let res: any;
  try {
    const outcome = await runPlanStepTaskWithRetry(
      (timeoutMs) => runLlmTask({
        prompt,
        model: STEP_MODEL,
        timeoutMs,
        schema,
        temperature: 0.2,
        maxTokens: 4096,
        // R64.C — bill plan-step LLM calls to the plan's owning tenant.
        tenantId: plan.tenant_id,
      }),
      ({ attempt, nextAttempt, error }) => appendExecutionLog(plan.id, plan.tenant_id, {
        type: "step.transient_retry",
        at: nowIso(),
        step: step.n,
        agent: step.agent,
        attempt,
        nextAttempt,
        error,
      }),
    );
    res = outcome.result;
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
  // "failure" (default): the pivot step returned success:false.
  // "degrading": the pivot step technically SUCCEEDED but its step-reward score
  // flagged hollow output — downstream steps would build on nothing (Sol #6).
  pivot: { trigger: "failure" | "degrading"; issue?: string } = { trigger: "failure" },
): Promise<any[] | null> {
  const done = priorResults
    .map(r => `- step ${r.step} (${r.agent}): ${r.success ? "OK" : "FAILED"} — ${r.summary || r.error || ""}`)
    .join("\n");
  const remaining = remainingSteps
    .map(s => `- step ${s.n} (${s.agent}): ${s.task}`)
    .join("\n") || "(none — the failed step was the last)";

  const pivotLine = pivot.trigger === "degrading"
    ? `The trajectory is DEGRADING: step ${failedStep.n} (${failedStep.agent}) — "${failedStep.task}" reported success but produced negligible/hollow output (${pivot.issue || "low step-quality score"}), and so did the step before it. Remaining steps are about to build on weak intermediate results.`
    : `The step that JUST FAILED: step ${failedStep.n} (${failedStep.agent}) — "${failedStep.task}". Failure: ${priorResults[priorResults.length - 1]?.error || priorResults[priorResults.length - 1]?.summary || "unknown"}`;

  const prompt = [
    `You are the planner for an autonomous AI corporation revising a plan mid-execution (replan attempt ${attempt}/${MAX_REPLANS}).`,
    ``,
    `Objective: ${plan.objective}`,
    ``,
    `Steps already executed:\n${done}`,
    ``,
    pivotLine,
    ``,
    `Originally-remaining steps after it:\n${remaining}`,
    ``,
    `Produce a REVISED list of remaining steps that achieves the objective despite the ${pivot.trigger === "degrading" ? "weak intermediate output" : "failure"}. You may: retry the ${pivot.trigger === "degrading" ? "weak" : "failed"} work with a different approach, substitute a different agent/tool, reorder, or drop steps made impossible by the ${pivot.trigger === "degrading" ? "weak output" : "failure"}. Reuse outputs from completed steps. If the objective is genuinely unachievable now, return an empty steps array.`,
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
  // Set only from the row returned by the approved→executing claim. The fatal
  // catch must never infer tenant ownership from an untrusted caller or plan id.
  let claimedTenantId: number | undefined;
  try {
    // CAS: only proceed if plan is currently 'approved'. Recovery path
    // (resumeStuckPlans) flips 'executing' → 'approved' before re-firing.
    const claim: any = await db.execute(sql`
      UPDATE plans
      SET status = 'executing', updated_at = CURRENT_TIMESTAMP
      WHERE id = ${planId} AND status = 'approved'
      RETURNING id, tenant_id, objective, plan_json, execution_log, planner_persona_id
    `);
    const row: PlanRow | undefined = (claim.rows ?? claim)[0];
    if (!row) {
      console.log(`[plan-executor] plan #${planId} not in 'approved' status — skipping`);
      return;
    }
    if (!Number.isInteger(row.tenant_id) || row.tenant_id <= 0) {
      throw new Error("claimed plan has no valid positive-integer tenant identity");
    }
    claimedTenantId = row.tenant_id;

    const rawSteps = row.plan_json?.steps;
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
      await db.execute(sql`
        UPDATE plans SET status = 'failed', updated_at = CURRENT_TIMESTAMP
        WHERE id = ${planId} AND tenant_id = ${claimedTenantId} AND status = 'executing'
      `);
      await emitEvent({
        type: "plan.failed",
        source: "plan-executor",
        tenantId: row.tenant_id,
        data: { planId, reason: "no steps in plan_json" },
      });
      return;
    }
    const steps = normalizeLegacyExecutablePlanStepIds(rawSteps) as any[];

    // R125+67 — Real DAG runner. Steps declare `depends_on` (array of step `n`s)
    // and `parallel_eligible` (bool). Instead of a strict sequential walk we run
    // the plan as a topological wave schedule: each iteration computes the set of
    // steps whose dependencies are all satisfied (`ready`); parallel-eligible ready
    // steps run concurrently, otherwise we advance one step at a time in `n` order.
    // Sequential execution is a strict subset (no parallel flags / no deps ⇒
    // identical behavior to the old loop), so this is backward-compatible.
    const results: StepResult[] = [];
    let allOk = true;
    let replanCount = 0;
    // Shadow-only evidence counter. Unlike replanCount, this never increments
    // for a successful-but-degrading trajectory replan.
    let failedWaveCount = 0;
    let replanned = false;
    let terminalFailure: { step: number | null; error: string } | undefined;
    // Sol #6 — live trajectory steering. Chronological step-reward scores (the
    // same pure heuristic recordStepReward persists) so a degrading run of
    // hollow successes can trigger a replan BEFORE anything technically fails.
    // At most one degradation-triggered replan per plan (conservative; failures
    // keep their own replan budget within MAX_REPLANS).
    const stepScoreTrail: { n: number; score: number; rationale: string }[] = [];
    let degradingReplanUsed = false;

    const structuralIssues = validateExecutablePlanStructure(steps);
    if (structuralIssues.length > 0) {
      const reason = `invalid executable plan graph: ${structuralIssues.join("; ")}`;
      const failureEvent = {
        type: "execution.invalid_graph",
        at: nowIso(),
        reason,
        issues: structuralIssues,
      };
      const rejection: any = await db.execute(sql`
        UPDATE plans
        SET status = 'failed',
            updated_at = CURRENT_TIMESTAMP,
            execution_log = COALESCE(execution_log, '[]'::jsonb) || ${JSON.stringify([failureEvent])}::jsonb
        WHERE id = ${planId} AND tenant_id = ${claimedTenantId} AND status = 'executing'
        RETURNING id
      `);
      const rejectedRow = (rejection.rows ?? rejection)[0];
      if (!rejectedRow) {
        throw new Error(`invalid-graph rejection did not update claimed plan #${planId}`);
      }
      try {
        await emitEvent({
          type: "plan.failed",
          source: "plan-executor",
          tenantId: row.tenant_id,
          data: { planId, reason, issues: structuralIssues },
        });
      } catch (error) {
        console.error(`[plan-executor] failed to emit invalid-graph rejection for plan #${planId}`, error);
        logSilentCatch("server/plan-executor.ts", error);
      }
      console.warn(`[plan-executor] plan #${planId} refused malformed dependency graph: ${structuralIssues.join("; ")}`);
      return;
    }
    await appendExecutionLog(planId, claimedTenantId, { type: "execution.started", at: nowIso(), stepCount: steps.length });
    {
      void preparePlanReadinessShadow({
        planId,
        objective: row.objective,
        strategy: row.plan_json?.strategy,
        steps,
      }, {
        enabled: isPlanReadinessShadowEnabled(),
        persist: (event) => appendExecutionLog(planId, row.tenant_id, event),
        onError: (error) => {
          console.warn(`[plan-readiness-shadow] plan #${planId} readiness persistence failed`);
          logSilentCatch("server/plan-executor.ts", error);
        },
      }).then((assessment) => {
        if (assessment) console.log(`[plan-readiness-shadow] plan #${planId} → ${assessment.verdict} (${assessment.score}/6)`);
      }).catch((error) => {
        console.warn(`[plan-readiness-shadow] plan #${planId} readiness task rejected unexpectedly`);
        logSilentCatch("server/plan-executor.ts", error);
      });
    }
    const byN = new Map<number, any>();
    for (const s of steps) byN.set(s.n, s);
    const done = new Set<number>();
    let pending: any[] = [...steps];
    let verifiedGoalStateContext = await appendPlanGoalState(planId, claimedTenantId, {
      planId,
      objective: row.objective,
      phase: "start",
      steps,
      results,
      pendingSteps: pending,
      replanCount,
    });

    const depsSatisfied = (step: any): boolean => {
      const deps = Array.isArray(step.depends_on) ? step.depends_on : [];
      return deps.every((d: any) => done.has(d));
    };

    const runStepSafe = async (step: any): Promise<StepResult> => {
      try {
        return await runStep(row, step, results, verifiedGoalStateContext);
      } catch (e: any) {
        return {
          step: step.n,
          agent: step.agent,
          started_at: nowIso(),
          ended_at: nowIso(),
          durationMs: 0,
          success: false,
          error: e?.message || "step threw",
        };
      }
    };

    while (pending.length > 0) {
      const ready = pending.filter(depsSatisfied);
      if (ready.length === 0) {
        // No step can proceed but work remains ⇒ cyclic or unsatisfiable deps.
        allOk = false;
        terminalFailure = {
          step: null,
          error: `Execution deadlocked with unsatisfied dependencies: ${pending.map(s => s.n).join(", ")}`,
        };
        await appendExecutionLog(planId, claimedTenantId, {
          type: "execution.deadlock", at: nowIso(), pendingSteps: pending.map(s => s.n),
        });
        console.warn(`[plan-executor] plan #${planId} deadlocked — ${pending.length} step(s) with unsatisfiable depends_on`);
        break;
      }

      // Honor parallel_eligible: run the parallel-eligible ready steps together;
      // otherwise advance a single step (preserves the original sequential order).
      const parallelBatch = ready.filter(s => s.parallel_eligible === true);
      const wave = parallelBatch.length >= 2 ? parallelBatch : [ready[0]];
      if (wave.length > 1) {
        await appendExecutionLog(planId, claimedTenantId, { type: "execution.wave", at: nowIso(), parallel: wave.map(s => s.n) });
      }

      const waveResults = await Promise.all(wave.map(s => runStepSafe(s)));

      const failedThisWave: { step: any; result: StepResult }[] = [];
      for (let k = 0; k < wave.length; k++) {
        const step = wave[k];
        const result = waveResults[k];
        results.push(result);
        await appendExecutionLog(planId, claimedTenantId, result);

        // R125+14 — Process Reward Model. Score every intermediate step (LLM-free
        // heuristic PRM) so the system has dense per-step signal, not just terminal
        // success/failure. Fire-and-forget; never blocks or fails the plan.
        const rewardInput = {
          tenantId: row.tenant_id,
          planId,
          stepIndex: step.n,
          agent: step.agent,
          task: step.task,
          success: result.success,
          summary: result.summary,
          output: result.output,
          error: result.error,
          durationMs: result.durationMs,
          // Task 130 — executing model, persisted into reward signals so
          // per-model quality joins don't depend on execution_log spelunking.
          model: result.model ?? null,
        };
        recordStepReward(rewardInput).catch(e => logSilentCatch("server/plan-executor.ts", e));
        // Sol #6 — same pure heuristic, computed synchronously (deterministic,
        // no DB) so the loop can steer on it THIS wave, not next boot.
        if (result.success) {
          try {
            const r = heuristicStepScore(rewardInput);
            stepScoreTrail.push({ n: step.n, score: r.score, rationale: r.rationale });
          } catch (e) { logSilentCatch("server/plan-executor.ts", e); }
        }

        pending = pending.filter(p => p !== step);
        if (result.success) done.add(step.n);
        else failedThisWave.push({ step, result });
      }
      verifiedGoalStateContext = await appendPlanGoalState(planId, claimedTenantId, {
        planId,
        objective: row.objective,
        phase: "wave",
        steps,
        results,
        pendingSteps: pending,
        replanCount,
      });

      if (failedThisWave.length > 0) {
        const terminal = failedThisWave[0];
        failedWaveCount++;
        void preparePlanRepairShadow({
          planId,
          failedStep: terminal.result.step,
          failure: terminal.result.error || terminal.result.summary,
          priorFailuresInPlan: failedWaveCount,
          steps: [terminal.step, ...pending],
        }, {
          enabled: isPlanReadinessShadowEnabled(),
          persist: (event) => appendExecutionLog(planId, row.tenant_id, event),
          onError: (error) => {
            console.warn(`[plan-readiness-shadow] plan #${planId} repair persistence failed`);
            logSilentCatch("server/plan-executor.ts", error);
          },
        }).catch((error) => {
          console.warn(`[plan-readiness-shadow] plan #${planId} repair task rejected unexpectedly`);
          logSilentCatch("server/plan-executor.ts", error);
        });
        // R125+14 — Continuous replanning before giving up. Replan around the first
        // failure of the wave; the planner sees ALL results (including any parallel
        // successes from this wave) and revises the remaining (`pending`) steps.
        if (replanCount < MAX_REPLANS) {
          replanCount++;
          let revised: any[] | null = null;
          try {
            revised = await replanRemainingSteps(row, results, terminal.step, pending, replanCount);
          } catch (e: any) {
            console.warn(`[plan-executor] replan attempt ${replanCount} threw on plan #${planId}: ${e?.message ?? e}`);
          }
          if (revised && revised.length) {
            replanned = true;
            // Revised steps carry fresh monotonic ns + no depends_on ⇒ immediately
            // ready. They replace the remaining work, routing around the failure.
            for (const rs of revised) byN.set(rs.n, rs);
            pending = [...revised];
            await appendExecutionLog(planId, claimedTenantId, {
              type: "plan.replanned", at: nowIso(), afterStep: terminal.step.n, attempt: replanCount, newStepCount: revised.length,
            });
            verifiedGoalStateContext = await appendPlanGoalState(planId, claimedTenantId, {
              planId,
              objective: row.objective,
              phase: "replan",
              steps,
              results,
              pendingSteps: pending,
              replanCount,
            });
            await emitEvent({
              type: "plan.replanned", source: "plan-executor", tenantId: row.tenant_id,
              data: { planId, afterStep: terminal.step.n, attempt: replanCount, newSteps: revised.length },
            }).catch(e => logSilentCatch("server/plan-executor.ts", e));
            continue; // proceed into the revised steps; failure is being routed around
          }
        }
        allOk = false;
        terminalFailure = {
          step: terminal.result.step,
          error: terminal.result.error || terminal.result.summary || "plan step failed",
        };
        break;
      }

      // Sol #6 — degrading-trajectory replan. No step failed this wave, but the
      // last two SUCCESSFUL steps both scored ≤ DEGRADING_STEP_SCORE_MAX (hollow
      // success — claimed done, produced nothing usable downstream). If work
      // remains, replan around the weaker of the two instead of letting the
      // remaining steps build on hollow output. Bounded: shares MAX_REPLANS and
      // fires at most once per plan.
      const degradingDecision = decideDegradingReplan(stepScoreTrail, {
        pendingCount: pending.length,
        degradingReplanUsed,
        replanCount,
        maxReplans: MAX_REPLANS,
      });
      if (degradingDecision.trigger) {
        degradingReplanUsed = true;
        replanCount++;
        const weakestN = degradingDecision.pivotN!;
        const lastTwo = stepScoreTrail.slice(-2);
        const pivotStep = byN.get(weakestN) || { n: weakestN, agent: "unknown", task: "(step no longer in map)" };
        let revised: any[] | null = null;
        try {
          revised = await replanRemainingSteps(row, results, pivotStep, pending, replanCount, {
            trigger: "degrading",
            issue: degradingDecision.issue!,
          });
        } catch (e: any) {
          console.warn(`[plan-executor] degrading-trajectory replan threw on plan #${planId}: ${e?.message ?? e}`);
        }
        if (revised && revised.length) {
          replanned = true;
          for (const rs of revised) byN.set(rs.n, rs);
          pending = [...revised];
          await appendExecutionLog(planId, claimedTenantId, {
            type: "plan.replanned", at: nowIso(), trigger: "degrading_trajectory",
            afterStep: weakestN, scores: lastTwo.map(s => s.score), attempt: replanCount, newStepCount: revised.length,
          });
          verifiedGoalStateContext = await appendPlanGoalState(planId, claimedTenantId, {
            planId,
            objective: row.objective,
            phase: "replan",
            steps,
            results,
            pendingSteps: pending,
            replanCount,
          });
          await emitEvent({
            type: "plan.replanned", source: "plan-executor", tenantId: row.tenant_id,
            data: { planId, trigger: "degrading_trajectory", afterStep: weakestN, attempt: replanCount, newSteps: revised.length },
          }).catch(e => logSilentCatch("server/plan-executor.ts", e));
        }
        // No viable revision ⇒ continue with the original remaining steps — a
        // weak-but-successful trajectory must never fail the plan on its own.
      }
    }

    const finalStatus = allOk ? "completed" : "failed";
    await appendPlanGoalState(planId, claimedTenantId, {
      planId,
      objective: row.objective,
      phase: "final",
      steps,
      results,
      pendingSteps: pending,
      replanCount,
      finalStatus,
    });
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
            failedStep: terminalFailure?.step ?? null,
            failedReason: terminalFailure?.error ?? null,
          }])}::jsonb
      WHERE id = ${planId} AND tenant_id = ${claimedTenantId} AND status = 'executing'
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
        failedStep: allOk ? null : terminalFailure?.step ?? null,
        failedReason: allOk ? null : terminalFailure?.error ?? null,
      },
    });

    console.log(`[plan-executor] plan #${planId} → ${finalStatus} (${results.filter(r => r.success).length}/${results.length} steps${replanned ? `, replanned ${replanCount}x` : ""})`);
  } catch (err: any) {
    console.error(`[plan-executor] fatal error on plan #${planId}:`, err);
    if (claimedTenantId !== undefined) {
      try {
        await db.execute(sql`
          UPDATE plans SET status = 'failed', updated_at = CURRENT_TIMESTAMP
          WHERE id = ${planId} AND tenant_id = ${claimedTenantId} AND status = 'executing'
        `);
      } catch (cleanupError) {
        console.error(`[plan-executor] fatal cleanup failed for plan #${planId}:`, cleanupError);
        logSilentCatch("server/plan-executor.ts", cleanupError);
      }
    } else {
      console.error(`[plan-executor] fatal cleanup skipped for plan #${planId}: no validated tenant from claimed row`);
    }
    throw err;
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
export async function resumeStuckPlans(): Promise<{ resumed: number; restarted: number; recovered: number }> {
  const staleCandidates: any = await db.execute(sql`
    SELECT id, tenant_id, status, plan_json, execution_log
    FROM plans
    WHERE status = 'executing'
      AND updated_at < NOW() - (${STALE_EXECUTING_MIN} * INTERVAL '1 minute')
    ORDER BY id ASC
    LIMIT 50
  `);
  const staleRows: any[] = [];
  for (const candidate of (staleCandidates.rows ?? staleCandidates) as any[]) {
    const recoverable = shouldRecoverStalePlan({
      status: candidate.status,
      planJson: candidate.plan_json,
      executionLog: candidate.execution_log,
    });
    if (!recoverable) {
      const recoveryExhausted = Array.isArray(candidate.execution_log)
        && candidate.execution_log.some((event: any) => event?.type === "execution.transient-recovery");
      const blocked = {
        type: "execution.recovery_blocked",
        at: nowIso(),
        reason: recoveryExhausted
          ? "Automatic stale recovery exhausted after one replay; manual review required."
          : "Automatic stale recovery refused because replay may repeat a structured tool side effect; manual review required.",
      };
      await db.execute(sql`
        UPDATE plans
        SET status = 'failed',
            updated_at = CURRENT_TIMESTAMP,
            execution_log = COALESCE(execution_log, '[]'::jsonb) || ${JSON.stringify([blocked])}::jsonb
        WHERE id = ${candidate.id}
          AND tenant_id = ${candidate.tenant_id}
          AND status = 'executing'
          AND updated_at < NOW() - (${STALE_EXECUTING_MIN} * INTERVAL '1 minute')
      `);
      continue;
    }
    const marker = {
      type: "execution.transient-recovery",
      at: nowIso(),
      reason: "retrying one stale LLM-only execution after interrupted progress",
    };
    const reset: any = await db.execute(sql`
      UPDATE plans
      SET status = 'approved',
          updated_at = CURRENT_TIMESTAMP,
          execution_log = COALESCE(execution_log, '[]'::jsonb) || ${JSON.stringify([marker])}::jsonb
      WHERE id = ${candidate.id}
        AND tenant_id = ${candidate.tenant_id}
        AND status = 'executing'
        AND updated_at < NOW() - (${STALE_EXECUTING_MIN} * INTERVAL '1 minute')
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(execution_log, '[]'::jsonb)) AS event
          WHERE event->>'type' = 'execution.transient-recovery'
        )
      RETURNING id
    `);
    if ((reset.rows ?? reset)[0]) staleRows.push((reset.rows ?? reset)[0]);
  }

  // Recover one recent, purely LLM-based execution that failed only because
  // the old 60-second deadline aborted a step. Structured tool plans are never
  // replayed here because repeating an earlier successful tool could duplicate
  // an external side effect. The persisted recovery marker makes this bounded
  // across process restarts.
  const transientFailures: any = await db.execute(sql`
    SELECT id, tenant_id, status, ceo_decision, ceo_decided_at, plan_json, execution_log
    FROM plans
    WHERE status = 'failed'
      AND ceo_decision = 'approved'
      AND updated_at >= NOW() - INTERVAL '24 hours'
      AND jsonb_typeof(plan_json->'steps') = 'array'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(plan_json->'steps') = 'array'
            THEN plan_json->'steps' ELSE '[]'::jsonb END
        ) AS step
        WHERE jsonb_typeof(step) <> 'object' OR step ? 'tool'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(execution_log) = 'array'
            THEN execution_log ELSE '[]'::jsonb END
        ) AS event
        WHERE event->>'type' = 'execution.transient-recovery'
      )
      AND execution_log->-1->>'type' = 'execution.failed'
    ORDER BY updated_at DESC
  `);
  const recoveredRows: any[] = [];
  for (const candidate of (transientFailures.rows ?? transientFailures) as any[]) {
    if (!shouldRecoverTransientPlan({
      status: candidate.status,
      ceoDecision: candidate.ceo_decision,
      ceoDecidedAt: candidate.ceo_decided_at,
      planJson: candidate.plan_json,
      executionLog: candidate.execution_log,
    })) continue;
    const marker = {
      type: "execution.transient-recovery",
      at: nowIso(),
      reason: "retrying recent LLM-only plan after transient step deadline",
    };
    const reset: any = await db.execute(sql`
      UPDATE plans
      SET status = 'approved',
          updated_at = CURRENT_TIMESTAMP,
          execution_log = COALESCE(execution_log, '[]'::jsonb) || ${JSON.stringify([marker])}::jsonb
      WHERE id = ${candidate.id}
        AND tenant_id = ${candidate.tenant_id}
        AND status = 'failed'
        AND ceo_decision = 'approved'
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(execution_log, '[]'::jsonb)) AS event
          WHERE event->>'type' = 'execution.transient-recovery'
        )
      RETURNING id
    `);
    if ((reset.rows ?? reset)[0]) recoveredRows.push((reset.rows ?? reset)[0]);
  }

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
  return { resumed: pendingRows.length, restarted: staleRows.length, recovered: recoveredRows.length };
}
