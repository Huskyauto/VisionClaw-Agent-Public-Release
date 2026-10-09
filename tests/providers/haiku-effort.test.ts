import assert from "node:assert/strict";
import test from "node:test";
import { decideHaikuEffort, haikuTrialRunRequested } from "../../server/lib/haiku-effort";
import { runHaikuEffortTrial } from "../../server/lib/haiku-effort-trial";

test("simple Haiku work proposes low, unknown work keeps medium", () => {
  assert.equal(decideHaikuEffort({ model: "claude-haiku-5-5", task: "simple" })?.effort, "low");
  assert.equal(decideHaikuEffort({ model: "claude-haiku-5-5", task: "unknown" })?.effort, "medium");
});

test("trial refuses spending without reservation and a durable once-only marker", async () => {
  let calls = 0;
  const deps = {
    reserve: async () => false,
    begin: async () => true,
    call: async () => { calls++; throw new Error("must not call"); },
    record: async () => {},
  };
  await assert.rejects(runHaikuEffortTrial(deps), /TRIAL_BUDGET_DENIED/);
  await assert.rejects(runHaikuEffortTrial({ ...deps, reserve: async () => true, begin: async () => false }), /TRIAL_ALREADY_STARTED/);
  assert.equal(calls, 0);
});

test("an accepted invalid effort value stops the trial after recording that paid response", async () => {
  let calls = 0;
  let records = 0;
  const result = await runHaikuEffortTrial({
    reserve: async () => true, begin: async () => true,
    call: async () => {
      calls++;
      return { model: "claude-haiku-5-5", stop_reason: "end_turn", content: [],
        usage: { input_tokens: 35, output_tokens: 8 } };
    },
    record: async () => { records++; },
  });
  assert.equal(result.parameterValidated, false);
  assert.equal(result.status, "blocked");
  assert.equal(calls, 1);
  assert.equal(records, 1);
});

function validNativeCall(request: Record<string, unknown>) {
  if ((request.output_config as { effort: string }).effort === "__invalid_effort_canary__") {
    throw Object.assign(new Error("Invalid output_config.effort"), { status: 400 });
  }
  const prompt = (request.messages as Array<{ content: string }>)[0].content;
  const content = prompt.includes("FAULT=E17") ? [{ type: "text", text: '{"fault":"E17","count":3}' }]
    : prompt.includes("filters") ? [{ type: "text", text: '{"total":174.59}' }]
    : prompt.includes("R-009") ? [{ type: "text", text: '{"ids":["R-009","R-010"],"status":"READY"}' }]
    : [{ type: "tool_use", name: "report_reading", input: { value: 42 } }];
  return { model: "claude-haiku-5-5", stop_reason: request.tools ? "tool_use" : "end_turn",
    content, usage: { input_tokens: 200, output_tokens: 30, cache_read_input_tokens: 10, cache_creation_input_tokens: 20 } };
}

test("fixed native sweep covers all efforts, independently validates outputs, cache costs and streaming", async () => {
  let records = 0;
  const report = await runHaikuEffortTrial({
    reserve: async usd => usd === 0.05, begin: async () => true,
    call: async request => validNativeCall(request),
    record: async () => { records++; },
  });
  assert.equal(report.parameterValidated, true);
  assert.equal(report.status, "completed");
  assert.equal(report.observations.length, 13);
  assert.equal(records, 13);
  assert.ok(report.observations.every(row => row.correct && row.complete));
  assert.equal(report.observations.filter(row => row.streamed).length, 1);
  assert.equal(report.observations[0].tokensIn, 230);
  assert.ok(Math.abs(report.observations[0].costUsd! - 0.0000376) < 1e-12);
  assert.equal(report.productionEnabled, false);
});

test("transport failure is uncertain completion, never an effort-upgrade retry", async () => {
  let calls = 0;
  const report = await runHaikuEffortTrial({
    reserve: async () => true, begin: async () => true,
    call: async request => {
      calls++;
      if (calls === 1) return validNativeCall(request);
      throw Object.assign(new Error("timeout"), { status: 504 });
    },
    record: async () => {},
  });
  assert.equal(calls, 2);
  assert.equal(report.status, "incomplete");
  assert.equal(report.observations.length, 1);
  assert.equal(report.observations[0].costUsd, null);
  assert.equal(report.productionEnabled, false);
});

test("an inconclusive canary also persists unknown completion before stopping", async () => {
  let calls = 0;
  let records = 0;
  const report = await runHaikuEffortTrial({
    reserve: async () => true, begin: async () => true,
    call: async () => { calls++; throw Object.assign(new Error("timeout"), { status: 504 }); },
    record: async row => { records++; assert.equal(row.costUsd, null); },
  });
  assert.equal(report.status, "blocked");
  assert.equal(report.parameterValidated, false);
  assert.equal(calls, 1);
  assert.equal(records, 1);
  assert.equal(report.observations.length, 1);
});

test("truncation, missing usage and substituted models cannot become successful evidence", async () => {
  for (const defect of ["truncated", "missing-usage", "substituted-model"]) {
    const report = await runHaikuEffortTrial({
      reserve: async () => true, begin: async () => true,
      call: async request => {
        const response = validNativeCall(request);
        return defect === "truncated" ? { ...response, stop_reason: "max_tokens" }
          : defect === "missing-usage" ? { ...response, usage: undefined }
          : { ...response, model: "gpt-6-luna" };
      },
      record: async () => {},
    });
    assert.equal(report.status, "incomplete");
    assert.ok(report.observations.every(row => !row.correct));
    if (defect !== "truncated") assert.ok(report.observations.every(row => row.costUsd === null));
  }
});

test("manual trial stays dry by default and refuses unknown flags and production", () => {
  assert.equal(haikuTrialRunRequested([], {}), false);
  assert.equal(haikuTrialRunRequested(["--run"], {}), true);
  assert.throws(() => haikuTrialRunRequested(["--dry-run"], {}), /INVALID_TRIAL_ARGUMENTS/);
  assert.throws(() => haikuTrialRunRequested(["--run"], { nodeEnv: "production" }), /TRIAL_WORKSPACE_ONLY/);
  assert.throws(() => haikuTrialRunRequested(["--run"], { deployment: "1" }), /TRIAL_WORKSPACE_ONLY/);
});

test("effort proposals cannot change model, jury/approval authority or critical-work quality", () => {
  assert.equal(decideHaikuEffort({ model: "gpt-6-luna", task: "simple" }), null);
  assert.equal(decideHaikuEffort({ model: "claude-haiku-5-5", task: "simple", source: "jury" }), null);
  assert.equal(decideHaikuEffort({ model: "claude-haiku-5-5", task: "strict", source: "approval" }), null);
  assert.equal(decideHaikuEffort({ model: "claude-haiku-5-5", task: "strict", allowHigh: true, promptTokens: 200000 })?.effort, "high");
  assert.equal(decideHaikuEffort({ model: "claude-haiku-5-5", task: "strict", allowHigh: "true" as any })?.effort, "medium");
  const decision = decideHaikuEffort({ model: "claude-haiku-5-5", task: "multi-step", remainingBudgetFraction: 0.03 });
  assert.equal(decision?.effort, "medium");
  assert.equal(decision?.defer, true);
  assert.equal(decision?.mode, "shadow");
  assert.equal(decideHaikuEffort({ model: "claude-haiku-5-5", task: "simple", remainingBudgetFraction: NaN })?.defer, true);
});
