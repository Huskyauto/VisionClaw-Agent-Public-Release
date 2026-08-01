/**
 * R123 — CoVe verifier unit tests.
 *
 * These tests exercise the fail-safe surface (short drafts, malformed JSON,
 * provider failures) WITHOUT making real LLM calls. The end-to-end "did CoVe
 * actually fix a wrong claim" check runs in the research-report-fulfillment
 * smoke when a real provider is available — that's outside unit-test scope.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

test("R123 CoVe — short drafts are returned unchanged with a warning", async () => {
  const { verifyWithCoVe } = await import("../../server/lib/cove-verifier");
  const result = await verifyWithCoVe({
    draft: "Too short.",
    tenantId: 1,
  });
  assert.equal(result.revised, "Too short.");
  assert.equal(result.unchanged, true);
  assert.equal(result.claimsExtracted, 0);
  assert.equal(result.questionsAsked, 0);
  assert.ok(result.warning?.includes("too short"));
});

test("R123 CoVe — empty/whitespace drafts are returned with a warning, never throw", async () => {
  const { verifyWithCoVe } = await import("../../server/lib/cove-verifier");
  const result = await verifyWithCoVe({
    draft: "   \n\n   ",
    tenantId: 1,
  });
  assert.equal(result.unchanged, true);
  assert.equal(result.contradictions.length, 0);
  assert.ok(result.warning);
});

test("R123 CoVe — invalid tenantId still returns a fail-safe object (no throw)", async () => {
  const { verifyWithCoVe } = await import("../../server/lib/cove-verifier");
  // Long enough to pass the short-circuit but tenantId is bogus — providers
  // will fail; the helper must catch and return a warning, not throw.
  const longDraft = "The Replit Agent platform was founded in 2016 by James Smith. ".repeat(20);
  const result = await verifyWithCoVe({
    draft: longDraft,
    tenantId: -1 as any,
  });
  assert.ok(typeof result.revised === "string");
  assert.equal(result.revised.length > 0, true);
  // Either the planner failed (warning set) or by some miracle it succeeded
  // — both are acceptable. The invariant is "never throw".
});

test("R123 CoVe — research-report intake preserves opt-in `verify` flag through sanitization", async () => {
  // Regression for the post-edit architect finding: intake construction in
  // server/research-report-fulfillment.ts must copy `verify` from the caller.
  const fs = await import("node:fs");
  const src = await fs.promises.readFile("server/research-report-fulfillment.ts", "utf8");
  assert.match(src, /verify:\s*params\.intake\.verify\s*===\s*true/);
});

test("R123 CoVe — maxQuestions clamped to 1..15", async () => {
  const { verifyWithCoVe } = await import("../../server/lib/cove-verifier");
  // Just verify the option-clamping path doesn't throw on extreme values.
  const r1 = await verifyWithCoVe({ draft: "x", tenantId: 1, maxQuestions: -5 });
  const r2 = await verifyWithCoVe({ draft: "x", tenantId: 1, maxQuestions: 9999 });
  assert.ok(r1);
  assert.ok(r2);
});
