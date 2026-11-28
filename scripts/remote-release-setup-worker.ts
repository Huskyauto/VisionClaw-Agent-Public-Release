import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOfflineVerificationEnv } from "./lib/offline-verification";
import { runBoundedReleaseCommand } from "./lib/targeted-release-check";

const checks: Record<string, [string, string[]]> = {
  "unit-tests": [process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1",
    "tests/lib/remote-release-worker.test.ts", "tests/lib/remote-release-verifier.test.ts",
    "tests/lib/remote-release-github.test.ts", "tests/lib/remote-release-candidate.test.ts",
    "tests/lib/remote-release-evidence.test.ts", "tests/lib/remote-release-operator.test.ts",
    "tests/lib/remote-release-setup.test.ts", "tests/lib/prepublish-remote-gate.test.ts",
    "tests/lib/remote-release-tree.test.ts", "tests/lib/remote-release-renew.test.ts",
    "tests/lib/release-runtime-artifacts.test.ts"]],
  typecheck: [process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]],
  "portable-install": [process.execPath, ["--test", "--test-name-pattern=^every locked tarball",
    "tests/deployment/portable-install.test.cjs"]],
  "publish-typecheck": [process.execPath, ["node_modules/typescript/bin/tsc", "-p",
    "tsconfig.publish-preflight.json"]],
  "surface-preflight": [process.execPath, ["--import", "tsx", "scripts/preflight-stale-strings.ts"]],
  "domain-preflight": [process.execPath, ["--import", "tsx", "scripts/preflight-domain-boundaries.ts"]],
  build: [process.execPath, ["--import", "tsx", "scripts/build.ts", "--release-check"]],
};
async function main() {
  const selected = checks[process.argv[2]];
  if (!selected || process.argv.length !== 3) throw Error("Unknown setup proof check");
  if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      !/^release-checks\/[a-f0-9]{64}$/.test(process.env.GITHUB_REF_NAME ?? ""))
    throw Error("Setup proof requires a manual isolated GitHub branch");
  const home = mkdtempSync(join(tmpdir(), "remote-setup-"));
  const log = join(home, "check.log");
  try {
    const result = await runBoundedReleaseCommand(selected[0], selected[1], {
      logFile: log, env: buildOfflineVerificationEnv(process.env, home),
      timeoutMs: 300_000, maxLogBytes: 6 * 1024 * 1024,
    });
    console.log(readFileSync(log, "utf8"));
    console.log(JSON.stringify({ purpose: "setup-proof-not-release-clearance",
      head: process.env.GITHUB_SHA, check: process.argv[2], ...result }));
    if (!result.passed) process.exitCode = 1;
  } finally { rmSync(home, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
