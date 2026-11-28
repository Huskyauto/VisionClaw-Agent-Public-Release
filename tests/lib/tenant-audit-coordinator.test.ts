import { test } from "node:test";
import assert from "node:assert/strict";
import { auditConcurrency, createAuditStateGate, createAuditPrecisionState, runAuditTaskPool,
  AUDIT_PRECISION_RESPONSE_BYTES } from "../../scripts/lib/tenant-audit-coordinator";
import { reserveAuditPaidAttempt } from "../../scripts/lib/tenant-audit-paid-attempts";
import { computeTenantAuditScanContext } from "../../scripts/lib/tenant-audit-evidence-hash";

test("audit worker count defaults to two and strictly bounds configuration", () => {
  assert.equal(auditConcurrency(undefined), 2);
  for (const n of [1, 2, 4]) assert.equal(auditConcurrency(String(n)), n);
  for (const value of ["", "0", "5", "-1", "2.5", "no", "Infinity", "02"])
    assert.throws(() => auditConcurrency(value), /concurrency/);
});

test("two workers overlap distinct tasks, retain every result, and drain before returning", async () => {
  let active = 0, peak = 0;
  const completed: number[] = [];
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const result = await runAuditTaskPool(["a", "b", "c", "d"], 2, async index => {
    active++; peak = Math.max(peak, active);
    if (active === 2) release();
    await ready;
    completed.push(index); active--;
  });
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.deepEqual(completed.sort(), [0, 1, 2, 3]);
  assert.deepEqual(result, { started: 4, completed: 4, stopped: false, errors: [] });
});

test("duplicate task identities fail before any work and four is a hard ceiling", async () => {
  let started = 0;
  await assert.rejects(() => runAuditTaskPool(["same", "same"], 2, async () => { started++; }), /Duplicate/);
  await assert.rejects(() => runAuditTaskPool(["a"], 5, async () => { started++; }), /concurrency/);
  assert.equal(started, 0);
});

test("stop blocks new dispatch, drains an in-flight success, and preserves the stop reason", async () => {
  let startedSecond!: () => void;
  const ready = new Promise<void>(resolve => { startedSecond = resolve; });
  const failure = new Error("lease lost");
  let saved = false;
  const result = await runAuditTaskPool(["a", "b", "c", "d"], 2, async (index, control) => {
    if (index === 0) {
      await ready;
      control.stop(failure);
    } else {
      startedSecond();
      await Promise.resolve();
      saved = true;
      assert.throws(() => control.assertDispatchAllowed(), /lease lost/);
    }
  });
  assert.equal(saved, true);
  assert.equal(result.started, 2);
  assert.equal(result.stopped, true);
});

test("state gate serializes the whole mutation and recovers after a rejected operation", async () => {
  const gate = createAuditStateGate();
  let state: Record<string, number> = {};
  await Promise.all(["a", "b", "c", "d"].map(key => gate(async () => {
    const before = { ...state };
    await Promise.resolve();
    state = { ...before, [key]: 1 };
  })));
  assert.deepEqual(Object.keys(state).sort(), ["a", "b", "c", "d"]);
  await assert.rejects(() => gate(async () => { throw new Error("write failed"); }), /write failed/);
  assert.equal(await gate(async () => 7), 7);
});

test("four workers really overlap and retain out-of-order task identities", async () => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let active = 0, peak = 0;
  const done = new Set<number>();
  const result = await runAuditTaskPool(["a", "b", "c", "d", "e"], 4, async index => {
    active++; peak = Math.max(active, peak);
    if (active === 4) release();
    await barrier;
    done.add(index); active--;
  });
  assert.equal(peak, 4);
  assert.equal(result.completed, 5);
  assert.equal(done.size, 5);
});

function precisionFixture() {
  let data: Record<string, any> = { auditPrecision: { historical: "retained" },
    auditHandoff: { key: "legacy", nextRoute: 3 } };
  const gate = createAuditStateGate();
  const state = createAuditPrecisionState({
    read: async field => { await Promise.resolve(); return structuredClone(data[field]); },
    write: async (field, value) => { await Promise.resolve(); data[field] = structuredClone(value); },
  }, gate);
  return { gate, state, data: () => data };
}

test("concurrent receipt writes merge fresh state, preserve history and reuse exact results", async () => {
  const f = precisionFixture();
  await Promise.all(["a", "b", "c", "d"].map(async key => {
    assert.equal(await f.state.acquire(key), undefined);
    await Promise.resolve();
    await f.state.save(key, `receipt-${key}`);
  }));
  assert.deepEqual(f.data().auditPrecision, {
    historical: "retained", a: "receipt-a", b: "receipt-b", c: "receipt-c", d: "receipt-d",
  });
  assert.equal(await f.state.acquire("c"), "receipt-c");
  await f.state.acquire("pending");
  await assert.rejects(() => f.state.acquire("pending"), /Duplicate/);
  await f.state.release("pending");
});

test("task-specific fallback cursors survive interleaving and legacy cursors remain readable", async () => {
  const f = precisionFixture();
  assert.equal(await f.state.cursor("legacy"), 3);
  await Promise.all([f.state.advance("a", 1), f.state.advance("b", 4)]);
  assert.equal(await f.state.cursor("a"), 1);
  assert.equal(await f.state.cursor("b"), 4);
  assert.equal(await f.state.cursor("legacy"), 3);
  assert.equal(await f.state.cursor("untouched"), 0);
  await assert.rejects(() => f.state.advance("x", 5), /cursor/);
});

test("serial paid admission allows only one same-key dispatch and retains unrelated claims", async () => {
  const gate = createAuditStateGate();
  let attempts: Record<string, number> = {};
  const reserve = (key: string) => gate(() => reserveAuditPaidAttempt(key, {
    read: async () => { await Promise.resolve(); return structuredClone(attempts); },
    write: async next => { await Promise.resolve(); attempts = structuredClone(next); },
    now: () => 100,
  }));
  const key = "a".repeat(64);
  const result = await Promise.allSettled([reserve(key), reserve(key), reserve("b".repeat(64))]);
  assert.deepEqual(result.map(r => r.status), ["fulfilled", "rejected", "fulfilled"]);
  assert.equal(Object.keys(attempts).length, 2);
});

test("capacity is reserved for every in-flight response and oversized output never writes", async () => {
  const f = precisionFixture();
  for (let i = 0; i < 9; i++) await f.state.acquire(String(i));
  await assert.rejects(() => f.state.acquire("overflow"), /capacity/);
  await assert.rejects(() => f.state.save("0", "x".repeat(AUDIT_PRECISION_RESPONSE_BYTES + 1)), /byte limit/);
  assert.deepEqual(f.data().auditPrecision, { historical: "retained" });
  await f.state.release("0");
  await f.state.acquire("replacement");
});

test("storage failure halts queued dispatch before the state gate admits it", async () => {
  let controlRef: { stop(error: unknown): void } | undefined;
  const gate = createAuditStateGate(error => controlRef?.stop(error));
  let dispatches = 0;
  const result = await runAuditTaskPool(["a", "b", "c"], 2, async (index, control) => {
    controlRef = control;
    if (index === 0) await gate(async () => { throw new Error("checkpoint unavailable"); });
    else await gate(async () => { control.assertDispatchAllowed(); dispatches++; });
  });
  assert.equal(dispatches, 0);
  assert.equal(result.started, 2);
  assert.equal(result.stopped, true);
});

test("worker-count settings do not change exact-input scan context", () => {
  const prior = process.env.AUDIT_TRIAGE_CONCURRENCY;
  try {
    process.env.AUDIT_TRIAGE_CONCURRENCY = "1";
    const serial = computeTenantAuditScanContext(process.cwd(), { fixture: "same semantic request" });
    process.env.AUDIT_TRIAGE_CONCURRENCY = "4";
    assert.equal(computeTenantAuditScanContext(process.cwd(), { fixture: "same semantic request" }), serial);
    assert.notEqual(computeTenantAuditScanContext(process.cwd(), { fixture: "changed semantic request" }), serial);
  } finally {
    if (prior === undefined) delete process.env.AUDIT_TRIAGE_CONCURRENCY;
    else process.env.AUDIT_TRIAGE_CONCURRENCY = prior;
  }
});
