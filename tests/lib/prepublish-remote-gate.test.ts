import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  REMOTE_RELEASE_REPO,
  REMOTE_RELEASE_WORKFLOW,
  type RemoteCheckReceipt,
  type RemoteReleasePlan,
  type TrustedRemoteRun,
} from "../../scripts/lib/remote-release-contract";
import { createRemoteReleasePlan } from "../../scripts/lib/remote-release-plan";
import { hashBytes } from "../../scripts/lib/remote-release-evidence";
import { runPrepublishRemoteGate } from "../../scripts/lib/prepublish-remote-gate";

const digest = "a".repeat(64);
const head = "b".repeat(40);
const base = "c".repeat(40);
const repoId = 1101;
const workflowId = 2202;
const runId = 3303;
const runAttempt = 1;
const branch = `release-checks/${digest}`;

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "prepublish-remote-gate-"));
  const stateDir = path.join(root, ".local", "remote-release");
  const reportDir = path.join(root, ".local", "release-checks", "run-abc123");
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  mkdirSync(reportDir, { recursive: true, mode: 0o700 });
  const statePath = path.join(stateDir, `state-${digest}.json`);
  const reportPath = path.join(reportDir, "report.json");
  const plan = createRemoteReleasePlan({
    base, head, sourceDigest: digest, changed: ["scripts/lib/targeted-release-check.ts"],
  });
  const trusted: TrustedRemoteRun = {
    repository: REMOTE_RELEASE_REPO,
    repositoryId: repoId,
    workflowId,
    workflowPath: REMOTE_RELEASE_WORKFLOW,
    head,
    branch,
    runId,
    runAttempt,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    jobs: [
      { name: "Remote release plan", status: "completed", conclusion: "success" },
      { name: "Remote release aggregate", status: "completed", conclusion: "success" },
      ...plan.checks.map(check => ({
        name: `Remote release / ${check.id}`, status: "completed", conclusion: "success",
      })),
    ],
    artifact: {
      id: 4404, name: `remote-release-${runId}-${runAttempt}`, runId, expired: false,
    },
  };
  const receipts: RemoteCheckReceipt[] = plan.checks.map(check => ({
    version: 1, checkId: check.id, head, sourceDigest: digest, runId, runAttempt,
    tests: [...check.tests], passed: true, code: 0, timedOut: false,
    outputLimitExceeded: false, elapsedMs: 40, logSha256: hashBytes(`log:${check.id}`),
  }));
  const checks = [
    {
      name: "regressions", passed: true, code: 0, timedOut: false, outputLimitExceeded: false,
      elapsedMs: 40, remoteLanes: plan.checks.filter(c => c.kind === "regressions").map(c => c.id),
    },
    ...plan.checks.filter(c => c.kind !== "regressions").map(c => ({
      name: c.id, passed: true, code: 0, timedOut: false, outputLimitExceeded: false, elapsedMs: 40,
    })),
  ];
  const report = {
    version: 1,
    status: "AUTOMATED_CHECKS_PASSED_REVIEW_REQUIRED",
    base,
    source: { digest, count: 1 },
    changed: plan.changed,
    scopeMembershipStable: true,
    sourceStable: true,
    checks,
    remote: { trusted, artifactSha256: "d".repeat(64), url: "https://github.com/run" },
  };
  const state = {
    version: 1, phase: "waiting", sourceDigest: digest, createdAt: "2026-01-01T00:00:00Z",
    branch, head, base, repositoryId: repoId, workflowId, plan, runId, runAttempt,
    reportPath: path.relative(root, reportPath),
  };
  const writeVerified = (changes: {
    state?: Record<string, unknown>;
    report?: Record<string, any>;
    receipts?: RemoteCheckReceipt[];
  } = {}) => {
    const nextState = { ...state, phase: "verified", ...changes.state };
    const nextReport = { ...report, ...changes.report };
    writeFileSync(statePath, JSON.stringify(nextState), { mode: 0o600 });
    writeFileSync(reportPath, JSON.stringify(nextReport), { mode: 0o600 });
    for (const receipt of changes.receipts ?? receipts) {
      writeFileSync(path.join(reportDir, `${receipt.checkId}.json`), JSON.stringify(receipt), { mode: 0o600 });
      writeFileSync(path.join(reportDir, `${receipt.checkId}.log`), `log:${receipt.checkId}`, { mode: 0o600 });
    }
  };
  writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  return { root, stateDir, reportDir, statePath, reportPath, plan, trusted, receipts, report, state, checks, writeVerified };
}

function withFixture(run: (f: ReturnType<typeof fixture>) => Promise<void>) {
  return async () => {
    const f = fixture();
    try { await run(f); } finally { rmSync(f.root, { recursive: true, force: true }); }
  };
}

function options(f: ReturnType<typeof fixture>, overrides: Record<string, unknown> = {}) {
  return {
    root: f.root,
    env: { PATH: "/usr/bin", HOME: "/tmp/no-auth-home", LANG: "C",
      DATABASE_URL: "postgres://local-only:secret@127.0.0.1/test", NODE_OPTIONS: "--bad",
      OPENAI_API_KEY: "must-stay-out-of-catalog-child", GITHUB_TOKEN: "must-stay-out-of-verifier",
      REPLIT_CONNECTORS_GITHUB_TOKEN: "must-stay-out-of-verifier" },
    readCandidate: () => ({ sourceDigest: digest, files: [{ path: "package.json" }] }),
    collectRemote: async () => { f.writeVerified(); },
    runReadiness: async () => ({
      passed: true, proof: true, code: 0, timedOut: false, outputLimitExceeded: false,
      elapsedMs: 17, logSha256: "f".repeat(64),
    }),
    runCatalog: async () => ({
      passed: true, code: 0, timedOut: false, outputLimitExceeded: false,
      elapsedMs: 17, logSha256: "e".repeat(64),
    }),
    ...overrides,
  };
}

test("collects exact current-candidate evidence, then runs only bounded local catalog and returns a secret-free receipt",
  withFixture(async f => {
    let collectArgs: string[] | undefined, readinessContext: any;
    let catalogContext: any;
    const order: string[] = [];
    const gateOptions = options(f, {
      collectRemote: async (args: string[]) => { order.push("remote"); collectArgs = args; f.writeVerified(); },
      runReadiness: async (context: any) => {
        order.push("readiness");
        readinessContext = context;
        return { passed: true, proof: true, code: 0, timedOut: false, outputLimitExceeded: false,
          elapsedMs: 17, logSha256: "f".repeat(64) };
      },
      runCatalog: async (context: any) => {
        order.push("catalog");
        catalogContext = context;
        return { passed: true, code: 0, timedOut: false, outputLimitExceeded: false,
          elapsedMs: 17, logSha256: "e".repeat(64) };
      },
    });
    const receipt = await runPrepublishRemoteGate(gateOptions as any);
    assert.deepEqual(collectArgs, ["collect", "--state", f.statePath]);
    assert.deepEqual(order, ["remote", "readiness", "catalog"]);
    assert.equal(readinessContext.timeoutMs, 30_000);
    assert.equal(readinessContext.maxLogBytes, 1024 * 1024);
    assert.equal(readinessContext.env.AUDIT_EVIDENCE_ROOT, f.root);
    assert.equal(readinessContext.env.DATABASE_URL, undefined);
    assert.equal(readinessContext.env.OPENAI_API_KEY, undefined);
    assert.equal(readinessContext.env.GITHUB_TOKEN, undefined);
    assert.equal(readinessContext.env.REPLIT_CONNECTORS_GITHUB_TOKEN, undefined);
    assert.equal(readinessContext.env.NODE_OPTIONS, undefined);
    assert.deepEqual(Object.keys(readinessContext.env).sort(),
      ["AUDIT_EVIDENCE_ROOT", "HOME", "LANG", "PATH"].sort());
    assert.equal(catalogContext.timeoutMs, 20_000);
    assert.equal(catalogContext.maxLogBytes, 1024 * 1024);
    assert.equal(catalogContext.env.DATABASE_URL, "postgres://local-only:secret@127.0.0.1/test");
    assert.equal(catalogContext.env.NODE_OPTIONS, undefined);
    assert.equal(catalogContext.env.OPENAI_API_KEY, undefined);
    assert.equal(JSON.stringify(receipt).includes("local-only"), false);
    assert.equal(receipt.status, "READY");
    assert.equal(receipt.sourceDigest, digest);
    assert.equal(receipt.reportSha256, hashBytes(readFileSync(f.reportPath)));
    assert.equal(receipt.remote.runId, runId);
    assert.deepEqual(receipt.auditReadiness, {
      passed: true,
      command: "node --import tsx scripts/verify-republish-readiness.ts",
      elapsedMs: 17,
      logSha256: "f".repeat(64),
    });
  }));

test("stale, missing or failed audit-baseline readiness blocks local catalog and READY", withFixture(async f => {
  const cases = [
    { label: "stale", result: { passed: false, proof: false, code: 1 } },
    { label: "missing", result: { passed: false, proof: false, code: 1 } },
    { label: "failed", result: { passed: false, proof: false, code: 0 } },
  ];
  for (const item of cases) {
    let catalogued = false;
    const deps = options(f, {
      runReadiness: async () => ({
        ...item.result, timedOut: false, outputLimitExceeded: false, elapsedMs: 2,
        logSha256: "f".repeat(64),
      }),
      runCatalog: async () => {
        catalogued = true;
        return { passed: true, code: 0, timedOut: false, outputLimitExceeded: false,
          elapsedMs: 2, logSha256: "e".repeat(64) };
      },
    });
    await assert.rejects(runPrepublishRemoteGate(deps as any), /audit-baseline readiness check failed/i, item.label);
    assert.equal(catalogued, false, `${item.label} readiness must block the DB catalog`);
  }
}));

test("rejects setup proof, stale/foreign explicit state paths, and missing state without collecting", withFixture(async f => {
  f.writeVerified({ state: { purpose: "setup-proof-not-release-clearance" } });
  let collected = false, catalogued = false;
  const deps = options(f, {
    collectRemote: async () => { collected = true; },
    runCatalog: async () => { catalogued = true; return {}; },
  });
  await assert.rejects(runPrepublishRemoteGate(deps as any), /setup|purpose/i);
  await assert.rejects(runPrepublishRemoteGate({ ...deps, statePath: path.join(f.stateDir, "state-other.json") } as any), /state path/i);
  await assert.rejects(runPrepublishRemoteGate({ ...deps, statePath: path.join(f.stateDir, "setup-proof.json") } as any), /state path/i);
  assert.equal(collected, false);
  assert.equal(catalogued, false);
  unlinkSync(f.statePath);
  await assert.rejects(runPrepublishRemoteGate(deps as any), /no current-candidate remote state.*upload.*dispatch/i);
  assert.equal(collected, false);
}));

test("blocks missing required portable-install or publish-typecheck report lanes before local catalog", withFixture(async f => {
  for (const missingName of ["portable-install", "publish-typecheck"]) {
    let catalogued = false;
    const deps = options(f, {
      collectRemote: async () => {
        const reportChecks = f.checks.filter(check => check.name !== missingName);
        f.writeVerified({ report: { checks: reportChecks } });
      },
      runCatalog: async () => { catalogued = true; return {}; },
    });
    await assert.rejects(runPrepublishRemoteGate(deps as any), /check|lane|plan/i);
    assert.equal(catalogued, false);
  }
}));

test("blocks pending or invalid remote collection without invoking the local catalog", withFixture(async f => {
  let catalogued = false;
  const oldExitCode = process.exitCode;
  try {
    process.exitCode = undefined;
    const deps = options(f, {
      collectRemote: async () => { process.exitCode = 2; },
      runCatalog: async () => { catalogued = true; return {}; },
    });
    await assert.rejects(runPrepublishRemoteGate(deps as any), /pending|incomplete|verified/i);
    assert.equal(catalogued, false);
    assert.equal(process.exitCode, undefined);
  } finally { process.exitCode = oldExitCode; }
}));

test("rejects mode-only drift during remote collection before readiness or catalog", withFixture(async f => {
  let reads = 0, readiness = false, catalogued = false;
  const deps = options(f, {
    readCandidate: () => ({
      sourceDigest: digest,
      files: [{ path: "package.json", bytes: Buffer.from("same bytes"), mode: ++reads === 1 ? "100644" : "100755" }],
    }),
    runReadiness: async () => {
      readiness = true;
      return { passed: true, proof: true, code: 0, timedOut: false, outputLimitExceeded: false,
        elapsedMs: 17, logSha256: "f".repeat(64) };
    },
    runCatalog: async () => { catalogued = true; return {}; },
  });
  await assert.rejects(runPrepublishRemoteGate(deps as any), /source.*mode|mode.*source/i);
  assert.equal(readiness, false);
  assert.equal(catalogued, false);
}));

test("rejects mode-only drift after readiness before starting local catalog", withFixture(async f => {
  let reads = 0, catalogued = false;
  const deps = options(f, {
    readCandidate: () => ({
      sourceDigest: digest,
      files: [{ path: "package.json", bytes: Buffer.from("same bytes"), mode: ++reads >= 3 ? "100755" : "100644" }],
    }),
    runCatalog: async () => {
      catalogued = true;
      return { passed: true, code: 0, timedOut: false, outputLimitExceeded: false,
        elapsedMs: 17, logSha256: "e".repeat(64) };
    },
  });
  await assert.rejects(runPrepublishRemoteGate(deps as any), /source.*mode|mode.*source/i);
  assert.equal(catalogued, false);
}));

test("rejects mode-only drift during local catalog rather than returning READY", withFixture(async f => {
  let reads = 0, catalogued = false;
  const deps = options(f, {
    readCandidate: () => ({
      sourceDigest: digest,
      files: [{ path: "package.json", bytes: Buffer.from("same bytes"), mode: ++reads >= 4 ? "100755" : "100644" }],
    }),
    runCatalog: async () => {
      catalogued = true;
      return { passed: true, code: 0, timedOut: false, outputLimitExceeded: false,
        elapsedMs: 17, logSha256: "e".repeat(64) };
    },
  });
  await assert.rejects(runPrepublishRemoteGate(deps as any), /source.*mode|mode.*source/i);
  assert.equal(catalogued, true);
}));

test("rejects source changes during local catalog rather than returning READY", withFixture(async f => {
  let reads = 0, catalogued = false;
  const deps = options(f, {
    readCandidate: () => ({
      sourceDigest: ++reads >= 4 ? "f".repeat(64) : digest,
      files: [{ path: "package.json" }],
    }),
    runCatalog: async () => {
      catalogued = true;
      return { passed: true, code: 0, timedOut: false, outputLimitExceeded: false,
        elapsedMs: 17, logSha256: "e".repeat(64) };
    },
  });
  await assert.rejects(runPrepublishRemoteGate(deps as any), /source.*changed/i);
  assert.equal(catalogued, true);
}));
