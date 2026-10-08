import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { createQuickAuditPdf } from "../server/quick-audit-pdf";

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