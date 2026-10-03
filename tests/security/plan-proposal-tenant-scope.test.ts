import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const verifier = readFileSync(new URL("../../server/proposal-verifier.ts", import.meta.url), "utf8");
const executor = readFileSync(new URL("../../server/plan-executor.ts", import.meta.url), "utf8");
const capabilityReview = readFileSync(new URL("../../server/capability-review.ts", import.meta.url), "utf8");

test("proposal verifier requires tenant scope on its public contracts and every proposal mutation", () => {
  assert.match(verifier, /verifyProposalById\(proposalId: number, tenantId: number\)/);
  assert.match(verifier, /fireAndForgetVerify\(proposalId: number, tenantId: number\)/);

  const proposalPredicates = verifier.match(/WHERE id = \$\{proposalId\}[^\n]*/g) ?? [];
  assert.ok(proposalPredicates.length >= 5, "expected lookup, persistence, and rebase predicates");
  for (const predicate of proposalPredicates) {
    assert.match(predicate, /AND tenant_id = \$\{tenantId\}/);
  }
});

test("every post-claim plan-id mutation is scoped to the validated claimed tenant", () => {
  assert.match(executor, /Number\.isInteger\(row\.tenant_id\).*row\.tenant_id <= 0/);
  assert.match(executor, /claimedTenantId = row\.tenant_id/);

  const postClaim = executor.slice(executor.indexOf("claimedTenantId = row.tenant_id"));
  const planIdPredicates = postClaim.match(/WHERE id = \$\{planId\}[^\n]*/g) ?? [];
  assert.equal(planIdPredicates.length, 3, "expected empty-plan, terminal, and fatal mutations");
  for (const predicate of planIdPredicates) {
    assert.match(predicate, /AND tenant_id = \$\{claimedTenantId\}/);
  }

  assert.match(executor, /appendExecutionLog\(planId: number, tenantId: number, entry: any\)/);
  assert.match(executor, /WHERE id = \$\{planId\} AND tenant_id = \$\{tenantId\}/);
  const postClaimLogCalls = postClaim.match(/appendExecutionLog\(planId,[^\n]*/g) ?? [];
  assert.ok(postClaimLogCalls.length >= 6, "expected every execution-log path");
  for (const call of postClaimLogCalls) {
    assert.match(call, /^appendExecutionLog\(planId, claimedTenantId,/);
  }
});

test("capability review reuse retains authoritative tenant and scopes every mutation", () => {
  assert.match(capabilityReview, /interface PendingReuse \{[\s\S]*?tenantId: number/);
  assert.match(
    capabilityReview,
    /pendingReuseByConversation\.set\([\s\S]*?tenantId: ctx\.tenantId,[\s\S]*?\}\);/,
  );
  assert.match(
    capabilityReview,
    /WHERE id = \$\{pending\.reviewId\}\s+AND tenant_id = \$\{pending\.tenantId\}\s+AND reused = false/,
  );

  const mutations = capabilityReview.match(/(?:INSERT INTO|UPDATE) capability_reviews[\s\S]*?(?:RETURNING id|AND reused = false)/g) ?? [];
  assert.equal(mutations.length, 2, "expected the insert and reuse update only");
  assert.match(mutations[0], /\(tenant_id,/);
  assert.match(mutations[0], /\$\{ctx\.tenantId\}/);
  assert.match(mutations[1], /tenant_id = \$\{pending\.tenantId\}/);
});