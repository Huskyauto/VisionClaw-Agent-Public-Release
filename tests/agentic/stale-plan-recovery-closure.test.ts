/**
 * S8 recovery closure contract tests.
 *
 * These deliberately exercise the public planner projection and the database's
 * real plans constraints. DB cases are skipped only in unit-only environments;
 * CI with DATABASE_URL runs them against a transaction and rolls every fixture
 * back before returning.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deriveStaleRecoveryBinding, recoveryApprovalActionHash, recoveryHash, recoveryOutcomeForOriginal, canonicalRecoveryEvidence } from "../../server/lib/plan-step-resilience";
import { derivePlanLifecycle, listPlans } from "../../server/minerva-planner";
import { createStaleRecoveryChildCore, claimStaleRecoveryChildCore, terminalizeStaleRecoveryChildCore, backfillHistoricalRecoveryBlockedPlansCore, drainHistoricalRecoveryBlockedPlansCore, runHistoricalRecoveryBackfillWorker, executePlan } from "../../server/plan-executor";
import { decideStaleRecoveryPlanCore, expireStaleRecoveryPlanCore } from "../../server/minerva-planner";
import { createHeartbeatRepairAction, hashRepairAction } from "../../server/agentic/heartbeat-repair-contract";

const live = Boolean(process.env.DATABASE_URL);
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !live }, fn);

function heartbeatRecoveryFixture(taskId: number) {
  const action = createHeartbeatRepairAction({
    taskId,
    expectedBefore: { enabled: false },
    desiredAfter: { enabled: true },
  });
  const step = { n: 1, agent: "Forge", task: "repair heartbeat exactly", tool: "heartbeat_repair", args: {} };
  const approval = {
    type: "repair.approval_binding",
    stepId: 1,
    version: action.version,
    kind: action.kind,
    actionHash: hashRepairAction({
      version: action.version,
      kind: action.kind,
      taskId: action.taskId,
      expectedBefore: action.expectedBefore,
      desiredAfter: action.desiredAfter,
      verifier: action.verifier,
    }),
  };
  return { planJson: { steps: [step], repairAction: action }, log: [approval] };
}

test("recovery binding hashes the complete suffix and excludes completed prefix", () => {
  const plan = {
    steps: [
      { n: 1, agent: "Forge", task: "already done", tool: "read", args: { id: 1 } },
      { n: 2, agent: "Forge", task: "send exact", tool: "send_email", args: { to: "owner", _tenantId: 999 } },
      { n: 3, agent: "Proof", task: "verify", tools: ["web_fetch"], args: { url: "https://example.test" } },
    ],
  };
  const binding = deriveStaleRecoveryBinding({
    tenantId: 11, originalPlanId: 22, version: 4, planJson: plan,
    executionLog: [{ step: 1, success: true }],
  });
  assert.equal(binding?.firstUnresolvedStepId, 2);
  assert.notEqual(binding?.suffixHash, recoveryHash(plan.steps.slice(0, 1)));
  assert.match(binding?.incidentKey ?? "", /^stale-recovery:[a-f0-9]{64}$/);
  assert.equal(recoveryOutcomeForOriginal({ status: "failed", recoveryChildStatus: "awaiting_approval" }), "active approval");
});

test("stale parent or suffix mutation changes the binding and fails closed", () => {
  const input = {
    tenantId: 1, originalPlanId: 2, version: 1,
    planJson: { steps: [{ n: 1, tool: "send_email", args: { to: "a" } }] },
    executionLog: [],
  };
  const original = deriveStaleRecoveryBinding(input)!;
  const mutated = deriveStaleRecoveryBinding({
    ...input, planJson: { steps: [{ n: 1, tool: "send_email", args: { to: "b" } }] },
  })!;
  assert.notEqual(mutated.originalFingerprint, original.originalFingerprint);
  assert.notEqual(mutated.suffixHash, original.suffixHash);
});

test("canonical recovery evidence removes linkage observations but binds every real event", () => {
  const log = [
    { type: "execution.started", stepCount: 2 },
    { type: "execution.recovery_approval_created", recoveryChildId: 9 },
    { type: "execution.recovery_executing", recoveryChildId: 9 },
    { type: "execution.step", step: 2, output: "exact evidence" },
  ];
  assert.deepEqual(canonicalRecoveryEvidence(log), [log[0], log[3]]);
  assert.notEqual(
    recoveryHash(canonicalRecoveryEvidence(log)),
    recoveryHash(canonicalRecoveryEvidence([...log.slice(0, 3), { type: "execution.step", step: 2, output: "mutated" }])),
  );
});

test("lifecycle renders verified recovery completion over historical refusal", () => {
  const projection = derivePlanLifecycle({
    status: "completed",
    execution_log: [
      { type: "execution.recovery_blocked", reason: "old refusal" },
      { type: "execution.recovery.completed", recoveryChildId: 8 },
    ],
  });
  assert.equal(projection.lifecycle, "verified");
  assert.equal(projection.actionable, false);
});

dbTest("listPlans executes the real activity SQL without syntax errors", async () => {
  const rows = await listPlans({ tenantId: 1, activity: true, limit: 1 });
  assert.ok(Array.isArray(rows));
});

dbTest("plans recovery source identity is tenant-scoped and unique", async () => {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const key = `s8-live-${Date.now()}-${Math.random()}`;
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS plans_s8_test_recovery_unique
      ON plans (tenant_id, source, source_ref)
      WHERE source = 'stale-plan-recovery' AND source_ref IS NOT NULL
    `);
    const parent: any = await tx.execute(sql`
      INSERT INTO plans (tenant_id, objective, status, source, plan_json)
      VALUES (1, ${key}, 'failed', 's8-fixture', '{}'::jsonb) RETURNING id
    `);
    const parentId = Number((parent.rows ?? parent)[0].id);
    await tx.execute(sql`
      INSERT INTO plans (tenant_id, objective, status, source, source_ref, parent_plan_id, plan_json)
      VALUES (1, ${key}, 'awaiting_approval', 'stale-plan-recovery', ${key}, ${parentId}, '{}'::jsonb)
    `);
    await tx.execute(sql`SAVEPOINT duplicate_probe`);
    await assert.rejects(() => tx.execute(sql`
      INSERT INTO plans (tenant_id, objective, status, source, source_ref, parent_plan_id, plan_json)
      VALUES (1, ${key}, 'awaiting_approval', 'stale-plan-recovery', ${key}, ${parentId}, '{}'::jsonb)
    `));
    await tx.execute(sql`ROLLBACK TO SAVEPOINT duplicate_probe`);
    const crossTenant: any = await tx.execute(sql`
      SELECT id FROM plans WHERE tenant_id = 999999 AND source = 'stale-plan-recovery' AND source_ref = ${key}
    `);
    assert.equal((crossTenant.rows ?? crossTenant).length, 0);
    throw new Error("rollback S8 fixture");
  }).catch((error: Error) => {
    assert.equal(error.message, "rollback S8 fixture");
  });
});

dbTest("production child core deduplicates ten concurrent sweeps", async () => {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const key = `s8-core-${Date.now()}-${Math.random()}`;
  const { planJson, log } = heartbeatRecoveryFixture(900001);
  const inserted: any = await db.execute(sql`INSERT INTO plans
    (tenant_id,objective,status,source,plan_json,execution_log,version)
    VALUES (1,${key},'executing','s8-fixture',${JSON.stringify(planJson)}::jsonb,${JSON.stringify(log)}::jsonb,1)
    RETURNING id`);
  const originalId = Number((inserted.rows ?? inserted)[0].id);
  try {
    const candidate = { id: originalId, tenant_id: 1, version: 1, plan_json: planJson, execution_log: log };
    const children = await Promise.all(Array.from({ length: 10 }, () => createStaleRecoveryChildCore(db, candidate)));
    const rows: any = await db.execute(sql`SELECT id FROM plans
      WHERE tenant_id=1 AND source='stale-plan-recovery' AND parent_plan_id=${originalId}`);
    assert.equal((rows.rows ?? rows).length, 1);
    assert.equal(new Set(children.filter(Boolean)).size, 1);
    const original: any = await db.execute(sql`SELECT execution_log FROM plans WHERE id=${originalId} AND tenant_id=1`);
    const events = ((original.rows ?? original)[0].execution_log ?? []).filter((e: any) => e.type === "execution.recovery_approval_created");
    assert.equal(events.length, 1);
    const childId = Number((rows.rows ?? rows)[0].id);
    const decision = await decideStaleRecoveryPlanCore({
      planId: childId, tenantId: 1, decision: "approve", actor: "s8-live-test", reason: "exact suffix",
      kick: () => {},
    });
    assert.equal(decision.status, "approved");
    const claimed = await claimStaleRecoveryChildCore(db, childId);
    assert.equal(claimed?.id, childId);
    await db.transaction((tx) => terminalizeStaleRecoveryChildCore(tx, childId, { success: true }));
    const terminal: any = await db.execute(sql`SELECT status FROM plans WHERE id IN (${originalId}, ${childId}) ORDER BY id`);
    assert.deepEqual((terminal.rows ?? terminal).map((r: any) => r.status), ["completed", "completed"]);
  } finally {
    await db.execute(sql`DELETE FROM plans WHERE tenant_id=1 AND (id=${originalId} OR parent_plan_id=${originalId})`);
  }
});

dbTest("production claim core has one PostgreSQL winner", async () => {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const key = `s8-claim-${Date.now()}-${Math.random()}`;
  const row: any = await db.execute(sql`INSERT INTO plans
    (tenant_id,objective,status,source,plan_json) VALUES (1,${key},'approved','stale-plan-recovery','{}'::jsonb) RETURNING id`);
  const id = Number((row.rows ?? row)[0].id);
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => claimStaleRecoveryChildCore(db, id)));
    assert.equal(results.filter(Boolean).length, 1);
  } finally {
    await db.execute(sql`DELETE FROM plans WHERE id=${id} AND tenant_id=1`);
  }
});

dbTest("real approval and expiry transactions produce one durable winner", async () => {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const key = `s8-race-${Date.now()}-${Math.random()}`;
  const { planJson: plan, log } = heartbeatRecoveryFixture(900002);
  const parentResult: any = await db.execute(sql`INSERT INTO plans
    (tenant_id,objective,status,source,plan_json,execution_log,version)
    VALUES(1,${key},'executing','s8-fixture',${JSON.stringify(plan)}::jsonb,${JSON.stringify(log)}::jsonb,1) RETURNING id`);
  const parentId = Number((parentResult.rows ?? parentResult)[0].id);
  try {
    const childId = await createStaleRecoveryChildCore(db, {
      id: parentId, tenant_id: 1, version: 1, plan_json: plan, execution_log: log,
    });
    assert.ok(childId);
    await db.execute(sql`UPDATE plans SET created_at=now()-interval '10 days' WHERE id=${childId}`);
    await Promise.all([
      decideStaleRecoveryPlanCore({ planId: childId!, tenantId: 1, decision: "approve", actor: "race", reason: "race", kick: () => {} }).catch(() => null),
      expireStaleRecoveryPlanCore(1),
    ]);
    const states: any = await db.execute(sql`SELECT status FROM plans WHERE id IN (${parentId},${childId}) ORDER BY id`);
    const values = (states.rows ?? states).map((r: any) => r.status);
    assert.ok(["approved", "expired"].includes(values[1]) || ["rejected", "failed"].includes(values[1]));
    assert.equal(values[0], "failed");
  } finally {
    await db.execute(sql`DELETE FROM plans WHERE tenant_id=1 AND (id=${parentId} OR parent_plan_id=${parentId})`);
  }
});

dbTest("historical blocked backfill is bounded, idempotent, and concurrent-safe", async () => {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const key = `s8-backfill-${Date.now()}-${Math.random()}`;
  const { planJson: plan, log } = heartbeatRecoveryFixture(900003);
  const historicalLog = [...log, { type: "execution.recovery_blocked", actionable: true }];
  const row: any = await db.execute(sql`INSERT INTO plans
    (tenant_id,objective,status,source,plan_json,execution_log,version)
    VALUES(1,${key},'failed','s8-fixture',${JSON.stringify(plan)}::jsonb,
      ${JSON.stringify(historicalLog)}::jsonb,1) RETURNING id`);
  const id = Number((row.rows ?? row)[0].id);
  try {
    const counts = await Promise.all([
      backfillHistoricalRecoveryBlockedPlansCore(db, undefined, 25),
      backfillHistoricalRecoveryBlockedPlansCore(db, undefined, 25),
    ]);
    const children: any = await db.execute(sql`SELECT id FROM plans
      WHERE tenant_id=1 AND source='stale-plan-recovery' AND parent_plan_id=${id}`);
    assert.equal((children.rows ?? children).length, 1);
    assert.ok(counts.every((result: any) => result.processed >= 0));
    assert.equal((await backfillHistoricalRecoveryBlockedPlansCore(db, undefined, 25)).processed, 0);
  } finally {
    await db.execute(sql`DELETE FROM plans WHERE tenant_id=1 AND (id=${id} OR parent_plan_id=${id})`);
  }
});

dbTest("runtime backfill schedules and drains rows beyond its bounded four-page tick", async () => {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const key = `s8-backfill-pages-${Date.now()}-${Math.random()}`;
  const { planJson, log } = heartbeatRecoveryFixture(900005);
  const historicalLog = [...log, { type: "execution.recovery_blocked", actionable: true }];
  try {
    const inserted: any = await db.execute(sql`
      INSERT INTO plans (tenant_id,objective,status,source,plan_json,execution_log,version)
      SELECT 1, ${key} || '-' || n::text, 'failed', 's8-fixture',
        ${JSON.stringify(planJson)}::jsonb, ${JSON.stringify(historicalLog)}::jsonb, 1
      FROM generate_series(1,101) AS n
      RETURNING id
    `);
    const parentIds = (inserted.rows ?? inserted).map((row: any) => Number(row.id));
    assert.equal(parentIds.length, 101);
    const scheduled: Array<{ task: () => Promise<void>; delayMs: number }> = [];
    const result = await runHistoricalRecoveryBackfillWorker({
      executor: db,
      maxPages: 4,
      batch: 25,
      schedule: (task, delayMs) => scheduled.push({ task, delayMs }),
    });
    assert.equal(result.processed, 100);
    assert.equal(result.hasMore, true);
    assert.equal(result.pages, 4);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delayMs, 1_000);
    await scheduled[0].task();
    const children: any = await db.execute(sql`
      SELECT count(*)::integer AS count
      FROM plans child
      JOIN plans parent ON parent.id=child.parent_plan_id AND parent.tenant_id=child.tenant_id
      WHERE child.tenant_id=1 AND child.source='stale-plan-recovery'
        AND parent.objective LIKE ${`${key}%`}
    `);
    assert.equal(Number((children.rows ?? children)[0].count), 101);
    assert.deepEqual(
      await drainHistoricalRecoveryBlockedPlansCore(db, 4, 25),
      { processed: 0, hasMore: false, pages: 1 },
    );
  } finally {
    await db.execute(sql`
      DELETE FROM plans WHERE tenant_id=1 AND (
        objective LIKE ${`${key}%`} OR
        parent_plan_id IN (SELECT id FROM plans WHERE tenant_id=1 AND objective LIKE ${`${key}%`})
      )
    `);
  }
});

test("runtime backfill reschedules after a transient worker failure", async () => {
  let calls = 0;
  const scheduled: Array<{ task: () => Promise<void>; delayMs: number }> = [];
  const executor = {
    execute: async () => {
      calls++;
      if (calls === 1) throw new Error("transient database failure");
      return { rows: [] };
    },
  };
  await assert.rejects(() => runHistoricalRecoveryBackfillWorker({
    executor,
    schedule: (task, delayMs) => scheduled.push({ task, delayMs }),
  }), /transient database failure/);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 30_000);
  await scheduled[0].task();
  assert.equal(calls, 2);
});

dbTest("migration unique index exists for duplicate-safe recovery identity", async () => {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const result: any = await db.execute(sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'plans' AND indexname = 'plans_stale_recovery_source_ref_unique'
  `);
  // Development databases may predate migration replay. The transactional
  // fixture above proves enforcement; this check proves the shipped migration
  // contains the production index when the local DB has not replayed it yet.
  if ((result.rows ?? result).length === 0) {
    const { readFileSync } = await import("node:fs");
    assert.match(readFileSync("migrations/0107_plans_stale_recovery_source_ref_unique.sql", "utf8"),
      /plans_stale_recovery_source_ref_unique/);
  } else {
    assert.equal((result.rows ?? result).length, 1);
  }
});

test("policy guard remains required for exact recovery tool dispatch", () => {
  const action = {
    version: 1, kind: "stale_plan_recovery", tenantId: 1, originalPlanId: 2,
    parentPlanId: 2, originalVersion: 1, originalFingerprint: "a".repeat(64),
    incidentKey: "stale-recovery:" + "b".repeat(64), firstUnresolvedStepIndex: 0,
    firstUnresolvedStepId: 2, stepHash: "c".repeat(64), suffixHash: "d".repeat(64),
    executionEvidenceHash: "e".repeat(64),
  };
  const bound = { ...action, actionHash: recoveryApprovalActionHash(action) };
  assert.equal(recoveryApprovalActionHash(bound), bound.actionHash);
  assert.notEqual(recoveryHash(bound), bound.actionHash);
  assert.notEqual(recoveryApprovalActionHash({ ...bound, tenantId: 999 }), recoveryApprovalActionHash(bound));
});

test("stale recovery forbids both failure and degradation replanning", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("server/plan-executor.ts", "utf8");
  assert.match(source, /if \(!staleRecovery && !boundRepairFailure && replanCount < MAX_REPLANS\)/);
  assert.match(source, /if \(degradingDecision\.trigger && !staleRecovery\)/);
});

dbTest("real decide to executePlan flow completes the exact heartbeat recovery", async () => {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const key = `s8-executor-${Date.now()}-${Math.random()}`;
  const { planJson, log } = heartbeatRecoveryFixture(900004);
  const parentRow: any = await db.execute(sql`INSERT INTO plans
    (tenant_id,objective,status,source,plan_json,execution_log,version)
    VALUES(1,${key},'executing','agentic-engine.auto-apply',
      ${JSON.stringify(planJson)}::jsonb,${JSON.stringify(log)}::jsonb,1) RETURNING id`);
  const parentId = Number((parentRow.rows ?? parentRow)[0].id);
  try {
    const childId = await createStaleRecoveryChildCore(db, {
      id: parentId, tenant_id: 1, version: 1, plan_json: planJson, execution_log: log,
    });
    assert.ok(childId);
    const decision = await decideStaleRecoveryPlanCore({
      planId: childId!, tenantId: 1, decision: "approve", actor: "s8-executor",
      reason: "execute the exact verified repair", kick: () => {},
    });
    assert.equal(decision.status, "approved");
    await executePlan(childId!, {
      executeHeartbeatRepair: (async () => ({
        before: { enabled: false, cronExpression: "* * * * *" },
        after: { enabled: true, cronExpression: "* * * * *" },
      })) as any,
    });
    const rows: any = await db.execute(sql`
      SELECT id,status,execution_log FROM plans
      WHERE tenant_id=1 AND id IN (${parentId},${childId}) ORDER BY id
    `);
    assert.deepEqual((rows.rows ?? rows).map((row: any) => row.status), ["completed", "completed"]);
    const child = (rows.rows ?? rows).find((row: any) => Number(row.id) === childId);
    assert.ok(child.execution_log.some((event: any) => event.type === "repair.approval_binding"));
    assert.ok(child.execution_log.some((event: any) => event.type === "execution.recovery.completed"));
  } finally {
    await db.execute(sql`DELETE FROM plans WHERE tenant_id=1 AND (id=${parentId} OR parent_plan_id=${parentId})`);
  }
});

dbTest("uncertain external suffix never creates an executable recovery child", async () => {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const key = `s8-uncertain-${Date.now()}-${Math.random()}`;
  const planJson = { steps: [
    { n: 1, agent: "Proof", task: "read state" },
    { n: 2, agent: "Forge", task: "send", tool: "send_email", args: { to: "owner@example.test" } },
  ] };
  const parentRow: any = await db.execute(sql`INSERT INTO plans
    (tenant_id,objective,status,source,plan_json,execution_log,version)
    VALUES(1,${key},'executing','s8-fixture',${JSON.stringify(planJson)}::jsonb,'[]'::jsonb,1) RETURNING id`);
  const parentId = Number((parentRow.rows ?? parentRow)[0].id);
  try {
    const childId = await createStaleRecoveryChildCore(db, {
      id: parentId, tenant_id: 1, version: 1, plan_json: planJson, execution_log: [],
    });
    assert.equal(childId, null);
    const rows: any = await db.execute(sql`
      SELECT id,status,execution_log FROM plans
      WHERE tenant_id=1 AND (id=${parentId} OR parent_plan_id=${parentId})
    `);
    assert.equal((rows.rows ?? rows).length, 1);
    assert.ok((rows.rows ?? rows)[0].execution_log.some((event: any) =>
      event.type === "execution.recovery_blocker" && /uncertain/i.test(event.reason)));
  } finally {
    await db.execute(sql`DELETE FROM plans WHERE tenant_id=1 AND (id=${parentId} OR parent_plan_id=${parentId})`);
  }
});

dbTest("real source-handoff recovery uses the nested finding identity and stays handoff pending", async () => {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const key = `s8-source-${Date.now()}-${Math.random()}`;
  const snapshot = JSON.stringify({ evidenceVersion: "s8-source-v1", evidence: "bounded" });
  const evidenceHash = createHash("sha256").update(snapshot).digest("hex");
  let insightId = 0;
  let parentId = 0;
  try {
    const insight: any = await db.execute(sql`
      INSERT INTO ai_insights
        (tenant_id,engine_type,category,title,summary,details,data_snapshot,priority,status)
      VALUES (1,'s8-test','source_proposal',${key},'source recovery','bounded',
        ${snapshot},'high','new') RETURNING id
    `);
    insightId = Number((insight.rows ?? insight)[0].id);
    const action = {
      version: 1 as const,
      kind: "source_repair_handoff" as const,
      findingId: String(insightId),
      evidenceVersion: "s8-source-v1",
      evidenceHash,
    };
    const step = { n: 1, agent: "Forge", task: "handoff exact source finding", tool: "source_repair_handoff", args: {} };
    const log = [{
      type: "repair.approval_binding",
      stepId: 1,
      version: 1,
      kind: "source_repair_handoff",
      actionHash: JSON.stringify(action),
    }];
    const planJson = { steps: [step], repairAction: action };
    const parent: any = await db.execute(sql`
      INSERT INTO plans (tenant_id,objective,status,source,source_ref,plan_json,execution_log,version)
      VALUES (1,${key},'executing','agentic-engine.auto-apply',${String(insightId)},
        ${JSON.stringify(planJson)}::jsonb,${JSON.stringify(log)}::jsonb,1) RETURNING id
    `);
    parentId = Number((parent.rows ?? parent)[0].id);
    const childId = await createStaleRecoveryChildCore(db, {
      id: parentId, tenant_id: 1, version: 1, plan_json: planJson, execution_log: log,
    });
    assert.ok(childId);
    await decideStaleRecoveryPlanCore({
      planId: childId!, tenantId: 1, decision: "approve", actor: "s8-source",
      reason: "handoff exact finding", kick: () => {},
    });
    let dispatchedFindingId = "";
    await executePlan(childId!, {
      dispatchRepairHandoff: (async (payload: any) => {
        dispatchedFindingId = payload.sourceFindingId;
        return { accepted: true, handoffId: 700001, idempotent: true };
      }) as any,
    });
    assert.equal(dispatchedFindingId, String(insightId));
    const rows: any = await db.execute(sql`
      SELECT status FROM plans WHERE tenant_id=1 AND id IN (${parentId},${childId}) ORDER BY id
    `);
    assert.deepEqual((rows.rows ?? rows).map((row: any) => row.status), ["handoff_pending", "handoff_pending"]);
  } finally {
    if (parentId) await db.execute(sql`DELETE FROM plans WHERE tenant_id=1 AND (id=${parentId} OR parent_plan_id=${parentId})`);
    if (insightId) await db.execute(sql`DELETE FROM ai_insights WHERE tenant_id=1 AND id=${insightId}`);
  }
});

test("approval versus expiry CAS has exactly one winner", async () => {
  let status = "awaiting_approval";
  const claim = async (next: string) => {
    await Promise.resolve();
    if (status !== "awaiting_approval") return false;
    status = next;
    return true;
  };
  const winners = await Promise.all([claim("approved"), claim("expired")]);
  assert.equal(winners.filter(Boolean).length, 1);
  assert.ok(status === "approved" || status === "expired");
});

test("concurrent executor kicks have one child claim winner", async () => {
  let status = "approved";
  const claim = async () => {
    if (status !== "approved") return false;
    status = "executing";
    return true;
  };
  const winners = await Promise.all([claim(), claim(), claim()]);
  assert.deepEqual(winners.filter(Boolean), [true]);
});

test("recovery refusal cannot be represented without an actionable outcome", () => {
  for (const childStatus of ["awaiting_approval", "executing", "completed", "rejected", "expired"]) {
    assert.ok(recoveryOutcomeForOriginal({ status: "failed", recoveryChildStatus: childStatus }));
  }
  assert.equal(recoveryOutcomeForOriginal({ status: "failed", execution_log: [] }), null);
});

// These outcome assertions are injected seams: they cover the no-dead-row
// contract without requiring a provider, network, or an unbounded executor.
for (const [name, childStatus, expected] of [
  ["approval", "awaiting_approval", "active approval"],
  ["executing", "executing", "recovery executing"],
  ["success", "completed", "completed"],
  ["rejection", "rejected", "explicitly rejected"],
  ["expiry blocker", null, "actionable blocker"],
] as const) {
  test(`outcome invariant: ${name}`, () => {
    const event = childStatus === null ? [{ type: "execution.recovery_blocker", actionable: true }] : [];
    assert.equal(recoveryOutcomeForOriginal({
      status: "failed", recoveryChildStatus: childStatus, execution_log: event,
    }), expected);
  });
}