/**
 * Internal Resolver — Round 34 (revised: real actions, not just logs)
 *
 * When `attention-handlers/owner-notify.ts` decides NOT to email Bob
 * (because the audience is Felix in-app, or the referenced row doesn't
 * exist), it hands the event to this module. We TAKE ACTION so the
 * event is actually resolved instead of rotting in the queue.
 *
 * Resolution policy by event type:
 *
 *   plan.proposed / plan.revised
 *     - If the objective matches an obvious test/throwaway pattern,
 *       reject the plan via Felix's existing `decidePlan` (CAS-safe
 *       against a concurrent UI decision).
 *     - Otherwise the plan stays in `awaiting_approval` for Felix's
 *       in-app queue (that IS the action — the queue is the routing
 *       target).
 *     - In both cases the event_log row is finalized so the heartbeat
 *       poller stops re-scoring it.
 *
 *   research.experiment.failed
 *     - The verifier already shadow-applied + reverted before the diff
 *       reached disk, but the `code_proposals` row is still sitting in
 *       `status='pending'` and would otherwise be re-picked by the
 *       autoresearch loop. Archive it so the loop moves on.
 *
 *   delivery.* (orphan reference)
 *     - Reference is gone. Finalize the event so attention-scorer
 *       stops re-firing it.
 *
 *   default
 *     - Finalize the event with status='archived_no_handler' so it
 *       can't haunt the queue.
 *
 * In every branch we mutate `event_log` to a terminal status — that's
 * what makes "resolved" mean resolved. heartbeat.ts (line 251) polls
 * `WHERE status='pending'`, so a non-pending status is the kill switch.
 *
 * Safety: all work is best-effort, swallows its own errors, and
 * `decidePlan` uses CAS so a concurrent human UI decision always wins.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";

const RESOLVER_ACTOR = "internal-resolver-bot";

// Conservative — only matches OBVIOUSLY synthetic objectives. A real
// plan with the word "test" in it (e.g. "Test market for diabetic
// recipe app") will NOT match.
const TEST_PLAN_PATTERNS: Array<{ name: string; rx: RegExp }> = [
  { name: "haiku-summary", rx: /\bhaiku-style\b|\bhaiku\s+summary\b|\b\d+-?sentence\s+haiku\b/i },
  { name: "race-test",     rx: /\brace-test\s+plan\b/i },
  { name: "sequential-test", rx: /\bsequential\s+test\s+plan\b/i },
  { name: "reject-empty-actor", rx: /\breject-empty-actor\s+plan\b/i },
  { name: "test-prefix",   rx: /^test\s*[:\-]\s/i },
  { name: "throwaway",     rx: /^(write|create)\s+a\s+(short|simple|small)\s+(haiku|poem|joke)\b/i },
];

function classifyObjective(objective: string): { isTest: boolean; pattern?: string } {
  if (!objective) return { isTest: false };
  for (const p of TEST_PLAN_PATTERNS) {
    if (p.rx.test(objective)) return { isTest: true, pattern: p.name };
  }
  return { isTest: false };
}

export interface ResolverResult {
  resolved: boolean;
  action: string;
  details?: string;
}

/**
 * Finalize an event_log row with the resolver's verdict.
 *
 * IMPORTANT — race-aware CAS clause:
 * In `event-bus.ts` the publish flow `await`s `routeEventToSubscribers`
 * synchronously, which sets status to `'routed'` or `'no_subscribers'`,
 * BEFORE the `setImmediate`-deferred resolver runs. So a naïve
 * `WHERE status='pending'` CAS would always lose the race and the
 * resolver's audit trail would be silently dropped.
 *
 * Resolver verdicts are more authoritative for audit than the router's
 * bookkeeping statuses, so we allow the resolver to OVERWRITE
 * `'pending' | 'routed' | 'no_subscribers'`. We still refuse to clobber
 * any earlier resolver terminal state (`resolved_internal`,
 * `archived_*`, `routed_to_felix_queue`) — this prevents a duplicate
 * resolver dispatch (rare) from rewriting a previously-recorded
 * verdict.
 */
async function finalizeEvent(eventId: number, terminalStatus: string, result: any): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE event_log
      SET status = ${terminalStatus},
          processing_result = ${JSON.stringify(result)}::jsonb,
          processed_at = NOW()
      WHERE id = ${eventId}
        AND status IN ('pending', 'routed', 'no_subscribers')
    `);
  } catch (err: any) {
    console.error(`[internal-resolver] failed to finalize event #${eventId}: ${err.message}`);
  }
}

async function resolvePlanProposed(eventId: number, planId: number): Promise<ResolverResult> {
  const r: any = await db.execute(sql`SELECT id, objective, status FROM plans WHERE id = ${planId} LIMIT 1`);
  const plan = (r.rows ?? r)[0];
  if (!plan) {
    await finalizeEvent(eventId, "archived_orphan", { reason: "plan no longer exists", planId });
    return { resolved: true, action: "archived_orphan_plan", details: `planId=${planId}` };
  }
  if (plan.status !== "awaiting_approval") {
    await finalizeEvent(eventId, "resolved_internal", { reason: `plan already in '${plan.status}'`, planId });
    return { resolved: true, action: "noop_already_decided", details: `status=${plan.status}` };
  }

  const c = classifyObjective(plan.objective || "");
  if (!c.isTest) {
    // Real plan → routing target IS Felix's awaiting_approval queue.
    // Finalize the wake event so it doesn't keep re-firing; the plan
    // itself stays in the queue for Felix's UI.
    await finalizeEvent(eventId, "routed_to_felix_queue", {
      planId,
      action: "left_in_awaiting_approval",
      objective: (plan.objective || "").slice(0, 200),
    });
    console.log(`[internal-resolver] Plan #${plan.id} routed to Felix queue (awaiting_approval); event finalized`);
    return { resolved: true, action: "routed_to_felix_queue" };
  }

  // Auto-reject via Felix's existing decision pathway. CAS in decidePlan
  // ensures a concurrent human UI decision always wins.
  try {
    const { decidePlan } = await import("./minerva-planner");
    await decidePlan({
      planId: plan.id,
      decision: "reject",
      reason: `auto-rejected by internal-resolver: matches test/throwaway pattern (${c.pattern}); no human review needed`,
      actor: RESOLVER_ACTOR,
    });
    await finalizeEvent(eventId, "resolved_internal", {
      planId,
      action: "auto_rejected",
      pattern: c.pattern,
    });
    console.log(`[internal-resolver] Auto-rejected plan #${plan.id} (pattern=${c.pattern}); event finalized`);
    return { resolved: true, action: "auto_rejected_plan", details: `pattern=${c.pattern}` };
  } catch (err: any) {
    // CAS lost — likely concurrent UI decision. That's the desired
    // behavior, not an error.
    await finalizeEvent(eventId, "resolved_internal", { planId, action: "cas_lost", error: err.message });
    console.log(`[internal-resolver] Plan #${plan.id} CAS lost (likely concurrent UI decision): ${err.message}`);
    return { resolved: true, action: "cas_lost", details: err.message };
  }
}

async function resolveExperimentFailed(eventId: number, data: any): Promise<ResolverResult> {
  const proposalId = typeof data?.proposalId === "number" ? data.proposalId : null;
  const stage = data?.stage || "unknown";

  if (proposalId === null) {
    await finalizeEvent(eventId, "archived_no_handler", { reason: "no proposalId in event data", stage });
    return { resolved: true, action: "archived_no_proposal_id" };
  }

  // Archive the failed proposal so the autoresearch loop won't re-pick
  // it. Only flip from 'pending' so we don't clobber a proposal that
  // a human has already acted on.
  const upd: any = await db.execute(sql`
    UPDATE code_proposals
    SET status = 'archived_verification_failed',
        reviewed_by = ${RESOLVER_ACTOR},
        reviewed_at = NOW()
    WHERE id = ${proposalId} AND status = 'pending'
    RETURNING id, target_file, title
  `);
  const archived = (upd.rows ?? upd)[0];

  if (archived) {
    await finalizeEvent(eventId, "resolved_internal", {
      proposalId,
      action: "proposal_archived",
      stage,
      target_file: archived.target_file,
    });
    console.log(`[internal-resolver] Archived failed proposal #${proposalId} (${archived.target_file}, stage=${stage})`);
    return { resolved: true, action: "archived_failed_proposal", details: `proposalId=${proposalId}` };
  }

  // Proposal doesn't exist or already in a terminal status — orphan.
  await finalizeEvent(eventId, "archived_orphan", {
    proposalId,
    reason: "proposal not in 'pending' status (already handled or never existed)",
    stage,
  });
  console.log(`[internal-resolver] research.experiment.failed proposal #${proposalId} not pending — orphan, event finalized`);
  return { resolved: true, action: "orphan_proposal", details: `proposalId=${proposalId}` };
}

async function resolveOrphanDelivery(eventId: number, eventType: string, data: any): Promise<ResolverResult> {
  await finalizeEvent(eventId, "archived_orphan", {
    eventType,
    deliveryId: data?.deliveryId,
    reason: "referenced delivery row does not exist",
  });
  console.log(`[internal-resolver] Archived orphan ${eventType} event #${eventId} (deliveryId=${data?.deliveryId})`);
  return { resolved: true, action: "archived_orphan_delivery", details: `deliveryId=${data?.deliveryId}` };
}

export async function resolveDroppedEvent(params: {
  eventId: number;
  eventType: string;
  data: any;
}): Promise<ResolverResult> {
  const { eventId, eventType, data } = params;
  try {
    if (eventType === "plan.proposed" && typeof data?.planId === "number") {
      return await resolvePlanProposed(eventId, data.planId);
    }
    if (eventType === "plan.revised" && typeof data?.revisedPlanId === "number") {
      return await resolvePlanProposed(eventId, data.revisedPlanId);
    }
    if (eventType === "research.experiment.failed") {
      return await resolveExperimentFailed(eventId, data);
    }
    if (eventType.startsWith("delivery.")) {
      return await resolveOrphanDelivery(eventId, eventType, data);
    }
    // Unknown drop reason — finalize so the attention scorer stops
    // re-picking it.
    await finalizeEvent(eventId, "archived_no_handler", { eventType, reason: "no resolver branch" });
    console.log(`[internal-resolver] event #${eventId} (${eventType}) finalized as archived_no_handler`);
    return { resolved: true, action: "archived_no_handler" };
  } catch (err: any) {
    console.error(`[internal-resolver] event #${eventId} (${eventType}) resolution error: ${err.message}`);
    return { resolved: false, action: "error", details: err.message };
  }
}
