import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import express, { type Request, type Response } from "express";
import {
  buildCapabilityEvidenceObservation,
} from "../../server/lib/capability-evidence-shadow";
import {
  evaluateCapabilityMaturity,
} from "../../server/lib/capability-maturity-evaluator";
import {
  buildCapabilityMaturityPayload,
  parseCapabilityMaturityQuery,
  type CapabilityMaturityStore,
} from "../../server/lib/capability-maturity-report";
import { registerAdminRoutes } from "../../server/routes/admin";

test("repeatable strong outcomes prove only narrow performance, never AGI or a human percentile", () => {
  const observations = [1, 2, 3].map((rewardId) =>
    buildCapabilityEvidenceObservation({
      rewardId,
      stepIndex: rewardId,
      capability: "research synthesis",
      score: 88,
      success: true,
      outputLen: 400,
      taskDigest: String(rewardId).repeat(64).slice(0, 64),
      at: new Date(`2026-09-0${rewardId}T12:00:00.000Z`),
    }),
  );

  const report = evaluateCapabilityMaturity(observations, new Set([1, 2, 3]));

  assert.equal(report.reportOnly, true);
  assert.equal(report.autonomyChanged, false);
  assert.equal(report.authorityEffect, "none");
  assert.equal(report.summary.repeatableNarrowCapabilities, 1);
  assert.equal(report.summary.claimCeiling, "narrow_capability_evidence_only");
  assert.equal(report.summary.generality, "insufficient_evidence");
  assert.equal(report.capabilities[0].performance.status, "repeatable_narrow_success");
  assert.equal(report.capabilities[0].generality.status, "multi_task_narrow_evidence");
  assert.equal(report.capabilities[0].humanPerformanceLevel.status, "insufficient_evidence");
  assert.doesNotMatch(JSON.stringify(report), /\b(?:competent|expert|virtuoso|superhuman) agi\b/i);
});

test("corroborated hollow or failed outcomes block a repeatable-performance claim", () => {
  const observations = [1, 2, 3].map((rewardId) =>
    buildCapabilityEvidenceObservation({
      rewardId,
      stepIndex: rewardId,
      capability: "report generation",
      score: 90,
      success: true,
      outputLen: 500,
      taskDigest: String(rewardId).repeat(64).slice(0, 64),
    }),
  );
  observations.push(buildCapabilityEvidenceObservation({
    rewardId: 4,
    stepIndex: 4,
    capability: "report generation",
    score: 0,
    success: false,
    outputLen: 0,
    taskDigest: "4".repeat(64),
  }));

  const report = evaluateCapabilityMaturity(observations, new Set([1, 2, 3, 4]));

  assert.equal(report.capabilities[0].observations.failures, 1);
  assert.equal(report.capabilities[0].performance.status, "insufficient_evidence");
  assert.equal(report.summary.repeatableNarrowCapabilities, 0);
});

test("conflicting rows for one reward give negative evidence precedence", () => {
  const observations = [1, 2, 3].map((rewardId) =>
    buildCapabilityEvidenceObservation({
      rewardId,
      stepIndex: 1,
      capability: "report generation",
      score: 90,
      success: true,
      outputLen: 500,
      taskDigest: String(rewardId).repeat(64).slice(0, 64),
    }),
  );
  observations.push(buildCapabilityEvidenceObservation({
    rewardId: 1,
    stepIndex: 2,
    capability: "report generation",
    score: 0,
    success: false,
    outputLen: 0,
    taskDigest: "f".repeat(64),
  }));

  const report = evaluateCapabilityMaturity(observations, new Set([1, 2, 3]));

  assert.equal(report.capabilities[0].observations.failures, 1);
  assert.equal(report.capabilities[0].performance.status, "insufficient_evidence");
});

test("bounded report payload is deterministic, redacted, and read-only", async () => {
  const observation = buildCapabilityEvidenceObservation({
    rewardId: 11,
    stepIndex: 1,
    capability: "analysis",
    score: 82,
    success: true,
    outputLen: 200,
    taskDigest: "a".repeat(64),
  });
  const calls: unknown[] = [];
  const store: CapabilityMaturityStore = {
    async listEvidence(query) {
      calls.push(query);
      return {
        observations: [observation],
        corroboratedRewardIds: new Set([11]),
      };
    },
  };

  const payload = await buildCapabilityMaturityPayload({ limit: 25 }, store);

  assert.deepEqual(calls, [{ limit: 25 }]);
  assert.equal(payload.reportOnly, true);
  assert.equal(payload.autonomyChanged, false);
  assert.equal(payload.summary.observationsReceived, 1);
  assert.equal(payload.evidenceGaps.generalIntelligence, "insufficient_evidence");
  assert.doesNotMatch(JSON.stringify(payload), /raw task|raw output|prompt|secret/i);
  assert.deepEqual(parseCapabilityMaturityQuery({}), { limit: 100 });
  assert.deepEqual(parseCapabilityMaturityQuery({ limit: "500" }), { limit: 500 });
  assert.throws(() => parseCapabilityMaturityQuery({ limit: "501" }), /limit/i);
  assert.throws(() => parseCapabilityMaturityQuery({ limit: ["25"] }), /limit/i);
});

test("older negative evidence outside the bounded row window still blocks maturity", async () => {
  const observations = [21, 22, 23].map((rewardId) =>
    buildCapabilityEvidenceObservation({
      rewardId,
      stepIndex: 1,
      capability: "analysis",
      score: 90,
      success: true,
      outputLen: 500,
      taskDigest: String(rewardId).repeat(64).slice(0, 64),
    }),
  );
  const store: CapabilityMaturityStore = {
    async listEvidence() {
      return {
        observations,
        corroboratedRewardIds: new Set([21, 22, 23]),
        historicalNegativeCapabilities: new Set(["analysis"]),
      };
    },
  };

  const payload = await buildCapabilityMaturityPayload({ limit: 3 }, store);

  assert.equal(payload.capabilities[0].observations.historicalNegativeEvidence, true);
  assert.equal(payload.capabilities[0].performance.status, "insufficient_evidence");
  assert.equal(payload.summary.repeatableNarrowCapabilities, 0);
});

test("capability maturity report is authenticated, admin-only, bounded, and GET-only", async () => {
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
    async capabilityMaturityReport(query) {
      return { reportOnly: true, query, authorityEffect: "none" };
    },
  });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/api/admin/capability-maturity`;

    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, {
      headers: { authorization: "session", "x-tenant-id": "2", "x-platform-admin": "1" },
    })).status, 403);
    assert.equal((await fetch(url, {
      headers: { authorization: "session", "x-tenant-id": "1", "x-platform-admin": "0" },
    })).status, 403);

    const success = await fetch(`${url}?limit=25`, {
      headers: { authorization: "session", "x-tenant-id": "1", "x-platform-admin": "1" },
    });
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), {
      reportOnly: true,
      query: { limit: 25 },
      authorityEffect: "none",
    });
    assert.equal((await fetch(`${url}?limit=501`, {
      headers: { authorization: "session", "x-tenant-id": "1", "x-platform-admin": "1" },
    })).status, 400);
    assert.equal((await fetch(url, {
      method: "POST",
      headers: { authorization: "session", "x-tenant-id": "1", "x-platform-admin": "1" },
    })).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("database report source is tenant-scoped and contains no write path", () => {
  const source = fs.readFileSync("server/lib/capability-maturity-report.ts", "utf8");

  assert.match(source, /e\.tenant_id = \$\{ADMIN_TENANT_ID\}/);
  assert.match(source, /sr\.tenant_id = recent\.tenant_id/);
  assert.match(source, /sr\.id::text = recent\.data->>'rewardId'/);
  assert.match(source, /e\.data->>'evidenceClass' IN \('hollow_success', 'failed'\)/);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(source, /\.(?:insert|update|delete)\(/);
});