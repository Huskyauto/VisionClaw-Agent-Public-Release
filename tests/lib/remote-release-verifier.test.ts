import test from "node:test";
import assert from "node:assert/strict";
import {
  DATABASE_REGRESSION_TESTS,
  REMOTE_RELEASE_REPO,
  REMOTE_RELEASE_WORKFLOW,
  type ExpectedRemoteRun,
  type RemoteCheckReceipt,
  type RemoteReleasePlan,
  type TrustedRemoteRun,
} from "../../scripts/lib/remote-release-contract";
import { createRemoteReleasePlan } from "../../scripts/lib/remote-release-plan";
import { validateRemoteReleaseEvidence } from "../../scripts/lib/remote-release-verifier";

function fixture(changed = ["scripts/lib/targeted-release-check.ts"]) {
  const expected: ExpectedRemoteRun = {
    repositoryId: 12345, workflowId: 67890, branch: `release-checks/${"a".repeat(12)}`,
    runId: 456, runAttempt: 1,
  };
  const plan = createRemoteReleasePlan({
    base: "1".repeat(40),
    head: "2".repeat(40),
    sourceDigest: "b".repeat(64),
    changed,
  });
  const receipts: RemoteCheckReceipt[] = plan.checks.map(check => ({
    version: 1,
    checkId: check.id,
    head: plan.head,
    sourceDigest: plan.sourceDigest,
    runId: expected.runId,
    runAttempt: expected.runAttempt,
    tests: [...check.tests],
    passed: true,
    code: 0,
    timedOut: false,
    outputLimitExceeded: false,
    elapsedMs: 10,
    logSha256: "c".repeat(64),
  }));
  const trusted: TrustedRemoteRun = {
    repository: REMOTE_RELEASE_REPO,
    repositoryId: expected.repositoryId,
    workflowId: expected.workflowId,
    workflowPath: REMOTE_RELEASE_WORKFLOW,
    head: plan.head,
    branch: expected.branch,
    runId: expected.runId,
    runAttempt: expected.runAttempt,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    jobs: [
      { name: "Remote release plan", status: "completed", conclusion: "success" },
      { name: "Remote release aggregate", status: "completed", conclusion: "success" },
      ...plan.checks.map(check => ({
        name: `Remote release / ${check.id}`, status: "completed", conclusion: "success",
      })),
      { name: "Security boundaries", status: "completed", conclusion: "skipped" },
      { name: "Scraping worker compatibility and security", status: "completed", conclusion: "skipped" },
    ],
    artifact: {
      id: 765, name: `remote-release-${expected.runId}-${expected.runAttempt}`,
      runId: expected.runId, expired: false,
    },
  };
  return { plan, receipts, trusted, expected };
}

test("accepts a complete receipt set bound to the exact trusted run and plan", () => {
  const { plan, receipts, trusted, expected } = fixture();
  assert.deepEqual(validateRemoteReleaseEvidence(plan, receipts, trusted, expected), receipts);
});

test("database regression receipt is required and bound to its exact tests", () => {
  const f = fixture([...DATABASE_REGRESSION_TESTS]);
  const database = f.plan.checks.find(check => check.id === "database-regressions");
  assert.deepEqual(database, {
    id: "database-regressions", kind: "database-regressions",
    tests: [...DATABASE_REGRESSION_TESTS].sort(), database: true,
  });
  assert.deepEqual(validateRemoteReleaseEvidence(f.plan, f.receipts, f.trusted, f.expected), f.receipts);
  f.receipts.find(receipt => receipt.checkId === "database-regressions")!.tests.pop();
  assert.throws(() => validateRemoteReleaseEvidence(f.plan, f.receipts, f.trusted, f.expected));
});

test("rejects forged plan scope instead of trusting caller-supplied required checks", () => {
  for (const mutate of [
    (plan: RemoteReleasePlan) => { plan.checks.pop(); },
    (plan: RemoteReleasePlan) => { plan.changed.push("server/auth.ts"); },
    (plan: RemoteReleasePlan) => { plan.checks[0].tests.pop(); },
  ]) {
    const { plan, receipts, trusted, expected } = fixture();
    mutate(plan);
    assert.throws(() => validateRemoteReleaseEvidence(plan, receipts, trusted, expected));
  }
});

test("rejects trusted metadata that does not match repository, workflow, ref, run, attempt or candidate", () => {
  const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
    f => { f.trusted.repository = "attacker/fork"; },
    f => { f.trusted.repositoryId++; },
    f => { f.trusted.workflowId++; },
    f => { f.trusted.workflowPath = ".github/workflows/other.yml"; },
    f => { f.trusted.branch = "main"; },
    f => { f.expected.branch = "release-checks/short"; },
    f => { f.trusted.runId++; },
    f => { f.trusted.runAttempt++; },
    f => { f.trusted.head = "3".repeat(40); },
    f => { f.trusted.event = "push"; },
    f => { f.trusted.status = "in_progress"; },
    f => { f.trusted.conclusion = "failure"; },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    assert.throws(() => validateRemoteReleaseEvidence(f.plan, f.receipts, f.trusted, f.expected));
  }
});

test("rejects missing, expired, renamed, or cross-run artifacts", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.trusted.artifact.id = 0; },
    (f: ReturnType<typeof fixture>) => { f.trusted.artifact.expired = true; },
    (f: ReturnType<typeof fixture>) => { f.trusted.artifact.name = "remote-release-456-2"; },
    (f: ReturnType<typeof fixture>) => { f.trusted.artifact.runId++; },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => validateRemoteReleaseEvidence(f.plan, f.receipts, f.trusted, f.expected));
  }
});

test("rejects incomplete, duplicate, unexpected, or unsuccessful workflow jobs", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.trusted.jobs.shift(); },
    (f: ReturnType<typeof fixture>) => { f.trusted.jobs.push({ ...f.trusted.jobs[1] }); },
    (f: ReturnType<typeof fixture>) => { f.trusted.jobs[1].name = f.trusted.jobs[0].name; },
    (f: ReturnType<typeof fixture>) => { f.trusted.jobs.push({ name: "Remote release / injected", status: "completed", conclusion: "success" }); },
    (f: ReturnType<typeof fixture>) => { f.trusted.jobs[1].conclusion = "failure"; },
    (f: ReturnType<typeof fixture>) => { f.trusted.jobs.push({ name: "Legacy security", status: "completed", conclusion: "success" }); },
    (f: ReturnType<typeof fixture>) => { f.trusted.jobs[4].status = "in_progress"; },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => validateRemoteReleaseEvidence(f.plan, f.receipts, f.trusted, f.expected));
  }
});

test("rejects partial, duplicate, stale, failed, or malformed check receipts", () => {
  const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
    f => { f.receipts.pop(); },
    f => { f.receipts.push({ ...f.receipts[0] }); },
    f => { f.receipts[1].checkId = f.receipts[0].checkId; },
    f => { f.receipts[0].head = "3".repeat(40); },
    f => { f.receipts[0].sourceDigest = "d".repeat(64); },
    f => { f.receipts[0].runId++; },
    f => { f.receipts[0].runAttempt++; },
    f => { f.receipts[0].passed = false; },
    f => { f.receipts[0].code = 1; },
    f => { f.receipts[0].timedOut = true; },
    f => { f.receipts[0].outputLimitExceeded = true; },
    f => { f.receipts[0].elapsedMs = 0; },
    f => { f.receipts[0].elapsedMs = 12 * 60 * 1000 + 1; },
    f => { f.receipts[0].logSha256 = "not-a-digest"; },
    f => { f.receipts[0].tests.reverse(); },
    f => { f.receipts[0].tests[0] = `./${f.receipts[0].tests[0]}`; },
    f => { f.receipts[0].tests.push(f.receipts[0].tests[0]); },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    assert.throws(() => validateRemoteReleaseEvidence(f.plan, f.receipts, f.trusted, f.expected));
  }
});
