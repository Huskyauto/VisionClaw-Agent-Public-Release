import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  evaluateImprovementEvidence,
  summarizeImprovementEvidence,
  type ImprovementCandidateEvidence,
} from "../../server/lib/improvement-evidence-evaluator";
import {
  buildCandidateEvidenceHash,
  buildJuryDecisionHash,
  verifyJuryDecisionHash,
} from "../../server/lib/skill-optimizer-promotion";

function candidate(
  overrides: Partial<ImprovementCandidateEvidence> = {},
): ImprovementCandidateEvidence {
  return {
    id: 7,
    tenantId: 1,
    skillId: 31,
    label: "research-method",
    state: "proposed",
    seedHash: "seed-a",
    candidateHash: "candidate-b",
    evalSetHash: "eval-c",
    policyVersion: "skillopt-promotion-v1",
    evidence: {
      evaluationAttestation: {
        seedHash: "seed-a",
        candidateHash: "candidate-b",
        evalSetHash: "eval-c",
        policyVersion: "skillopt-promotion-v1",
        baselineScore: 0.4,
        bestScore: 0.55,
        acceptedEdits: 2,
        rejectedEdits: 1,
      },
    },
    juryDecision: null,
    juryDecisionHash: null,
    promotedVersionId: null,
    rolledBackAt: null,
    ...overrides,
  };
}

test("bound held-out gain computes headroom closed but never claims inherited improvement", () => {
  const report = evaluateImprovementEvidence(candidate(), null);

  assert.equal(report.evidenceLevel, 2);
  assert.equal(report.levelName, "held_out_candidate_gain");
  assert.equal(report.currentTask.status, "demonstrated");
  assert.equal(report.currentTask.baselineScore, 0.4);
  assert.equal(report.currentTask.candidateScore, 0.55);
  assert.ok(Math.abs((report.currentTask.headroomClosed ?? 0) - 0.25) < 1e-12);
  assert.equal(report.persistentInheritance.status, "insufficient_evidence");
  assert.equal(report.persistentInheritance.minimumIndependentCohortsRequired, 2);
  assert.equal(report.persistentInheritance.observedIndependentCohorts, 0);
  assert.equal(report.claimCeiling, "current_task_gain");
});

test("a rejected candidate cannot be classified as held-out improvement", () => {
  const report = evaluateImprovementEvidence(candidate({ state: "rejected" }), null);

  assert.equal(report.evidenceLevel, 1);
  assert.equal(report.levelName, "observed_candidate_gain");
  assert.equal(report.claimCeiling, "current_task_gain");
  assert.match(report.limitations.join(" "), /rejected/i);
});

test("only a matching promoted-version snapshot can establish validated promotion", () => {
  const promoted = candidate({
    state: "promoted",
    promotedVersionId: 19,
    juryDecision: { verdict: "FIX", majority: 2, shouldEscalate: false },
    juryDecisionHash: "signed-decision",
  });

  const wrongKind = evaluateImprovementEvidence(promoted, {
    id: 19,
    candidateId: 7,
    contentHash: "candidate-b",
    kind: "previous-live",
  });
  assert.equal(wrongKind.evidenceLevel, 2);

  const forged = evaluateImprovementEvidence(promoted, {
    id: 19,
    candidateId: 7,
    contentHash: "candidate-b",
    kind: "promotion",
  });
  assert.equal(forged.evidenceLevel, 2);

  const previousSecret = process.env.SESSION_SECRET;
  let verified;
  try {
    process.env.SESSION_SECRET = "test-only-signing-secret-32-characters";
    promoted.juryDecisionHash = buildJuryDecisionHash({
      tenantId: promoted.tenantId,
      skillId: promoted.skillId,
      seedHash: promoted.seedHash,
      candidateHash: promoted.candidateHash,
      policyVersion: promoted.policyVersion,
      evidenceHash: buildCandidateEvidenceHash(promoted.evidence),
      decision: promoted.juryDecision,
    });
    verified = evaluateImprovementEvidence(promoted, {
      id: 19,
      candidateId: 7,
      contentHash: "candidate-b",
      kind: "promotion",
    });
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }

  assert.equal(verified.evidenceLevel, 3);
  assert.equal(verified.levelName, "validated_promotion");
  assert.equal(verified.authority.independentlyApproved, true);
  assert.equal(verified.authority.immutableVersionMatched, true);
  assert.equal(verified.persistentInheritance.status, "insufficient_evidence");
});

test("platform ability claims count bound held-out evidence, not rejected diagnostic gains", () => {
  const rejected = evaluateImprovementEvidence(candidate({ state: "rejected" }), null);
  const insufficientSummary = summarizeImprovementEvidence([rejected]);
  assert.equal(insufficientSummary.demonstratedBoundHeldOutGains, 0);
  assert.equal(insufficientSummary.abilityClaim, "insufficient_evidence");

  const heldOut = evaluateImprovementEvidence(candidate(), null);
  const supportedSummary = summarizeImprovementEvidence([rejected, heldOut]);
  assert.equal(supportedSummary.demonstratedBoundHeldOutGains, 1);
  assert.equal(
    supportedSummary.abilityClaim,
    "current_task_improvement_demonstrated_persistent_inheritance_unproven",
  );
});

test("hash-mismatched evidence is insufficient and exposes no gain claim", () => {
  const unbound = candidate({
    evidence: {
      evaluationAttestation: {
        seedHash: "different-seed",
        candidateHash: "candidate-b",
        evalSetHash: "eval-c",
        policyVersion: "skillopt-promotion-v1",
        baselineScore: 0.1,
        bestScore: 0.9,
        acceptedEdits: 3,
        rejectedEdits: 0,
      },
    },
  });
  const report = evaluateImprovementEvidence(unbound, null);

  assert.equal(report.evidenceLevel, 0);
  assert.equal(report.levelName, "insufficient_evidence");
  assert.equal(report.claimCeiling, "insufficient_evidence");
  assert.equal(report.currentTask.status, "insufficient_evidence");
  assert.equal(report.currentTask.absoluteGain, null);
  assert.equal(report.currentTask.headroomClosed, null);
});

test("a rolled-back candidate cannot count as bound held-out improvement", () => {
  const report = evaluateImprovementEvidence(
    candidate({ state: "rolled_back", rolledBackAt: "2026-09-15T00:00:00.000Z" }),
    null,
  );

  assert.equal(report.evidenceLevel, 1);
  assert.equal(report.levelName, "observed_candidate_gain");
  assert.equal(report.authority.rollbackRecorded, true);
  assert.equal(summarizeImprovementEvidence([report]).demonstratedBoundHeldOutGains, 0);
});

test("jury HMAC rejects valid-looking forgeries and every post-signing mutation", () => {
  const previousSecret = process.env.SESSION_SECRET;
  try {
    process.env.SESSION_SECRET = "test-only-signing-secret-32-characters";
    const signed = {
      tenantId: 1,
      skillId: 31,
      seedHash: "seed-a",
      candidateHash: "candidate-b",
      policyVersion: "skillopt-promotion-v1",
      evidence: candidate().evidence,
      decision: { verdict: "FIX", majority: 2, shouldEscalate: false },
    };
    const providedHash = buildJuryDecisionHash({
      tenantId: signed.tenantId,
      skillId: signed.skillId,
      seedHash: signed.seedHash,
      candidateHash: signed.candidateHash,
      policyVersion: signed.policyVersion,
      evidenceHash: buildCandidateEvidenceHash(signed.evidence),
      decision: signed.decision,
    });
    assert.equal(verifyJuryDecisionHash({ ...signed, providedHash }), true);
    assert.equal(verifyJuryDecisionHash({ ...signed, providedHash: "a".repeat(64) }), false);

    const mutations = [
      { ...signed, tenantId: 2 },
      { ...signed, skillId: 32 },
      { ...signed, seedHash: "seed-mutated" },
      { ...signed, candidateHash: "candidate-mutated" },
      { ...signed, policyVersion: "skillopt-promotion-v2" },
      { ...signed, evidence: { evaluationAttestation: { baselineScore: 0.2, bestScore: 0.9 } } },
      { ...signed, decision: { verdict: "FIX", majority: 3, shouldEscalate: false } },
    ];
    for (const mutation of mutations) {
      assert.equal(verifyJuryDecisionHash({ ...mutation, providedHash }), false);
    }
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("CLI source preserves its read-only admin-scoped privacy boundary", () => {
  const source = fs.readFileSync("scripts/improvement-evidence-report.ts", "utf8");

  assert.match(source, /eq\(skillOptimizationCandidates\.tenantId,\s*ADMIN_TENANT_ID\)/);
  assert.match(source, /eq\(skillOptimizationVersions\.tenantId,\s*ADMIN_TENANT_ID\)/);
  assert.match(source, /inArray\(skillOptimizationVersions\.id,\s*promotedVersionIds\)/);
  assert.doesNotMatch(source, /candidateContent:\s*skillOptimizationCandidates/);
  assert.doesNotMatch(source, /\.(?:insert|update|delete)\(/);
});