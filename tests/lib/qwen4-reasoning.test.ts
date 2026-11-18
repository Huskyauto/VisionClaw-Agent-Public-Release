import test from "node:test";
import assert from "node:assert/strict";
import { wrapClientWithParamAdaptation } from "../../server/lib/param-adaptation";

test("Qwen4 gets supported reasoning efforts without mutating caller params", async () => {
  const client = wrapClientWithParamAdaptation({ chat: { completions: { create: async (p: any) => p } } });
  const input = { model: "qwen/qwen4-max", reasoning_effort: "medium", reasoning: { effort: "minimal" }, max_tokens: 1024 };
  const sent = await client.chat.completions.create(input);
  assert.equal(sent.reasoning_effort, "high");
  assert.equal(sent.reasoning.effort, "low");
  assert.equal(sent.max_tokens, 1024);
  assert.equal(input.reasoning_effort, "medium");
  assert.equal(input.reasoning.effort, "minimal");
  const other = { model: "moonshotai/kimi-k3.1-pro", reasoning_effort: "medium" };
  assert.deepEqual(await client.chat.completions.create(other), other);
});
