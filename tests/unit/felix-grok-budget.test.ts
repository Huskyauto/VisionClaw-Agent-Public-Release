import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import { wrapFelixGrokBudget } from "../../server/felix-grok-budget";

const RECORDED = Symbol.for("visionclaw.cost-ledger-recorded");

test("paid Grok claims before request, caps output, and settles only after ledger success", async () => {
  const order: string[] = [];
  const client = {
    chat: { completions: { create: async (params: any) => {
      order.push("send");
      assert.equal(params.max_completion_tokens, 8192);
      assert.equal(params.max_tokens, undefined);
      return { [RECORDED]: true };
    } } },
  } as unknown as OpenAI;
  const wrapped = wrapFelixGrokBudget(client, 1, {
    reserve: async (tenantId) => { assert.equal(tenantId, 1); order.push("reserve"); return 19; },
    settle: async (tenantId, id) => { assert.equal(tenantId, 1); assert.equal(id, 19); order.push("settle"); },
  });
  await wrapped.chat.completions.create({ model: "grok-4.7", messages: [], max_completion_tokens: 65536 } as any);
  assert.deepEqual(order, ["reserve", "send", "settle"]);
});

test("failed and unrecorded requests keep their reservation; unauthorized model and stream never spend", async () => {
  let claims = 0;
  let settles = 0;
  const client = {
    chat: { completions: { create: async () => ({}) } },
  } as unknown as OpenAI;
  const wrapped = wrapFelixGrokBudget(client, 1, {
    reserve: async () => { claims++; return claims; },
    settle: async () => { settles++; },
  });
  await assert.rejects(
    wrapped.chat.completions.create({ model: "gpt-5.4", messages: [] } as any),
    /only non-streaming Grok/,
  );
  await assert.rejects(
    wrapped.chat.completions.create({ model: "grok-4.7", stream: true, messages: [] } as any),
    /only non-streaming Grok/,
  );
  assert.equal(claims, 0);
  await assert.rejects(
    wrapped.chat.completions.create({ model: "grok-4.7", messages: [] } as any),
    /paid response lacked a persisted usage record/,
  );
  assert.equal(claims, 1);
  assert.equal(settles, 0);
});

test("a failed claim cannot trigger a paid provider call", async () => {
  let sent = false;
  const client = {
    chat: { completions: { create: async () => { sent = true; return {}; } } },
  } as unknown as OpenAI;
  const wrapped = wrapFelixGrokBudget(client, 1, {
    reserve: async () => { throw new Error("daily spending ceiling reached"); },
  });
  await assert.rejects(
    wrapped.chat.completions.create({ model: "grok-4.7", messages: [] } as any),
    /daily spending ceiling/,
  );
  assert.equal(sent, false);
});