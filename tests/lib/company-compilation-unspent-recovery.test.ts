import test from "node:test";
import assert from "node:assert/strict";
import { matchesUnspentCompilationClaim, canReconcileUnspentCompilation } from "../../server/lib/company-compilation-unspent-recovery";
import { compilationReceiptDigest } from "../../server/lib/company-compilation-correction-policy";
import { companyCompilationSubject } from "../../server/lib/company-package-v3";
import { initialPackage } from "../../server/lib/company-report-package-core";
import { COMPANY_HEADINGS } from "../../server/lib/company-compilation-content";

function fixture() {
  const operation = "author:opportunities:claude-opus-5-5";
  const state: any = initialPackage({ company: "Offline", website: "https://example.com" });
  state.phase = "blocked";
  state.research = { complete: true, evidence: { version: 1, capturedAt: "2026-10-21", limitations: [],
    sources: [{ id: "src1", title: "Public source", kind: "public", retrievedAt: "2026-10-21",
      url: "https://example.com", text: "Exact retained public company source.", sha256: "a".repeat(64) }] } };
  const raw = { model: "claude-opus-5-5", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    sections: COMPANY_HEADINGS.opportunities.map(heading => ({ heading, blocks: [
      { type: "fact", text: "Invented quotation.", sourceIds: ["src1"] },
      ...Array.from({ length: 3 }, () => ({ type: "recommendation", sourceIds: [],
        text: "Measure the pilot before expansion. ".repeat(20) })),
    ] })), unknowns: [],
  }) } }] };
  const binding = { jobId: 101, tenantId: 1, operation, subject: companyCompilationSubject(state),
    legacyDigest: "b".repeat(64), canonicalRawDigest: compilationReceiptDigest(raw, 2), check: "SOURCE_EXCERPT_MISMATCH" };
  state.compilation = { version: 1, phase: "blocked", subject: binding.subject, slots: {
    [operation]: { phase: "received", raw, correction: { phase: "claimed", originalDigest: binding.legacyDigest, check: binding.check } },
  } };
  const job: any = { id: 101, tenant_id: 1, status: "succeeded", payload: { tenantId: 1, productionVersion: 3,
    state, modelBudgetMicros: 150_000_000, packageSpend: { [`matrix:${operation}`]: 1_000_000 },
    compilationCorrectionPolicy: { version: 1, maxPerOperation: 1, approvedAt: "2026-10-21" } } };
  return { job, binding, slot: state.compilation.slots[operation] };
}
test("unspent matcher accepts only exact unsent first-correction state; production binding cannot be supplied by a caller", () => {
  const f = fixture();
  assert.equal(matchesUnspentCompilationClaim(f.job, f.binding), true);
  assert.equal(canReconcileUnspentCompilation(f.job), false);
  for (const mutate of [
    (x: any) => x.job.id++,
    (x: any) => x.job.tenant_id = 2,
    (x: any) => x.job.payload.tenantId = 2,
    (x: any) => x.job.status = "running",
    (x: any) => x.job.status = "cancelled",
    (x: any) => x.job.payload.modelBudgetMicros = 151_000_000,
    (x: any) => delete x.job.payload.compilationCorrectionPolicy,
    (x: any) => x.slot.raw.choices[0].message.content += "changed",
    (x: any) => x.slot.correction.originalDigest = "c".repeat(64),
    (x: any) => x.slot.correction.phase = "received",
    (x: any) => x.slot.correction.raw = {},
    (x: any) => x.slot.reconciledUnspentClaim = {},
    (x: any) => x.slot.targetedRepair = {},
    (x: any) => x.job.payload.packageSpend[`matrix:${x.binding.operation}:correction:${"d".repeat(64)}`] = 1,
  ]) {
    const x = fixture(); mutate(x);
    assert.equal(matchesUnspentCompilationClaim(x.job, x.binding), false);
  }
});
