import assert from "node:assert/strict";
import test from "node:test";
import { runBoundedVerifierTick, canStartVerifierWorker, WORKER_SOURCE_MISMATCH, verifierWorkerEnabled } from "../../server/lib/bounded-verifier-worker";

test("a verifier worker with unavailable accounting claims no jobs", async () => {
  let claimed = 0;
  const result = await runBoundedVerifierTick({
    ready: () => false,
    claim: async () => { claimed++; return []; },
  } as any);
  assert.equal(claimed, 0);
  assert.equal(result, "unavailable");
});

test("memory admission requires finite aggregate headroom, not a heap or host label", () => {
  assert.equal(canStartVerifierWorker(null, 100), false);
  assert.equal(canStartVerifierWorker({ maxBytes: NaN, currentBytes: 0 }, 100), false);
  assert.equal(canStartVerifierWorker({ maxBytes: 4 * 1024 ** 3, currentBytes: -1 }, 100), false);
  assert.equal(canStartVerifierWorker({ maxBytes: 4 * 1024 ** 3, currentBytes: 2 * 1024 ** 3 }, 100), false);
  assert.equal(canStartVerifierWorker({ maxBytes: 4 * 1024 ** 3, currentBytes: 0 }, Infinity), false);
  assert.equal(canStartVerifierWorker({ maxBytes: 4 * 1024 ** 3, currentBytes: 0 }, 100), true);
  assert.equal(verifierWorkerEnabled("true"), false);
  assert.equal(verifierWorkerEnabled("1"), true);
});

function harness(overrides: any = {}) {
  const events: string[] = [];
  const job: any = { id: 2, kind: "research_proposal_verification", attempts: 1,
    tenantId: 7, payload: { proposalId: 3, tenantId: 7 }, leaseUntil: new Date(300_000) };
  const deps: any = {
    ready: () => true, now: () => 0, claim: async () => [job],
    verify: async (_j: any, tid: number, pid: number) => {
      assert.equal(tid, 7); assert.equal(pid, 3); events.push("verify");
      return { status: "failed", details: "expected compiler diagnostic", durationMs: 1 };
    },
    complete: async (j: any) => { assert.equal(j.attempts, 1); events.push("complete"); return true; },
    defer: async () => { events.push("defer"); return true; },
    fail: async () => { events.push("fail"); },
    isDeferred: () => false, ...overrides,
  };
  return { events, job, deps };
}

test("worker preserves persisted tenant/attempt and completes only after verifier receipt", async () => {
  const h = harness();
  assert.equal(await runBoundedVerifierTick(h.deps), "completed");
  assert.deepEqual(h.events, ["verify", "complete"]);
});

test("wrong kinds, tenant mismatch and malformed identities cannot invoke the compiler", async () => {
  for (const mutate of [
    (j: any) => { j.kind = "weekly_maintenance"; },
    (j: any) => { j.payload.tenantId = 1; },
    (j: any) => { j.tenantId = null; },
    (j: any) => { j.payload.proposalId = NaN; },
  ]) {
    const h = harness(); mutate(h.job);
    assert.equal(await runBoundedVerifierTick(h.deps), "failed");
    assert.deepEqual(h.events, ["fail"]);
  }
});

test("source mismatch and expired lease defer without completion or automatic rebase", async () => {
  const h = harness({ verify: async () => ({ status: "skipped", details: WORKER_SOURCE_MISMATCH, durationMs: 1 }) });
  assert.equal(await runBoundedVerifierTick(h.deps), "deferred");
  assert.deepEqual(h.events, ["defer"]);
  const expired = harness(); expired.job.leaseUntil = new Date(1000);
  assert.equal(await runBoundedVerifierTick(expired.deps), "deferred");
  assert.deepEqual(expired.events, ["defer"]);
});

test("capacity failures preserve retries, and lost completion fencing is not success", async () => {
  const h = harness({ verify: async () => { throw new Error("capacity"); }, isDeferred: () => true });
  assert.equal(await runBoundedVerifierTick(h.deps), "deferred");
  assert.deepEqual(h.events, ["defer"]);
  const lost = harness({ complete: async () => false });
  assert.equal(await runBoundedVerifierTick(lost.deps), "fenced");
});