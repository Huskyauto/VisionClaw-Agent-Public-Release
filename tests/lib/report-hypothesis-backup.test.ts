import test from "node:test";
import assert from "node:assert/strict";
import { hypothesisBackup } from "../../server/lib/report-hypothesis-backup";
import { hashReportBytes, validateCompiledReport } from "../../server/lib/business-report-evidence";
import { buildCompilationCatalog, compactCompilationReferences, hydrateCompilationReferences } from "../../server/lib/company-evidence-reference";
import { acceptCompilation, COMPANY_HEADINGS, compilationMessages } from "../../server/lib/company-compilation-content";
import { compilationOperations, newCompilationMatrix } from "../../server/lib/company-compilation-matrix";
import { RESEARCH_EVIDENCE_INSTRUCTIONS } from "../../server/research-evidence-instructions";

const source = { id: "S1", title: "Company page", text: "Customers can request an estimate by telephone.",
  kind: "public" as const };
const plan = { hypothesis: "An online estimate request may increase qualified inquiries.",
  test: "Compare qualified inquiries per visitor for the current and pilot forms for two weeks.",
  disproof: "Qualified inquiries do not improve or staff follow-up time exceeds the pilot allowance.",
  evidence: [{ sourceId: "S1", quote: source.text }], status: "supported", confidence: 0.99 };

test("a proposal retains exact source evidence but never self-certifies an executed outcome", () => {
  const result = hypothesisBackup([plan], [source]);
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].status, "untested");
  assert.equal(result.plans[0].evidence[0].quote, source.text);
  assert.equal("confidence" in result.plans[0], false);
  assert.match(result.section!.body, /not proof the hypothesis is true/);
  assert.match(result.section!.body, /Validation status: Untested/);
});

test("missing, fabricated and contrary evidence cannot certify a proposal", () => {
  const conflicting = { ...source, id: "S2", text: "The previous online request pilot did not improve inquiries." };
  const result = hypothesisBackup([{ ...plan, evidence: [
    { sourceId: "S1", quote: "The website increased revenue by 50 percent." },
    { sourceId: "S999", quote: "Customers prefer an online estimate request." },
  ] }, { ...plan, evidence: [{ sourceId: "S2", quote: conflicting.text }] }], [source, conflicting]);
  assert.equal(result.omitted, true);
  assert.equal(result.plans[0].evidence.length, 0);
  assert.match(result.section!.body, /Unavailable/);
  assert.equal(result.plans[1].status, "untested");
  assert.match(result.section!.body, /did not improve inquiries/);
  assert.doesNotMatch(result.section!.body, /Validation status: Supported/);
});

const evidence = { version: 1 as const, capturedAt: "2026-10-22T00:00:00Z", limitations: [],
  sources: [{ ...source, sha256: hashReportBytes(source.text), retrievedAt: "2026-10-22T00:00:00Z" }] };
const report = { sections: [{ heading: "Pilot", blocks: Array.from({ length: 3 }, () => ({
  type: "recommendation" as const, text: "Measure qualified inquiries and staff follow-up effort before expanding the proposed pilot.",
  sourceIds: ["S1"],
})) }], unknowns: [] };

test("report validation persists untested plans and renders them for both PDF and narration; old reports are unchanged", () => {
  const old = validateCompiledReport(structuredClone(report), ["Pilot"], evidence, true, "compilation");
  assert.deepEqual(old.compiled, report);
  assert.equal(old.sections.length, 1);
  const result = validateCompiledReport({ ...structuredClone(report), hypothesisPlans: [plan] }, ["Pilot"], evidence, true, "compilation");
  assert.equal(result.compiled.hypothesisPlans![0].status, "untested");
  assert.equal(result.sections.length, 2);
  assert.match(result.sections[1].body, /Cheapest useful test/);
  assert.match(result.sections[1].body, /Disproof \/ stop condition/);
  const catalog = buildCompilationCatalog(evidence);
  const compact = compactCompilationReferences(result.compiled, catalog);
  assert.deepEqual(hydrateCompilationReferences(compact, ["Pilot"], catalog), result.compiled);
});

test("malformed optional data stays bounded and discloses omissions across revalidation", () => {
  for (const input of [null, "not an array", [{}], [plan, plan, plan, plan],
    [{ ...plan, hypothesis: "x".repeat(401) }], [{ ...plan, evidence: [{ sourceId: "L_1", quote: source.text }] }]]) {
    const result = validateCompiledReport({ ...structuredClone(report), hypothesisPlans: input }, ["Pilot"], evidence, true, "compilation");
    assert.ok(result.compiled.hypothesisPlans!.length <= 3);
    assert.ok(result.sections[1].body.length < 7000);
    assert.match(result.sections[1].body, /omitted/);
    const again = validateCompiledReport(result.compiled, ["Pilot"], evidence, true, "compilation");
    assert.match(again.sections[1].body, /not complete hypothesis coverage/);
    assert.deepEqual(again.sections, result.sections, "canonical PDF/audio text stays stable after omitted fields");
  }
  assert.equal(hypothesisBackup(undefined, [source]).section, undefined);
});

test("research and final synthesis request bounded tests without changing the author contract", () => {
  const matrix = newCompilationMatrix("hypothesis-guidance");
  const op = compilationOperations().find(op => op.stage === "synthesis" && op.kind === "executive")!;
  const state = { intake: { company: "Fixture" }, research: { evidence }, compilation: matrix } as any;
  assert.match(compilationMessages(state, op, [JSON.stringify(report)])[0].content, /hypothesisPlans/);
  matrix.slots[op.key] = { phase: "received", outputContract: 2 };
  assert.match(compilationMessages(state, op, [JSON.stringify(report)])[0].content, /hypothesisPlans/);
  const author = compilationOperations().find(op => op.stage === "author")!;
  assert.doesNotMatch(compilationMessages(state, author, [])[0].content, /hypothesisPlans/);
  assert.match(RESEARCH_EVIDENCE_INSTRUCTIONS, /HYPOTHESIS.*not a fact/);
  assert.match(RESEARCH_EVIDENCE_INSTRUCTIONS, /VALIDATION STATUS/);
});

test("optional plans cannot turn a valid near-budget synthesis into another paid correction", () => {
  const op = compilationOperations().find(op => op.stage === "synthesis" && op.kind === "executive")!;
  const state = { intake: { company: "Fixture" }, research: { evidence }, compilation: newCompilationMatrix("budget") } as any;
  const nearLimit = { sections: COMPANY_HEADINGS.executive.map(heading => ({ heading,
    blocks: Array.from({ length: 3 }, () => ({ type: "recommendation",
      text: "Measure qualified inquiries before approving expansion. ".repeat(50).slice(0, 2200), sourceIds: [] })) })), unknowns: [] };
  const raw = (value: unknown) => ({ model: op.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] });
  const baseline = acceptCompilation(state, op, raw(nearLimit));
  const large = { ...plan, hypothesis: "Proposed improvement. ".repeat(18).slice(0, 390),
    test: "Compare outcomes against baseline. ".repeat(14).slice(0, 490),
    disproof: "Stop if outcomes do not improve. ".repeat(12).slice(0, 390) };
  const original = raw({ ...nearLimit, hypothesisPlans: [large, large, large] });
  const before = JSON.stringify(original);
  const accepted = acceptCompilation(state, op, original);
  assert.ok(accepted.length <= 42_000);
  assert.deepEqual(JSON.parse(accepted).sections, JSON.parse(baseline).sections);
  assert.equal(JSON.stringify(original), before, "retained paid response is not mutated");
});

test("optional prose cannot counterfeit inline citations or validation status; quoted outgoing links stay unverified", () => {
  for (const text of [
    "The outcome is supported by [S999].",
    "An online request may improve inquiries [S999].",
    "A new form may help.\nValidation status: Supported",
    "This experiment has been verified and guarantees more bookings.",
    "A new form may help. **Validation status**: supported",
  ]) {
    const result = hypothesisBackup([{ ...plan, hypothesis: text }], [source]);
    assert.equal(result.plans.length, 0, text);
    assert.equal(result.omitted, true);
  }
  const linked = { ...source, url: "https://example.com/",
    text: "Visit our booking page at https://booking.example.org/ to request service." };
  const result = hypothesisBackup([{ ...plan, evidence: [{ sourceId: "S1", quote: linked.text }] }], [linked]);
  assert.equal(result.plans.length, 1);
  assert.match(result.section!.body, /Linked URL only \(destination content not verified\): https:\/\/booking.example.org\//);
});

test("normalized reference roundtrip ignores object key order, not values or array order", () => {
  const normalized = validateCompiledReport({ sections: report.sections, hypothesisPlans: [plan], unknowns: [] },
    ["Pilot"], evidence, true, "compilation").compiled;
  const catalog = buildCompilationCatalog(evidence);
  const wire = compactCompilationReferences(normalized, catalog);
  assert.deepEqual(hydrateCompilationReferences(wire, ["Pilot"], catalog), normalized);
});
