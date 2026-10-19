import test from "node:test";
import assert from "node:assert/strict";
import { paidStreamRecoveryPolicy } from "../../server/lib/stream-create-timeout";
import { selectTenantValidatedModel } from "../../server/lib/tenant-model-access";
import { pilotToolStillNeeded } from "../../server/lib/business-pilot-routing";

test("paid streaming gets a bounded SDK-aligned deadline and never retries or substitutes", () => {
  const policy = paidStreamRecoveryPolicy("cheaperinference/gpt-5.6-luna", 12_000);
  assert.equal(policy.creationTimeoutMs, 65_000);
  assert.equal(policy.allowRecovery, false);
  assert.equal(paidStreamRecoveryPolicy("cheaperinference/other", 120_000).creationTimeoutMs, 65_000);
});

test("ordinary free streaming retains its configured timeout and failover", () => {
  assert.deepEqual(paidStreamRecoveryPolicy("replit/gpt-5.4", 12_000),
    { creationTimeoutMs: 12_000, allowRecovery: true });
});

test("a denied explicit paid pin cannot silently become the default model before dispatch", async () => {
  await assert.rejects(selectTenantValidatedModel({
    requestedModel: "cheaperinference/gpt-5.6-luna", tenantId: 2, timeoutMs: 100,
    strictSelection: true, validate: async () => false,
  }), /selected model is unavailable/);
});

test("every explicit pilot request needs its own successful result; failures never cause a forced retry", () => {
  const content = 'Run business_pilot directly: [{"action":"run","kind":"health"},{"action":"run","kind":"cost"}]';
  const health = { name: "business_pilot", input: { action: "run", kind: "health" }, output: { ok: true } };
  assert.equal(pilotToolStillNeeded(content, [health]), true);
  assert.equal(pilotToolStillNeeded(content, [health, { ...health, input: { action: "run", kind: "cost" } }]), false);
  assert.equal(pilotToolStillNeeded(content, [{ ...health, output: { ok: false } }]), false);
});
