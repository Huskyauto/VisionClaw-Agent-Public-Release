import test from "node:test";
import assert from "node:assert/strict";
import { readableBusinessReportSections } from "../../server/lib/business-report-readable";
import { plainReadableBusinessReportSections } from "../../server/lib/business-report-readable";
test("each full report gets its own practical reading directions", () => {
  const sections = [{ heading: "Recommendations", body: "Retain this advice." }];
  const kinds = ["readiness", "executive", "opportunities"] as const;
  const guides = kinds.map(kind => {
    const output = readableBusinessReportSections(sections, kind);
    assert.equal(output[0].title, "How to use this report");
    assert.match(JSON.stringify(output), /Retain this advice/);
    return output[0].content;
  });
  assert.equal(new Set(guides).size, 3);
});
import { buildStyledHtml } from "../../server/pdf-create";

test("readable full reports opt into larger text without changing other PDFs", () => {
  const options = { title: "Report", sections: [{ title: "Action plan", content: "Assign an owner." }],
    tenantId: 1, includePlatformBranding: false };
  assert.match(buildStyledHtml({ ...options, readableBody: true }), /p, li \{ font-size: 14px;/);
  assert.doesNotMatch(buildStyledHtml(options), /p, li \{ font-size: 14px;/);
});

test("readable report keeps recommendations and citations, moving quotations to supporting evidence", () => {
  const sections = readableBusinessReportSections([
    { heading: "Listen by section", body: "Obsolete audio index." },
    { heading: "Growth", body: "Our recommendation: Pilot with 12 customers [S1].\n\nSource excerpt: Published offer.\nA second quoted line.\n\nPlanning assumption (not a forecast): $25 needs testing." },
  ]);
  assert.equal(sections.length, 2);
  assert.match(JSON.stringify(sections[0]), /12 customers \[S1\]|\$25 needs testing/);
  assert.doesNotMatch(JSON.stringify(sections[0]), /Published offer|quoted line/);
  assert.match(JSON.stringify(sections[1]), /Published offer|second quoted line/);
  assert.doesNotMatch(JSON.stringify(sections), /Obsolete audio/);
});

test("styled and plain PDFs both separate formatted evidence without dropping advice", () => {
  const input = [{ heading: "Growth", body: "**source excerpt:** Keep this exact quotation.\n\n**OUR RECOMMENDATION:** Pilot with 12 customers [S1].\n\n**Planning assumption (not a forecast):** Validate $25." }];
  for (const projection of [
    readableBusinessReportSections(input, "executive"),
    plainReadableBusinessReportSections(input, "executive"),
  ]) {
    const main = JSON.stringify(projection.slice(0, -1));
    assert.match(main, /12 customers \[S1\]/);
    assert.match(main, /Validate \$25/);
    assert.doesNotMatch(main, /Keep this exact quotation/);
    assert.match(JSON.stringify(projection.at(-1)), /Keep this exact quotation/);
  }
});
