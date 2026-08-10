/**
 * tests/unit/jury-queue-drain.test.ts
 *
 * The jury-queue drainer closes the jury → implement loop by routing FIX verdicts
 * through captureIncident (which carries every existing guard). The drainer's own
 * job is the ROUTING decision: which entries it forwards and which it skips. That
 * decision must be conservative — only real, non-sensitive, non-empty FIX verdicts
 * are forwarded; everything else is skipped (and stamped so it isn't re-evaluated).
 *
 * decideEntry / isSensitive are pure (no IO). Importing the script does NOT run
 * main() (guarded on argv[1]) and the captureIncident import is lazy inside
 * drainOnce, so this test never touches the DB.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideEntry,
  isSensitive,
  resolveEntryTenant,
  ledgerClaim,
  ledgerRelease,
  ledgerComplete,
  type JuryQueueEntry,
} from "../../scripts/drain-jury-queue";

/** Minimal db stub: returns a canned result and records every SQL invocation so a
 *  test can assert the helper issued the right shape of statement. The drainer
 *  reads rows via `(res as any).rows || res`, so we mirror that shape. Pass an
 *  ARRAY to return a different result per successive call (the last entry repeats);
 *  pass a single value to return it for every call. */
function fakeDb(result: any) {
  const calls: any[] = [];
  const seq = Array.isArray(result) && result.length > 0 && Object.prototype.hasOwnProperty.call(result[0] ?? {}, "rows")
    ? (result as any[])
    : null;
  let i = 0;
  return {
    db: {
      execute: async (q: any) => {
        calls.push(q);
        if (seq) return seq[Math.min(i++, seq.length - 1)];
        return result;
      },
    },
    calls,
  };
}

test("a unanimous FIX with a proposal routes", () => {
  const e: JuryQueueEntry = { verdict: "FIX", majority: 3, fixProposal: "change X to Y", issueSlug: "gap-1" };
  assert.deepEqual(decideEntry(e), { route: true, reason: "fix" });
});

test("non-FIX verdicts are skipped (not forwarded to the implementer)", () => {
  assert.equal(decideEntry({ verdict: "ACCEPT", fixProposal: "n/a" }).route, false);
  assert.equal(decideEntry({ verdict: "REJECT", fixProposal: "n/a" }).route, false);
  assert.equal(decideEntry({ verdict: "ESCALATE", fixProposal: "n/a" }).route, false);
  assert.equal(decideEntry({ fixProposal: "n/a" }).route, false);
});

test("sensitive entries never route (belt-and-braces over write-time filtering)", () => {
  const e: JuryQueueEntry = { verdict: "FIX", majority: 3, fixProposal: "x", source: "gaps:sensitive-path-block" };
  assert.equal(isSensitive(e), true);
  assert.equal(decideEntry(e).route, false);
  assert.equal(decideEntry(e).reason, "sensitive-path");
});

test("a FIX with no usable proposal is skipped", () => {
  assert.equal(decideEntry({ verdict: "FIX", majority: 3, fixProposal: "   " }).route, false);
  assert.equal(decideEntry({ verdict: "FIX", majority: 3 }).route, false);
});

test("an already-drained entry is never re-routed", () => {
  const e: JuryQueueEntry = { verdict: "FIX", majority: 3, fixProposal: "x", _drained: true };
  assert.deepEqual(decideEntry(e), { route: false, reason: "already-drained" });
});

test("resolveEntryTenant: a stamped tenantId is honored ONLY when the signature verifies", () => {
  const e: JuryQueueEntry = { verdict: "FIX", fixProposal: "x", tenantId: 7 };
  // sig verified → trust the stamped tenant
  assert.deepEqual(resolveEntryTenant(e, true), { tenant: 7, source: "signed" });
});

test("resolveEntryTenant: an UNVERIFIED stamped tenantId is refused → falls back (no cross-tenant routing from an unsigned entry)", () => {
  const forged: JuryQueueEntry = { verdict: "FIX", fixProposal: "x", tenantId: 7 };
  const r = resolveEntryTenant(forged, false);
  assert.notEqual(r.tenant, 7, "a forged/unsigned tenantId must NOT steer routing");
  assert.equal(r.source, "fallback-unverified");
});

test("resolveEntryTenant: a legacy entry with no tenantId falls back regardless of sig", () => {
  const legacy: JuryQueueEntry = { verdict: "FIX", fixProposal: "x" };
  assert.equal(resolveEntryTenant(legacy, true).source, "fallback-legacy");
  assert.equal(resolveEntryTenant(legacy, false).source, "fallback-legacy");
});

test("recency window backfill-skips a stale FIX instead of routing it", () => {
  const now = Date.parse("2026-06-08T00:00:00Z");
  const stale: JuryQueueEntry = { verdict: "FIX", majority: 3, fixProposal: "x", triagedAt: "2026-01-01T00:00:00Z" };
  const fresh: JuryQueueEntry = { verdict: "FIX", majority: 3, fixProposal: "x", triagedAt: "2026-06-07T00:00:00Z" };
  // stale: older than the 30-day window → skipped (not routed)
  assert.deepEqual(decideEntry(stale, { now, maxAgeDays: 30 }), { route: false, reason: "stale" });
  // fresh: within the window → routes
  assert.deepEqual(decideEntry(fresh, { now, maxAgeDays: 30 }), { route: true, reason: "fix" });
  // no window configured (maxAgeDays 0/undefined) → recency check is a no-op
  assert.equal(decideEntry(stale).route, true);
});

// ── claim-first replay ledger (MEDIUM closed 2026-06-10) ──────────────────────
// ledgerClaim collapses the old check-then-act into an atomic claim and returns a
// TRI-STATE: "won" (fresh insert OR reclaimed stale orphan), "replay" (a COMPLETED
// row exists → block), "held" (a fresh peer claim → defer, never lost).
// The drainer issues up to 3 statements: (1) INSERT…ON CONFLICT, (2) stale-orphan
// reclaim UPDATE, (3) a SELECT of the existing outcome. fakeDb returns one result
// per successive call.

test("ledgerClaim: a fresh INSERT (row returned) wins the claim immediately", async () => {
  const { db, calls } = fakeDb({ rows: [{ id: 42 }] });
  const r = await ledgerClaim(db, { entryKey: "fp-abc", tenantId: 1, issueSlug: "gap-1" });
  assert.equal(r, "won");
  assert.equal(calls.length, 1, "a fresh win short-circuits after the INSERT (no reclaim/select)");
});

test("ledgerClaim: conflict on a COMPLETED row (not reclaimable) → replay blocked", async () => {
  // INSERT conflict (no row) → reclaim UPDATE matches nothing (row is completed, not 'claimed')
  //   → SELECT returns a non-'claimed' outcome → "replay".
  const { db } = fakeDb([{ rows: [] }, { rows: [] }, { rows: [{ outcome: "captured:repo-surgeon" }] }]);
  const r = await ledgerClaim(db, { entryKey: "fp-abc", tenantId: 1 });
  assert.equal(r, "replay");
});

test("ledgerClaim: conflict but a STALE 'claimed' orphan is reclaimed → won", async () => {
  // INSERT conflict (no row) → reclaim UPDATE returns a row (stale orphan taken over) → "won".
  const { db, calls } = fakeDb([{ rows: [] }, { rows: [{ id: 9 }] }]);
  const r = await ledgerClaim(db, { entryKey: "fp-abc", tenantId: 1 });
  assert.equal(r, "won");
  assert.equal(calls.length, 2, "reclaim win short-circuits before the SELECT");
});

test("ledgerClaim: conflict, a FRESH (not-yet-stale) peer claim → held (defer, not lost)", async () => {
  // INSERT conflict → reclaim matches nothing (not stale yet) → SELECT shows outcome='claimed' → "held".
  const { db } = fakeDb([{ rows: [] }, { rows: [] }, { rows: [{ outcome: "claimed" }] }]);
  const r = await ledgerClaim(db, { entryKey: "fp-abc", tenantId: 1 });
  assert.equal(r, "held");
});

test("ledgerClaim: a missing row on the final SELECT fails SAFE to held (a peer won-then-released between our conflict and read — never drop a retryable entry)", async () => {
  // Regression: a missing row is AMBIGUOUS, not proof-of-completion. A peer can
  // win the claim (so our INSERT sees a conflict) and then ledgerRelease (DELETE)
  // it before our SELECT — leaving no row. Returning "replay" here would
  // permanently skip-stamp a legitimately-retryable entry (lost entry). The
  // correct fail-safe is "held": defer and retry next poll where our own INSERT wins.
  const { db } = fakeDb([{ rows: [] }, { rows: [] }, { rows: [] }]);
  const r = await ledgerClaim(db, { entryKey: "fp-abc", tenantId: 1 });
  assert.equal(r, "held");
});

test("ledgerClaim: a bare-array result shape (no .rows wrapper) is honored too", async () => {
  // some drivers return the row array directly; the helper falls back to `res`
  const won = await ledgerClaim(fakeDb([{ id: 7 }]).db, { entryKey: "k", tenantId: 1 });
  assert.equal(won, "won");
});

test("ledgerClaim: a DB error PROPAGATES (drainer catches it and defers, fail-closed)", async () => {
  const db = { execute: async () => { throw new Error("db down"); } };
  await assert.rejects(() => ledgerClaim(db as any, { entryKey: "k", tenantId: 1 }), /db down/);
});

test("ledgerRelease / ledgerComplete each issue exactly one statement", async () => {
  const rel = fakeDb({ rows: [] });
  await ledgerRelease(rel.db, "fp-xyz");
  assert.equal(rel.calls.length, 1, "release issues one DELETE");

  const done = fakeDb({ rows: [] });
  await ledgerComplete(done.db, "fp-xyz", "captured:repo-surgeon");
  assert.equal(done.calls.length, 1, "complete issues one UPDATE");
});
