/**
 * tests/unit/auto-push-selfheal-trigger.test.ts
 *
 * Trigger-wording coverage for the auto-push self-heal (architect follow-up):
 * git phrases the divergence reject either as "non-fast-forward" or as a
 * rejected-ref line ending in "(fetch first)". The heal must fire on BOTH
 * canonical forms, and must NOT fire on unrelated output that merely contains
 * the words "fetch first" (e.g. hook stderr) — that would burn heal attempts.
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

test("'(fetch first)' rejected-ref wording heals a true divergence", () => {
  const r = runScenario("fetch-first");
  assert.equal(r.attempts, "1");
  assert.equal(r.head_moved, "yes");
  assert.equal(r.contains_remote, "yes");
  assert.equal(r.rebase_in_progress, "no");
  assert.match(r.out, /rebase ok/);
});

test("unrelated output containing 'fetch first' does NOT trigger a heal", () => {
  const r = runScenario("unrelated-fetch-first");
  assert.equal(r.attempts, "0"); // no attempt consumed
  assert.equal(r.head_moved, "no");
  assert.equal(r.out.trim(), ""); // silent no-op
});
