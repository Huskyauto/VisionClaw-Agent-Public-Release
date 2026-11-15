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

test("weekly verification reuses source-bound confirmation with a closed fixture profile", () => {
  const profile = getConfirmationProfile("bwb");
  assert.ok(profile.tests.includes("tests/video/bwb-delivery-verification-flow.test.ts"));
  for (const file of ["scripts/build-bwb-weekly.ts", "scripts/bwb-render-github.ts",
    "server/lib/video-output-verification.ts", "scripts/lib/offline-verification.ts",
    ...profile.tests]) assert.ok(profile.sources.includes(file), file);
  assert.equal(profile.timeoutMs, 180_000);
  assert.equal(profile.maxLogBytes, 8 * 1024 * 1024);
  assert.match(profile.scope, /not live/);
  const script = readFileSync("scripts/project-confirmation.ts", "utf8");
  assert.match(script, /buildOfflineVerificationEnv\(process\.env, home\)/);
  assert.match(script, /rmSync\(home, \{ recursive: true, force: true \}\)/);
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
