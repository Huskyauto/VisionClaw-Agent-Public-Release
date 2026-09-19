import { db } from "./db";
import { sql } from "drizzle-orm";
import { emitEvent } from "./event-bus";
import { validateHeartbeatRepairAction } from "./agentic/heartbeat-repair-contract";
import { validateSourceRepairAction } from "./source-repair-handoff";

const MINERVA_PERSONA_ID = 15;
const FELIX_PERSONA_ID = 2;
let executorKickOverride: ((planId: number) => void) | null = null;
export function setExecutorKickForTests(kick: ((planId: number) => void) | null): void {
  executorKickOverride = kick;
}

export interface PlanStep {
  n: number;
  agent: string;
  task: string;
  tools: string[];
  estimated_minutes: number;
  estimated_cost_usd: number;
  depends_on: number[];
  parallel_eligible: boolean;
  tool?: string;
  args?: Record<string, any>;
}

export interface PlanJson {
  objective: string;
  context: Record<string, any>;
  steps: PlanStep[];
  total_estimated_minutes: number;
  total_estimated_cost_usd: number;
  risks: string[];
  success_criteria: string[];
  unknowns: string[];
}

export interface CreatePlanArgs {
  objective: string;
  context?: Record<string, any>;
  source?: string;
  sourceRef?: string;
  tenantId?: number;
  parentPlanId?: number;
  revisionFeedback?: string;
  repairAction?: Record<string, any>;
}

const STALE_OPERATIONAL_PLAN_REASON =
  "Operational plan is stale and cannot execute real work. Revise it to generate a fresh executable plan before approval.";

export function validatePlanApprovalReadiness(
  source: unknown,
  planJson: unknown,
): { ok: true } | { ok: false; reason: string } {
  if (source !== "agentic-engine.auto-apply") return { ok: true };
  const repairAction = (planJson as any)?.repairAction;
  if (repairAction) {
    try {
      if (repairAction.kind === "source_repair_handoff") validateSourceRepairAction(repairAction);
      else validateHeartbeatRepairAction(repairAction);
    } catch {
      return { ok: false, reason: STALE_OPERATIONAL_PLAN_REASON };
    }
    const expectedTool = repairAction.kind === "source_repair_handoff" ? "source_repair_handoff" : "heartbeat_repair";
    if (!Array.isArray((planJson as any)?.steps) ||
        !(planJson as any).steps.some((step: any) => step?.tool === expectedTool)) {
      return { ok: false, reason: STALE_OPERATIONAL_PLAN_REASON };
    }
    return { ok: true };
  }
  const steps = (planJson as any)?.steps;
  // Generic delegate_task plans have no durable operational repair authority.
  if (!Array.isArray(steps) || steps.length === 0 || steps.some((step: any) => step?.tool === "delegate_task")) {
    return { ok: false, reason: STALE_OPERATIONAL_PLAN_REASON };
  }
  return { ok: false, reason: STALE_OPERATIONAL_PLAN_REASON };
}

const KNOWN_AGENTS = [
  { name: "Forge", role: "Staff Engineer", domain: "code, infrastructure, deployment, bug fixes" },
  { name: "Teagan", role: "Content Marketing Strategist", domain: "marketing strategy, campaign planning" },
  { name: "Scribe", role: "Content Creator", domain: "writing, blog posts, copy, scripts" },
  { name: "Proof", role: "Content Reviewer", domain: "QA, editing, review of any deliverable" },
  { name: "Radar", role: "Intelligence Analyst", domain: "surface market research, competitive intel" },
  { name: "Neptune", role: "Deep Research Specialist", domain: "deep research, video/media production" },
  { name: "Apollo", role: "Revenue & Pipeline Manager", domain: "sales, outreach, pipeline" },
  { name: "Atlas", role: "Metrics & Reporting Analyst", domain: "data analysis, dashboards, KPIs" },
  { name: "Cassandra", role: "CFO", domain: "finance, budgeting, P&L, tax" },
  { name: "Luna", role: "Legal & Compliance Officer", domain: "legal, contracts, compliance, security" },
  { name: "Chief of Staff", role: "Operations Director", domain: "operational coordination, scheduling" },
  { name: "Agent Blueprint", role: "Multi-Agent System Operator", domain: "multi-agent orchestration design" },
  { name: "VisionClaw", role: "General AI Assistant", domain: "fallback for general tasks" },
  { name: "Felix", role: "CEO", domain: "decision maker — approves/rejects plans, never executes" },
];

const KNOWN_TOOLS = [
  "web_search", "web_fetch", "create_pdf", "analyze_pdf", "generate_chart",
  "send_email", "google_drive", "google_sheets", "google_calendar",
  "elevenlabs_voice", "stripe_charge", "execute_code", "browser",
  "search_memory", "create_memory", "delegate_task", "sessions_spawn", "llm_task",
];

function pickAgentForTask(task: string): string {
  const lower = task.toLowerCase();
  if (/code|build|deploy|bug|fix|api|database|schema|infrastructure/.test(lower)) return "Forge";
  if (/research|investigate|competitor|market intel/.test(lower)) return "Radar";
  if (/deep research|video|youtube|long-form/.test(lower)) return "Neptune";
  if (/write|blog|copy|script|content|article/.test(lower)) return "Scribe";
  if (/marketing|campaign|strategy|positioning/.test(lower)) return "Teagan";
  if (/review|qa|edit|proofread/.test(lower)) return "Proof";
  if (/sales|outreach|lead|pipeline|prospect/.test(lower)) return "Apollo";
  if (/metric|dashboard|kpi|report|analytics/.test(lower)) return "Atlas";
  if (/finance|budget|p&l|tax|cost/.test(lower)) return "Cassandra";
  if (/legal|contract|compliance|security|privacy/.test(lower)) return "Luna";
  if (/operations|schedule|coordinate/.test(lower)) return "Chief of Staff";
  return "VisionClaw";
}

/**
 * Heuristic plan generator. v1 is rules-based so it costs $0 and is
 * deterministic. Future versions can wrap an LLM behind the same interface.
 */
export function composeHeuristicPlan(args: CreatePlanArgs): PlanJson {
  if (args.repairAction) {
    const action = args.repairAction;
    if ((action as any).kind === "source_repair_handoff") {
      validateSourceRepairAction(action);
      return {
        objective: args.objective, context: args.context ?? {},
        steps: [{ n: 1, agent: "Forge",
          task: "Send the approved source finding to the development workspace proposal queue. Do not edit or publish source in production.",
          tools: [], estimated_minutes: 2, estimated_cost_usd: 0,
          depends_on: [], parallel_eligible: false, tool: "source_repair_handoff" }],
        total_estimated_minutes: 2, total_estimated_cost_usd: 0,
        risks: ["Production cannot write source; workspace verifier and Bob publish remain authoritative."],
        success_criteria: ["Authenticated handoff accepted by the development workspace."],
        unknowns: [], ...( { repairAction: action } as any),
      };
    }
    const step: PlanStep = {
      n: 1, agent: "Forge",
      task: `Apply heartbeat task ${action.taskId}: ${JSON.stringify(action.expectedBefore)} → ${JSON.stringify(action.desiredAfter)}. Verify exact before/after state.`,
      tools: [], estimated_minutes: 2, estimated_cost_usd: 0,
      depends_on: [], parallel_eligible: false, tool: "heartbeat_repair",
    };
    return {
      objective: args.objective, context: args.context ?? {}, steps: [step],
      total_estimated_minutes: 2, total_estimated_cost_usd: 0,
      risks: ["Only the immutable enabled/cron fields in the approved action may change."],
      success_criteria: ["Exact desired heartbeat state is verified transactionally."],
      unknowns: [],
      ...( { repairAction: action } as any),
    };
  }
  const obj = args.objective.toLowerCase();
  const steps: PlanStep[] = [];

  // Step 1 — always research/scope first
  steps.push({
    n: 1,
    agent: "Radar",
    task: `Surface-scan the request: "${args.objective}". Identify constraints, prior art, and unknowns.`,
    tools: ["web_search", "search_memory"],
    estimated_minutes: 15,
    estimated_cost_usd: 0.05,
    depends_on: [],
    parallel_eligible: false,
  });

  // Step 2 — branch by domain
  if (/app|tool|software|website|saas|build|product/.test(obj)) {
    steps.push({
      n: 2,
      agent: "Forge",
      task: `Scaffold the deliverable per scope from step 1.`,
      tools: ["execute_code", "browser"],
      estimated_minutes: 60,
      estimated_cost_usd: 0.40,
      depends_on: [1],
      parallel_eligible: false,
    });
    steps.push({
      n: 3,
      agent: "Proof",
      task: `Verify the scaffolded deliverable loads, behaves correctly, and meets success criteria.`,
      tools: ["browser"],
      estimated_minutes: 20,
      estimated_cost_usd: 0.10,
      depends_on: [2],
      parallel_eligible: false,
    });
  } else if (/report|pdf|document|whitepaper|analysis/.test(obj)) {
    steps.push({
      n: 2,
      agent: "Neptune",
      task: `Produce deep research material per scope from step 1.`,
      tools: ["web_search", "web_fetch", "search_knowledge"],
      estimated_minutes: 45,
      estimated_cost_usd: 0.50,
      depends_on: [1],
      parallel_eligible: false,
    });
    steps.push({
      n: 3,
      agent: "Scribe",
      task: `Write the deliverable document from research material.`,
      tools: ["create_pdf"],
      estimated_minutes: 30,
      estimated_cost_usd: 0.25,
      depends_on: [2],
      parallel_eligible: false,
    });
    steps.push({
      n: 4,
      agent: "Proof",
      task: `Review document for accuracy, tone, and formatting.`,
      tools: [],
      estimated_minutes: 15,
      estimated_cost_usd: 0.08,
      depends_on: [3],
      parallel_eligible: false,
    });
  } else if (/sales|outreach|leads|customers/.test(obj)) {
    steps.push({
      n: 2,
      agent: "Apollo",
      task: `Build prospect list and outreach sequence per scope from step 1.`,
      tools: ["web_search", "send_email"],
      estimated_minutes: 30,
      estimated_cost_usd: 0.20,
      depends_on: [1],
      parallel_eligible: false,
    });
    steps.push({
      n: 3,
      agent: "Atlas",
      task: `Set up tracking dashboard for outreach response and conversion.`,
      tools: ["generate_chart"],
      estimated_minutes: 20,
      estimated_cost_usd: 0.05,
      depends_on: [2],
      parallel_eligible: true,
    });
  } else {
    // Generic fallback — let the agent picked by topic do the main work
    const agent = pickAgentForTask(args.objective);
    steps.push({
      n: 2,
      agent,
      task: `Execute the request: "${args.objective}".`,
      tools: ["web_search", "search_memory"],
      estimated_minutes: 30,
      estimated_cost_usd: 0.15,
      depends_on: [1],
      parallel_eligible: false,
    });
    steps.push({
      n: 3,
      agent: "Proof",
      task: `Review the deliverable before sending.`,
      tools: [],
      estimated_minutes: 10,
      estimated_cost_usd: 0.05,
      depends_on: [2],
      parallel_eligible: false,
    });
  }

  // Final step — always deliver
  const lastN = steps[steps.length - 1].n;
  steps.push({
    n: lastN + 1,
    agent: "Chief of Staff",
    task: `Deliver final artifact to the requester (email + Drive upload). Emit delivery.completed event.`,
    tools: ["send_email", "google_drive"],
    estimated_minutes: 5,
    estimated_cost_usd: 0.02,
    depends_on: [lastN],
    parallel_eligible: false,
  });

  if (args.source === "agentic-engine.auto-apply") {
    const implementationStep = steps.find(step =>
      step.agent !== "Radar" && step.agent !== "Proof" && step.agent !== "Chief of Staff"
    );
    if (implementationStep) {
      implementationStep.agent = "Forge";
      implementationStep.task = `Implement the approved operational change in the live project: "${args.objective}". Inspect the current implementation first, make the smallest safe change, and run relevant deterministic verification.`;
    }
    const deliveryStep = steps.find(step => step.agent === "Chief of Staff");
    if (deliveryStep) {
      deliveryStep.task = "Summarize the concrete changes and verification evidence from prior steps. Do not claim completion without evidence.";
    }
    for (const step of steps) {
      const boundedTask = step.task.slice(0, 700);
      step.tool = "delegate_task";
      step.args = {
        targetAgent: step.agent,
        taskName: `Approved operational plan — step ${step.n}`,
        description: boundedTask,
        prompt: [
          boundedTask,
          "",
          "Perform this approved operational work with your available tools; do not merely describe it.",
          "Use this bounded prior-step evidence when present:",
          "{{prev}}",
          "",
          "Return concrete action and check evidence. Name any missing prerequisite before claiming success.",
        ].join("\n"),
        schedule: "once",
      };
    }
  }

  const totalMin = steps.reduce((a, s) => a + s.estimated_minutes, 0);
  const totalCost = steps.reduce((a, s) => a + s.estimated_cost_usd, 0);

  return {
    objective: args.objective,
    context: args.context ?? {},
    steps,
    total_estimated_minutes: totalMin,
    total_estimated_cost_usd: Math.round(totalCost * 100) / 100,
    risks: [
      "Scope may be ambiguous — Radar's step-1 scan may surface required clarifications",
      "Cost estimates assume default LLM tiers; complex deliverables can run 2-3x",
      "External dependencies (3rd-party APIs) can add latency or fail",
    ],
    success_criteria: [
      "Deliverable matches the stated objective",
      "Customer / requester can access the artifact (email + Drive link work)",
      "Total cost stays within estimate ±25%",
    ],
    unknowns: args.revisionFeedback
      ? [`Felix requested revision: ${args.revisionFeedback}`]
      : ["Customer-specific requirements may need clarification during step 1"],
  };
}

export async function createPlan(args: CreatePlanArgs): Promise<{ planId: number; plan: PlanJson; created: boolean }> {
  // Tenant-isolation audit 2026-07-31: fail CLOSED on a missing tenant instead
  // of silently defaulting to the admin tenant (1) — every caller (route,
  // tool handler, agentic-engines) already supplies a validated tenantId.
  if (args.tenantId == null || !Number.isFinite(Number(args.tenantId)) || Number(args.tenantId) <= 0) {
    throw new Error("createPlan requires a valid tenantId (no admin-tenant default)");
  }
  const tenantId = Number(args.tenantId);
  if (args.parentPlanId != null) {
    const parent: any = await db.execute(sql`
      SELECT id FROM plans
      WHERE id = ${args.parentPlanId} AND tenant_id = ${tenantId}
      LIMIT 1
    `);
    if (!((parent.rows ?? parent)[0]?.id)) {
      throw new Error("Parent plan not found for tenant");
    }
  }
  const plan = composeHeuristicPlan(args);

  // Round 25 / 26 — snapshot what Minerva saw in the capability registry
  // at planning time. Audit trail for "did the planner know about agent
  // X when this plan was made?" months later.
  //
  // Round 26 hardenings:
  //   (a) bound the snapshot — names array is capped at SNAPSHOT_NAME_CAP
  //       per kind, plus a sha256 hash so audit comparisons stay cheap
  //       even when the roster grows past the cap.
  //   (b) phantom-agent fallback is now REAL: step.agent is rewritten
  //       to "VisionClaw" and the original is preserved in
  //       step.original_agent. The warning text matches the actual
  //       behavior, so logs don't lie.
  try {
    const { getMinervaRoster } = await import("./capability-registry");
    const roster = await getMinervaRoster();
    const SNAPSHOT_NAME_CAP = 30;
    const crypto = await import("crypto");
    const agentNames = roster.agents.map((a) => a.name);
    const toolNames = roster.tools.map((t) => t.name);
    const sha = (arr: string[]) =>
      crypto.createHash("sha256").update(arr.join("|")).digest("hex").slice(0, 16);
    (plan as any).roster_snapshot = {
      seen_at: new Date().toISOString(),
      agent_count: agentNames.length,
      tool_count: toolNames.length,
      integration_count: roster.integrations.length,
      agents: agentNames.slice(0, SNAPSHOT_NAME_CAP),
      tools: toolNames.slice(0, SNAPSHOT_NAME_CAP),
      agents_sha: sha(agentNames),
      tools_sha: sha(toolNames),
      truncated_agents: agentNames.length > SNAPSHOT_NAME_CAP,
      truncated_tools: toolNames.length > SNAPSHOT_NAME_CAP,
    };
    // Validate every step's assigned agent exists in the registry. If
    // not, REWRITE the step to fall back to VisionClaw and preserve the
    // original name for audit. Previously the warning text claimed
    // fallback but no rewrite happened, so the executor would fail
    // looking up the phantom persona.
    const knownAgentNames = new Set(agentNames);
    for (const step of plan.steps) {
      if (!knownAgentNames.has(step.agent)) {
        const original = step.agent;
        (step as any).original_agent = original;
        (step as any).warning = `agent '${original}' not in capability registry — rewrote to VisionClaw fallback`;
        step.agent = "VisionClaw";
        if ((step as any).args?.targetAgent === original) {
          (step as any).args.targetAgent = "VisionClaw";
        }
      }
    }
  } catch (e: any) {
    // Registry is optional; if it fails the plan is still valid.
    (plan as any).roster_snapshot = { error: e.message };
  }

  const source = args.source ?? "owner.directive";
  const sourceRef = args.sourceRef ?? null;
  const isAutoApply = source === "agentic-engine.auto-apply" && sourceRef !== null;
  const r: any = isAutoApply
    ? await db.execute(sql`
        INSERT INTO plans (tenant_id, objective, source, source_ref, status, plan_json,
                           planner_persona_id, version, parent_plan_id)
        VALUES (${tenantId}, ${args.objective}, ${source}, ${sourceRef},
                'awaiting_approval', ${JSON.stringify(plan)}::jsonb,
                ${MINERVA_PERSONA_ID}, ${args.parentPlanId ? 2 : 1}, ${args.parentPlanId ?? null})
        ON CONFLICT (tenant_id, source, source_ref)
          WHERE source = 'agentic-engine.auto-apply' AND source_ref IS NOT NULL
        DO NOTHING
        RETURNING id
      `)
    : await db.execute(sql`
        INSERT INTO plans (tenant_id, objective, source, source_ref, status, plan_json,
                           planner_persona_id, version, parent_plan_id)
        VALUES (${tenantId}, ${args.objective}, ${source}, ${sourceRef},
                'awaiting_approval', ${JSON.stringify(plan)}::jsonb,
                ${MINERVA_PERSONA_ID}, ${args.parentPlanId ? 2 : 1}, ${args.parentPlanId ?? null})
        RETURNING id
      `);
  const inserted = (r.rows ?? r)[0];
  let planId = inserted?.id ? Number(inserted.id) : 0;
  const created = planId > 0;
  if (!created && isAutoApply) {
    const existing: any = await db.execute(sql`
      SELECT id FROM plans
      WHERE tenant_id = ${tenantId}
        AND source = ${source}
        AND source_ref = ${sourceRef}
      LIMIT 1
    `);
    planId = Number((existing.rows ?? existing)[0]?.id);
  }
  if (!planId) throw new Error("Minerva plan insert did not return or resolve a plan id");

  // Wake Felix via the attention bus.
  if (created) {
    await emitEvent({
      type: "plan.proposed",
      source: "minerva-planner",
      tenantId,
      data: {
        planId,
        objective: args.objective,
        stepCount: plan.steps.length,
        totalMinutes: plan.total_estimated_minutes,
        totalCostUsd: plan.total_estimated_cost_usd,
        revisionOf: args.parentPlanId ?? null,
      },
    });
  }

  return { planId, plan, created };
}

/**
 * Decide a plan. Felix-level only. Uses a compare-and-swap UPDATE so
 * concurrent decisions on the same plan can't both win — the second
 * caller will see "already decided" and bail. Audit captures the actor
 * id passed by the route layer (an opaque session-derived string) in
 * addition to the persona attribution.
 *
 * In this single-admin tenant the decider IS Felix; the `actor` field
 * is for future multi-admin audit and prevents silently impersonating
 * Felix in the persona attribution column.
 */
export async function decidePlan(args: {
  planId: number;
  decision: "approve" | "reject" | "revise";
  reason: string;
  actor: string; // opaque audit id from the route (e.g. session digest)
  /** Required tenant scope for every plan read and mutation. */
  tenantId: number;
}): Promise<{ ok: true; status: string; revisedPlanId?: number }> {
  if (!args.actor || args.actor.length < 4) {
    throw new Error("decidePlan requires an actor audit id");
  }
  if (!Number.isInteger(args.tenantId) || args.tenantId <= 0) {
    throw new Error("decidePlan requires a positive tenantId");
  }
  const decidedBy = FELIX_PERSONA_ID;
  const auditedReason = `[actor=${args.actor}] ${args.reason}`;
  const newStatus =
    args.decision === "approve" ? "approved" :
    args.decision === "reject" ? "rejected" :
    "revising";
  const decisionTag =
    args.decision === "approve" ? "approved" :
    args.decision === "reject" ? "rejected" :
    "revise";

  let approvalBinding: any = null;
  if (args.decision === "approve") {
    const readinessProbe: any = await db.execute(sql`
      SELECT source, plan_json
      FROM plans
      WHERE id = ${args.planId} AND tenant_id = ${args.tenantId}
        AND status = 'awaiting_approval'
      LIMIT 1
    `);
    const candidate = (readinessProbe.rows ?? readinessProbe)[0];
    if (candidate) {
      const readiness = validatePlanApprovalReadiness(candidate.source, candidate.plan_json);
      if (!readiness.ok) throw new Error(readiness.reason);
      if (candidate.plan_json?.repairAction) {
        const { validateHeartbeatRepairAction, hashRepairAction } = await import("./agentic/heartbeat-repair-contract");
        const isSource = candidate.plan_json.repairAction.kind === "source_repair_handoff";
        const action = isSource ? validateSourceRepairAction(candidate.plan_json.repairAction) : validateHeartbeatRepairAction(candidate.plan_json.repairAction);
        approvalBinding = {
          type: "repair.approval_binding",
          at: new Date().toISOString(),
          stepId: 1,
          version: action.version,
          kind: action.kind as string,
          actionHash: isSource
            ? JSON.stringify(action)
            : hashRepairAction({
              version: action.version, kind: (action as any).kind as "heartbeat_task", taskId: (action as any).taskId,
              expectedBefore: (action as any).expectedBefore, desiredAfter: (action as any).desiredAfter,
              verifier: (action as any).verifier,
            }),
          actor: args.actor,
        };
      }
    }
  }

  // CAS: only flip from awaiting_approval. Returns the row if and only
  // if the swap actually happened, so two concurrent decisions cannot
  // both succeed.
  const swap: any = await db.execute(sql`
    UPDATE plans
    SET status = ${newStatus},
        ceo_decision = ${decisionTag},
        ceo_decision_reason = ${auditedReason},
        ceo_decided_at = CURRENT_TIMESTAMP,
        ceo_decided_by_persona_id = ${decidedBy},
        updated_at = CURRENT_TIMESTAMP,
        execution_log = CASE
          WHEN ${approvalBinding ? true : false}
          THEN COALESCE(execution_log, '[]'::jsonb) || ${JSON.stringify(approvalBinding ? [approvalBinding] : [])}::jsonb
          ELSE execution_log
        END
    WHERE id = ${args.planId} AND status = 'awaiting_approval'
      AND tenant_id = ${args.tenantId}
    RETURNING id, tenant_id, objective, plan_json
  `);
  const row = (swap.rows ?? swap)[0];
  if (!row) {
    // CAS missed: plan is no longer awaiting_approval. R74.3 — treat a
    // retried-decision matching the existing terminal state as success
    // so phone/network retries don't surface "Decision failed" toasts
    // when the first POST already landed. Idempotency lives at the API
    // layer; the row is the source of truth.
    const probe: any = await db.execute(sql`SELECT status, ceo_decision FROM plans WHERE id = ${args.planId} AND tenant_id = ${args.tenantId}`);
    const probeRow = (probe.rows ?? probe)[0];
    if (!probeRow) throw new Error(`Plan ${args.planId} not found`);
    const currentStatus = String(probeRow.status);
    if (
      (args.decision === "approve" && (currentStatus === "approved" || currentStatus === "executing" || currentStatus === "completed" || currentStatus === "failed")) ||
      (args.decision === "reject" && currentStatus === "rejected")
    ) {
      return { ok: true, status: currentStatus };
    }
    // R74.3-followup — Revise idempotency tightened. `revising` is an
    // INTERMEDIATE state: the child revision plan may not exist yet (still
    // in flight) or may have been rolled back on createPlan failure.
    // Returning {ok:true} on bare `revising` would lie to the caller in
    // both cases. Only treat retry as success when a child plan with
    // parent_plan_id = planId actually exists.
    if (args.decision === "revise" && currentStatus === "revising") {
      const child: any = await db.execute(sql`
        SELECT id FROM plans WHERE parent_plan_id = ${args.planId} AND tenant_id = ${args.tenantId} ORDER BY id DESC LIMIT 1
      `);
      const childRow = (child.rows ?? child)[0];
      if (childRow) {
        return { ok: true, status: currentStatus, revisedPlanId: Number(childRow.id) };
      }
      throw new Error(`Plan ${args.planId} revise is still in progress — please wait a moment and retry.`);
    }
    throw new Error(`Plan ${args.planId} is in status '${currentStatus}', not awaiting_approval (concurrent decision?)`);
  }

  // R74.3 — Decision is durable from this point. Post-decision side effects
  // (event emit, executor kick, child-plan creation) MUST NOT cause the API
  // to fail; the row is committed and the user sees the correct UX. The
  // boot-time resumeStuckPlans + the periodic sweep will pick up an approved
  // plan whose executor kick was missed.
  const safeEmit = (payload: Parameters<typeof emitEvent>[0]) =>
    emitEvent(payload).catch((err) =>
      console.error(`[minerva-planner] emit ${payload.type} failed for plan #${args.planId}:`, err?.message || err)
    );

  if (args.decision === "approve") {
    void safeEmit({
      type: "plan.approved",
      source: "felix-decision",
      tenantId: row.tenant_id,
      data: { planId: args.planId, objective: row.objective, reason: args.reason, actor: args.actor },
    });
    // Round 26 — close the planner→approve→execute loop. Fire the
    // executor in the background. The executor uses CAS internally so
    // this is safe even if a boot-recovery scan races us.
    if (executorKickOverride) {
      executorKickOverride(args.planId);
    } else setImmediate(() => {
      import("./plan-executor")
        .then(({ executePlan }) => executePlan(args.planId))
        .catch((err) => console.error(`[minerva-planner] executor kick failed for plan #${args.planId}:`, err?.message || err));
    });
    return { ok: true, status: "approved" };
  }

  if (args.decision === "reject") {
    void safeEmit({
      type: "plan.rejected",
      source: "felix-decision",
      tenantId: row.tenant_id,
      data: { planId: args.planId, objective: row.objective, reason: args.reason, actor: args.actor },
    });
    return { ok: true, status: "rejected" };
  }

  // revise: original is now in 'revising' status (per CAS above); spawn
  // child plan. createPlan failure is a real user-visible failure (the
  // user expects to see the revised plan), so we DO surface it — but
  // first roll the original back to awaiting_approval so the user can
  // retry without the plan being stuck.
  let revised: { planId: number };
  try {
    revised = await createPlan({
      objective: row.objective,
      context: row.plan_json?.context ?? {},
      tenantId: row.tenant_id,
      parentPlanId: args.planId,
      revisionFeedback: args.reason,
    });
  } catch (err: any) {
    // R74.3 — Roll back ALL decision metadata, not just status. Leaving
    // ceo_decision/ceo_decided_at populated while status is back to
    // awaiting_approval would leave the row in a self-contradictory state
    // (audit says "decided" but workflow says "pending decision").
    try {
      await db.execute(sql`
        UPDATE plans
        SET status = 'awaiting_approval',
            ceo_decision = NULL,
            ceo_decision_reason = NULL,
            ceo_decided_at = NULL,
            ceo_decided_by_persona_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${args.planId} AND status = 'revising'
          AND tenant_id = ${args.tenantId}
      `);
    } catch (rollbackErr: any) {
      throw new Error(
        `Revise failed and rollback is uncertain: ${err?.message || err}; rollback error: ${rollbackErr?.message || rollbackErr}`,
      );
    }
    throw new Error(`Revise failed (rolled back to awaiting_approval): ${err?.message || err}`);
  }
  void safeEmit({
    type: "plan.revised",
    source: "minerva-planner",
    tenantId: row.tenant_id,
    data: { originalPlanId: args.planId, revisedPlanId: revised.planId, reason: args.reason, actor: args.actor },
  });
  return { ok: true, status: "revising", revisedPlanId: revised.planId };
}

// Plans sitting in awaiting_approval longer than this are auto-expired the
// next time the queue is listed. Minerva proposes continuously; without an
// expiry the decision queue grows forever and 2-month-old plans (whose cost
// estimates, metrics, and context are stale) sit in front of Felix. Expired
// plans are NOT decidable (decide CAS requires status='awaiting_approval')
// and Minerva can always re-propose a fresh plan if the objective still matters.
const PLAN_APPROVAL_TTL_DAYS = 14;

async function expireStalePlans(tenantId: number): Promise<number> {
  try {
    const r: any = await db.execute(sql`
      UPDATE plans SET status = 'expired', updated_at = now()
      WHERE tenant_id = ${tenantId} AND status = 'awaiting_approval'
        AND created_at < now() - make_interval(days => ${PLAN_APPROVAL_TTL_DAYS})
    `);
    return r.rowCount ?? 0;
  } catch (e: any) {
    // Fail open — listing the queue must never break because expiry failed.
    console.warn(`[minerva-planner] stale-plan expiry failed (non-fatal): ${e?.message}`);
    return 0;
  }
}

export async function listPlans(args: { tenantId: number; status?: string; activity?: boolean; limit?: number }) {
  if (!Number.isInteger(args.tenantId) || args.tenantId <= 0) {
    throw new Error("listPlans requires a positive tenantId");
  }
  const tenantId = args.tenantId;
  const limit = args.limit ?? 20;
  // Lazy expiry: sweep stale awaiting_approval plans whenever the queue
  // (or the full list) is read, so the UI never shows months-old approvals.
  if (!args.status || args.status === "awaiting_approval") {
    await expireStalePlans(tenantId);
  }
  const r: any = args.activity
    ? await db.execute(sql`
        SELECT id, tenant_id, objective, source, status, plan_json,
                source_ref, execution_log,
               ceo_decision, ceo_decision_reason, ceo_decided_at,
               version, parent_plan_id, created_at, updated_at
        FROM plans
        WHERE tenant_id = ${tenantId}
           AND status IN ('approved', 'executing', 'completed', 'failed', 'handoff_pending', 'publish_required')
         ORDER BY
            CASE WHEN status IN ('approved', 'executing', 'failed', 'handoff_pending', 'publish_required') THEN 0 ELSE 1 END,
           updated_at DESC LIMIT ${limit}
      `)
    : args.status
    ? await db.execute(sql`
        SELECT id, tenant_id, objective, source, status, plan_json,
               ceo_decision, ceo_decision_reason, ceo_decided_at,
               version, parent_plan_id, created_at, updated_at
        FROM plans WHERE tenant_id = ${tenantId} AND status = ${args.status}
        ORDER BY id DESC LIMIT ${limit}
      `)
    : await db.execute(sql`
        SELECT id, tenant_id, objective, source, status, plan_json,
               ceo_decision, ceo_decision_reason, ceo_decided_at,
               version, parent_plan_id, created_at, updated_at
        FROM plans WHERE tenant_id = ${tenantId}
        ORDER BY id DESC LIMIT ${limit}
      `);
  return (r.rows ?? r).map((row: any) => ({ ...row, ...derivePlanLifecycle(row) }));
}

/**
 * The activity feed is deliberately a projection, rather than a second state
 * machine.  Keep this pure so API and focused lifecycle tests use the same
 * deterministic interpretation of durable plan evidence.
 */
export function derivePlanLifecycle(row: {
  status?: string;
  execution_log?: unknown;
  ceo_decision?: string | null;
}): {
  lifecycle: "awaiting_approval" | "approved" | "executing" | "blocked" | "handoff_pending" | "publish_required" | "verified" | "archived";
  blockerReason: string | null;
  nextAction: string;
  verified: boolean;
  latestEvent: string | null;
  publish_required: boolean;
  actionable: boolean;
} {
  const events = Array.isArray(row.execution_log) ? row.execution_log : [];
  const latest = events.length ? events[events.length - 1] : null;
  const latestEvent = typeof latest?.type === "string" ? latest.type : null;
  const suppressed = events.some((event: any) =>
    event?.type === "plan.dedup_suppressed" ||
    event?.type === "proposal.dedup_suppressed" ||
    event?.dedupSuppressed === true,
  );
  const blockerEvent = [...events].reverse().find((event: any) =>
    event?.type === "execution.recovery_blocked" ||
    event?.type === "execution.failed" ||
    event?.type === "verification.failed" ||
    event?.type === "plan.verification_failed" ||
    event?.blocked === true,
  ) as any;
  const blockerReason = blockerEvent
    ? String(blockerEvent.reason ?? blockerEvent.failedReason ?? blockerEvent.error ?? blockerEvent.message ?? "Manual review required.")
    : null;
  const completedEvidence = row.status === "completed" && events.some((event: any) =>
    (event?.type === "execution.completed" || event?.type === "plan.completed") &&
    (event?.verified === true || event?.okSteps === event?.totalSteps),
  );
  let lifecycle: "awaiting_approval" | "approved" | "executing" | "blocked" | "handoff_pending" | "publish_required" | "verified" | "archived";
  if (suppressed) lifecycle = "archived";
  else if (row.status === "awaiting_approval") lifecycle = "awaiting_approval";
  else if (row.status === "approved") lifecycle = "approved";
  else if (row.status === "executing") lifecycle = "executing";
  else if (row.status === "handoff_pending") lifecycle = "handoff_pending";
  else if (blockerEvent) lifecycle = "blocked";
  else if (row.status === "publish_required") lifecycle = "publish_required";
  else if (completedEvidence) lifecycle = "verified";
  else if (row.status === "failed") lifecycle = "blocked";
  else if (row.status === "completed") lifecycle = "blocked";
  else lifecycle = "archived";
  const verified = lifecycle === "verified";
  const nextAction = lifecycle === "awaiting_approval" ? "Review and approve when ready"
    : lifecycle === "approved" ? "Execution is queued"
    : lifecycle === "executing" ? "Execution is in progress"
    : lifecycle === "handoff_pending" ? "Verification, review, and apply must finish before workspace handoff can proceed"
    : lifecycle === "blocked" ? "Review the blocker and resolve it"
    : lifecycle === "publish_required" ? "Review and publish when ready"
    : lifecycle === "verified" ? "No action required"
    : "No action required";
  return {
    lifecycle,
    blockerReason: lifecycle === "blocked" ? blockerReason : null,
    nextAction,
    verified,
    latestEvent,
    publish_required: row.status === "publish_required",
    actionable: lifecycle !== "archived" && lifecycle !== "handoff_pending",
  };
}

export async function getPlan(planId: number, tenantId: number) {
  const r: any = await db.execute(sql`
    SELECT * FROM plans WHERE id = ${planId} AND tenant_id = ${tenantId}
  `);
  return (r.rows ?? r)[0] ?? null;
}

export const MINERVA = {
  personaId: MINERVA_PERSONA_ID,
  knownAgents: KNOWN_AGENTS,
  knownTools: KNOWN_TOOLS,
};
