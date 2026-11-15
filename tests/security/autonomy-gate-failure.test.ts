import test from "node:test";
import assert from "node:assert/strict";
import { enforceAutonomyGate } from "../../server/tools/middleware/autonomy-gate";
import { withToolAuthority } from "../../server/tools/invocation-authority";

test("autonomy enforcement failure cannot silently authorize the tool", async () => {
  const result = await enforceAutonomyGate("send_email", { _tenantId: 42, _personaId: 2 }, {
    mapToolToActionType: () => "send_email",
    checkAutonomy: async () => { throw new Error("synthetic policy store outage"); },
  });
  assert.ok(result?.error);
  assert.equal(result.autonomy.decision, "policy_unavailable");
});

test("omitting persona identity cannot bypass a mapped autonomy rule", async () => {
  const result = await enforceAutonomyGate("send_email", { _tenantId: 42, _selfHeal: true }, {
    mapToolToActionType: () => "send_email",
    checkAutonomy: async () => { throw new Error("must not be called without identity"); },
  });
  assert.equal(result?.autonomy.decision, "missing_identity");
});

test("a service requires separate, tenant-bound authority rather than a task boolean", async () => {
  const dependencies = {
    mapToolToActionType: () => "send_email",
    checkAutonomy: async () => { throw new Error("service has no persona identity"); },
  };
  const ctx = { tenantId: 42, actor: "system" as const, invokedVia: "video-delivery",
    internalPurpose: "Deliver the requested completed tenant video" };
  assert.equal(await withToolAuthority(ctx, () =>
    enforceAutonomyGate("send_email", { _tenantId: 42 }, dependencies)), null);
  const denied = await withToolAuthority(ctx, () =>
    enforceAutonomyGate("send_email", { _tenantId: 1 }, dependencies));
  assert.equal(denied?.autonomy.decision, "missing_identity");
});
