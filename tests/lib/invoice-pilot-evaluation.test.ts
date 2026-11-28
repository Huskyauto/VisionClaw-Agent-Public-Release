import assert from "node:assert/strict";
import test from "node:test";
import { evaluateInvoicePilot, syntheticInvoicePilot } from "../../server/lib/invoice-pilot-evaluation";

test("synthetic success exercises scoring without claiming a customer pilot passed", () => {
  const result = evaluateInvoicePilot(syntheticInvoicePilot());
  assert.equal(result.documents, 20);
  assert.equal(result.exactDocumentRate, 1);
  assert.equal(result.fieldAccuracy, 1);
  assert.equal(result.netSecondsSaved, 1_200);
  assert.equal(result.readyForPaidPilot, false);
  assert.ok(result.blockers.includes("real-sample-required"));
  assert.ok(!JSON.stringify(result).includes("Example Supplier"));
});

test("only a declared real, complete, accurate, time-saving batch advances to a supervised paid pilot", () => {
  const input = syntheticInvoicePilot();
  input.dataClass = "customer-approved";
  const result = evaluateInvoicePilot(input);
  assert.equal(result.readyForPaidPilot, true);
  assert.deepEqual(result.blockers, []);
  assert.match(result.evidence, /not independently verified/);
  assert.match(result.scope, /no line-item/);
});

test("missing documents stay in the denominator instead of inflating accuracy", () => {
  const input = syntheticInvoicePilot();
  input.dataClass = "customer-approved";
  input.predictions.pop();
  const result = evaluateInvoicePilot(input);
  assert.equal(result.fieldAccuracy, 0.95);
  assert.equal(result.missingDocuments, 1);
  assert.equal(result.criticalFieldErrors, 4);
  assert.equal(result.readyForPaidPilot, false);
});

test("a one-cent error blocks a pilot even with 99 percent overall field accuracy", () => {
  const input = syntheticInvoicePilot();
  input.dataClass = "customer-approved";
  input.predictions[0].extracted.totalCents = input.documents[0].truth.totalCents + 1;
  const result = evaluateInvoicePilot(input);
  assert.equal(result.fieldAccuracy, 0.99);
  assert.equal(result.exactDocumentRate, 0.95);
  assert.equal(result.criticalFieldErrors, 1);
  assert.equal(result.readyForPaidPilot, false);
});

test("setup, extraction and correction time all count against savings", () => {
  const input = syntheticInvoicePilot();
  input.dataClass = "customer-approved";
  input.setupSeconds = 1_800;
  const result = evaluateInvoicePilot(input);
  assert.equal(result.netSecondsSaved, -540);
  assert.ok(result.blockers.includes("net-time-savings-below-30-percent"));
});

test("rejects identifier ambiguity, unsafe numeric shapes and impossible dates without echoing inputs", () => {
  for (const change of [
    (x: any) => { x.predictions[1].documentId = x.predictions[0].documentId; },
    (x: any) => { x.documents[1].documentId = x.documents[0].documentId; },
    (x: any) => { x.predictions[0].documentId = "unknown"; },
    (x: any) => { x.documents[0].truth.totalCents = "12500"; },
    (x: any) => { x.predictions[0].extracted.totalCents = 12500.5; },
    (x: any) => { x.documents[0].truth.invoiceDate = "2026-02-30"; },
    (x: any) => { x.extractionSeconds = -1; },
    (x: any) => { x.reviewAndCorrectionSeconds = NaN; },
    (x: any) => { x.setupSeconds = Infinity; },
    (x: any) => { x.documents[0].truth.vendor = " "; },
    (x: any) => { x.documents[0].truth.accountNumber = "PRIVATE-SENTINEL"; },
  ]) {
    const input = syntheticInvoicePilot();
    change(input);
    assert.throws(() => evaluateInvoicePilot(input), error => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /PRIVATE-SENTINEL|12500|Example Supplier/);
      return true;
    });
  }
});

test("small samples, missing fields and wrong currencies do not pass", () => {
  const input = syntheticInvoicePilot();
  input.dataClass = "customer-approved";
  input.documents.pop();
  input.predictions.pop();
  delete input.predictions[0].extracted.invoiceNumber;
  input.predictions[1].extracted.currency = "EUR";
  const result = evaluateInvoicePilot(input);
  assert.ok(result.blockers.includes("minimum-20-documents"));
  assert.equal(result.criticalFieldErrors, 2);
  assert.equal(result.readyForPaidPilot, false);
});
