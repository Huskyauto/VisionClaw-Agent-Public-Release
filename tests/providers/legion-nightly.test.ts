import test from "node:test";
import assert from "node:assert/strict";
import { LocalAdmissionDeferred } from "../../server/legion/local-slots";
import { legionNightWindow, runLocalRunbookJob, LegionJobWaiting, LegionJobRejected } from "../../server/legion/nightly-policy";
import { compileLegionRunbook } from "../../server/legion/runbook";
import { LegionSourceChanged } from "../../server/legion/runbook-source";

test("queue capacity deferral never refunds a generation that already happened", async () => {
  const fixture = { id: 99, kind: "legion_runbook_compile", tenantId: 1, attempts: 1,
    payload: { tenantId: 1, environment: "development", sourcePath: ".agents/skills/zoom-out/SKILL.md",
      sourceSha256: "a".repeat(64), window: "2026-11-17" } };
  let started = false;
  const deps = { enabled: () => true, ready: () => true, environment: () => "development",
    read: async () => ({ sha256: "a".repeat(64), text: "Inspect the real caller before editing." }),
    health: async () => {}, compile: async () => { throw new LocalAdmissionDeferred("busy", started); } };
  await assert.rejects(runLocalRunbookJob(fixture, deps), LegionJobWaiting);
  started = true;
  await assert.rejects(runLocalRunbookJob(fixture, deps), error =>
    error instanceof Error && !(error instanceof LegionJobWaiting) && /real attempt/.test(error.message));
});

test("night windows use Chicago calendar time, catch up before 2AM and survive DST", () => {
  assert.equal(legionNightWindow(new Date("2026-11-16T07:59:00Z")), "2026-11-15");
  assert.equal(legionNightWindow(new Date("2026-11-16T08:00:00Z")), "2026-11-16");
  assert.equal(legionNightWindow(new Date("2026-03-08T08:00:00Z")), "2026-03-08");
  assert.equal(legionNightWindow(new Date("2026-11-01T07:30:00Z")), "2026-10-31");
  assert.throws(() => legionNightWindow(new Date("invalid")));
});

const job = { id: 42, kind: "legion_runbook_compile", tenantId: 1, attempts: 1,
  payload: { tenantId: 1, environment: "development", sourcePath: ".agents/skills/zoom-out/SKILL.md",
    sourceSha256: "a".repeat(64), window: "2026-11-16" } };

test("offline jobs wait before generation; forged scopes never reach source or inference", async () => {
  let generations = 0, reads = 0;
  const deps = { enabled: () => true, ready: () => true, environment: () => "development",
    read: async () => { reads++; return { sha256: "a".repeat(64) }; },
    health: async () => { throw new Error("offline"); },
    compile: async () => { generations++; throw new Error("must not run"); } };
  await assert.rejects(runLocalRunbookJob(job, deps), LegionJobWaiting);
  assert.equal(generations, 0);
  const readCount = reads;
  for (const forged of [
    { ...job, tenantId: 2 }, { ...job, payload: { ...job.payload, tenantId: 2 } },
    { ...job, payload: { ...job.payload, environment: "production" } },
    { ...job, payload: { ...job.payload, sourcePath: "data/customers.json" } },
  ]) await assert.rejects(runLocalRunbookJob(forged, deps), LegionJobRejected);
  assert.equal(reads, readCount);
  assert.equal(generations, 0);
});

test("queued results require the exact local model and independently grounded source excerpts", async () => {
  const quote = "Inspect the real caller before changing code.";
  const deps = { enabled: () => true, ready: () => true, environment: () => "development",
    read: async () => ({ sha256: "a".repeat(64), text: quote }),
    health: async () => ({}),
    compile: async () => ({ sourceSha256: "a".repeat(64), model: "hosted",
      concepts: [{ key: "caller-check", title: "Caller check", quotes: [quote] }] }) };
  await assert.rejects(runLocalRunbookJob(job, deps));
  deps.compile = async () => ({ sourceSha256: "a".repeat(64), model: "legion-local:qwen3:8b",
    concepts: [{ key: "caller-check", title: "Caller check", quotes: ["Unsupported invented instructions"] }] });
  await assert.rejects(runLocalRunbookJob(job, deps));
});

test("valid queued work returns advisory source-bound output; changed sources are superseded without inference", async () => {
  const quote = "Inspect the real caller before changing code.";
  let calls = 0;
  let currentHash = "a".repeat(64);
  const deps = { enabled: () => true, ready: () => true, environment: () => "development",
    read: async () => ({ sha256: currentHash, text: quote }),
    health: async () => ({}),
    compile: async () => {
      calls++;
      return { sourceSha256: "a".repeat(64), model: "legion-local:qwen3:8b",
        concepts: [{ key: "caller-check", title: "Caller check", quotes: [quote] }] };
    } };
  const result = await runLocalRunbookJob(job, deps);
  assert.equal(result.status, "compiled");
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.hostedFallback, false);
  assert.equal(result.inferenceCostUsd, 0);
  currentHash = "b".repeat(64);
  assert.equal((await runLocalRunbookJob(job, deps)).status, "superseded");
  assert.equal(calls, 1);
});

test("the compiler rejects a changed source digest before contacting any model", async () => {
  await assert.rejects(compileLegionRunbook(".agents/skills/zoom-out/SKILL.md", "0".repeat(64)), LegionSourceChanged);
});

test("Surface results use the same queued source-grounding gate, not a weaker acceptance path", async () => {
  const quote = "Inspect the real caller before changing code.";
  const deps = { enabled: () => true, ready: () => true, environment: () => "development",
    read: async () => ({ sha256: "a".repeat(64), text: quote }),
    health: async () => ({}),
    compile: async () => ({ sourceSha256: "a".repeat(64),
      model: "surface-local:qwen2.5-7b-instruct-qnn-npu:3",
      concepts: [{ key: "caller-check", title: "Caller check", quotes: [quote] }] }) };
  const result = await runLocalRunbookJob(job, deps);
  assert.equal(result.status, "compiled");
  assert.equal(result.advisoryOnly, true);
  deps.compile = async () => ({ sourceSha256: "a".repeat(64),
    model: "surface-local:qwen2.5-7b-instruct-qnn-npu:3",
    concepts: [{ key: "caller-check", title: "Caller check", quotes: ["Invented ungrounded source excerpt"] }] });
  await assert.rejects(runLocalRunbookJob(job, deps));
});
