import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { sanitizeSpawnEnv } from "../../server/safety/spawn-env-guard";
import {
  candidateSnapshotIdentity, readCandidate as readCandidateFromDisk,
} from "./remote-release-candidate";
import { createRemoteReleasePlan } from "./remote-release-plan";
import { validateRemoteReleaseEvidence } from "./remote-release-verifier";
import { hashBytes } from "./remote-release-evidence";
import { runBoundedReleaseCommand } from "./targeted-release-check";
import {
  REMOTE_RELEASE_REPO,
  REMOTE_RELEASE_WORKFLOW,
  type RemoteCheckReceipt,
  type RemoteReleasePlan,
  type TrustedRemoteRun,
} from "./remote-release-contract";

const STATE_DIR = ".local/remote-release";
const REPORT_DIR = ".local/release-checks";
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 1024 * 1024;
const MAX_LOG_BYTES = 8 * 1024 * 1024;
const CATALOG_TIMEOUT_MS = 20_000;
const CATALOG_LOG_LIMIT = 1024 * 1024;
const READINESS_TIMEOUT_MS = 30_000;
const READINESS_LOG_LIMIT = 1024 * 1024;
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const READINESS_ENV_KEYS = [
  "PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR",
] as const;

type CandidateSnapshot = ReturnType<typeof readCandidateFromDisk>;
type CatalogResult = {
  passed: boolean;
  code: number | null;
  timedOut: boolean;
  outputLimitExceeded: boolean;
  elapsedMs: number;
  logSha256: string;
};
type CatalogContext = {
  root: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxLogBytes: number;
};
type ReadinessResult = CatalogResult & { proof: boolean; diagnosticsPath?: string };
type ReadinessContext = Omit<CatalogContext, "env"> & { env: NodeJS.ProcessEnv };

export interface PrepublishRemoteGateOptions {
  root?: string;
  statePath?: string;
  env?: NodeJS.ProcessEnv;
  readCandidate?: () => CandidateSnapshot;
  collectRemote: (args: string[]) => Promise<unknown>;
  runCatalog?: (context: CatalogContext) => Promise<CatalogResult>;
  runReadiness?: (context: ReadinessContext) => Promise<ReadinessResult>;
}

function fail(message: string): never {
  throw new Error(`[publish-preflight] BLOCKED: ${message}`);
}

function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function ensureDirectory(root: string, relative: string): string {
  const full = path.resolve(root, relative);
  if (!existsSync(full)) fail(`required operator directory is missing: ${relative}`);
  const stat = lstatSync(full);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(full) !== full)
    fail(`unsafe operator directory: ${relative}`);
  return full;
}

function readRegularFile(file: string, maxBytes: number, label: string): Buffer {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(file) !== file || stat.size > maxBytes)
    fail(`${label} is unsafe or oversized`);
  return readFileSync(file);
}

function parseState(bytes: Buffer): any {
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { fail("operator state is not valid JSON"); }
}

function parseReport(bytes: Buffer): any {
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { fail("remote report is not valid JSON"); }
}

function statePathFor(root: string, digest: string, supplied?: string): string {
  const expected = path.resolve(root, STATE_DIR, `state-${digest}.json`);
  if (supplied !== undefined) {
    const requested = path.resolve(root, supplied);
    if (requested !== expected) fail("explicit state path must be the exact digest-keyed operator state file");
  }
  return expected;
}

function missingState(root: string, file: string): never {
  fail(`no current-candidate remote state exists at ${path.relative(root, file)}. Submit one approved test-branch run with ` +
    "`npm run release:check`, then rerun `npm run publish:preflight` after GitHub finishes; " +
    "this gate never uploads or dispatches automatically");
}

function reportPathFor(root: string, state: any): string {
  const relative = state?.reportPath;
  if (typeof relative !== "string" ||
      !/^\.local\/release-checks\/run-[A-Za-z0-9]+\/report\.json$/.test(relative))
    fail("state does not identify a canonical per-run remote report");
  const full = path.resolve(root, relative);
  const expectedRoot = path.resolve(root, REPORT_DIR) + path.sep;
  if (!full.startsWith(expectedRoot)) fail("remote report escaped the operator report directory");
  return full;
}

function validatePlan(state: any, digest: string): RemoteReleasePlan {
  const plan = state?.plan as RemoteReleasePlan | undefined;
  if (state?.version !== 1 || state?.phase !== "verified" || state?.sourceDigest !== digest ||
      !plan || plan.sourceDigest !== digest || !SHA.test(plan.head) || !SHA.test(plan.base) ||
      state.head !== plan.head || state.base !== plan.base ||
      state.branch !== `release-checks/${digest}`)
    fail("state is not a verified plan for the exact current candidate");
  const rebuilt = createRemoteReleasePlan({
    base: plan.base, head: plan.head, sourceDigest: digest, changed: plan.changed,
  });
  if (!same(plan, rebuilt)) fail("stored remote plan differs from the required current lane matrix");
  if (!Number.isSafeInteger(state.repositoryId) || state.repositoryId <= 0 ||
      !Number.isSafeInteger(state.workflowId) || state.workflowId <= 0 ||
      !Number.isSafeInteger(state.runId) || state.runId <= 0 ||
      !Number.isSafeInteger(state.runAttempt) || state.runAttempt <= 0)
    fail("verified state is missing authenticated repository, workflow, or run identity");
  return plan;
}

function validateReport(
  report: any,
  plan: RemoteReleasePlan,
  state: any,
  candidate: CandidateSnapshot,
  reportDir: string,
): { trusted: TrustedRemoteRun; artifactSha256: string; receipts: RemoteCheckReceipt[] } {
  if (report?.version !== 1 || report?.status !== "AUTOMATED_CHECKS_PASSED_REVIEW_REQUIRED" ||
      report?.sourceStable !== true || report?.scopeMembershipStable !== true ||
      report?.source?.digest !== plan.sourceDigest || report?.source?.count !== candidate.files.length ||
      report?.base !== plan.base || !same(report?.changed, plan.changed))
    fail("remote report is stale, partial, or not bound to the exact plan");

  const remote = report.remote;
  const trusted = remote?.trusted as TrustedRemoteRun | undefined;
  const artifactSha256 = remote?.artifactSha256;
  if (typeof artifactSha256 !== "string" || !SHA256.test(artifactSha256) ||
      !trusted || trusted.repository !== REMOTE_RELEASE_REPO ||
      trusted.repositoryId !== state.repositoryId || trusted.workflowId !== state.workflowId ||
      trusted.workflowPath !== REMOTE_RELEASE_WORKFLOW || trusted.head !== plan.head ||
      trusted.branch !== state.branch || trusted.runId !== state.runId ||
      trusted.runAttempt !== state.runAttempt || trusted.event !== "workflow_dispatch" ||
      trusted.status !== "completed" || trusted.conclusion !== "success" ||
      !Number.isSafeInteger(trusted.artifact?.id) || trusted.artifact?.id <= 0 ||
      trusted.artifact?.name !== `remote-release-${state.runId}-${state.runAttempt}` ||
      trusted.artifact?.runId !== state.runId || trusted.artifact?.expired !== false)
    fail("remote report lacks exact successful authenticated run/artifact identity");

  const regressionChecks = plan.checks.filter(check => check.kind === "regressions");
  const expectedReportNames = [
    "regressions",
    ...plan.checks.filter(check => check.kind !== "regressions").map(check => check.id),
  ];
  const checks = report.checks;
  if (!Array.isArray(checks) || checks.length !== expectedReportNames.length ||
      expectedReportNames.some(name => checks.filter((check: any) => check?.name === name).length !== 1) ||
      checks.some((check: any) => check?.passed !== true))
    fail("remote report is missing, duplicating, or failing a required published-preflight lane");
  const regression = checks.find((check: any) => check.name === "regressions");
  if (!same(regression.remoteLanes, regressionChecks.map(check => check.id)))
    fail("remote report regression lanes do not match the required plan");

  const receipts = plan.checks.map(check => {
    if (!/^[a-z0-9-]+$/.test(check.id)) fail("unsafe planned receipt identifier");
    const receiptPath = path.join(reportDir, `${check.id}.json`);
    const logPath = path.join(reportDir, `${check.id}.log`);
    let receipt: RemoteCheckReceipt;
    try {
      receipt = JSON.parse(readRegularFile(receiptPath, MAX_RECEIPT_BYTES, "remote receipt").toString("utf8"));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("[publish-preflight]")) throw error;
      fail(`remote receipt is missing or invalid for ${check.id}`);
    }
    const logBytes = readRegularFile(logPath, MAX_LOG_BYTES, "remote log");
    if (receipt.logSha256 !== hashBytes(logBytes)) fail(`remote log digest mismatch for ${check.id}`);
    return receipt;
  });
  return { trusted, artifactSha256, receipts };
}

async function runLocalCatalog(context: CatalogContext): Promise<CatalogResult> {
  const localDir = ensureDirectory(context.root, ".local");
  const outputDir = path.join(localDir, "prepublish");
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(outputDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(outputDir) !== outputDir)
    fail("unsafe local prepublish output directory");
  const runDir = mkdtempSync(path.join(outputDir, "run-"));
  let retainFailureLog = false;
  try {
    const logFile = path.join(runDir, "catalog.log");
    const result = await runBoundedReleaseCommand(
      process.execPath,
      ["--import", "tsx", path.resolve(context.root, "scripts/publish-preflight.ts")],
      {
        logFile,
        timeoutMs: context.timeoutMs,
        maxLogBytes: context.maxLogBytes,
        env: context.env,
      },
    );
    const log = readRegularFile(logFile, context.maxLogBytes, "local catalog log");
    if (!result.passed) {
      retainFailureLog = true;
      fail(`local database catalog inspection failed; bounded private diagnostics: ${path.relative(context.root, logFile)}`);
    }
    return { ...result, logSha256: hashBytes(log) };
  } finally {
    if (!retainFailureLog) rmSync(runDir, { recursive: true, force: true });
  }
}

function readinessEnvironment(env: NodeJS.ProcessEnv, root: string): NodeJS.ProcessEnv {
  const allowed = Object.fromEntries(
    READINESS_ENV_KEYS.filter(key => env[key] !== undefined).map(key => [key, env[key]]),
  );
  const child = sanitizeSpawnEnv(allowed);
  child.AUDIT_EVIDENCE_ROOT = root;
  return child;
}

async function runLocalReadiness(context: ReadinessContext): Promise<ReadinessResult> {
  const localDir = ensureDirectory(context.root, ".local");
  const outputDir = path.join(localDir, "prepublish");
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const outputStat = lstatSync(outputDir);
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink() || realpathSync(outputDir) !== outputDir)
    fail("unsafe local prepublish output directory");
  const runDir = mkdtempSync(path.join(outputDir, "run-"));
  const logFile = path.join(runDir, "audit-readiness.log");
  let retainFailureLog = true;
  try {
    const result = await runBoundedReleaseCommand(
      process.execPath,
      ["--import", "tsx", path.resolve(context.root, "scripts/verify-republish-readiness.ts")],
      {
        logFile,
        timeoutMs: context.timeoutMs,
        maxLogBytes: context.maxLogBytes,
        env: context.env,
      },
    );
    const log = readRegularFile(logFile, context.maxLogBytes, "audit readiness log");
    const proof = log.includes("[republish-readiness] READY:") && log.includes("no publish authority");
    const readiness: ReadinessResult = {
      ...result,
      passed: result.passed && proof,
      logSha256: hashBytes(log),
      proof,
      ...(result.passed && proof ? {} : { diagnosticsPath: path.relative(context.root, logFile) }),
    };
    retainFailureLog = !readiness.passed;
    return readiness;
  } finally {
    if (!retainFailureLog) rmSync(runDir, { recursive: true, force: true });
  }
}

export async function runPrepublishRemoteGate(options: PrepublishRemoteGateOptions) {
  const root = path.resolve(options.root ?? process.cwd());
  const readCandidate = options.readCandidate ?? (() => readCandidateFromDisk(root));
  const env = options.env ?? process.env;
  process.exitCode = undefined;

  try {
    const beforeRemote = readCandidate();
    if (!SHA256.test(beforeRemote.sourceDigest) || !beforeRemote.files.length)
      fail("current candidate source identity is missing or invalid");
    const candidateIdentity = candidateSnapshotIdentity(beforeRemote);
    const localRoot = path.resolve(root, ".local");
    const file = statePathFor(root, beforeRemote.sourceDigest, options.statePath);
    if (!existsSync(localRoot)) missingState(root, file);
    ensureDirectory(root, ".local");
    if (!existsSync(file)) missingState(root, file);
    ensureDirectory(root, STATE_DIR);
    const stateBytesBeforeCollect = readRegularFile(file, MAX_STATE_BYTES, "remote operator state");
    let state = parseState(stateBytesBeforeCollect);
    if (state?.purpose || state?.phase === "setup_verified" || !state?.plan)
      fail("setup proof or incomplete remote state cannot certify publish preflight");

    // The collector authenticates the current GitHub run and re-fetches the same-run artifact.
    // Clear stale process status so pending collection cannot be hidden or inherited.
    let collectExitCode: NodeJS.Process["exitCode"];
    process.exitCode = undefined;
    try {
      await options.collectRemote(["collect", "--state", file]);
      collectExitCode = process.exitCode;
    } finally {
      process.exitCode = undefined;
    }
    if (collectExitCode !== undefined && collectExitCode !== 0)
      fail("remote collection is pending or exited unsuccessfully");

    const current = readCandidate();
    if (candidateSnapshotIdentity(current) !== candidateIdentity)
      fail("candidate source or file modes changed during authenticated remote collection");
    ensureDirectory(root, STATE_DIR);
    const stateBytes = readRegularFile(file, MAX_STATE_BYTES, "remote operator state");
    state = parseState(stateBytes);
    const plan = validatePlan(state, current.sourceDigest);
    const reportPath = reportPathFor(root, state);
    ensureDirectory(root, REPORT_DIR);
    const reportRunDir = path.dirname(reportPath);
    ensureDirectory(root, path.relative(root, reportRunDir));
    const reportBytes = readRegularFile(reportPath, MAX_REPORT_BYTES, "remote report");
    const report = parseReport(reportBytes);
    const evidence = validateReport(report, plan, state, current, reportRunDir);
    validateRemoteReleaseEvidence(plan, evidence.receipts, evidence.trusted, {
      repositoryId: state.repositoryId,
      workflowId: state.workflowId,
      branch: state.branch,
      runId: state.runId,
      runAttempt: state.runAttempt,
    });

    const readiness = await (options.runReadiness ?? runLocalReadiness)({
      root,
      env: readinessEnvironment(env, root),
      timeoutMs: READINESS_TIMEOUT_MS,
      maxLogBytes: READINESS_LOG_LIMIT,
    });
    if (readiness.passed !== true || readiness.proof !== true ||
        readiness.code !== 0 || readiness.timedOut !== false ||
        readiness.outputLimitExceeded !== false ||
        !Number.isFinite(readiness.elapsedMs) || readiness.elapsedMs < 0 ||
        readiness.elapsedMs > READINESS_TIMEOUT_MS || !SHA256.test(readiness.logSha256))
      fail(`audit-baseline readiness check failed or exceeded its bound${readiness.diagnosticsPath
        ? `; bounded private diagnostics: ${readiness.diagnosticsPath}` : ""}`);

    const afterReadiness = readCandidate();
    if (candidateSnapshotIdentity(afterReadiness) !== candidateIdentity)
      fail("candidate source or file modes changed during audit-baseline readiness");

    if (!env.DATABASE_URL) fail("DATABASE_URL is missing; remote evidence cannot replace local catalog inspection");
    const catalogEnv = sanitizeSpawnEnv(Object.fromEntries(
      ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR"]
        .filter(key => env[key] !== undefined).map(key => [key, env[key]]),
    ));
    catalogEnv.DATABASE_URL = env.DATABASE_URL;
    const catalog = await (options.runCatalog ?? runLocalCatalog)({
      root,
      env: catalogEnv,
      timeoutMs: CATALOG_TIMEOUT_MS,
      maxLogBytes: CATALOG_LOG_LIMIT,
    });
    if (catalog.passed !== true || catalog.code !== 0 || catalog.timedOut !== false ||
        catalog.outputLimitExceeded !== false || !Number.isFinite(catalog.elapsedMs) ||
        catalog.elapsedMs < 0 || catalog.elapsedMs > CATALOG_TIMEOUT_MS ||
        !SHA256.test(catalog.logSha256))
      fail("local database catalog inspection failed or exceeded its bound");

    const afterCatalog = readCandidate();
    if (candidateSnapshotIdentity(afterCatalog) !== candidateIdentity)
      fail("candidate source or file modes changed during local catalog inspection");
    const stateBytesAfterCatalog = readRegularFile(file, MAX_STATE_BYTES, "remote operator state");
    const reportBytesAfterCatalog = readRegularFile(reportPath, MAX_REPORT_BYTES, "remote report");
    if (hashBytes(stateBytesAfterCatalog) !== hashBytes(stateBytes) ||
        hashBytes(reportBytesAfterCatalog) !== hashBytes(reportBytes))
      fail("verified remote state/report changed during local catalog inspection");

    return {
      version: 1,
      status: "READY",
      sourceDigest: current.sourceDigest,
      reportPath: path.relative(root, reportPath),
      reportSha256: hashBytes(reportBytes),
      plan: { base: plan.base, head: plan.head, changed: plan.changed, requiredChecks: plan.checks.map(check => check.id) },
      remote: {
        repositoryId: evidence.trusted.repositoryId,
        workflowId: evidence.trusted.workflowId,
        branch: evidence.trusted.branch,
        runId: evidence.trusted.runId,
        runAttempt: evidence.trusted.runAttempt,
        artifactId: evidence.trusted.artifact.id,
        artifactSha256: evidence.artifactSha256,
      },
      auditReadiness: {
        passed: true,
        command: "node --import tsx scripts/verify-republish-readiness.ts",
        elapsedMs: readiness.elapsedMs,
        logSha256: readiness.logSha256,
      },
      localCatalog: { passed: true, elapsedMs: catalog.elapsedMs, logSha256: catalog.logSha256 },
    };
  } finally {
    // This command owns its status; never inherit a stale CLI status into READY.
    process.exitCode = undefined;
  }
}

export {
  CATALOG_LOG_LIMIT,
  CATALOG_TIMEOUT_MS,
  READINESS_LOG_LIMIT,
  READINESS_TIMEOUT_MS,
};
