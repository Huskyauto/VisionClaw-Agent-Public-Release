import { test } from "node:test";
import assert from "node:assert/strict";
import { assessPlanRun } from "../../server/lib/plan-run-confirmation";

test("successful model and tool claims cannot certify the business outcome", () => {
  const input = { id: 7, tenantId: 2, status: "completed", steps: [{ n: 1 }],
    log: [{ step: 1, success: true, output: { verified: true, delivered: true } }] };
  const report = assessPlanRun(input);
  assert.equal(report.status, "unverified");
  assert.equal(report.checks.find(c => c.id === "coverage")?.status, "passed");
  assert.equal(report.checks.find(c => c.id === "outcome")?.status, "unverified");
  assert.notEqual(report.subjectDigest, assessPlanRun({ ...input, tenantId: 3 }).subjectDigest);
  assert.equal(assessPlanRun({ ...input, status: "failed" }).status, "failed");
  assert.equal(assessPlanRun({ ...input, log: [] }).checks.find(c => c.id === "coverage")?.status, "unverified");
});
