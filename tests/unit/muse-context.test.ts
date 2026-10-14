import assert from "node:assert/strict";
import test from "node:test";
import { buildMuseContextPacket, requestMuseContext } from "../../server/muse-context";

const owner = { tenantId: 1, ownerTenantId: 1, conversationId: 620, content: "Review model routing and security", enabled: true };

test("Muse packets contain only public labels, never raw prompts or private values", () => {
  const packet = JSON.stringify(buildMuseContextPacket("security: customer Ada Example; password abc123; private health document", "opaque"));
  assert.ok(packet.includes("security"));
  for (const value of ["Ada", "Example", "abc123", "health document"]) assert.ok(!packet.includes(value));
});

test("queued advice remains pending, never received or subscription-verified", async () => {
  const state = await requestMuseContext(owner, async () => ({ outboxId: 7 }));
  assert.equal(state.status, "pending");
  assert.equal(state.outboxId, 7);
  assert.equal(state.subscriptionUsageVerified, false);
});

test("non-owner, disabled and incoming agent requests cannot produce Muse echo loops", async () => {
  for (const patch of [{ tenantId: 3 }, { enabled: false }, { source: "api-v1" }, { source: "a2a" }, { source: "subagent:Forge" }]) {
    const state = await requestMuseContext({ ...owner, ...patch }, async () => { assert.fail("must not send"); });
    assert.equal(state.status, "not_requested");
  }
});

test("queue failure does not block work or invoke another transport", async () => {
  let attempts = 0;
  const state = await requestMuseContext(owner, async () => { attempts++; throw new Error("rate limited"); });
  assert.equal(state.status, "unavailable");
  assert.equal(attempts, 1);
});
