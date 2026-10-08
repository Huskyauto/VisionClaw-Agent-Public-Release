import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import express, { type Request, type Response } from "express";
import {
  evaluateImprovementEvidence,
  summarizeImprovementEvidence,
  type ImprovementCandidateEvidence,
} from "../../server/lib/improvement-evidence-evaluator";
import {
  buildImprovementEvidencePayload,
  parseImprovementEvidenceQuery,
  type ImprovementEvidenceStore,
} from "../../server/lib/improvement-evidence-report";
import { registerAdminRoutes } from "../../server/routes/admin";
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

test("shared report source preserves its read-only admin-scoped privacy boundary", () => {
  const source = fs.readFileSync("server/lib/improvement-evidence-report.ts", "utf8");

  assert.match(source, /eq\(skillOptimizationCandidates\.tenantId,\s*ADMIN_TENANT_ID\)/);
  assert.match(source, /eq\(skillOptimizationVersions\.tenantId,\s*ADMIN_TENANT_ID\)/);
  assert.match(source, /inArray\(skillOptimizationVersions\.id,\s*ids\)/);
  assert.doesNotMatch(source, /candidateContent:\s*skillOptimizationCandidates/);
  assert.doesNotMatch(source, /\.(?:insert|update|delete)\(/);
});

test("admin evidence route is authenticated, admin-gated, and GET-only", () => {
  const source = fs.readFileSync("server/routes/admin.ts", "utf8");
  assert.match(
    source,
    /app\.get\("\/api\/admin\/improvement-evidence",\s*authMiddleware/,
  );
  assert.match(
    source,
    /tenantId !== ADMIN_TENANT_ID \|\| !isAdminRequest\(req\)/,
  );
  assert.doesNotMatch(
    source,
    /app\.(?:post|put|patch|delete)\("\/api\/admin\/improvement-evidence"/,
  );
});

test("read-only report payload uses bounded filters and never exposes candidate content", async () => {
  const calls: Array<{ kind: string; value: unknown }> = [];
  const store: ImprovementEvidenceStore = {
    async listCandidates(options) {
      calls.push({ kind: "candidates", value: options });
      return [candidate({ promotedVersionId: null })];
    },
    async listVersions(ids) {
      calls.push({ kind: "versions", value: ids });
      return [];
    },
  };

  const payload = await buildImprovementEvidencePayload(
    { limit: 25, skillId: 31 },
    store,
  );

  assert.deepEqual(calls, [
    { kind: "candidates", value: { limit: 25, skillId: 31 } },
    { kind: "versions", value: [] },
  ]);
  assert.equal(payload.reportOnly, true);
  assert.equal(payload.autonomyChanged, false);
  assert.equal(payload.tenantScope, 1);
  assert.equal(payload.summary.evaluatedCandidates, 1);
  assert.doesNotMatch(JSON.stringify(payload), /candidateContent|secret prompt|research-method/i);
});

test("report query accepts positive integers and rejects unbounded or malformed input", () => {
  assert.deepEqual(parseImprovementEvidenceQuery({}), { limit: 100, skillId: undefined });
  assert.deepEqual(parseImprovementEvidenceQuery({ limit: "500", skillId: "7" }), {
    limit: 500,
    skillId: 7,
  });
  assert.throws(() => parseImprovementEvidenceQuery({ limit: "501" }), /limit/i);
  assert.throws(() => parseImprovementEvidenceQuery({ limit: "0" }), /limit/i);
  assert.throws(() => parseImprovementEvidenceQuery({ skillId: "1.5" }), /skillId/i);
  assert.throws(() => parseImprovementEvidenceQuery({ skillId: ["1", "2"] }), /skillId/i);
  assert.throws(() => parseImprovementEvidenceQuery({ skillId: "2147483648" }), /skillId/i);
});

test("admin evidence route denies unauthenticated and non-admin requests, then serves a bounded redacted report", async () => {
  const app = express();
  registerAdminRoutes(app, {
    authMiddleware(req: Request, res: Response, next: () => void) {
      if (req.headers.authorization !== "session") {
        return res.status(401).json({ error: "Authentication required" });
      }
      next();
    },
    getTenantFromRequest(req) {
      return Number(req.headers["x-tenant-id"]);
    },
    isAdminRequest(req) {
      return req.headers["x-platform-admin"] === "1";
    },
    ADMIN_TENANT_ID: 1,
    requirePlatformAdmin: () => true,
    async improvementEvidenceReport(query) {
      return { reportOnly: true, query, reports: [{ candidateId: 7 }] };
    },
  });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/api/admin/improvement-evidence`;

    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, {
      headers: { authorization: "session", "x-tenant-id": "2", "x-platform-admin": "1" },
    })).status, 403);
    assert.equal((await fetch(url, {
      headers: { authorization: "session", "x-tenant-id": "1", "x-platform-admin": "0" },
    })).status, 403);

    const success = await fetch(`${url}?limit=25&skillId=31`, {
      headers: { authorization: "session", "x-tenant-id": "1", "x-platform-admin": "1" },
    });
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), {
      reportOnly: true,
      query: { limit: 25, skillId: 31 },
      reports: [{ candidateId: 7 }],
    });

    const invalid = await fetch(`${url}?limit=501`, {
      headers: { authorization: "session", "x-tenant-id": "1", "x-platform-admin": "1" },
    });
    assert.equal(invalid.status, 400);

    const oversizedSkillId = await fetch(`${url}?skillId=2147483648`, {
      headers: { authorization: "session", "x-tenant-id": "1", "x-platform-admin": "1" },
    });
    assert.equal(oversizedSkillId.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});