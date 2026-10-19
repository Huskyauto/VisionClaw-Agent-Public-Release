import test from "node:test";
import assert from "node:assert/strict";
import { guardReportArgonClient, REPORT_ARGON_MODEL } from "../../server/lib/report-argon-route";
import { executeBoundedReportSeat, ownerJuryMeteredOverrideAllowed } from "../../server/moa";
import { executeOwnerJuryApiCall } from "../../server/lib/owner-jury-api-route";
import { getClientForModel } from "../../server/providers";

test("Argon is bounded-report only; closed transport enforces exact model, output, no retries/fallbacks and expired grants", async () => {
  const previous = process.env.OWNER_JURY_DIRECT_API_ENABLED;
  process.env.OWNER_JURY_DIRECT_API_ENABLED = "1";
  let calls = 0, reserved = false;
  const client = guardReportArgonClient({ chat: { completions: { create: async (params: any, options: any) => {
    assert.equal(reserved, true); assert.equal(params.model, REPORT_ARGON_MODEL);
    assert.equal(params.max_tokens, 4096); assert.equal(params.max_completion_tokens, undefined);
    assert.deepEqual(params.provider, { allow_fallbacks: false, require_parameters: true });
    assert.equal(params.models, undefined); assert.equal(options.maxRetries, 0); assert.equal(options.headers, undefined);
    calls++;
    return { choices: [{ message: { content: "review" } }], model: REPORT_ARGON_MODEL };
  } } } } as any, 1);
  const params = { model: REPORT_ARGON_MODEL, max_completion_tokens: 4096,
    messages: [{ role: "system", content: "Review" }, { role: "user", content: "Snapshot" }] };
  try {
    await assert.rejects((client.chat.completions.create as any)(params), /grant/);
    await assert.rejects(executeOwnerJuryApiCall(1, "openrouter", REPORT_ARGON_MODEL, "x",
      { estimate: () => .1, ceiling: () => ({ spent: 0, ceiling: 2 }), reserve: () => {} },
      async () => "must not acquire a generic jury grant"), /denied/);
    await executeBoundedReportSeat({ modelId: REPORT_ARGON_MODEL, providerLane: "openrouter" }, "Snapshot", 1,
      async () => { reserved = true; }, { dispatch: async spec => {
        assert.equal(ownerJuryMeteredOverrideAllowed(1, true, spec), true);
        const resolved = await getClientForModel(REPORT_ARGON_MODEL, 1,
          { providerLane: "openrouter", meteredOverride: true });
        assert.equal(resolved.actualModelId, REPORT_ARGON_MODEL);
        for (const change of [{ model: "google/gemini-other" }, { stream: true }, { max_completion_tokens: 99999 },
          { tools: [{}] }]) {
          await assert.rejects((client.chat.completions.create as any)({ ...params, ...change }), /grant/);
        }
        await (client.chat.completions.create as any)({ ...params, models: ["other"] }, { headers: { Authorization: "not passed" }, maxRetries: 99 });
        return { ok: true, modelId: REPORT_ARGON_MODEL, provider: "openrouter", latencyMs: 1, answer: "review" };
      } });
    assert.equal(calls, 1);
    await assert.rejects((client.chat.completions.create as any)(params), /grant/);
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.OWNER_JURY_DIRECT_API_ENABLED;
    else process.env.OWNER_JURY_DIRECT_API_ENABLED = previous;
  }
});

test("Argon rejects a different populated returned model identity after a nonrefundable reservation", async () => {
  const previous = process.env.OWNER_JURY_DIRECT_API_ENABLED;
  process.env.OWNER_JURY_DIRECT_API_ENABLED = "1";
  let reserved = 0;
  const client = guardReportArgonClient({ chat: { completions: { create: async () =>
    ({ model: "anthropic/claude-sonnet-5-5", choices: [{ message: { content: "Wrong model" } }] }) } } } as any, 1);
  try {
    await assert.rejects(executeBoundedReportSeat({ modelId: REPORT_ARGON_MODEL, providerLane: "openrouter" }, "Snapshot", 1,
      async () => { reserved++; }, { dispatch: async () => {
        await (client.chat.completions.create as any)({ model: REPORT_ARGON_MODEL, max_completion_tokens: 4096,
          messages: [{ role: "system", content: "Review" }, { role: "user", content: "Snapshot" }] });
        return { ok: true, modelId: REPORT_ARGON_MODEL, provider: "openrouter", latencyMs: 1 };
      } }), /identity.*anthropic\/claude-sonnet-5-5/);
    assert.equal(reserved, 1);
  } finally {
    if (previous === undefined) delete process.env.OWNER_JURY_DIRECT_API_ENABLED;
    else process.env.OWNER_JURY_DIRECT_API_ENABLED = previous;
  }
});
