import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessTapCheck, getConfirmationProfile, assessReleaseConfirmation } from "../../scripts/lib/project-confirmation";

test("offline check confirmation rejects empty, skipped, cancelled and failed tests", () => {
  const tap = "# tests 3\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
  assert.equal(assessTapCheck(tap, true), "passed");
  assert.equal(assessTapCheck(tap, false), "failed");
  assert.equal(assessTapCheck("", true), "unverified");
  assert.equal(assessTapCheck(tap.replace("# skipped 0", "# skipped 1"), true), "unverified");
  assert.equal(assessTapCheck(tap.replace("# cancelled 0", "# cancelled 1"), true), "unverified");
  assert.equal(assessTapCheck(tap.replace("# fail 0", "# fail 1"), true), "failed");
  assert.throws(() => getConfirmationProfile("../../other"), /Unknown/);
  assert.ok(getConfirmationProfile("harness-rollout").tests.length > 0);
});

test("replay keeps retrieval failures visible and does not show stale detail as confirmation", () => {
  const source = readFileSync("client/src/pages/workflow-replay.tsx", "utf8");
  assert.match(source, /isError: detailError/);
  assert.match(source, /run-confirmation-load-error/);
  assert.match(source, /detail\.id === selectedId && !detailLoading && !detailError/);
  assert.match(source, /void reloadDetail\(\)/);
});

test("blocked release output cannot confirm even when all commands passed on stable source", () => {
  const input = {
    subjectDigest: "a".repeat(64), sourceStable: true,
    requirements: [{ id: "build", label: "Build command exits successfully" }],
    checks: [{ name: "build", passed: true, code: 0, timedOut: false, elapsedMs: 1, log: "build.log" }],
    status: "BLOCKED_SENSITIVE_BUILD_SNAPSHOT",
  };
  assert.equal(assessReleaseConfirmation(input).status, "unverified");
  assert.equal(assessReleaseConfirmation({ ...input, status: "AUTOMATED_CHECKS_PASSED_REVIEW_REQUIRED" }).status, "confirmed");
});
