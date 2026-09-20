import assert from "node:assert/strict";
import { test } from "node:test";
import { COST_LEDGER_RECORDED } from "../../server/providers";
import { runCostEvalSuite } from "../../server/cost-eval-runner";

function completion(content: string, recorded: boolean) {
  const result: any = {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
  Object.defineProperty(result, COST_LEDGER_RECORDED, { value: recorded });
  return result;
}

test("judge failures make the evaluated query incomplete", async () => {
  const result = await runCostEvalSuite(
    { model: "gpt-5-mini" },
    {
      queries: ["one"],
      judgeModel: "judge",
      requireLedgerPersistence: true,
      deps: {
        getClientForModel: async (model: string) => ({
          actualModelId: model,
          client: {
            chat: {
              completions: {
                create: async () => {
                  if (model === "judge") throw new Error("judge unavailable");
                  return completion("candidate answer", true);
                },
              },
            },
          },
        }),
      },
    },
  );

  assert.equal(result.successCount, 0);
  assert.equal(result.failureCount, 1);
  assert.match(result.perQuery[0].error || "", /judge unavailable/);
  assert.equal(result.perQuery[0].tokensIn, 10);
  assert.equal(result.perQuery[0].tokensOut, 5);
  assert.ok(result.perQuery[0].costUsd > 0);
});

test("expert evaluation fails a query when provider usage was not durably ledgered", async () => {
  const result = await runCostEvalSuite(
    { model: "candidate" },
    {
      queries: ["one"],
      requireLedgerPersistence: true,
      deps: {
        getClientForModel: async (model: string) => ({
          actualModelId: model,
          client: {
            chat: {
              completions: {
                create: async () => completion(model === "candidate" ? "answer" : "8", false),
              },
            },
          },
        }),
      },
    },
  );

  assert.equal(result.successCount, 0);
  assert.equal(result.failureCount, 1);
  assert.match(result.perQuery[0].error || "", /usage record was not persisted/);
});

test("empty candidate output is incomplete evidence, not a successful zero score", async () => {
  const result = await runCostEvalSuite(
    { model: "candidate" },
    {
      queries: ["one"],
      requireLedgerPersistence: true,
      deps: {
        getClientForModel: async (model: string) => ({
          actualModelId: model,
          client: {
            chat: {
              completions: {
                create: async () => completion("", true),
              },
            },
          },
        }),
      },
    },
  );

  assert.equal(result.successCount, 0);
  assert.equal(result.failureCount, 1);
  assert.match(result.perQuery[0].error || "", /candidate response was empty or too short/);
});

test("malformed judge output is incomplete evidence, not a valid zero score", async () => {
  const result = await runCostEvalSuite(
    { model: "candidate" },
    {
      queries: ["one"],
      judgeModel: "judge",
      requireLedgerPersistence: true,
      deps: {
        getClientForModel: async (model: string) => ({
          actualModelId: model,
          client: {
            chat: {
              completions: {
                create: async () => completion(
                  model === "judge" ? "unable to score" : "candidate answer",
                  true,
                ),
              },
            },
          },
        }),
      },
    },
  );

  assert.equal(result.successCount, 0);
  assert.equal(result.failureCount, 1);
  assert.match(result.perQuery[0].error || "", /judge returned no parseable score/);
});

test("empty judge output is incomplete evidence, not a synthetic zero score", async () => {
  const result = await runCostEvalSuite(
    { model: "candidate" },
    {
      queries: ["one"],
      judgeModel: "judge",
      requireLedgerPersistence: true,
      deps: {
        getClientForModel: async (model: string) => ({
          actualModelId: model,
          client: {
            chat: {
              completions: {
                create: async () => completion(
                  model === "judge" ? "" : "candidate answer",
                  true,
                ),
              },
            },
          },
        }),
      },
    },
  );

  assert.equal(result.successCount, 0);
  assert.equal(result.failureCount, 1);
  assert.match(result.perQuery[0].error || "", /judge returned no parseable score/);
});

test("ledger-required evaluation rejects missing provider usage instead of estimating it", async () => {
  const result = await runCostEvalSuite(
    { model: "candidate" },
    {
      queries: ["one"],
      requireLedgerPersistence: true,
      deps: {
        getClientForModel: async (model: string) => ({
          actualModelId: model,
          client: {
            chat: {
              completions: {
                create: async () => {
                  const response: any = { choices: [{ message: { content: "answer" } }] };
                  Object.defineProperty(response, COST_LEDGER_RECORDED, { value: true });
                  return response;
                },
              },
            },
          },
        }),
      },
    },
  );

  assert.equal(result.failureCount, 1);
  assert.match(result.perQuery[0].error || "", /candidate usage was missing or invalid/);
});

test("expert streaming evaluation records TTFT and output throughput from one accounted stream", async () => {
  const result = await runCostEvalSuite(
    { model: "gpt-5-mini" },
    {
      queries: ["one"],
      judgeModel: "judge",
      requireLedgerPersistence: true,
      measureStreaming: true,
      deps: {
        now: (() => {
          const times = [0, 100, 125, 175, 175, 175, 175];
          return () => times.shift() ?? 175;
        })(),
        getClientForModel: async (model: string) => ({
          actualModelId: model,
          client: {
            chat: {
              completions: {
                create: async (params: any) => {
                  if (model === "judge") return completion("8", true);
                  assert.equal(params.stream, true);
                  async function* chunks() {
                    yield { choices: [{ delta: { content: "candidate " } }] };
                    yield {
                      choices: [{ delta: { content: "answer" } }],
                      usage: { prompt_tokens: 10, completion_tokens: 5 },
                    };
                  }
                  const stream: any = chunks();
                  Object.defineProperty(stream, COST_LEDGER_RECORDED, { value: true });
                  return stream;
                },
              },
            },
          },
        }),
      },
    },
  );

  assert.equal(result.failureCount, 0);
  assert.equal(result.perQuery[0].ttftMs, 25);
  assert.equal(result.perQuery[0].streamDurationMs, 75);
  assert.equal(result.perQuery[0].outputTokensPerSecond, 100);
  assert.equal(result.ttftMsAvg, 25);
  assert.equal(result.streamDurationMsAvg, 75);
});