import { db } from "./db";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { getModelForTierAsync, getClientForModel, getAvailableModels } from "./providers";
import { executeWithFailover } from "./model-failover";
import { createHeartbeatRepairAction, validateHeartbeatRepairAction } from "./agentic/heartbeat-repair-contract";
import { parseStrictCron } from "./cron-utils";
import { createPlan } from "./minerva-planner";
import { logSilentCatch } from "./lib/silent-catch";

const ENGINE_TYPES = {
  DECISION: "decision",
  PREDICTION: "prediction",
  OPTIMIZATION: "optimization",
} as const;

// R63: Auto-apply policy. Internal/operational categories are auto-applied at insertion
// time (status='applied' with action_taken="Auto-applied: ..."). Strategic/external
// categories (marketing, growth, market signals) stay status='new' so a human can decide.
// The user explicitly asked the system to apply low-risk insights without manual review.
const AUTO_APPLY_CATEGORIES = new Set([
  "agent_optimization",
  "cost_reduction",
  "resource_allocation",
  "resource_optimization",
  "scheduling_optimization",
  "workflow_automation",
  "email_optimization",
  "social_optimization",
]);

const AUTO_APPLY_REASON =
  "Auto-applied: operational category — recorded as actioned in the agentic backlog. No external action taken; re-open if you want a Minerva plan for this.";

// R63 hardening — durability marker. HIGH-priority auto-applied insights are
// stamped with this prefix until Minerva routing succeeds. The periodic sweep
// retries any insight whose action_taken still starts with this marker, so a
// transient failure during plan creation cannot leave an insight permanently
// "applied but no plan drafted."
const PENDING_PLAN_MARKER = "Auto-applied: pending Minerva plan";
const PLAN_DRAFTED_PREFIX = "Auto-applied + drafted Minerva plan #";
const DEFERRED_NO_DURABLE_REPAIR_PATH = "Deferred: no durable repair path.";

export type RepairMode = "advisory" | "runtime_config" | "source_proposal" | "unsupported";

/** Fail-closed parser for model classification. Model fields never become
 * tenant, path, diff, or action authority. */
export function parseRepairMode(value: unknown): RepairMode {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unsupported";
  const mode = (value as Record<string, unknown>).repair_mode;
  return mode === "advisory" || mode === "runtime_config" || mode === "source_proposal"
    ? mode : "unsupported";
}

export function sourceRepairActionFromFinding(finding: {
  id: number; evidenceVersion: string; evidenceHash: string;
}): { version: 1; kind: "source_repair_handoff"; findingId: string; evidenceVersion: string; evidenceHash: string } | null {
  if (!Number.isInteger(finding.id) || finding.id <= 0 ||
      !/^[a-f0-9]{32,128}$/i.test(finding.evidenceHash) ||
      !finding.evidenceVersion || finding.evidenceVersion.length > 200) return null;
  return { version: 1, kind: "source_repair_handoff", findingId: String(finding.id),
    evidenceVersion: finding.evidenceVersion.slice(0, 200), evidenceHash: finding.evidenceHash };
}

export type SourceRepairCandidate = {
  evidenceVersion: string;
  evidenceHash: string;
};

const ROUTE_SOURCE = "agentic-engine.auto-apply";
const FELIX_PERSONA_ID = 2;
const REJECTED_PLAN_DEDUP_DAYS = 14;
const REJECTED_PLAN_SIMILARITY_THRESHOLD = 0.55;
const REJECTED_PLAN_STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "over", "under",
  "your", "our", "their", "are", "was", "were", "have", "has", "had", "but",
  "not", "all", "any", "each", "when", "where", "what", "which", "while",
  "between", "creating", "causing", "using", "through", "before", "after",
]);

function operationalPlanTokens(value: string): Set<string> {
  const words = value.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  return new Set(words
    .filter((word) => !REJECTED_PLAN_STOP_WORDS.has(word))
    .map((word) => word.replace(/(ing|ed|es|s)$/, ""))
    .filter((word) => word.length >= 3));
}

export function operationalPlanSimilarity(left: string, right: string): number {
  const a = operationalPlanTokens(left);
  const b = operationalPlanTokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  return (2 * intersection) / (a.size + b.size);
}

type OperationalPlanDuplicateAnchor = {
  id: number;
  status: string;
  ownerApproved: boolean;
};

async function findOperationalPlanDuplicate(insight: {
  tenantId: number;
  category: string;
  title: string;
  summary: string;
  details: string;
}): Promise<OperationalPlanDuplicateAnchor | null> {
  const result: any = await db.execute(sql`
    SELECT p.id, p.status, p.ceo_decision, i.title, i.summary, i.details
    FROM plans p
    INNER JOIN ai_insights i
      ON i.tenant_id = p.tenant_id
     AND i.id::text = p.source_ref
    WHERE p.tenant_id = ${insight.tenantId}
      AND p.source = ${ROUTE_SOURCE}
      AND (
        (
          p.status IN ('approved', 'executing', 'failed')
          AND p.ceo_decision = 'approved'
        )
        OR (
          p.status = 'rejected'
          AND p.ceo_decision = 'rejected'
          AND p.ceo_decided_at >= now() - make_interval(days => ${REJECTED_PLAN_DEDUP_DAYS})
        )
      )
      AND p.ceo_decided_by_persona_id = ${FELIX_PERSONA_ID}
      AND p.ceo_decision_reason LIKE '[actor=admin:%'
    ORDER BY p.ceo_decided_at DESC
  `);
  const rows = result.rows ?? result ?? [];
  const candidateText = `${insight.title} ${insight.summary} ${insight.details}`;
  for (const row of Array.isArray(rows) ? rows : []) {
    const priorText = `${row.title ?? ""} ${row.summary ?? ""} ${row.details ?? ""}`;
    if (operationalPlanSimilarity(candidateText, priorText) >= REJECTED_PLAN_SIMILARITY_THRESHOLD) {
      return {
        id: Number(row.id),
        status: String(row.status),
        ownerApproved: row.ceo_decision === "approved",
      };
    }
  }
  return null;
}

export async function stampImmediateSuppressionIfAnchorCurrent(params: {
  insightId: number;
  tenantId: number;
  duplicate: OperationalPlanDuplicateAnchor;
}): Promise<boolean> {
  const duplicatePlanId = params.duplicate.id;
  const actionTaken = `Auto-applied: suppressed near-duplicate of ${
    params.duplicate.ownerApproved ? "unresolved owner-approved" : "rejected"
  } plan #${duplicatePlanId}.`;
  const result: any = await db.execute(sql`
    UPDATE ai_insights
    SET action_taken = ${actionTaken}
    WHERE id = ${params.insightId}
      AND tenant_id = ${params.tenantId}
      AND EXISTS (
        SELECT 1
        FROM plans anchor
        WHERE anchor.id = ${duplicatePlanId}
          AND anchor.tenant_id = ${params.tenantId}
          AND anchor.source = ${ROUTE_SOURCE}
          AND anchor.ceo_decided_by_persona_id = ${FELIX_PERSONA_ID}
          AND anchor.ceo_decision_reason LIKE '[actor=admin:%'
          AND (
            (anchor.status IN ('approved', 'executing', 'failed') AND anchor.ceo_decision = 'approved')
            OR (
              anchor.status = 'rejected'
              AND anchor.ceo_decision = 'rejected'
              AND anchor.ceo_decided_at >= now() - make_interval(days => ${REJECTED_PLAN_DEDUP_DAYS})
            )
          )
      )
    RETURNING id
  `);
  const rows = result.rows ?? result ?? [];
  return Array.isArray(rows) && rows.length === 1;
}

export async function suppressPendingRejectedPlanDuplicates(tenantId?: number): Promise<number> {
  if (tenantId !== undefined && (!Number.isInteger(tenantId) || tenantId <= 0)) {
    throw new Error("suppressPendingRejectedPlanDuplicates requires a positive tenantId when scoped");
  }
  const tenantScope = tenantId === undefined ? sql`` : sql`AND p.tenant_id = ${tenantId}`;
  const result: any = await db.execute(sql`
    SELECT p.id, p.tenant_id, i.id AS insight_id, i.category, i.title, i.summary, i.details
    FROM plans p
    INNER JOIN ai_insights i
      ON i.tenant_id = p.tenant_id
     AND i.id::text = p.source_ref
    WHERE p.source = ${ROUTE_SOURCE}
      AND p.status = 'awaiting_approval'
      ${tenantScope}
    ORDER BY p.created_at ASC
    LIMIT 100
  `);
  const rows = result.rows ?? result ?? [];
  let suppressed = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const pendingTenantId = Number(row.tenant_id);
    const pendingPlanId = Number(row.id);
    const duplicate = await findOperationalPlanDuplicate({
      tenantId: pendingTenantId,
      category: String(row.category ?? ""),
      title: String(row.title ?? ""),
      summary: String(row.summary ?? ""),
      details: String(row.details ?? ""),
    });
    if (!duplicate) continue;

    const result = await db.transaction(async (tx) => {
      const duplicatePlanId = duplicate.id;
      const event = {
        at: new Date().toISOString(),
        type: "plan.dedup_suppressed",
        actor: "system:operational-plan-dedup",
        duplicateOfPlanId: duplicatePlanId,
        ...(duplicate.ownerApproved ? {} : { duplicateOfRejectedPlanId: duplicatePlanId }),
        anchorStatus: duplicate.status,
      };
      const update: any = await tx.execute(sql`
        UPDATE plans
        SET status = 'rejected',
            execution_log = COALESCE(execution_log, '[]'::jsonb) || ${JSON.stringify([event])}::jsonb,
            updated_at = now()
       WHERE id = ${pendingPlanId}
          AND tenant_id = ${pendingTenantId}
          AND source = ${ROUTE_SOURCE}
          AND status = 'awaiting_approval'
           AND EXISTS (
             SELECT 1
             FROM plans anchor
             WHERE anchor.id = ${duplicatePlanId}
               AND anchor.tenant_id = ${pendingTenantId}
               AND anchor.source = ${ROUTE_SOURCE}
               AND anchor.ceo_decided_by_persona_id = ${FELIX_PERSONA_ID}
               AND anchor.ceo_decision_reason LIKE '[actor=admin:%'
               AND (
                 anchor.status IN ('approved', 'executing', 'failed')
                 AND anchor.ceo_decision = 'approved'
                 OR anchor.status = 'rejected'
                 AND anchor.ceo_decision = 'rejected'
                 AND anchor.ceo_decided_at >= now() - make_interval(days => ${REJECTED_PLAN_DEDUP_DAYS})
               )
           )
        RETURNING id
      `);
      const updatedRows = update.rows ?? update ?? [];
      if (!Array.isArray(updatedRows) || updatedRows.length !== 1) return false;

      const insightUpdate: any = await tx.execute(sql`
        UPDATE ai_insights
       SET action_taken = ${`Auto-applied: suppressed near-duplicate of ${
         duplicate.ownerApproved ? "unresolved owner-approved" : "rejected"
       } plan #${duplicatePlanId}.`}
        WHERE id = ${Number(row.insight_id)} AND tenant_id = ${pendingTenantId}
        RETURNING id
      `);
      const insightRows = insightUpdate.rows ?? insightUpdate ?? [];
      if (!Array.isArray(insightRows) || insightRows.length !== 1) {
        throw new Error(`missing insight #${Number(row.insight_id)} during duplicate-plan suppression`);
      }
      return true;
    });
    if (!result) continue;
    suppressed++;
    console.warn(
       `[agentic-engines] Pending plan #${pendingPlanId} suppressed as a near-duplicate of unresolved plan #${duplicate.id}.`,
    );
  }
  return suppressed;
}

async function storeInsight(params: {
  tenantId: number;
  engineType: string;
  category: string;
  title: string;
  summary: string;
  details?: string;
  priority: string;
  dataSnapshot?: string;
  skipAutoRoute?: boolean;
}): Promise<{ id: number; autoApplied: boolean; priority: string }> {
  // R74.13f: removed `params.tenantId ?? 1` — params.tenantId is typed
  // `number` (required, not `number | undefined`), so the `?? 1` was
  // pure dead code that the silent-failure scanner correctly flagged
  // as a fail-open landmine for any future signature loosening.
  const tenantId = params.tenantId;
  const engineType = params.engineType || "unknown";
  const category = params.category || "general";
  const title = (params.title || "Insight").slice(0, 500);
  const summary = (params.summary || "").slice(0, 5000);
  const details = params.details ? params.details.slice(0, 10000) : null;
  const priority = params.priority || "medium";
  const dataSnapshot = params.dataSnapshot ? params.dataSnapshot.slice(0, 20000) : null;
  const isAutoApply = AUTO_APPLY_CATEGORIES.has(category);
  const status = isAutoApply ? "applied" : "new";
  // HIGH+auto-apply gets a "pending plan" marker so the durability sweep can
  // retry routing if Minerva fails transiently. Other rows get the standard reason.
  const actionTaken = isAutoApply
    ? (priority === "high" ? PENDING_PLAN_MARKER : AUTO_APPLY_REASON)
    : null;
  const result: any = await db.execute(sql`
    INSERT INTO ai_insights (tenant_id, engine_type, category, title, summary, details, priority, data_snapshot, status, action_taken)
    VALUES (${tenantId}, ${engineType}, ${category}, ${title},
            ${summary}, ${details}, ${priority}, ${dataSnapshot}, ${status}, ${actionTaken})
    RETURNING id
  `);
  const rows = result.rows || result;
  const id = Number(rows?.[0]?.id);

  // R63 hardening — guard against insert succeeding but RETURNING failing to
  // surface a usable id. Without an id we cannot route; log loudly so the
  // operator can investigate (drizzle/neon shape regression, etc.).
  if (!id || id <= 0) {
    console.warn(`[agentic-engines] storeInsight: invalid returned id (${rows?.[0]?.id}). Skipping routing for "${title.slice(0,80)}".`);
    return { id: 0, autoApplied: isAutoApply, priority };
  }

  // R63: Proactive routing — when an auto-applied insight is HIGH priority,
  // automatically draft a Minerva plan so Felix has a concrete next-step
  // queued instead of just a checkmark. Medium/low auto-applied insights
  // stay silent (only a status update) to avoid flooding the approval queue.
  if (isAutoApply && priority === "high" && !params.skipAutoRoute) {
    routeInsightToMinerva({
      insightId: id, tenantId, category, title, summary, details: details ?? "",
    }).catch((e: any) => console.warn(`[agentic-engines] Minerva routing failed for insight #${id}: ${e.message} (will be retried by sweep)`));
  }

  return { id, autoApplied: isAutoApply, priority };
}

// R63: Route an auto-applied insight to Minerva as a draft plan (status='awaiting_approval').
// This is the bridge from "the system noticed something" to "the system is doing something
// about it" — without overstepping. Felix still approves before any plan executes.
export async function routeInsightToMinerva(insight: {
  insightId: number;
  tenantId: number;
  category: string;
  title: string;
  summary: string;
  details: string;
  repairCandidate?: HeartbeatRepairCandidate;
  sourceRepairCandidate?: SourceRepairCandidate;
}): Promise<
  | { status: "created" | "reused"; planId: number }
  | { status: "suppressed"; duplicatePlanId: number }
  | { status: "deferred"; reason: "no_durable_repair_path" }
> {
  // R63 hardening — idempotency check. If a plan already exists for this
  // (source, sourceRef) tuple, skip creating a duplicate and just refresh
  // the action_taken stamp. Prevents Felix's queue from being spammed by
  // retries, manual replays, or future concurrent callers.
  const existing: any = await db.execute(sql`
    SELECT id FROM plans
    WHERE source = ${ROUTE_SOURCE} AND source_ref = ${String(insight.insightId)}
      AND tenant_id = ${insight.tenantId}
    LIMIT 1
  `);
  const existingRows = existing.rows || existing;
  const existingPlanId = existingRows?.[0]?.id ? Number(existingRows[0].id) : null;

  let planId: number;
  let status: "created" | "reused";
  if (existingPlanId) {
    planId = existingPlanId;
    status = "reused";
    console.log(`[agentic-engines] Insight #${insight.insightId} already has Minerva plan #${planId}; reusing (idempotent).`);
  } else {
    if (insight.sourceRepairCandidate) {
      const candidate = insight.sourceRepairCandidate;
      const action = sourceRepairActionFromFinding({
        id: insight.insightId,
        evidenceVersion: candidate.evidenceVersion,
        evidenceHash: candidate.evidenceHash,
      });
      if (!action) throw new Error("invalid source repair candidate");
      const created = await createPlan({
        tenantId: insight.tenantId,
        objective: `${insight.title} — bounded source investigation`,
        source: ROUTE_SOURCE, sourceRef: String(insight.insightId), repairAction: action,
      });
      return { status: created.created ? "created" : "reused", planId: created.planId };
    }
    if (insight.repairCandidate) {
      const c = insight.repairCandidate;
      if (!Number.isInteger(c.taskId) || c.taskId <= 0 ||
          Object.keys(c).some((key) => !["taskId", "expectedBefore", "desiredAfter"].includes(key))) {
        throw new Error("invalid server heartbeat repair candidate");
      }
      const live: any = await db.execute(sql`
        SELECT id, tenant_id, enabled, cron_expression
        FROM heartbeat_tasks
        WHERE id = ${c.taskId} AND tenant_id = ${insight.tenantId}
      `);
      const task = (live.rows ?? live)[0];
      if (!task) throw new Error("heartbeat repair candidate task is not tenant-local");
      const expected = {
        enabled: Boolean(task.enabled),
        cronExpression: String(task.cron_expression),
      };
      if (JSON.stringify(c.expectedBefore) !== JSON.stringify(expected)) {
        throw new Error("heartbeat repair candidate snapshot is stale");
      }
      const action = createHeartbeatRepairAction({
        taskId: c.taskId, expectedBefore: expected, desiredAfter: c.desiredAfter,
      });
      validateHeartbeatRepairAction(action);
      const created = await createPlan({
        tenantId: insight.tenantId,
        objective: `${insight.title} — heartbeat task ${c.taskId}: enabled=${expected.enabled}, cron=${expected.cronExpression} → enabled=${Boolean(c.desiredAfter.enabled)}, cron=${c.desiredAfter.cronExpression ?? expected.cronExpression}`,
        source: ROUTE_SOURCE, sourceRef: String(insight.insightId), repairAction: action,
      });
      return { status: created.created ? "created" : "reused", planId: created.planId };
    }
    let duplicate = await findOperationalPlanDuplicate(insight);
    for (let attempt = 0; duplicate && attempt < 2; attempt++) {
      const duplicatePlanId = duplicate.id;
      const stamped = await stampImmediateSuppressionIfAnchorCurrent({
        insightId: insight.insightId,
        tenantId: insight.tenantId,
        duplicate,
      });
      if (stamped) {
        console.warn(
          `[agentic-engines] Insight #${insight.insightId} suppressed as a near-duplicate of ${
            duplicate.ownerApproved ? "unresolved owner-approved" : "explicitly rejected"
          } plan #${duplicatePlanId}.`,
        );
        return { status: "suppressed", duplicatePlanId };
      }
      // The anchor resolved between discovery and stamping. Re-evaluate once;
      // if no eligible anchor remains, continue through the normal gate.
      duplicate = attempt === 0 ? await findOperationalPlanDuplicate(insight) : null;
    }

    // S3 fail-closed gate: generic delegate_task plans do not provide a
    // durable repair path. Keep this after idempotency and semantic-anchor
    // checks so existing plans and owner decisions continue to win.
    await db.execute(sql`
      UPDATE ai_insights
      SET action_taken = ${DEFERRED_NO_DURABLE_REPAIR_PATH}
      WHERE id = ${insight.insightId} AND tenant_id = ${insight.tenantId}
    `);
    console.warn(
      `[agentic-engines] Insight #${insight.insightId} deferred: no durable repair path; no Felix plan proposed.`,
    );
    return { status: "deferred", reason: "no_durable_repair_path" };

  }

  // Stamp the insight's action_taken to reference the plan and clear the
  // pending marker so the durability sweep stops retrying.
  await db.execute(sql`
    UPDATE ai_insights
    SET action_taken = ${`${PLAN_DRAFTED_PREFIX}${planId} (awaiting Felix approval).`}
    WHERE id = ${insight.insightId} AND tenant_id = ${insight.tenantId}
  `).catch((e: any) => console.warn(`[agentic-engines] action_taken update failed for insight #${insight.insightId}: ${e.message}`));
  return { status, planId };
}

export type HeartbeatRepairCandidate = {
  taskId: number;
  expectedBefore: { enabled: boolean; cronExpression: string };
  desiredAfter: { enabled: boolean; cronExpression?: string };
};

// R63 hardening — durability sweep. Find HIGH insights that were auto-applied
// but whose Minerva routing failed (action_taken still has the pending marker)
// and retry routing. Runs alongside the regular auto-apply sweep on the same
// 10-minute interval. Idempotent because routeInsightToMinerva itself is.
export async function retryPendingMinervaRouting(): Promise<number> {
  try {
    const tenantResult: any = await db.execute(sql`
      SELECT DISTINCT tenant_id FROM heartbeat_tasks
      WHERE tenant_id IS NOT NULL
      ORDER BY tenant_id ASC
      LIMIT 100
    `);
    for (const row of (tenantResult.rows ?? tenantResult ?? [])) {
      const tid = Number(row.tenant_id);
      if (Number.isInteger(tid) && tid > 0) {
        await produceHeartbeatCronRepairInsights(tid);
      }
    }
    await suppressPendingRejectedPlanDuplicates().catch((error: unknown) => {
      console.warn(
        `[agentic-engines] duplicate-plan suppression failed without blocking routing recovery: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    });
    const result: any = await db.execute(sql`
      SELECT id, tenant_id, category, title, summary, details
      FROM ai_insights
      WHERE status = 'applied'
        AND priority = 'high'
        AND action_taken = ${PENDING_PLAN_MARKER}
      LIMIT 50
    `);
    const rows = result.rows || result;
    const pending = Array.isArray(rows) ? rows : [];
    if (pending.length === 0) return 0;
    console.log(`[agentic-engines] Durability sweep: retrying Minerva routing for ${pending.length} HIGH insights stuck in pending.`);
    let recovered = 0;
    for (const r of pending) {
      try {
        // R74.13f BLOCKING fix (caught in Furrow review): the previous
        // `tenantId: Number(r.tenant_id) || 1` was a tenant fail-open
        // landmine — any insight whose tenant_id was NULL/0/non-numeric
        // would silently get routed to tenant 1. Now: validate first,
        // skip-and-warn on invalid (durability sweep can re-attempt
        // after upstream cleanup).
        const tid = Number(r.tenant_id);
        if (!Number.isInteger(tid) || tid <= 0) {
          console.warn(`[agentic-engines] Durability sweep: insight #${r.id} has invalid tenant_id (${JSON.stringify(r.tenant_id)}); skipping Minerva routing.`);
          continue;
        }
        const routing = await routeInsightToMinerva({
          insightId: Number(r.id),
          tenantId: tid,
          category: String(r.category || "general"),
          title: String(r.title || ""),
          summary: String(r.summary || ""),
          details: String(r.details || ""),
        });
        if (
          routing.status === "created" ||
          routing.status === "reused" ||
          routing.status === "suppressed"
        ) {
          recovered++;
        }
      } catch (e: any) {
        console.warn(`[agentic-engines] Durability sweep: insight #${r.id} still failing — ${e.message}`);
      }
    }
    if (recovered > 0) console.log(`[agentic-engines] Durability sweep: recovered ${recovered}/${pending.length} pending plans.`);
    return recovered;
  } catch (e: any) {
    console.warn(`[agentic-engines] retryPendingMinervaRouting failed: ${e.message}`);
    return 0;
  }
}

// R63: Self-awareness — when a heartbeat task hits dead-letter (5 consecutive
// failures and is auto-disabled), surface it as a HIGH-priority workflow_automation
// insight that auto-applies AND drafts a Minerva plan to investigate/fix.
// The system notices its own failures instead of waiting for the user to spot them.
export async function reportTaskFailureInsight(taskId: number, taskName: string, lastError: string, tenantId: number) {
  // R74.13f fail-closed: removed `tenantId: number = 1` default.
  // Sole caller (heartbeat.ts:599) already passes `taskTenant`
  // explicitly, so the default was dead code masking the real bug
  // shape: a future caller forgetting to pass tenant would silently
  // write self-heal insights to tenant 1 instead of erroring.
  if (typeof tenantId !== "number" || !Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`reportTaskFailureInsight requires a valid tenantId (got: ${JSON.stringify(tenantId)})`);
  }
  try {
    const live: any = await db.execute(sql`
      SELECT id, enabled, cron_expression FROM heartbeat_tasks
      WHERE id = ${taskId} AND tenant_id = ${tenantId}
    `);
    const task = (live.rows ?? live)[0];
    if (!task) throw new Error("failed heartbeat task is not tenant-local");
    const title = `Repeated heartbeat task failure: ${taskName}`.slice(0, 500);
    const summary = `The scheduled task "${taskName}" was disabled after 5 consecutive failures. This requires source-level investigation; no runtime repair is authorized for repeated task failure.`;
    const details = `Last error: ${String(lastError).slice(0, 4000)}\n\nRecommended actions:\n1. Check recent heartbeat_logs for this task to identify the failure pattern.\n2. Verify any required secrets/credentials are still valid.\n3. If the failure is environmental (timeout, network), bump the timeout or add a retry.\n4. If the task is no longer needed, mark it for permanent removal.`;
    const evidenceVersion = `heartbeat-failure-v1:${taskId}`;
    const dataSnapshot = JSON.stringify({ evidenceVersion, taskId, taskName: String(taskName).slice(0, 500),
      lastError: String(lastError).slice(0, 1000) });
    const evidenceHash = createHash("sha256").update(dataSnapshot).digest("hex");
    const prior: any = await db.execute(sql`
      SELECT id FROM ai_insights
      WHERE tenant_id = ${tenantId} AND category = 'source_proposal'
        AND data_snapshot = ${dataSnapshot}
      ORDER BY id ASC LIMIT 1
    `);
    const priorId = Number((prior.rows ?? prior)[0]?.id || 0);
    const result = priorId > 0 ? { id: priorId, autoApplied: false, priority: "high" } : await storeInsight({
      tenantId, engineType: "self_heal", category: "source_proposal",
      title, summary, details, priority: "high", dataSnapshot, skipAutoRoute: true,
    });
    if (result.id > 0) {
      await routeInsightToMinerva({
        insightId: result.id, tenantId, category: "source_proposal",
        title, summary, details,
        sourceRepairCandidate: { evidenceVersion, evidenceHash },
      });
    }
    console.log(`[agentic-engines] Source-proposal insight created for dead-lettered task: ${taskName}`);
  } catch (e: any) {
    console.warn(`[agentic-engines] reportTaskFailureInsight failed: ${e.message}`);
  }
}

/**
 * Produce the one supported runtime repair: make a tenant-local heartbeat
 * schedule safe when its persisted cron is invalid or too frequent. The DB
 * supplies both identity and evidence; no model output participates.
 */
export async function produceHeartbeatCronRepairInsights(tenantId: number): Promise<number> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error("produceHeartbeatCronRepairInsights requires a positive tenantId");
  }
  const result: any = await db.execute(sql`
    SELECT id, tenant_id, name, enabled, cron_expression
    FROM heartbeat_tasks
    WHERE tenant_id = ${tenantId}
    ORDER BY id ASC
    LIMIT 100
  `);
  const tasks = result.rows ?? result ?? [];
  let produced = 0;
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const id = Number(task.id);
    const tid = Number(task.tenant_id);
    const before = { enabled: Boolean(task.enabled), cronExpression: String(task.cron_expression) };
    try {
      parseStrictCron(before.cronExpression);
      continue;
    } catch (error) {
      // Invalid, macro-based, and too-frequent schedules all use the same
      // bounded safe runtime repair.
      logSilentCatch("server/agentic-engines.ts", error);
    }
    const evidenceVersion = `heartbeat-cron-v1:${id}:${before.enabled ? "1" : "0"}:${before.cronExpression}`;
    const dataSnapshot = JSON.stringify({ evidenceVersion, taskId: id, before });
    const title = `Repair heartbeat schedule: ${String(task.name).slice(0, 420)}`;
    const after = { enabled: before.enabled, cronExpression: "*/30 * * * *" };
    const summary = `Heartbeat task ${id} has an unsafe cron schedule. Proposed runtime repair: enabled=${before.enabled}, cron=${before.cronExpression} → enabled=${after.enabled}, cron=${after.cronExpression}.`;
    const details = `Task ${id} exact before state: enabled=${before.enabled}, cron=${before.cronExpression}\nExact proposed after state: enabled=${after.enabled}, cron=${after.cronExpression}\nEvidence version: ${evidenceVersion}`;
    // Serialize only this exact tenant/task/evidence key. The second caller
    // rechecks under the transaction lock, so concurrent sweeps cannot create
    // duplicate cards without requiring a broad schema constraint.
    const insightId = await db.transaction(async (tx: any) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`heartbeat-cron:${tid}:${id}:${evidenceVersion}`}, 0)
        )
      `);
      const existing: any = await tx.execute(sql`
        SELECT id FROM ai_insights
        WHERE tenant_id = ${tid} AND category = 'workflow_automation'
          AND data_snapshot = ${dataSnapshot}
        LIMIT 1
      `);
      if ((existing.rows ?? existing)?.[0]) return 0;
      const inserted: any = await tx.execute(sql`
        INSERT INTO ai_insights
          (tenant_id, engine_type, category, title, summary, details, priority,
           data_snapshot, status, action_taken)
        VALUES (${tid}, 'self_heal', 'workflow_automation', ${title}, ${summary},
                ${details}, 'high', ${dataSnapshot}, 'applied', ${PENDING_PLAN_MARKER})
        RETURNING id
      `);
      return Number((inserted.rows ?? inserted)?.[0]?.id) || 0;
    });
    if (!insightId) continue;
    await routeInsightToMinerva({
      insightId, tenantId: tid, category: "workflow_automation",
      title, summary, details,
      repairCandidate: { taskId: id, expectedBefore: before, desiredAfter: after },
    });
    produced++;
  }
  return produced;
}

// R63: Backfill — sweep existing status='new' insights whose category is in the
// auto-apply policy and mark them applied. Safe to call repeatedly; only touches
// rows still status='new' so manually applied/dismissed items are untouched.
export async function autoApplyEligibleInsights(tenantId?: number): Promise<number> {
  try {
    if (tenantId !== undefined && (!Number.isInteger(tenantId) || tenantId <= 0)) {
      throw new Error(`autoApplyEligibleInsights requires a positive integer tenantId when scoped (got: ${JSON.stringify(tenantId)})`);
    }
    const cats = Array.from(AUTO_APPLY_CATEGORIES);
    const catList = sql.join(cats.map(c => sql`${c}`), sql`, `);
    const tenantScope = tenantId === undefined ? sql`` : sql`AND tenant_id = ${tenantId}`;
    const result: any = await db.execute(sql`
      UPDATE ai_insights
      SET status = 'applied',
          action_taken = ${AUTO_APPLY_REASON}
      WHERE status = 'new'
        AND category IN (${catList})
        ${tenantScope}
      RETURNING id, tenant_id, category, title, summary, details, priority
    `);
    const rows = result.rows || result;
    const count = Array.isArray(rows) ? rows.length : 0;
    if (count > 0) {
      console.log(`[agentic-engines] Auto-applied ${count} eligible insights (operational categories).`);
      // R63: Route HIGH-priority bulk-applied insights to Minerva for the same
      // proactive treatment as storeInsight. Without this, HIGH insights inserted
      // via legacy/bypass paths would auto-apply but never produce a draft plan,
      // causing inconsistent behavior between the two pipelines.
      const highPriority = rows.filter((r: any) => r.priority === "high");
      // For HIGH-priority bulk-applied insights, also stamp them with the
      // pending marker so the durability sweep can retry if routing fails.
      for (const r of highPriority) {
        // R74.13f BLOCKING fix (caught in Furrow review): the previous
        // `tenantId: Number(r.tenant_id) || 1` was a tenant fail-open
        // landmine — any HIGH insight with a NULL/0/non-numeric
        // tenant_id would silently route to tenant 1's Minerva.
        // Skip-and-warn on invalid; durability sweep will not retry
        // because we never set the PENDING_PLAN_MARKER for skipped
        // rows. (72h review: tid validation moved ABOVE the marker
        // UPDATE and the UPDATE is now tenant-scoped — defense-in-depth
        // on a multi-tenant write path, matching line ~148.)
        const tid = Number(r.tenant_id);
        if (!Number.isInteger(tid) || tid <= 0) {
          console.warn(`[agentic-engines] Sweep: HIGH insight #${r.id} has invalid tenant_id (${JSON.stringify(r.tenant_id)}); skipping Minerva routing.`);
          continue;
        }
        await db.execute(sql`
          UPDATE ai_insights SET action_taken = ${PENDING_PLAN_MARKER}
          WHERE id = ${Number(r.id)} AND tenant_id = ${tid}
        `).catch(() => {});
        routeInsightToMinerva({
          insightId: Number(r.id),
          tenantId: tid,
          category: String(r.category || "general"),
          title: String(r.title || ""),
          summary: String(r.summary || ""),
          details: String(r.details || ""),
        }).catch((e: any) => console.warn(`[agentic-engines] sweep: Minerva routing failed for insight #${r.id}: ${e.message} (will be retried by durability sweep)`));
      }
      if (highPriority.length > 0) {
        console.log(`[agentic-engines] Sweep: routing ${highPriority.length} HIGH-priority insights to Minerva.`);
      }
    }
    return count;
  } catch (e: any) {
    console.warn(`[agentic-engines] autoApplyEligibleInsights failed: ${e.message}`);
    return 0;
  }
}

async function callAI(prompt: string, systemPrompt: string, tenantId?: number): Promise<string> {
  const modelId = await getModelForTierAsync("balanced", tenantId);
  const available = await getAvailableModels();
  const { result } = await executeWithFailover(modelId, available, async (client, actualModel) => {
    const resp = await client.chat.completions.create({
      model: actualModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    });
    return resp.choices?.[0]?.message?.content || "";
  }, tenantId);
  return result;
}

async function gatherOperationalData(tenantId: number) {
    const [usage, sessions, experiments, conversations] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*) as total_messages,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as week_messages,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as month_messages
      FROM messages WHERE tenant_id = ${tenantId}
    `).catch(() => ({ rows: [{ total_messages: 0, week_messages: 0, month_messages: 0 }] })),
    db.execute(sql`
      SELECT COUNT(*) as total, COUNT(CASE WHEN status = 'running' THEN 1 END) as active,
             AVG(total_experiments) as avg_experiments
      FROM research_sessions WHERE tenant_id = ${tenantId}
    `).catch(() => ({ rows: [{ total: 0, active: 0, avg_experiments: 0 }] })),
    db.execute(sql`
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN status = 'keep' THEN 1 END) as kept,
             COUNT(CASE WHEN status = 'discard' THEN 1 END) as discarded,
             COUNT(CASE WHEN status = 'crash' THEN 1 END) as crashed
      FROM research_experiments WHERE tenant_id = ${tenantId}
    `).catch(() => ({ rows: [{ total: 0, kept: 0, discarded: 0, crashed: 0 }] })),
    db.execute(sql`
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as week_new
      FROM conversations WHERE tenant_id = ${tenantId}
    `).catch(() => ({ rows: [{ total: 0, week_new: 0 }] })),
  ]);

  const uRows = (usage as any).rows || usage;
  const sRows = (sessions as any).rows || sessions;
  const eRows = (experiments as any).rows || experiments;
  const cRows = (conversations as any).rows || conversations;
  return {
    messages: uRows[0] || {},
    sessions: sRows[0] || {},
    experiments: eRows[0] || {},
    conversations: cRows[0] || {},
  };
}

export async function runDecisionEngine(tenantId: number): Promise<{ insights: number; error?: string }> {
  try {
    console.log(`[decision-engine] Running for tenant ${tenantId}...`);
    const data = await gatherOperationalData(tenantId);

    const programs = await db.execute(sql`
      SELECT name, objective, exploration_strategy, model FROM research_programs
      WHERE tenant_id = ${tenantId} AND is_active = true
    `).catch(() => ({ rows: [] }));
    const progRows = (programs as any).rows || programs;

    const personas = await db.execute(sql`
      SELECT name, role FROM personas WHERE is_active = true LIMIT 14
    `).catch(() => ({ rows: [] }));
    const personaRows = (personas as any).rows || personas;

    const prompt = `Analyze this operational data for an AI agent platform and provide 3-5 strategic recommendations.

OPERATIONAL DATA:
- Total messages: ${data.messages.total_messages}, Last 7 days: ${data.messages.week_messages}, Last 30 days: ${data.messages.month_messages}
- Research sessions: ${data.sessions.total} total, ${data.sessions.active} active, avg ${data.sessions.avg_experiments || 0} experiments/session
- Experiments: ${data.experiments.total} total, ${data.experiments.kept} kept, ${data.experiments.discarded} discarded, ${data.experiments.crashed} crashed
- Conversations: ${data.conversations.total} total, ${data.conversations.week_new} new this week
- Active research programs: ${progRows.length} (${progRows.map((p: any) => p.name).join(", ")})
- Active personas: ${personaRows.length} (${personaRows.map((p: any) => `${p.name}/${p.role}`).join(", ")})

For each recommendation, provide:
1. TITLE: Brief title (under 80 chars)
2. CATEGORY: One of [resource_allocation, marketing_strategy, agent_optimization, cost_reduction, growth_opportunity]
3. PRIORITY: One of [high, medium, low]
4. SUMMARY: 2-3 sentence actionable recommendation
5. DETAILS: Specific steps to implement

Format as JSON array: [{"title":"...","category":"...","priority":"...","summary":"...","details":"..."}]
Return ONLY the JSON array, no markdown.`;

    const systemPrompt = "You are a strategic AI operations analyst for an autonomous AI corporation platform. Analyze data and provide actionable recommendations for resource allocation, marketing strategies, and operational optimization. Be specific and data-driven.";

    const response = await callAI(prompt, systemPrompt, tenantId);
    let recommendations: any[] = [];
    try {
      const cleaned = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      recommendations = JSON.parse(cleaned);
    } catch {
      recommendations = [{ title: "Analysis Complete", category: "general", priority: "medium", summary: response.slice(0, 500), details: response }];
    }

    let count = 0;
    for (const rec of recommendations) {
      await storeInsight({
        tenantId,
        engineType: ENGINE_TYPES.DECISION,
        category: rec.category || "general",
        title: rec.title || "Strategic Recommendation",
        summary: rec.summary || "",
        details: rec.details || "",
        priority: rec.priority || "medium",
        dataSnapshot: JSON.stringify(data),
      });
      count++;
    }

    console.log(`[decision-engine] Generated ${count} insights for tenant ${tenantId}`);
    return { insights: count };
  } catch (e: any) {
    console.error(`[decision-engine] Error:`, e.message);
    return { insights: 0, error: e.message };
  }
}

export async function runPredictiveEngine(tenantId: number): Promise<{ insights: number; error?: string }> {
  try {
    console.log(`[predictive-engine] Running for tenant ${tenantId}...`);
    const data = await gatherOperationalData(tenantId);

    const recentExperiments = await db.execute(sql`
      SELECT re.hypothesis, re.result, re.status, re.metric_value, rp.name as program_name
      FROM research_experiments re
      JOIN research_programs rp ON rp.id = re.program_id
      WHERE re.tenant_id = ${tenantId} AND re.status = 'keep'
      ORDER BY re.created_at DESC LIMIT 20
    `).catch(() => ({ rows: [] }));
    const expRows = (recentExperiments as any).rows || recentExperiments;

    const prompt = `Based on this platform data, identify 3-5 trends and predict future opportunities.

PLATFORM METRICS:
- Message volume: ${data.messages.total_messages} total, ${data.messages.week_messages}/week, ${data.messages.month_messages}/month
- Research performance: ${data.experiments.kept}/${data.experiments.total} experiments kept (${data.experiments.total > 0 ? Math.round((parseInt(String(data.experiments.kept)) / parseInt(String(data.experiments.total))) * 100) : 0}% success rate)
- Conversation growth: ${data.conversations.week_new} new this week out of ${data.conversations.total} total

TOP RESEARCH FINDINGS (kept experiments):
${expRows.slice(0, 10).map((e: any) => `- [${e.program_name}] ${e.hypothesis} → Score: ${e.metric_value || "N/A"}`).join("\n") || "No kept experiments yet"}

For each trend/prediction, provide:
1. TITLE: Brief title (under 80 chars)
2. CATEGORY: One of [market_trend, product_opportunity, growth_forecast, risk_alert, competitive_insight]
3. PRIORITY: One of [high, medium, low]
4. SUMMARY: 2-3 sentence prediction with reasoning
5. DETAILS: Supporting evidence and recommended actions

Format as JSON array: [{"title":"...","category":"...","priority":"...","summary":"...","details":"..."}]
Return ONLY the JSON array, no markdown.`;

    const systemPrompt = "You are a predictive analytics AI specializing in trend forecasting for an autonomous AI corporation. Analyze patterns in operational data and research findings to identify emerging trends, market opportunities, and potential risks. Be forward-looking and data-driven. Focus on actionable predictions.";

    const response = await callAI(prompt, systemPrompt, tenantId);
    let predictions: any[] = [];
    try {
      const cleaned = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      predictions = JSON.parse(cleaned);
    } catch {
      predictions = [{ title: "Trend Analysis Complete", category: "general", priority: "medium", summary: response.slice(0, 500), details: response }];
    }

    let count = 0;
    for (const pred of predictions) {
      await storeInsight({
        tenantId,
        engineType: ENGINE_TYPES.PREDICTION,
        category: pred.category || "general",
        title: pred.title || "Trend Prediction",
        summary: pred.summary || "",
        details: pred.details || "",
        priority: pred.priority || "medium",
        dataSnapshot: JSON.stringify({ metrics: data, topExperiments: expRows.slice(0, 5) }),
      });
      count++;
    }

    console.log(`[predictive-engine] Generated ${count} predictions for tenant ${tenantId}`);
    return { insights: count };
  } catch (e: any) {
    console.error(`[predictive-engine] Error:`, e.message);
    return { insights: 0, error: e.message };
  }
}

export async function runOptimizationEngine(tenantId: number): Promise<{ insights: number; error?: string }> {
  try {
    console.log(`[optimization-engine] Running for tenant ${tenantId}...`);

    const schedules = await db.execute(sql`
      SELECT name, cron_expression, is_enabled, last_run_at, run_all
      FROM research_schedules WHERE tenant_id = ${tenantId}
    `).catch(() => ({ rows: [] }));
    const schedRows = (schedules as any).rows || schedules;

    const taskConfig = await db.execute(sql`
      SELECT name, cron_expression, enabled, last_run_at FROM heartbeat_tasks
      WHERE enabled = true AND tenant_id = ${tenantId} ORDER BY name
    `).catch(() => ({ rows: [] }));
    const taskRows = (taskConfig as any).rows || taskConfig;

    const emailActivity = await db.execute(sql`
      SELECT COUNT(*) as total FROM messages
      WHERE tenant_id = ${tenantId} AND role = 'assistant'
      AND created_at > NOW() - INTERVAL '7 days'
    `).catch(() => ({ rows: [{ total: 0 }] }));
    const emailRows = (emailActivity as any).rows || emailActivity;

    const data = await gatherOperationalData(tenantId);

    const prompt = `Analyze these workflow and process metrics, then recommend 3-5 specific optimizations.

ACTIVE SCHEDULES:
${schedRows.map((s: any) => `- ${s.name}: ${s.cron_expression}, enabled: ${s.is_enabled}, run_all: ${s.run_all}, last: ${s.last_run_at || "never"}`).join("\n") || "No schedules"}

AUTOMATED TASKS:
${taskRows.map((t: any) => `- ${t.name}: ${t.cron_expression}, last: ${t.last_run_at || "never"}`).join("\n") || "No tasks"}

AI RESPONSE VOLUME:
- ${emailRows[0]?.total || 0} AI responses in last 7 days
- ${data.messages.week_messages} total messages this week
- Research: ${data.experiments.kept} kept / ${data.experiments.total} total experiments

OPTIMIZATION AREAS TO ANALYZE:
1. Email/communication workflow efficiency
2. Social media and content scheduling
3. Research program scheduling and model selection
4. Heartbeat task frequency and resource usage
5. Agent utilization and persona workload distribution

For each optimization, provide:
1. TITLE: Brief title (under 80 chars)
2. CATEGORY: One of [email_optimization, social_optimization, scheduling_optimization, resource_optimization, workflow_automation]
3. PRIORITY: One of [high, medium, low]
4. SUMMARY: 2-3 sentence optimization recommendation
5. DETAILS: Specific implementation steps and expected improvement

Format as JSON array: [{"title":"...","category":"...","priority":"...","summary":"...","details":"..."}]
Return ONLY the JSON array, no markdown.`;

    const systemPrompt = "You are a process optimization AI that specializes in improving automated workflows for an AI corporation platform. Analyze task performance, scheduling patterns, and resource utilization to suggest concrete optimizations. Focus on reducing waste, improving efficiency, and automating repetitive processes. Be specific about expected improvements.";

    const response = await callAI(prompt, systemPrompt, tenantId);
    let optimizations: any[] = [];
    try {
      const cleaned = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      optimizations = JSON.parse(cleaned);
    } catch {
      optimizations = [{ title: "Optimization Analysis Complete", category: "general", priority: "medium", summary: response.slice(0, 500), details: response }];
    }

    let count = 0;
    for (const opt of optimizations) {
      await storeInsight({
        tenantId,
        engineType: ENGINE_TYPES.OPTIMIZATION,
        category: opt.category || "general",
        title: opt.title || "Process Optimization",
        summary: opt.summary || "",
        details: opt.details || "",
        priority: opt.priority || "medium",
        dataSnapshot: JSON.stringify({ schedules: schedRows, tasks: taskRows }),
      });
      count++;
    }

    console.log(`[optimization-engine] Generated ${count} optimizations for tenant ${tenantId}`);
    return { insights: count };
  } catch (e: any) {
    console.error(`[optimization-engine] Error:`, e.message);
    return { insights: 0, error: e.message };
  }
}

export async function runAllEngines(tenantId: number) {
  const results = {
    decision: await runDecisionEngine(tenantId),
    prediction: await runPredictiveEngine(tenantId),
    optimization: await runOptimizationEngine(tenantId),
  };
  const total = results.decision.insights + results.prediction.insights + results.optimization.insights;
  console.log(`[agentic-engines] All engines complete for tenant ${tenantId}: ${total} total insights`);
  // R63: catch any insights that bypassed storeInsight (legacy paths) and apply policy.
  await autoApplyEligibleInsights(tenantId);
  return results;
}
