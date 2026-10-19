import test from "node:test";
import assert from "node:assert/strict";
import { readReflectionSource, reflectionReady, runReflectionOwnerWork } from "../../server/lib/reflection-owner-work";
import { withTenantContext } from "../../server/lib/tenant-context";

const env = {
  REFLECTION_API_KEY: "fixture-not-a-real-key",
  REFLECTION_OWNER_WORK_ENABLED: "1",
  REFLECTION_FREE_APPROVED_UNTIL: "2099-01-01T00:00:00Z",
};

test("Reflection refuses customers, arbitrary prompts, expired approval and unsafe source identities before inference", async () => {
  assert.equal(reflectionReady(env), true);
  assert.equal(reflectionReady({ ...env, REFLECTION_OWNER_WORK_ENABLED: "true" }), false);
  assert.equal(reflectionReady({ ...env, REFLECTION_FREE_APPROVED_UNTIL: "2000-01-01T00:00:00Z" }), false);
  let calls = 0;
  const complete = async () => { calls++; throw new Error("must not call"); };
  await assert.rejects(runReflectionOwnerWork({ tenantId: 2, task: "review-source", sourcePath: "server/lib/knowledge-compile.ts" }, { env, complete }));
  await withTenantContext({ tenantId: 2, source: "session" }, async () => {
    await assert.rejects(runReflectionOwnerWork({
      tenantId: 1, task: "review-source", sourcePath: "server/lib/knowledge-compile.ts",
    }, { env, complete, record: async () => true }), /tenant context/);
  });
  for (const sourcePath of [".env", "uploads/customer.ts", "data/customer.ts", "/etc/passwd",
    "server/../data/customer.ts", "server//lib/knowledge-compile.ts", "server/lib/knowledge-compile.ts?prompt=secret"]) {
    await assert.rejects(readReflectionSource(sourcePath));
  }
  await assert.rejects(runReflectionOwnerWork({
    tenantId: 1, task: "review-source", sourcePath: "server/lib/knowledge-compile.ts",
    messages: [{ role: "user", content: "customer data" }],
  } as any, { env, complete }));
  assert.equal(calls, 0);
});

test("Reflection accepts only source-grounded extractive concepts and bounded task-owned requests", async () => {
  const source = await readReflectionSource(".agents/skills/tdd/SKILL.md");
  const entries: any[] = [];
  const makeResponse = (overrides: any = {}) => ({
    model: "Beam-1.0-501B-A23B",
    choices: [{ finish_reason: "stop", message: {
      content: JSON.stringify({ concepts: [{ key: "test-first", title: "Test first", lineRanges: [{ start: 1, end: 2 }] }] }),
    } }],
    usage: { prompt_tokens: 30, completion_tokens: 20 }, ...overrides,
  });
  const request = { tenantId: 1 as const, task: "compile-runbook" as const, sourcePath: ".agents/skills/tdd/SKILL.md" as const };
  const record = async (entry: any) => { entries.push(entry); return true; };
  const result = await runReflectionOwnerWork(request, { env, record, complete: async payload => {
    assert.equal(payload.model, "Beam-1.0-501B-A23B");
    assert.equal(payload.reasoning_effort, "low");
    assert.equal(payload.max_completion_tokens, 2048);
    assert.equal(payload.stream, false);
    assert.equal(payload.store, false);
    assert.equal(payload.messages.length, 2);
    assert.equal(payload.tools, undefined);
    return { response: makeResponse(), retention: "standard" };
  } });
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.sourceSha256, source.sha256);
  assert.ok("concepts" in result.result);
  assert.equal(result.result.concepts[0].quotes[0], source.text.split("\n").slice(0, 2).join("\n"));
  assert.equal(entries[0].tenantId, 1);
  assert.equal(entries[0].tokensIn, 30);
  for (const [response, retention] of [
    [makeResponse({ model: "other-model" }), "standard"],
    [makeResponse({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }), "standard"],
    [makeResponse(), "contributor"],
    [makeResponse(), null],
    [makeResponse({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      concepts: [{ key: "invented-fact", title: "Invented", quotes: ["a fabricated quotation absent from the source"] }],
    }) } }] }), "standard"],
    [makeResponse({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      concepts: [{ key: "bad-lines", title: "Bad range", lineRanges: [{ start: 999, end: 1000 }] }],
    }) } }] }), "standard"],
  ] as const) {
    await assert.rejects(runReflectionOwnerWork(request, { env, record, complete: async () => ({ response, retention }) }));
  }
  assert.equal(entries.length, 7, "Rejected inference still consumes tokens and must be recorded");
});

test("Reflection errors never echo provider or parser values and cannot start simultaneous requests", async () => {
  const request = { tenantId: 1 as const, task: "review-source" as const, sourcePath: "server/lib/knowledge-compile.ts" as const };
  await assert.rejects(runReflectionOwnerWork(request, { env, record: async () => true, complete: async () => {
    throw new Error("private-provider-error-value");
  } }), e => e instanceof Error && !e.message.includes("private-provider"));
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const first = runReflectionOwnerWork(request, { env, record: async () => true, complete: async () => {
    entered(); await hold; throw new Error("private-value");
  } });
  const firstRejected = assert.rejects(first);
  await started;
  await assert.rejects(runReflectionOwnerWork(request, { env }), /in-flight/);
  release();
  await firstRejected;
});

test("Reflection accounting failure stays visible without discarding valid advice or repeating inference", async () => {
  const source = await readReflectionSource("server/lib/standard-compute.ts");
  let calls = 0;
  const result = await runReflectionOwnerWork({
    tenantId: 1, task: "draft-tests", sourcePath: "server/lib/standard-compute.ts",
  }, { env, record: async () => { throw new Error("private-ledger-value"); }, complete: async () => {
    calls++;
    return { retention: "standard", response: {
      model: "Beam-1.0-501B-A23B", usage: { prompt_tokens: 10, completion_tokens: 20 },
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        summary: "Advisory test ideas requiring independent verification",
        suggestions: [{ text: "Check owner access is required before making requests.", evidenceQuote: source.text.slice(0, 60) }],
      }) } }],
    } };
  } });
  assert.equal(result.usageRecorded, false);
  assert.equal(calls, 1);
});
