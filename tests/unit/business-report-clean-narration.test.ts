import test from "node:test";
import assert from "node:assert/strict";
import { buildReportNarration } from "../../server/lib/business-report-audio";
import { buildReportSectionNarrations } from "../../server/lib/business-report-narration";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { addReportSectionAudioLinks, locateReportSections, reportSectionAudioLinksFromPdf } from "../../server/lib/business-report-section-links";
import { prepareReportSectionAudio, type ReportAudioDependencies } from "../../server/lib/business-report-audio-delivery";
import { reportEvidenceAppendices } from "../../server/lib/business-report-evidence";

test("narration preserves advice and figures, not quotations, citations or source appendices", () => {
  const text = buildReportNarration("Company report", [
    { heading: "Next steps", body: "Source excerpt: CALL TODAY.\n\nA second quoted paragraph.\n\nOur recommendation: **Test maintenance memberships** with 12 customers (S1, S2). Measure booked visits, not page views [S3].\n\nPlanning assumption (not a forecast): A $25 monthly price needs validation." },
    { heading: "Sources & Evidence Documentation", body: "[S1] https://example.com/ Retrieved: yesterday." },
  ]);
  assert.match(text, /Test maintenance memberships/);
  assert.match(text, /12 customers/);
  assert.match(text, /\$25/);
  assert.match(text, /not a forecast/);
  assert.doesNotMatch(text, /CALL TODAY|quoted paragraph|\bS[123]\b|https:|Retrieved:|Source excerpt|\*\*/);
});

test("full report narration omits supporting appendices and formatted excerpt labels", () => {
  const text = buildReportNarration("Company report", [
    { heading: "Action Plan", body: "**Source excerpt:** CALL OUR OFFICE.\n\n**Our recommendation:** Run a 12-customer pilot [S1].\n\n**Planning assumption (not a forecast):** Budget $250." },
    { heading: "Supporting Source Quotations", body: "PRIVATE QUOTED WEBSITE TEXT" },
    { heading: "Appendix: Source Register", body: "SOURCE REGISTER CONTENT" },
    { heading: "Research Register", body: "INTERNAL RESEARCH LOG" },
    { heading: "Limitations", body: "Actual revenue is unknown." },
  ]);
  assert.match(text, /12-customer pilot/);
  assert.match(text, /Budget \$250/);
  assert.match(text, /Actual revenue is unknown/);
  assert.doesNotMatch(text, /CALL OUR OFFICE|PRIVATE QUOTED|SOURCE REGISTER CONTENT|INTERNAL RESEARCH|Source excerpt|Our recommendation:|\bS1\b/);
});

test("actual finalizer appendices stay written-only while body limitations remain spoken", () => {
  const appendices = reportEvidenceAppendices({ sources: [], limitations: ["APPENDIX-ONLY RESEARCH GAP"] } as any,
    ["APPENDIX-ONLY COMPILER UNKNOWN"], { digest: "bound", round: 1, juryVerdict: "pass", museRequestId: "retained" }, true);
  const text = buildReportNarration("Report", [
    { heading: "Executive Summary", body: "Test one improvement." },
    { heading: "Limitations", body: "Revenue depends on actual customer demand." },
    { heading: "Prioritized Action Plan", body: "Assign an owner and measure the pilot." },
    ...appendices,
    { heading: "Disclaimer", body: "Verify consequential claims before acting." },
  ]);
  assert.match(text, /actual customer demand/);
  assert.match(text, /Assign an owner/);
  assert.match(text, /Verify consequential claims/);
  assert.doesNotMatch(text, /APPENDIX-ONLY|Limits, Assumptions|Source quotations establish|independent public-source advisory/);
});

test("section generation reserves all tracks first and reuses finished sections without new speech", async () => {
  const receipts = new Map<string, any>();
  let spoken = 0;
  const deps: ReportAudioDependencies = {
    assertAllowed: async () => {},
    synthesize: async () => { assert.equal(receipts.size, 2); spoken++; return Buffer.alloc(1200); },
    merge: async parts => Buffer.concat(parts),
    validate: async () => {},
    upload: async key => `https://drive.google.com/file/d/${key}/view`,
    store: {
      reserveBatch: async entries => { for (const e of entries) if (!receipts.has(e.key)) receipts.set(e.key, { phase: "reserved" }); },
      claim: async key => ({ created: false, receipt: { ...receipts.get(key) } }),
      beginSynthesis: async key => { assert.equal(receipts.get(key).phase, "reserved"); receipts.get(key).phase = "claimed"; },
      saveAudio: async (key, _bytes, sha) => { Object.assign(receipts.get(key), { phase: "generated", audioSha256: sha }); },
      readAudio: async () => Buffer.alloc(1200),
      beginUpload: async key => { receipts.get(key).phase = "uploading"; },
      ready: async (key, url) => { Object.assign(receipts.get(key), { phase: "ready", viewUrl: url }); },
    },
  };
  const scope = { tenantId: 1, kind: "readiness" as const, orderId: "section-test" };
  const sections = [{ heading: "Executive Summary", body: "Our recommendation: Test first (S1)." },
    { heading: "Next Steps", body: "Keep 12 customers in the pilot." }];
  const tracks = await prepareReportSectionAudio(scope, "Report", sections, deps);
  assert.equal(tracks.length, 2);
  assert.equal(spoken, 2);
  assert.notEqual(tracks[0].viewUrl, tracks[1].viewUrl);
  await prepareReportSectionAudio(scope, "Report", sections, deps);
  assert.equal(spoken, 2);
});

test("each substantive section gets its own clean track; written-only registers stay in the PDF", () => {
  const tracks = buildReportSectionNarrations("Report", [
    { heading: "Executive Summary", body: "Our recommendation: Preserve the existing system (S1)." },
    { heading: "Prioritized Action Plan", body: "Test with 10 customers." },
    { heading: "Sources & Evidence Documentation", body: "S1 source text." },
    { heading: "About This Report", body: "Order: internal-only." },
  ]);
  assert.deepEqual(tracks.map(t => t.heading), ["Executive Summary", "Prioritized Action Plan"]);
  assert.doesNotMatch(tracks.map(t => t.transcript).join(""), /S1|internal-only|source text/);
});

test("PDF puts independent clickable MP3 links beside the actual section headings", async () => {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  page.drawText("Executive Summary", { x: 48, y: 680, size: 16, font });
  page.drawText("Action Plan", { x: 48, y: 500, size: 16, font });
  const bytes = await pdf.save();
  const tracks = ["Executive Summary", "Action Plan"].map((heading, i) => ({
    heading, viewUrl: `https://drive.google.com/file/d/sectionaudio${i}123456/view`, transcriptSha256: "test",
  }));
  const locations = await locateReportSections(bytes, tracks.map(t => t.heading));
  assert.equal(locations.get("Action Plan")?.y, 500);
  const output = await addReportSectionAudioLinks(bytes, tracks);
  const linked = await PDFDocument.load(output);
  assert.equal(linked.getPageCount(), 2);
  assert.equal((linked.getPage(1).node.lookup(PDFName.of("Annots")) as any).size(), 2);
  assert.deepEqual(await reportSectionAudioLinksFromPdf(output), tracks.map(({ heading, viewUrl }) => ({ heading, viewUrl })));
  await assert.rejects(() => locateReportSections(bytes, ["Nonexistent section"]), /Cannot locate/);
});
