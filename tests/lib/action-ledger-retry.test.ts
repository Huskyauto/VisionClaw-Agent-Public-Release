/**
 * Action Ledger S5 — reconcile-first timeout retry decision table (feature
 * contract: data/feature-contracts/action-ledger/ — spec.md acceptance #1 +
 * plan.md § S5).
 *
 * Proves the decision table in server/lib/action-ledger-retry.ts:
 *   - no probe registered ⇒ NO retry lane at all (pre-S5 behavior),
 *   - grace poll: committed ⇒ no-retry; failed ⇒ retry (same idempotency key),
 *   - commit-after-timeout DURING the grace window ⇒ no-retry, probe never
 *     runs, settle never runs (the "NO double execution" acceptance case),
 *   - probe committed ⇒ settle(committed) + no-retry,
 *   - probe proven-failed ⇒ settle(failed) + retry with the SAME key,
 *   - probe unknown / probe throw ⇒ markUnknown + escalate (NEVER retry),
 *   - plumbing failures (deps, ledger read) ⇒ escalate, never retry,
 *   - AL_TIMEOUT_RETRY=0 kill switch,
 *   - static seam: executeToolWithTimeout wires take→decide→directive.
 *
 * All ledger/probe access via injected fakes — server/tools.ts and the real
 * action-ledger lib are NEVER imported here (node-test-db-pool-hang).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  decideTimeoutRetry,
  timeoutRetryEnabled,
  buildCommitConfirmedError,
  buildRetryTimeoutError,
  shouldReplaceTimeoutError,
  type TimeoutRetryDeps,
  type TimeoutRetryAttempt,
} from "../../server/lib/action-ledger-retry";

const KEY = "vc-al1-" + "a".repeat(48);

const ATTEMPT: TimeoutRetryAttempt = {
  attemptId: 42,
  idempotencyKey: KEY,
  tenantId: 7,
  toolName: "stripe_create_payout",
  startedAt: new Date("2026-07-12T00:00:00Z"),
};

type Call = string;

function makeDeps(opts: {
  states?: Array<string | undefined>; // successive getAttemptState returns (last repeats)
  probe?: "committed" | "proven-failed" | "unproven-failed" | "unknown" | "throw" | "none";
  graceMs?: number;
  stateThrows?: boolean;
  settleThrows?: boolean;
  markUnknownThrows?: boolean;
} = {}) {
  const calls: Call[] = [];
  const states = opts.states ?? ["prepared"];
  let i = 0;
  const deps: TimeoutRetryDeps = {
    getAttemptState: async (id, tenantId) => {
      calls.push(`state:${id}:t${tenantId}`);
      if (opts.stateThrows) throw new Error("db down");
      const s = states[Math.min(i, states.length - 1)];
      i++;
      return s as any;
    },
    settleAttempt: async (id, tenantId, outcome) => {
      calls.push(`settle:${id}:t${tenantId}:${outcome}`);
      if (opts.settleThrows) throw new Error("settle boom");
      return true;
    },
    markUnknown: async (id, tenantId, reason) => {
      calls.push(`unknown:${id}:t${tenantId}:${(reason || "").slice(0, 40)}`);
      if (opts.markUnknownThrows) throw new Error("mu boom");
      return true;
    },
    getVerifyProbe: (toolName) => {
      if (opts.probe === "none") return undefined;
      return async (row) => {
        calls.push(`probe:${toolName}:${row.idempotencyKey}`);
        switch (opts.probe ?? "unknown") {
          case "committed": return { outcome: "committed", receipt: { evt: "e1" } };
          case "proven-failed": return { outcome: "failed", proven: true } as any;
          case "unproven-failed": return { outcome: "unknown", note: "looked failed but unproven" };
          case "throw": throw new Error("probe exploded");
          default: return { outcome: "unknown", note: "no evidence" };
        }
      };
    },
    graceMs: opts.graceMs ?? 0,
    pollMs: 50,
    sleep: async () => { calls.push("sleep"); },
  };
  return { deps, calls };
}

// ---------- kill switch ----------

test("S5: AL_TIMEOUT_RETRY=0 disables the retry lane; default is enabled", () => {
  assert.equal(timeoutRetryEnabled({} as any), true);
  assert.equal(timeoutRetryEnabled({ AL_TIMEOUT_RETRY: "1" } as any), true);
  assert.equal(timeoutRetryEnabled({ AL_TIMEOUT_RETRY: "0" } as any), false);
});

// ---------- gate 0: probe required ----------

test("S5: no probe registered ⇒ no-retry (no ledger reads, no settles)", async () => {
  const { deps, calls } = makeDeps({ probe: "none" });
  const d = await decideTimeoutRetry(ATTEMPT, deps);
  assert.deepEqual(d, { decision: "no-retry", reason: "no-probe" });
  assert.deepEqual(calls, [], "gate 0 must short-circuit before any DB access");
});

// ---------- grace poll on the ledger row ----------

test("S5: row already committed ⇒ no-retry, probe NEVER runs", async () => {
  const { deps, calls } = makeDeps({ states: ["committed"], probe: "committed" });
  const d = await decideTimeoutRetry(ATTEMPT, deps);
  assert.deepEqual(d, { decision: "no-retry", reason: "committed" });
  assert.deepEqual(calls, ["state:42:t7"]);
});

test("S5: row failed ⇒ retry with the SAME idempotency key, probe never runs", async () => {
  const { deps, calls } = makeDeps({ states: ["failed"], probe: "committed" });
  const d = await decideTimeoutRetry(ATTEMPT, deps);
  assert.deepEqual(d, {
    decision: "retry",
    reason: "failed",
    reuseIdempotencyKey: KEY,
    retryOfAttemptId: 42,
  });
  assert.deepEqual(calls, ["state:42:t7"]);
});

test("S5 acceptance: commit lands DURING the grace window ⇒ no-retry, NO double execution", async () => {
  // First poll sees the still-running original (`prepared`), the settle lands,
  // second poll sees `committed`. The probe and settle must never fire.
  const { deps, calls } = makeDeps({ states: ["prepared", "committed"], probe: "committed", graceMs: 10_000 });
  const d = await decideTimeoutRetry(ATTEMPT, deps);
  assert.deepEqual(d, { decision: "no-retry", reason: "committed" });
  assert.deepEqual(calls, ["state:42:t7", "sleep", "state:42:t7"]);
});

test("S5: attempt row missing ⇒ escalate (never retry on a ghost)", async () => {
  const { deps } = makeDeps({ states: [undefined] });
  const d = await decideTimeoutRetry(ATTEMPT, deps);
  assert.equal(d.decision, "escalate");
});

test("S5: compensated row ⇒ no-retry (side effect happened and was compensated)", async () => {
  const { deps, calls } = makeDeps({ states: ["compensated"], probe: "committed" });
  const d = await decideTimeoutRetry(ATTEMPT, deps);
  assert.deepEqual(d, { decision: "no-retry", reason: "committed" });
  assert.deepEqual(calls, ["state:42:t7"], "probe must not run for a compensated row");
});

test("S5: ledger read failure during grace poll ⇒ escalate, never retry", async () => {
  const { deps } = makeDeps({ stateThrows: true });
  const d = await decideTimeoutRetry(ATTEMPT, deps);
  assert.equal(d.decision, "escalate");
  assert.match((d as any).reason, /ledger read failed/);
});

// ---------- provider probe ----------

test("S5: probe committed ⇒ settle(committed) + no-retry", async () => {
  const { deps, calls } = makeDeps({ states: ["unknown"], probe: "committed" });
  const d = await decideTimeoutRetry(ATTEMPT, deps);
  assert.deepEqual(d, { decision: "no-retry", reason: "committed-by-probe" });
  assert.deepEqual(calls, ["state:42:t7", `probe:stripe_create_payout:${KEY}`, "settle:42:t7:committed"]);
});

test("S5: probe proven-failed ⇒ settle(failed) + retry with SAME key", async () => {
  const { deps, calls } = makeDeps({ states: ["unknown"], probe: "proven-failed" });
  const d = await decideTimeoutRetry(ATTEMPT, deps);
  assert.deepEqual(d, {
    decision: "retry",
    reason: "proven-failed-by-probe",
    reuseIdempotencyKey: KEY,
    retryOfAttemptId: 42,
  });
  assert.ok(calls.includes("settle:42:t7:failed"));
});

test("S5 invariant: probe unknown ⇒ markUnknown + escalate — NEVER retry", async () => {
  const { deps, calls } = makeDeps({ states: ["unknown"], probe: "unknown" });
  const d = await decideTimeoutRetry(ATTEMPT, deps);
  assert.equal(d.decision, "escalate");
  assert.ok(calls.some(c => c.startsWith("unknown:42:t7:")), "row must be parked for the S3 reconciler");
  assert.ok(!calls.some(c => c.startsWith("settle:")), "unknown must never settle");
});

test("S5 invariant: unproven failure signal is treated as unknown ⇒ escalate", async () => {
  const { deps } = makeDeps({ states: ["unknown"], probe: "unproven-failed" });
  const d = await decideTimeoutRetry(ATTEMPT, deps);
  assert.equal(d.decision, "escalate");
});

test("S5: probe throw ⇒ markUnknown + escalate (probes fail toward unknown)", async () => {
  const { deps, calls } = makeDeps({ states: ["unknown"], probe: "throw" });
  const d = await decideTimeoutRetry(ATTEMPT, deps);
  assert.equal(d.decision, "escalate");
  assert.match((d as any).reason, /probe threw/);
  assert.ok(calls.some(c => c.startsWith("unknown:42:t7:")));
});

test("S5: settle failure is swallowed — decision still returned", async () => {
  const { deps } = makeDeps({ states: ["unknown"], probe: "committed", settleThrows: true });
  const d = await decideTimeoutRetry(ATTEMPT, deps);
  assert.deepEqual(d, { decision: "no-retry", reason: "committed-by-probe" });
});

test("S5: markUnknown failure is swallowed — still escalates", async () => {
  const { deps } = makeDeps({ states: ["unknown"], probe: "unknown", markUnknownThrows: true });
  const d = await decideTimeoutRetry(ATTEMPT, deps);
  assert.equal(d.decision, "escalate");
});

// ---------- runtime: catch-lane error-replacement contract ----------
// Producers + predicate live together in action-ledger-retry.ts; these tests
// pin "replace the original timeout error ONLY for CONFIRMED / retry-timeout"
// at runtime (previously only pinned by the static seam scan below).

test("S5 catch-lane: commit-CONFIRMED error REPLACES the original (predicate true)", () => {
  const err = buildCommitConfirmedError("stripe_create_payout", 30_000, 42);
  assert.ok(shouldReplaceTimeoutError(err));
  assert.ok(err.message.includes("commit is CONFIRMED"), "must say the commit is confirmed");
  assert.ok(err.message.includes("Do NOT retry this call"), "must loudly forbid re-invocation");
  assert.ok(err.message.includes("attempt 42"), "must carry the ledger attempt id");
  assert.ok(err.message.includes("30s"), "must carry the human-readable timeout");
});

test("S5 catch-lane: retry-timeout error REPLACES the original (predicate true)", () => {
  const err = buildRetryTimeoutError("stripe_create_payout", 30_000);
  assert.ok(shouldReplaceTimeoutError(err));
  assert.ok(err.message.includes("retry timed out"), "must be recognizable as the retry's own timeout");
  assert.ok(err.message.includes("escalating to reconciler"), "must state the attempt is parked for the reconciler");
});

test("S5 catch-lane: plumbing errors KEEP the original (predicate false)", () => {
  assert.equal(shouldReplaceTimeoutError(new Error("Cannot read properties of undefined")), false);
  assert.equal(shouldReplaceTimeoutError(new Error("connect ECONNREFUSED 127.0.0.1:5432")), false);
  assert.equal(shouldReplaceTimeoutError(new Error("ledger read failed during grace poll")), false);
});

test("S5 catch-lane: non-Error throws KEEP the original (predicate false)", () => {
  assert.equal(shouldReplaceTimeoutError("commit is CONFIRMED"), false, "a string is never a replaceable error");
  assert.equal(shouldReplaceTimeoutError(undefined), false);
  assert.equal(shouldReplaceTimeoutError(null), false);
  assert.equal(shouldReplaceTimeoutError({ message: "retry timed out" }), false, "a plain object is not an Error");
});

// ---------- static seam: executeToolWithTimeout wiring ----------
// server/tools.ts is parsed as TEXT, never imported (pg-pool hang).

test("S5 seam: executeToolWithTimeout claims the attempt, decides, and retries under the directive", () => {
  const src = readFileSync(path.join(process.cwd(), "server/tools.ts"), "utf8");
  assert.ok(src.includes("takeLedgerAttemptForSignal(controller.signal)"),
    "timeout layer must claim the middleware-registered attempt off ITS OWN signal");
  assert.ok(src.includes("timeoutRetryEnabled()"), "kill switch must gate the lane");
  assert.ok(src.includes("decideTimeoutRetry(attempt)"), "decision engine must be consulted");
  assert.ok(src.includes("runWithLedgerRetryDirective("),
    "the single retry must run under the ALS directive so prepare reuses the SAME key");
  assert.ok(src.includes("buildCommitConfirmedError("),
    "a confirmed commit must surface via the shared builder so no layer above re-invokes the tool");
  assert.ok(src.includes("buildRetryTimeoutError("),
    "the retry's own timeout must come from the shared builder (predicate can never drift)");
  assert.ok(src.includes("shouldReplaceTimeoutError(retryErr)"),
    "the catch lane must use the runtime-tested predicate, not an inline regex");
});
