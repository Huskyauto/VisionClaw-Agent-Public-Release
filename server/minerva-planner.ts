import { db } from "./db";
import { sql } from "drizzle-orm";
import { emitEvent } from "./event-bus";

const MINERVA_PERSONA_ID = 15;
const FELIX_PERSONA_ID = 2;

export interface PlanStep {
  n: number;
  agent: string;
  task: string;
  tools: string[];
  estimated_minutes: number;
  estimated_cost_usd: number;
  depends_on: number[];
  parallel_eligible: boolean;
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
function composeHeuristicPlan(args: CreatePlanArgs): PlanJson {
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

export async function createPlan(args: CreatePlanArgs): Promise<{ planId: number; plan: PlanJson }> {
  const tenantId = args.tenantId ?? 1;
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
      }
    }
  } catch (e: any) {
    // Registry is optional; if it fails the plan is still valid.
    (plan as any).roster_snapshot = { error: e.message };
  }

  const r: any = await db.execute(sql`
    INSERT INTO plans (tenant_id, objective, source, source_ref, status, plan_json,
                       planner_persona_id, version, parent_plan_id)
    VALUES (${tenantId}, ${args.objective}, ${args.source ?? "owner.directive"},
            ${args.sourceRef ?? null}, 'awaiting_approval', ${JSON.stringify(plan)}::jsonb,
            ${MINERVA_PERSONA_ID}, ${args.parentPlanId ? 2 : 1}, ${args.parentPlanId ?? null})
    RETURNING id
  `);
  const planId = (r.rows ?? r)[0].id;

  // Wake Felix via the attention bus.
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

  return { planId, plan };
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
}): Promise<{ ok: true; status: string; revisedPlanId?: number }> {
  if (!args.actor || args.actor.length < 4) {
    throw new Error("decidePlan requires an actor audit id");
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
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${args.planId} AND status = 'awaiting_approval'
    RETURNING id, tenant_id, objective, plan_json
  `);
  const row = (swap.rows ?? swap)[0];
  if (!row) {
    // CAS missed: plan is no longer awaiting_approval. R74.3 — treat a
    // retried-decision matching the existing terminal state as success
    // so phone/network retries don't surface "Decision failed" toasts
    // when the first POST already landed. Idempotency lives at the API
    // layer; the row is the source of truth.
    const probe: any = await db.execute(sql`SELECT status, ceo_decision FROM plans WHERE id = ${args.planId}`);
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
        SELECT id FROM plans WHERE parent_plan_id = ${args.planId} ORDER BY id DESC LIMIT 1
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
    setImmediate(() => {
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
    await db.execute(sql`
      UPDATE plans
      SET status = 'awaiting_approval',
          ceo_decision = NULL,
          ceo_decision_reason = NULL,
          ceo_decided_at = NULL,
          ceo_decided_by_persona_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${args.planId} AND status = 'revising'
    `).catch(() => {});
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

export async function listPlans(args: { tenantId?: number; status?: string; limit?: number }) {
  const tenantId = args.tenantId ?? 1;
  const limit = args.limit ?? 20;
  const r: any = args.status
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
  return r.rows ?? r;
}

export async function getPlan(planId: number, tenantId?: number) {
  // Tenant scoping to prevent cross-tenant plan read (IDOR).
  // When tenantId is omitted, this function is assumed to be called from a trusted
  // server-internal context (e.g. decidePlan/revise flow which already scopes by CAS on status).
  // All external/tool-facing callers MUST pass tenantId.
  const r: any = tenantId !== undefined
    ? await db.execute(sql`SELECT * FROM plans WHERE id = ${planId} AND tenant_id = ${tenantId}`)
    : await db.execute(sql`SELECT * FROM plans WHERE id = ${planId}`);
  return (r.rows ?? r)[0] ?? null;
}

export const MINERVA = {
  personaId: MINERVA_PERSONA_ID,
  knownAgents: KNOWN_AGENTS,
  knownTools: KNOWN_TOOLS,
};
