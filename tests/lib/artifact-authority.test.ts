import assert from "node:assert/strict";
import test from "node:test";

import {
  assertArtifactAuthorityPersisted,
  extractArtifactAuthorityReceipt,
  issueArtifactAuthorityReceipt,
  serializeArtifactAuthorityReceipt,
  validateArtifactAuthorityReceipt,
} from "../../server/lib/artifact-authority";

test("artifact authority receipt is stable across semantic object key order", () => {
  const first = issueArtifactAuthorityReceipt({
    authorityId: "research-proposal-tsc-heldout",
    tenantId: 7,
    subjectKind: "research_code_proposal",
    subjectId: "42",
    subject: {
      targetFile: "server/example.ts",
      sourceSha256: "a".repeat(64),
      proposal: { oldCode: "old", newCode: "new" },
    },
    verdict: "accepted",
    reasonCodes: ["tsc_passed", "held_out_passed"],
    evidence: { heldOutMode: "enforce", tscErrorCount: 0 },
  });
  const reordered = issueArtifactAuthorityReceipt({
    authorityId: "research-proposal-tsc-heldout",
    tenantId: 7,
    subjectKind: "research_code_proposal",
    subjectId: "42",
    subject: {
      proposal: { newCode: "new", oldCode: "old" },
      sourceSha256: "a".repeat(64),
      targetFile: "server/example.ts",
    },
    verdict: "accepted",
    reasonCodes: ["tsc_passed", "held_out_passed"],
    evidence: { tscErrorCount: 0, heldOutMode: "enforce" },
  });

  assert.deepEqual(reordered, first);
  assert.deepEqual(
    validateArtifactAuthorityReceipt(first, {
      authorityId: "research-proposal-tsc-heldout",
      tenantId: 7,
      subjectKind: "research_code_proposal",
      subjectId: "42",
      subject: {
        targetFile: "server/example.ts",
        sourceSha256: "a".repeat(64),
        proposal: { oldCode: "old", newCode: "new" },
      },
      requiredVerdict: "accepted",
    }),
    { valid: true },
  );
});

test("artifact authority persistence requires exactly one updated row", () => {
  assert.doesNotThrow(() => assertArtifactAuthorityPersisted({ rows: [{ id: 42 }] }));
  assert.throws(
    () => assertArtifactAuthorityPersisted({ rows: [] }),
    /expected 1 updated row, got 0/,
  );
  assert.throws(
    () => assertArtifactAuthorityPersisted({ rows: [{ id: 42 }, { id: 43 }] }),
    /expected 1 updated row, got 2/,
  );
});

test("artifact authority receipt rejects subject and receipt tampering", () => {
  const receipt = issueArtifactAuthorityReceipt({
    authorityId: "research-proposal-tsc-heldout",
    tenantId: 7,
    subjectKind: "research_code_proposal",
    subjectId: "42",
    subject: { targetFile: "server/example.ts", sourceSha256: "a".repeat(64) },
    verdict: "accepted",
    reasonCodes: ["tsc_passed"],
    evidence: { tscErrorCount: 0 },
  });

  assert.deepEqual(
    validateArtifactAuthorityReceipt(receipt, {
      authorityId: "research-proposal-tsc-heldout",
      tenantId: 8,
      subjectKind: "research_code_proposal",
      subjectId: "42",
      subject: { targetFile: "server/example.ts", sourceSha256: "a".repeat(64) },
      requiredVerdict: "accepted",
    }),
    { valid: false, reason: "subject_identity_mismatch" },
  );
  assert.deepEqual(
    validateArtifactAuthorityReceipt(
      { ...receipt, verdict: "rejected" },
      {
        authorityId: "research-proposal-tsc-heldout",
        tenantId: 7,
        subjectKind: "research_code_proposal",
        subjectId: "42",
        subject: { targetFile: "server/example.ts", sourceSha256: "a".repeat(64) },
        requiredVerdict: "accepted",
      },
    ),
    { valid: false, reason: "verdict_mismatch" },
  );
});

test("artifact authority receipt extraction fails closed on missing, malformed, or duplicate lines", () => {
  const receipt = issueArtifactAuthorityReceipt({
    authorityId: "research-proposal-tsc-heldout",
    tenantId: 7,
    subjectKind: "research_code_proposal",
    subjectId: "42",
    subject: { targetFile: "server/example.ts", sourceSha256: "a".repeat(64) },
    verdict: "accepted",
    reasonCodes: ["tsc_passed"],
    evidence: { tscErrorCount: 0 },
  });
  const serialized = serializeArtifactAuthorityReceipt(receipt);

  assert.deepEqual(extractArtifactAuthorityReceipt(`tsc passed\n${serialized}`), receipt);
  assert.equal(extractArtifactAuthorityReceipt("tsc passed"), null);
  assert.equal(extractArtifactAuthorityReceipt("ARTIFACT_AUTHORITY_RECEIPT_V1={bad"), null);
  assert.equal(extractArtifactAuthorityReceipt(`${serialized}\n${serialized}`), null);
});