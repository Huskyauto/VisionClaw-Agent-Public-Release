import test from "node:test";
import assert from "node:assert/strict";
import { retainedCompanyReviewFixture } from "../helpers/retained-company-review";
import { approvePackageRepair, packageRepairPlan } from "../../server/lib/company-package-repair";
import { runPaidReportJury } from "../../server/lib/business-report-paid-jury";
import { hashReportBytes } from "../../server/lib/business-report-evidence";
import { buildReportJurySnapshot } from "../../server/lib/business-report-review";

function fixture() {
  const { parent } = retainedCompanyReviewFixture();
  const children = ["readiness", "executive", "opportunities"].map((kind, index) => {
    const { child, phase } = retainedCompanyReviewFixture();
    child.id = index + 7;
    child.payload.input.orderId = `company-package:50:${kind}`;
    child.payload.input.kind = kind === "readiness" ? "readiness" : "executive";
    const digest = hashReportBytes(buildReportJurySnapshot({ input: child.payload.input,
      state: { ...child.payload.state, correctionChecklist: [] } }, true));
    for (const seat of child.payload.paidJuryRuns[phase].proposers) {
      seat.evidence.receipts[0].sha256 = digest;
      seat.evidence.receipts[0].reportInspection.jobId = child.id;
      seat.evidence.receipts[0].reportInspection.reportSha256 = digest;
      parent.payload.packageSpend[`review:${child.id}:${phase}:${seat.modelId}`] = 100_000;
    }
    parent.payload.state.reports[kind] = { jobId: child.id, status: "error" };
    if (kind === "opportunities") {
      const bad = child.payload.paidJuryRuns[phase].proposers[2];
      bad.finishReason = "length"; bad.reportedTokensOut = 4096; bad.answer = '{"incomplete":';
      child.payload.state.stopReason = "Report initial jury blocked: invalid ballot";
      child.payload.state.juryHistory[0].verdict = "ESCALATE";
    }
    return child;
  });
  // Remove the first helper's separate executive phase claims.
  const validKeys = new Set(children.flatMap(c => Object.keys(c.payload.paidJuryRuns).flatMap(phase =>
    c.payload.paidJuryRuns[phase].proposers.map((s: any) => `review:${c.id}:${phase}:${s.modelId}`))));
  for (const key of Object.keys(parent.payload.packageSpend))
    if (key.startsWith("review:") && !validKeys.has(key)) delete parent.payload.packageSpend[key];
  return { parent, children };
}

test("repair preserves paid histories and identities, renews authority and targets only truncated seat", () => {
  const { parent, children } = fixture(), before = structuredClone({ parent, children });
  const plan = packageRepairPlan(parent, children);
  assert.deepEqual(plan.reasons, []);
  assert.equal(plan.available, true);
  const fixed = approvePackageRepair(parent, children, { snapshot: plan.snapshot, modelBudgetUsd: 150, confirmAdditionalPaidWork: true });
  assert.deepEqual({ parent, children }, before);
  assert.deepEqual(fixed.payload.packageSpend, parent.payload.packageSpend);
  assert.equal(fixed.payload.modelBudgetMicros, 150_000_000);
  assert.equal(fixed.children.filter(c => c.payload.state.phase === "wait_muse").length, 2);
  const replacement = fixed.children.find(c => c.payload.state.phase === "initial_jury")!;
  assert.deepEqual(replacement.payload.jurySeatRecovery.allowedModels, ["claude-opus-5-5"]);
  for (let i = 0; i < children.length; i++) {
    assert.deepEqual(fixed.children[i].payload.paidJuryRuns, children[i].payload.paidJuryRuns);
    assert.equal(fixed.children[i].payload.state.digest, children[i].payload.state.digest);
  }
  assert.equal(packageRepairPlan(parent, children, 30).available, false);
  assert.throws(() => approvePackageRepair(parent, children, { snapshot: "changed", modelBudgetUsd: 150, confirmAdditionalPaidWork: true }), /approval/);
  children[2].payload.paidJuryRuns[Object.keys(children[2].payload.paidJuryRuns)[0]].proposers[0].evidence.receipts[0].sha256 = "changed";
  assert.equal(packageRepairPlan(parent, children).available, false);
});

test("paid recovery dispatches only the missing seat and preserves the two owned ballots exactly", async () => {
  const { parent, children } = fixture();
  const plan = packageRepairPlan(parent, children);
  const fixed = approvePackageRepair(parent, children, { snapshot: plan.snapshot, modelBudgetUsd: 150, confirmAdditionalPaidWork: true });
  const child = fixed.children.find(c => c.payload.jurySeatRecovery)!;
  const grant = child.payload.jurySeatRecovery;
  const retained = child.payload.paidJuryRuns[grant.sourceRunKey].proposers.slice(0, 2);
  const calls: string[] = [], reads: string[] = [];
  const result = await runPaidReportJury({ tenantId: 1, invokedVia: "business-report-evidence-review",
    collectProposerEvidence: async (spec: any) => { reads.push(spec.modelId); return retained[0].evidence; },
    question: "offline" } as any, { ...child.payload.input, operatorJobId: "company-package:50" },
    child.id, 1, `initial_jury:1:${child.payload.state.requestId}`, {
      reserve: async () => {}, audit: async () => {},
      call: async (spec: any) => { calls.push(spec.modelId); return { ...retained[0], modelId: spec.modelId }; },
    }, { retained, snapshot: buildReportJurySnapshot({ input: child.payload.input, state: child.payload.state }, true),
      allowedModels: grant.allowedModels, binding: { tenantId: 1, jobId: child.id,
      inputDigest: child.payload.state.digest, reportSha256: grant.snapshotSha256 } });
  assert.deepEqual(calls, ["claude-opus-5-5"]); assert.deepEqual(reads, calls);
  assert.deepEqual(result.proposers.slice(0, 2).map(p => p.answer), retained.map((p: any) => p.answer));
  assert.deepEqual(child.payload.paidJuryRuns[grant.sourceRunKey].proposers.slice(0, 2), retained);
});
