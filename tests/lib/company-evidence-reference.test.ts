import test from "node:test";
import assert from "node:assert/strict";
import { hashReportBytes, type ReportEvidence } from "../../server/lib/business-report-evidence";
import { buildCompilationCatalog, hydrateCompilationReferences } from "../../server/lib/company-evidence-reference";
import { deriveLegacyLimitationReferences } from "../../server/lib/company-evidence-reference";

const quote = "We are a family-owned business serving the local community for over 20 years.";
const limitation = "Retrieved customer-feedback sample: 0 review excerpts. Customer satisfaction remains unassessed.";
const evidence: ReportEvidence = { version: 1, capturedAt: "2026-10-22", limitations: [limitation],
  sources: [{ id: "S3", kind: "public", text: quote, title: "About",
    url: "https://example.com/about/", sha256: hashReportBytes(quote), retrievedAt: "2026-10-22" }] };

test("code inserts exact source quotations and separately cited limitations from catalog references", () => {
  const catalog = buildCompilationCatalog(evidence);
  const fact = catalog.entries.find(e => e.kind === "source")!;
  const limit = catalog.entries.find(e => e.kind === "limitation")!;
  const wire = { formatVersion: 2, catalogId: catalog.id, sections: [{ blocks: [
    { type: "fact", evidenceRef: fact.id }, { type: "limitation", evidenceRef: limit.id },
    { type: "recommendation", text: "Ask the owner to verify the operating assumptions before a pilot.", sourceIds: [] },
  ] }], unknowns: ["Internal staffing is not established."] };
  const original = JSON.stringify(wire);
  const report = hydrateCompilationReferences(wire, ["Overview"], catalog);
  assert.equal(report.sections[0].heading, "Overview");
  assert.equal(report.sections[0].blocks[0].text, quote);
  assert.deepEqual(report.sections[0].blocks[0].sourceIds, ["S3"]);
  assert.equal(report.sections[0].blocks[1].text, limitation);
  assert.notDeepEqual(report.sections[0].blocks[1].sourceIds, ["S3"]);
  assert.equal(JSON.stringify(wire), original, "provider receipt is immutable");
});

test("all bad references are diagnosed together, and provenance changes invalidate catalog identity", () => {
  const catalog = buildCompilationCatalog(evidence);
  const wire = { formatVersion: 2, catalogId: catalog.id, sections: [{ blocks: [
    { type: "fact", evidenceRef: "E_invented" },
    { type: "limitation", evidenceRef: catalog.entries.find(entry => entry.kind === "source")!.id },
    { type: "fact", evidenceRef: catalog.entries[0].id, text: "A forged quote cannot be supplied." },
  ] }], unknowns: [] };
  assert.throws(() => hydrateCompilationReferences(wire, ["Overview"], catalog), (error: any) => {
    assert.equal(error.validationIssues.length, 3);
    assert.deepEqual(error.validationIssues.map((issue: any) => issue.path), [
      "sections[0].blocks[0]", "sections[0].blocks[1]", "sections[0].blocks[2]",
    ]);
    return true;
  });
  const changed = buildCompilationCatalog({ ...evidence, sources: evidence.sources.map(source => ({
    ...source, url: "https://example.com/different-origin-of-evidence/",
  })) });
  assert.notEqual(changed.id, catalog.id);
  assert.throws(() => hydrateCompilationReferences(wire, ["Overview"], changed), /Invalid block/);
});

test("legacy recovery records exact scope-note derivation, never borrows company quotes or fixes unknown IDs", () => {
  const catalog = buildCompilationCatalog(evidence);
  const body = { sections: [{ blocks: [
    { type: "fact", text: limitation, sourceIds: ["S3"] },
    { type: "fact", text: limitation + " Not a retained note.", sourceIds: ["S3"] },
    { type: "fact", text: limitation, sourceIds: ["S99"] },
    { type: "fact", text: quote.replace("20", "50"), sourceIds: ["S3"] },
  ] }] };
  const derived = deriveLegacyLimitationReferences(body, catalog);
  assert.equal(derived.length, 1);
  assert.equal(derived[0].originalSourceId, "S3");
  assert.equal(derived[0].reason, "exact_retained_research_limitation");
  assert.match(body.sections[0].blocks[0].sourceIds[0], /^L_/);
  assert.deepEqual(body.sections[0].blocks[1].sourceIds, ["S3"]);
  assert.deepEqual(body.sections[0].blocks[2].sourceIds, ["S99"]);
  assert.equal(body.sections[0].blocks[3].text, quote.replace("20", "50"));
});
