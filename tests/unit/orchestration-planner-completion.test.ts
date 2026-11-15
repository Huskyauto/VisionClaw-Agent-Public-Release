import test from "node:test";
import assert from "node:assert/strict";
import { completeOrchestrationPlan } from "../../server/lib/orchestration-planner-completion";

test("the actual Wonder planner request has reasoning headroom and returns a visible plan", async () => {
  let dispatched: any;
  const result = await completeOrchestrationPlan("Make a two-step plan", "gpt-5.6-sol", 1,
    async (_requested, tenantId) => {
      assert.equal(tenantId, 1);
      return { actualModelId: "muse-wonder-1.0", client: { chat: { completions: {
        create: async (params: any) => {
          dispatched = params;
          return { choices: [{ message: { content: '[{"task_id":1}]' } }] };
        },
      } } } };
    });
  assert.equal(dispatched.max_completion_tokens, 16384);
  assert.equal(dispatched.model, "muse-wonder-1.0");
  assert.ok(result.choices[0].message.content);
});

test("a failed dispatched Meta planner never replays through another requested alias", async () => {
  let calls = 0;
  await assert.rejects(() => completeOrchestrationPlan("Make a plan", "gpt-5.6-sol", 1,
    async () => ({ actualModelId: "muse-wonder-1.0", client: { chat: { completions: {
      create: async () => { calls++; throw new Error("Meta output budget exhausted; no automatic replay"); },
    } } } })), /budget exhausted/);
  assert.equal(calls, 1);
});

test("ordinary planner recovery tries each actual model only once", async () => {
  const dispatched: string[] = [];
  const result = await completeOrchestrationPlan("Make a plan", "missing-model", 8,
    async requested => {
      const actualModelId = requested === "claude-sonnet-4-5" ? "claude-sonnet-4-5" : "gpt-5.4";
      return { actualModelId, client: { chat: { completions: { create: async () => {
        dispatched.push(actualModelId);
        if (actualModelId === "gpt-5.4") throw new Error("503 unavailable");
        return { choices: [{ message: { content: "[]" } }] };
      } } } } };
    });
  assert.deepEqual(dispatched, ["gpt-5.4", "claude-sonnet-4-5"]);
  assert.equal(result.choices[0].message.content, "[]");
});
