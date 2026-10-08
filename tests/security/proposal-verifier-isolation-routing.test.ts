import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("all live verifier entry points use the isolated, staged runner", () => {
  const jobs = source("server/job-worker.ts");
  const closer = source("server/agentic/autonomous-closer.ts");
  const verifier = source("server/proposal-verifier.ts");
  const research = jobs.slice(
    jobs.indexOf('registerJobHandler("research_proposal_verification"'),
    jobs.indexOf('registerJobHandler("source_repair_handoff"'),
  );
  const repair = jobs.slice(
    jobs.indexOf('registerJobHandler("source_repair_verification"'),
    jobs.indexOf('registerJobHandler("research_digest"'),
  );
  const queue = verifier.slice(verifier.indexOf("export function fireAndForgetVerify"));

  for (const handler of [research, repair]) {
    assert.match(handler, /getResearchJobTenantId\(job\)/);
    assert.match(handler, /verifyProposalIsolated\(proposalId, tenantId, job\.leaseUntil\.getTime\(\)\)/);
    assert.doesNotMatch(handler, /verifyProposalById\(/);
  }
  assert.match(closer, /verifyProposalIsolated\(id, tenantId\)/);
  assert.doesNotMatch(closer, /verifyProposalById\(/);
  assert.match(queue, /verifyProposalIsolated\(proposalId, tenantId\)/);
  assert.doesNotMatch(queue, /verifyProposalById\(/);
});

test("the isolated child restores the proposal tenant for billing and rebase model selection", () => {
  const child = source("scripts/proposal-verifier-child.ts");
  const verifier = source("server/proposal-verifier.ts");
  assert.match(child, /withTenantContext\(\s*\{ tenantId, source: "background-job" \}/);
  assert.match(verifier, /executeWithFailover\([\s\S]*?\n\s+tenantId,\s*\n\s+\)/);
});

test("missing verifier job leases have a bounded, non-sensitive deferral diagnostic", () => {
  const jobs = source("server/job-worker.ts");
  assert.match(jobs, /err\.message === "proposal verification: missing job lease"/);
  assert.match(jobs, /reason=missing_lease/);
  assert.match(jobs, /lastMissingLeaseLogAt/);
});