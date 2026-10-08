import assert from "node:assert/strict";
import test from "node:test";
import { getClientForModel, resetProviderHealth } from "../../server/providers";
import { StandardComputeCompletionError } from "../../server/lib/standard-compute";

test("actual provider boundary blocks other tenants, missing scope, and a late kill switch", async () => {
  const previous = process.env.STANDARD_COMPUTE_ENABLED;
  const oldKey = process.env.STANDARD_COMPUTE_API_KEY;
  process.env.STANDARD_COMPUTE_ENABLED = "1";
  process.env.STANDARD_COMPUTE_API_KEY = "synthetic-test-key";
  try {
    for (const tenant of [undefined, 0, 2]) {
      await assert.rejects(getClientForModel("gemini-3.1-pro-preview", tenant, { providerLane: "standard-compute" }), /owner-only/);
    }
    await assert.rejects(getClientForModel("standardcompute", 1, { providerLane: "standard-compute" }), /owner-only/);
    const route = await getClientForModel("gemini-3.1-pro-preview", 1, { providerLane: "standard-compute" });
    assert.equal(route.actualModelId, "google/gemini-3.1-pro-preview");
    assert.equal((route.client as any).post, undefined);
    assert.equal(route.client.responses, undefined);
    await assert.rejects(route.client.chat.completions.create({
      model: "standardcompute", messages: [{ role: "user", content: "Synthetic" }],
    }), /exact non-streaming/);
    process.env.STANDARD_COMPUTE_ENABLED = "0";
    await assert.rejects(route.client.chat.completions.create({
      model: route.actualModelId, messages: [{ role: "user", content: "Synthetic" }],
    }), /owner-only/);
  } finally {
    if (previous === undefined) delete process.env.STANDARD_COMPUTE_ENABLED;
    else process.env.STANDARD_COMPUTE_ENABLED = previous;
    if (oldKey === undefined) delete process.env.STANDARD_COMPUTE_API_KEY;
    else process.env.STANDARD_COMPUTE_API_KEY = oldKey;
  }
});

test("rejected gateway output retains consumed tokens and permits no transport retries", async () => {
  const flag = process.env.STANDARD_COMPUTE_ENABLED;
  const key = process.env.STANDARD_COMPUTE_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.STANDARD_COMPUTE_ENABLED = "1";
  process.env.STANDARD_COMPUTE_API_KEY = "synthetic-test-key";
  resetProviderHealth();
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    const body = JSON.parse(init?.body as string);
    assert.equal(body.model, "google/gemini-3.1-pro-preview");
    assert.equal(body.max_tokens, 256);
    assert.equal(body.max_completion_tokens, undefined);
    return new Response(JSON.stringify({
      id: "synthetic", object: "chat.completion", created: 0,
      model: "google/gemini-3.1-pro-preview",
      choices: [{ index: 0, finish_reason: "length", message: { role: "assistant", content: "Incomplete" } }],
      usage: { prompt_tokens: 25, completion_tokens: 256, total_tokens: 281 },
    }), { headers: { "content-type": "application/json" } });
  };
  try {
    const { client, actualModelId } = await getClientForModel("gemini-3.1-pro-preview", 1, { providerLane: "standard-compute" });
    await assert.rejects(client.chat.completions.create({
      model: actualModelId, max_completion_tokens: 256, messages: [{ role: "user", content: "Synthetic accounting fixture" }],
    }, { maxRetries: 5 }), error => error instanceof StandardComputeCompletionError &&
      error.tokensIn === 25 && error.tokensOut === 256 && error.reportedModel === actualModelId);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    resetProviderHealth();
    if (flag === undefined) delete process.env.STANDARD_COMPUTE_ENABLED;
    else process.env.STANDARD_COMPUTE_ENABLED = flag;
    if (key === undefined) delete process.env.STANDARD_COMPUTE_API_KEY;
    else process.env.STANDARD_COMPUTE_API_KEY = key;
  }
});
