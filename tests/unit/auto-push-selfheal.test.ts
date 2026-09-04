/**
 * tests/unit/auto-push-selfheal.test.ts — R125+139
 *
 * Regression coverage for the auto-push diverged-remote self-heal branch
 * (72h-review follow-up: "add a test for the divergence self-heal path so a
 * future edit can't silently wedge the push loop again"). The logic lives in
 * scripts/lib/auto-push-selfheal.sh; tests/helpers/auto-push-selfheal-harness.sh
 * runs it against throwaway local repos (SELFHEAL_URL_OVERRIDE), so no network,
 * no tokens, no real remote.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as path from "path";

const HARNESS = path.resolve(process.cwd(), "tests", "helpers", "auto-push-selfheal-harness.sh");

function runScenario(name: string): Record<string, string> {
  const r = spawnSync("bash", [HARNESS, name], { encoding: "utf8", timeout: 60_000 });
  assert.equal(r.status, 0, `harness failed for ${name}: ${r.stderr}\n${r.stdout}`);
  const out: Record<string, string> = {};
  const lines = r.stdout.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^RESULT:([a-z_]+)=(.*)$/.exec(lines[i]);
    if (m) { out[m[1]] = m[2]; continue; }
    if (lines[i] === "RESULT:out<<EOF") {
      const end = lines.indexOf("EOF", i + 1);
      out.out = lines.slice(i + 1, end === -1 ? undefined : end).join("\n");
      break;
    }
  }
  return out;
}

test("true divergence: rebases local commits onto the remote tip", () => {
  const r = runScenario("diverged");
  assert.equal(r.attempts, "1");
  assert.equal(r.head_moved, "yes");
  assert.equal(r.contains_remote, "yes"); // remote tip is now an ancestor
  assert.equal(r.rebase_in_progress, "no");
  assert.match(r.out, /rebase ok/);
});

test("remote NOT ahead (branch protection / hook reject): skips rebase, no churn", () => {
  const r = runScenario("not-ahead");
  assert.equal(r.attempts, "1"); // fetch attempt still counted
  assert.equal(r.head_moved, "no");
  assert.match(r.out, /remote is NOT ahead/);
});

test("dirty working tree: self-heal skipped entirely", () => {
  const r = runScenario("dirty");
  assert.equal(r.attempts, "0");
  assert.equal(r.head_moved, "no");
  assert.match(r.out, /working tree dirty/);
});

test("attempt cap: 3 prior attempts without a successful push = no further heals", () => {
  const r = runScenario("capped");
  assert.equal(r.attempts, "3"); // unchanged
  assert.equal(r.head_moved, "no");
  assert.match(r.out, /persistent reject, manual reconcile needed/);
});

test("rebase conflict: aborts cleanly, repo left untouched and not mid-rebase", () => {
  const r = runScenario("conflict");
  assert.equal(r.attempts, "1");
  assert.equal(r.head_moved, "no"); // abort restored original HEAD
  assert.equal(r.rebase_in_progress, "no");
  assert.match(r.out, /rebase CONFLICT — aborting/);
});
