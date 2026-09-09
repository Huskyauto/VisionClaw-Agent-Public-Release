#!/usr/bin/env tsx
/**
 * R120 — Local hard-gate for `tsc --noEmit`.
 *
 * Gemini-3.5-Flash-Extended review suggested promoting tsc to a non-negotiable
 * gate. CI already does this in .github/workflows/ci.yml:187 ("TypeScript
 * (hard gate)"). This script gives operators a local fail-fast equivalent so
 * they can catch type drift before pushing.
 *
 * Exit codes:
 *   0 — clean
 *   1 — tsc emitted errors
 *
 * Usage:
 *   npx tsx scripts/preflight-tsc.ts
 *
 * Or chain in pre-deploy:
 *   npx tsx scripts/preflight-stale-strings.ts && npx tsx scripts/preflight-tsc.ts
 */
import { spawnSync } from "child_process";

const r = spawnSync("npx", ["tsc", "--noEmit"], {
  stdio: "inherit",
  encoding: "utf8",
});
if (r.status !== 0) {
  console.error("\n❌ tsc --noEmit failed — fix type errors before deploy.");
  process.exit(1);
}
console.log("✓ tsc --noEmit clean");
