import test from "node:test";
import assert from "node:assert/strict";
import {
  validateWorkWithTypeSafe,
  type TypeSafeValidationAskFn,
} from "../server/lib/typesafe-auto-validation";

process.env.NODE_ENV = "test";

test("automatic TypeSafe validation returns a report-only receipt with fixed quality signals", async () => {
  const prior = process.env.TYPESAFE_AUTO_VALIDATION_ENABLED;
  process.env.TYPESAFE_AUTO_VALIDATION_ENABLED = "1";
  let calls = 0;
  const ask: TypeSafeValidationAskFn = async (request) => {
    calls++;
    assert.match(request.state, /jury/);
    assert.deepEqual(Object.keys(request.questions), [
      "evidence_support",
      "requirement_coverage",
      "needs_human_review",
    ]);
    return {
      model: "jev-test",
      usage: { input_tokens: 100, output_tokens: 20 },
      answers: {
        evidence_support: { type: "noul", noul: 0.8 },
        requirement_coverage: { type: "noul", noul: 0.7 },
        needs_human_review: { type: "noul", noul: 0.15 },
      },
    };
  };
  try {
    const receipt = await validateWorkWithTypeSafe({
      tenantId: 42,
      subjectKind: "jury",
      goal: "Decide whether the finding should be fixed.",
      output: "FIX because the tenant filter is absent.",
      evidence: "Two reviewers identified the same missing filter.",
      _askFn: ask,
    });
    assert.equal(calls, 1);
    assert.equal(receipt.status, "validated");
    assert.equal(receipt.advisoryOnly, true);
    assert.equal(receipt.signals?.evidenceSupport, 0.8);
    assert.equal(receipt.signals?.needsHumanReview, 0.15);
  } finally {
    if (prior === undefined) delete process.env.TYPESAFE_AUTO_VALIDATION_ENABLED;
    else process.env.TYPESAFE_AUTO_VALIDATION_ENABLED = prior;
  }
});

test("automatic TypeSafe validation requires exact opt-in and makes no call for truthy aliases", async () => {
  const prior = process.env.TYPESAFE_AUTO_VALIDATION_ENABLED;
  process.env.TYPESAFE_AUTO_VALIDATION_ENABLED = "true";
  let calls = 0;
  try {
    const receipt = await validateWorkWithTypeSafe({
      tenantId: 42,
      subjectKind: "jury",
      goal: "A sufficiently detailed goal.",
      output: "A sufficiently detailed output.",
      _askFn: async () => {
        calls++;
        throw new Error("must not run");
      },
    });
    assert.equal(calls, 0);
    assert.equal(receipt.status, "disabled");
    assert.equal(receipt.advisoryOnly, true);
  } finally {
    if (prior === undefined) delete process.env.TYPESAFE_AUTO_VALIDATION_ENABLED;
    else process.env.TYPESAFE_AUTO_VALIDATION_ENABLED = prior;
  }
});

test("provider failure is visible but non-blocking", async () => {
  const prior = process.env.TYPESAFE_AUTO_VALIDATION_ENABLED;
  process.env.TYPESAFE_AUTO_VALIDATION_ENABLED = "1";
  try {
    const receipt = await validateWorkWithTypeSafe({
      tenantId: 42,
      subjectKind: "deliverable",
      goal: "Produce a supported recommendation.",
      output: "The recommendation is complete.",
      _askFn: async () => {
        throw new Error("provider down");
      },
    });
    assert.equal(receipt.status, "unavailable");
    assert.equal(receipt.advisoryOnly, true);
    assert.match(receipt.note, /continued unchanged/);
  } finally {
    if (prior === undefined) delete process.env.TYPESAFE_AUTO_VALIDATION_ENABLED;
    else process.env.TYPESAFE_AUTO_VALIDATION_ENABLED = prior;
  }
});

test("sensitive-data egress gate blocks secrets before the provider call", async () => {
  const prior = process.env.TYPESAFE_AUTO_VALIDATION_ENABLED;
  process.env.TYPESAFE_AUTO_VALIDATION_ENABLED = "1";
  let calls = 0;
  try {
    const receipt = await validateWorkWithTypeSafe({
      tenantId: 42,
      subjectKind: "jury",
      goal: "Review this private key.",
      output: "-----BEGIN PRIVATE KEY-----\nnot-for-egress\n-----END PRIVATE KEY-----",
      _askFn: async () => {
        calls++;
        throw new Error("must not run");
      },
    });
    assert.equal(calls, 0);
    assert.equal(receipt.status, "unavailable");
    assert.match(receipt.note, /sensitive-data egress gate/);
  } finally {
    if (prior === undefined) delete process.env.TYPESAFE_AUTO_VALIDATION_ENABLED;
    else process.env.TYPESAFE_AUTO_VALIDATION_ENABLED = prior;
  }
});

test("oversize raw fields are withheld before truncation can hide a boundary secret", async () => {
  const prior = process.env.TYPESAFE_AUTO_VALIDATION_ENABLED;
  process.env.TYPESAFE_AUTO_VALIDATION_ENABLED = "1";
  let calls = 0;
  try {
    const receipt = await validateWorkWithTypeSafe({
      tenantId: 42,
      subjectKind: "jury",
      goal: "x".repeat(2_001),
      output: "safe",
      _askFn: async () => {
        calls++;
        throw new Error("must not run");
      },
    });
    assert.equal(calls, 0);
    assert.equal(receipt.status, "unavailable");
  } finally {
    if (prior === undefined) delete process.env.TYPESAFE_AUTO_VALIDATION_ENABLED;
    else process.env.TYPESAFE_AUTO_VALIDATION_ENABLED = prior;
  }
});