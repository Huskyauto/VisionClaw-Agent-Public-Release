import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  logSilentCatch,
  getSilentCatchStats,
  resetSilentCatchStats,
} from "../../server/lib/silent-catch";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

beforeEach(() => resetSilentCatchStats());

test("default category is 'unexpected'", () => {
  logSilentCatch("foo.bar", new Error("boom"));
  assert.equal(getSilentCatchStats()["unexpected:foo.bar"], 1);
});

test("counts accumulate per category+site", () => {
  logSilentCatch("a", new Error("x"));
  logSilentCatch("a", new Error("y"));
  logSilentCatch("a", new Error("z"), "expected");
  const s = getSilentCatchStats();
  assert.equal(s["unexpected:a"], 2);
  assert.equal(s["expected:a"], 1);
});

test("counting happens even when logging is disabled (production observability)", () => {
  // counter increments regardless of NODE_ENV / LOG_SILENT_CATCHES
  logSilentCatch("prod.path", new Error("e"), "expected");
  assert.equal(getSilentCatchStats()["expected:prod.path"], 1);
});

test("distinct sites are tracked independently", () => {
  logSilentCatch("site.one", new Error("1"));
  logSilentCatch("site.two", new Error("2"));
  const s = getSilentCatchStats();
  assert.equal(s["unexpected:site.one"], 1);
  assert.equal(s["unexpected:site.two"], 1);
});

test("resetSilentCatchStats clears counters", () => {
  logSilentCatch("x", new Error("e"));
  resetSilentCatchStats();
  assert.deepEqual(getSilentCatchStats(), {});
});

test("backward-compatible 2-arg call still works", () => {
  // The 783 existing callsites pass only (site, err); must not throw.
  assert.doesNotThrow(() => logSilentCatch("legacy.call", "string error"));
  assert.equal(getSilentCatchStats()["unexpected:legacy.call"], 1);
});
