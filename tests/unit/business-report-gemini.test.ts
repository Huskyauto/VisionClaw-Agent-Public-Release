import test from "node:test";
import assert from "node:assert/strict";
import { callReportGemini, reportCompilerFailureKind } from "../../server/lib/business-report-gemini";

test("compiler deadline is explicit, aborts once, retains its reservation, and never resends", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reserved = 0, dispatched = 0, aborted = 0, checkpointed = 0;
  const pending = callReportGemini(1, "safe retained compilation", {}, {
    reserve: async () => { reserved++; },
    request: async (_body, signal) => {
      dispatched++;
      signal.addEventListener("abort", () => { aborted++; }, { once: true });
      return new Promise(() => {});
    },
    checkpoint: async () => { checkpointed++; },
    record: async () => true,
  });
  const rejected = assert.rejects(pending, error => {
    assert.equal(reportCompilerFailureKind(error), "deadline");
    return true;
  });
  for (let n = 0; n < 8; n++) await Promise.resolve();
  t.mock.timers.tick(480_000);
  await rejected;
  assert.deepEqual({ reserved, dispatched, aborted, checkpointed },
    { reserved: 1, dispatched: 1, aborted: 1, checkpointed: 0 });
  assert.equal(reportCompilerFailureKind(new Error("private provider text")), "unclassified");
});

test("a substantial report may finish after two minutes without a replacement dispatch", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0, respond!: (value: any) => void;
  const work = callReportGemini(1, "retained substantial report", {}, {
    reserve: async () => {}, checkpoint: async () => {}, record: async () => true,
    request: async () => { calls++; return new Promise(resolve => { respond = resolve; }); },
  });
  const outcome = work.then(value => ({ value, error: null }), error => ({ value: null, error }));
  for (let n = 0; n < 8; n++) await Promise.resolve();
  t.mock.timers.tick(180_000);
  respond({ modelVersion: "gemini-4-argon", candidates: [{ finishReason: "STOP",
    content: { parts: [{ text: JSON.stringify({ report: "retained complete report" }) }] } }] });
  const result = await outcome;
  assert.equal(result.error, null, "the old 120-second deadline must not kill a healthy long compilation");
  assert.equal(calls, 1);
  assert.deepEqual(result.value?.report, { report: "retained complete report" });
});

test("lost compiler lease aborts a long paid request without redispatch or a checkpoint", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let checks = 0, calls = 0, aborted = 0, saved = 0;
  const work = callReportGemini(1, "retained substantial report", {}, {
    assertLive: async () => { if (++checks > 2) throw new Error("lease fenced"); },
    reserve: async () => {}, checkpoint: async () => { saved++; }, record: async () => true,
    request: async (_body, signal) => {
      calls++;
      signal.addEventListener("abort", () => { aborted++; }, { once: true });
      return new Promise(() => {});
    },
  });
  const outcome = assert.rejects(work, error => {
    assert.equal(reportCompilerFailureKind(error), "admission");
    return true;
  });
  for (let n = 0; n < 12; n++) await Promise.resolve();
  t.mock.timers.tick(30_000);
  await outcome;
  assert.deepEqual({ calls, aborted, saved }, { calls: 1, aborted: 1, saved: 0 });
});

test("a retained truncated response still records its paid usage once under its operation identity", async () => {
  const entries: any[] = [];
  await assert.rejects(callReportGemini(1, "retained substantial report", {}, {
    reserve: async () => {}, checkpoint: async () => {}, operationKey: "report-compiler:fixture:attempt-2",
    record: async entry => { entries.push(entry); return true; },
    request: async () => ({ modelVersion: "gemini-4-argon",
      candidates: [{ finishReason: "MAX_TOKENS" }],
      usageMetadata: { promptTokenCount: 34267, candidatesTokenCount: 16384 } }),
  }), /incomplete/);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].tokensIn, 34267);
  assert.equal(entries[0].tokensOut, 16384);
  assert.equal(entries[0].idempotencyKey, "report-compiler:fixture:attempt-2");
});

test("direct compiler reserves before Google dispatch and requires the served Argon identity", async () => {
  const events: string[] = [];
  const result = await callReportGemini(1, "compile retained report", {}, {
    reserve: async amount => { assert.ok(amount > 0 && amount < 3); events.push("reserve"); },
    checkpoint: async response => { events.push("checkpoint"); assert.match(response.rawBody, /gemini-4-argon/); },
    request: async (body, signal) => {
      assert.equal(body.generationConfig.maxOutputTokens, 32768);
      events.push("google");
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "LOW");
      assert.deepEqual(body.generationConfig.responseFormat, {
        text: { mimeType: "APPLICATION_JSON", schema: {} },
      });
      assert.equal(body.generationConfig.responseJsonSchema, undefined);
      assert.equal(body.generationConfig.responseMimeType, undefined);
      assert.ok(signal instanceof AbortSignal);
      return { modelVersion: "gemini-4-argon", candidates: [{
        finishReason: "STOP", content: { parts: [{ text: '{"sections":[]}' }] },
      }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, thoughtsTokenCount: 5 } };
    },
    record: async () => true,
  });
  assert.deepEqual(events, ["reserve", "google", "checkpoint"]);
  assert.equal(result.report.sections.length, 0);
  assert.equal(result.receipt.reportedModel, "gemini-4-argon");
  assert.equal(result.receipt.tokensOut, 15);
});

test("compiler refuses other tenants, reservation failure, aliases, truncation and invalid JSON without retry", async () => {
  let calls = 0;
  let checkpoints = 0;
  const base = { reserve: async () => {}, record: async () => true,
    checkpoint: async (response: any) => { checkpoints++; assert.ok(response.rawBody); },
    request: async () => { calls++; return { modelVersion: "gemini-3-flash" }; } };
  await assert.rejects(callReportGemini(2, "safe", {}, base), /owner/);
  assert.equal(calls, 0);
  await assert.rejects(callReportGemini(1, "safe", {}, {
    ...base, reserve: async () => { throw new Error("budget refused"); },
  }), /budget refused/);
  assert.equal(calls, 0);
  await assert.rejects(callReportGemini(1, "safe", {}, base), /identity/);
  assert.equal(calls, 1);
  for (const [finishReason, text] of [["MAX_TOKENS", "{}"], ["STOP", "not JSON"]]) {
    await assert.rejects(callReportGemini(1, "safe", {}, { ...base,
      request: async () => { calls++; return { modelVersion: "gemini-4-argon",
        candidates: [{ finishReason, content: { parts: [{ text }] } }] }; },
    }));
  }
  assert.equal(calls, 3);
  assert.equal(checkpoints, 3, "Retain response bytes even for alias, truncation and malformed candidate failures");
});

test("even malformed HTTP JSON is checkpointed before parsing and checkpoint failure never retries", async () => {
  let retained = "", calls = 0;
  await assert.rejects(callReportGemini(1, "safe", {}, {
    reserve: async () => {}, record: async () => true,
    request: async () => { calls++; return { rawBody: "not HTTP JSON", httpStatus: 200 }; },
    checkpoint: async response => { retained = response.rawBody; },
  }), /invalid response body/);
  assert.equal(retained, "not HTTP JSON");
  assert.equal(calls, 1);
  await assert.rejects(callReportGemini(1, "safe", {}, {
    reserve: async () => {}, record: async () => true,
    request: async () => { calls++; return { modelVersion: "gemini-4-argon" }; },
    checkpoint: async () => { throw new Error("checkpoint lease lost"); },
  }), /checkpoint lease lost/);
  assert.equal(calls, 2);
});

test("Google decoder receives shape-only schema while the authoritative contract is not mutated", async () => {
  const schema = { type: "object", required: ["report"], additionalProperties: false,
    properties: { report: { type: "array", minItems: 3, maxItems: 30,
      items: { type: "object", additionalProperties: false, required: ["maxItems"],
        properties: { maxItems: { type: "string", minLength: 10, maxLength: 1200, pattern: "^safe", format: "uuid" } } } } } };
  const original = JSON.stringify(schema);
  await callReportGemini(1, "The full authoritative replyContract remains in this prompt.", schema, {
    reserve: async () => {}, checkpoint: async () => {}, record: async () => true,
    request: async body => {
      assert.deepEqual(body.generationConfig.responseFormat.text.schema, {
        type: "object", required: ["report"], additionalProperties: false,
        properties: { report: { type: "array", items: { type: "object",
          additionalProperties: false, required: ["maxItems"],
          properties: { maxItems: { type: "string" } } } } },
      });
      return { modelVersion: "gemini-4-argon", candidates: [{ finishReason: "STOP",
        content: { parts: [{ text: "{}" }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
    },
  });
  assert.equal(JSON.stringify(schema), original, "Do not weaken shared runtime/source/quality validators");
});
