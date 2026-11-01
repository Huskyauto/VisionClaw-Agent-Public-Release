import test from "node:test";
import assert from "node:assert/strict";
import { compilationValidationFailure, compilationCorrectionStopReason } from "../../server/lib/company-compilation-checks";

test("received failed correction is known-invalid, while a claimed correction stays uncertain", () => {
  assert.match(compilationCorrectionStopReason([{ phase: "received", correction: { phase: "received" } }]),
    /received and saved.*did not pass/);
  assert.doesNotMatch(compilationCorrectionStopReason([{ phase: "received", correction: { phase: "received" } }]),
    /uncertain/i);
  assert.match(compilationCorrectionStopReason([{ phase: "received", correction: { phase: "claimed" } }]),
    /uncertain.*reconciliation/);
});

test("compilation failures identify source mismatches and size limits without exposing raw content", () => {
  assert.deepEqual(compilationValidationFailure(new Error(
    "Factual quotation must occur verbatim in its exact retrieved source")), {
    check: "SOURCE_EXCERPT_MISMATCH", label: "A factual excerpt does not match its cited saved source.",
  });
  assert.deepEqual(compilationValidationFailure(new Error(
    "Author compilation exceeds its synthesis input allowance")), {
    check: "AUTHOR_SIZE_LIMIT", label: "The author response exceeds its synthesis input allowance.",
  });
  for (const unknown of [new Error("private source text or provider details"), null,
    { message: "Author compilation exceeds its synthesis input allowance" }]) {
    assert.equal(compilationValidationFailure(unknown), undefined);
  }
});
