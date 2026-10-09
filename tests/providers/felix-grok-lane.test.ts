import assert from "node:assert/strict";
import test from "node:test";
import { getClientForModel, providerLaneCanServeModel } from "../../server/providers";
import { withFelixExpertGrant } from "../../server/felix-expert-route";
import { ownerTenantId } from "../../server/agentic/autonomous-budget";

test("pinned Grok fallback is owner-only, opt-in, kill-switchable, and exact-model-only", async () => {
  const previousKey = process.env.XAI_API_KEY;
  const previousFlag = process.env.FELIX_GROK_FALLBACK_ENABLED;
  const previousMetered = process.env.ALLOW_METERED_LLM;
  process.env.XAI_API_KEY = "fake-xai-key-for-construction-only";
  delete process.env.FELIX_GROK_FALLBACK_ENABLED;
  process.env.ALLOW_METERED_LLM = "0";
  const opts = { providerLane: "xai" as const, meteredOverride: true, forbidMeteredFallback: true };
  try {
    assert.equal(providerLaneCanServeModel("xai", "grok-4.7"), true);
    assert.equal(providerLaneCanServeModel("xai", "grok-4.6"), false);
    const ownerId = ownerTenantId();
    await assert.rejects(getClientForModel("grok-4.7", ownerId + 1, opts), /owner tenant/);
    await assert.rejects(getClientForModel("grok-4.7", ownerId, { ...opts, meteredOverride: false }), /metered override/);
    await assert.rejects(getClientForModel("grok-4.7", ownerId, opts), /authenticated owner-Felix agent ingress/);
    await assert.rejects(
      withFelixExpertGrant({ tenantId: ownerId, personaId: 3, source: "api-v1" }, () =>
        getClientForModel("grok-4.7", ownerId, opts)),
      /No authorized expert model/,
    );
    await assert.rejects(
      withFelixExpertGrant({ tenantId: ownerId, personaId: 2, source: "web" }, () =>
        getClientForModel("grok-4.7", ownerId, opts)),
      /No authorized expert model/,
    );
    process.env.FELIX_GROK_FALLBACK_ENABLED = "0";
    await assert.rejects(withFelixExpertGrant(
      { tenantId: ownerId, personaId: 2, source: "api-v1" },
      () => getClientForModel("grok-4.7", ownerId, opts),
    ), /disabled/);
    delete process.env.FELIX_GROK_FALLBACK_ENABLED;
    const lane = await withFelixExpertGrant(
      { tenantId: ownerId, personaId: 2, source: "a2a" },
      () => getClientForModel("grok-4.7", ownerId, opts),
    );
    assert.equal(lane.actualModelId, "grok-4.7");
    assert.ok(lane.client.chat.completions.create);
    assert.equal((lane.client as any).maxRetries, 0);
    await assert.rejects(withFelixExpertGrant(
      { tenantId: ownerId, personaId: 2, source: "api-v1" },
      () => getClientForModel("gpt-5.4", ownerId, opts),
    ), /cannot serve/);
  } finally {
    if (previousKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = previousKey;
    if (previousFlag === undefined) delete process.env.FELIX_GROK_FALLBACK_ENABLED;
    else process.env.FELIX_GROK_FALLBACK_ENABLED = previousFlag;
    if (previousMetered === undefined) delete process.env.ALLOW_METERED_LLM;
    else process.env.ALLOW_METERED_LLM = previousMetered;
  }
});