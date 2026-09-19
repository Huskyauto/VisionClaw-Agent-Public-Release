// =============================================================================
// Task 130 — integration test for the model-switch recommendation SQL layer.
//
// Exercises the REAL tenant-scoped queries in server/lib/model-switch-data.ts
// against seeded rows: agent_cost_ledger spend, step_rewards with the
// persisted signals.execModel attribution key, AND a legacy reward row whose
// executing model is only discoverable via the plans.execution_log fallback
// join. Asserts a real positive recommendation, tenant isolation, and the
// empty case. All seeded rows use throwaway sentinel tenants and are cleaned
// up in `after`. server/db's pool has allowExitOnIdle, so no explicit close.
// =============================================================================
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const TENANT_A = 913_001; // gets the seeded data
const TENANT_B = 913_002; // must see NONE of it

let db: any;
let sql: any;
let planId: number;

before(async () => {
  ({ db } = await import("../../server/db"));
  ({ sql } = await import("drizzle-orm"));

  // --- Ledger spend for tenant A -------------------------------------------
  // Workflow "itest_expensive_flow" runs on pricey-model: 2.5M tokens, $25.
  // Candidate cheapo-model has 1M tokens for $1 elsewhere (observed blended
  // rate $1/1M) → projected $2.50 for the flow → ~90% savings.
  await db.execute(sql`
    INSERT INTO agent_cost_ledger (tenant_id, tool_name, model, cost_usd, tokens_in, tokens_out)
    VALUES
      (${TENANT_A}, 'itest_expensive_flow', 'itest/pricey-model', 25.0, 2000000, 500000),
      (${TENANT_A}, 'itest_other_tool',     'itest/cheapo-model',  1.0,  800000, 200000)
  `);

  // --- Quality path 1: rewards carrying the persisted execModel key ---------
  for (let i = 1; i <= 4; i++) {
    await db.execute(sql`
      INSERT INTO step_rewards (tenant_id, step_index, agent, score, rationale, signals, model)
      VALUES (${TENANT_A}, ${i}, 'itest-agent', ${80 - i},
              'itest', ${JSON.stringify({ execModel: "itest/cheapo-model" })}::jsonb, 'heuristic-prm')
    `);
  }

  // --- Quality path 2: legacy rewards attributed via execution_log fallback -
  const planRes: any = await db.execute(sql`
    INSERT INTO plans (tenant_id, objective, status, plan_json, execution_log)
    VALUES (${TENANT_A}, 'itest objective', 'completed', '{}'::jsonb,
            ${JSON.stringify([
              { type: "step.result", step: 1, model: "itest/pricey-model", success: true },
              { type: "step.result", step: 2, model: "itest/pricey-model", success: true },
              { type: "step.result", step: 3, model: "itest/pricey-model", success: true },
            ])}::jsonb)
    RETURNING id
  `);
  planId = Number((planRes.rows || planRes)[0].id);
  for (let i = 1; i <= 3; i++) {
    await db.execute(sql`
      INSERT INTO step_rewards (tenant_id, plan_id, step_index, agent, score, rationale, signals, model)
      VALUES (${TENANT_A}, ${planId}, ${i}, 'itest-agent', ${85 + i}, 'itest', '{}'::jsonb, 'heuristic-prm')
    `);
  }
});

after(async () => {
  await db.execute(sql`DELETE FROM step_rewards WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`);
  await db.execute(sql`DELETE FROM agent_cost_ledger WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`);
  await db.execute(sql`DELETE FROM plans WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`);
});

test("usage query aggregates seeded ledger rows per (workflow, model)", async () => {
  const { fetchWorkflowModelUsage } = await import("../../server/lib/model-switch-data");
  const usage = await fetchWorkflowModelUsage(TENANT_A, 30);
  const flow = usage.find((u: any) => u.workflow === "itest_expensive_flow");
  assert.ok(flow, "expected the seeded expensive flow group");
  assert.equal(flow!.model, "itest/pricey-model");
  assert.equal(flow!.tokensIn, 2_000_000);
  assert.equal(flow!.tokensOut, 500_000);
  assert.ok(Math.abs(flow!.totalCostUsd - 25) < 1e-6);
});

test("quality query attributes via BOTH signals.execModel and the execution_log fallback", async () => {
  const { fetchModelQuality } = await import("../../server/lib/model-switch-data");
  const quality = await fetchModelQuality(TENANT_A, 30);
  const cheapo = quality.find((q: any) => q.model === "itest/cheapo-model");
  const pricey = quality.find((q: any) => q.model === "itest/pricey-model");
  assert.ok(cheapo, "execModel-keyed rewards must surface");
  assert.equal(cheapo!.gradedSteps, 4);
  assert.ok(pricey, "execution_log-fallback rewards must surface");
  assert.equal(pricey!.gradedSteps, 3);
});

test("end-to-end: seeded rows produce a real positive recommendation", async () => {
  const { getModelSwitchRecommendations } = await import("../../server/lib/model-switch-data");
  const recs = await getModelSwitchRecommendations(TENANT_A, 30);
  const rec = recs.find(
    (r: any) => r.workflow === "itest_expensive_flow" && r.toModel === "itest/cheapo-model",
  );
  assert.ok(rec, `expected a pricey→cheapo recommendation, got ${JSON.stringify(recs)}`);
  assert.equal(rec!.fromModel, "itest/pricey-model");
  assert.ok(Math.abs(rec!.projectedCostUsd - 2.5) < 0.01, "projected from OBSERVED $1/1M rate");
  assert.ok(rec!.estSavingsPct > 85 && rec!.estSavingsPct <= 95);
  // Quality delta is observed: cheapo avg ≈77.5 vs pricey avg ≈87 → within −10 tolerance.
  assert.ok(rec!.qualityDelta < 0 && rec!.qualityDelta >= -10);
});

test("tenant isolation: another tenant sees none of the seeded data", async () => {
  const { fetchWorkflowModelUsage, fetchModelQuality, getModelSwitchRecommendations } =
    await import("../../server/lib/model-switch-data");
  const [usage, quality, recs] = await Promise.all([
    fetchWorkflowModelUsage(TENANT_B, 30),
    fetchModelQuality(TENANT_B, 30),
    getModelSwitchRecommendations(TENANT_B, 30),
  ]);
  assert.equal(usage.filter((u: any) => u.workflow.startsWith("itest_")).length, 0);
  assert.equal(quality.filter((q: any) => q.model.startsWith("itest/")).length, 0);
  assert.equal(recs.filter((r: any) => r.workflow.startsWith("itest_")).length, 0);
});
