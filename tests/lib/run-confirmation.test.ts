import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunConfirmation } from "../../server/lib/run-confirmation";

const digest = "a".repeat(64);
test("confirmation requires every predeclared check, evidence and stable exact source", () => {
  const input = {
    scope: "fixture checks only", subjectDigest: digest, currentDigest: digest,
    requirements: [{ id: "schema", label: "Schema semantics preserved" }],
    observations: [{ id: "schema", status: "passed" as const, evidence: "node:test: 1 passed; log sha256=" + digest }],
  };
  assert.equal(createRunConfirmation(input).status, "confirmed");
  assert.equal(createRunConfirmation({ ...input, observations: [] }).status, "unverified");
  assert.equal(createRunConfirmation({ ...input, observations: [{ ...input.observations[0], evidence: "" }] }).status, "unverified");
  assert.equal(createRunConfirmation({ ...input, currentDigest: "b".repeat(64) }).status, "unverified");
  assert.equal(createRunConfirmation({ ...input, observations: [{ ...input.observations[0], status: "failed" }] }).status, "failed");
  assert.equal(createRunConfirmation({ ...input, observations: [...input.observations, ...input.observations] }).status, "unverified");
  assert.equal(createRunConfirmation({ ...input, requirements: [], observations: [] }).status, "unverified");
});
