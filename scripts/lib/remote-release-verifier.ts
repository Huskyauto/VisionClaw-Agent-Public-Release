import {
  REMOTE_RELEASE_BRANCH,
  REMOTE_RELEASE_REPO,
  REMOTE_RELEASE_WORKFLOW,
  type ExpectedRemoteRun,
  type RemoteCheckReceipt,
  type RemoteReleasePlan,
  type TrustedRemoteRun,
} from "./remote-release-contract";
import { createRemoteReleasePlan } from "./remote-release-plan";

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ELAPSED_MS = 12 * 60 * 1000;

function fail(message: string): never {
  throw new Error(`remote release evidence rejected: ${message}`);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function normalizedTests(tests: unknown): string[] {
  if (!Array.isArray(tests) || tests.some(test => typeof test !== "string" || !test.length))
    fail("test membership is malformed");
  const normalized = tests.map((test: string) => {
    if (test.startsWith("/") || test.includes("\\") || /[\u0000-\u001f\u007f]/.test(test))
      fail("test membership contains an unsafe path");
    const parts = test.split("/");
    if (parts.some(part => !part || part === "." || part === "..")) fail("test membership is not normalized");
    return parts.join("/");
  });
  if (new Set(normalized).size !== normalized.length) fail("test membership contains duplicates");
  return normalized;
}

function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

/**
 * Verifies receipts against caller-fetched authenticated GitHub run/artifact
 * metadata. This function is intentionally pure; artifact claims alone are not
 * trusted metadata and must never be passed as `trusted`.
 */
export function validateRemoteReleaseEvidence(
  plan: RemoteReleasePlan,
  receipts: RemoteCheckReceipt[],
  trusted: TrustedRemoteRun,
  expected: ExpectedRemoteRun,
): RemoteCheckReceipt[] {
  if (!plan || plan.version !== 1 || !Array.isArray(plan.changed) ||
      !Array.isArray(plan.checks) || !Array.isArray(receipts))
    fail("plan or receipt set is malformed");

  const recomputed = createRemoteReleasePlan({
    base: plan.base,
    head: plan.head,
    sourceDigest: plan.sourceDigest,
    changed: plan.changed,
  });
  if (!same(plan, recomputed)) fail("plan does not match recomputed changed-path scope");
  if (plan.repository !== REMOTE_RELEASE_REPO || !SHA256.test(plan.sourceDigest) ||
      !/^[a-f0-9]{40}$/.test(plan.head))
    fail("plan identity or source digest is invalid");

  if (trusted.repository !== REMOTE_RELEASE_REPO ||
      trusted.repositoryId !== expected.repositoryId ||
      trusted.workflowId !== expected.workflowId ||
      trusted.workflowPath !== REMOTE_RELEASE_WORKFLOW ||
      trusted.branch !== expected.branch ||
      !REMOTE_RELEASE_BRANCH.test(trusted.branch) ||
      trusted.runId !== expected.runId || trusted.runAttempt !== expected.runAttempt ||
      trusted.head !== plan.head)
    fail("authenticated run identity does not match the expected candidate");
  if (!positiveInteger(expected.repositoryId) || !positiveInteger(expected.workflowId) ||
      !positiveInteger(expected.runId) || !positiveInteger(expected.runAttempt))
    fail("expected run identity is invalid");
  if (trusted.event !== "workflow_dispatch" || trusted.status !== "completed" ||
      trusted.conclusion !== "success")
    fail("workflow run did not complete successfully via manual dispatch");

  const artifact = trusted.artifact;
  if (!artifact || !positiveInteger(artifact.id) || artifact.expired !== false ||
      artifact.runId !== expected.runId ||
      artifact.name !== `remote-release-${expected.runId}-${expected.runAttempt}`)
    fail("artifact is missing, expired, misnamed, or not associated with this run");

  const checkIds = plan.checks.map(check => check.id);
  if (checkIds.some(id => typeof id !== "string" || !id) ||
      new Set(checkIds).size !== checkIds.length)
    fail("planned check identifiers are invalid or duplicated");
  if (receipts.length !== plan.checks.length) fail("receipt set is incomplete or has extras");

  const jobs = trusted.jobs;
  if (!Array.isArray(jobs)) fail("authenticated workflow jobs are missing");
  const expectedJobNames = [
    "Remote release plan",
    "Remote release aggregate",
    ...checkIds.map(id => `Remote release / ${id}`),
  ];
  const jobCounts = new Map<string, number>();
  for (const job of jobs) {
    if (!job || typeof job.name !== "string") fail("workflow job metadata is malformed");
    if (!job.name.startsWith("Remote release")) {
      if (job.status === "completed" && job.conclusion === "skipped") continue;
      fail(`unexpected non-release workflow job was not skipped: ${job.name}`);
    }
    jobCounts.set(job.name, (jobCounts.get(job.name) ?? 0) + 1);
    if (job.status !== "completed" || job.conclusion !== "success")
      fail(`workflow job did not succeed: ${job.name}`);
  }
  if (expectedJobNames.some(name => jobCounts.get(name) !== 1) ||
      [...jobCounts.keys()].some(name => !expectedJobNames.includes(name)))
    fail("workflow job names do not exactly match the planned matrix");

  const byId = new Map<string, RemoteCheckReceipt>();
  for (const receipt of receipts) {
    if (!receipt || typeof receipt.checkId !== "string" || byId.has(receipt.checkId))
      fail("receipt check identifiers are missing or duplicated");
    byId.set(receipt.checkId, receipt);
  }
  for (const check of plan.checks) {
    const receipt = byId.get(check.id);
    if (!receipt) fail(`receipt missing for ${check.id}`);
    if (receipt.version !== 1 || receipt.checkId !== check.id ||
        receipt.head !== plan.head || receipt.sourceDigest !== plan.sourceDigest ||
        receipt.runId !== expected.runId || receipt.runAttempt !== expected.runAttempt)
      fail(`receipt identity mismatch for ${check.id}`);
    if (!same(normalizedTests(receipt.tests), normalizedTests(check.tests)))
      fail(`test membership mismatch for ${check.id}`);
    if (receipt.passed !== true || receipt.code !== 0 || receipt.timedOut !== false ||
        receipt.outputLimitExceeded !== false ||
        !Number.isFinite(receipt.elapsedMs) || receipt.elapsedMs <= 0 ||
        receipt.elapsedMs > MAX_ELAPSED_MS || !SHA256.test(receipt.logSha256))
      fail(`check receipt is failed or malformed for ${check.id}`);
  }

  return plan.checks.map(check => byId.get(check.id)!);
}
