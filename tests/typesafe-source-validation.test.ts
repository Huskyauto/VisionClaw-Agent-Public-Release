import test from "node:test";
import assert from "node:assert/strict";
import { validateWorkWithTypeSafe } from "../server/lib/typesafe-auto-validation";

process.env.NODE_ENV = "test";

test("source checks distinguish a justified abstention without granting authority", async () => {
  const prior = process.env.TYPESAFE_AUTO_VALIDATION_ENABLED;
  process.env.TYPESAFE_AUTO_VALIDATION_ENABLED = "1";
  try {
    const receipt = await validateWorkWithTypeSafe({
      tenantId: 42, subjectKind: "deliverable",
      goal: "What is the warranty duration?",
      output: "The provided source does not specify warranty duration.",
      evidence: "The product is blue.",
      evidenceKind: "source",
      _askFn: async (request) => {
        assert.deepEqual(Object.keys(request.questions), ["answerable", "declines", "supported"]);
        return {
          model: "jev-test", usage: { input_tokens: 80, output_tokens: 3 },
          answers: {
            answerable: { type: "noul", noul: 0.05 },
            declines: { type: "noul", noul: 0.98 },
            supported: { type: "noul", noul: 0.9 },
          },
        };
      },
    });
    assert.equal(receipt.advisoryOnly, true);
    assert.equal(receipt.sourceAssessment?.outcome, "justified_abstention");
    assert.equal(receipt.sourceAssessment?.risk, 0.05);
    assert.equal(receipt.trace?.servedModel, "jev-test");
    assert.equal(receipt.trace?.questionVersion, "jev-source-check-v1");
    assert.equal(receipt.trace?.policy.selectedRoute, "no_flag");
    assert.equal(receipt.trace?.policy.outcome, "justified_abstention");
    assert.ok(receipt.trace?.outputDigest);
    assert.ok(!JSON.stringify(receipt.trace).includes("product is blue"));
  } finally {
    if (prior === undefined) delete process.env.TYPESAFE_AUTO_VALIDATION_ENABLED;
    else process.env.TYPESAFE_AUTO_VALIDATION_ENABLED = prior;
  }
});

test("a foreign source is rejected before any provider call", async () => {
  process.env.TYPESAFE_AUTO_VALIDATION_ENABLED = "1";
  let called = false;
  const receipt = await validateWorkWithTypeSafe({
    tenantId: 42, subjectKind: "deliverable", goal: "Warranty?", output: "One year.",
    sources: [{ id: "foreign", title: "Other tenant", tenantId: 43, provenance: "supplied_context", text: "Private warranty record." }],
    _askFn: async () => { called = true; throw new Error("must not call"); },
  });
  assert.equal(called, false);
  assert.equal(receipt.status, "unavailable");
  assert.match(receipt.note, /source ownership/);
});

test("source assessment covers answers, refusals, uncertainty and contradictory judgments", async () => {
  process.env.TYPESAFE_AUTO_VALIDATION_ENABLED = "1";
  const cases = [
    { p: [0.98, 0.02, 0.98], expected: "supported_answer" },
    { p: [0.98, 0.98, 0.1], expected: "unnecessary_refusal" },
    { p: [0.1, 0.02, 0.05], expected: "unsupported_answer" },
    { p: [0.5, 0.5, 0.5], expected: "uncertain" },
    { p: [0.02, 0.02, 0.99], expected: "uncertain" },
  ];
  for (const c of cases) {
    const receipt = await validateWorkWithTypeSafe({
      tenantId: 42, subjectKind: "deliverable", goal: "Warranty?", output: "Candidate.",
      evidence: "Synthetic source.", evidenceKind: "source",
      _askFn: async () => ({
        model: "jev-test", usage: { input_tokens: 1, output_tokens: 1 },
        answers: Object.fromEntries(["answerable", "declines", "supported"].map((key, i) =>
          [key, { type: "noul" as const, noul: c.p[i] }])),
      }),
    });
    assert.equal(receipt.sourceAssessment?.outcome, c.expected);
    if (c.expected !== "supported_answer") assert.equal(receipt.sourceAssessment?.recommendation, "review");
  }
});
