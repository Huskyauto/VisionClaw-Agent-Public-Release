import { z } from "zod";

// This evaluates operator-supplied extraction results. It never parses invoices,
// calls a provider, selects a model, posts accounting entries or stores data.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const fields = z.object({
  vendor: z.string().trim().min(1).max(200),
  invoiceNumber: z.string().trim().min(1).max(100),
  invoiceDate: date,
  currency: z.string().regex(/^[A-Z]{3}$/),
  totalCents: z.number().int().min(0).max(1_000_000_000),
}).strict();
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const seconds = z.number().finite().min(0).max(86_400);
const input = z.object({
  dataClass: z.enum(["synthetic", "customer-approved"]),
  // Approval and timing are operator declarations, not independent receipts.
  documents: z.array(z.object({
    documentId: id,
    truth: fields,
    manualEntrySeconds: seconds.refine(n => n > 0),
  }).strict()).min(1).max(100),
  predictions: z.array(z.object({
    documentId: id,
    extracted: fields.partial(),
  }).strict()).max(100),
  // Whole-batch elapsed time, including failures; never per-success averages.
  extractionSeconds: seconds,
  reviewAndCorrectionSeconds: seconds,
  setupSeconds: seconds,
}).strict();

export type InvoicePilotInput = z.infer<typeof input>;
const fieldNames = ["vendor", "invoiceNumber", "invoiceDate", "currency", "totalCents"] as const;
const critical = ["vendor", "invoiceNumber", "currency", "totalCents"] as const;
const same = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string" ? a.trim() === b.trim() : a === b;

export function evaluateInvoicePilot(value: unknown) {
  const parsed = input.safeParse(value);
  // Do not reflect malformed input, vendor names or paths in operator logs.
  if (!parsed.success) throw new Error("Invalid invoice pilot input");
  const sample = parsed.data;
  const expected = new Map(sample.documents.map(d => [d.documentId, d]));
  const predicted = new Map(sample.predictions.map(d => [d.documentId, d]));
  if (expected.size !== sample.documents.length || predicted.size !== sample.predictions.length
    || sample.predictions.some(p => !expected.has(p.documentId))) {
    throw new Error("Duplicate or unexpected invoice document identifier");
  }
  const documents = sample.documents.length;
  let correctFields = 0;
  let exactDocuments = 0;
  let criticalFieldErrors = 0;
  let missingDocuments = 0;
  for (const document of sample.documents) {
    const prediction = predicted.get(document.documentId);
    if (!prediction) missingDocuments++;
    let correct = 0;
    for (const field of fieldNames) {
      const matches = prediction !== undefined && same(document.truth[field], prediction.extracted[field]);
      if (matches) { correctFields++; correct++; }
      else if ((critical as readonly string[]).includes(field)) criticalFieldErrors++;
    }
    if (correct === fieldNames.length) exactDocuments++;
  }
  const fieldAccuracy = correctFields / (documents * fieldNames.length);
  const exactDocumentRate = exactDocuments / documents;
  const manualSeconds = sample.documents.reduce((sum, d) => sum + d.manualEntrySeconds, 0);
  const assistedSeconds = sample.extractionSeconds + sample.reviewAndCorrectionSeconds + sample.setupSeconds;
  const netSecondsSaved = manualSeconds - assistedSeconds;
  const savingsRate = netSecondsSaved / manualSeconds;
  const blockers: string[] = [];
  if (sample.dataClass !== "customer-approved") blockers.push("real-sample-required");
  if (documents < 20) blockers.push("minimum-20-documents");
  if (missingDocuments) blockers.push("missing-documents");
  if (fieldAccuracy < 0.98) blockers.push("field-accuracy-below-98-percent");
  if (exactDocumentRate < 0.95) blockers.push("document-accuracy-below-95-percent");
  if (criticalFieldErrors) blockers.push("critical-field-errors");
  if (savingsRate < 0.30) blockers.push("net-time-savings-below-30-percent");
  return {
    evaluationVersion: "invoice-pilot-v1",
    dataClass: sample.dataClass,
    evidence: "operator-declared sample, ground truth and timing; not independently verified",
    documents, missingDocuments, correctFields, fieldAccuracy, exactDocumentRate,
    criticalFieldErrors, manualSeconds, assistedSeconds, netSecondsSaved, savingsRate,
    readyForPaidPilot: blockers.length === 0,
    // Even a pass is permission to consider a supervised pilot, never auto-post.
    scope: "five header fields only; no line-item, tax, duplicate-payment or accounting-posting validation",
    blockers,
  };
}

export function syntheticInvoicePilot(): InvoicePilotInput {
  const documents = Array.from({ length: 20 }, (_, i) => ({
    documentId: `example_${i + 1}`,
    truth: {
      vendor: "Example Supplier",
      invoiceNumber: `EX-${i + 1}`,
      invoiceDate: "2026-11-25",
      currency: "USD",
      totalCents: 12_500 + i * 100,
    },
    manualEntrySeconds: 90,
  }));
  return {
    dataClass: "synthetic",
    documents,
    predictions: documents.map(d => ({ documentId: d.documentId, extracted: { ...d.truth } })),
    extractionSeconds: 60,
    reviewAndCorrectionSeconds: 480,
    setupSeconds: 60,
  };
}
