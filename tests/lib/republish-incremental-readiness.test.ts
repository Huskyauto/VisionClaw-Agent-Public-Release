import test from "node:test";
import assert from "node:assert/strict";
import { validateIncrementalReview } from "../../scripts/lib/republish-incremental-readiness";
import { findingKey } from "../../scripts/lib/republish-incremental-readiness";
import { incrementalSourceDigest } from "../../scripts/lib/republish-incremental-readiness";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { sanitizeSpawnEnv } from "../../server/safety/spawn-env-guard";

test("incremental readiness rejects proposed adjudication and incomplete independent review", () => {
  assert.throws(() => validateIncrementalReview({
    receipt: { status: "PROPOSED_ADJUDICATION_INDEPENDENT_REVIEW_PENDING" },
    report: {}, closure: {}, currentSource: "source", baselineHash: "baseline",
    reportHash: "report", closureHash: "closure", releaseHash: "release", release: {},
  }), /independent review/);
});

function fixture(): any {
  const hash = "a".repeat(64);
  const original = { file: "server/example.ts", line: 1, severity: "HIGH", issue: "ownership", disposition: "kept" };
  return {
    currentSource: hash, baselineHash: hash, reportHash: hash, closureHash: hash, releaseHash: hash,
    report: { evidenceHash: hash, severeDispositions: [original] },
    closure: { baseline: { evidenceHash: hash, reportSha256: hash },
      resolutions: [{ original, proposedResolution: "fixed", rationale: "Ownership is checked before mutation." }] },
    release: { status: "AUTOMATED_CHECKS_PASSED_REVIEW_REQUIRED", sourceStable: true,
      scopeMembershipStable: true, source: { digest: hash }, checks: [
        "regressions", "typecheck", "surface-preflight", "domain-preflight", "build",
        "portable-install", "publish-typecheck",
      ].map(name => ({ name, passed: true })) },
    receipt: { version: 1, status: "APPROVED", reviewer: "independent-reviewer",
      policyApproval: "owner-approved-baseline-plus-independent-review",
      currentSource: hash, baselineHash: hash, reportHash: hash, closureHash: hash, releaseHash: hash,
      unresolved: [], reviewedResolutions: [{ key: findingKey(original), resolution: "fixed", verdict: "ACCEPTED" }],
      supplementalChecks: [{ command: "node --test gate.test.ts", passed: true, logSha256: hash }] },
  };
}

test("an exact independently accepted baseline and complete finding partition is admissible", () => {
  assert.doesNotThrow(() => validateIncrementalReview(fixture()));
});

test("the release report source digest must be present and exactly match the accepted current source", () => {
  for (const mutate of [
    (i: any) => { delete i.release.source; },
    (i: any) => { i.release.source.digest = "b".repeat(64); },
    (i: any) => { i.release.source.digest = "not-a-digest"; },
  ]) {
    const i = fixture();
    mutate(i);
    assert.throws(() => validateIncrementalReview(i), /release.*source|source.*release/i);
  }
});

for (const field of ["currentSource", "baselineHash", "reportHash", "closureHash", "releaseHash"]) {
  test(`rejects changed ${field} rather than reusing old clearance`, () => {
    const i = fixture();
    i[field] = "b".repeat(64);
    assert.throws(() => validateIncrementalReview(i), /stale/);
  });
}

test("every finding needs a unique exact acceptance, including deferred real risks", () => {
  for (const mutate of [
    (i: any) => i.receipt.reviewedResolutions.pop(),
    (i: any) => i.receipt.reviewedResolutions.push(i.receipt.reviewedResolutions[0]),
    (i: any) => i.receipt.reviewedResolutions[0].resolution = "false_positive",
    (i: any) => i.closure.resolutions[0].proposedResolution = "deferred",
    (i: any) => i.closure.resolutions.push(i.closure.resolutions[0]),
    (i: any) => i.receipt.unresolved.push("unreviewed caller"),
  ]) {
    const i = fixture(); mutate(i);
    assert.throws(() => validateIncrementalReview(i));
  }
  const i = fixture();
  i.report.severeDispositions[0].disposition = "deferred-real-risk";
  assert.doesNotThrow(() => validateIncrementalReview(i));
});

test("failed, absent or unstable automated checks never count as verification", () => {
  for (const mutate of [
    (i: any) => i.release.checks[0].passed = false,
    (i: any) => i.release.checks = [],
    (i: any) => i.release.checks = [{ name: "build", passed: true }],
    (i: any) => i.release.checks = i.release.checks.filter((c: any) => c.name !== "portable-install"),
    (i: any) => i.release.checks = i.release.checks.filter((c: any) => c.name !== "publish-typecheck"),
    (i: any) => i.release.checks.push({ name: "portable-install", passed: true }),
    (i: any) => i.release.sourceStable = false,
    (i: any) => i.release.scopeMembershipStable = false,
    (i: any) => i.receipt.supplementalChecks = [],
    (i: any) => i.receipt.supplementalChecks[0].passed = false,
    (i: any) => i.report.evidenceHash = "b".repeat(64),
  ]) {
    const i = fixture(); mutate(i);
    assert.throws(() => validateIncrementalReview(i));
  }
});

test("filesystem identity rejects deployment, migration, asset and CI edits, additions and deletions", () => {
  const root = mkdtempSync(join(tmpdir(), "incremental-readiness-"));
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: root, env: sanitizeSpawnEnv(process.env), stdio: "pipe", timeout: 10_000,
  });
  const paths = ["Dockerfile", ".dockerignore", ".npmrc", "drizzle.config.ts",
    "migrations/0001.sql", "public/widget.js", ".github/workflows/ci.yml"];
  try {
    git("init", "--quiet");
    for (const file of paths) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), "original");
    }
    git("add", "--all");
    const digest = incrementalSourceDigest(root);
    for (const file of paths) {
      writeFileSync(join(root, file), "changed");
      assert.notEqual(incrementalSourceDigest(root), digest, `${file} modification`);
      unlinkSync(join(root, file));
      assert.notEqual(incrementalSourceDigest(root), digest, `${file} deletion`);
      writeFileSync(join(root, file), "original");
    }
    writeFileSync(join(root, "public/new.js"), "new member");
    assert.notEqual(incrementalSourceDigest(root), digest, "untracked addition");
    unlinkSync(join(root, "public/new.js"));
    assert.equal(incrementalSourceDigest(root), digest);
    unlinkSync(join(root, "Dockerfile"));
    symlinkSync("public/widget.js", join(root, "Dockerfile"));
    assert.throws(() => incrementalSourceDigest(root), /unsafe release input/);
    unlinkSync(join(root, "Dockerfile"));
    symlinkSync("missing-file", join(root, "Dockerfile"));
    assert.throws(() => incrementalSourceDigest(root), /unsafe release input/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
