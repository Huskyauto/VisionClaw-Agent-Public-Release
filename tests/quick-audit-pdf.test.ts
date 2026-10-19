import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { createQuickAuditPdf } from "../server/quick-audit-pdf";
import { analyzeAgentJourney } from "../server/lib/agent-journey";

test("creates a readable quick-audit PDF from completed results", async () => {
  const bytes = await createQuickAuditPdf({
    websiteUrl: "https://example.com",
    finalUrl: "https://www.example.com/",
    overallScore: 74,
    grade: "C",
    fetchedAt: "2026-09-13T12:00:00.000Z",
    checks: [{
      id: "llms",
      label: "llms.txt file",
      category: "AI readiness",
      status: "fail",
      score: 0,
      maxScore: 18,
      detail: "No /llms.txt found.",
      recommendation: "Add an /llms.txt file.",
    }],
    recommendations: ["Add an /llms.txt file."],
  });

  assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), "%PDF-");
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 1);
});

test("handles Unicode and paginates long quick-audit content", async () => {
  const bytes = await createQuickAuditPdf({
    websiteUrl: "https://example.com",
    finalUrl: "https://example.com/",
    overallScore: 45,
    grade: "F",
    fetchedAt: "2026-09-13T12:00:00.000Z",
    checks: Array.from({ length: 12 }, (_, index) => ({
      id: `check-${index}`,
      label: `Accessibility check 🚀 ${index}`,
      category: "Structure",
      status: "warn" as const,
      score: 2,
      maxScore: 5,
      detail: `页面标题 ${"unbroken".repeat(150)}`,
      recommendation: "Use a clear heading hierarchy.",
    })),
    recommendations: ["Clarify the page title ✨", "Improve heading structure."],
  });

  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() > 1);
});

test("quick PDF renders all five journey checks, evidence and scope without replacing technical checks", async () => {
  const agentJourney = analyzeAgentJourney([{ url: "https://example.com/", html:
    "<h2>Our services</h2><p>Equipment maintenance and installation</p><a href='/contact'>Contact us</a>" }]);
  const base = { websiteUrl: "https://example.com/", finalUrl: "https://example.com/",
    overallScore: 70, grade: "C", fetchedAt: "2026-10-19T00:00:00Z", checks: [],
    recommendations: [] };
  const expanded = await PDFDocument.load(await createQuickAuditPdf({ ...base, agentJourney }));
  const text = expanded.context.enumerateIndirectObjects().flatMap(([, object]) =>
    object instanceof PDFRawStream
      ? [...Buffer.from(decodePDFRawStream(object).getBytes()).toString().matchAll(/<([A-F0-9]+)>\s*Tj/g)]
        .map(match => Buffer.from(match[1], "hex").toString("latin1"))
      : []).join(" ").replace(/\s+/g, " ");
  for (const check of agentJourney.checks) assert.ok(text.includes(check.label), `Missing ${check.id}`);
  assert.ok(text.includes("Equipment maintenance and installation"));
  assert.ok(text.includes("No forms were submitted"));
  assert.ok(text.includes("100-point technical score is unchanged"));
});