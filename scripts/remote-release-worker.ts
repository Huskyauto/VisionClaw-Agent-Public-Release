#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { buildOfflineVerificationEnv } from "./lib/offline-verification";
import { createRemoteReleasePlan } from "./lib/remote-release-plan";
import {
  REMOTE_RELEASE_BRANCH, REMOTE_RELEASE_REPO,
  type RemoteCheck, type RemoteCheckReceipt, type RemoteReleasePlan,
} from "./lib/remote-release-contract";
import { incrementalSourceDigest } from "./lib/republish-incremental-readiness";
import { runBoundedReleaseCommand } from "./lib/targeted-release-check";

const ROOT = resolve(".");
const OUTPUT = resolve(ROOT, ".local/remote-release");
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_LOG_BYTES = 8 * 1024 * 1024;
const CHECK_TIMEOUT_MS = 10 * 60 * 1000;
const PLAYWRIGHT_BROWSERS_PATH = "/tmp/visionclaw-release-browser-cache";
const git = (...args: string[]) => execFileSync("git", ["--no-optional-locks", ...args], {
  cwd: ROOT, encoding: "utf8", timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
});

function parseArgs(args: string[], mode: "plan" | "check"): Record<string, string> {
  const expected = mode === "plan" ? ["--base", "--head", "--source"] : ["--plan", "--check"];
  if (args.length !== expected.length * 2) throw new Error(`Usage: remote-release-worker ${mode} ${expected.join(" <value> ")}`);
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] !== expected[i / 2] || !args[i + 1] || args[i + 1].startsWith("--"))
      throw new Error(`Invalid ${mode} arguments`);
    values[args[i]] = args[i + 1];
  }
  return values;
}

function verifyCommit(value: string, label: string): void {
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error(`${label} must be a full 40-character lowercase commit SHA`);
}

function currentHead(): string {
  return git("rev-parse", "--verify", "HEAD^{commit}").trim();
}

function changedBetween(base: string, head: string): string[] {
  git("merge-base", "--is-ancestor", base, head);
  return [...new Set(git("diff", "--name-only", "--no-renames", "-z", base, head)
    .split("\0").filter(Boolean))].sort();
}

function safeDirectory(path: string): void {
  const local = resolve(ROOT, ".local");
  if (!existsSync(local)) mkdirSync(local, { mode: 0o700 });
  const localStat = lstatSync(local);
  if (!localStat.isDirectory() || localStat.isSymbolicLink() || realpathSync(local) !== local)
    throw new Error("Remote release evidence parent must be a regular directory");
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path)
    throw new Error("Remote release evidence directory must not follow symlinks");
}

function safeFile(path: string, maxBytes: number): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path || stat.size > maxBytes)
    throw new Error("Unsafe or oversized remote release evidence file");
  return readFileSync(path, "utf8");
}

function matrixOutput(plan: RemoteReleasePlan): string {
  return JSON.stringify({
    include: plan.checks.map(check => ({ checkId: check.id, database: check.database })),
  });
}

function writePlanOutput(plan: RemoteReleasePlan): void {
  safeDirectory(OUTPUT);
  const path = resolve(OUTPUT, "plan.json");
  if (existsSync(path)) throw new Error("Remote release plan output already exists");
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${matrixOutput(plan)}\n`);
  }
}

function planFromCheckout(base: string, head: string, sourceDigest: string): RemoteReleasePlan {
  verifyCommit(base, "base");
  verifyCommit(head, "head");
  if (currentHead() !== head) throw new Error("Checkout HEAD does not match the requested release head");
  if (!/^[a-f0-9]{64}$/.test(sourceDigest)) throw new Error("source digest must be a SHA-256 digest");
  if (incrementalSourceDigest(ROOT) !== sourceDigest) throw new Error("Checkout source digest does not match the requested digest");
  const changed = changedBetween(base, head);
  const plan = createRemoteReleasePlan({ base, head, sourceDigest, changed });
  for (const check of plan.checks) {
    for (const test of check.tests) {
      const path = resolve(ROOT, test);
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path || stat.size > MAX_SOURCE_BYTES)
        throw new Error(`Unsafe or missing planned test: ${test}`);
    }
  }
  return plan;
}

function planMode(args: string[]): void {
  const values = parseArgs(args, "plan");
  verifyWorkflowContext(values["--head"]);
  const plan = planFromCheckout(values["--base"], values["--head"], values["--source"]);
  writePlanOutput(plan);
  console.log(JSON.stringify({ head: plan.head, sourceDigest: plan.sourceDigest, checks: plan.checks.map(c => c.id) }));
}

function expectedPlan(planPath: string): RemoteReleasePlan {
  const absolute = resolve(ROOT, planPath);
  const pathFromRoot = relative(ROOT, absolute);
  if (!pathFromRoot || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`))
    throw new Error("Remote release plan must be inside the checked-out workspace");
  const parsed = JSON.parse(safeFile(absolute, 2 * 1024 * 1024)) as RemoteReleasePlan;
  if (parsed?.version !== 1 || parsed.repository !== REMOTE_RELEASE_REPO)
    throw new Error("Unsupported or foreign remote release plan");
  const expected = planFromCheckout(parsed.base, parsed.head, parsed.sourceDigest);
  if (JSON.stringify(parsed) !== JSON.stringify(expected))
    throw new Error("Remote release plan does not match this checkout's source and changed-path plan");
  return expected;
}

function checkById(plan: RemoteReleasePlan, id: string): RemoteCheck {
  const check = plan.checks.find(item => item.id === id);
  if (!check || !/^(?:regressions-[1-3]|database-regressions|typecheck|surface-preflight|domain-preflight|build|portable-install|publish-typecheck|muse-s2-integration|mission-lifecycle)$/.test(id))
    throw new Error("Unknown remote release check ID");
  return check;
}

function runIdentity(): { runId: number; runAttempt: number } {
  const runId = Number(process.env.GITHUB_RUN_ID), runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  if (!Number.isSafeInteger(runId) || runId <= 0 || !Number.isSafeInteger(runAttempt) || runAttempt <= 0)
    throw new Error("GitHub run identity is missing or invalid");
  return { runId, runAttempt };
}

function verifyWorkflowContext(head: string): void {
  if (!REMOTE_RELEASE_BRANCH.test(process.env.GITHUB_REF_NAME ?? ""))
    throw new Error("Remote release workflow must run on a private release-checks/<hex> branch");
  if (process.env.GITHUB_SHA !== head)
    throw new Error("Dispatch SHA does not match the requested release head");
  if (process.env.GITHUB_REPOSITORY !== REMOTE_RELEASE_REPO)
    throw new Error("Remote release workflow ran in an unexpected repository");
}

function commandFor(check: RemoteCheck): { command: string; args: string[] } {
  switch (check.kind) {
    case "regressions":
    case "database-regressions":
      if (!check.tests.length) throw new Error("Regression shard cannot be empty");
      return { command: process.execPath, args: ["--import", "tsx", "--test", "--test-force-exit", "--test-concurrency=1", ...check.tests] };
    case "typecheck":
      return { command: process.execPath, args: ["node_modules/typescript/bin/tsc", "--noEmit"] };
    case "surface-preflight":
      return { command: process.execPath, args: ["--import", "tsx", "scripts/preflight-stale-strings.ts"] };
    case "domain-preflight":
      return { command: process.execPath, args: ["--import", "tsx", "scripts/preflight-domain-boundaries.ts"] };
    case "build":
      // Portable-install is its own lane; invoke the identical build entrypoint
      // directly instead of re-running it through package.json's wrapper.
      return { command: process.execPath, args: ["--import", "tsx", "scripts/build.ts", "--release-check"] };
    case "portable-install":
      return {
        command: process.execPath,
        args: ["--test", "--test-name-pattern=^every locked tarball", "tests/deployment/portable-install.test.cjs"],
      };
    case "publish-typecheck":
      return {
        command: process.execPath,
        args: ["node_modules/typescript/bin/tsc", "-p", "tsconfig.publish-preflight.json"],
      };
    case "muse-s2-integration":
      return { command: process.execPath, args: ["--import", "tsx", "--test", "--test-force-exit", ...check.tests] };
    case "mission-lifecycle":
      return { command: process.execPath, args: ["--import", "tsx", "--test", "--test-force-exit", ...check.tests] };
  }
}

const DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5432/visionclaw_test";
function childEnvironment(home: string, check: RemoteCheck, source = process.env): NodeJS.ProcessEnv {
  const env = buildOfflineVerificationEnv(source, home);
  env.SESSION_SECRET = "remote-release-offline-session-secret-only";
  env.PIN_PEPPER = "remote-release-offline-pepper";
  if (check.kind === "regressions" || check.kind === "database-regressions")
    env.PLAYWRIGHT_BROWSERS_PATH = PLAYWRIGHT_BROWSERS_PATH;
  if (check.database) {
    const supplied = source.REMOTE_RELEASE_DATABASE_URL;
    if (supplied !== DATABASE_URL)
      throw new Error("Database checks require the exact disposable GitHub Postgres service URL");
    env.DATABASE_URL = DATABASE_URL;
  }
  return env;
}

const DB_STEPS: { command: string; args: string[]; psql?: boolean }[] = [
  { command: "psql", args: ["-v", "ON_ERROR_STOP=1", "-c", "CREATE EXTENSION IF NOT EXISTS vector;",], psql: true },
  { command: "npm", args: ["run", "db:push", "--", "--force"] },
  { command: "psql", args: ["-v", "ON_ERROR_STOP=1", "-f", "tests/fixtures/mission-evidence-index.sql"], psql: true },
  { command: "psql", args: ["-v", "ON_ERROR_STOP=1", "-f", "migrations/0103_plans_publish_required_status.sql"], psql: true },
  { command: "psql", args: ["-v", "ON_ERROR_STOP=1", "-f", "tests/fixtures/stripe-schema-bootstrap.sql"], psql: true },
  { command: "psql", args: ["-v", "ON_ERROR_STOP=1", "-f", "tests/fixtures/seed-test-personas.sql"], psql: true },
  { command: process.execPath, args: ["--import", "tsx", "tests/fixtures/seed-ci-persona-docs.ts"] },
  { command: "psql", args: ["-v", "ON_ERROR_STOP=1", "-f", "scripts/migrations/R120-rls-policies.sql"], psql: true },
  { command: process.execPath, args: ["--import", "tsx", "tests/fixtures/seed-catalog-files.ts"] },
];

function commandEnv(base: NodeJS.ProcessEnv, psql = false): NodeJS.ProcessEnv {
  if (!psql) return base;
  return { ...base, PGPASSWORD: "postgres", PGHOST: "127.0.0.1", PGPORT: "5432", PGUSER: "postgres", PGDATABASE: "visionclaw_test" };
}

async function execute(check: RemoteCheck, logPath: string, env: NodeJS.ProcessEnv) {
  const commands = check.database ? [
    ...DB_STEPS.map(step => ({ ...step, label: `db-setup:${step.args.join(" ")}`, env: commandEnv(env, step.psql) })),
    { ...commandFor(check), label: `check:${check.id}`, env },
  ] : [{ ...commandFor(check), label: `check:${check.id}`, env }];
  const tempDir = resolve(dirname(logPath), `${check.id}-steps`);
  mkdirSync(tempDir, { mode: 0o700 });
  let aggregateBytes = 0, elapsedMs = 0;
  let failed: Awaited<ReturnType<typeof runBoundedReleaseCommand>> | undefined;
  let outputLimitExceeded = false;
  try {
    for (const [index, item] of commands.entries()) {
      const stepLog = resolve(tempDir, `${String(index).padStart(2, "0")}.log`);
      const result = await runBoundedReleaseCommand(item.command, item.args, {
        logFile: stepLog, timeoutMs: CHECK_TIMEOUT_MS, maxLogBytes: MAX_LOG_BYTES, env: item.env,
      });
      elapsedMs += result.elapsedMs;
      const header = `\n===== ${item.label} (exit=${result.code}, timeout=${result.timedOut}) =====\n`;
      const bytes = readFileSync(stepLog);
      const remaining = Math.max(0, MAX_LOG_BYTES - aggregateBytes - Buffer.byteLength(header));
      const append = Buffer.concat([Buffer.from(header), bytes.subarray(0, remaining)]);
      appendFileSync(logPath, append);
      aggregateBytes += append.length;
      if (bytes.length > remaining || result.outputLimitExceeded) outputLimitExceeded = true;
      if (!result.passed || outputLimitExceeded) {
        failed = { ...result, passed: false, outputLimitExceeded: result.outputLimitExceeded || outputLimitExceeded };
        break;
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  return failed
    ? { ...failed, elapsedMs }
    : { passed: true, code: 0, timedOut: false, outputLimitExceeded, elapsedMs };
}

async function checkMode(args: string[]): Promise<void> {
  const values = parseArgs(args, "check");
  const plan = expectedPlan(values["--plan"]);
  verifyWorkflowContext(plan.head);
  const check = checkById(plan, values["--check"]);
  const identity = runIdentity();
  const results = resolve(OUTPUT, "results");
  safeDirectory(OUTPUT);
  safeDirectory(results);
  const receiptPath = resolve(results, `${check.id}.json`);
  const logPath = resolve(results, `${check.id}.log`);
  if (existsSync(receiptPath) || existsSync(logPath)) throw new Error("Remote release result already exists");
  writeFileSync(logPath, "", { flag: "wx", mode: 0o600 });
  const home = resolve(mkdtempSync(resolve(tmpdir(), "remote-release-home-")));
  let result: Awaited<ReturnType<typeof runBoundedReleaseCommand>>;
  try {
    const env = childEnvironment(home, check);
    result = await execute(check, logPath, env);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  const sourceStable = incrementalSourceDigest(ROOT) === plan.sourceDigest && currentHead() === plan.head;
  if (!sourceStable) {
    appendFileSync(logPath, "\n::error::Source or HEAD changed during remote check; receipt cannot pass.\n");
    result.passed = false;
  }
  const logBytes = readFileSync(logPath);
  if (logBytes.length > MAX_LOG_BYTES) {
    result.outputLimitExceeded = true;
    result.passed = false;
    writeFileSync(logPath, logBytes.subarray(0, MAX_LOG_BYTES));
  }
  const receipt: RemoteCheckReceipt = {
    version: 1,
    checkId: check.id,
    head: plan.head,
    sourceDigest: plan.sourceDigest,
    ...identity,
    tests: [...check.tests],
    passed: result.passed && sourceStable,
    code: result.code,
    timedOut: result.timedOut,
    outputLimitExceeded: result.outputLimitExceeded || logBytes.length > MAX_LOG_BYTES,
    elapsedMs: result.elapsedMs,
    logSha256: createHash("sha256").update(readFileSync(logPath)).digest("hex"),
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(`${check.id}: ${receipt.passed ? "PASS" : "FAIL"}; receipt=${receiptPath}`);
  if (!receipt.passed) process.exitCode = 1;
}

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "plan") planMode(args);
  else if (mode === "check") await checkMode(args);
  else throw new Error("Usage: remote-release-worker <plan|check> ...");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch(error => {
    console.error(`[remote-release] BLOCKED: ${error.message}`);
    process.exitCode = 1;
  });
}

export {
  checkById, childEnvironment, commandFor, matrixOutput, planFromCheckout, safeFile,
};
