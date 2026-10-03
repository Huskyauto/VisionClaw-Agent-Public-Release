import assert from "node:assert/strict";
import test from "node:test";
import { fileIncomeOpportunitySchema } from "../../shared/models/income-opportunities";
import { ownerTenantId } from "../../server/agentic/autonomous-budget";
import { filterSparkLineTools } from "../../server/tool-router";
import "../../server/tools/domains/income-opportunities";
import { getMigratedHandler } from "../../server/tools/registry";

const handler = getMigratedHandler("opportunity_bank_file");
assert.ok(handler);

const valid = {
  name: "HVAC callback audit",
  category: "Assessment",
  buyer: "HVAC service owners",
  problem: "Missed callbacks lose warm leads; demand unverified",
  entryOffer: "Seven-day callback review",
  nextStep: "Ask five owners if they would pay for this review",
};

test("Opportunity Bank schema admits bounded ideas, not self-verified outcomes or tenant selection", () => {
  assert.equal(fileIncomeOpportunitySchema.safeParse(valid).success, true);
  assert.equal(fileIncomeOpportunitySchema.safeParse({ ...valid, evidence: "Paid" }).success, false);
  assert.equal(fileIncomeOpportunitySchema.safeParse({ ...valid, tenantId: ownerTenantId() + 1 }).success, false);
  assert.equal(fileIncomeOpportunitySchema.safeParse({ ...valid, name: "x".repeat(161) }).success, false);
});

test("Only owner-tenant Felix can file and see the filing tool", async () => {
  const owner = ownerTenantId();
  for (const ctx of [{ personaId: 2 }, { tenantId: owner + 1, personaId: 2 }, { tenantId: owner, personaId: 3 }]) {
    const result = await handler!(valid, ctx);
    assert.ok("error" in result, "an unauthorized context must not write");
  }
  const defs = [{ function: { name: "opportunity_bank_file" } }, { function: { name: "project" } }];
  assert.deepEqual(filterSparkLineTools(defs, 3, owner).map(x => x.function.name), ["project"]);
  assert.deepEqual(filterSparkLineTools(defs, 2, owner + 1).map(x => x.function.name), ["project"]);
  assert.equal(filterSparkLineTools(defs, 2, owner).length, 2);
});

test("Malformed filing cannot reach the database", async () => {
  const result = await handler!({ ...valid, evidence: "Paid" }, { tenantId: ownerTenantId(), personaId: 2 });
  assert.deepEqual(result && "error" in result ? result.error : null, "Invalid opportunity fields");
});