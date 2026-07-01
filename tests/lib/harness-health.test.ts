import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeHarnessHealth, emptyHarnessHealthSummary } from "../../server/harness-health";

// Pure-function tests only — no db.execute, so the pg pool never opens and the
// runner can't hang (see memory: node-test DB-pool hang).

const base = {
  attempts: 0,
  incidents: 0,
  landed: 0,
  rolledBack: 0,
  noFix: 0,
  blocked: 0,
  landedIncidents: 0,
  firstTryLandedIncidents: 0,
  sumDepthLandedIncidents: 0,
};

describe("computeHarnessHealth (arXiv:2605.18747 process-quality)", () => {
  it("zero data is not a breach (no-data, not a pathology)", () => {
    const r = computeHarnessHealth({ ...base });
    assert.equal(r.breached, false);
    assert.equal(r.ranAttempts, 0);
    assert.equal(r.landRate, 0);
    assert.equal(r.firstPassYield, 0);
    assert.equal(r.avgReworkDepth, 0);
  });

  it("emptyHarnessHealthSummary is a clean, unbreaching default", () => {
    const e = emptyHarnessHealthSummary();
    assert.equal(e.breached, false);
    assert.equal(e.degraded, false);
    assert.equal(e.attempts, 0);
  });

  it("a healthy verifier-pass rate does not breach", () => {
    const r = computeHarnessHealth({ ...base, landed: 18, rolledBack: 2 });
    assert.equal(r.ranAttempts, 20);
    assert.equal(r.landRate, 0.9);
    assert.equal(r.breached, false);
  });

  it("a thrashing loop (land-rate below floor, enough sample) breaches", () => {
    const r = computeHarnessHealth({ ...base, landed: 2, rolledBack: 18 });
    assert.equal(r.ranAttempts, 20);
    assert.equal(r.landRate, 0.1);
    assert.equal(r.breached, true);
  });

  it("a low land-rate below the minimum ran-sample does NOT breach (avoids early false alarm)", () => {
    const r = computeHarnessHealth({ ...base, landed: 1, rolledBack: 4 });
    assert.equal(r.ranAttempts, 5);
    assert.equal(r.landRate, 0.2);
    assert.equal(r.breached, false);
  });

  it("no_fix and blocked are surfaced but EXCLUDED from the land-rate / breach math", () => {
    // 100 no_fix + 100 blocked but only 12 ran (all landed) -> healthy, not breached
    const r = computeHarnessHealth({ ...base, landed: 12, rolledBack: 0, noFix: 100, blocked: 100 });
    assert.equal(r.noFix, 100);
    assert.equal(r.blocked, 100);
    assert.equal(r.ranAttempts, 12);
    assert.equal(r.landRate, 1);
    assert.equal(r.breached, false);
  });

  it("first-pass yield = first-try-landed / landed-incidents", () => {
    const r = computeHarnessHealth({
      ...base,
      landed: 10,
      rolledBack: 4,
      landedIncidents: 10,
      firstTryLandedIncidents: 7,
      sumDepthLandedIncidents: 14,
    });
    assert.equal(r.firstPassYield, 0.7);
    assert.equal(r.avgReworkDepth, 1.4);
  });

  it("guards division-by-zero when nothing landed", () => {
    const r = computeHarnessHealth({
      ...base,
      landed: 0,
      rolledBack: 6,
      landedIncidents: 0,
      firstTryLandedIncidents: 0,
      sumDepthLandedIncidents: 0,
    });
    assert.equal(r.firstPassYield, 0);
    assert.equal(r.avgReworkDepth, 0);
    assert.equal(r.landRate, 0);
    assert.ok(Number.isFinite(r.firstPassYield) && Number.isFinite(r.avgReworkDepth));
  });

  it("rounds rates to 2 decimals", () => {
    const r = computeHarnessHealth({ ...base, landed: 1, rolledBack: 2 });
    assert.equal(r.landRate, 0.33);
  });

  it("clamps negative / garbage counts to zero", () => {
    const r = computeHarnessHealth({ ...base, landed: -5, rolledBack: -3, attempts: -10 });
    assert.equal(r.landed, 0);
    assert.equal(r.rolledBack, 0);
    assert.equal(r.attempts, 0);
    assert.equal(r.breached, false);
  });
});
