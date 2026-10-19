import test from "node:test";
import assert from "node:assert/strict";
import { generateReportSection } from "../../server/lib/report-section-generation";

const prose = "Recommendation: clarify the service request process using the observed website evidence. " +
  "The owner should assign responsibility, verify existing systems and measure qualified enquiries before expanding the pilot. ".repeat(4);

test("fragment or truncated drafts fall back once to a pinned free lane with adequate output headroom", async () => {
  for (const first of [
    { choices: [{ finish_reason: "stop", message: { content: "-" } }] },
    { choices: [{ finish_reason: "length", message: { content: prose } }] },
    new Error("503 Service temporarily unavailable"),
  ]) {
    const calls: any[] = [];
    const text = await generateReportSection({ modelId: "gpt-5.6-sol", tenantId: 1,
      messages: [{ role: "user", content: "Write the evidence-backed section." }] }, async (model, tenant, options) => {
      calls.push({ model, tenant, options });
      return { actualModelId: model, client: { chat: { completions: { create: async (params: any) => {
        assert.ok(params.max_tokens >= 8192);
        if (calls.length === 1) {
          if (first instanceof Error) throw first;
          return first;
        }
        return { choices: [{ finish_reason: "stop", message: { content: prose } }] };
      } } } } };
    });
    assert.equal(text, prose.trim());
    assert.equal(calls.length, 2);
    assert.equal(calls[1].model, "gpt-5.4");
    assert.equal(calls[1].options.providerLane, "replit");
    assert.equal(calls[0].options.forbidMeteredFallback, true);
  }
});

test("an unavailable free proxy can recover on a pinned subscription model without enabling paid fallback", async () => {
  const calls: any[] = [];
  const result = await generateReportSection({ modelId: "gpt-5.6-sol", tenantId: 1, messages: [] },
    async (model, tenant, options) => {
      calls.push({ model, tenant, options });
      if (calls.length <= 2) throw new Error("provider unavailable");
      assert.equal(options.providerLane, "openference");
      assert.equal(options.forbidMeteredFallback, true);
      return { actualModelId: "MiniMax M3", client: { chat: { completions: { create: async () => ({
        choices: [{ finish_reason: "stop", message: { content: prose } }],
      }) } } } };
    });
  assert.equal(result, prose.trim());
  assert.equal(calls[2].model, "openference/minimax-m3");
});

test("healthy substantive output makes one call, and exhausted lanes never return a fragment", async () => {
  let calls = 0;
  const request = { modelId: "model", tenantId: 1, messages: [] };
  assert.equal(await generateReportSection(request, async () => {
    calls++;
    return { actualModelId: "model", client: { chat: { completions: { create: async () => ({
      choices: [{ finish_reason: "stop", message: { content: prose } }],
    }) } } } };
  }), prose.trim());
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(generateReportSection(request, async (_model, tenant, options) => {
    calls++;
    assert.equal(tenant, 1);
    assert.equal(options.forbidMeteredFallback, true);
    return { actualModelId: "model", client: { chat: { completions: { create: async () => ({
      choices: [{ finish_reason: "stop", message: { content: "Ver" } }],
    }) } } } };
  }), /all bounded free drafting lanes/);
  assert.equal(calls, 3);
});
