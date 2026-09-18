import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateMaintenanceSet,
  gradeMaintenanceCase,
  computeMaintenanceVerdict,
  clampPassthrough,
  type MaintenanceCase,
} from "../../server/lib/memory-maintenance-eval-core";

const VALID_CASE = {
  id: "c1",
  category: "maintenance.recency",
  candidates: [
    { id: "A", text: "fact a", ageDays: 1, sourceAuthority: "user", supportingObservations: 3, confidence: 1 },
    { id: "B", text: "fact b", ageDays: 30, sourceAuthority: "user", supportingObservations: 3, confidence: 1 },
  ],
  expectedWinnerId: "A",
  expectedEscalate: true,
};

describe("memory-maintenance-eval-core: validateMaintenanceSet", () => {
  it("accepts a { cases: [...] } document and normalizes it", () => {
    const out = validateMaintenanceSet({ version: 1, cases: [VALID_CASE] });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "c1");
    assert.equal(out[0].candidates.length, 2);
    assert.equal(out[0].expectedWinnerId, "A");
    assert.equal(out[0].expectedEscalate, true);
  });

  it("accepts a bare array of cases", () => {
    assert.equal(validateMaintenanceSet([VALID_CASE]).length, 1);
  });

  it("defaults a missing category to 'uncategorized'", () => {
    const out = validateMaintenanceSet([{ ...VALID_CASE, category: undefined }]);
    assert.equal(out[0].category, "uncategorized");
  });

  it("clamps candidate confidence into [0,1]", () => {
    const out = validateMaintenanceSet([{ ...VALID_CASE, candidates: [{ id: "A", text: "a", confidence: 5 }, { id: "B", text: "b", confidence: -2 }], expectedEscalate: true, expectedWinnerId: undefined }]);
    assert.equal(out[0].candidates[0].confidence, 1);
    assert.equal(out[0].candidates[1].confidence, 0);
  });

  it("allows a case asserting ONLY escalate (no winner)", () => {
    const out = validateMaintenanceSet([{ id: "x", candidates: [{ id: "A", text: "a" }], expectedEscalate: true }]);
    assert.equal(out[0].expectedWinnerId, undefined);
    assert.equal(out[0].expectedEscalate, true);
  });

  it("throws on an empty / missing case list (fail-closed config error)", () => {
    assert.throws(() => validateMaintenanceSet({ cases: [] }), /no cases/);
    assert.throws(() => validateMaintenanceSet({}), /no cases/);
    assert.throws(() => validateMaintenanceSet(null), /no cases/);
  });

  it("throws on a case with no candidates", () => {
    assert.throws(() => validateMaintenanceSet([{ id: "x", candidates: [], expectedEscalate: true }]), /non-empty candidates/);
  });

  it("throws on a candidate missing id or text", () => {
    assert.throws(() => validateMaintenanceSet([{ id: "x", candidates: [{ id: "A" }], expectedEscalate: true }]), /non-empty id and text/);
    assert.throws(() => validateMaintenanceSet([{ id: "x", candidates: [{ text: "a" }], expectedEscalate: true }]), /non-empty id and text/);
  });

  it("throws on duplicate candidate ids within a case", () => {
    assert.throws(() => validateMaintenanceSet([{ id: "x", candidates: [{ id: "A", text: "a" }, { id: "A", text: "b" }], expectedEscalate: true }]), /duplicate candidate id/);
  });

  it("throws on a negative ageDays or supportingObservations", () => {
    assert.throws(() => validateMaintenanceSet([{ id: "x", candidates: [{ id: "A", text: "a", ageDays: -1 }], expectedEscalate: true }]), /ageDays/);
    assert.throws(() => validateMaintenanceSet([{ id: "x", candidates: [{ id: "A", text: "a", supportingObservations: -3 }], expectedEscalate: true }]), /supportingObservations/);
  });

  it("throws when a case asserts NOTHING", () => {
    assert.throws(() => validateMaintenanceSet([{ id: "x", candidates: [{ id: "A", text: "a" }] }]), /must assert at least one/);
  });

  it("throws when expectedWinnerId is not a candidate id", () => {
    assert.throws(() => validateMaintenanceSet([{ id: "x", candidates: [{ id: "A", text: "a" }], expectedWinnerId: "Z" }]), /not one of its candidate ids/);
  });

  it("throws on duplicate case ids", () => {
    assert.throws(() => validateMaintenanceSet([VALID_CASE, VALID_CASE]), /duplicate case id/);
  });
});

describe("memory-maintenance-eval-core: gradeMaintenanceCase", () => {
  const c: MaintenanceCase = {
    id: "c1",
    category: "x",
    candidates: [{ id: "A", text: "a" }, { id: "B", text: "b" }],
    expectedWinnerId: "A",
    expectedEscalate: true,
  };

  it("passes when both asserted dimensions match", () => {
    assert.equal(gradeMaintenanceCase(c, { winnerId: "A", escalate: true }).passed, true);
  });

  it("fails on a wrong winner", () => {
    const g = gradeMaintenanceCase(c, { winnerId: "B", escalate: true });
    assert.equal(g.passed, false);
    assert.match(g.mismatch!, /winner expected "A" got "B"/);
  });

  it("fails on a wrong escalate flag", () => {
    const g = gradeMaintenanceCase(c, { winnerId: "A", escalate: false });
    assert.equal(g.passed, false);
    assert.match(g.mismatch!, /escalate expected true got false/);
  });

  it("only checks the dimensions that are asserted", () => {
    const escalateOnly: MaintenanceCase = { id: "e", category: "x", candidates: c.candidates, expectedEscalate: true };
    assert.equal(gradeMaintenanceCase(escalateOnly, { winnerId: "B", escalate: true }).passed, true);
    const winnerOnly: MaintenanceCase = { id: "w", category: "x", candidates: c.candidates, expectedWinnerId: "A" };
    assert.equal(gradeMaintenanceCase(winnerOnly, { winnerId: "A", escalate: false }).passed, true);
  });
});

describe("memory-maintenance-eval-core: computeMaintenanceVerdict", () => {
  const base = { totalCases: 8, executedCases: 8, passedCases: 8, minCoverage: 1.0, passFloor: 1.0 };

  it("passes (exit 0) when all cases execute and pass", () => {
    const v = computeMaintenanceVerdict(base);
    assert.equal(v.exitCode, 0);
    assert.equal(v.degraded, false);
    assert.equal(v.failed, false);
  });

  it("fails CLOSED with exit 3 when a case did not execute (coverage gap)", () => {
    const v = computeMaintenanceVerdict({ ...base, executedCases: 7, passedCases: 7 });
    assert.equal(v.degraded, true);
    assert.equal(v.exitCode, 3);
  });

  it("a degraded run is NEVER also reported as a logic regression", () => {
    const v = computeMaintenanceVerdict({ ...base, executedCases: 4, passedCases: 0 });
    assert.equal(v.degraded, true);
    assert.equal(v.failed, false);
    assert.equal(v.exitCode, 3);
  });

  it("flags a logic regression (exit 2) when an executed case mismatched", () => {
    const v = computeMaintenanceVerdict({ ...base, passedCases: 7 });
    assert.equal(v.degraded, false);
    assert.equal(v.failed, true);
    assert.equal(v.exitCode, 2);
  });

  it("treats zero cases as zero coverage → degraded", () => {
    const v = computeMaintenanceVerdict({ ...base, totalCases: 0, executedCases: 0, passedCases: 0 });
    assert.equal(v.coverage, 0);
    assert.equal(v.degraded, true);
  });
});

describe("memory-maintenance-eval-core: clampPassthrough", () => {
  it("clamps finite numbers and falls back on non-finite", () => {
    assert.equal(clampPassthrough(0.8, 1), 0.8);
    assert.equal(clampPassthrough(5, 1), 1);
    assert.equal(clampPassthrough(0, 1), 0);
    assert.equal(clampPassthrough(NaN, 1), 1);
    assert.equal(clampPassthrough(NaN, 0.9), 0.9);
  });
});
