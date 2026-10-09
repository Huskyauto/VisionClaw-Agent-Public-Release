import test from "node:test";
import assert from "node:assert/strict";
import {
  observeEvidence, observationMatches, applySemanticReview,
  type EvidenceSource,
} from "../../server/lib/evidence-bound-observation";

const source = (text: string, id = "records"): EvidenceSource => ({
  id, title: "Example ledger snapshot", text, tenantId: 42,
  provenance: "supplied_context", asOf: "2026-10-03",
});
const check = (output: string, sources: EvidenceSource[] = []) =>
  observeEvidence({ tenantId: 42, output, sources });

test("no source means unresolved, not model agreement or a truth certificate", () => {
  const r = check("Revenue was $900.");
  assert.equal(r.status, "no_sources");
  assert.equal(r.verified, false);
  assert.equal(r.units[0].status, "unresolved");
  assert.equal(r.completeFactualCoverage, false);
});

test("exact source text is traceable and mismatched numeric facts are flagged", () => {
  const r = check("Revenue was $900. Profit was $120.", [source("Revenue was $800. Profit was $120.")]);
  assert.equal(r.units[0].status, "possible_conflict");
  assert.equal(r.units[1].status, "exact_source_match");
  assert.equal(r.units[1].evidence[0].sourceId, "records");
  assert.equal(r.verified, false);
});

test("arithmetic is recalculated without treating it as sourced business truth", () => {
  const r = check("2 + 3 = 5. 8 / 2 = 9.");
  assert.equal(r.units[0].arithmetic?.correct, true);
  assert.equal(r.units[1].arithmetic?.correct, false);
  assert.equal(r.units[0].status, "unresolved");
  const wrongSource = check("2 + 3 = 6.", [source("2 + 3 = 6.")]);
  assert.equal(wrongSource.units[0].status, "possible_conflict");
});

test("tenant, output, source bytes and verifier version bind the receipt", () => {
  const sources = [source("Profit was $120.")];
  const r = check("Profit was $120.", sources);
  assert.equal(observationMatches(r, { tenantId: 42, output: "Profit was $120.", sources }), true);
  assert.equal(observationMatches(r, { tenantId: 43, output: "Profit was $120.", sources }), false);
  assert.equal(observationMatches(r, { tenantId: 42, output: "Profit was $121.", sources }), false);
  assert.equal(observationMatches(r, { tenantId: 42, output: "Profit was $120.", sources: [source("Profit was $121.")] }), false);
  assert.equal(observationMatches({ ...r, version: "fake" } as any, { tenantId: 42, output: "Profit was $120.", sources }), false);
  assert.equal(observationMatches({ ...r, version: "source-observation-v1" } as any, { tenantId: 42, output: "Profit was $120.", sources }), false);
});

test("invalid scope, generated drafts, duplicate IDs and oversize sources fail closed", () => {
  for (const sources of [
    [{ ...source("Profit was $120."), tenantId: 43 }],
    [{ ...source("Profit was $120."), provenance: "model_draft" } as any],
    [source("a"), source("b")],
    [source("x".repeat(24001))],
  ]) {
    const r = check("Profit was $120.", sources);
    assert.equal(r.status, "unavailable");
    assert.equal(r.verified, false);
  }
});

test("semantic votes require real source spans and never become deterministic proof", () => {
  const r = check("The company earned $120.", [source("Profit was $120.")]);
  const supported = applySemanticReview(r, [{ unitId: "u1", verdict: "supported", evidence: [{ sourceId: "records", quote: "Profit was $120." }] }], [source("Profit was $120.")]);
  assert.equal(supported.units[0].status, "provisional_support");
  assert.equal(supported.verified, false);
  const fabricated = applySemanticReview(r, [{ unitId: "u1", verdict: "supported", evidence: [{ sourceId: "records", quote: "The company earned $120." }] }], [source("Profit was $120.")]);
  assert.equal(fabricated.units[0].status, "unresolved");
  const unknown = applySemanticReview(r, [{ unitId: "u1", verdict: "supported", evidence: [{ sourceId: "invented", quote: "Profit was $120." }] }], [source("Profit was $120.")]);
  assert.equal(unknown.units[0].status, "unresolved");
});

test("bounds expose omitted units and never silently truncate source coverage", () => {
  const r = check(Array.from({ length: 80 }, (_, i) => `Fact ${i} exists.`).join(" "), [source("Fact 0 exists.")]);
  assert.equal(r.coverage.totalUnits, 80);
  assert.equal(r.coverage.examinedUnits, 60);
  assert.equal(r.coverage.omittedUnits, 20);
  assert.equal(r.completeFactualCoverage, false);
  assert.equal(check("x".repeat(16001), [source("x")]).status, "unavailable");
});

test("identical source snapshots do not count as independent confirmations", () => {
  const r = check("Profit was $120.", [source("Profit was $120.", "a"), source("Profit was $120.", "b")]);
  assert.equal(r.sourceCoverage.uniqueContentCount, 1);
  assert.equal(r.sourceIndependenceEstablished, false);
});

test("conflicting sources override a tempting exact match and dates keep their scope", () => {
  const r = check("Revenue was $800.", [source("Revenue was $800.", "a"), source("Revenue was $900.", "b")]);
  assert.equal(r.units[0].status, "possible_conflict");
  const scoped = check("Revenue in 2026 was $800.", [source("Revenue in 2025 was $900.")]);
  assert.equal(scoped.units[0].status, "unresolved");
});

test("equivalent numeric formatting is not a conflict, but different values and units stay scoped", () => {
  // Held-out regression forms, separate from the real-document evaluation case.
  for (const [actual, evidence] of [
    ["Temperature was 32 °C.", "Temperature was 32.0 °C."],
    ["Revenue was $1000.", "Revenue was $1,000.00."],
    ["Current was 0.5 A.", "Current was 0.50 A."],
    ["Temperature was 0 °C.", "Temperature was -0.00 °C."],
  ]) {
    assert.equal(check(actual, [source(evidence)]).units[0].status, "unresolved");
  }
  assert.equal(check("Temperature was 33 °C.", [source("Temperature was 32.0 °C.")]).units[0].status, "possible_conflict");
  assert.equal(check("Temperature was 32 °F.", [source("Temperature was 32.0 °C.")]).units[0].status, "unresolved");
  assert.equal(check("Balance was $9007199254740993.", [source("Balance was $9007199254740992.")]).units[0].status, "possible_conflict");
});

test("missing/duplicate semantic judgments expose partial or unavailable coverage", () => {
  const sources = [source("Profit was $120.")];
  const r = check("The company earned $120. It opened a new branch.", sources);
  const judgment = { unitId: "u1", verdict: "supported", evidence: [{ sourceId: "records", quote: "Profit was $120." }] };
  const partial = applySemanticReview(r, [judgment], sources);
  assert.equal(partial.semanticReview, "partial");
  assert.deepEqual(partial.semanticCoverage, { requestedUnits: 2, assessedUnits: 1 });
  assert.equal(applySemanticReview(r, [judgment, judgment], sources).semanticReview, "unavailable");
  assert.equal(applySemanticReview(r, [{ ...judgment, verdict: "verified" }], sources).semanticReview, "unavailable");
});

test("fixed ground-truth comparison exposes a wrong majority-style answer", () => {
  const fixtures = [
    { evidence: "Revenue was $800.", wrong: "Revenue was $900.", correct: "Revenue was $800." },
    { evidence: "The service fee is $49.", wrong: "The service fee is $99.", correct: "The service fee is $49." },
  ];
  for (const f of fixtures) {
    assert.equal(check(f.wrong, [source(f.evidence)]).units[0].status, "possible_conflict");
    assert.equal(check(f.correct, [source(f.evidence)]).units[0].status, "exact_source_match");
  }
});