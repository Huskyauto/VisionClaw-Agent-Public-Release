/**
 * Proof-level knob (PROOF_LOOPS L1–L5) — pure-module unit tests.
 * Query-free by design: server/lib/proof-level.ts has no imports, so this
 * file never opens a pg pool (see memory: node-test-db-pool-hang).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PROOF_LEVEL,
  computeProofDebt,
  parseProofLevel,
  resolveProofLevelPolicy,
  type ProofLevel,
} from "../../server/lib/proof-level";

test("parseProofLevel accepts L-prefixed, bare-digit, numeric, and lowercase forms", () => {
  assert.equal(parseProofLevel("L3"), "L3");
  assert.equal(parseProofLevel("l4"), "L4");
  assert.equal(parseProofLevel(" L5 "), "L5");
  assert.equal(parseProofLevel("2"), "L2");
  assert.equal(parseProofLevel(1), "L1");
  assert.equal(parseProofLevel(5), "L5");
});

test("parseProofLevel fails open (null) on anything else", () => {
  for (const bad of ["L0", "L6", "0", "6", "LL3", "level3", "", null, undefined, {}, [], 3.5, -2, NaN, true]) {
    assert.equal(parseProofLevel(bad), null, `expected null for ${String(bad)}`);
  }
});

test("default level is L2 and imposes NO obligations (backward compatible)", () => {
  assert.equal(DEFAULT_PROOF_LEVEL, "L2");
  const p = resolveProofLevelPolicy(DEFAULT_PROOF_LEVEL);
  assert.equal(p.docketMaxRows, 50); // matches the docket's historical default
  assert.equal(p.requireVerification, false);
  assert.equal(p.requireReplay, false);
  assert.equal(p.requireJury, false);
  // Empty evidence at L2 ⇒ zero proof debt (existing dockets keep PASSing).
  const debt = computeProofDebt(p, {
    verificationCount: 0, failedVerificationCount: 0, hasReplayPointer: false, juryRowCount: 0,
  });
  assert.deepEqual(debt, []);
});

test("policy strictness is monotonic in level", () => {
  const levels: ProofLevel[] = ["L1", "L2", "L3", "L4", "L5"];
  const policies = levels.map(resolveProofLevelPolicy);
  for (let i = 1; i < policies.length; i++) {
    assert.ok(policies[i].docketMaxRows > policies[i - 1].docketMaxRows, "row caps grow with level");
    // Obligations never relax as level rises.
    assert.ok(!(policies[i - 1].requireVerification && !policies[i].requireVerification));
    assert.ok(!(policies[i - 1].requireReplay && !policies[i].requireReplay));
    assert.ok(!(policies[i - 1].requireJury && !policies[i].requireJury));
  }
  assert.equal(policies[4].docketMaxRows, 200); // L5 hits the docket clamp ceiling
});

test("L3 requires verification evidence; L4 adds replay; L5 adds jury", () => {
  const empty = { verificationCount: 0, failedVerificationCount: 0, hasReplayPointer: false, juryRowCount: 0 };
  assert.equal(computeProofDebt(resolveProofLevelPolicy("L3"), empty).length, 1);
  assert.equal(computeProofDebt(resolveProofLevelPolicy("L4"), empty).length, 2);
  assert.equal(computeProofDebt(resolveProofLevelPolicy("L5"), empty).length, 3);
});

test("satisfied obligations produce zero debt at L5", () => {
  const debt = computeProofDebt(resolveProofLevelPolicy("L5"), {
    verificationCount: 3, failedVerificationCount: 0, hasReplayPointer: true, juryRowCount: 1,
  });
  assert.deepEqual(debt, []);
});

test("failed verifications are debt at EVERY level (even L1)", () => {
  const debt = computeProofDebt(resolveProofLevelPolicy("L1"), {
    verificationCount: 2, failedVerificationCount: 1, hasReplayPointer: false, juryRowCount: 0,
  });
  assert.equal(debt.length, 1);
  assert.match(debt[0], /FAILED/);
});
