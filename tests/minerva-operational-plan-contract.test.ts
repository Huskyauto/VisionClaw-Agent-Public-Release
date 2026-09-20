import test from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { composeHeuristicPlan, validatePlanApprovalReadiness } from "../server/minerva-planner";
import { decidePlan } from "../server/minerva-planner";

test("auto-routed operational plans delegate real specialist work instead of simulating execution", () => {
  const plan = composeHeuristicPlan({
    objective: "Reduce heartbeat frequency for low-yield reflective tasks",
    source: "agentic-engine.auto-apply",
    tenantId: 1,
  });

  assert.ok(plan.steps.length >= 2);
  assert.equal(plan.steps.some((step) => step.agent === "Forge"), true);
  for (const step of plan.steps) {
    assert.equal(step.tool, "delegate_task");
    assert.equal(step.args?.targetAgent, step.agent);
    assert.equal(step.args?.schedule, "once");
    const substitutedPrompt = String(step.args?.prompt).replace("{{prev}}", "x".repeat(800));
    assert.ok(substitutedPrompt.length <= 2_000);
    assert.equal("_tenantId" in (step.args ?? {}), false);
    assert.equal("_personaId" in (step.args ?? {}), false);
  }
});

test("stale auto-routed operational plans cannot be approved without executable delegated steps", () => {
  const stalePlan = composeHeuristicPlan({
    objective: "Reduce heartbeat frequency for low-yield reflective tasks",
    source: "owner.directive",
    tenantId: 1,
  });

  assert.deepEqual(
    validatePlanApprovalReadiness("agentic-engine.auto-apply", stalePlan),
    {
      ok: false,
      reason: "Operational plan is stale and cannot execute real work. Revise it to generate a fresh executable plan before approval.",
    },
  );
  assert.deepEqual(validatePlanApprovalReadiness("owner.directive", stalePlan), { ok: true });
});

test("the approval boundary leaves a stale operational plan awaiting approval", async () => {
  const stalePlan = composeHeuristicPlan({
    objective: "Approval contract integration test",
    source: "owner.directive",
    tenantId: 1,
  });
  const inserted: any = await db.execute(sql`
    INSERT INTO plans (tenant_id, objective, source, status, plan_json, planner_persona_id, version)
    VALUES (1, 'Approval contract integration test', 'agentic-engine.auto-apply',
            'awaiting_approval', ${JSON.stringify(stalePlan)}::jsonb, 15, 1)
    RETURNING id
  `);
  const planId = Number((inserted.rows ?? inserted)[0].id);

  try {
    await assert.rejects(
      decidePlan({
        planId,
        decision: "approve",
        reason: "Integration test approval",
        actor: "test-actor",
        tenantId: 1,
      }),
      /Operational plan is stale and cannot execute real work/,
    );
    const checked: any = await db.execute(sql`
      SELECT status, ceo_decision FROM plans WHERE id = ${planId} AND tenant_id = 1
    `);
    assert.deepEqual((checked.rows ?? checked)[0], {
      status: "awaiting_approval",
      ceo_decision: null,
    });
  } finally {
    await db.execute(sql`DELETE FROM plans WHERE id = ${planId} AND tenant_id = 1`);
  }
});