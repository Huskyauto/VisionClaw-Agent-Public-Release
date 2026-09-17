import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildCandidateIdentity,
  buildJuryDecisionHash,
  holdDeadline,
  sha256,
  validateCandidateEvidence,
  validatePromotionGate,
} from "../../server/lib/skill-optimizer-promotion";

const approved = {
  verdict: "FIX",
  majority: 2,
  shouldEscalate: false,
};

function validGate() {
  return {
    tenantId: 1,
    adminTenantId: 1,
    state: "approved",
    identityKey: "identity",
    expectedIdentityKey: "identity",
    policyVersion: "skillopt-promotion-v1",
    expectedPolicyVersion: "skillopt-promotion-v1",
    candidateHash: sha256("candidate"),
    storedCandidateHash: sha256("candidate"),
    seedHash: sha256("seed"),
    evalSetHash: sha256("eval"),
    currentSkillHash: sha256("seed"),
    juryDecision: approved,
    juryDecisionHash: "jury",
    expectedJuryDecisionHash: "jury",
    evidence: {
      evaluationAttestation: {
        seedHash: sha256("seed"),
        candidateHash: sha256("candidate"),
        evalSetHash: sha256("eval"),
        policyVersion: "skillopt-promotion-v1",
        baselineScore: 0.4,
        bestScore: 0.6,
        acceptedEdits: 1,
        rejectedEdits: 0,
      },
    },
    promotionEnabled: true,
    dryRun: false,
  };
}

test("candidate identity is deterministic and binds every reviewed input", () => {
  const base = {
    tenantId: 1,
    skillId: 9,
    label: "support",
    seedHash: sha256("seed"),
    candidateHash: sha256("candidate"),
    evalSetHash: sha256("eval"),
    source: "nightly" as const,
  };
  assert.equal(buildCandidateIdentity(base), buildCandidateIdentity(base));
  assert.notEqual(buildCandidateIdentity(base), buildCandidateIdentity({ ...base, candidateHash: sha256("changed") }));
  assert.notEqual(buildCandidateIdentity(base), buildCandidateIdentity({ ...base, evalSetHash: sha256("changed") }));
  assert.notEqual(buildCandidateIdentity(base), buildCandidateIdentity({ ...base, source: "manual" }));
});

test("promotion gate accepts only the exact reviewed candidate and live seed", () => {
  assert.deepEqual(validatePromotionGate(validGate()), { ok: true });

  const candidateMismatch = validatePromotionGate({ ...validGate(), candidateHash: sha256("other") });
  assert.equal(candidateMismatch.ok, false);
  assert.match(candidateMismatch.reason || "", /candidate hash/);

  const seedMismatch = validatePromotionGate({ ...validGate(), currentSkillHash: sha256("other") });
  assert.equal(seedMismatch.ok, false);
  assert.match(seedMismatch.reason || "", /seed hash/);
});

test("promotion gate binds identity, policy, jury evidence, and rejects malformed evidence", () => {
  const checks = [
    { input: { ...validGate(), identityKey: "other" }, reason: /identity/ },
    { input: { ...validGate(), policyVersion: "old" }, reason: /policy/ },
    { input: { ...validGate(), juryDecisionHash: "other" }, reason: /jury/ },
    { input: { ...validGate(), evidence: {} }, reason: /evaluator/ },
  ];
  for (const c of checks) {
    const result = validatePromotionGate(c.input);
    assert.equal(result.ok, false);
    assert.match(result.reason || "", c.reason);
  }
  const evidence = {
    evaluationAttestation: {
      seedHash: "s",
      candidateHash: "c",
      evalSetHash: "e",
      policyVersion: "p",
      baselineScore: 0.2,
      bestScore: 0.3,
      acceptedEdits: 1,
      rejectedEdits: 0,
    },
  };
  assert.equal(validateCandidateEvidence(evidence).ok, true);
  assert.equal(validateCandidateEvidence({
    evaluationAttestation: { ...evidence.evaluationAttestation, bestScore: 0.1 },
  }).ok, false);
});

test("jury decision binding is deterministic and changes with reviewed content", () => {
  const base = {
    tenantId: 1,
    skillId: 9,
    seedHash: sha256("seed"),
    candidateHash: sha256("candidate"),
    policyVersion: "skillopt-promotion-v1",
    evidenceHash: sha256("evidence"),
    decision: approved,
  };
  assert.equal(buildJuryDecisionHash(base), buildJuryDecisionHash({ ...base }));
  assert.notEqual(buildJuryDecisionHash(base), buildJuryDecisionHash({ ...base, candidateHash: sha256("other") }));
});

test("promotion gate fails closed on tenant, status, jury, kill switch, and dry-run", () => {
  const cases = [
    { input: { ...validGate(), tenantId: 2 }, reason: /admin tenant/ },
    { input: { ...validGate(), state: "held" }, reason: /not approved/ },
    { input: { ...validGate(), juryDecision: { verdict: "ACCEPT", majority: 3 } }, reason: /jury approval/ },
    { input: { ...validGate(), juryDecision: { verdict: "FIX", majority: 3 } }, reason: /jury approval/ },
    { input: { ...validGate(), juryDecision: { verdict: "FIX", majority: 3, shouldEscalate: true } }, reason: /jury approval/ },
    { input: { ...validGate(), promotionEnabled: false }, reason: /kill switch/ },
    { input: { ...validGate(), dryRun: true }, reason: /dry-run/ },
  ];
  for (const c of cases) {
    const result = validatePromotionGate(c.input);
    assert.equal(result.ok, false);
    assert.match(result.reason || "", c.reason);
  }
});

test("held candidates receive a bounded seven-day owner-review deadline", () => {
  const start = new Date("2026-08-29T12:00:00.000Z");
  assert.equal(
    holdDeadline(start).toISOString(),
    "2026-09-05T12:00:00.000Z",
  );
});

test("all optimizer apply entrypoints use the central promotion boundary", () => {
  for (const file of ["scripts/skill-optimize.ts", "scripts/skill-optimize-nightly.ts"]) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /promoteSkillOptimizationCandidate/);
    assert.doesNotMatch(source, /storage\.updateSkill\s*\(/);
  }
});
