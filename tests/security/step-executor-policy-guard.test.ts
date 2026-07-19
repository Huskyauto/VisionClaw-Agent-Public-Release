import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Runs the build-time guard that bans raw executeTool() in autonomous step
// executors (and outside the allowlist) and asserts the current tree is clean.
// Keeps the AHB destructive-tool policy non-bypassable in plan/lobster runners.
test("step-executor policy guard passes on current tree", () => {
  const r = spawnSync("npx", ["tsx", "scripts/guard-step-executor-policy.ts", "--json"], {
    encoding: "utf8",
    cwd: process.cwd(),
    timeout: 60_000,
  });
  assert.equal(r.status, 0, `guard exited ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true, `guard violations: ${JSON.stringify(out.violations, null, 2)}`);
});
