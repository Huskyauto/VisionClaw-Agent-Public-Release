import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ownerJuryMeteredEnabled,
  ownerJuryCeiling,
  noteOwnerJurySpend,
  ownerJuryRunReserveUsd,
  __resetOwnerJurySpendForTest,
} from "../../server/agentic/cost-ledger";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// Owner-jury daily ceiling backstop regression net (Bob 2026-06-26).
// When the OWNER (admin tenant) explicitly runs ensemble_query / jury_triage the
// proposers may run on REAL paid cross-provider models — but only up to a daily
// $ ceiling (default $20, OWNER_JURY_DAILY_CEILING_USD). Once crossed, the
// override stops granting metered for the rest of the UTC day and moa.ts forces
// the jury back onto the DISTINCT-free lanes (it still answers). This is the
// hard backstop that prevents a repeat of the $933 Jun-11/12 burst. These are
// pure unit tests — no DB, no network. Amounts are derived from the live ceiling
// so they never depend on the exact env-tunable value.

beforeEach(() => { __resetOwnerJurySpendForTest(); });

test("fresh day: ceiling not exceeded, spent is 0, ceiling positive", () => {
  const g = ownerJuryCeiling();
  assert.equal(g.exceeded, false);
  assert.equal(g.spent, 0);
  assert.ok(g.ceiling > 0);
});

test("noteOwnerJurySpend ignores non-positive amounts", () => {
  noteOwnerJurySpend(0);
  noteOwnerJurySpend(-5);
  const g = ownerJuryCeiling();
  assert.equal(g.spent, 0);
  assert.equal(g.exceeded, false);
});

test("spend below the ceiling does NOT trip it", () => {
  const ceiling = ownerJuryCeiling().ceiling;
  noteOwnerJurySpend(ceiling * 0.5);
  const g = ownerJuryCeiling();
  assert.equal(g.exceeded, false);
  assert.ok(Math.abs(g.spent - ceiling * 0.5) < 1e-9);
});

test("cumulative spend at/over the ceiling trips it (absolute backstop)", () => {
  const ceiling = ownerJuryCeiling().ceiling;
  noteOwnerJurySpend(ceiling * 0.6);
  assert.equal(ownerJuryCeiling().exceeded, false);
  noteOwnerJurySpend(ceiling * 0.6); // cumulative 1.2x > ceiling
  const g = ownerJuryCeiling();
  assert.equal(g.exceeded, true);
  assert.ok(g.spent >= ceiling);
});

test("reserve-then-settle: concurrent reservations are visible before either settles", () => {
  // The ceiling pre-check in moa.ts is read-only; the reservation is what makes an
  // OVERLAPPING owner run see in-flight spend. Simulate two grants before settle.
  const reserve = ownerJuryRunReserveUsd();
  assert.ok(reserve > 0, "reserve must be positive to guard concurrency");
  noteOwnerJurySpend(reserve); // run A grant
  noteOwnerJurySpend(reserve); // run B grant — sees A's reservation in its own window
  const mid = ownerJuryCeiling();
  assert.ok(Math.abs(mid.spent - reserve * 2) < 1e-9, "both in-flight reservations accrued");
  // Each settles, adding only the excess of actual-over-reserved.
  const actualA = reserve + 1, actualB = reserve + 2;
  noteOwnerJurySpend(Math.max(0, actualA - reserve));
  noteOwnerJurySpend(Math.max(0, actualB - reserve));
  const end = ownerJuryCeiling();
  assert.ok(Math.abs(end.spent - (actualA + actualB)) < 1e-9, "settled total equals sum of actuals");
});

test("reserve-then-settle: actual below reservation keeps the conservative reservation", () => {
  const reserve = ownerJuryRunReserveUsd();
  noteOwnerJurySpend(reserve);                                   // grant
  noteOwnerJurySpend(Math.max(0, (reserve * 0.25) - reserve));   // settle: actual<reserved ⇒ 0 excess
  const g = ownerJuryCeiling();
  assert.ok(Math.abs(g.spent - reserve) < 1e-9, "never refunds below the reservation (safe direction)");
});

test("ownerJuryMeteredEnabled defaults ON, respects the kill-switch", () => {
  const saved = process.env.OWNER_JURY_METERED;
  try {
    delete process.env.OWNER_JURY_METERED;
    assert.equal(ownerJuryMeteredEnabled(), true);
    for (const off of ["false", "0", "no", "off", "FALSE", "Off"]) {
      process.env.OWNER_JURY_METERED = off;
      assert.equal(ownerJuryMeteredEnabled(), false, `expected ${off} to disable`);
    }
    process.env.OWNER_JURY_METERED = "true";
    assert.equal(ownerJuryMeteredEnabled(), true);
  } finally {
    if (saved === undefined) delete process.env.OWNER_JURY_METERED;
    else process.env.OWNER_JURY_METERED = saved;
  }
});
