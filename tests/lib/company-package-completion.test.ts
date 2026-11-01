import test from "node:test";
import assert from "node:assert/strict";
import { aggregateReviewPackets, completionEnvelope, packageBudgetMicros, assertCompletionReservation } from "../../server/lib/company-package-completion";

test("v3 spending authority cannot exceed $150 even without correction approval", () => {
  assert.equal(packageBudgetMicros({ productionVersion: 3, modelBudgetMicros: 150_000_000 }), 150_000_000);
  assert.throws(() => packageBudgetMicros({ productionVersion: 3, modelBudgetMicros: 200_000_000 }), /budget/);
});
import { hashReportBytes } from "../../server/lib/business-report-evidence";
import { packageSiblingReviewReady } from "../../server/lib/business-report-review";
import { packageContentReviewMatches, packageContentDigest } from "../../server/lib/company-report-final-review";

test("overall review retains every full section and evidence text, plus every cross-report pair", () => {
  for (const length of [200, 20_000]) {
    const reports = ["readiness", "executive", "opportunities"].map(kind => ({
      kind, model: kind, sections: Array.from({ length: 4 }, (_, i) => ({
        heading: `${kind}-${i}`, body: `${kind}-${i}:` + "substantive text ".repeat(length / 16),
      })),
    }));
    const text = "Company factual source. ".repeat(1200);
    const evidence: any = { version: 1, capturedAt: "2026-10-20", limitations: [],
      sources: [{ id: "S1", title: "Facts", url: "https://example.test/", retrievedAt: "2026-10-20",
        kind: "website", text, sha256: hashReportBytes(text) }] };
    const packets = aggregateReviewPackets(reports, evidence, { reviewed: 1 });
    assert.ok(packets.length >= 4);
    for (const report of reports) for (const section of report.sections) {
      assert.ok(packets.some(p => p.scope === "evidence" && p.packet.includes(JSON.stringify(section))));
    }
    for (let a = 0; a < reports.length; a++) for (let b = a + 1; b < reports.length; b++)
      for (const first of reports[a].sections) for (const second of reports[b].sections)
        assert.ok(packets.some(p => p.scope === "consistency" &&
          p.packet.includes(JSON.stringify(first)) && p.packet.includes(JSON.stringify(second))));
    assert.ok(packets.filter(p => p.scope === "evidence").every(p => p.packet.includes(text)));
    assert.ok(packets.every(p => p.packet.length <= 175_000));
  }
});

test("future completion capacity cannot be consumed by extra retries or larger requests", () => {
  const payload: any = { modelBudgetMicros: 150_000_000, packageSpend: { "draft:old": 24_000_000 },
    completionAdmission: { version: 1, priorKeys: ["draft:old"],
      bounds: { remainingDrafts: 0, initialSeats: 1, compilerRounds: 6, finalSeats: 18, aggregatePackets: 24 } } };
  assert.doesNotThrow(() => assertCompletionReservation(payload, "review:7:initial_jury:1:x:claude", 900_000));
  payload.packageSpend["review:7:initial_jury:1:x:claude"] = 900_000;
  assert.throws(() => assertCompletionReservation(payload, "review:7:initial_jury:1:y:claude", 900_000), /envelope/);
  assert.throws(() => assertCompletionReservation(payload, "draft:unexpected", 1), /envelope/);
  assert.throws(() => assertCompletionReservation(payload, "final-review:one", 2_000_001), /envelope/);
  assert.throws(() => assertCompletionReservation({ packageSpend: {} }, "draft:new", 1), /admission/);
});

test("three admitted siblings reach the content rendezvous before any artifacts, with exact freeze binding", () => {
  const reports = ["readiness", "executive", "opportunities"].map(kind => ({
    kind, model: kind, sections: [{ heading: "Summary", body: "Complete substantive report text." }] }));
  const state: any = { reports: Object.fromEntries(reports.map(r => [r.kind, { status: "pending" }])),
    research: { evidence: { version: 1, capturedAt: "2026-10-20", limitations: [], sources: [] }, coverage: {} } };
  const parent = { completionAdmission: { version: 1 }, state };
  for (const report of reports) assert.equal(packageSiblingReviewReady(parent, report.kind), true);
  const digests = aggregateReviewPackets(reports, state.research.evidence, state.research.coverage).map(p => hashReportBytes(p.packet));
  const digest = packageContentDigest(reports);
  const review = { approved: true, digest, manifestDigest: hashReportBytes(JSON.stringify({ digest, packetDigests: digests })),
    packets: Object.fromEntries(digests.map(d => [d, { approved: true, report: { approved: true, issues: [] } }])) };
  assert.equal(packageContentReviewMatches({ approved: true, digest }, reports, state), false);
  assert.equal(packageContentReviewMatches(review, reports, state), true);
  const changed = structuredClone(reports); changed[1].sections[0].body += "Later correction.";
  assert.equal(packageContentReviewMatches(review, changed, state), false);
  state.research.evidence.limitations.push("Newly discovered source gap");
  assert.equal(packageContentReviewMatches(review, reports, state), false);
});

test("completion admission covers all remaining calls and refuses unknown or insufficient bounds", () => {
  const plan = completionEnvelope({ spentMicros: 24_000_000, ceilingMicros: 100_000_000,
    remainingDrafts: 0, initialSeats: 1, compilerRounds: 6, finalSeats: 18, aggregatePackets: 12 });
  assert.equal(plan.ready, true);
  assert.equal(plan.operations.length, 37);
  assert.equal(completionEnvelope({ ...plan.inputs, ceilingMicros: 30_000_000 }).ready, false);
  assert.throws(() => completionEnvelope({ ...plan.inputs, aggregatePackets: NaN }), /bound/);
  assert.equal(packageBudgetMicros({}), 30_000_000);
  assert.equal(packageBudgetMicros({ modelBudgetMicros: 100_000_000 }), 100_000_000);
  for (const value of [null, "100000000", 0, Infinity, 201_000_000])
    assert.throws(() => packageBudgetMicros({ modelBudgetMicros: value }), /budget/);
});
