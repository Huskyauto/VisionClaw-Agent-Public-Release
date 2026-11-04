#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyReleaseScope, digestReleaseInputs, releaseInputPaths, sameReleaseMembership, runBoundedReleaseCommand, validReleasePath } from "./lib/targeted-release-check";
import { confirmationDigest, confirmationMarkdown } from "../server/lib/run-confirmation";
import { assessReleaseConfirmation } from "./lib/project-confirmation";

const git = (...args: string[]) => execFileSync("git", ["--no-optional-locks", ...args], {
  encoding: "utf8", timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
});
const split = (text: string) => text.split("\0").filter(Boolean);
const output = resolve(".local/release-checks");
let activeKill: (() => void) | undefined;
function killActive() { activeKill?.(); }
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { killActive(); process.exit(signal === "SIGINT" ? 130 : 143); });
}

function snapshot(changed: string[]) {
  const files = releaseInputPaths([
    ...split(git("ls-files", "-z")), ...split(git("ls-files", "--others", "--exclude-standard", "-z")),
  ], changed);
  return {
    count: files.length,
    digest: digestReleaseInputs(files.map(file => {
      if (!validReleasePath(file)) throw new Error("Unsafe input path");
      const abs = resolve(file);
      let stat;
      try { stat = lstatSync(abs); }
      catch (error: any) { if (error.code === "ENOENT") return { path: file, content: null }; throw error; }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10 * 1024 * 1024)
        throw new Error(`Non-regular or oversized release input: ${file}`);
      return { path: file, content: readFileSync(abs).toString("base64") };
    })),
  };
}

async function runCheck(dir: string, name: string, command: string, args: string[], timeoutMs: number) {
  const log = resolve(dir, `${name}.log`);
  console.log(`[release-check] ${name} started (limit ${timeoutMs / 1000}s)`);
  const result = await runBoundedReleaseCommand(command, args, {
    logFile: log, timeoutMs,
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=3072", RUN_E2E: "0" },
    onSpawn: kill => { activeKill = kill; },
  });
  console.log(`[release-check] ${name}: ${result.passed ? "PASS" : "FAIL"} (${Math.round(result.elapsedMs / 1000)}s); ${log}`);
  return { name, ...result, log };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--base" || !/^[a-f0-9]{7,40}$/.test(args[1]))
    throw new Error("Usage: npm run release:check -- --base <explicit commit SHA>");
  const base = git("rev-parse", "--verify", `${args[1]}^{commit}`).trim();
  git("merge-base", "--is-ancestor", base, "HEAD");
  const changed = [...new Set([
    ...split(git("diff", "--name-only", "--no-renames", "-z", base, "--")),
    ...split(git("ls-files", "--others", "--exclude-standard", "-z")),
  ])].sort();
  const scope = classifyReleaseScope(changed);
  const source = snapshot(changed);
  const report: any = {
    version: 1, createdAt: new Date().toISOString(), base, source, changed, scope,
    status: "BLOCKED", checks: [],
    limits: ["Not whole-repository security clearance", "Independent scoped review and known-finding adjudication required", "No publish or Git-push authority", "Source baseline is not proof of a successful live deployment"],
  };
  const requiredChecks = ["regressions", "typecheck", "surface-preflight", "domain-preflight", "build"];
  if (scope.areas.includes("payments")) requiredChecks.push("mission-lifecycle");
  const requirements = requiredChecks.map(id => ({ id, label: `${id}: bounded command exits successfully` }));
  const confirmationSource = confirmationDigest({ base, source, changed, scope, requirements });
  mkdirSync(output, { recursive: true, mode: 0o700 });
  if (realpathSync(output) !== output) throw new Error("Release evidence directory must not follow symlinks");
  const runDir = mkdtempSync(resolve(output, "run-"));
  const save = () => {
    report.confirmation = assessReleaseConfirmation({
      subjectDigest: confirmationSource, sourceStable: report.sourceStable,
      status: report.status, requirements, checks: report.checks,
    });
    const body = JSON.stringify(report, null, 2) + "\n";
    writeFileSync(resolve(runDir, "report.json"), body, { mode: 0o600 });
    writeFileSync(resolve(runDir, "confirmation.md"), confirmationMarkdown(report.confirmation), { mode: 0o600 });
    const tmp = resolve(output, `latest.${process.pid}.tmp`);
    writeFileSync(tmp, body, { mode: 0o600 });
    renameSync(tmp, resolve(output, "latest.json"));
  };
  if (changed.includes("package.json")) {
    const old = JSON.parse(git("show", `${base}:package.json`));
    const current = JSON.parse(readFileSync("package.json", "utf8"));
    for (const field of ["dependencies", "devDependencies", "optionalDependencies", "overrides"]) {
      if (JSON.stringify(old[field]) !== JSON.stringify(current[field]))
        scope.unknown.push(`package.json: ${field} changed; dependency review required`);
    }
  }
  if (scope.unknown.length) {
    save();
    console.error("[release-check] BLOCKED: unclassified scope", scope.unknown);
    process.exitCode = 2;
    return;
  }
  console.log(`[release-check] ${changed.length} changed paths; areas=${scope.areas.join(",")}; ${scope.tests.length} targeted regression files`);
  for (const file of scope.tests) if (!existsSync(file)) throw new Error(`Required regression missing: ${file}`);
  const steps: [string, string, string[], number][] = [
    ["regressions", process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", ...scope.tests], 180_000],
    ["typecheck", process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"], 300_000],
    ["surface-preflight", process.execPath, ["--import", "tsx", "scripts/preflight-stale-strings.ts"], 60_000],
    ["domain-preflight", process.execPath, ["--import", "tsx", "scripts/preflight-domain-boundaries.ts"], 60_000],
    ["build", "npm", ["run", "build", "--", "--release-check"], 300_000],
  ];
  if (scope.areas.includes("payments")) {
    steps.splice(1, 0, ["mission-lifecycle", process.execPath, [
      "--import", "tsx", "--test", "--test-force-exit", "tests/integration/mission-golden-path.test.ts",
    ], 120_000]);
  }
  save();
  for (const [name, command, argv, deadline] of steps) {
    report.checks.push(await runCheck(runDir, name, command, argv, deadline));
    save();
    if (!report.checks.at(-1).passed) { process.exitCode = 1; return; }
  }
  const finalChanged = [...new Set([
    ...split(git("diff", "--name-only", "--no-renames", "-z", base, "--")),
    ...split(git("ls-files", "--others", "--exclude-standard", "-z")),
  ])].sort();
  const final = snapshot(finalChanged);
  report.sourceStable = source.digest === final.digest && sameReleaseMembership(changed, finalChanged);
  report.scopeMembershipStable = sameReleaseMembership(changed, finalChanged);
  if (existsSync("dist/dev-data-snapshot.json")) {
    report.status = "BLOCKED_SENSITIVE_BUILD_SNAPSHOT";
    save(); process.exitCode = 4; return;
  }
  report.finishedAt = new Date().toISOString();
  report.status = report.sourceStable ? "AUTOMATED_CHECKS_PASSED_REVIEW_REQUIRED" : "BLOCKED_SOURCE_CHANGED";
  save();
  console.log(`[release-check] ${report.status}; full audit remains separate/incomplete. Report: ${output}/latest.json`);
  if (!report.sourceStable) process.exitCode = 3;
}
main().catch(error => {
  killActive();
  console.error(`[release-check] BLOCKED: ${error.message}`);
  process.exitCode = 1;
});
