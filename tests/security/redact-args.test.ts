// Regression: redactArgs() must mask secret-like keys BEFORE any length
// truncation. The prior ordering truncated long strings first, so a >80-char
// token/apiKey value leaked its first 60 chars into security_tool_blocks
// telemetry instead of being masked. (Full-app + 72h review, 2026-06-02.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { redactArgs } from "../../server/safety/destructive-tool-policy";

const LONG = "x".repeat(200);

test("long secret-like values are fully redacted, never truncated", () => {
  for (const key of ["apiKey", "api_key", "secret", "accessToken", "password", "authToken", "AUTHORIZATION"]) {
    const out = redactArgs({ [key]: LONG });
    assert.equal(out[key], "[REDACTED]", `${key} must be [REDACTED], got: ${out[key]}`);
    assert.ok(!String(out[key]).includes("x"), `${key} leaked value chars`);
  }
});

test("short secret-like values are still redacted", () => {
  const out = redactArgs({ token: "abc123" });
  assert.equal(out.token, "[REDACTED]");
});

test("long non-secret strings are truncated (not leaked whole, not over-redacted)", () => {
  const out = redactArgs({ prompt: LONG });
  assert.match(String(out.prompt), /^x{60}…\(200chars\)$/);
});

test("short non-secret values pass through unchanged", () => {
  const out = redactArgs({ count: 5, name: "ok" });
  assert.equal(out.count, 5);
  assert.equal(out.name, "ok");
});

test("non-object input is shape-only", () => {
  assert.deepEqual(redactArgs("nope"), { _kind: "string" });
  assert.deepEqual(redactArgs(null), { _kind: "object" });
});
