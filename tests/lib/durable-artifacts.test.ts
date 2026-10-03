import test from "node:test";
import assert from "node:assert/strict";
import {
  artifactScopeKey,
  buildArtifactIntent,
  sha256Artifact,
  verifyArtifactBytes,
} from "../../server/durable-artifacts";

test("an artifact intent binds an immutable revision to its tenant and project scope", () => {
  const intent = buildArtifactIntent({
    tenantId: 7,
    projectId: 23,
    logicalName: "AI readiness report",
    artifactKind: "report",
    mimeType: "application/pdf",
    idempotencyKey: "report-run-2026-08-26",
    sourceRunKey: "run-41",
    bytes: Buffer.from("durable report"),
  });

  assert.equal(intent.scopeKey, artifactScopeKey(23));
  assert.equal(intent.tenantId, 7);
  assert.equal(intent.revision, undefined);
  assert.equal(intent.sha256, sha256Artifact(Buffer.from("durable report")));
  assert.equal(intent.sizeBytes, Buffer.byteLength("durable report"));
  assert.throws(
    () => buildArtifactIntent({ ...intent, tenantId: 0 }),
    /valid tenant/,
  );
});

test("durability verification rejects altered bytes and mismatched size", () => {
  const original = Buffer.from("signed deliverable bytes");
  const sha256 = sha256Artifact(original);

  assert.doesNotThrow(() => verifyArtifactBytes({
    bytes: original,
    expectedSha256: sha256,
    expectedSize: original.length,
  }));
  assert.throws(
    () => verifyArtifactBytes({
      bytes: Buffer.from("signed deliverable bytez"),
      expectedSha256: sha256,
      expectedSize: original.length,
    }),
    /hash mismatch/,
  );
  assert.throws(
    () => verifyArtifactBytes({
      bytes: original,
      expectedSha256: sha256,
      expectedSize: original.length + 1,
    }),
    /size mismatch/,
  );
});