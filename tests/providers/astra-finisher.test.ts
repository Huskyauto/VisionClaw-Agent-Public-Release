import assert from "node:assert/strict";
import test from "node:test";

import { finishWithAstra } from "../../server/lib/astra-finisher";

test("Astra finisher defaults to Flex with bounded reasoning and prompt caching", async () => {
  const calls: any[] = [];
  const finalText = "Astra final answer with complete, useful report content. ".repeat(8);
  const result = await finishWithAstra({
    tenantId: 1,
    preparedDraft: "A complete draft with enough substantive material. ".repeat(8),
    evidence: "Verified evidence",
    task: "Produce the final answer",
    cacheKey: "research-report-v1",
  }, {
    enabled: true,
    createResponse: async (params, options) => {
      calls.push({ ...params, options });
      return { output_text: finalText, usage: {} };
    },
  });

  assert.deepEqual(result, {
    text: finalText.trim(),
    serviceTier: "flex",
    usedAstra: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "gpt-6-astra");
  assert.equal(calls[0].service_tier, "flex");
  assert.equal(calls[0].reasoning.effort, "high");
  assert.equal(calls[0].max_output_tokens, 4_000);
  assert.equal(calls[0].prompt_cache_key, "research-report-v1");
  assert.equal(calls[0].prompt_cache_retention, "24h");
  assert.equal(calls[0].options.maxRetries, 0);
});

test("Astra finisher scales conservative output headroom and skips paid calls that cannot safely fit", async () => {
  const calls: any[] = [];
  const finish = (preparedDraft: string) => finishWithAstra({
    tenantId: 1,
    preparedDraft,
    evidence: "Verified evidence",
    task: "Produce the final answer",
  }, {
    enabled: true,
    createResponse: async (params) => {
      calls.push(params);
      return { output_text: preparedDraft };
    },
  });

  await finish("x".repeat(10_000));
  await finish("界".repeat(20_000));
  await finish("x".repeat(72_000));

  assert.equal(calls[0].max_output_tokens, 15_000);
  assert.equal(calls.length, 1);
});

test("Astra finisher clamps explicit output limits and ignores non-finite overrides", async () => {
  const calls: any[] = [];
  const run = (maxOutputTokens: number) => finishWithAstra({
    tenantId: 1,
    preparedDraft: "A complete draft with enough substantive material. ".repeat(8),
    evidence: "Verified evidence",
    task: "Produce the final answer",
    maxOutputTokens,
  }, {
    enabled: true,
    createResponse: async (params) => {
      calls.push(params);
      return { output_text: "A complete final answer with substantive material. ".repeat(8) };
    },
  });

  await run(1_000);
  await run(90_000);
  await run(Number.NaN);

  assert.deepEqual(calls.map((call) => call.max_output_tokens), [4_000, 25_000, 4_000]);
});

test("Astra finisher preserves the prepared draft when Flex is unavailable", async () => {
  const result = await finishWithAstra({
    tenantId: 1,
    preparedDraft: "Keep this verified draft",
    evidence: "Evidence",
    task: "Finalize",
  }, {
    enabled: true,
    createResponse: async () => {
      const error: any = new Error("Resource unavailable");
      error.status = 429;
      throw error;
    },
  });

  assert.deepEqual(result, {
    text: "Keep this verified draft",
    serviceTier: "none",
    usedAstra: false,
  });
});

test("Astra finisher refuses non-admin tenants before any paid call", async () => {
  let called = false;
  const result = await finishWithAstra({
    tenantId: 2,
    preparedDraft: "Draft",
    evidence: "Evidence",
    task: "Finalize",
  }, {
    enabled: true,
    createResponse: async () => {
      called = true;
      return { output_text: "must not run" };
    },
  });

  assert.equal(called, false);
  assert.equal(result.usedAstra, false);
  assert.equal(result.text, "Draft");
});

test("Astra finisher rejects short output and does not retry ambiguous failures", async () => {
  let calls = 0;
  const input = {
    tenantId: 1,
    task: "Polish",
    evidence: "Evidence",
    preparedDraft: "complete baseline ".repeat(100),
    allowStandardFallback: true,
  };
  const short = await finishWithAstra(input, {
    enabled: true,
    createResponse: async () => {
      calls++;
      return { output_text: "too short" };
    },
  });
  assert.equal(short.usedAstra, false);
  assert.equal(short.text, input.preparedDraft);
  assert.equal(calls, 1);

  const timeout = await finishWithAstra(input, {
    enabled: true,
    createResponse: async () => {
      calls++;
      const error: any = new Error("request timed out after provider acceptance was ambiguous");
      error.code = "ETIMEDOUT";
      throw error;
    },
  });
  assert.equal(timeout.usedAstra, false);
  assert.equal(calls, 2);

  const incomplete = await finishWithAstra(input, {
    enabled: true,
    createResponse: async () => {
      calls++;
      return {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output_text: "apparently substantial but truncated ".repeat(50),
      };
    },
  });
  assert.equal(incomplete.usedAstra, false);
  assert.equal(calls, 3);
});