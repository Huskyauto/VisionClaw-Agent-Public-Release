#!/usr/bin/env -S npx tsx
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { confirmationDigest, confirmationMarkdown, createRunConfirmation, type CheckStatus } from "../server/lib/run-confirmation";
import { getConfirmationProfile, snapshotConfirmationSources, assessTapCheck } from "./lib/project-confirmation";
import { runBoundedReleaseCommand } from "./lib/targeted-release-check";
import { sanitizeSpawnEnv } from "../server/safety/spawn-env-guard";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--profile") {
    throw new Error("Usage: npx tsx scripts/project-confirmation.ts --profile harness-rollout");
  }
  const profile = getConfirmationProfile(args[1]);
  const sources = snapshotConfirmationSources(profile.sources);
  const subjectDigest = confirmationDigest({ profile, sources, node: process.version });
  const requirements = [{ id: "regressions", label: "All declared offline regression tests pass without skips" }];
  const root = resolve("generated-artifacts/run-confirmations");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (realpathSync(root) !== root) throw new Error("Confirmation output must not follow symlinks");
  const dir = mkdtempSync(resolve(root, "run-"));
  const write = (name: string, body: string) => writeFileSync(resolve(dir, name), body, { flag: "wx", mode: 0o600 });
  write("manifest.json", JSON.stringify({ version: 1, profile, sources, subjectDigest, requirements,
    createdAt: new Date().toISOString(), node: process.version }, null, 2));
  // Never give offline tests owner credentials, database URLs or loader overrides.
  const env = sanitizeSpawnEnv({
    PATH: process.env.PATH, HOME: "/tmp", TMPDIR: "/tmp", LANG: "C.UTF-8",
    NODE_ENV: "test", RUN_E2E: "0",
  });
  let activeKill: (() => void) | undefined;
  const stop = () => { activeKill?.(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let status: CheckStatus = "unverified";
  let evidence = "Check could not complete; no outcome confirmed.";
  try {
    const result = await runBoundedReleaseCommand(process.execPath, [
      "--max-old-space-size=768", "--import", "tsx", "--test", "--test-concurrency=1",
      "--test-reporter=tap", ...profile.tests,
    ], { logFile: resolve(dir, "regressions.log"), timeoutMs: 120_000, maxLogBytes: 1024 * 1024, env,
      onSpawn: kill => { activeKill = kill; } });
    const logPath = resolve(dir, "regressions.log");
    if (statSync(logPath).size > 1024 * 1024) throw new Error("Check log exceeds read budget");
    const log = readFileSync(logPath);
    status = result.outputLimitExceeded ? "unverified" : assessTapCheck(log.toString("utf8"), result.passed);
    evidence = `exit=${result.code}; timedOut=${result.timedOut}; outputLimitExceeded=${result.outputLimitExceeded}; log SHA-256=${confirmationDigest(log.toString("base64"))}; elapsed=${result.elapsedMs}ms.`;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
  const currentDigest = confirmationDigest({ profile, sources: snapshotConfirmationSources(profile.sources), node: process.version });
  const report = createRunConfirmation({
    scope: profile.scope, subjectDigest, currentDigest, requirements,
    observations: [{ id: "regressions", status, evidence }],
  });
  write("confirmation.json", JSON.stringify(report, null, 2));
  write("confirmation.md", confirmationMarkdown(report));
  console.log(`[run-confirmation] ${report.status.toUpperCase()} — ${dir}/confirmation.md`);
  console.log(`[run-confirmation] Only ${profile.name} checks; no model inference or side effects replayed.`);
  process.exitCode = report.status === "confirmed" ? 0 : report.status === "failed" ? 1 : 2;
}
main().catch(() => {
  console.error("[run-confirmation] UNVERIFIED: unable to complete or persist evidence. No confirmation issued.");
  process.exitCode = 2;
});
