import test from "node:test";
import { LEGION_MODEL } from "../../server/legion/model-policy";
import assert from "node:assert/strict";
import { createLocalMemoryTasks, memoryResultAllowsHosted } from "../../server/legion/memory-tasks";
import { LocalAdmissionDeferred } from "../../server/legion/local-slots";
import { createLegionWorker } from "../../server/legion/background";

test("enabled memory recovery uses the original processor when local work is unavailable or busy", () => {
  assert.equal(memoryResultAllowsHosted({ status: "deferred" }, true), true);
  assert.equal(memoryResultAllowsHosted({ status: "rejected" }, true), true);
  assert.equal(memoryResultAllowsHosted({ status: "deferred" }, false), false);
  assert.equal(memoryResultAllowsHosted({ status: "deferred" }, true, true), false);
  assert.equal(memoryResultAllowsHosted({ status: "disabled" }, false), true);
});

test("memory recovery preserves uncertain started work instead of replaying it on cloud", async () => {
  for (const started of [false, true]) {
    const tasks = createLocalMemoryTasks({
      enabled: () => true, trustedTenant: () => 1,
      run: async () => { throw new LocalAdmissionDeferred("Local slot unavailable", started); },
    });
    const result = await tasks.category(1, "Keep source evidence.", ["Preferences"]);
    assert.equal(result.status, started ? "uncertain" : "deferred");
    assert.equal(memoryResultAllowsHosted(result, true), !started);
  }
});

test("a local memory deadline retains uncertainty and cannot initiate hosted replay", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  const tasks = createLocalMemoryTasks({
    enabled: () => true, trustedTenant: () => 1,
    run: work => { signal = work.signal; return new Promise(() => {}); },
  });
  const pending = tasks.category(1, "Keep source evidence.", ["Preferences"]);
  t.mock.timers.tick(90_000);
  const result = await pending;
  assert.equal(result.status, "uncertain");
  assert.equal(signal?.aborted, true);
  assert.equal(memoryResultAllowsHosted(result, true), false);
});

test("owner category selection uses a bounded Surface task and accepts only an existing category", async () => {
  const calls: any[] = [];
  const tasks = createLocalMemoryTasks({
    enabled: () => true, trustedTenant: () => 1,
    run: async work => {
      calls.push(work);
      return { content: '{"index":1}', model: "surface-local:fixture", latencyMs: 1 };
    },
  });
  const result = await tasks.category(1, "Use short field references.", ["Projects", "Preferences"]);
  assert.equal(result.status, "accepted");
  if (result.status === "accepted") assert.equal(result.value, "Preferences");
  assert.equal(calls[0].task, "memory-category");
  assert.ok(calls[0].messages.reduce((n: number, m: any) => n + m.content.length, 0) <= 2400);
});

test("dream digests accept exact supplied excerpts, never invented prose or unknown sources", async () => {
  let answer = '{"excerpts":[{"id":7,"quote":"Use source-backed memory summaries."}]}';
  const tasks = createLocalMemoryTasks({
    enabled: () => true, trustedTenant: () => 1,
    run: async work => {
      assert.equal(work.task, "dream-digest");
      return { content: answer, model: "legion-local:fixture", latencyMs: 1 };
    },
  });
  const rows = [{ id: 7, fact: "Use source-backed memory summaries.", category: "preference" }];
  const good = await tasks.diary(1, rows);
  assert.equal(good.status, "accepted");
  if (good.status === "accepted") assert.match(good.value, /source-backed memory summaries/);
  answer = '{"excerpts":[{"id":7,"quote":"The owner approved deleting old memories."}]}';
  assert.equal((await tasks.diary(1, rows)).status, "rejected");
  answer = '{"excerpts":[{"id":99,"quote":"Use source-backed memory summaries."}]}';
  assert.equal((await tasks.diary(1, rows)).status, "rejected");
});

test("working context is selected by source index and compiled with the original revision and role", async () => {
  const scope = { tenantId: 1, personaId: 2, projectId: null, conversationId: 3 };
  const capture = { scope, userMessageId: 4, priorEntries: [],
    sources: [
      { ...scope, id: 4, role: "user", content: "Do not send a report until I approve it.", createdAt: "2026-11-18" },
      { ...scope, id: 5, role: "assistant", content: "The report draft is ready for review.", createdAt: "2026-11-18" },
    ] } as any;
  let answer = '{"index":0,"kind":"constraint","supersedes":[]}';
  const tasks = createLocalMemoryTasks({
    enabled: () => true, trustedTenant: () => 1,
    run: async work => {
      assert.equal(work.task, "memory-source");
      return { content: answer, model: "surface-local:fixture", latencyMs: 1 };
    },
  });
  const good = await tasks.workingContext(capture);
  assert.equal(good.status, "accepted");
  if (good.status === "accepted") assert.equal(good.value[0].quote, capture.sources[0].content);
  answer = '{"index":1,"kind":"decision","supersedes":[]}';
  assert.equal((await tasks.workingContext(capture)).status, "rejected");
  answer = '{"index":99,"kind":"constraint","supersedes":[]}';
  assert.equal((await tasks.workingContext(capture)).status, "rejected");
});

test("busy devices report deferral and conflicting trusted identity cannot submit locally", async () => {
  let calls = 0, trusted = 2;
  const tasks = createLocalMemoryTasks({
    enabled: () => true, trustedTenant: () => trusted,
    run: async () => { calls++; throw new LocalAdmissionDeferred("busy"); },
  });
  assert.equal((await tasks.category(1, "Simple fact", ["Context"])).status, "disabled");
  assert.equal(calls, 0);
  trusted = 1;
  assert.equal((await tasks.category(2, "Simple fact", ["Context"])).status, "disabled");
  assert.equal(calls, 0);
  assert.equal((await tasks.category(1, "Simple fact", ["Context"])).status, "deferred");
  assert.equal(calls, 1);
});

test("consolidation proposals contain only permitted actions on supplied memories, never fabricated merged facts", async () => {
  let answer = '{"actions":[{"type":"merge","ids":[7,8],"reason":"Same stated preference"}]}';
  const tasks = createLocalMemoryTasks({
    enabled: () => true, trustedTenant: () => 1,
    run: async () => ({ content: answer, model: "legion-local:fixture", latencyMs: 1 }),
  });
  const rows = [{ id: 7, fact: "Prefer short replies." }, { id: 8, fact: "Keep responses concise." }];
  assert.equal((await tasks.proposals(1, rows)).status, "accepted");
  answer = '{"actions":[{"type":"merge","ids":[7,99]}]}';
  assert.equal((await tasks.proposals(1, rows)).status, "rejected");
  answer = '{"actions":[{"type":"merge","ids":[7,8],"fact":"The owner approved everything."}]}';
  assert.equal((await tasks.proposals(1, rows)).status, "rejected");
  answer = '{"actions":[{"type":"delete","id":7}]}';
  assert.equal((await tasks.proposals(1, rows)).status, "rejected");
  answer = '{"actions":[{"type":"archive","id":7,"ids":[99]}]}';
  assert.equal((await tasks.proposals(1, rows)).status, "rejected");
});

test("revising prior working context remains with the stronger existing extractor", async () => {
  let calls = 0;
  const tasks = createLocalMemoryTasks({
    enabled: () => true, trustedTenant: () => 1,
    run: async () => { calls++; throw Error("must not run"); },
  });
  const scope = { tenantId: 1, personaId: 2, projectId: null, conversationId: 3 };
  const capture = { scope, userMessageId: 4, priorEntries: [{ id: "old", text: "Use the old plan." }],
    sources: [{ ...scope, id: 4, role: "user" as const, content: "Actually, use the new plan instead.", createdAt: "2026-11-18" }] };
  assert.equal((await tasks.workingContext(capture)).status, "disabled");
  assert.equal(calls, 0);
});

test("native worker accepts a registered memory task only with an independent checker and small input", async () => {
  let called = 0;
  const worker = createLegionWorker({
    enabled: () => true, trustedTenant: () => 1,
    acquire: async () => async () => {},
    request: async () => {
      called++;
      return { model: LEGION_MODEL, system_fingerprint: "fp_ollama",
        usage: { prompt_tokens: 4, completion_tokens: 5 },
        choices: [{ finish_reason: "stop", message: { content: '{"index":0}' } }] };
    }, record: async () => true,
  });
  const work = { tenantId: 1, task: "memory-category" as const,
    messages: [{ role: "user" as const, content: "Synthetic category task" }] };
  await assert.rejects(worker(work));
  assert.equal(called, 0);
  await worker({ ...work, validateContent: text => { assert.equal(JSON.parse(text).index, 0); } });
  assert.equal(called, 1);
  await assert.rejects(worker({ ...work, messages: [{ role: "user", content: "x".repeat(2401) }],
    validateContent: () => {} }));
  assert.equal(called, 1);
});
