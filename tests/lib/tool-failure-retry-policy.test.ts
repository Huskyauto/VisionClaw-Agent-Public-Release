import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getToolFailureRetryPolicy, recordToolFailureOutcome, copyToolFailureOutcome } from "../../server/lib/tool-failure-retry-policy";
import { buildRetryTimeoutError, buildCommitConfirmedError } from "../../server/lib/action-ledger-retry";

test("second_opinion timeout is disclosed but never automatically retried", () => {
  const policy = getToolFailureRetryPolicy("second_opinion", {
    ok: false,
    skipped: "error",
    failureKind: "model_timeout",
    error: "Fusion call timed out after 60000ms",
  });

  assert.equal(policy.suppressAdaptiveRetry, true);
  assert.match(policy.selfHealHint, /do not retry second_opinion/i);
  assert.match(policy.selfHealHint, /completed in-house jury/i);
  assert.match(policy.userFacingInstruction, /external second-opinion timed out/i);
});

test("explicit uncertain completion suppresses retries without interpreting an ordinary timeout as success", () => {
  const result = { ok: false, outcomeUnknown: true };
  recordToolFailureOutcome(result, Object.assign(new Error("timeout"), { outcomeUnknown: true }));
  const policy = getToolFailureRetryPolicy("send_email", result);
  assert.equal(policy.suppressAdaptiveRetry, true);
  assert.match(policy.selfHealHint, /DO NOT retry/);
  assert.match(policy.userFacingInstruction, /unconfirmed/i);
  assert.equal(getToolFailureRetryPolicy("web_search", { ok: false, outcomeUnknown: "true" }).suppressAdaptiveRetry, false);
});

test("action-ledger timeout signals preserve their confirmed versus uncertain outcome", () => {
  const unknown = buildRetryTimeoutError("send_email", 1000) as Error & { outcomeUnknown?: boolean };
  assert.equal(unknown.outcomeUnknown, true);
  const committed = buildCommitConfirmedError("send_email", 1000, 12) as Error & { outcomeCommitted?: boolean };
  assert.equal(committed.outcomeCommitted, true);
  const result = { error: committed.message, outcomeCommitted: true };
  recordToolFailureOutcome(result, committed);
  const cleaned = Object.assign(Object.create(null), result);
  copyToolFailureOutcome(result, cleaned);
  const policy = getToolFailureRetryPolicy("send_email", cleaned);
  assert.equal(policy.suppressAdaptiveRetry, true);
  assert.match(policy.userFacingInstruction, /confirmed/i);
});

test("tool-returned outcome booleans cannot impersonate engine confirmation", () => {
  assert.equal(getToolFailureRetryPolicy("send_email", { error: "untrusted", outcomeCommitted: true }).suppressAdaptiveRetry, false);
  assert.equal(getToolFailureRetryPolicy("send_email", { error: "untrusted", outcomeUnknown: true }).suppressAdaptiveRetry, false);
  const spoof = { error: "untrusted", outcomeCommitted: true };
  const cleaned = { ...spoof };
  copyToolFailureOutcome(spoof, cleaned);
  assert.equal(getToolFailureRetryPolicy("send_email", cleaned).suppressAdaptiveRetry, false);
});

test("other terminal second_opinion provider outcomes also suppress automatic retries", () => {
  for (const failureKind of [
    "provider_overload",
    "provider_error",
    "fusion_daily_usd",
    "cost_drift_latched",
    "wiring",
  ]) {
    const policy = getToolFailureRetryPolicy("second_opinion", {
      ok: false,
      skipped: "error",
      failureKind,
      error: "external check unavailable",
    });
    assert.equal(policy.suppressAdaptiveRetry, true, failureKind);
  }
});

test("the cost-drift latch result shape is terminal even though it spent nothing", () => {
  const policy = getToolFailureRetryPolicy("second_opinion", {
    ok: false,
    skipped: "latched",
    failureKind: "cost_drift_latched",
    error: "Fusion cost-drift latch tripped",
  });
  assert.equal(policy.suppressAdaptiveRetry, true);
  assert.match(policy.selfHealHint, /do not retry second_opinion/i);
});

test("correctable input failures and ordinary tools keep generic recovery", () => {
  assert.equal(
    getToolFailureRetryPolicy("second_opinion", {
      error: "question must be ≥10 chars",
    }).suppressAdaptiveRetry,
    false,
  );
  assert.equal(
    getToolFailureRetryPolicy("web_search", {
      error: "temporary network error",
      failureKind: "network_transient",
    }).suppressAdaptiveRetry,
    false,
  );
});

test("chat-engine gives the terminal policy precedence over every generic retry layer", () => {
  const source = readFileSync(
    new URL("../../server/chat-engine.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /getToolFailureRetryPolicy\(toolName, resultRecord\)/);
  assert.match(source, /copyToolFailureOutcome\(result, cleaned\);\s*result = cleaned/);
  assert.match(source, /if \(!suppressAdaptiveRetry\) \{\s*const retryKey/);
  assert.match(source, /if \(!suppressAdaptiveRetry && attempt <= 2/);
  assert.match(source, /const fallback = suppressAdaptiveRetry\s*\?\s*null/);

  const doNotRetryExceptions = source
    .split("\n")
    .filter((line) => line.includes("_selfHealHint") && line.includes("DO NOT retry"));
  assert.ok(
    doNotRetryExceptions.length >= 3,
    "Felix and shared system prompts must explicitly exempt engine-authored no-retry outcomes",
  );

  const toolDiscipline = source.match(
    /TOOL DISCIPLINE — FAILURE HANDLING:([\s\S]*?)VIDEO vs PRESENTATIONS/,
  )?.[1] || "";
  assert.match(toolDiscipline, /engine-authored _selfHealHint/);
  assert.match(toolDiscipline, /DO NOT retry/);

  const selfCorrection = source.match(
    /## SELF-CORRECTION PROTOCOL \(MANDATORY — NOT OPTIONAL\)([\s\S]*?)You learn from every mistake/,
  )?.[1] || "";
  assert.match(selfCorrection, /Three-strike rule for ordinary retryable failures/);
  assert.match(selfCorrection, /never overrides an engine-authored "DO NOT retry"/);
});