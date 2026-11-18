import test from "node:test";
import assert from "node:assert/strict";
import { buildReportWritingPlan } from "../../server/lib/report-writing-plan";
import { hashReportBytes, validateCompiledReport, type ReportEvidence } from "../../server/lib/business-report-evidence";
import { buildCompilationCatalog } from "../../server/lib/company-evidence-reference";

const evidence = (): ReportEvidence => {
  const text = "Measured conversion was 12.5% across 80 enquiries; revenue was not measured.";
  return { version: 1, capturedAt: "2026-11-14", limitations: ["No independent profit measurement."],
    sources: [{ id: "S1", title: "Experiment", kind: "measurement", text,
      sha256: hashReportBytes(text), retrievedAt: "2026-11-14", url: "https://example.com/results" }] };
};

test("writing preparation groups exact duplicate captures without merging different provenance or changing evidence", () => {
  const input = evidence();
  input.sources.push({ ...input.sources[0], id: "S2" },
    { ...input.sources[0], id: "S3", kind: "customer" },
    { ...input.sources[0], id: "S4", url: "https://example.com/other" });
  const original = JSON.stringify(input);
  const plan = buildReportWritingPlan(["Results", "Costs and Measurement"], input);
  assert.equal(plan.version, 1);
  assert.equal(plan.sourceRegister.length, 3);
  assert.deepEqual(plan.sourceRegister[0].sourceIds, ["S1", "S2"]);
  assert.deepEqual(plan.sourceRegister[1].sourceIds, ["S3"]);
  assert.deepEqual(plan.sections.map(s => s.heading), ["Results", "Costs and Measurement"]);
  assert.ok(plan.sections.every(s => s.evidenceNeeds.length > 0));
  assert.equal(JSON.stringify(input), original);
  assert.equal(JSON.stringify(plan).includes("12.5%"), false, "plan does not duplicate or reinterpret measurements");
  const laterCapture = structuredClone(input);
  laterCapture.sources[1].retrievedAt = "2026-11-15";
  assert.equal(buildReportWritingPlan(["Results"], laterCapture).sourceRegister.length, 4);
});

test("scientific preparation requests reproducible methods and source-bound figures without claiming research was performed", () => {
  const plan = buildReportWritingPlan(["Methods", "Figures and Results"], evidence());
  assert.match(plan.sections[0].evidenceNeeds.join(" "), /reproduc|protocol/i);
  assert.match(plan.sections[1].evidenceNeeds.join(" "), /illustrat|chart/i);
  assert.match(plan.boundary, /not claim verification/);
  const empty = buildReportWritingPlan(["Results"], { ...evidence(), sources: [] });
  assert.deepEqual(empty.sourceRegister, []);
  assert.match(empty.sections[0].evidenceNeeds.join(" "), /missing measurements/);
});

test("catalog construction refuses empty source identities rather than creating ambiguous references", () => {
  const input = evidence();
  input.sources[0].id = "";
  assert.throws(() => buildCompilationCatalog(input), /source identity/i);
});

test("ambiguous citation IDs and altered measurements cannot pass the shared report validator", () => {
  const input = evidence(), text = input.sources[0].text;
  const report = { sections: [{ heading: "Results", blocks: [
    { type: "fact", text, sourceIds: ["S1"] },
    { type: "assumption", text: "Illustrative revenue is not an observed outcome. Measure revenue in a separately approved pilot before drawing conclusions.", sourceIds: [] },
  ] }], unknowns: ["Revenue was not measured."] };
  const prior = JSON.stringify(report);
  assert.doesNotThrow(() => validateCompiledReport(report, ["Results"], input));
  const changed = structuredClone(report);
  changed.sections[0].blocks[0].text = text.replace("12.5%", "25%");
  assert.throws(() => validateCompiledReport(changed, ["Results"], input), /quotation/i);
  input.sources.push({ ...input.sources[0] });
  assert.throws(() => validateCompiledReport(report, ["Results"], input), /source identity/i);
  assert.equal(JSON.stringify(report), prior);
});
