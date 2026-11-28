import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { computeTenantAuditEvidenceHash } from "../../scripts/lib/tenant-audit-evidence-hash";
import { findingKey, incrementalSourceDigest, sha256 } from "../../scripts/lib/republish-incremental-readiness";

const cli = resolve("scripts/verify-republish-readiness.ts");
const baselineReport = "generated-artifacts/republish-audit-baseline/data/tenant-isolation-audit/latest.json";
const checkpoint = "data/tenant-isolation-audit/checkpoint.json";
const liveReport = "data/tenant-isolation-audit/latest.json";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "republish-policy-"));
  const env = { PATH: process.env.PATH, HOME: tmpdir(), NODE_ENV: "test", AUDIT_EVIDENCE_ROOT: root };
  const put = (file: string, value: unknown) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value));
  };
  put(".gitignore", ".local/\ngenerated-artifacts/\ndata/\n");
  put("server/example.ts", "export const checked = true;\n");
  execFileSync("git", ["init", "--quiet"], { cwd: root, env, stdio: "pipe" });
  execFileSync("git", ["add", ".gitignore", "server"], { cwd: root, env, stdio: "pipe" });
  put("generated-artifacts/republish-audit-baseline/server/example.ts", "export const checked = true;\n");
  const original = { file: "server/example.ts", line: 1, severity: "HIGH", issue: "ownership", disposition: "kept" };
  const report = {
    evidenceHash: computeTenantAuditEvidenceHash(join(root, "generated-artifacts/republish-audit-baseline")),
    degraded: false,
    coverage: { scanned: 1, chunksAttempted: 1, chunksSucceeded: 1, chunksFailed: 0,
      chunksPending: 0, filesAudited: 1, sourceChangedDuringRun: false, failures: [], unreadableFiles: [] },
    findings: [original], suppressed: [], severeDispositions: [original],
  };
  put(baselineReport, report);
  put(checkpoint, '{"pending":["preserve this work"]}');
  put(liveReport, { degraded: true, coverage: { chunksPending: 5 } });
  const closure = {
    baseline: { evidenceHash: report.evidenceHash, reportSha256: sha256(readFileSync(join(root, baselineReport))) },
    resolutions: [{ original, proposedResolution: "fixed", rationale: "Owner check precedes mutation." }],
  };
  const dir = ".local/republication-triage/";
  put(dir + "closure.json", closure);
  put(dir + "independent-review.md", "Independent fixture review; not production authorization.\n");
  put(dir + "supplemental.log", "Synthetic gate verification passed.\n");
  const source = incrementalSourceDigest(root);
  const releasePath = ".local/release-checks/run-fixture/report.json";
  put(releasePath, { status: "AUTOMATED_CHECKS_PASSED_REVIEW_REQUIRED", sourceStable: true,
    scopeMembershipStable: true, source: { digest: source }, checks: [
      "regressions", "typecheck", "surface-preflight", "domain-preflight", "build",
      "portable-install", "publish-typecheck",
    ].map(name => ({ name, passed: true })) });
  const receipt = {
    version: 1, status: "APPROVED", policyApproval: "owner-approved-baseline-plus-independent-review",
    reviewer: "independent fixture reviewer", currentSource: source, baselineHash: report.evidenceHash,
    reportHash: sha256(readFileSync(join(root, baselineReport))),
    closureHash: sha256(readFileSync(join(root, dir + "closure.json"))),
    releaseHash: sha256(readFileSync(join(root, releasePath))),
    reviewSha256: sha256(readFileSync(join(root, dir + "independent-review.md"))),
    releaseReportPath: releasePath, unresolved: [],
    reviewedResolutions: [{ key: findingKey(original), resolution: "fixed", verdict: "ACCEPTED" }],
    supplementalChecks: [{ command: "synthetic fixture check", passed: true,
      logPath: dir + "supplemental.log", logSha256: sha256(readFileSync(join(root, dir + "supplemental.log"))) }],
  };
  put(dir + "acceptance.json", receipt);
  return { root, put, receipt, report, env,
    run: (extra: Record<string, string> = {}) => spawnSync(process.execPath, ["--import", "tsx", cli], {
      encoding: "utf8", timeout: 20_000, env: { ...env, ...extra },
    }),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("approved exact-source baseline review preserves a separate unfinished audit without claiming its completion", () => {
  const f = setup();
  try {
    const before = [checkpoint, liveReport].map(file => readFileSync(join(f.root, file)));
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /READY: verified audit baseline/);
    assert.match(result.stdout, /checkpoint preserved.*not completion evidence/);
    assert.match(result.stdout, /no publish authority/);
    [checkpoint, liveReport].forEach((file, i) => assert.deepEqual(readFileSync(join(f.root, file)), before[i]));
  } finally { f.close(); }
});

for (const [name, mutate, error] of [
  ["missing baseline", (f: ReturnType<typeof setup>) => rmSync(join(f.root, baselineReport)),
    /authoritative tenant-isolation report is missing/],
  ["degraded baseline", (f: ReturnType<typeof setup>) => f.put(baselineReport, { ...f.report, degraded: true }),
    /coverage is incomplete/],
  ["incomplete baseline", (f: ReturnType<typeof setup>) => f.put(baselineReport,
    { ...f.report, coverage: { ...f.report.coverage, chunksPending: 1 } }), /coverage is incomplete/],
  ["modified current source", (f: ReturnType<typeof setup>) => f.put("server/example.ts", "export const unchecked = true;\n"),
    /stale or missing currentSource/],
  ["unresolved independent review", (f: ReturnType<typeof setup>) => f.put(".local/republication-triage/acceptance.json",
    { ...f.receipt, unresolved: ["unreviewed boundary"] }), /independent review is missing, incomplete or unresolved/],
  ["malformed acceptance", (f: ReturnType<typeof setup>) => f.put(".local/republication-triage/acceptance.json", "{invalid"),
    /baseline-plus-review rejected/],
  ["changed supplemental evidence", (f: ReturnType<typeof setup>) => f.put(".local/republication-triage/supplemental.log", "changed"),
    /supplemental verification log changed/],
] as const) {
  test(`baseline policy fails closed for ${name} instead of accepting the separate partial audit`, () => {
    const f = setup();
    try {
      mutate(f);
      const result = f.run();
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, error);
      assert.doesNotMatch(result.stdout, /READY:/);
      assert.equal(readFileSync(join(f.root, checkpoint), "utf8"), '{"pending":["preserve this work"]}');
    } finally { f.close(); }
  });
}

test("a report override cannot substitute different evidence into baseline policy", () => {
  const f = setup();
  try {
    const result = f.run({ AUDIT_REPORT_JSON: join(f.root, liveReport) });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /preserved baseline report, not an override/);
  } finally { f.close(); }
});

test("without independent acceptance, full-audit mode still rejects an unfinished checkpoint", () => {
  const f = setup();
  try {
    rmSync(join(f.root, ".local/republication-triage/acceptance.json"));
    f.put(liveReport, { ...f.report, findings: [], severeDispositions: [] });
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /checkpoint still exists/);
  } finally { f.close(); }
});

test("full-audit mode still accepts completed current evidence without a checkpoint", () => {
  const f = setup();
  try {
    rmSync(join(f.root, ".local/republication-triage/acceptance.json"));
    rmSync(join(f.root, checkpoint));
    f.put(liveReport, { ...f.report, evidenceHash: computeTenantAuditEvidenceHash(f.root),
      findings: [], severeDispositions: [] });
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /zero unresolved severe findings/);
  } finally { f.close(); }
});
