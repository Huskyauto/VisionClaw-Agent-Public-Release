import test from "node:test";
import assert from "node:assert/strict";
import { canRestartUnspentPackageReview } from "../../server/lib/company-report-recovery";

test("owner recovery may retain and restart a failed initial review only with proof of zero review spending or successful votes", () => {
  const payload = {
    state: { phase: "blocked", stopReason: "Report initial jury blocked: verdict=ESCALATE, successful votes=0/3; owner review required; no customer delivery",
      juryHistory: [{ verdict: "ESCALATE" }] },
    paidJuryRuns: { initial: { proposers: [{ ok: false }, { ok: false }, { ok: false }] } },
    reportJuryRuns: { initial: { events: [] } },
  };
  assert.equal(canRestartUnspentPackageReview(7, payload, { "draft:readiness:fixture": 500000 }), true);
  for (const key of ["review:7:initial_jury:fixture", "compiler:7:fixture"])
    assert.equal(canRestartUnspentPackageReview(7, payload, { [key]: 1 }), false);
  for (const alter of [
    (p: any) => { p.state.stopReason = "Report final jury blocked"; },
    (p: any) => { p.paidJuryRuns.initial.proposers[0].ok = true; },
    (p: any) => { p.reportJuryRuns.initial.events.push({ type: "dispatch" }); },
    (p: any) => { p.state.approvedSections = [{ heading: "Accepted", body: "Retained" }]; },
    (p: any) => { p.fulfillment = { success: true }; },
    (p: any) => { p.paidJuryRuns.initial.proposers = []; },
  ]) {
    const changed = structuredClone(payload); alter(changed);
    assert.equal(canRestartUnspentPackageReview(7, changed, {}), false);
  }
  assert.equal(canRestartUnspentPackageReview(7, { state: { stopReason: "Parent report package is unavailable or blocked",
    juryHistory: [] } }, {}), true);
});
