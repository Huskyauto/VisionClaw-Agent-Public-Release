import test from "node:test";
import assert from "node:assert/strict";
import { advanceCompilationMatrix, newCompilationMatrix, compilationOperations } from "../../server/lib/company-compilation-matrix";
import { compilationReceiptDigest } from "../../server/lib/company-compilation-correction-policy";
import { initialPackage } from "../../server/lib/company-report-package-core";
import { companyCompilationSubject } from "../../server/lib/company-package-v3";
import { COMPANY_HEADINGS } from "../../server/lib/company-compilation-content";
import { TARGETED_COMPILATION_REPAIR_GRANT, matchesTargetedRepairSource, canApproveTargetedRepair, targetedRepairSpendKey } from "../../server/lib/company-compilation-targeted-repair";
import { reservePackageOperation } from "../../server/lib/company-report-production";
import { PgDialect } from "drizzle-orm/pg-core";

function sourceFixture() {
  const op = compilationOperations()[0], state: any = initialPackage({ company: "Offline", website: "https://example.com" });
  state.phase = "blocked";
  state.research = { complete: true, evidence: { version: 1, sources: [], capturedAt: "2026-10-21", limitations: [] } };
  state.compilation = newCompilationMatrix(companyCompilationSubject(state));
  const response = () => ({ model: op.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    sections: COMPANY_HEADINGS[op.kind].map(heading => ({ heading, blocks: Array.from({ length: 3 }, () => ({
      type: "recommendation", text: "Assign an owner to measure the pilot before expansion. ".repeat(29), sourceIds: [],
    })) })), unknowns: [],
  }) } }] });
  const original = response(), failed = response();
  failed.choices[0].message.content += " ";
  const originalDigest = compilationReceiptDigest(original), failedCorrectionDigest = compilationReceiptDigest(failed);
  state.compilation.slots[op.key] = { phase: "received", raw: original,
    correction: { phase: "received", originalDigest, check: "AUTHOR_SIZE_LIMIT", raw: failed } };
  const grant = { ...TARGETED_COMPILATION_REPAIR_GRANT, subject: state.compilation.subject,
    originalDigest, failedCorrectionDigest };
  const job: any = { id: grant.jobId, tenant_id: 1, status: "succeeded", payload: {
    tenantId: 1, productionVersion: 3, modelBudgetMicros: 150_000_000, state,
    packageSpend: { [`matrix:${op.key}`]: 1_000_000, [`matrix:${op.key}:correction:${originalDigest}`]: 1_000_000 },
    compilationCorrectionPolicy: { version: 1, maxPerOperation: 1, approvedAt: "2026-10-21" },
  } };
  return { job, grant, op };
}

test("targeted authority binds both exact failed receipts, tenant, subject, model, spend and ceiling", () => {
  const f = sourceFixture();
  assert.equal(matchesTargetedRepairSource(f.job, f.grant), true);
  assert.equal(canApproveTargetedRepair(f.job), false, "synthetic grants never authorize production's one-off exception");
  for (const mutate of [
    (j: any) => { j.id++; },
    (j: any) => { j.tenant_id = 2; },
    (j: any) => { j.payload.tenantId = 2; },
    (j: any) => { j.payload.modelBudgetMicros = 200_000_000; },
    (j: any) => { j.payload.state.intake.company = "Changed"; },
    (j: any) => { j.payload.state.compilation.subject = "changed"; },
    (j: any) => { j.payload.state.compilation.slots[f.op.key].raw.model = "wrong"; },
    (j: any) => { j.payload.state.compilation.slots[f.op.key].correction.raw.choices[0].message.content += " "; },
    (j: any) => { j.payload.state.compilation.slots[f.op.key].correction.phase = "claimed"; },
    (j: any) => { j.payload.state.compilation.replacements = { [f.op.key]: {} }; },
    (j: any) => { j.payload.packageSpend = {}; },
    (j: any) => { j.payload.compilationCorrectionPolicy = undefined; },
  ]) {
    const job = structuredClone(f.job); mutate(job);
    assert.equal(matchesTargetedRepairSource(job, f.grant), false);
  }
});

test("central row lock rejects a forged targeted approval even with a live lease and remaining budget", async () => {
  const f = sourceFixture(), dialect = new PgDialect();
  f.job.payload.state.phase = "drafting";
  f.job.payload.processingWindowStartedAt = new Date().toISOString();
  f.job.payload.compilationTargetedRepairApproval = f.grant;
  f.job.payload.state.compilation.slots[f.op.key].targetedRepair = {
    phase: "claimed", originalDigest: f.grant.failedCorrectionDigest, check: "AUTHOR_SIZE_LIMIT",
  };
  let updates = 0;
  const db: any = { transaction: async (fn: any) => fn(db), execute: async (query: any) => {
    const q = dialect.sqlToQuery(query);
    if (q.sql.includes("SELECT payload,status,attempts,lease_until")) return { rows: [{
      payload: f.job.payload, status: "running", attempts: 1, lease_until: new Date(Date.now() + 60_000),
    }] };
    if (q.sql.startsWith("UPDATE")) { updates++; return { rows: [] }; }
    throw new Error("Unexpected query");
  } };
  await assert.rejects(reservePackageOperation(f.job.id, 1, targetedRepairSpendKey(), 1,
    { parentAttempt: 1 }, { db }), /targeted compilation repair.*authority/i);
  assert.equal(updates, 0);
});

test("one separately scoped repair preserves both failed receipts and resumes without repurchasing", async () => {
  const op = compilationOperations()[0], matrix = newCompilationMatrix("offline");
  const raw = { model: op.model, choices: [{ finish_reason: "stop", message: { content: "original" } }] };
  const failed = { model: op.model, choices: [{ finish_reason: "stop", message: { content: "failed correction" } }] };
  const repaired = { model: op.model, choices: [{ finish_reason: "stop", message: { content: "accepted report" } }] };
  matrix.slots[op.key] = { phase: "received", raw,
    correction: { phase: "received", originalDigest: compilationReceiptDigest(raw), check: "AUTHOR_SIZE_LIMIT", raw: failed } };
  let calls = 0;
  const ports: any = {
    checkpoint: async () => {},
    request: async () => { throw new Error("Original must never repurchase"); },
    correct: async () => { throw new Error("Ordinary correction must never repurchase"); },
    accept: (_op: any, response: unknown) => {
      if (response !== repaired) throw new Error("Author compilation exceeds its synthesis input allowance");
      return "accepted report";
    },
    targetedRepair: { operation: op.key, request: async (_op: any, _drafts: any, previous: unknown, check: string) => {
      calls++; assert.equal(previous, failed); assert.equal(check, "AUTHOR_SIZE_LIMIT"); return repaired;
    } },
  };
  await advanceCompilationMatrix(matrix, ports);
  assert.equal(calls, 1);
  assert.equal(matrix.slots[op.key].raw, raw);
  assert.equal(matrix.slots[op.key].correction?.raw, failed);
  assert.equal(matrix.slots[op.key].correction?.phase, "received", "failed correction is never marked accepted");
  assert.equal((matrix.slots[op.key] as any).targetedRepair.phase, "complete");
  assert.equal(matrix.slots[op.key].phase, "complete");
  matrix.slots = { [op.key]: matrix.slots[op.key] };
  matrix.phase = "authors";
  ports.request = async () => { throw new Error("Stop before next original"); };
  await assert.rejects(advanceCompilationMatrix(matrix, ports));
  assert.equal(calls, 1);
});

test("failed, uncertain, and unpersisted targeted repairs never buy another attempt on restart", async () => {
  for (const mode of ["invalid", "timeout", "checkpoint", "other-operation"] as const) {
    const op = compilationOperations()[0], matrix = newCompilationMatrix("offline");
    const raw = { model: op.model, choices: [{ finish_reason: "stop", message: { content: "invalid" } }] };
    matrix.slots[op.key] = { phase: "received", raw, correction: {
      phase: "received", originalDigest: compilationReceiptDigest(raw), check: "AUTHOR_SIZE_LIMIT", raw,
    } };
    let calls = 0, checkpoints = 0;
    const ports: any = {
      checkpoint: async () => { if (mode === "checkpoint" && ++checkpoints === 2) throw new Error("Checkpoint unavailable"); },
      request: async () => { throw new Error("No original purchase"); },
      accept: () => { throw new Error("Author compilation exceeds its synthesis input allowance"); },
      targetedRepair: { operation: mode === "other-operation" ? compilationOperations()[1].key : op.key,
        request: async () => { calls++; if (mode === "timeout") throw new Error("Ambiguous timeout"); return raw; } },
    };
    await assert.rejects(advanceCompilationMatrix(matrix, ports));
    assert.equal(calls, mode === "other-operation" ? 0 : 1);
    const restored = JSON.parse(JSON.stringify(matrix));
    restored.phase = "authors";
    await assert.rejects(advanceCompilationMatrix(restored, ports));
    assert.equal(calls, mode === "other-operation" ? 0 : 1, mode);
  }
});
