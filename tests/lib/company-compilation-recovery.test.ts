import test from "node:test";
import assert from "node:assert/strict";
import { compilationOperations, newCompilationMatrix, advanceCompilationMatrix } from "../../server/lib/company-compilation-matrix";
import { compilationRecoveryPlan, approveCompilationReplacement } from "../../server/lib/company-compilation-recovery";
import { reservePackageOperation } from "../../server/lib/company-report-production";
import { PgDialect } from "drizzle-orm/pg-core";

function fixture() {
  const matrix = newCompilationMatrix("retained-subject");
  const [gpt, gemini] = compilationOperations();
  matrix.slots[gpt.key] = { phase: "complete", text: "saved GPT", raw: { model: gpt.model } };
  matrix.slots[gemini.key] = { phase: "received", raw: { model: gemini.model,
    choices: [{ finish_reason: "length", message: { content: '{"sections":[incomplete' } }] } };
  matrix.phase = "blocked";
  return { id: 1929, tenant_id: 1, status: "succeeded", payload: { productionVersion: 3,
    tenantId: 1, packageSpend: { [`matrix:${gemini.key}`]: 800_000 },
    state: { phase: "blocked", compilation: matrix } } };
}

test("one explicitly approved truncated Gemini replacement preserves receipts, completed work and original spend", async () => {
  const job = fixture(), before = structuredClone(job), plan = compilationRecoveryPlan(job);
  assert.equal(plan.available, true);
  assert.throws(() => approveCompilationReplacement(job, { snapshot: plan.snapshot }), /approval/);
  assert.deepEqual(job, before);
  assert.throws(() => approveCompilationReplacement(job, { snapshot: "0".repeat(64), replaceTruncatedCompilation: true }), /changed/);
  approveCompilationReplacement(job, { snapshot: plan.snapshot, replaceTruncatedCompilation: true });
  const matrix = job.payload.state.compilation, [gpt, gemini] = compilationOperations();
  assert.deepEqual(matrix.slots[gpt.key], before.payload.state.compilation.slots[gpt.key]);
  assert.deepEqual(job.payload.packageSpend, before.payload.packageSpend);
  assert.deepEqual(matrix.replacements?.[gemini.key].raw, before.payload.state.compilation.slots[gemini.key].raw);
  let paid = 0;
  await advanceCompilationMatrix(matrix, { checkpoint: async () => {},
    request: async op => { paid++; assert.equal(op.key, gemini.key); return { model: op.model, choices: [{ finish_reason: "stop" }] }; },
    accept: () => "replacement" });
  assert.equal(paid, 1);
  assert.equal(matrix.slots[gemini.key].phase, "complete");
  assert.equal(compilationRecoveryPlan(job).available, false);
  assert.throws(() => approveCompilationReplacement(job, { snapshot: plan.snapshot, replaceTruncatedCompilation: true }));
});

test("central reservation refuses unapproved replacements, repeated claims and original-budget exhaustion", async () => {
  for (const index of [1, 2, 9]) {
  const job = fixture(), operations = compilationOperations(), op = operations[index];
  if (index !== 1) {
    const first = compilationRecoveryPlan(job);
    approveCompilationReplacement(job, { ...first, replaceTruncatedCompilation: true });
    for (const prior of operations.slice(0, index))
      job.payload.state.compilation.slots[prior.key] = { phase: "complete", text: "retained", raw: { model: prior.model } };
    job.payload.state.compilation.slots[op.key] = { phase: "received", raw: { model: op.model,
      choices: [{ finish_reason: "length", message: { content: "incomplete" } }] } };
    job.payload.state.compilation.phase = "blocked";
    (job.payload.packageSpend as any)[`matrix:${op.key}`] = 800_000;
  }
  const plan = compilationRecoveryPlan(job);
  assert.equal(plan.available, true, op.key);
  approveCompilationReplacement(job, { snapshot: plan.snapshot, replaceTruncatedCompilation: true });
  const matrix = job.payload.state.compilation, receipt = matrix.replacements![op.key];
  matrix.slots[op.key] = { phase: "claimed" };
  job.payload.state.phase = "drafting";
  const payload: any = { ...job.payload, modelBudgetMicros: 150_000_000, processingWindowStartedAt: new Date().toISOString() };
  const key = `matrix:${op.key}:replacement:${receipt.digest}`, dialect = new PgDialect();
  let writes = 0;
  const db: any = { transaction: async (fn: any) => fn(db), execute: async (query: any) => {
    const q = dialect.sqlToQuery(query);
    if (q.sql.includes("SELECT payload,status,attempts,lease_until")) return { rows: [{
      payload, status: "running", attempts: 1, lease_until: new Date(Date.now() + 60_000),
    }] };
    if (q.sql.includes("UPDATE agent_jobs SET payload=jsonb_set")) {
      writes++; payload.packageSpend = JSON.parse(String(q.params.find(p => typeof p === "string" && p.startsWith("{"))));
      return { rows: [] };
    }
    throw new Error("Unexpected reservation query");
  } };
  const reserve = () => reservePackageOperation(job.id, 1, key, 1, { parentAttempt: 1 }, { db });
  const originalRaw = structuredClone(receipt.raw);
  (receipt.raw as any).choices[0].finish_reason = "stop";
  await assert.rejects(reserve(), /authority/);
  receipt.raw = originalRaw;
  payload.packageSpend["original-other-work"] = 149_000_000;
  await assert.rejects(reserve(), /budget-limited/);
  assert.equal(writes, 0);
  delete payload.packageSpend["original-other-work"];
  await reserve();
  assert.equal(payload.packageSpend[`matrix:${op.key}`], 800_000);
  assert.equal(payload.packageSpend[key], 1_000_000);
  await assert.rejects(reserve(), /already reserved/);
  assert.equal(writes, 1);
  }
});

test("a separate Opus truncation can be approved after the retained Gemini replacement, never twice for one operation", () => {
  const job = fixture(), [, gemini, opus] = compilationOperations();
  const first = compilationRecoveryPlan(job);
  approveCompilationReplacement(job, { ...first, replaceTruncatedCompilation: true });
  const matrix = job.payload.state.compilation;
  matrix.slots[gemini.key] = { phase: "complete", text: "saved replacement", raw: { model: gemini.model } };
  matrix.slots[opus.key] = { phase: "received", raw: { model: opus.model,
    choices: [{ finish_reason: "length", message: { content: "incomplete Opus" } }] } };
  matrix.phase = "blocked";
  const retained = structuredClone(matrix);
  const plan = compilationRecoveryPlan(job);
  assert.equal(plan.available, true);
  assert.equal(plan.operation, opus.key);
  approveCompilationReplacement(job, { ...plan, replaceTruncatedCompilation: true });
  assert.deepEqual(matrix.replacements![gemini.key], retained.replacements![gemini.key]);
  assert.deepEqual(matrix.slots[gemini.key], retained.slots[gemini.key]);
  assert.deepEqual(matrix.replacements![opus.key].raw, retained.slots[opus.key].raw);
  matrix.slots[opus.key] = retained.slots[opus.key];
  matrix.phase = "blocked";
  assert.equal(compilationRecoveryPlan(job).available, false);
});

test("unknown outcomes, wrong tenants/models, stale approvals and a second replacement fail closed", () => {
  for (const mutate of [
    (j: any) => { j.tenant_id = 2; },
    (j: any) => { j.payload.state.compilation.slots[compilationOperations()[1].key].phase = "claimed"; },
    (j: any) => { j.payload.state.compilation.slots[compilationOperations()[1].key].raw.model = "other"; },
    (j: any) => { j.payload.state.compilation.slots[compilationOperations()[1].key].raw.choices[0].finish_reason = "stop"; },
  ]) {
    const job = fixture(); mutate(job);
    assert.equal(compilationRecoveryPlan(job).available, false);
  }
  const job = fixture(), plan = compilationRecoveryPlan(job);
  job.payload.packageSpend["matrix:new" as keyof typeof job.payload.packageSpend] = 1;
  assert.throws(() => approveCompilationReplacement(job, { ...plan, replaceTruncatedCompilation: true }), /changed/);
  const next = compilationRecoveryPlan(job);
  approveCompilationReplacement(job, { ...next, replaceTruncatedCompilation: true });
  const key = compilationOperations()[1].key;
  job.payload.state.phase = "blocked";
  job.payload.state.compilation.phase = "blocked";
  job.payload.state.compilation.slots[key] = structuredClone(fixture().payload.state.compilation.slots[key]);
  assert.equal(compilationRecoveryPlan(job).available, false, "A second truncated result never unlocks another purchase");
});
