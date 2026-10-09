/**
 * FAILURE TAXONOMY — unit coverage for the queue's failure-class classifier
 * and retry policy (server/lib/failure-taxonomy.ts).
 *
 * Pure-function suite: NO DB, NO network, so it never opens a pg pool (which
 * would hang the per-file node process). Top-level imports only — inline
 * require() throws under the tsx ESM test loader.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFailure,
  retryPolicyFor,
  classifyAndPolicy,
  type FailureClass,
} from "../../server/lib/failure-taxonomy";

test("rate-limit signals classify as rate_limit with a longer backoff", () => {
  for (const msg of [
    "Error 429 Too Many Requests",
    "rate limit exceeded, retry later",
    "quota exhausted for this key",
    "request was throttled",
  ]) {
    assert.equal(classifyFailure(msg), "rate_limit", msg);
  }
  const p = retryPolicyFor("rate_limit");
  assert.equal(p.retryable, true);
  assert.ok(p.backoffMultiplier > 1, "rate_limit should back off longer than normal");
});

test("deterministic failures are NON-retryable (immediate dead-letter)", () => {
  const cases: Array<[string, FailureClass]> = [
    ["Validation error: field 'name' is required", "validation_error"],
    ["400 Bad Request: malformed payload", "validation_error"],
    ["zod: invalid input", "validation_error"],
    ["Blocked by policy: content-policy violation", "guardrail_blocked"],
    ["tool policy refused due to guardrail", "guardrail_blocked"],
    ["404 not found", "not_found"],
    ["no such record in table", "not_found"],
    ['No handler registered for kind="frobnicate"', "deterministic_input"],
    ["unsupported kind: widget", "deterministic_input"],
  ];
  for (const [msg, expected] of cases) {
    assert.equal(classifyFailure(msg), expected, msg);
    assert.equal(retryPolicyFor(expected).retryable, false, `${expected} must be non-retryable`);
  }
});

test("transient failures stay retryable at normal backoff", () => {
  const cases: Array<[string, FailureClass]> = [
    ["ECONNRESET socket hang up", "network_transient"],
    ["fetch failed: ENOTFOUND api.example.com", "network_transient"],
    ["503 Service Unavailable", "network_transient"],
    ["operation timed out after 30000ms", "timeout"],
    ["deadline exceeded", "timeout"],
    ["401 Unauthorized: token expired", "auth_expired"],
    ["invalid api key", "auth_expired"],
    ["TypeError: undefined is not a function", "internal_bug"],
  ];
  for (const [msg, expected] of cases) {
    assert.equal(classifyFailure(msg), expected, msg);
    const p = retryPolicyFor(expected);
    assert.equal(p.retryable, true, `${expected} should be retryable`);
    assert.equal(p.backoffMultiplier, 1, `${expected} should use normal backoff`);
  }
});

test("unknown / empty errors fall back to legacy retryable behavior", () => {
  for (const msg of ["", null, undefined, "something weird happened", "   "]) {
    assert.equal(classifyFailure(msg as any), "unknown", JSON.stringify(msg));
  }
  const p = retryPolicyFor("unknown");
  assert.equal(p.retryable, true);
  assert.equal(p.backoffMultiplier, 1, "unknown must match the pre-taxonomy schedule (no regression)");
});

test("precedence: timeout beats generic network; auth beats not_found", () => {
  // A timed-out fetch is a timeout, not a generic network blip.
  assert.equal(classifyFailure("fetch failed: operation timed out"), "timeout");
  // 403 is auth, never "not found".
  assert.equal(classifyFailure("403 Forbidden"), "auth_expired");
});

test("classifyAndPolicy returns a consistent class+policy pair", () => {
  const { failureClass, policy } = classifyAndPolicy("429 rate limit");
  assert.equal(failureClass, "rate_limit");
  assert.deepEqual(policy, retryPolicyFor("rate_limit"));
});
