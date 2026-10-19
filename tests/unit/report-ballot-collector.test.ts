import test from "node:test";
import assert from "node:assert/strict";
import { collectReportBallots } from "../../server/lib/report-ballot-collector";

test("invalid nonempty answers do not fill a seat; a valid adverse ballot does", async () => {
  const dispatched: string[] = [];
  const result = await collectReportBallots({
    candidates: ["bad", "fix", "second", "third"].map(modelId => ({ modelId })),
    attempt: async spec => {
      dispatched.push(spec.modelId);
      return { modelId: spec.modelId, provider: "fixture", ok: true, answer: "nonempty",
        reportedModel: spec.modelId, latencyMs: 0 };
    },
    valid: result => result.modelId !== "bad",
    record: async () => {},
    budgetMs: 1000, reserveMs: 10, minimumAttemptMs: 1,
  });
  assert.equal(result.complete, true);
  assert.equal(result.results.filter(r => r.ok).length, 3);
  assert.ok(dispatched.includes("fix"));
  assert.equal(result.results.find(r => r.modelId === "bad")?.ok, false);
});

test("audit failure closes admission before dispatch", async () => {
  let calls = 0;
  const result = await collectReportBallots({
    candidates: [{ modelId: "first" }],
    attempt: async () => { calls++; throw new Error("must not dispatch"); },
    valid: () => true, record: async () => { throw new Error("storage offline"); },
    budgetMs: 1000, reserveMs: 10, minimumAttemptMs: 1,
  });
  assert.equal(calls, 0);
  assert.equal(result.complete, false);
  assert.match(result.reason, /audit/);
});

test("duplicate served identities cannot fill the third seat", async () => {
  const result = await collectReportBallots({
    candidates: ["one", "alias", "two", "three"].map(modelId => ({ modelId })),
    attempt: async spec => ({ modelId: spec.modelId, provider: "fixture", ok: true, answer: "vote",
      reportedModel: spec.modelId === "alias" ? " ONE " : spec.modelId, latencyMs: 0 }),
    valid: () => true, record: async () => {},
    budgetMs: 1000, reserveMs: 10, minimumAttemptMs: 1,
  });
  assert.equal(result.complete, true);
  assert.equal(result.results.find(r => r.modelId === "alias")?.ok, false);
  assert.equal(result.results.filter(r => r.ok).length, 3);
});

test("one deadline stops ignored-abort transports; late votes are audit-only", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const events: string[] = [], calls: string[] = [];
  const pending = collectReportBallots({
    candidates: ["one", "two", "three", "fallback"].map(modelId => ({ modelId })),
    attempt: async spec => {
      calls.push(spec.modelId);
      await new Promise(resolve => setTimeout(resolve, 200));
      return { modelId: spec.modelId, provider: "fixture", ok: true, answer: "late",
        reportedModel: spec.modelId, latencyMs: 200 };
    },
    valid: () => true,
    record: async event => { events.push(event.stage); },
    budgetMs: 100, reserveMs: 10, minimumAttemptMs: 1, now: Date.now,
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  t.mock.timers.tick(90);
  const result = await pending;
  assert.equal(result.complete, false);
  assert.equal(result.reason, "deadline");
  assert.equal(result.elapsedMs, 90);
  t.mock.timers.tick(110);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(events.filter(stage => stage === "late").length, 3);
  assert.equal(result.results.length, 0);
  assert.equal(calls.length, 3, "no fallback after cutoff");
});

test("primary and replacement attempts share the report output contract and attempt cap", async () => {
  const seen: any[] = [];
  await collectReportBallots({
    candidates: Array.from({ length: 12 }, (_, n) => ({ modelId: `model-${n}`, maxTokens: 4096 })),
    attempt: async spec => { seen.push(spec); return { modelId: spec.modelId,
      provider: "fixture", ok: false, latencyMs: 0 }; },
    valid: () => false, record: async () => {},
    budgetMs: 1000, reserveMs: 10, minimumAttemptMs: 1,
  });
  assert.equal(seen.length, 9);
  assert.ok(seen.every(spec => spec.maxTokens === 8192 && spec.noRetry === true && spec.timeoutMs <= 990));
});

test("a completed seat never dispatches another candidate while another seat is still running", async () => {
  const calls: string[] = [];
  const result = await collectReportBallots({
    candidates: ["fast", "medium", "slow", "unused"].map(modelId => ({ modelId })),
    attempt: async spec => {
      calls.push(spec.modelId);
      if (spec.modelId === "slow") await new Promise(resolve => setTimeout(resolve, 20));
      return { modelId: spec.modelId, provider: "fixture", ok: true,
        answer: "valid ballot", reportedModel: spec.modelId, latencyMs: 0 };
    },
    valid: () => true, record: async () => {},
    budgetMs: 1000, reserveMs: 10, minimumAttemptMs: 1,
  });
  assert.equal(result.complete, true);
  assert.deepEqual(calls, ["fast", "medium", "slow"], "replacement is allowed only for an unfilled seat");
});
