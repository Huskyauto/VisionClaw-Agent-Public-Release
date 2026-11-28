import test from "node:test";
import assert from "node:assert/strict";
import { LEGION_MODEL, LOCAL_GUARDRAIL_PROMPT, guardLocalMessages } from "../../server/legion/model-policy";
import { validateRoutineOutput } from "../../server/legion/routine-contract";
import { createRoutineOffload } from "../../server/legion/routine-offload";
import { createLocalBackgroundRouter } from "../../server/legion/local-router";
import { createLegionWorker } from "../../server/legion/background";

test("routine prose is not forced into memory-selector JSON mode", async () => {
  const worker = createLegionWorker({
    enabled: () => true, trustedTenant: () => 1, acquire: async () => async () => {},
    request: async (body: any) => {
      assert.equal(body.response_format, undefined);
      return { model: LEGION_MODEL, system_fingerprint: "fp_ollama",
        usage: { prompt_tokens: 5, completion_tokens: 3 },
        choices: [{ finish_reason: "stop", message: { content: "A short summary." } }] };
    }, record: async () => true,
  });
  const result = await worker({ tenantId: 1, task: "routine-summary",
    messages: [{ role: "user", content: "Summarize the supplied facts." }],
    validateContent: text => { assert.equal(text, "A short summary."); } });
  assert.equal(result.content, "A short summary.");
});

test("Mellum requests prepend Spark's standing guardrail ahead of task instructions", () => {
  const messages = [{ role: "system", content: "Extract fields." }, { role: "user", content: "source" }];
  const guarded = guardLocalMessages(messages);
  assert.equal(LEGION_MODEL, "hf.co/JetBrains/Mellum2.1-12B-A2.5B-Instruct-GGUF:MXFP4_MOE");
  assert.equal(guarded[0].role, "system");
  assert.equal(guarded[0].content, LOCAL_GUARDRAIL_PROMPT);
  assert.deepEqual(guarded.slice(1), messages);
  assert.equal(messages.length, 2);
});

test("routine inference falls back through the supplied cloud policy, never across tenants or after cancellation", async () => {
  let local = 0, cloud = 0;
  const controller = new AbortController();
  const work = { tenantId: 1, task: "routine-classification" as const,
    messages: [{ role: "user" as const, content: "Synthetic category" }],
    contract: { kind: "classification" as const, labels: ["normal"] } };
  const original = async () => { cloud++; return "normal"; };
  const offload = createRoutineOffload({
    enabled: () => true, trustedTenant: () => 1, event: () => {},
    run: async () => { local++; throw Error("Local endpoint unavailable"); },
  });
  assert.equal(await offload(work, original), "normal");
  assert.equal(local, 1); assert.equal(cloud, 1);
  await offload({ ...work, explicitCloud: true }, original);
  assert.equal(local, 1); assert.equal(cloud, 2);
  await assert.rejects(offload({ ...work, tenantId: 2 }, original), /tenant/);
  controller.abort();
  await assert.rejects(offload({ ...work, signal: controller.signal }, original));
  assert.equal(cloud, 2);
});

test("valid local results avoid cloud, and invalid classifications cannot be consumed", async () => {
  const events: any[] = [];
  let cloud = 0;
  const work = { tenantId: 1, task: "routine-classification" as const,
    messages: [{ role: "user" as const, content: "Synthetic category" }],
    contract: { kind: "classification" as const, labels: ["normal"] } };
  for (const content of ["normal", "invented"]) {
    const offload = createRoutineOffload({
      enabled: () => true, trustedTenant: () => 1, event: event => { events.push(event); },
      run: async () => ({ content, model: LEGION_MODEL }),
    });
    assert.equal(await offload(work, async () => { cloud++; return "normal"; }), "normal");
  }
  assert.equal(cloud, 1);
  assert.deepEqual(events.map(event => event.cloudCallsAvoided), [1, 0]);
  assert.equal(JSON.stringify(events).includes("Synthetic category"), false);
});

test("supervisor shutdown never starts routine cloud work without a caller signal", async () => {
  for (const beforeDispatch of [false, true]) {
    const shutdown = new AbortController();
    let cloud = 0;
    if (beforeDispatch) shutdown.abort();
    const deps = {
      enabled: () => true, trustedTenant: () => 1, event: () => {},
      shutdownSignal: () => shutdown.signal,
      run: async () => { shutdown.abort(); throw new DOMException("Shutdown", "AbortError"); },
    };
    const offload = createRoutineOffload(deps);
    await assert.rejects(offload({
      tenantId: 1, task: "routine-classification",
      messages: [{ role: "user", content: "Synthetic task" }],
      contract: { kind: "classification", labels: ["normal"] },
    }, async () => { cloud++; return "normal"; }));
    assert.equal(cloud, 0);
  }
});

test("a hanging local task is aborted at the total deadline and recovers once", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let localSignal: AbortSignal | undefined;
  let cloud = 0;
  const offload = createRoutineOffload({
    enabled: () => true, trustedTenant: () => 1, event: () => {},
    run: work => { localSignal = work.signal; return new Promise(() => {}); },
  });
  const pending = offload({ tenantId: 1, task: "routine-classification",
    messages: [{ role: "user", content: "Synthetic task" }],
    contract: { kind: "classification", labels: ["normal"] },
  }, async () => { cloud++; return "normal"; });
  t.mock.timers.tick(30_000);
  assert.equal(await pending, "normal");
  assert.equal(localSignal?.aborted, true);
  assert.equal(cloud, 1);
});

test("local validation retry is bounded to two attempts and preserves the standing prompt", async () => {
  let generated = 0;
  const router = createLocalBackgroundRouter({
    surfaceEnabled: () => false, surfaceHealth: async () => {}, legionHealth: async () => {},
    surfaceGenerate: async () => { throw Error("Surface must not be used"); },
    legionRetryModels: [LEGION_MODEL],
    legionGenerate: async body => {
      generated++;
      assert.equal(body.messages[0].content, LOCAL_GUARDRAIL_PROMPT);
      return { content: generated === 1 ? "bad" : "normal" };
    },
  });
  const result = await router({ model: LEGION_MODEL,
    messages: guardLocalMessages([{ role: "user", content: "Classify." }]) }, async candidate => {
    validateRoutineOutput(candidate.response.content, { kind: "classification", labels: ["normal"] });
  });
  assert.equal(result.response.content, "normal");
  assert.equal(generated, 2);
});

test("two rejected Lenovo validations cannot create an unbounded third attempt", async () => {
  let generated = 0;
  const router = createLocalBackgroundRouter({
    surfaceEnabled: () => false, surfaceHealth: async () => {}, legionHealth: async () => {},
    surfaceGenerate: async () => { throw Error("Surface must not run"); },
    legionRetryModels: [LEGION_MODEL],
    legionGenerate: async () => { generated++; return { content: "wrong" }; },
  });
  await assert.rejects(router({ model: LEGION_MODEL, messages: [] }, async () => {
    throw Error("Invalid deterministic answer");
  }));
  assert.equal(generated, 2);
});

test("routine contracts reject invalid JSON, unknown labels and unsupported field types", () => {
  assert.deepEqual(validateRoutineOutput('{"name":"Bob","count":2}', {
    kind: "extraction", fields: { name: "string", count: "number" },
  }), { name: "Bob", count: 2 });
  for (const bad of ['{"name":"Bob"}', '{"name":"Bob","count":"2"}', "not JSON"]) {
    assert.throws(() => validateRoutineOutput(bad, {
      kind: "extraction", fields: { name: "string", count: "number" },
    }));
  }
  assert.equal(validateRoutineOutput(" urgent \n", { kind: "classification", labels: ["urgent", "normal"] }), "urgent");
  assert.throws(() => validateRoutineOutput("probably urgent", { kind: "classification", labels: ["urgent"] }));
});
