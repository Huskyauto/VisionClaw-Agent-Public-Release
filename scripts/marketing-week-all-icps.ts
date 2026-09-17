#!/usr/bin/env tsx
/**
 * Marketing Week Autopilot — 3-ICP wrapper for the /audit funnel
 *
 * Fires marketing-week-autopilot.ts sequentially for all three audit ICPs:
 *   - audit-solo       (solo founders / indie hackers — $497 self-serve)
 *   - audit-midmarket  (mid-market ops/IT leaders — $1997 DFY)
 *   - audit-agency     (white-label channel cohort)
 *
 * Designed for a single Replit Scheduled Deployment trigger ("0 7 * * MON")
 * so all three ICPs get their week's draft packet on Bob's desk Monday 7 AM.
 *
 * Per the marketing-week-autopilot skill: NOTHING IS AUTO-PUBLISHED. Every
 * packet lands as a draft awaiting HITL approval before the autopilot
 * dispatches the scheduled publishes.
 *
 * Usage:
 *   npx tsx scripts/marketing-week-all-icps.ts                # all 3 ICPs
 *   ICP_FILTER=audit-solo npx tsx scripts/marketing-week-all-icps.ts   # just one
 *   STUDY_ONLY=1 npx tsx scripts/marketing-week-all-icps.ts  # competitor briefs only
 *
 * Env (forwarded to each autopilot invocation):
 *   WEEK_OF, STUDY_ONLY, LAUNCH_BRIEF, SEND_EMAIL
 *
 * Exit codes:
 *   0  all ICPs completed
 *   1  one or more ICPs failed (others may have succeeded — see stderr)
 *   2  no ICPs matched the filter
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const ALL_ICPS = ["audit-solo", "audit-midmarket", "audit-agency"] as const;
type Icp = (typeof ALL_ICPS)[number];

const ICP_FILTER = process.env.ICP_FILTER || null;
const icps: Icp[] = ICP_FILTER
  ? (ALL_ICPS.filter((i) => i === ICP_FILTER) as Icp[])
  : ([...ALL_ICPS] as Icp[]);

if (icps.length === 0) {
  console.error(`[all-icps] FATAL: ICP_FILTER="${ICP_FILTER}" matched none of ${ALL_ICPS.join(", ")}`);
  process.exit(2);
}

// Fail-CLOSED if any profile dir is missing — better to bail loudly than to
// silently skip an ICP that someone forgot to bootstrap.
for (const slug of icps) {
  const dir = path.join("data", "profiles", slug);
  for (const f of ["voice.json", "audience.json"]) {
    if (!fs.existsSync(path.join(dir, f))) {
      console.error(`[all-icps] FATAL: ${dir}/${f} missing — bootstrap per data/output-skills/voice-and-audience-profile.md`);
      process.exit(2);
    }
  }
}

console.log(`[all-icps] starting weekly autopilot for ${icps.length} ICP(s): ${icps.join(", ")}`);

const results: { icp: Icp; ok: boolean; exitCode: number; durationMs: number }[] = [];

for (const icp of icps) {
  const t0 = Date.now();
  console.log(`\n[all-icps] ============================================`);
  console.log(`[all-icps] >>> ${icp} <<<`);
  console.log(`[all-icps] ============================================`);

  const env = {
    ...process.env,
    TENANT_SLUG: icp,
  };

  const child = spawnSync(
    "npx",
    ["tsx", "scripts/marketing-week-autopilot.ts"],
    { env, stdio: "inherit" },
  );

  const durationMs = Date.now() - t0;
  const exitCode = child.status ?? -1;
  const ok = exitCode === 0;
  results.push({ icp, ok, exitCode, durationMs });

  console.log(`[all-icps] ${icp} finished in ${(durationMs / 1000).toFixed(1)}s (exit ${exitCode})`);
}

console.log(`\n[all-icps] ============================================`);
console.log(`[all-icps] SUMMARY`);
console.log(`[all-icps] ============================================`);
for (const r of results) {
  const flag = r.ok ? "OK " : "FAIL";
  console.log(`  [${flag}] ${r.icp.padEnd(20)} ${(r.durationMs / 1000).toFixed(1)}s exit=${r.exitCode}`);
}

const anyFail = results.some((r) => !r.ok);
if (anyFail) {
  console.error(`[all-icps] one or more ICPs failed — see stderr above`);
  process.exit(1);
}
console.log(`[all-icps] all ICPs completed successfully`);
process.exit(0);
