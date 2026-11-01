import test from "node:test";
import assert from "node:assert/strict";
import { compilerContinuationPlan } from "../../server/lib/company-report-compiler-continuation";
import { retainedCompanyReviewFixture } from "../helpers/retained-company-review";
import { buildReportJurySnapshot } from "../../server/lib/business-report-review";
import { hashReportBytes } from "../../server/lib/business-report-evidence";

test("completed paid initial votes may be reused for explicitly approved unspent compilation, never re-run", () => {
  const { parent, child } = retainedCompanyReviewFixture();
  const before = structuredClone({ parent, child });
  const plan = compilerContinuationPlan(parent, [child]);
  assert.equal(plan.available, true);
  assert.deepEqual(plan.childIds, [7]);
  assert.ok(plan.reports[0].compilerChars < 180000);
  assert.deepEqual({ parent, child }, before, "inspection has no side effects");
  for (const alter of [
    (p: any, c: any) => { p.payload.packageSpend["compiler:7:any"] = 1; },
    (p: any) => { p.payload.packageSpend["review:7:final_jury:unexpected"] = 1; },
    (p: any) => { p.payload.packageSpend["draft:limit"] = 30000000; },
    (p: any) => { p.status = "unknown"; },
    (_p: any, c: any) => { c.payload.compilerRuns = { any: { status: "claimed" } }; },
    (_p: any, c: any) => { c.payload.state.reply = {}; },
    (_p: any, c: any) => { c.payload.fulfillment = {}; },
    (_p: any, c: any) => { c.payload.state.correctionChecklist[0].text = "Different correction"; },
    (_p: any, c: any) => { c.payload.state.juryHistory[0].verdict = "REJECT"; },
    (_p: any, c: any) => { c.payload.paidJuryRuns[Object.keys(c.payload.paidJuryRuns)[0]].proposers[2].answer = ""; },
    (_p: any, c: any) => { c.payload.paidJuryRuns[Object.keys(c.payload.paidJuryRuns)[0]].proposers[0].evidence.receipts[0].sha256 = "a".repeat(64); },
    (_p: any, c: any) => { c.payload.paidJuryRuns[Object.keys(c.payload.paidJuryRuns)[0]].proposers[0].reportedModel = "different-model"; },
    (_p: any, c: any) => { c.payload.input.sections[0].body += "Changed"; },
    (_p: any, c: any) => { c.payload.state.expiresAt = "2000-01-01"; },
    (_p: any, c: any) => { c.tenant_id = 2; },
    (_p: any, c: any) => { c.status = "running"; },
    (p: any) => { p.payload.packageSpend.bad = "0"; },
  ]) {
    const p = structuredClone(parent), c = structuredClone(child); alter(p, c);
    assert.equal(compilerContinuationPlan(p, [c]).available, false);
  }
  const changed = structuredClone(child); changed.attempts++;
  assert.notEqual(compilerContinuationPlan(parent, [changed]).snapshot, plan.snapshot);
});

test("database key-order normalization cannot invalidate an exact executed snapshot receipt", () => {
  const { parent, child, phase } = retainedCompanyReviewFixture();
  const reorder = (value: any): any => Array.isArray(value) ? value.map(reorder) :
    value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, reorder(value[key])])) : value;
  child.payload.input.evidence = reorder(child.payload.input.evidence);
  parent.payload.state.research.evidence = reorder(parent.payload.state.research.evidence);
  // Receipts were independently read AFTER storage; the opaque intake digest
  // was computed BEFORE JSONB normalized key order and must remain unchanged.
  const sha = hashReportBytes(buildReportJurySnapshot({ input: child.payload.input,
    state: { ...child.payload.state, correctionChecklist: [] } }, true));
  for (const seat of child.payload.paidJuryRuns[phase].proposers) {
    seat.evidence.receipts[0].sha256 = sha;
    seat.evidence.receipts[0].reportInspection.reportSha256 = sha;
  }
  assert.equal(compilerContinuationPlan(parent, [child]).available, true);
});
