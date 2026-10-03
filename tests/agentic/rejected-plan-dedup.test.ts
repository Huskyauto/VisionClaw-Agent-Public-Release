import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { db } from "../../server/db";
import {
  operationalPlanSimilarity,
  routeInsightToMinerva,
  suppressPendingRejectedPlanDuplicates,
  stampImmediateSuppressionIfAnchorCurrent,
} from "../../server/agentic-engines";
import { createPlan } from "../../server/minerva-planner";

test("different operational topics do not collide merely because their category matches", () => {
  const rejected =
    "Repair Google mail authentication after the provider revoked an OAuth credential and message delivery stopped.";
  const candidate =
    "Reduce fixed-frequency heartbeat work by waking idle reconciliation jobs only when a relevant event arrives.";

  assert.ok(
    operationalPlanSimilarity(rejected, candidate) < 0.55,
    "unrelated operational recommendations must remain eligible for Felix review",
  );
});

test("concurrent plan creation reuses one auto-apply source reference", async () => {
  const tenantId = 1;
  const sourceRef = `concurrency-${randomUUID()}`;
  const objective = "Concurrency contract test for one operational insight";
  try {
    const results = await Promise.all([
      createPlan({ tenantId, objective, source: "agentic-engine.auto-apply", sourceRef }),
      createPlan({ tenantId, objective, source: "agentic-engine.auto-apply", sourceRef }),
    ]);
    assert.equal(results[0].planId, results[1].planId);
    assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);

    const count: any = await db.execute(sql`
      SELECT count(*)::int AS n
      FROM plans
      WHERE tenant_id = ${tenantId}
        AND source = 'agentic-engine.auto-apply'
        AND source_ref = ${sourceRef}
    `);
    assert.equal(Number((count.rows ?? count)[0].n), 1);
  } finally {
    const plans: any = await db.execute(sql`
      DELETE FROM plans
      WHERE tenant_id = ${tenantId}
        AND source = 'agentic-engine.auto-apply'
        AND source_ref = ${sourceRef}
      RETURNING id
    `);
    const planIds = (plans.rows ?? plans).map((row: any) => Number(row.id));
    if (planIds.length > 0) {
      await db.execute(sql`
        DELETE FROM event_log
        WHERE tenant_id = ${tenantId}
          AND event_type = 'plan.proposed'
          AND (data->>'planId')::int = ${planIds[0]}
      `);
    }
  }
});

test("an explicitly rejected operational plan suppresses a near-duplicate proposal", async () => {
  const tenantId = 1;
  const category = `scheduling_optimization_test_${randomUUID()}`;
  const recategorized = `resource_optimization_test_${randomUUID()}`;
  const priorTitle = "Stagger the overnight research and maintenance cluster";
  const priorSummary =
    "Backups, memory jobs, embedding backfill, model sync, competitive research, and process optimization all cluster between 03:00 and 05:00, creating avoidable contention.";
  const newTitle = "Flatten the overnight research and maintenance spike";
  const newSummary =
    "The 03:00 to 05:30 window concentrates backups, memory work, embedding backfill, model sync, competitive research, and process optimization, causing queue contention.";

  let priorInsightId = 0;
  let newInsightId = 0;
  let priorPlanId = 0;
  try {
    const priorInsight: any = await db.execute(sql`
      INSERT INTO ai_insights
        (tenant_id, engine_type, category, title, summary, priority, status, action_taken)
      VALUES
        (${tenantId}, 'optimization', ${category}, ${priorTitle}, ${priorSummary},
         'high', 'applied', 'test prior plan')
      RETURNING id
    `);
    priorInsightId = Number((priorInsight.rows ?? priorInsight)[0].id);

    const priorPlan: any = await db.execute(sql`
      INSERT INTO plans
        (tenant_id, objective, source, source_ref, status, plan_json,
         planner_persona_id, ceo_decision, ceo_decision_reason, ceo_decided_at,
         ceo_decided_by_persona_id)
      VALUES
        (${tenantId}, ${`${priorTitle}\n\n${priorSummary}`},
         'agentic-engine.auto-apply', ${String(priorInsightId)}, 'rejected',
         '{}'::jsonb, 15, 'rejected', '[actor=admin:test] duplicate proposal rejected', now(), 2)
      RETURNING id
    `);
    priorPlanId = Number((priorPlan.rows ?? priorPlan)[0].id);

    const newInsight: any = await db.execute(sql`
      INSERT INTO ai_insights
        (tenant_id, engine_type, category, title, summary, priority, status, action_taken)
      VALUES
        (${tenantId}, 'optimization', ${category}, ${newTitle}, ${newSummary},
         'high', 'applied', 'Auto-applied: pending Minerva plan')
      RETURNING id
    `);
    newInsightId = Number((newInsight.rows ?? newInsight)[0].id);

    const result = await routeInsightToMinerva({
      insightId: newInsightId,
      tenantId,
      category: recategorized,
      title: newTitle,
      summary: newSummary,
      details: "",
    });

    assert.deepEqual(result, { status: "suppressed", duplicatePlanId: priorPlanId });

    const plans: any = await db.execute(sql`
      SELECT id FROM plans
      WHERE tenant_id = ${tenantId}
        AND source = 'agentic-engine.auto-apply'
        AND source_ref = ${String(newInsightId)}
    `);
    assert.equal((plans.rows ?? plans).length, 0);

    const insight: any = await db.execute(sql`
      SELECT action_taken FROM ai_insights
      WHERE tenant_id = ${tenantId} AND id = ${newInsightId}
    `);
    assert.match(
      String((insight.rows ?? insight)[0].action_taken),
      new RegExp(`suppressed near-duplicate of rejected plan #${priorPlanId}`),
    );
  } finally {
    if (newInsightId) {
      await db.execute(sql`
        DELETE FROM plans
        WHERE tenant_id = ${tenantId}
          AND source = 'agentic-engine.auto-apply'
          AND source_ref = ${String(newInsightId)}
      `);
    }
    if (newInsightId) {
      await db.execute(sql`DELETE FROM ai_insights WHERE tenant_id = ${tenantId} AND id = ${newInsightId}`);
    }
    if (priorPlanId) {
      await db.execute(sql`DELETE FROM plans WHERE tenant_id = ${tenantId} AND id = ${priorPlanId}`);
    }
    if (priorInsightId) {
      await db.execute(sql`DELETE FROM ai_insights WHERE tenant_id = ${tenantId} AND id = ${priorInsightId}`);
    }
  }
});

test("the reconciliation sweep closes a pending near-duplicate of a rejected plan", async () => {
  const tenantId = 1;
  const category = `resource_optimization_test_${randomUUID()}`;
  let rejectedInsightId = 0;
  let pendingInsightId = 0;
  let rejectedPlanId = 0;
  let pendingPlanId = 0;
  try {
    const rejectedInsight: any = await db.execute(sql`
      INSERT INTO ai_insights
        (tenant_id, engine_type, category, title, summary, priority, status, action_taken)
      VALUES
        (${tenantId}, 'optimization', ${category},
         'Gate low-yield research using adaptive cadence',
         'Only a small share of daily experiments are retained. Gate low-yield programs by recent novelty, source freshness, and downstream business use.',
         'high', 'applied', 'test rejected plan')
      RETURNING id
    `);
    rejectedInsightId = Number((rejectedInsight.rows ?? rejectedInsight)[0].id);

    const rejectedPlan: any = await db.execute(sql`
      INSERT INTO plans
        (tenant_id, objective, source, source_ref, status, plan_json,
         planner_persona_id, ceo_decision, ceo_decision_reason, ceo_decided_at,
         ceo_decided_by_persona_id)
      VALUES
        (${tenantId}, 'Gate low-yield research using adaptive cadence',
         'agentic-engine.auto-apply', ${String(rejectedInsightId)}, 'rejected',
         '{}'::jsonb, 15, 'rejected', '[actor=admin:test] rejected', now(), 2)
      RETURNING id
    `);
    rejectedPlanId = Number((rejectedPlan.rows ?? rejectedPlan)[0].id);

    const pendingInsight: any = await db.execute(sql`
      INSERT INTO ai_insights
        (tenant_id, engine_type, category, title, summary, priority, status, action_taken)
      VALUES
        (${tenantId}, 'optimization', ${category},
         'Reduce low-yield research with an adaptive schedule',
         'A small fraction of daily experiments are kept. Gate low-yield programs using recent novelty, source freshness, and clear downstream business use.',
         'high', 'applied', 'Auto-applied + drafted Minerva plan for test')
      RETURNING id
    `);
    pendingInsightId = Number((pendingInsight.rows ?? pendingInsight)[0].id);

    const pendingPlan: any = await db.execute(sql`
      INSERT INTO plans
        (tenant_id, objective, source, source_ref, status, plan_json, planner_persona_id)
      VALUES
        (${tenantId}, 'Reduce low-yield research with an adaptive schedule',
         'agentic-engine.auto-apply', ${String(pendingInsightId)}, 'awaiting_approval',
         '{}'::jsonb, 15)
      RETURNING id
    `);
    pendingPlanId = Number((pendingPlan.rows ?? pendingPlan)[0].id);

    assert.equal(await suppressPendingRejectedPlanDuplicates(tenantId), 1);

    const plan: any = await db.execute(sql`
      SELECT status, ceo_decision, ceo_decision_reason, execution_log
      FROM plans
      WHERE tenant_id = ${tenantId} AND id = ${pendingPlanId}
    `);
    const row = (plan.rows ?? plan)[0];
    assert.equal(row.status, "rejected");
    assert.equal(row.ceo_decision, null);
    assert.equal(row.ceo_decision_reason, null);
    assert.equal(row.execution_log.at(-1)?.type, "plan.dedup_suppressed");
    assert.equal(row.execution_log.at(-1)?.duplicateOfRejectedPlanId, rejectedPlanId);
    assert.equal(row.execution_log.at(-1)?.actor, "system:operational-plan-dedup");
  } finally {
    if (pendingPlanId) await db.execute(sql`DELETE FROM plans WHERE tenant_id = ${tenantId} AND id = ${pendingPlanId}`);
    if (rejectedPlanId) await db.execute(sql`DELETE FROM plans WHERE tenant_id = ${tenantId} AND id = ${rejectedPlanId}`);
    if (pendingInsightId) await db.execute(sql`DELETE FROM ai_insights WHERE tenant_id = ${tenantId} AND id = ${pendingInsightId}`);
    if (rejectedInsightId) await db.execute(sql`DELETE FROM ai_insights WHERE tenant_id = ${tenantId} AND id = ${rejectedInsightId}`);
  }
});

test("an owner-approved failed repair anchors category-drifted replacements, but machine rows and other tenants do not", async () => {
  const tenantId = 1;
  const otherTenantId = 2;
  const suffix = randomUUID();
  const title = `Repair stale queue ${suffix}`;
  const summary = "Rebuild the stale queue index after repeated worker timeout and verify recovery.";
  const insightIds: number[] = [];
  const planIds: number[] = [];
  try {
    const insertInsight = async (tenant: number, category: string, insightTitle: string, insightSummary: string) => {
      const result: any = await db.execute(sql`
        INSERT INTO ai_insights
          (tenant_id, engine_type, category, title, summary, priority, status, action_taken)
        VALUES (${tenant}, 'optimization', ${category}, ${insightTitle}, ${insightSummary},
          'high', 'applied', 'test fixture')
        RETURNING id
      `);
      return Number((result.rows ?? result)[0].id);
    };
    const insertPlan = async (tenant: number, insightId: number, objective: string, status: string, decision: string | null, reason: string | null, decidedBy: number | null) => {
      const result: any = await db.execute(sql`
        INSERT INTO plans
          (tenant_id, objective, source, source_ref, status, plan_json,
           planner_persona_id, ceo_decision, ceo_decision_reason, ceo_decided_at,
           ceo_decided_by_persona_id)
        VALUES (${tenant}, ${objective}, 'agentic-engine.auto-apply', ${String(insightId)},
          ${status}, '{}'::jsonb, 15, ${decision}, ${reason}, now(), ${decidedBy})
        RETURNING id
      `);
      return Number((result.rows ?? result)[0].id);
    };

    const anchorInsight = await insertInsight(tenantId, `anchor_${suffix}`, title, summary);
    insightIds.push(anchorInsight);
    const anchorPlan = await insertPlan(tenantId, anchorInsight, `${title}\n\n${summary}`, "failed", "approved", "[actor=admin:test] approved repair", 2);
    planIds.push(anchorPlan);
    await db.execute(sql`UPDATE plans SET ceo_decided_at = now() - interval '30 days' WHERE id = ${anchorPlan}`);

    const machineInsight = await insertInsight(tenantId, `machine_${suffix}`, `Rotate archived telemetry shard ${suffix}`, "Compact cold storage segments after retention rollover and verify checksum integrity.");
    insightIds.push(machineInsight);
    const machinePlan = await insertPlan(tenantId, machineInsight, `${title}\n\n${summary}`, "failed", null, null, null);
    planIds.push(machinePlan);

    const candidateInsight = await insertInsight(tenantId, `drifted_${suffix}`, "Recover the stale queue index", "Verify recovery after worker timeout by rebuilding the queue index.");
    insightIds.push(candidateInsight);
    const suppressed = await routeInsightToMinerva({
      insightId: candidateInsight,
      tenantId,
      category: `different_category_${suffix}`,
      title: "Recover the stale queue index",
      summary: "Verify recovery after worker timeout by rebuilding the queue index.",
      details: "",
    });
    assert.deepEqual(suppressed, { status: "suppressed", duplicatePlanId: anchorPlan });

    const revalidationInsight = await insertInsight(tenantId, `revalidation_${suffix}`, title, summary);
    insightIds.push(revalidationInsight);
    await db.execute(sql`UPDATE plans SET status = 'completed' WHERE id = ${anchorPlan}`);
    assert.equal(
      await stampImmediateSuppressionIfAnchorCurrent({
        insightId: revalidationInsight,
        tenantId,
        duplicate: { id: anchorPlan, status: "failed", ownerApproved: true },
      }),
      false,
    );
    await db.execute(sql`UPDATE plans SET status = 'failed' WHERE id = ${anchorPlan}`);

    const machineCandidateInsight = await insertInsight(tenantId, `machine_candidate_${suffix}`, `Compact archived telemetry shard ${suffix}`, "Rebuild cold storage segments after retention rollover and verify checksum integrity.");
    insightIds.push(machineCandidateInsight);
    const machineCandidate = await routeInsightToMinerva({
      insightId: machineCandidateInsight,
      tenantId,
      category: `machine_candidate_category_${suffix}`,
      title: `Compact archived telemetry shard ${suffix}`,
      summary: "Rebuild cold storage segments after retention rollover and verify checksum integrity.",
      details: "",
    });
    assert.deepEqual(machineCandidate, { status: "deferred", reason: "no_durable_repair_path" });

    const oldRejectedInsight = await insertInsight(otherTenantId, `old_rejected_${suffix}`, "Recover the stale queue index", "Verify recovery after worker timeout by rebuilding the queue index.");
    insightIds.push(oldRejectedInsight);
    const oldRejectedPlan = await insertPlan(otherTenantId, oldRejectedInsight, "Recover the stale queue index\n\nVerify recovery after worker timeout by rebuilding the queue index.", "rejected", "rejected", "[actor=admin:test] rejected", 2);
    planIds.push(oldRejectedPlan);
    await db.execute(sql`UPDATE plans SET ceo_decided_at = now() - interval '30 days' WHERE id = ${oldRejectedPlan}`);

    const otherCandidateInsight = await insertInsight(otherTenantId, `other_candidate_${suffix}`, "Recover the stale queue index", "Verify recovery after worker timeout by rebuilding the queue index.");
    insightIds.push(otherCandidateInsight);
    const otherCandidate = await routeInsightToMinerva({
      insightId: otherCandidateInsight,
      tenantId: otherTenantId,
      category: `other_candidate_category_${suffix}`,
      title: "Recover the stale queue index",
      summary: "Verify recovery after worker timeout by rebuilding the queue index.",
      details: "",
    });
    assert.deepEqual(otherCandidate, { status: "deferred", reason: "no_durable_repair_path" });
  } finally {
    for (const planId of planIds) await db.execute(sql`DELETE FROM plans WHERE id = ${planId}`);
    for (const insightId of insightIds) await db.execute(sql`DELETE FROM ai_insights WHERE id = ${insightId}`);
  }
});

test("an unsupported operational insight is deferred without creating a Felix card", async () => {
  const tenantId = 1;
  const category = `unsupported_repair_test_${randomUUID()}`;
  let insightId = 0;
  try {
    const inserted: any = await db.execute(sql`
      INSERT INTO ai_insights
        (tenant_id, engine_type, category, title, summary, priority, status, action_taken)
      VALUES
        (${tenantId}, 'optimization', ${category},
         'Repair an unsupported production queue defect',
         'The queue needs a source-level repair, but no durable repair adapter is registered.',
         'high', 'applied', 'Auto-applied: pending Minerva plan')
      RETURNING id
    `);
    insightId = Number((inserted.rows ?? inserted)[0].id);
    const proposedBefore: any = await db.execute(sql`
      SELECT count(*)::int AS n FROM event_log
      WHERE tenant_id = ${tenantId} AND event_type = 'plan.proposed'
    `);

    const result = await routeInsightToMinerva({
      insightId,
      tenantId,
      category,
      title: "Repair an unsupported production queue defect",
      summary: "The queue needs a source-level repair, but no durable repair adapter is registered.",
      details: "",
    });
    assert.deepEqual(result, { status: "deferred", reason: "no_durable_repair_path" });

    const plans: any = await db.execute(sql`
      SELECT id FROM plans
      WHERE tenant_id = ${tenantId}
        AND source = 'agentic-engine.auto-apply'
        AND source_ref = ${String(insightId)}
    `);
    assert.equal((plans.rows ?? plans).length, 0);

    const insight: any = await db.execute(sql`
      SELECT action_taken FROM ai_insights
      WHERE tenant_id = ${tenantId} AND id = ${insightId}
    `);
    assert.equal(String((insight.rows ?? insight)[0].action_taken), "Deferred: no durable repair path.");

    await import("../../server/agentic-engines").then(({ retryPendingMinervaRouting }) =>
      retryPendingMinervaRouting(),
    );
    const afterRetry: any = await db.execute(sql`
      SELECT action_taken FROM ai_insights
      WHERE tenant_id = ${tenantId} AND id = ${insightId}
    `);
    assert.equal(String((afterRetry.rows ?? afterRetry)[0].action_taken), "Deferred: no durable repair path.");
    const proposedAfter: any = await db.execute(sql`
      SELECT count(*)::int AS n FROM event_log
      WHERE tenant_id = ${tenantId} AND event_type = 'plan.proposed'
    `);
    assert.equal(Number((proposedAfter.rows ?? proposedAfter)[0].n), Number((proposedBefore.rows ?? proposedBefore)[0].n));
  } finally {
    if (insightId) await db.execute(sql`DELETE FROM ai_insights WHERE tenant_id = ${tenantId} AND id = ${insightId}`);
  }
});