import assert from "node:assert/strict";
import { test } from "node:test";
import { safeTripleErrorDetails } from "../../server/memory/safe-triple-error";

test("triple failure diagnostics keep SQLSTATE but never SQL parameters or fact text", () => {
  const error = {
    name: "DrizzleQueryError",
    message: "Failed query with private conversation values",
    cause: { code: "23502", detail: "secret fact" },
  };
  const details = safeTripleErrorDetails(error);
  assert.deepEqual(details, { kind: "database", name: "DrizzleQueryError", code: "23502" });
  assert.doesNotMatch(JSON.stringify(details), /private|secret|conversation/i);
});

test("non-database extraction errors remain identifiable without exposing the message", () => {
  const details = safeTripleErrorDetails(new SyntaxError("private model response"));
  assert.deepEqual(details, { kind: "parse", name: "SyntaxError", code: "unknown" });
});

test("a same-date contradiction has a safe actionable diagnostic", () => {
  assert.deepEqual(
    safeTripleErrorDetails(new Error("A conflicting triple has the same valid_from date")),
    { kind: "interval_conflict", name: "Error", code: "unknown" },
  );
});