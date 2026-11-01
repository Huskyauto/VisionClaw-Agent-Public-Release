import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { wrapCompanyReportText } from "../../server/lib/company-report-render";
import { collectBusinessReportEvidence, hashReportBytes } from "../../server/lib/business-report-evidence";

test("report wrapping preserves ordinary words and only splits over-wide tokens", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const text = "Research limitations and source documentation follow.";
  const lines = wrapCompanyReportText(text, font, 10, 150);
  assert.equal(lines.join(" "), text);
  for (const line of lines) assert.ok(font.widthOfTextAtSize(line, 10) <= 150);
  const token = "https://example.com/" + "x".repeat(300);
  const pieces = wrapCompanyReportText(token, font, 10, 150);
  assert.ok(pieces.length > 1);
  assert.equal(pieces.join(""), token);
  for (const piece of pieces) assert.ok(font.widthOfTextAtSize(piece, 10) <= 150);
});

test("failed llms.txt retrieval cannot become a definitive missing-file report finding", async () => {
  let paidCalls = 0;
  const result = await collectBusinessReportEvidence(
    { company: "Example Company", website: "https://example.com/" },
    { allowPaidExtraction: false, retainMeasuredScore: true },
    {
      runAudit: async () => ({ overallScore: 33, grade: "F", finalUrl: "https://example.com/",
        checks: [
          { id: "llms_txt", label: "llms.txt file", status: "fail", detail: "No /llms.txt found." },
          { id: "viewport", label: "Mobile viewport", status: "fail", detail: "No mobile viewport meta found." },
        ] }) as any,
      safeFetchText: async () => ({ ok: false, status: 503, text: "", error: "Unavailable" }) as any,
      publicSearch: async () => ({ success: false, results: [] }),
      fallback: async () => { paidCalls++; throw new Error("Paid fallback must not run"); },
    });
  const measurement = result.sources.find(s => s.title === "Measured website technical checks")!;
  assert.ok(measurement);
  assert.doesNotMatch(measurement.text, /llms\.txt file: FAIL|No \/llms\.txt found/);
  assert.match(measurement.text, /llms\.txt.*NOT ESTABLISHED/);
  assert.match(measurement.text, /Mobile viewport: FAIL/);
  assert.match(result.limitations.join(" "), /do not infer a pass\/failure/);
  assert.equal(measurement.sha256, hashReportBytes(measurement.text));
  assert.equal(paidCalls, 0);
});
