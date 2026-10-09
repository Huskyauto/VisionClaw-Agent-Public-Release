import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeartbeatRepairAction,
  validateHeartbeatRepairAction,
} from "../../server/agentic/heartbeat-repair-contract";
import { parseStrictCron } from "../../server/cron-utils";
import { validatePlanApprovalReadiness } from "../../server/minerva-planner";
import { createPlan, decidePlan, setExecutorKickForTests } from "../../server/minerva-planner";
import { produceHeartbeatCronRepairInsights, routeInsightToMinerva } from "../../server/agentic-engines";
import { db } from "../../server/db";
import { sql } from "drizzle-orm";
import { executeHeartbeatRepair } from "../../server/agentic/heartbeat-repair-adapter";
import { executeHeartbeatRepairStepForTest } from "../../server/plan-executor";
import { randomUUID } from "node:crypto";

const valid = () => createHeartbeatRepairAction({
  taskId: 41,
  expectedBefore: { enabled: true, cronExpression: "*/15 * * * *" },
  desiredAfter: { enabled: false, cronExpression: "*/15 * * * *" },
});

test("heartbeat repair binding rejects extra and authorization fields", () => {
  const action: any = valid();
  action._tenantId = 1;
  assert.throws(() => validateHeartbeatRepairAction(action), /unsupported repair action field/);
  const action2: any = valid();
  action2.expectedBefore.prompt = "do not mutate";
  assert.throws(() => validateHeartbeatRepairAction(action2), /unsupported fields/);
});

test("strict heartbeat cron rejects macros, malformed fields, and overly frequent cadence", () => {
  assert.throws(() => parseStrictCron("@hourly"), /exactly five fields|macros/);
  assert.throws(() => parseStrictCron("*/1 * * * *"), /at least five minutes/);
  assert.throws(() => parseStrictCron("not cron"), /exactly five fields/);
});

test("repair binding hash is required and immutable", () => {
  const action: any = valid();
  action.desiredAfter.enabled = true;
  assert.throws(() => validateHeartbeatRepairAction(action), /binding hash mismatch/);
});

test("approval readiness accepts only the dedicated bound repair step", () => {
  const action = valid();
  assert.deepEqual(validatePlanApprovalReadiness("agentic-engine.auto-apply", {
    repairAction: action,
    steps: [{ n: 1, tool: "heartbeat_repair" }],
  }), { ok: true });
  assert.equal(validatePlanApprovalReadiness("agentic-engine.auto-apply", {
    steps: [{ n: 1, tool: "delegate_task" }],
  }).ok, false);
});

test("tenant-local adapter changes only enabled and cron fields", { skip: !process.env.DATABASE_URL }, async () => {
  const tenant = 1;
  const otherTenant = 2;
  const inserted: any = await db.execute(sql`
    INSERT INTO heartbeat_tasks
      (name, description, type, cron_expression, enabled, prompt_content, model, tenant_id, approval_status)
    VALUES ('repair-contract-test', 'test', 'general', '*/15 * * * *', true, 'test', 'test', ${tenant}, 'approved')
    RETURNING id
  `);
  const id = Number((inserted.rows ?? inserted)[0].id);
  try {
    const action = createHeartbeatRepairAction({
      taskId: id,
      expectedBefore: { enabled: true, cronExpression: "*/15 * * * *" },
      desiredAfter: { enabled: false, cronExpression: "*/15 * * * *" },
    });
    const result = await executeHeartbeatRepair(tenant, action);
    assert.equal(result.verified, true);
    assert.equal(result.before.enabled, true);
    assert.equal(result.after.enabled, false);
    await assert.rejects(() => executeHeartbeatRepair(otherTenant, action), /not found|tenant/);
    const repeat = await executeHeartbeatRepair(tenant, action);
    assert.equal(repeat.verified, true);
    assert.equal(repeat.after.enabled, false);
  } finally {
    await db.execute(sql`DELETE FROM heartbeat_tasks WHERE id = ${id} AND tenant_id = ${tenant}`);
  }
});

test("supported route is one-card and one-event idempotent", { skip: !process.env.DATABASE_URL }, async () => {
  const tenant = 1;
  const ref = `repair-route-${randomUUID()}`;
  let taskId = 0;
  let insightId = 0;
  try {
    const task: any = await db.execute(sql`
      INSERT INTO heartbeat_tasks
        (name, description, type, cron_expression, enabled, prompt_content, model, tenant_id, approval_status)
      VALUES ('route-repair-test', 'test', 'general', '*/15 * * * *', true, 'test', 'test', ${tenant}, 'approved')
      RETURNING id
    `);
    taskId = Number((task.rows ?? task)[0].id);
    const insight: any = await db.execute(sql`
      INSERT INTO ai_insights
        (tenant_id, engine_type, category, title, summary, priority, status)
      VALUES (${tenant}, 'self_heal', 'workflow_automation', 'Disable failing task', 'test repair',
        'high', 'applied')
      RETURNING id
    `);
    insightId = Number((insight.rows ?? insight)[0].id);
    const candidate = {
      taskId, expectedBefore: { enabled: true, cronExpression: "*/15 * * * *" },
      desiredAfter: { enabled: false, cronExpression: "*/15 * * * *" },
    };
    const first = await routeInsightToMinerva({
      insightId, tenantId: tenant, category: "workflow_automation",
      title: "Disable failing task", summary: "test repair", details: "",
      repairCandidate: candidate,
    });
    assert.equal(first.status, "created");
    const second = await routeInsightToMinerva({
      insightId, tenantId: tenant, category: "workflow_automation",
      title: "Disable failing task", summary: "test repair", details: "",
      repairCandidate: candidate,
    });
    assert.equal(second.status, "reused");
    const plans: any = await db.execute(sql`
      SELECT id FROM plans WHERE tenant_id = ${tenant} AND source = 'agentic-engine.auto-apply'
        AND source_ref = ${String(insightId)}
    `);
    assert.equal((plans.rows ?? plans).length, 1);
    const events: any = await db.execute(sql`
      SELECT count(*)::int AS n FROM event_log
      WHERE tenant_id = ${tenant} AND event_type = 'plan.proposed'
        AND (data->>'planId')::int = ${first.planId}
    `);
    assert.equal(Number((events.rows ?? events)[0].n), 1);
  } finally {
    if (insightId) await db.execute(sql`DELETE FROM plans WHERE tenant_id = ${tenant} AND source_ref = ${String(insightId)}`);
    if (insightId) await db.execute(sql`DELETE FROM ai_insights WHERE tenant_id = ${tenant} AND id = ${insightId}`);
    if (taskId) await db.execute(sql`DELETE FROM heartbeat_tasks WHERE tenant_id = ${tenant} AND id = ${taskId}`);
  }
});

test("concurrent unsafe-cron producers create one insight, card, and event", { skip: !process.env.DATABASE_URL }, async () => {
  const tenant = 1;
  let taskId = 0;
  let validTaskId = 0;
  let otherTenantTaskId = 0;
  const insightIds: number[] = [];
  const planIds: number[] = [];
  const taskName = `concurrent-cron-${randomUUID()}`;
  try {
    const task: any = await db.execute(sql`
      INSERT INTO heartbeat_tasks
        (name, description, type, cron_expression, enabled, prompt_content, model, tenant_id, approval_status)
      VALUES (${taskName}, 'test', 'general', '*/1 * * * *', true, 'test', 'test', ${tenant}, 'approved')
      RETURNING id
    `);
    taskId = Number((task.rows ?? task)[0].id);
    const validTask: any = await db.execute(sql`
      INSERT INTO heartbeat_tasks
        (name, description, type, cron_expression, enabled, prompt_content, model, tenant_id, approval_status)
      VALUES (${`valid-cron-${randomUUID()}`}, 'test', 'general', '*/30 * * * *', true, 'test', 'test', ${tenant}, 'approved')
      RETURNING id
    `);
    validTaskId = Number((validTask.rows ?? validTask)[0].id);
    const otherTenantTask: any = await db.execute(sql`
      INSERT INTO heartbeat_tasks
        (name, description, type, cron_expression, enabled, prompt_content, model, tenant_id, approval_status)
      VALUES (${`other-tenant-cron-${randomUUID()}`}, 'test', 'general', '*/1 * * * *', true, 'test', 'test', ${2}, 'approved')
      RETURNING id
    `);
    otherTenantTaskId = Number((otherTenantTask.rows ?? otherTenantTask)[0].id);
    await Promise.all([
      produceHeartbeatCronRepairInsights(tenant),
      produceHeartbeatCronRepairInsights(tenant),
    ]);

    const insights: any = await db.execute(sql`
      SELECT id FROM ai_insights
      WHERE tenant_id = ${tenant} AND category = 'workflow_automation'
        AND data_snapshot LIKE ${`%"taskId":${taskId},%`}
    `);
    const rows = insights.rows ?? insights;
    assert.equal(rows.length, 1);
    insightIds.push(Number(rows[0].id));
    const validInsights: any = await db.execute(sql`
      SELECT id FROM ai_insights
      WHERE tenant_id = ${tenant} AND data_snapshot LIKE ${`%"taskId":${validTaskId},%`}
    `);
    assert.equal((validInsights.rows ?? validInsights).length, 0);
    const otherTenantInsights: any = await db.execute(sql`
      SELECT id FROM ai_insights
      WHERE tenant_id = ${2} AND data_snapshot LIKE ${`%"taskId":${otherTenantTaskId},%`}
    `);
    assert.equal((otherTenantInsights.rows ?? otherTenantInsights).length, 0);

    const plans: any = await db.execute(sql`
      SELECT id FROM plans
      WHERE tenant_id = ${tenant}
        AND source = 'agentic-engine.auto-apply'
        AND source_ref = ${String(insightIds[0])}
    `);
    const planRows = plans.rows ?? plans;
    assert.equal(planRows.length, 1);
    planIds.push(Number(planRows[0].id));

    const events: any = await db.execute(sql`
      SELECT count(*)::int AS n FROM event_log
      WHERE tenant_id = ${tenant} AND event_type = 'plan.proposed'
        AND (data->>'planId')::int = ${planIds[0]}
    `);
    assert.equal(Number((events.rows ?? events)[0].n), 1);
  } finally {
    for (const planId of planIds) {
      await db.execute(sql`DELETE FROM event_log WHERE tenant_id = ${tenant} AND event_type = 'plan.proposed' AND (data->>'planId')::int = ${planId}`);
      await db.execute(sql`DELETE FROM plans WHERE tenant_id = ${tenant} AND id = ${planId}`);
    }
    for (const insightId of insightIds) {
      await db.execute(sql`DELETE FROM ai_insights WHERE tenant_id = ${tenant} AND id = ${insightId}`);
    }
    if (taskId) await db.execute(sql`DELETE FROM heartbeat_tasks WHERE tenant_id = ${tenant} AND id = ${taskId}`);
    if (validTaskId) await db.execute(sql`DELETE FROM heartbeat_tasks WHERE tenant_id = ${tenant} AND id = ${validTaskId}`);
    if (otherTenantTaskId) await db.execute(sql`DELETE FROM heartbeat_tasks WHERE tenant_id = 2 AND id = ${otherTenantTaskId}`);
  }
});

test("decidePlan atomically binds supported repair approval and rejects hash drift", { skip: !process.env.DATABASE_URL }, async () => {
  const tenant = 1;
  setExecutorKickForTests(() => {});
  let planId = 0;
  try {
    const action = valid();
    const created = await createPlan({
      tenantId: tenant, objective: "test exact heartbeat repair",
      source: "agentic-engine.auto-apply", sourceRef: `approval-${randomUUID()}`,
      repairAction: action,
    });
    planId = created.planId;
    await decidePlan({ planId, decision: "approve", reason: "approve test", actor: "admin:test", tenantId: tenant });
    const row: any = await db.execute(sql`SELECT status, execution_log FROM plans WHERE id = ${planId} AND tenant_id = ${tenant}`);
    const current = (row.rows ?? row)[0];
    assert.equal(current.status, "approved");
    const bindings = current.execution_log.filter((event: any) => event.type === "repair.approval_binding");
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].actionHash, action.bindingHash);
  } finally {
    setExecutorKickForTests(null);
    if (planId) await db.execute(sql`DELETE FROM plans WHERE id = ${planId} AND tenant_id = ${tenant}`);
  }
});

test("executor repair seam requires binding and returns exact evidence", { skip: !process.env.DATABASE_URL }, async () => {
  const inserted: any = await db.execute(sql`
    INSERT INTO heartbeat_tasks
      (name, description, type, cron_expression, enabled, prompt_content, model, tenant_id, approval_status)
    VALUES ('executor-repair-test', 'test', 'general', '*/15 * * * *', true, 'test', 'test', 1, 'approved')
    RETURNING id
  `);
  const taskId = Number((inserted.rows ?? inserted)[0].id);
  try {
    const action = createHeartbeatRepairAction({
      taskId, expectedBefore: { enabled: true, cronExpression: "*/15 * * * *" },
      desiredAfter: { enabled: false, cronExpression: "*/15 * * * *" },
    });
    const binding = {
      type: "repair.approval_binding", stepId: 1, version: action.version, kind: action.kind,
      actionHash: action.bindingHash, actor: "admin:test", at: new Date().toISOString(),
    };
    const plan = {
      id: 901, tenant_id: 1, source: "agentic-engine.auto-apply",
      plan_json: { repairAction: action }, execution_log: [binding],
    };
    const result = await executeHeartbeatRepairStepForTest(plan, { n: 1, agent: "Forge", tool: "heartbeat_repair" });
    assert.equal(result.success, true);
    assert.equal(result.output.verified, true);
    await assert.rejects(
      () => executeHeartbeatRepairStepForTest({ ...plan, execution_log: [] }, { n: 1, agent: "Forge", tool: "heartbeat_repair" }),
      /missing immutable approval binding/,
    );
  } finally {
    await db.execute(sql`DELETE FROM heartbeat_tasks WHERE id = ${taskId} AND tenant_id = 1`);
  }
});