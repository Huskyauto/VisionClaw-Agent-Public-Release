import test from "node:test";
import assert from "node:assert/strict";
import { buildPatchedCreate, COST_LEDGER_RECORDED, wrapProfundoFailureMarking } from "../../server/providers";
import { getUnhealthyProviders, resetProviderHealth } from "../../server/provider-recovery";
import { wrapProfundoTransientRetry } from "../../server/lib/profundo-transient-retry";

test("production retry/health/accounting composition records recovered usage once and marks only final failures", async () => {
  resetProviderHealth("profundo");
  let requests = 0;
  let terminal = false;
  const records: any[] = [];
  const bodies: any[] = [];
  const source = { chat: { completions: { create: async (body: any, options: any) => {
    requests++;
    bodies.push(body);
    assert.equal(options.maxRetries, 0);
    assert.equal("profundoRetry" in options, false);
    if (terminal || requests % 2 === 1) {
      throw Object.assign(new Error("busy"), { status: 503, headers: new Headers({ "retry-after": "30" }) });
    }
    return { model: "gpt-5.6-sol", choices: [{ message: { content: "ONLINE" } }],
      usage: { prompt_tokens: 10, completion_tokens: 2 } };
  } } } };
  const wrapped = wrapProfundoFailureMarking(wrapProfundoTransientRetry(source, { sleep: async () => {} }) as any);
  const create = buildPatchedCreate(wrapped.chat.completions.create.bind(wrapped.chat.completions),
    () => "gpt-5.6-sol", () => 1, "llm.profundo",
    async row => { records.push(row); return true; });
  try {
    for (let i = 0; i < 3; i++) {
      const response = await create({ model: "gpt-5.6-sol", max_tokens: 16384, messages: [] },
        { profundoRetry: true, maxRetries: 0 });
      assert.equal(response[COST_LEDGER_RECORDED], true);
      assert.equal(bodies[i * 2], bodies[i * 2 + 1], "Retry preserves exact normalized request");
    }
    assert.equal(requests, 6);
    assert.equal(records.length, 3);
    assert.ok(records.every(row => row.tenantId === 1 && row.costUsd === 0));
    assert.equal(getUnhealthyProviders().has("profundo"), false);
    terminal = true;
    for (let i = 0; i < 3; i++) {
      await assert.rejects(create({ model: "gpt-5.6-sol", messages: [] },
        { profundoRetry: true, maxRetries: 0 }), /busy/);
    }
    assert.equal(requests, 12, "Only two HTTP attempts per logical call");
    assert.equal(records.length, 3, "Rejected attempts do not duplicate received usage");
    assert.equal(getUnhealthyProviders().has("profundo"), true);
  } finally {
    resetProviderHealth("profundo");
  }
});
