/**
 * tests/unit/task-force-budget-cap.test.ts
 *
 * Closes the deferred test-coverage gap for `chargeTaskForce`'s fail-closed
 * budget cap (server/agentic/task-forces.ts). The correctness lives in a single
 * atomic conditional UPDATE, so this is a DB-backed test: it pins that a charge
 * commits only within budget, an exact-cap charge is allowed, a breaching charge
 * is REJECTED WITHOUT MUTATING spent_usd (so a caller that ignores the returned
 * flag can never overspend), and budget_usd=0 means unlimited.
 *
 * Run: node --import tsx --test tests/unit/task-force-budget-cap.test.ts
 * Skips automatically when DATABASE_URL is absent.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const HAS_DB = !!process.env.DATABASE_URL;
// A dedicated high tenant id so cleanup can wipe by tenant without touching real data.
const TEST_TENANT = 990001;

let mod: typeof import("../../server/agentic/task-forces");
let db: typeof import("../../server/db").db;
let sql: typeof import("drizzle-orm").sql;
let cappedId: number;
let unlimitedId: number;

before(async () => {
  if (!HAS_DB) return;
  mod = await import("../../server/agentic/task-forces");
  ({ db } = await import("../../server/db"));
  ({ sql } = await import("drizzle-orm"));
  const capped = await mod.createTaskForce({ tenantId: TEST_TENANT, name: "cap-test", mission: "budget cap test", budgetUsd: 10 });
  const unlimited = await mod.createTaskForce({ tenantId: TEST_TENANT, name: "unlim-test", mission: "unlimited budget test", budgetUsd: 0 });
  cappedId = capped.id;
  unlimitedId = unlimited.id;
});

after(async () => {
  if (HAS_DB && db && sql) {
    await db.execute(sql`DELETE FROM task_forces WHERE tenant_id = ${TEST_TENANT}`).catch(() => {});
  }
  // Pool keeps the event loop alive — force a clean exit like the other DB tests.
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
});

test("charge within budget commits", { skip: !HAS_DB }, async () => {
  const r = await mod.chargeTaskForce(TEST_TENANT, cappedId, 4);
  assert.ok(r);
  assert.equal(r!.ok, true);
  assert.equal(r!.overBudget, false);
  assert.equal(r!.spentUsd, 4);
  assert.equal(r!.remainingUsd, 6);
});

test("charge up to the EXACT cap is allowed", { skip: !HAS_DB }, async () => {
  const r = await mod.chargeTaskForce(TEST_TENANT, cappedId, 6); // 4 + 6 == 10
  assert.ok(r);
  assert.equal(r!.ok, true);
  assert.equal(r!.overBudget, false);
  assert.equal(r!.spentUsd, 10);
  assert.equal(r!.remainingUsd, 0);
});

test("a breaching charge is rejected AND does not mutate spent_usd", { skip: !HAS_DB }, async () => {
  const r = await mod.chargeTaskForce(TEST_TENANT, cappedId, 0.01); // would push 10 → 10.01
  assert.ok(r);
  assert.equal(r!.ok, false);
  assert.equal(r!.overBudget, true);
  assert.equal(r!.spentUsd, 10); // pre-charge state reported, no mutation
  // Verify directly against the row that nothing was written.
  const tf = await mod.getTaskForce(TEST_TENANT, cappedId);
  assert.equal(parseFloat(tf.spent_usd), 10);
});

test("budget_usd = 0 means unlimited", { skip: !HAS_DB }, async () => {
  const r = await mod.chargeTaskForce(TEST_TENANT, unlimitedId, 1000);
  assert.ok(r);
  assert.equal(r!.ok, true);
  assert.equal(r!.overBudget, false);
  assert.equal(r!.spentUsd, 1000);
});

test("negative amount throws", { skip: !HAS_DB }, async () => {
  await assert.rejects(() => mod.chargeTaskForce(TEST_TENANT, cappedId, -1));
});

test("non-finite amount throws", { skip: !HAS_DB }, async () => {
  await assert.rejects(() => mod.chargeTaskForce(TEST_TENANT, cappedId, Number.NaN));
});

test("unknown task force returns null", { skip: !HAS_DB }, async () => {
  const r = await mod.chargeTaskForce(TEST_TENANT, 2147480000, 1);
  assert.equal(r, null);
});
