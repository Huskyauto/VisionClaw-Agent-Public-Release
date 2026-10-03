import assert from "node:assert/strict";
import test from "node:test";
import { selectFelixModel, getFelixExpertLanes } from "../../server/felix-model-policy";
import { resolveFelixExpertLane, FelixExpertUnavailableError } from "../../server/felix-expert-route";
test("owner Felix agent-to-agent turns pin only Replit GPT-5.4 with no external fallback", () => {
  const context = { tenantId: 1, ownerTenantId: 1, personaId: 2, enabled: true };
  assert.deepEqual(getFelixExpertLanes({ ...context, source: "api-v1" }), [
    { modelId: "gpt-5.4", actualModelId: "gpt-5.4", providerLane: "replit" },
  ]);
  assert.equal(getFelixExpertLanes({ ...context, source: "a2a" })?.length, 1);
  assert.equal(getFelixExpertLanes({ ...context, source: "web" }), null);
  assert.equal(getFelixExpertLanes({ ...context, source: "api-v1", tenantId: 3 }), null);
  assert.equal(getFelixExpertLanes({ ...context, source: "api-v1", personaId: 3 }), null);
  assert.equal(getFelixExpertLanes({ ...context, source: "api-v1", enabled: false }), null);
});

test("expert route crosses providers without accepting a lower-model substitution", async () => {
  // Generic resolver behavior remains supported; this is NOT Felix's current policy.
  const lanes = [
    { modelId: "gpt-5.6-sol", actualModelId: "gpt-5.6-sol", providerLane: "profundo" as const },
    { modelId: "openference/deepseek-v4-pro", actualModelId: "DeepSeek-V4-Pro", providerLane: "openference" as const },
    { modelId: "grok-4.7", actualModelId: "grok-4.7", providerLane: "xai" as const },
  ];
  const seen: string[] = [];
  const route = await resolveFelixExpertLane(lanes, 0, async (lane) => {
    seen.push(lane.providerLane);
    if (lane.providerLane === "profundo") throw new Error("503");
    return { client: {} as never, actualModelId: "DeepSeek-V4-Pro" };
  });
  assert.equal(route.index, 1);
  assert.equal(route.modelId, "DeepSeek-V4-Pro");
  assert.deepEqual(seen, ["profundo", "openference"]);
  const third = await resolveFelixExpertLane(lanes, 0, async (lane) => {
    if (lane.providerLane !== "xai") throw new Error("unavailable");
    return { client: {} as never, actualModelId: "grok-4.7" };
  });
  assert.equal(third.index, 2);
  assert.equal(third.modelId, "grok-4.7");
  await assert.rejects(
    resolveFelixExpertLane(lanes, 0, async () => ({ client: {} as never, actualModelId: "gpt-5.4" })),
    FelixExpertUnavailableError,
  );
  await assert.rejects(
    resolveFelixExpertLane(lanes, 3, async () => { throw new Error("should not run"); }),
    FelixExpertUnavailableError,
  );
});

test("Felix's Replit pin accepts only GPT-5.4 and exhausts without another provider", async () => {
  const lanes = getFelixExpertLanes({ tenantId: 1, ownerTenantId: 1, personaId: 2, source: "api-v1", enabled: true })!;
  const resolved = await resolveFelixExpertLane(lanes, 0, async () =>
    ({ client: {} as never, actualModelId: "gpt-5.4" }));
  assert.equal(resolved.registryModelId, "gpt-5.4");
  assert.equal(resolved.index, 0);
  const seen: string[] = [];
  await assert.rejects(resolveFelixExpertLane(lanes, 0, async (lane) => {
    seen.push(lane.providerLane);
    throw new Error("Replit unavailable");
  }), FelixExpertUnavailableError);
  assert.deepEqual(seen, ["replit"]);
  await assert.rejects(resolveFelixExpertLane(lanes, 0, async () =>
    ({ client: {} as never, actualModelId: "gpt-5.6-sol" })), FelixExpertUnavailableError);
  await assert.rejects(resolveFelixExpertLane(lanes, 1, async () => {
    assert.fail("must not retry inference or choose another provider");
  }), FelixExpertUnavailableError);
});

const owner = { tenantId: 1, ownerTenantId: 1, personaId: 2 };

test("owner Felix's default Flash or gpt-5.4 route is lifted without changing others", () => {
  assert.equal(selectFelixModel("deepseek/deepseek-v4.1-flash", owner), "gpt-5.6-sol");
  assert.equal(selectFelixModel("gpt-5.4", owner), "gpt-5.6-sol");
  assert.equal(selectFelixModel("deepseek/deepseek-v4.1-flash", { ...owner, tenantId: 3 }), "deepseek/deepseek-v4.1-flash");
  assert.equal(selectFelixModel("deepseek/deepseek-v4.1-flash", { ...owner, personaId: 4 }), "deepseek/deepseek-v4.1-flash");
});

test("legacy Felix Flash thread gets a quality floor while an explicit stronger choice remains intact", () => {
  assert.equal(selectFelixModel("deepseek/deepseek-v4.1-flash", owner), "gpt-5.6-sol");
  assert.equal(selectFelixModel("gpt-5.4", owner), "gpt-5.6-sol");
  assert.equal(selectFelixModel("claude-sonnet-5", owner), "claude-sonnet-5");
  assert.equal(selectFelixModel("gpt-5.6-luna", owner), "gpt-5.6-luna");
  assert.equal(selectFelixModel("deepseek/deepseek-v4.1-flash", { ...owner, enabled: false }), "deepseek/deepseek-v4.1-flash");
  assert.equal(selectFelixModel("gpt-5.4", { ...owner, enabled: false }), "gpt-5.4");
});