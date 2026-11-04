import test from "node:test";
import assert from "node:assert/strict";

test("landing release cards select the full source-surface regression set", () => {
  const scope = classifyReleaseScope(["client/src/components/recent-platform-updates.tsx"]);
  assert.deepEqual(scope.unknown, []);
  for (const path of ["tests/release-source-surfaces.test.ts", "tests/prepublish-surface-sync.test.ts",
    "tests/release-landing-surface.test.ts", "tests/release-static-metadata.test.ts"]) {
    assert.ok(scope.tests.includes(path), `missing release regression: ${path}`);
  }
});
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyReleaseScope, digestReleaseInputs, releaseInputPaths, sameReleaseMembership, runBoundedReleaseCommand } from "../../scripts/lib/targeted-release-check";
import { buildDataPolicy } from "../../scripts/lib/build-data-policy";

test("current sensitive changes select explicit boundaries and regressions", () => {
  const scope = classifyReleaseScope(["server/auth.ts", "server/tools/lib/safe-fetch.ts", "server/job-worker.ts"]);
  assert.deepEqual(scope.unknown, []);
  assert.ok(scope.areas.includes("auth"));
  assert.ok(scope.areas.includes("network"));
  assert.ok(scope.areas.includes("audit"));
  assert.ok(scope.tests.includes("tests/security/tenant-auth-revocation.test.ts"));
  assert.ok(scope.tests.includes("tests/security/tool-fetch-dns-pinning.test.ts"));
});

test("PDF ownership changes select document boundary regressions", () => {
  const scope = classifyReleaseScope(["server/lib/pdf-input-ownership.ts", "server/pdf-create.ts", "server/tools/domains/documents/handlers.ts"]);
  assert.deepEqual(scope.unknown, []);
  assert.ok(scope.areas.includes("documents"));
  assert.ok(scope.tests.includes("tests/security/pdf-input-ownership.test.ts"));
});

test("payment and plan ownership changes select their actual boundary regressions", () => {
  const scope = classifyReleaseScope(["server/webhookHandlers.ts", "server/lib/mission-stripe-association.ts", "server/ceo-orchestrator.ts"]);
  assert.deepEqual(scope.unknown, []);
  assert.ok(scope.tests.includes("tests/security/mission-stripe-association.test.ts"));
  assert.ok(scope.tests.includes("tests/security/release-plan-access.test.ts"));
  const runner = readFileSync("scripts/targeted-release-check.ts", "utf8");
  assert.match(runner, /scope\.areas\.includes\("payments"\)/);
  assert.match(runner, /tests\/integration\/mission-golden-path\.test\.ts/);
});

test("unknown production and configuration changes never default to reviewed", () => {
  const scope = classifyReleaseScope(["server/routes/new-payment.ts", "data/new-runtime-flag.json", "scripts/unreviewed.ts", ".replit"]);
  assert.equal(scope.unknown.length, 4);
});

test("known problem regressions run even when only public copy changed", () => {
  const scope = classifyReleaseScope(["client/src/pages/landing.tsx"]);
  assert.ok(scope.tests.includes("tests/security/tenant-audit-blockers.test.ts"));
  assert.ok(scope.tests.includes("tests/security/republish-tenant-query-boundaries.test.ts"));
  assert.ok(scope.areas.includes("public-interface"));
});

test("progress reports and research are distinct from runtime changes", () => {
  const scope = classifyReleaseScope(["data/tenant-isolation-audit/checkpoint.json", ".agents/memory/akv-cache-engineering-verdict.md", "docs/targeted-release-checks.md"]);
  assert.equal(scope.informational.length, 3);
  assert.deepEqual(scope.unknown, []);
  assert.ok(scope.tests.length > 0);
});

test("path confusion, arbitrary tests and unrecognized executable surfaces block", () => {
  const scope = classifyReleaseScope(["../server/auth.ts", "/server/auth.ts", "server\\auth.ts", "tests/run-paid-job.test.ts", ".agents/skills/unreviewed/SKILL.md", "docs/run.sh", "server/auth.ts/extra"]);
  assert.equal(scope.unknown.length, 7);
});

test("selection is deduplicated and deterministic", () => {
  assert.deepEqual(classifyReleaseScope(["server/auth.ts", "server/auth.ts"]), classifyReleaseScope(["server/auth.ts"]));
});

test("source identity is ordered by path and binds exact bytes and deletions", () => {
  const a = [{ path: "server/a.ts", content: "a" }, { path: "server/b.ts", content: "b" }];
  assert.equal(digestReleaseInputs(a), digestReleaseInputs([...a].reverse()));
  assert.notEqual(digestReleaseInputs(a), digestReleaseInputs([{ path: "server/a.ts", content: "a " }, a[1]]));
  assert.notEqual(digestReleaseInputs(a), digestReleaseInputs([{ path: "server/a.ts", content: null }, a[1]]));
  assert.notEqual(digestReleaseInputs([{ path: "a", content: "bc" }]), digestReleaseInputs([{ path: "ab", content: "c" }]));
});

test("release metadata imported by the UI is hashed even when unchanged in the diff", () => {
  const paths = releaseInputPaths(["server/auth.ts", "docs/release-facts.json", "docs/release-facts-input.json", "data/tenant-isolation-audit/checkpoint.json"], []);
  assert.ok(paths.includes("docs/release-facts.json"));
  assert.ok(paths.includes("docs/release-facts-input.json"));
  assert.ok(!paths.includes("data/tenant-isolation-audit/checkpoint.json"));
  const before = paths.map(path => ({ path, content: path.includes("release-facts") ? "old" : "same" }));
  const after = before.map(item => item.path === "docs/release-facts.json" ? { ...item, content: "new" } : item);
  assert.notEqual(digestReleaseInputs(before), digestReleaseInputs(after));
  assert.ok(classifyReleaseScope(["docs/release-facts.json"]).areas.includes("public-interface"));
});

test("reviewed release documents select surface tests and bind exact bytes, including new files", () => {
  const docs = ["README.md", "README.md", "ROADMAP.md", "replit.md",
    "docs/CURRENT_PLATFORM_TOTALS.md", "docs/platform-update-2026-11-04.md"];
  const paths = releaseInputPaths(docs.slice(0, -1), [docs.at(-1)!]);
  for (const path of docs) {
    assert.ok(paths.includes(path), `unbound document: ${path}`);
    const scope = classifyReleaseScope([path]);
    assert.ok(scope.areas.includes("public-interface"));
    assert.ok(scope.tests.includes("tests/release-source-surfaces.test.ts"));
    const before = paths.map(path => ({ path, content: "original" }));
    const after = before.map(item => item.path === path ? { ...item, content: "edited" } : item);
    assert.notEqual(digestReleaseInputs(before), digestReleaseInputs(after), path);
  }
});

test("mutable audit reports are not build inputs, but audit implementation remains bound", () => {
  const evidence = ["data/tenant-isolation-audit/degraded-latest.json",
    "docs/tenant-isolation-audit-report-degraded.md"];
  const source = ["scripts/verify-republish-readiness.ts", "server/lib/tenant-audit-job-state.ts"];
  const paths = releaseInputPaths([...evidence, ...source], evidence);
  for (const path of evidence) assert.ok(!paths.includes(path));
  for (const path of source) assert.ok(paths.includes(path));
});

test("changed membership catches new, removed and unclassified paths", () => {
  assert.equal(sameReleaseMembership(["server/auth.ts"], ["server/auth.ts", "new.config"]), false);
  assert.equal(sameReleaseMembership(["server/auth.ts", "new.config"], ["server/auth.ts"]), false);
  assert.equal(sameReleaseMembership(["b", "a"], ["a", "b"]), true);
});

test("noisy checks stop at the byte cap and cannot pass", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-log-limit-"));
  try {
    const logFile = join(dir, "noisy.log");
    const result = await runBoundedReleaseCommand(process.execPath, [
      "-e", "process.stdout.write('x'.repeat(100000));",
    ], { logFile, timeoutMs: 5000, maxLogBytes: 1024 });
    assert.equal(result.passed, false);
    assert.equal(result.outputLimitExceeded, true);
    assert.ok(readFileSync(logFile).length <= 1024);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("check builds neither export database records nor preserve old snapshots", () => {
  for (const skipSync of [false, true]) {
    assert.deepEqual(buildDataPolicy(true, skipSync), { syncDevData: false, preserveDevSnapshot: false });
  }
  assert.equal(buildDataPolicy(false, false).syncDevData, true);
  const build = readFileSync("scripts/build.ts", "utf8");
  const runner = readFileSync("scripts/targeted-release-check.ts", "utf8");
  assert.match(build, /process\.argv\.includes\("--release-check"\)/);
  assert.match(build, /if \(!dataPolicy\.syncDevData\)/);
  assert.match(build, /dataPolicy\.preserveDevSnapshot\s*\?\s*await readFile/);
  assert.match(runner, /\["run", "build", "--", "--release-check"\]/);
  assert.match(runner, /BLOCKED_SENSITIVE_BUILD_SNAPSHOT/);
});

test("bounded checks report actual exit codes, not process launch success", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-command-"));
  try {
    const good = await runBoundedReleaseCommand(process.execPath, ["-e", "process.exit(0)"], { logFile: join(dir, "ok.log"), timeoutMs: 2000 });
    const bad = await runBoundedReleaseCommand(process.execPath, ["-e", "process.exit(7)"], { logFile: join(dir, "bad.log"), timeoutMs: 2000 });
    assert.equal(good.passed, true);
    assert.equal(bad.passed, false);
    assert.equal(bad.code, 7);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("hung checks are killed at a wall-clock deadline and never pass", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-deadline-"));
  try {
    const result = await runBoundedReleaseCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { logFile: join(dir, "hung.log"), timeoutMs: 200 });
    assert.equal(result.timedOut, true);
    assert.equal(result.passed, false);
    assert.ok(result.elapsedMs < 3000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("missing executables fail without hanging or producing a pass", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-spawn-"));
  try {
    const result = await runBoundedReleaseCommand("/nonexistent/release-check-command", [], { logFile: join(dir, "missing.log"), timeoutMs: 1000 });
    assert.equal(result.passed, false);
    assert.equal(result.code, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
