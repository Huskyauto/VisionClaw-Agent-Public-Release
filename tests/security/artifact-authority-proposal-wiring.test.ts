import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { persistProposalVerification } from "../../server/proposal-verifier";
import { parseProposalDiff } from "../../server/lib/proposal-diff";
import {
  artifactAuthoritySha256Text,
  issueArtifactAuthorityReceipt,
  validateArtifactAuthorityReceipt,
} from "../../server/lib/artifact-authority";

const verifier = fs.readFileSync("server/proposal-verifier.ts", "utf8");
const proposals = fs.readFileSync("server/research-proposals.ts", "utf8");

test("proposal verification emits an accepted content-bound artifact authority receipt", () => {
  assert.match(verifier, /parseProposalDiff\(codeDiff\)/);
  assert.match(verifier, /issueArtifactAuthorityReceipt/);
  assert.match(verifier, /serializeArtifactAuthorityReceipt/);
  assert.match(verifier, /research-proposal-tsc-heldout/);
  assert.match(verifier, /sourceSha256/);
  assert.match(verifier, /verdict:\s*"accepted"/);
  assert.match(verifier, /RETURNING id/);
  assert.match(verifier, /assertArtifactAuthorityPersisted\(persisted\)/);
});

test("proposal apply validates artifact authority before its first source write", () => {
  const validationIndex = proposals.indexOf("validateArtifactAuthorityReceipt");
  const firstWriteIndex = proposals.indexOf("fs.writeFile(");
  assert.ok(validationIndex > 0, "safeApplyProposal must validate the artifact authority receipt");
  assert.ok(firstWriteIndex > validationIndex, "receipt validation must happen before the first source write");
  assert.match(proposals, /requiredVerdict:\s*"accepted"/);
  assert.match(proposals, /stage:\s*"artifact_authority"/);
});

test("indented proposal uses one canonical diff for verifier and apply receipt validation", () => {
  const parsed = parseProposalDiff(`
<<<OLD_CODE>>>
    const before = true;
<<</OLD_CODE>>>
<<<NEW_CODE>>>
    const after = true;
<<</NEW_CODE>>>`);
  assert.ok(parsed);
  const source = "function example() {\n    const before = true;\n}\n";
  const subject = {
    targetFile: "server/example.ts",
    sourceSha256: artifactAuthoritySha256Text(source),
    proposal: parsed,
  };
  const receipt = issueArtifactAuthorityReceipt({
    authorityId: "research-proposal-tsc-heldout",
    tenantId: 7,
    subjectKind: "research_code_proposal",
    subjectId: "42",
    subject,
    verdict: "accepted",
    reasonCodes: ["tsc_passed", "held_out_passed"],
    evidence: { tscErrorCount: 0 },
  });
  assert.deepEqual(validateArtifactAuthorityReceipt(receipt, {
    authorityId: "research-proposal-tsc-heldout",
    tenantId: 7,
    subjectKind: "research_code_proposal",
    subjectId: "42",
    subject,
    requiredVerdict: "accepted",
  }), { valid: true });
});

test("verification persistence rejects zero-row updates instead of reporting success", async () => {
  await assert.rejects(
    persistProposalVerification(42, 7, "passed", "receipt", async () => ({ rows: [] })),
    /expected 1 updated row, got 0/,
  );
});