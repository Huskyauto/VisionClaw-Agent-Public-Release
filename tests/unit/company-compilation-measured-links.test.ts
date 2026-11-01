import test from "node:test";
import assert from "node:assert/strict";
import { validateCompiledReport, type ReportEvidence } from "../../server/lib/business-report-evidence";

const contact = "https://example.com/contact-us/";
const observed = `observed: An inquiry or booking link was found, but its destination and completion were not tested.
Source: https://example.com/
Evidence: Same-origin link: Contact: ${contact}
Next step: Inspect the destination before relying on the form.`;
const evidence: ReportEvidence = {
  version: 1, capturedAt: "2026-10-21T00:00:00Z", limitations: [],
  sources: [{ id: "S7", kind: "measurement", title: "Read-only agent journey: Inquiry path",
    url: "https://example.com/", text: observed, sha256: "fixture", retrievedAt: "2026-10-21T00:00:00Z" }],
};
const report = (url = contact) => ({ sections: [{ heading: "Website and Customer Journey", blocks: [
  { type: "recommendation", text: `Inspect and test ${url} before changing the inquiry workflow. Its required fields, destination routing and submission behavior remain untested; ask the web administrator to verify them.`, sourceIds: ["S7"] },
] }], unknowns: ["Form submission behavior is not established."] });

test("compilation may discuss an exact measured inquiry link without claiming destination retrieval", () => {
  const result = validateCompiledReport(report(), ["Website and Customer Journey"], evidence, true, "compilation");
  assert.match(result.sections[0].body, /Linked URL only \(destination content not verified\): https:\/\/example.com\/contact-us\//);
  assert.match(result.sections[0].body, /Our recommendation/);
  assert.throws(() => validateCompiledReport(report("https://example.com/invented/"),
    ["Website and Customer Journey"], evidence, true, "compilation"), /Unretrieved citation URL/);
  assert.throws(() => validateCompiledReport(report(), ["Website and Customer Journey"],
    { ...evidence, sources: evidence.sources.map(source => ({ ...source, kind: "customer" as const })) },
    true, "compilation"), /Unretrieved citation URL/);
  assert.throws(() => validateCompiledReport(report(), ["Website and Customer Journey"], evidence, true),
    /Unretrieved citation URL/);
});

test("measured-link support preserves exact factual quotations and rejects paraphrases", () => {
  const quoted = { sections: [{ heading: "Website and Customer Journey", blocks: [
    { type: "fact", text: observed, sourceIds: ["S7"] },
  ] }], unknowns: [] };
  const result = validateCompiledReport(quoted, ["Website and Customer Journey"], evidence, true, "compilation");
  assert.match(result.sections[0].body, /Linked URL only \(destination content not verified\)/);
  quoted.sections[0].blocks[0].text = `The contact form works correctly at ${contact} and has been tested.`;
  assert.throws(() => validateCompiledReport(quoted, ["Website and Customer Journey"], evidence, true, "compilation"),
    /Factual quotation must occur verbatim/);
});
