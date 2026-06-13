import { db } from "../db";
import { selfHealAttempts } from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { runLlmTask } from "../llm-task";
import { appendStep } from "./runs";
import { createApproval } from "./approvals";
import { awaitApprovalDecision } from "./resume-worker";

const MAX_HEALS_PER_RUN = 4;
const MAX_HEALS_PER_TENANT_PER_HOUR = 20;

const REPLAN_TOOL_DENYLIST = new Set([
  "decide_approval",
  "request_approval",
  "commit_decision",
  "send_email",
  "send_whatsapp",
  "post_tweet",
  "stripe_charge",
  "create_invoice",
  "delete_project",
  "delete_memory",
  "delete_knowledge",
  "expire_triple",
  "execute_code",
  "create_tool",
  "self_heal",
  "self_heal_inspect",
  "self_heal_log",
]);

const HIGH_RISK_FIX_TYPES = new Set(["custom_tool", "code_snippet"]);

export interface FailureContext {
  failedStep?: string;
  error: string;
  errorStack?: string;
  lastToolName?: string;
  lastToolArgs?: any;
  lastToolError?: string;
  recentSteps?: any[];
  metadata?: any;
}

export interface FixPlan {
  diagnosis: string;
  fixType: "replan" | "custom_tool" | "code_snippet" | "escalate" | "give_up";
  reversible: boolean;
  reasoning: string;
  replan?: {
    toolName: string;
    args: any;
    why: string;
  };
  customTool?: {
    name: string;
    description: string;
    code: string;
    parameters?: any;
  };
  codeSnippet?: {
    language: "javascript" | "python";
    code: string;
    expectedOutput?: string;
  };
  escalation?: {
    question: string;
    context: any;
  };
}

export interface SelfHealResult {
  attemptId: number;
  healed: boolean;
  fix?: FixPlan;
  output?: any;
  error?: string;
  shouldRetry: boolean;
}

const FIX_PLAN_SCHEMA = {
  type: "object",
  required: ["diagnosis", "fixType", "reversible", "reasoning"],
  properties: {
    diagnosis: { type: "string", description: "Root-cause analysis of why the run failed" },
    fixType: {
      type: "string",
      enum: ["replan", "custom_tool", "code_snippet", "escalate", "give_up"],
    },
    reversible: { type: "boolean", description: "Can the fix be safely undone if it fails?" },
    reasoning: { type: "string" },
    replan: {
      type: "object",
      properties: {
        toolName: { type: "string" },
        args: { type: "object" },
        why: { type: "string" },
      },
    },
    customTool: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        code: { type: "string" },
        parameters: { type: "object" },
      },
    },
    codeSnippet: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["javascript"] },
        code: { type: "string" },
        expectedOutput: { type: "string" },
      },
    },
    escalation: {
      type: "object",
      properties: {
        question: { type: "string" },
        context: { type: "object" },
      },
    },
  },
};

async function checkRateLimit(tenantId: number): Promise<{ allowed: boolean; reason?: string }> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(selfHealAttempts)
    .where(and(eq(selfHealAttempts.tenantId, tenantId), gte(selfHealAttempts.createdAt, oneHourAgo)));
  if (count >= MAX_HEALS_PER_TENANT_PER_HOUR) {
    return {
      allowed: false,
      reason: `Self-heal rate limit hit: ${count}/${MAX_HEALS_PER_TENANT_PER_HOUR} attempts in the last hour for tenant ${tenantId}.`,
    };
  }
  return { allowed: true };
}

async function checkRunCounter(runId: number | null | undefined): Promise<{ allowed: boolean; count: number }> {
  if (!runId) return { allowed: true, count: 0 };
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(selfHealAttempts)
    .where(eq(selfHealAttempts.runId, runId));
  return { allowed: count < MAX_HEALS_PER_RUN, count };
}

function buildDiagnosticPrompt(originalGoal: string, failure: FailureContext, availableTools: string[]): string {
  return `You are Blueprint, the solution architect of the VisionClaw Agent Platform. An agent run has failed and you must diagnose the failure and propose a fix so the platform can keep moving instead of getting stuck.

The original goal was:
"""
${originalGoal}
"""

The failure context is:
- Failed step: ${failure.failedStep || "(unknown)"}
- Error: ${failure.error}
- Last tool called: ${failure.lastToolName || "(none)"}
- Last tool args: ${JSON.stringify(failure.lastToolArgs ?? null).slice(0, 1500)}
- Last tool error: ${failure.lastToolError || "(none)"}
- Recent steps:
${(failure.recentSteps || []).slice(-5).map(s => `  • ${s.step || "(step)"} (${s.status || "?"})`).join("\n") || "  (none)"}

You may choose ONE of these fixTypes:
- "replan": Same tool, different arguments, OR a different existing tool. Cheapest, safest. Use when the issue is a bad argument, a missing parameter, or a wrong tool choice.
- "custom_tool": Generate a small JavaScript helper to register via create_tool. Use when no existing tool fits and the gap is small/repeatable. Provide name, description, and full executable JS code that takes args and returns a value.
- "code_snippet": One-shot JavaScript or Python snippet to run in the sandbox via execute_code. Use for data transforms, ad-hoc API calls, file fixups, computations.
- "escalate": Owner approval is required (irreversible action, money, public comms, or you are not confident). Provide a clear question and context for request_approval.
- "give_up": The failure cannot be safely automated. Owner must be told. Provide a brief reasoning.

Available tools you may reference for replan: ${availableTools.slice(0, 60).join(", ")}${availableTools.length > 60 ? ", ..." : ""}

Output ONLY a JSON object matching the FixPlan schema. Be concrete — include real arguments, real code, real questions. No placeholders.`;
}

async function executeFix(plan: FixPlan, opts: { tenantId: number; runId: number | null }): Promise<{ ok: boolean; output?: any; error?: string }> {
  const { executeGuardedTool } = await import("../guarded-tool-executor");
  const callTool = async (name: string, args: any) => {
    const cleanArgs: any = {};
    for (const k of Object.keys(args || {})) {
      if (!k.startsWith("_")) cleanArgs[k] = args[k];
    }
    const ctx = { ...cleanArgs, _tenantId: opts.tenantId, _invokedByModel: true, _selfHeal: true };
    const result = await executeGuardedTool(name, ctx, {
      tenantId: opts.tenantId,
      invokedVia: "self_heal",
      // R63.17 — explicit opt-in. opts.tenantId is typed non-optional so this
      // path effectively never fires the fallback today, but the explicit flag
      // means a future regression that drops opts.tenantId here still works
      // (writes to admin tenant) instead of failing closed mid-remediation.
      allowSystemFallback: true,
    });
    return result;
  };

  switch (plan.fixType) {
    case "replan": {
      if (!plan.replan?.toolName) return { ok: false, error: "replan plan missing toolName" };
      if (REPLAN_TOOL_DENYLIST.has(plan.replan.toolName)) {
        return { ok: false, error: `replan tool '${plan.replan.toolName}' is denylisted for self-heal (high-risk or governance tool). Use escalate instead.` };
      }
      try {
        const out = await callTool(plan.replan.toolName, plan.replan.args || {});
        if (out && typeof out === "object" && "error" in out) {
          return { ok: false, output: out, error: `replan tool returned error: ${out.error}` };
        }
        return { ok: true, output: out };
      } catch (err: any) {
        return { ok: false, error: `replan execution threw: ${err.message}` };
      }
    }
    case "custom_tool": {
      if (!plan.customTool?.name || !plan.customTool?.code) return { ok: false, error: "custom_tool plan missing name/code" };
      try {
        const description = `[SELF-HEAL run ${opts.runId}] ${plan.customTool.description || plan.customTool.name}\n\nProposed implementation (for human review, NOT auto-registered):\n\`\`\`js\n${plan.customTool.code.slice(0, 2000)}\n\`\`\``;
        const created = await callTool("create_tool", { description });
        return { ok: !created?.error, output: created, error: created?.error };
      } catch (err: any) {
        return { ok: false, error: `custom_tool registration threw: ${err.message}` };
      }
    }
    case "code_snippet": {
      if (!plan.codeSnippet?.code) return { ok: false, error: "code_snippet plan missing code" };
      if ((plan.codeSnippet.language || "javascript") !== "javascript") {
        return { ok: false, error: `code_snippet language '${plan.codeSnippet.language}' not supported by sandbox (JS only).` };
      }
      try {
        const out = await callTool("execute_code", { code: plan.codeSnippet.code });
        return { ok: !out?.error, output: out, error: out?.error };
      } catch (err: any) {
        return { ok: false, error: `code_snippet execution threw: ${err.message}` };
      }
    }
    case "escalate": {
      if (!plan.escalation?.question) return { ok: false, error: "escalation plan missing question" };
      if (!opts.runId) return { ok: false, error: "escalation requires a runId so the owner can resume" };
      try {
        await createApproval({
          tenantId: opts.tenantId,
          runId: opts.runId,
          question: `[SELF-HEAL] ${plan.escalation.question}`,
          context: { ...plan.escalation.context, _selfHealDiagnosis: plan.diagnosis, _selfHealReasoning: plan.reasoning },
          ttlHours: 48,
          requestedBy: "self-heal-supervisor",
        });
        return { ok: true, output: { escalated: true, message: "Owner approval requested. Resume worker will pick up after decision." } };
      } catch (err: any) {
        return { ok: false, error: `escalation failed: ${err.message}` };
      }
    }
    case "give_up":
      return { ok: false, error: `Self-heal gave up: ${plan.reasoning}` };
    default:
      return { ok: false, error: `Unknown fixType: ${plan.fixType}` };
  }
}

export async function attemptSelfHeal(params: {
  tenantId: number;
  runId?: number | null;
  triggerSource: string;
  originalGoal: string;
  failure: FailureContext;
  availableTools?: string[];
}): Promise<SelfHealResult> {
  const { tenantId, runId = null, triggerSource, originalGoal, failure } = params;

  const rateLimit = await checkRateLimit(tenantId);
  if (!rateLimit.allowed) {
    return { attemptId: -1, healed: false, error: rateLimit.reason, shouldRetry: false };
  }

  const runGate = await checkRunCounter(runId);
  if (!runGate.allowed) {
    return {
      attemptId: -1,
      healed: false,
      error: `Run ${runId} already attempted self-heal ${runGate.count} times (max ${MAX_HEALS_PER_RUN}).`,
      shouldRetry: false,
    };
  }

  const [attempt] = await db
    .insert(selfHealAttempts)
    .values({
      tenantId,
      runId,
      triggerSource,
      originalGoal,
      failureContext: failure as any,
      outcome: "diagnosing",
    })
    .returning();

  if (runId) {
    await appendStep(runId, {
      at: new Date().toISOString(),
      step: `self_heal:diagnosing:${attempt.id}`,
      status: "started",
      detail: { trigger: triggerSource, error: failure.error?.slice(0, 300) },
    });
  }

  // Repo Surgeon (#51): emit a structured incident for the unified classifier.
  // Fire-and-forget — self-repair telemetry must never block or break healing.
  import("./repair-incident")
    .then(({ captureIncident }) =>
      captureIncident({
        tenantId,
        source: "runtime_self_heal",
        title: (originalGoal || failure.failedStep || failure.error || "self-heal").slice(0, 200),
        signature: failure.failedStep || failure.lastToolName || "",
        error: failure.error,
        errorStack: failure.errorStack,
        stage: failure.failedStep,
        lastToolName: failure.lastToolName,
        lastToolArgs: failure.lastToolArgs,
        lastToolError: failure.lastToolError,
        metadata: { triggerSource, runId, selfHealAttemptId: attempt.id, ...(failure.metadata || {}) },
      }),
    )
    .catch((e) => console.warn(`[self-heal] incident capture failed (non-fatal): ${e?.message || e}`));

  let availableTools = params.availableTools;
  if (!availableTools) {
    try {
      const { getAllToolDefinitions } = await import("../tools");
      const defs = await getAllToolDefinitions();
      availableTools = defs.map((d: any) => d.function?.name).filter(Boolean);
    } catch {
      availableTools = [];
    }
  }

  // Tiered Escalation Mode:
  //   Tier 1 (loop 1, priorAttempts=0): Gemini 2.5 Flash — cheap & fast first pass
  //   Tier 2 (loop 2, priorAttempts=1): GPT-5.4 — stronger reasoning, OpenAI flagship
  //   Tier 3 (loop 3+, priorAttempts>=2): Claude Opus 4.8 — smartest brain, last resort
  // Read supervisor escalation tag (e.g. "...:esc1" or "...:esc2") and add to
  // priorAttempts so a long-running supervisor that's been signaling escalation
  // jumps straight to Tier 2/3 on its first failure instead of retrying with
  // the cheap Gemini tier.
  const escMatch = triggerSource?.match(/:esc([12])(?:$|:)/);
  const escalationBoost = escMatch ? Number(escMatch[1]) : 0;
  const priorAttempts = (runGate.count || 0) + escalationBoost;
  let diagnosticTier: 1 | 2 | 3;
  let diagnosticModel: string;
  let diagnosticThinking: "low" | "medium" | "high";
  let diagnosticTimeout: number;
  let diagnosticMaxTokens: number;

  if (priorAttempts >= 2) {
    diagnosticTier = 3;
    diagnosticModel = "gemini-3.5-flash";
    diagnosticThinking = "high";
    diagnosticTimeout = 240000;
    diagnosticMaxTokens = 16384;
  } else if (priorAttempts >= 1) {
    diagnosticTier = 2;
    diagnosticModel = "gpt-5.5";
    diagnosticThinking = "high";
    diagnosticTimeout = 75000;
    diagnosticMaxTokens = 8192;
  } else {
    diagnosticTier = 1;
    diagnosticModel = "gemini-2.5-flash";
    diagnosticThinking = "medium";
    diagnosticTimeout = 45000;
    diagnosticMaxTokens = 4096;
  }

  if (diagnosticTier > 1) {
    const reason = diagnosticTier === 3
      ? "Tier 3 — bringing in the smartest brain (Opus 4.8) after repeated failures"
      : "Tier 2 — escalating to GPT-5.4 after first self-heal attempt failed";
    console.log(`[self-heal] Tiered escalation → Tier ${diagnosticTier} (${diagnosticModel}, run=${runId}, prior attempts=${priorAttempts}). ${reason}`);
    if (runId) {
      await appendStep(runId, {
        at: new Date().toISOString(),
        step: `self_heal:tier_${diagnosticTier}_escalation:${attempt.id}`,
        status: "started",
        detail: { tier: diagnosticTier, model: diagnosticModel, priorAttempts, reason },
      });
    }
  }

  const { ADMIN_TENANT_ID } = await import("../auth");
  const llmRes = await runLlmTask({
    prompt: buildDiagnosticPrompt(originalGoal, failure, availableTools),
    schema: FIX_PLAN_SCHEMA,
    model: diagnosticModel,
    temperature: 0.2,
    thinking: diagnosticThinking,
    timeoutMs: diagnosticTimeout,
    maxTokens: diagnosticMaxTokens,
    // R64.C — self-heal is platform-level diagnosis; bill to admin.
    tenantId: ADMIN_TENANT_ID,
  });

  if (!llmRes.success || !llmRes.json) {
    await db.update(selfHealAttempts).set({
      outcome: "diagnosis_failed",
      outcomeDetail: { error: llmRes.error, validationErrors: llmRes.validationErrors } as any,
      completedAt: new Date(),
    }).where(eq(selfHealAttempts.id, attempt.id));
    if (runId) {
      await appendStep(runId, {
        at: new Date().toISOString(),
        step: `self_heal:diagnosis_failed:${attempt.id}`,
        status: "failed",
        detail: { error: llmRes.error },
      });
    }
    return { attemptId: attempt.id, healed: false, error: `Diagnosis failed: ${llmRes.error}`, shouldRetry: false };
  }

  const plan = llmRes.json as FixPlan;

  await db.update(selfHealAttempts).set({
    diagnosis: plan.diagnosis,
    fixType: plan.fixType,
    fixPayload: (plan.replan || plan.customTool || plan.escalation || {}) as any,
    fixSnippet: plan.codeSnippet?.code || null,
    reversible: plan.reversible !== false && !HIGH_RISK_FIX_TYPES.has(plan.fixType),
    outcome: "executing",
  }).where(eq(selfHealAttempts.id, attempt.id));

  const policyForcesApproval = HIGH_RISK_FIX_TYPES.has(plan.fixType);
  if ((!plan.reversible || policyForcesApproval) && plan.fixType !== "escalate" && plan.fixType !== "give_up") {
    if (!runId) {
      await db.update(selfHealAttempts).set({
        outcome: "blocked_no_run",
        outcomeDetail: { reason: "Irreversible fix proposed but no runId to attach approval to" } as any,
        completedAt: new Date(),
      }).where(eq(selfHealAttempts.id, attempt.id));
      return { attemptId: attempt.id, healed: false, fix: plan, error: "Irreversible fix proposed but no runId for approval", shouldRetry: false };
    }
    try {
      await createApproval({
        tenantId,
        runId,
        question: `[SELF-HEAL] Irreversible ${plan.fixType} proposed for failed run. Approve?`,
        context: { diagnosis: plan.diagnosis, plan, originalError: failure.error } as any,
        ttlHours: 48,
        requestedBy: "self-heal-supervisor",
      });
      await db.update(selfHealAttempts).set({
        outcome: "awaiting_approval",
      }).where(eq(selfHealAttempts.id, attempt.id));
      if (runId) {
        await appendStep(runId, {
          at: new Date().toISOString(),
          step: `self_heal:awaiting_approval:${attempt.id}`,
          status: "completed",
          detail: { fixType: plan.fixType, diagnosis: plan.diagnosis.slice(0, 200) },
        });
      }
      return { attemptId: attempt.id, healed: false, fix: plan, output: { escalated: true }, shouldRetry: false };
    } catch (err: any) {
      return { attemptId: attempt.id, healed: false, fix: plan, error: `Auto-escalation failed: ${err.message}`, shouldRetry: false };
    }
  }

  const exec = await executeFix(plan, { tenantId, runId });

  await db.update(selfHealAttempts).set({
    outcome: exec.ok ? "succeeded" : "failed",
    outcomeDetail: { output: exec.output, error: exec.error } as any,
    completedAt: new Date(),
  }).where(eq(selfHealAttempts.id, attempt.id));

  if (runId) {
    await appendStep(runId, {
      at: new Date().toISOString(),
      step: `self_heal:${exec.ok ? "succeeded" : "failed"}:${attempt.id}`,
      status: exec.ok ? "completed" : "failed",
      detail: { fixType: plan.fixType, diagnosis: plan.diagnosis.slice(0, 200), error: exec.error?.slice(0, 200) },
    });
  }

  return {
    attemptId: attempt.id,
    healed: exec.ok,
    fix: plan,
    output: exec.output,
    error: exec.error,
    shouldRetry: exec.ok && plan.fixType === "replan",
  };
}

export async function listSelfHealAttempts(tenantId: number, limit = 50, opts: { runId?: number; outcome?: string } = {}) {
  const conditions = [eq(selfHealAttempts.tenantId, tenantId)];
  if (opts.runId) conditions.push(eq(selfHealAttempts.runId, opts.runId));
  if (opts.outcome) conditions.push(eq(selfHealAttempts.outcome, opts.outcome));
  return db.select().from(selfHealAttempts)
    .where(and(...conditions))
    .orderBy(desc(selfHealAttempts.createdAt))
    .limit(limit);
}

export async function getSelfHealAttempt(attemptId: number, tenantId: number) {
  const [row] = await db.select().from(selfHealAttempts)
    .where(and(eq(selfHealAttempts.id, attemptId), eq(selfHealAttempts.tenantId, tenantId)))
    .limit(1);
  return row;
}

export async function markPromotedToPlatform(attemptId: number, tenantId: number) {
  const [row] = await db.update(selfHealAttempts)
    .set({ promotedToPlatform: true })
    .where(and(eq(selfHealAttempts.id, attemptId), eq(selfHealAttempts.tenantId, tenantId)))
    .returning();
  return row;
}

export async function tryWithSelfHeal<T>(params: {
  tenantId: number;
  runId?: number | null;
  goal: string;
  triggerSource?: string;
  fn: () => Promise<T>;
  maxHealAttempts?: number;
}): Promise<{ result?: T; healed: boolean; attempts: number; lastError?: string }> {
  const maxAttempts = Math.min(params.maxHealAttempts ?? MAX_HEALS_PER_RUN, MAX_HEALS_PER_RUN);
  let lastError = "";
  let lastErrorObj: any = null;
  let attempts = 0;

  for (let i = 0; i <= maxAttempts; i++) {
    try {
      const result = await params.fn();
      return { result, healed: i > 0, attempts };
    } catch (err: any) {
      lastError = err?.message || String(err);
      lastErrorObj = err;
      if (i === maxAttempts) break;
      attempts++;
      const heal = await attemptSelfHeal({
        tenantId: params.tenantId,
        runId: params.runId,
        triggerSource: params.triggerSource || "tryWithSelfHeal",
        originalGoal: params.goal,
        failure: {
          error: lastError,
          errorStack: lastErrorObj?.stack?.slice(0, 1000),
        },
      });
      if (!heal.shouldRetry) {
        return { healed: false, attempts, lastError: `${lastError} (self-heal: ${heal.error || "did not produce a retryable fix"})` };
      }
    }
  }
  return { healed: false, attempts, lastError };
}
