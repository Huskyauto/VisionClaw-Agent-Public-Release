import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DATABASE_REGRESSION_TESTS } from "../../scripts/lib/remote-release-contract";
import { releaseInputPaths } from "../../scripts/lib/targeted-release-check";
import { assertExactRemoteReleasePlan, createRemoteReleasePlan } from "../../scripts/lib/remote-release-plan";
import { checkById, childEnvironment, commandFor, matrixOutput } from "../../scripts/remote-release-worker";

const BASE = "1".repeat(40);
const HEAD = "2".repeat(40);
const DIGEST = "a".repeat(64);

test("integration corrections select the upload guard and put insight isolation in the disposable database lane", () => {
  const plan = createRemoteReleasePlan({
    base: BASE, head: HEAD, sourceDigest: DIGEST,
    changed: [
      "tests/security/upload-direct-callsites.test.ts",
      "tests/agentic/rejected-plan-dedup.test.ts",
    ],
  });
  const database = plan.checks.find(check => check.kind === "database-regressions");
  assert.ok(database?.tests.includes("tests/agentic/rejected-plan-dedup.test.ts"));
  const offline = plan.checks.filter(check => check.kind === "regressions").flatMap(check => check.tests);
  assert.ok(offline.includes("tests/security/upload-direct-callsites.test.ts"));
  assert.ok(!offline.includes("tests/agentic/rejected-plan-dedup.test.ts"));
});

test("matrix plan downloads cannot become untracked release source", () => {
  const workflow = readFileSync(".github/workflows/security-checks.yml", "utf8");
  const download = workflow.slice(workflow.indexOf("- name: Download exact remote release plan"),
    workflow.indexOf("- name: Upload lane receipt and bounded log"));
  assert.match(download, /path: \.local\/remote-release\s/);
  assert.match(download, /--plan \.local\/remote-release\/plan\.json/);
  assert.deepEqual(releaseInputPaths(["package.json", ".local/remote-release/plan.json"], []), ["package.json"]);
});

test("remote release plan validates source identities and rejects unclassified paths", () => {
  const valid = { base: BASE, head: HEAD, sourceDigest: DIGEST, changed: ["server/auth.ts"] };
  assert.throws(() => createRemoteReleasePlan({ ...valid, base: "abc" }), /full 40-character/);
  assert.throws(() => createRemoteReleasePlan({ ...valid, sourceDigest: "bad" }), /SHA-256/);
  assert.throws(() => createRemoteReleasePlan({ ...valid, changed: ["server/unmapped.ts"] }), /Unclassified/);
});

test("remote release plan deterministically produces three nonempty sorted regression shards and fixed lanes", () => {
  const input = { base: BASE, head: HEAD, sourceDigest: DIGEST, changed: ["server/auth.ts"] };
  const first = createRemoteReleasePlan(input);
  const second = createRemoteReleasePlan({ ...input, changed: [...input.changed].reverse() });
  assert.deepEqual(first, second);
  assert.deepEqual(first.checks.map(check => check.id), [
    "regressions-1", "regressions-2", "regressions-3",
    "typecheck", "surface-preflight", "domain-preflight", "build",
    "portable-install", "publish-typecheck",
  ]);
  assert.deepEqual(first.checks.slice(-3).map(check => [check.id, check.kind, check.database]), [
    ["build", "build", false],
    ["portable-install", "portable-install", false],
    ["publish-typecheck", "publish-typecheck", false],
  ]);
  for (const shard of first.checks.slice(0, 3)) {
    assert.ok(shard.tests.length > 0);
    assert.deepEqual(shard.tests, [...shard.tests].sort());
  }
  assert.equal(new Set(first.checks.slice(0, 3).flatMap(check => check.tests)).size,
    first.checks.slice(0, 3).reduce((sum, check) => sum + check.tests.length, 0));
  assert.deepEqual(JSON.parse(matrixOutput(first)).include.map((item: any) => item.checkId),
    first.checks.map(check => check.id));
});

test("exact-plan assertion rejects a missing required lane even when the remaining plan is long enough", () => {
  const input = { base: BASE, head: HEAD, sourceDigest: DIGEST, changed: ["server/auth.ts"] };
  const plan = createRemoteReleasePlan(input);
  assert.doesNotThrow(() => assertExactRemoteReleasePlan(plan, input));
  assert.ok(plan.checks.length - 1 >= 7);
  const missingPublishTypecheck = {
    ...plan,
    checks: plan.checks.filter(check => check.id !== "publish-typecheck"),
  };
  assert.throws(
    () => assertExactRemoteReleasePlan(missingPublishTypecheck, input),
    /exact checkout source, diff and required lanes/,
  );
});

test("remote release plan conditionally retains real database integration lanes", () => {
  const plan = createRemoteReleasePlan({
    base: BASE, head: HEAD, sourceDigest: DIGEST,
    changed: ["tests/integration/muse-s2-adapter.test.ts", "server/webhookHandlers.ts"],
  });
  assert.deepEqual(plan.checks.slice(-2).map(check => [check.id, check.database, check.tests]), [
    ["muse-s2-integration", true, ["tests/integration/muse-s2-adapter.test.ts"]],
    ["mission-lifecycle", true, ["tests/integration/mission-golden-path.test.ts"]],
  ]);
  assert.deepEqual(commandFor(plan.checks.at(-1)!), {
    command: process.execPath,
    args: ["--import", "tsx", "--test", "--test-force-exit", "tests/integration/mission-golden-path.test.ts"],
  });
});

test("database-dependent regression files are removed from offline shards and grouped in one DB lane", () => {
  const input = {
    base: BASE, head: HEAD, sourceDigest: DIGEST, changed: [...DATABASE_REGRESSION_TESTS],
  };
  const plan = createRemoteReleasePlan(input);
  const database = plan.checks.find(check => check.id === "database-regressions");
  assert.deepEqual(database, {
    id: "database-regressions", kind: "database-regressions",
    tests: [...DATABASE_REGRESSION_TESTS].sort(), database: true,
  });
  const offlineTests = plan.checks.filter(check => check.kind === "regressions").flatMap(check => check.tests);
  assert.equal(DATABASE_REGRESSION_TESTS.some(test => offlineTests.includes(test)), false);
  assertExactRemoteReleasePlan(plan, input);
});

test("proposal verifier source and its regression test are classified into the required unit matrix", () => {
  const plan = createRemoteReleasePlan({
    base: BASE, head: HEAD, sourceDigest: DIGEST,
    changed: ["server/lib/proposal-verifier-process.ts"],
  });
  const regressionTests = plan.checks.filter(check => check.kind === "regressions").flatMap(check => check.tests);
  assert.ok(regressionTests.includes("tests/lib/proposal-verifier-process.test.ts"));
  assert.ok(regressionTests.includes("tests/security/proposal-verifier-isolation-routing.test.ts"));
});

test("worker exposes only fixed command mappings and does not select caller shell input", () => {
  const plan = createRemoteReleasePlan({
    base: BASE, head: HEAD, sourceDigest: DIGEST, changed: ["server/auth.ts"],
  });
  for (const check of plan.checks) {
    const command = commandFor(check);
    assert.ok(command.command === process.execPath || command.command === "npm");
    assert.ok(!command.args.some(arg => arg.includes("&&") || arg.includes(";")));
  }
  assert.deepEqual(commandFor(plan.checks.find(check => check.id === "build")!), {
    command: process.execPath, args: ["--import", "tsx", "scripts/build.ts", "--release-check"],
  });
  assert.deepEqual(commandFor(plan.checks.find(check => check.id === "portable-install")!), {
    command: process.execPath,
    args: ["--test", "--test-name-pattern=^every locked tarball", "tests/deployment/portable-install.test.cjs"],
  });
  assert.deepEqual(commandFor(plan.checks.find(check => check.id === "publish-typecheck")!), {
    command: process.execPath,
    args: ["node_modules/typescript/bin/tsc", "-p", "tsconfig.publish-preflight.json"],
  });
});

test("database lane has fixed test command, disposable DB setup, and isolated browser cache", () => {
  const plan = createRemoteReleasePlan({
    base: BASE, head: HEAD, sourceDigest: DIGEST, changed: [...DATABASE_REGRESSION_TESTS],
  });
  const check = checkById(plan, "database-regressions");
  assert.deepEqual(commandFor(check), {
    command: process.execPath,
    args: ["--import", "tsx", "--test", "--test-force-exit", "--test-concurrency=1",
      ...[...DATABASE_REGRESSION_TESTS].sort()],
  });
  const home = "/tmp/remote-release-test-home";
  const env = childEnvironment(home, check, {
    PATH: "/usr/bin",
    REMOTE_RELEASE_DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/visionclaw_test",
    GITHUB_TOKEN: "must-not-cross",
  });
  assert.equal(env.HOME, home);
  assert.equal(env.DATABASE_URL, "postgres://postgres:postgres@127.0.0.1:5432/visionclaw_test");
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, "/tmp/visionclaw-release-browser-cache");
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.REMOTE_RELEASE_DATABASE_URL, undefined);
  const offlineRegressionEnv = childEnvironment("/tmp/remote-release-offline-home", plan.checks[0], {
    PATH: "/usr/bin", DATABASE_URL: "must-not-be-used",
  });
  assert.equal(offlineRegressionEnv.HOME, "/tmp/remote-release-offline-home");
  assert.equal(offlineRegressionEnv.DATABASE_URL, "postgresql://offline:offline@127.0.0.1:1/offline?connect_timeout=1");
  assert.equal(offlineRegressionEnv.PLAYWRIGHT_BROWSERS_PATH, "/tmp/visionclaw-release-browser-cache");
  const source = readFileSync("scripts/remote-release-worker.ts", "utf8");
  const seeds = readFileSync("tests/fixtures/seed-test-personas.sql", "utf8");
  const personaFixture = readFileSync("tests/fixtures/seed-ci-persona-docs.ts", "utf8");
  assert.match(source, /command: "npm", args: \["run", "db:push"/);
  assert.match(source, /PGDATABASE: "visionclaw_test"/);
  assert.match(source, /tests\/fixtures\/seed-test-personas\.sql/);
  assert.match(seeds, /\(1,\s+'ci-owner@example\.test'/);
  assert.match(seeds, /\(15,\s+'Harbor'/);
  assert.match(personaFixture, /assert\(\["localhost", "127\.0\.0\.1", "::1", "\[::1\]"\]\.includes\(url\.hostname\)/);
  assert.match(personaFixture, /assert\(\["\/visionclaw_test", "\/ci_repair"\]\.includes\(url\.pathname\)/);
});
