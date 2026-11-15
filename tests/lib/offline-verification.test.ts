import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOfflineVerificationEnv } from "../../scripts/lib/offline-verification";
import { assessTapCheck } from "../../scripts/lib/project-confirmation";
import { runBoundedReleaseCommand } from "../../scripts/lib/targeted-release-check";
import { BWB_VERIFICATION_TESTS } from "../../scripts/lib/bwb-verification-profile";

test("offline checks inherit only execution basics, not credentials, endpoints or runtime flags", () => {
  const env = buildOfflineVerificationEnv({
    PATH: "/usr/bin", LANG: "C.UTF-8", OWNER_EMAIL: "fixture@example.invalid",
    OPENAI_API_KEY: "synthetic-owner-key", DATABASE_URL: "synthetic-live-database",
    CUSTOM_NEW_PROVIDER_TOKEN: "synthetic-secret", NODE_OPTIONS: "--require=bad.cjs",
    LD_PRELOAD: "/bad.so", HTTP_PROXY: "https://proxy.invalid",
    REPAIR_AUTOFIX_ENABLED: "1", HOME: "/owner-home",
  }, "/tmp/fixture-home");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/tmp/fixture-home");
  assert.equal(env.XDG_CONFIG_HOME, "/tmp/fixture-home/.config");
  for (const key of ["OWNER_EMAIL", "CUSTOM_NEW_PROVIDER_TOKEN", "LD_PRELOAD",
    "HTTP_PROXY", "REPAIR_AUTOFIX_ENABLED"]) assert.equal(env[key], undefined, key);
  assert.equal(env.NODE_OPTIONS, "--max-old-space-size=3072");
  assert.match(env.DATABASE_URL!, /127\.0\.0\.1:1\/offline/);
  assert.equal(env.OPENAI_API_KEY, "offline-constructor-fixture");
  assert.match(env.OPENAI_BASE_URL!, /\.invalid/);
  assert.equal(env.RUN_E2E, "0");
});

test("the spawned process sees the isolated environment rather than the parent environment", async () => {
  const dir = mkdtempSync(join(tmpdir(), "offline-child-"));
  try {
    const logFile = join(dir, "child.log");
    const result = await runBoundedReleaseCommand(process.execPath, ["-e", `
      const assert = require("node:assert/strict");
      assert.equal(process.env.OWNER_ONLY_TEST_SECRET, undefined);
      assert.equal(process.env.OPENAI_API_KEY, "offline-constructor-fixture");
      assert.equal(process.env.RUN_E2E, "0");
      assert.equal(process.env.HOME, ${JSON.stringify(dir)});
      assert.match(process.env.DATABASE_URL, /127\\.0\\.0\\.1:1\\/offline/);
      console.log("child-environment-verified");
    `], {
      logFile, timeoutMs: 5000,
      env: buildOfflineVerificationEnv({ ...process.env, OWNER_ONLY_TEST_SECRET: "synthetic-owner-value" }, dir),
    });
    assert.equal(result.passed, true, readFileSync(logFile, "utf8"));
    assert.match(readFileSync(logFile, "utf8"), /child-environment-verified/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("scratch HOME must be absolute", () => {
  assert.throws(() => buildOfflineVerificationEnv({}, "relative-home"), /absolute/);
});

test("exit zero alone cannot certify skipped, empty, incomplete or failed test coverage", () => {
  const summary = (tests: number, pass: number, fail = 0, skipped = 0) =>
    `# tests ${tests}\n# suites 0\n# pass ${pass}\n# fail ${fail}\n# cancelled 0\n# skipped ${skipped}\n# todo 0\n`;
  assert.equal(assessTapCheck(summary(4, 4), true), "passed");
  for (const text of [summary(0, 0), summary(4, 3, 0, 1), summary(4, 3, 1),
    summary(4, 2), "# tests 4\n# pass 4\n", summary(4, 4) + summary(1, 0, 1)]) {
    assert.notEqual(assessTapCheck(text, true), "passed", text);
  }
});

test("the reviewed weekly profile cannot silently omit a new unit or video regression", () => {
  assert.equal(new Set(BWB_VERIFICATION_TESTS).size, BWB_VERIFICATION_TESTS.length);
  for (const dir of ["tests/unit", "tests/video"]) {
    for (const file of readdirSync(dir).filter(file => /^bwb-.*\.test\.ts$/.test(file))) {
      assert.ok((BWB_VERIFICATION_TESTS as readonly string[]).includes(`${dir}/${file}`),
        `Review and add ${dir}/${file} to the offline profile; do not auto-execute arbitrary files`);
    }
  }
});

test("new test runner rejects unknown arguments before creating evidence or running tests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "offline-args-"));
  try {
    const logFile = join(dir, "args.log");
    const result = await runBoundedReleaseCommand(process.execPath, [
      "--import", "tsx", "scripts/project-confirmation.ts", "--profile", "bwb", "--dry-run",
    ], { logFile, timeoutMs: 10_000, env: buildOfflineVerificationEnv(process.env, dir) });
    assert.equal(result.passed, false);
    assert.equal(result.code, 2);
    const log = readFileSync(logFile, "utf8");
    assert.match(log, /UNVERIFIED/);
    assert.doesNotMatch(log, /Only bwb checks/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
