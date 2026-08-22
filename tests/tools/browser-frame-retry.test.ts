/**
 * Regression pins for the browser tool's detached-frame recovery
 * (architect-reviewed PASS, 2026-08-09).
 *
 * Incident: transient Playwright "detached Frame" / "Execution context was
 * destroyed" errors during multi-step browsing fell into the generic catch
 * and tore down the whole tenant browser session. The fix retries once for
 * read-only actions, never replays mutations (double-submit risk), stays
 * quota-neutral via AsyncLocalStorage, and health-checks before keeping
 * the session open.
 *
 * STATIC source pins (repo convention — importing server/browser-tool.ts
 * pulls puppeteer/providers/db side effects that hang the node:test runner).
 * Pins the exact properties the architect review required:
 *   1. retry gated to the read-only allowlist, one-shot via __frameRetried
 *   2. mutating actions get an ambiguous-outcome error, never a replay
 *   3. quota-neutral: rate-limit admission skipped on retry AND recordAction
 *      suppressed inside the frameRetryAls async context
 *   4. session-alive claim only after a bounded health probe; dead session
 *      falls through to teardown
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.resolve(process.cwd(), "server/browser-tool.ts"),
  "utf-8",
);

test("detached-frame error class is detected", () => {
  assert.match(SRC, /const DETACHED_FRAME_RE = \/detached Frame\|Execution context was destroyed\|Cannot find context with specified id\|frame got detached\|Node is detached from document\/i/,
    "DETACHED_FRAME_RE must cover the transient frame/context error class");
});

test("retry allowlist is read-only actions only — no mutations", () => {
  const m = SRC.match(/const RETRYABLE_READONLY = new Set\(\[([^\]]+)\]\)/);
  assert.ok(m, "RETRYABLE_READONLY allowlist missing");
  const actions = m[1].split(",").map(s => s.trim().replace(/["']/g, ""));
  const MUTATING = ["click", "type", "form_fill", "navigate", "vision_act", "act"];
  for (const bad of MUTATING) {
    assert.ok(!actions.includes(bad), `mutating action '${bad}' must NEVER be in the retry allowlist`);
  }
  for (const good of ["screenshot", "content", "snapshot", "read_page_md"]) {
    assert.ok(actions.includes(good), `read-only action '${good}' expected in the allowlist`);
  }
});

test("retry is one-shot via __frameRetried and wrapped in the ALS context", () => {
  assert.match(SRC, /readOnly && !\(params as any\)\.__frameRetried/,
    "retry must require readOnly AND first attempt");
  assert.match(SRC, /frameRetryAls\.run\(true, \(\) => executeBrowserAction\(\{ \.\.\.\(params as any\), __frameRetried: true \}\)\)/,
    "recursive retry must run inside frameRetryAls so recordAction is suppressed everywhere");
});

test("quota-neutral: rate-limit admission skipped on retry, recordAction ALS-gated", () => {
  assert.match(SRC, /!\(params as any\)\.__frameRetried && !checkTenantRateLimit\(tenantId, config\)/,
    "rate-limit admission must be skipped for the internal retry");
  const recordFn = SRC.slice(SRC.indexOf("function recordAction"), SRC.indexOf("function recordAction") + 400);
  assert.match(recordFn, /session\.lastActivity = Date\.now\(\);/,
    "recordAction must still update lastActivity during a retry");
  const lastActivityIdx = recordFn.indexOf("session.lastActivity");
  const alsGateIdx = recordFn.indexOf("frameRetryAls.getStore()");
  const countIdx = recordFn.indexOf("session.actionCount++");
  assert.ok(alsGateIdx > lastActivityIdx && alsGateIdx < countIdx,
    "the ALS early-return must sit AFTER lastActivity and BEFORE the quota mutations");
  // No leftover tail-pop compensation (architect-rejected approach).
  assert.ok(!/actionTimestamps\.pop\(\)/.test(SRC),
    "shared-array tail-pop compensation must not exist (concurrency-unsafe)");
});

test("mutating actions get the ambiguous-outcome error, never a replay instruction", () => {
  assert.match(SRC, /outcome is UNKNOWN/,
    "mutation-path error must state the outcome is unknown");
  assert.match(SRC, /Do NOT blindly repeat it/,
    "mutation-path error must forbid blind replay and direct a snapshot+verify");
});

test("session-alive claim requires a bounded health probe; dead session falls through to teardown", () => {
  assert.match(SRC, /let sessionAlive = false;/, "health flag must default to dead");
  assert.match(SRC, /p\.evaluate\("1"\)/, "probe must evaluate on the live page");
  assert.match(SRC, /health timeout/, "probe must be raced against a timeout");
  // The friendly no-teardown message must be inside the sessionAlive branch.
  const aliveIdx = SRC.indexOf("if (sessionAlive) {");
  const msgIdx = SRC.indexOf("The browser session is still open");
  assert.ok(aliveIdx > 0 && msgIdx > aliveIdx,
    "'session still open' may only be claimed after the health probe passes");
});
