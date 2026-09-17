import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MODEL_REGISTRY } from "../../server/model-registry";
import { estimateCostUsd } from "../../server/agentic/cost-ledger";
import { buildPatchedCreate, buildPatchedResponsesCreate, getClientForModel } from "../../server/providers";
import { storage } from "../../server/storage";

test("GPT-6 Astra is exposed as an explicit paid OpenAI model", () => {
  const astra = MODEL_REGISTRY.find((model) => model.id === "gpt-6-astra");

  assert.ok(astra);
  assert.equal(astra.provider, "openai");
  assert.equal(astra.tier, "powerful");
  assert.equal(astra.costClass, "paid");
  assert.deepEqual(astra.capabilities, ["code", "tools"]);
});

test("Claude Fable 5.1 is exposed as an explicit paid Anthropic final-decision model", () => {
  const fable = MODEL_REGISTRY.find((model) => model.id === "claude-fable-5-1");

  assert.ok(fable);
  assert.equal(fable.provider, "anthropic");
  assert.equal(fable.tier, "powerful");
  assert.equal(fable.costClass, "paid");
  assert.deepEqual(fable.capabilities, ["vision", "code", "tools"]);
});

test("GPT-6 Astra is not silently inserted into automatic tier routing", async () => {
  const tiers = await import("../../data/model-tiers.json", {
    with: { type: "json" },
  });
  const serialized = JSON.stringify(tiers.default);

  assert.equal(serialized.includes("gpt-6-astra"), false);
  assert.equal(serialized.includes("claude-fable-5-1"), false);
});

test("main chat authorizes owner-only models only through a verified platform-admin request", async () => {
  const source = await readFile("server/routes.ts", "utf8");
  const catalogSource = await readFile("server/routes/platform-config.ts", "utf8");
  const providersSource = await readFile("server/providers.ts", "utf8");
  assert.match(
    source,
    /const ownerExplicitPaidOverride\s*=\s*isPlatformAdmin\(req\)\s*&&\s*isOwnerOnlyFinalDecisionModel\(model\)/,
  );
  assert.match(source, /meteredOverride: ownerExplicitPaidOverride/);
  assert.match(source, /explicitOwnerSelection: ownerExplicitPaidOverride/);
  assert.match(source, /platformAdminVerified: ownerExplicitPaidOverride/);
  assert.match(catalogSource, /getAvailableModelsForTenant\(tenantId, isPlatformAdmin\(req\)\)/);
  assert.match(providersSource, /!isOwnerOnlyFinalDecisionModel\(m\.id\) \|\| isAdmin/);
});

test("Claude Fable 5.1 accounting uses official standard and cache-read rates", () => {
  assert.equal(estimateCostUsd("claude-fable-5-1", 100_000, 100_000), 6);
  assert.equal(estimateCostUsd("claude-fable-5-1", 100_000, 0, 100_000), 0.025);
  assert.equal(estimateCostUsd("claude-fable-5-1", 100_000, 0, 0, 100_000), 1.25);
});

test("Claude Fable 5.1 preserves its exact id only for explicit admin selection", async () => {
  const originalTenantKey = storage.getTenantProviderKey.bind(storage);
  const originalProviderKey = storage.getProviderKey.bind(storage);
  const originalKey = process.env.ANTHROPIC_API_KEY;
  storage.getTenantProviderKey = async () => null;
  storage.getProviderKey = async () => null;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-fable-routing-key";

  try {
    const authorized = await getClientForModel("claude-fable-5-1", 1, {
      meteredOverride: true,
      explicitOwnerSelection: true,
      platformAdminVerified: true,
      requiresTools: true,
    });
    assert.equal(authorized.actualModelId, "claude-fable-5-1");

    const denied = await getClientForModel("claude-fable-5-1", 2, {
      meteredOverride: true,
      costExemptLane: true,
      explicitOwnerSelection: true,
      platformAdminVerified: false,
      requiresTools: true,
    });
    assert.equal(denied.actualModelId, "gpt-5.4");
  } finally {
    storage.getTenantProviderKey = originalTenantKey;
    storage.getProviderKey = originalProviderKey;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
});

test("GPT-6 Astra accounting uses official Standard and Flex rates", () => {
  assert.equal(estimateCostUsd("gpt-6-astra", 100_000, 100_000), 6);
  assert.equal(estimateCostUsd("gpt-6-astra:flex", 100_000, 100_000), 3);
  assert.equal(estimateCostUsd("gpt-6-astra", 100_000, 0, 100_000), 0.1);
  assert.equal(estimateCostUsd("gpt-6-astra", 100_000, 0, 0, 100_000), 1.25);
  assert.equal(estimateCostUsd("gpt-6-astra", 300_000, 10_000), 6.75);
});

test("GPT-6 Astra preserves the exact model id when metered access is authorized", async () => {
  const originalTenantKey = storage.getTenantProviderKey.bind(storage);
  const originalProviderKey = storage.getProviderKey.bind(storage);
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalOAuthPreference = process.env.OAUTH_SUBSCRIPTION_PREFERRED;
  storage.getTenantProviderKey = async () => null;
  storage.getProviderKey = async () => null;
  process.env.OPENAI_API_KEY = "sk-test-astra-routing-key";
  process.env.OAUTH_SUBSCRIPTION_PREFERRED = "0";

  try {
    const resolved = await getClientForModel("gpt-6-astra", 1, {
      meteredOverride: true,
      explicitOwnerSelection: true,
      platformAdminVerified: true,
    });
    assert.equal(resolved.actualModelId, "gpt-6-astra");
    assert.equal(typeof resolved.client.chat.completions.create, "function");
    assert.equal(typeof resolved.client.responses.create, "function");
  } finally {
    storage.getTenantProviderKey = originalTenantKey;
    storage.getProviderKey = originalProviderKey;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalOAuthPreference === undefined) delete process.env.OAUTH_SUBSCRIPTION_PREFERRED;
    else process.env.OAUTH_SUBSCRIPTION_PREFERRED = originalOAuthPreference;
  }
});

test("GPT-6 Astra obeys the zero-cost substitution policy by default", async () => {
  const originalMetered = process.env.ALLOW_METERED_LLM;
  process.env.ALLOW_METERED_LLM = "false";
  try {
    const resolved = await getClientForModel("gpt-6-astra", 1);
    assert.equal(resolved.actualModelId, "gpt-5.4");
  } finally {
    if (originalMetered === undefined) delete process.env.ALLOW_METERED_LLM;
    else process.env.ALLOW_METERED_LLM = originalMetered;
  }
});

test("GPT-6 Astra rejects generic metered and cost-exempt authorization", async () => {
  const originalMetered = process.env.ALLOW_METERED_LLM;
  process.env.ALLOW_METERED_LLM = "true";
  try {
    const resolved = await getClientForModel("gpt-6-astra", 2, {
      meteredOverride: true,
      costExemptLane: true,
      explicitOwnerSelection: true,
      platformAdminVerified: false,
    });
    assert.equal(resolved.actualModelId, "gpt-5.4");
  } finally {
    if (originalMetered === undefined) delete process.env.ALLOW_METERED_LLM;
    else process.env.ALLOW_METERED_LLM = originalMetered;
  }
});

test("Fable non-streaming output is rejected unless usage is durably recorded", async () => {
  const create = buildPatchedCreate(
    async () => ({ choices: [{ message: { content: "final" } }], usage: { input_tokens: 10, output_tokens: 5 } }),
    () => "claude-fable-5-1",
    () => 1,
    "llm.anthropic",
    async () => false,
  );
  await assert.rejects(
    () => create({ model: "claude-fable-5-1", messages: [] }),
    /mandatory Claude Fable 5\.1 usage record was not persisted/,
  );
});

test("Fable rejects missing usage instead of returning an unaccounted result", async () => {
  const create = buildPatchedCreate(
    async () => ({ choices: [{ message: { content: "unaccounted" } }] }),
    () => "claude-fable-5-1",
    () => 1,
    "llm.anthropic",
    async () => true,
  );
  await assert.rejects(
    () => create({ model: "claude-fable-5-1", messages: [] }),
    /missing mandatory Claude Fable 5\.1 usage/,
  );
});

test("Fable buffers streamed output until mandatory usage persistence succeeds", async () => {
  async function* upstream() {
    yield { choices: [{ delta: { content: "must not leak" } }] };
    yield { choices: [], usage: { input_tokens: 10, output_tokens: 4 } };
  }
  const create = buildPatchedCreate(
    async () => upstream(),
    () => "claude-fable-5-1",
    () => 1,
    "llm.anthropic",
    async () => false,
  );
  const stream = await create({ model: "claude-fable-5-1", messages: [], stream: true });
  const delivered: unknown[] = [];
  await assert.rejects(async () => {
    for await (const chunk of stream) delivered.push(chunk);
  }, /mandatory Claude Fable 5\.1 usage record was not persisted/);
  assert.equal(delivered.length, 0);
});

test("Fable rejects a malformed non-iterable stream result", async () => {
  const create = buildPatchedCreate(
    async () => ({ choices: [{ message: { content: "must not leak" } }], usage: { input_tokens: 10, output_tokens: 4 } }),
    () => "claude-fable-5-1",
    () => 1,
    "llm.anthropic",
    async () => true,
  );
  await assert.rejects(
    () => create({ model: "claude-fable-5-1", messages: [], stream: true }),
    /malformed Claude Fable 5\.1 stream/,
  );
});

test("Responses API accounting records completed and incomplete streams exactly once", async () => {
  for (const terminalType of ["response.completed", "response.incomplete", "response.failed"]) {
    const entries: any[] = [];
    const source: any = {
      controller: { abort() {} },
      async *[Symbol.asyncIterator]() {
        yield { type: "response.output_text.delta", delta: "ok" };
        yield {
          type: terminalType,
          response: { usage: { input_tokens: 11, output_tokens: 7 } },
        };
      },
    };
    const create = buildPatchedResponsesCreate(
      async () => source,
      "gpt-6-astra",
      9,
      "llm.openai",
      async (entry) => { entries.push(entry); },
    );

    const stream: any = await create({ model: "gpt-6-astra", stream: true });
    for await (const _event of stream) {
      // Exhaustion triggers the wrapper's exactly-once final accounting.
    }
    assert.equal(stream.controller, source.controller);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].tokensIn, 11);
    assert.equal(entries[0].tokensOut, 7);
    assert.equal(entries[0].operation, "responses.create.stream");
  }
});

test("Responses API accounting preserves flat-rate zero-cost semantics and request bounds", async () => {
  const entries: any[] = [];
  let observedOptions: any;
  const create = buildPatchedResponsesCreate(
    async (_params, options) => {
      observedOptions = options;
      return { usage: { input_tokens: 5, output_tokens: 3 } };
    },
    "gpt-6-astra",
    1,
    "llm.profundo",
    async (entry) => { entries.push(entry); },
  );

  await create({ model: "gpt-6-astra" });
  assert.equal(observedOptions.timeout, 60_000);
  assert.equal(observedOptions.maxRetries, 1);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].costUsd, 0);
  assert.equal(entries[0].operation, "responses.create");
});

test("Responses accounting tags Flex usage with its discounted pricing identity", async () => {
  const entries: any[] = [];
  const create = buildPatchedResponsesCreate(
    async () => ({ usage: { input_tokens: 10, output_tokens: 4 } }),
    "gpt-6-astra",
    1,
    "llm.openai",
    async (entry) => { entries.push(entry); },
  );

  await create({ model: "gpt-6-astra", service_tier: "flex" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].model, "gpt-6-astra:flex");
});

test("Astra Responses fail closed when mandatory usage persistence fails", async () => {
  const create = buildPatchedResponsesCreate(
    async () => ({ usage: { input_tokens: 10, output_tokens: 4 }, output_text: "answer" }),
    "gpt-6-astra",
    1,
    "llm.openai",
    async () => false,
  );
  await assert.rejects(
    () => create({ model: "gpt-6-astra", service_tier: "flex" }),
    /mandatory GPT-6 Astra usage record was not persisted/,
  );
  const missingUsage = buildPatchedResponsesCreate(
    async () => ({ output_text: "answer" }),
    "gpt-6-astra",
    1,
    "llm.openai",
    async () => true,
  );
  await assert.rejects(
    () => missingUsage({ model: "gpt-6-astra", service_tier: "flex" }),
    /omitted mandatory usage/,
  );
});