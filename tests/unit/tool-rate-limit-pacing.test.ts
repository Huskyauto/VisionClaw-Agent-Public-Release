import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkToolRateLimitPaced,
  checkToolRateLimit,
  recordToolUsage,
  getToolUsageStats,
  rateLimitAlternatesHint,
  PACE_MAX_WAIT_MS,
} from "../../server/tool-rate-limiter";

// Task #171 — pin the pace-not-kill contract shared by BOTH enforcement
// points (guarded-tool-executor + tools middleware). The 2026-08-08 regression:
// pacing existed only in the middleware, so Felix's chat-path research calls
// hard-failed with "RATE LIMITED: web_fetch called 8/8 times in the last
// minute" while the dispatcher path would have waited for a slot.
//
// Contract:
//   - minute-window exhaustion → wait ONCE (bounded ≤70s) for a slot, re-check,
//     proceed if a slot freed;
//   - hour/day exhaustion → immediate hard deny, NO wait (real spend ceilings);
//   - both enforcement points call the SHARED paced checker (static scan) and
//     the _rateLimitChecked handshake prevents double-count.

// tool-rate-limiter imports server/db.ts, which opens a pg pool at module
// load. Force-exit after the suite (admin-gate.test.ts pattern).
after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// Clock stub: the limiter reads Date.now() for windows; setTimeout stays real,
// so tests backdate usage entries by advancing the stubbed clock instead of
// sleeping. Always restore.
const realNow = Date.now;
function withClockOffset<T>(offsetMs: number, fn: () => T): T {
  Date.now = () => realNow() + offsetMs;
  try { return fn(); } finally { Date.now = realNow; }
}

// Distinct high tenant ids per test — the usage cache is process-global.
const T_MINUTE = 990001;
const T_HOUR = 990002;
const T_NOWAIT = 990003;

test("pace bound constant stays sane (≤70s single wait)", () => {
  assert.ok(PACE_MAX_WAIT_MS <= 70_000, "pacing must never wait more than 70s");
});

test("minute-window exhaustion: paced check waits for a slot then ALLOWS", async () => {
  // Fill web_fetch's 8/min window with entries recorded "now"…
  for (let i = 0; i < 8; i++) recordToolUsage(T_MINUTE, "web_fetch");
  // …then view them from ~59.6s later: still inside the minute window (deny,
  // retryAfter ≈ 400ms) but about to expire, so the paced wait is short and
  // the re-check after the real sleep sees a freed slot.
  Date.now = () => realNow() + 59_600;
  try {
    const bare = checkToolRateLimit(T_MINUTE, "web_fetch");
    assert.equal(bare.allowed, false, "precondition: bare check must deny");
    assert.ok((bare.retryAfterMs ?? 0) > 0 && (bare.retryAfterMs ?? 0) < 5_000);

    const started = process.hrtime.bigint();
    const paced = await checkToolRateLimitPaced(T_MINUTE, "web_fetch");
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    assert.equal(paced.allowed, true, `paced check must ALLOW after waiting (got: ${paced.reason})`);
    assert.ok(paced.pacedMs && paced.pacedMs > 0, "must report that it paced");
    assert.ok(elapsedMs >= 300, `must actually wait (elapsed ${elapsedMs}ms)`);
    assert.ok(elapsedMs <= PACE_MAX_WAIT_MS + 1_000, "wait must stay bounded");
  } finally {
    Date.now = realNow;
  }
});

test("hour-window exhaustion: immediate hard deny, NO wait", async () => {
  // Fill web_fetch's 40/hour ceiling…
  for (let i = 0; i < 40; i++) recordToolUsage(T_HOUR, "web_fetch");
  // …viewed from 61s later: minute window empty, hour window full.
  Date.now = () => realNow() + 61_000;
  try {
    const started = process.hrtime.bigint();
    const paced = await checkToolRateLimitPaced(T_HOUR, "web_fetch");
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    assert.equal(paced.allowed, false, "hour ceiling must hard-deny");
    assert.match(paced.reason ?? "", /hour/i);
    assert.equal(paced.pacedMs, undefined, "must NOT pace on hour/day ceilings");
    assert.ok(elapsedMs < 2_000, `hour deny must be immediate (elapsed ${elapsedMs}ms)`);
  } finally {
    Date.now = realNow;
  }
});

test("open window: paced check allows immediately without waiting", async () => {
  const started = process.hrtime.bigint();
  const paced = await checkToolRateLimitPaced(T_NOWAIT, "web_fetch");
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(paced.allowed, true);
  assert.equal(paced.pacedMs, undefined);
  assert.ok(elapsedMs < 500, "no wait when a slot is free");
});

test("usage is recorded by the caller, not the checker (single-count contract)", () => {
  // The paced checker itself must never record usage — the enforcement point
  // records exactly once after an allowed verdict. T_NOWAIT ran the checker
  // above without a record, so its stats must be empty.
  const stats = getToolUsageStats(T_NOWAIT, "web_fetch");
  assert.equal(stats.web_fetch, undefined, "checker must not record usage itself");
});

// ---------------------------------------------------------------------------
// Window-aware alternate hints: minute-window denials name sibling avenues to
// spread across; hour/day ceilings must NEVER steer to sibling tools (spend-
// ceiling evasion — architect finding 2026-08-08).
// ---------------------------------------------------------------------------

test("alternates hint: minute window names sibling avenues", () => {
  const hint = rateLimitAlternatesHint("web_fetch", "minute");
  assert.match(hint, /firecrawl_scrape/);
  assert.match(hint, /SEPARATE limits/);
});

test("alternates hint: hour/day ceilings refuse avenue-spreading", () => {
  for (const w of ["hour", "day"] as const) {
    const hint = rateLimitAlternatesHint("web_fetch", w);
    assert.doesNotMatch(hint, /firecrawl_scrape|stealth_browse|web_search/,
      `${w} ceiling must not name sibling tools`);
    assert.match(hint, /do NOT switch/i);
    assert.match(hint, /[Cc]onsolidate/);
  }
});

test("deny verdicts carry the exhausted window", () => {
  // T_MINUTE still has 8 fresh-ish entries from the pacing test; re-fill to be safe.
  const T = 990004;
  for (let i = 0; i < 8; i++) recordToolUsage(T, "web_fetch");
  const minute = checkToolRateLimit(T, "web_fetch");
  assert.equal(minute.allowed, false);
  assert.equal(minute.window, "minute");
  for (let i = 0; i < 40; i++) recordToolUsage(T, "web_fetch");
  Date.now = () => realNow() + 61_000;
  try {
    const hour = checkToolRateLimit(T, "web_fetch");
    assert.equal(hour.allowed, false);
    assert.equal(hour.window, "hour");
  } finally { Date.now = realNow; }
});

// ---------------------------------------------------------------------------
// Static scans: both enforcement points use the SHARED paced checker, and the
// guarded path stamps the _rateLimitChecked handshake so the middleware can't
// double-wait or double-count.
// ---------------------------------------------------------------------------

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

test("guarded-tool-executor uses the shared paced checker + handshake", () => {
  const src = stripComments(readFileSync("server/guarded-tool-executor.ts", "utf8"));
  assert.match(src, /await checkToolRateLimitPaced\(tenantId, toolName\)/,
    "guarded executor must use the SHARED paced checker — a bare checkToolRateLimit here is the hard-deny regression");
  assert.doesNotMatch(src, /[^d]\bcheckToolRateLimit\(/,
    "no bare (unpaced) checkToolRateLimit call in the guarded executor");
  assert.match(src, /_rateLimitChecked:\s*true/,
    "guarded executor must stamp _rateLimitChecked so the middleware doesn't wait/count again");
});

test("tools middleware uses the shared paced checker behind the handshake gate", () => {
  const src = stripComments(readFileSync("server/tools/middleware/rate-limit.ts", "utf8"));
  assert.match(src, /_rateLimitChecked/, "middleware must honor the handshake");
  assert.match(src, /await checkToolRateLimitPaced\(/,
    "middleware must use the SHARED paced checker (no inline pacing drift)");
  assert.doesNotMatch(src, /checkToolRateLimit\(/,
    "no bare (unpaced) checkToolRateLimit call in the middleware");
});
