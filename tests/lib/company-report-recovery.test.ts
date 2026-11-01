import test from "node:test";
import assert from "node:assert/strict";
import * as recovery from "../../server/lib/company-report-recovery";

const fixture = () => ({ id: 50, tenant_id: 1, status: "succeeded", attempts: 4,
  payload: { tenantId: 1, productionVersion: 2, digest: "intake",
    state: { phase: "blocked", research: { complete: true, evidence: { capturedAt: "now", sources: [] }, map: {} },
      reports: { readiness: { status: "error" }, executive: { status: "error", jobId: 51 } }, files: [] },
    packageSpend: { "draft:readiness:prompt:gpt-5.4": 500000, "draft:executive:prompt:claude-sonnet-5-5": 500000 },
    packageDrafts: { "executive:prompt:claude-sonnet-5-5": { text: "Retained substantive report analysis and practical steps. ".repeat(30), model: "claude-sonnet-5-5" } },
  } });

test("paid draft recovery exposes the existing reservation and requires exact snapshot approval", () => {
  const job = fixture();
  const plan = recovery.packageRecoveryPlan(job);
  assert.equal(plan.available, true);
  assert.equal(plan.requiresPaidRetryApproval, true);
  assert.equal(plan.reservedUsd, 1);
  assert.equal(plan.remainingUsd, 29);
  assert.deepEqual(plan.retryKeys, ["draft:readiness:prompt:gpt-5.4"]);
  assert.throws(() => recovery.approvePackageRecovery(job, { snapshot: plan.snapshot, acceptResearchCost: true }), /uncertain/);
  const approved = recovery.approvePackageRecovery(job, { snapshot: plan.snapshot, acceptResearchCost: true,
    confirmUncertainPaidRetry: true });
  assert.equal(approved.state.reports.executive.jobId, 51);
  assert.equal(approved.state.reports.readiness, undefined);
  assert.deepEqual(approved.packageSpend, job.payload.packageSpend);
  assert.deepEqual(approved.packageDrafts, job.payload.packageDrafts);
  job.payload.packageSpend["draft:another" as keyof typeof job.payload.packageSpend] = 1;
  assert.throws(() => recovery.approvePackageRecovery(job, { snapshot: plan.snapshot, acceptResearchCost: true,
    confirmUncertainPaidRetry: true }), /changed/);
});

test("recovery cannot bypass non-draft paid uncertainty or an exhausted ceiling", () => {
  const job: any = fixture();
  job.payload.packageSpend["review:51:phase:model"] = 100;
  assert.equal(recovery.packageRecoveryPlan(job).available, false);
  delete job.payload.packageSpend["review:51:phase:model"];
  job.payload.packageSpend = { "draft:readiness:prompt:gpt-5.4": 30000000 };
  assert.equal(recovery.packageRecoveryPlan(job).available, false);
  job.status = "running"; job.payload.state.phase = "reviewing";
  assert.equal(recovery.packageRecoveryPlan(job).available, false);
});

test("research-only recovery requires a current snapshot and never grants model retry authority", () => {
  const job: any = fixture();
  job.payload.state.research.map = { discoveryComplete: true, sitemapQueue: [],
    pages: [{ url: "https://example.test/", status: "rendered" }] };
  const plan = recovery.packageRecoveryPlan(job);
  assert.equal(plan.available, false);
  assert.equal(plan.canRepairResearch, true);
  const repaired = recovery.approvePackageRecovery(job, { snapshot: plan.snapshot, researchOnly: true });
  assert.equal(repaired.researchOnly, true);
  assert.equal(repaired.state.research.complete, false);
  assert.deepEqual(repaired.packageRecovery.retryKeys, []);
  assert.deepEqual(repaired.packageSpend, job.payload.packageSpend);
  job.payload.state.reports.executive.status = "done";
  assert.equal(recovery.packageRecoveryPlan(job).canRepairResearch, false,
    "completed reports keep their original evidence binding");
  job.payload.state.reports.executive.status = "error";
  job.payload.tenantId = 2;
  assert.equal(recovery.packageRecoveryPlan(job).canRepairResearch, false);
});
