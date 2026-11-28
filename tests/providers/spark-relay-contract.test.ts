import test from "node:test";
import assert from "node:assert/strict";
import { LEGION_MODEL, guardLocalMessages } from "../../server/legion/model-policy";
import { makeRelayRequest, validateRelayCompletion } from "../../server/legion/spark-relay-contract";
import { checkSparkRelaySchema } from "../../server/legion/spark-relay-schema";
import { AGENT_JOB_STATUSES } from "../../shared/agent-job-status";

test("relay preserves guardrail and schema while rejecting wrong served models", () => {
  const body = { model: LEGION_MODEL, stream: false, max_tokens: 256, temperature: 0,
    messages: guardLocalMessages([{ role: "user", content: "What is 17 + 25?" }]),
    response_format: { type: "json_object" } };
  const request = makeRelayRequest(body);
  assert.deepEqual(JSON.parse(request.requestJson).messages, body.messages);
  assert.equal(JSON.parse(request.requestJson).format, "json");
  const result = { model: LEGION_MODEL, done: true, done_reason: "stop",
    message: { role: "assistant", content: '{"answer":42}' }, prompt_eval_count: 12, eval_count: 1 };
  assert.equal(validateRelayCompletion(request.requestJson, JSON.stringify(result)).choices[0].message.content, '{"answer":42}');
  assert.throws(() => validateRelayCompletion(request.requestJson, JSON.stringify({ ...result, model: "qwen3:8b" })));
});

test("schema readiness preserves whitespace inside status literals", async () => {
  const definition = `CHECK ((status = ANY (ARRAY[${AGENT_JOB_STATUSES.map(s => `'${s}'::text`).join(", ")}])))`;
  const client = (value: string) => ({ query: async () => ({
    rows: [{ convalidated: true, definition: value }],
  }) });
  assert.equal((await checkSparkRelaySchema(client(definition))).ready, true);
  assert.equal((await checkSparkRelaySchema(client(
    definition.replace("'relay_running'", "'relay_ running'")))).ready, false);
});
