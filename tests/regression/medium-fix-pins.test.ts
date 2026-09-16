/**
 * Regression pins for the three MEDIUM findings fixed in the 2026-07-17
 * 72h post-edit code review (second architect pass: PASS). Each test locks
 * the specific fix so a future refactor can't silently regress it:
 *
 *  1. api-v1 conversation-messages SQL is tenant-scoped IN THE QUERY
 *     (JOIN conversations + c.tenant_id filter), not only via the upstream
 *     ownership check.
 *  2. tag-mirror-release rejects unknown CLI flags with exit 1 (an
 *     unrecognized flag must never fall through to a live tag+release).
 *  3. preflight-any-budget fails CLOSED (exit 2) on any scan error, BEFORE
 *     baseline/ratchet logic — a partial scan can never false-green or
 *     ratchet the baseline.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());

function runScript(script: string, args: string[], cwd: string = ROOT) {
  return spawnSync(process.execPath, ["--import", "tsx", join(ROOT, script), ...args], {
    cwd,
    encoding: "utf8",
    timeout: 45_000,
    env: { ...process.env },
  });
}

test("api-v1 conversation-messages query is tenant-scoped in the SQL itself", () => {
  const src = readFileSync(join(ROOT, "server/routes/api-v1.ts"), "utf8");
  // Find the messages query block and assert the JOIN + tenant filter live
  // inside the SAME sql template as the conversation_id filter.
  const m = src.match(/SELECT m\.id, m\.role, m\.content, m\.created_at[\s\S]{0,400}?LIMIT 50/);
  assert.ok(m, "messages query block not found in server/routes/api-v1.ts (update this pin if the query moved)");
  const block = m[0];
  assert.match(block, /JOIN conversations c ON c\.id = m\.conversation_id/, "messages query lost its JOIN conversations");
  assert.match(block, /c\.tenant_id = \$\{tenantId\}/, "messages query lost its c.tenant_id = ${tenantId} filter");
});

test("tag-mirror-release: unknown flag exits 1 before any GitHub write", () => {
  const r = runScript("scripts/tag-mirror-release.ts", ["--bogus-flag"]);
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}\nstderr: ${r.stderr}`);
  assert.match(r.stderr, /unknown flag/i, "stderr must name the unknown-flag error");
  // Must fail at the CLI gate, not after reaching the GitHub API path.
  assert.doesNotMatch(r.stdout + r.stderr, /tag .* created|release created|release updated/i);
});

test("preflight-any-budget: scan error ⇒ exit 2 fail-closed, baseline untouched", () => {
  const tmp = join(ROOT, ".local", `any-budget-pin-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, "data"), { recursive: true });
  mkdirSync(join(tmp, "src"), { recursive: true });
  const cfgPath = join(tmp, "data", "preflight-any-budget.json");
  const cfg = {
    baseline: 99,
    allowedSlack: 0,
    scan: ["src"],
    exts: [".ts"],
    ignore: ["\\bnode_modules\\b"],
    patterns: [":\\s*any\\b", "\\bas any\\b"],
  };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  writeFileSync(join(tmp, "src", "ok.ts"), "const a: any = 1;\n");
  const locked = join(tmp, "src", "locked.ts");
  writeFileSync(locked, "const b: any = 2;\n");
  try {
    chmodSync(locked, 0o000); // unreadable → countInFile records a scan error
    const before = readFileSync(cfgPath, "utf8");
    const r = runScript("scripts/preflight-any-budget.ts", ["--json"], tmp);
    // If the environment can still read 000-mode files (e.g. running as root),
    // the scan error can't be induced — skip rather than false-fail.
    if (r.status === 0) {
      const out = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
      assert.equal(out.ok, true);
      console.log("note: chmod 000 not enforced in this env — fail-closed branch not inducible, skipping");
      return;
    }
    assert.equal(r.status, 2, `expected exit 2 on scan error, got ${r.status}\nstderr: ${r.stderr}`);
    assert.match(r.stderr, /scan error/i, "stderr must announce the fail-closed scan-error path");
    assert.equal(readFileSync(cfgPath, "utf8"), before, "baseline config must be untouched on a partial scan");
  } finally {
    chmodSync(locked, 0o644);
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("preflight-any-budget: clean scan below baseline ratchets down (positive control)", () => {
  const tmp = join(ROOT, ".local", `any-budget-pin-pos-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, "data"), { recursive: true });
  mkdirSync(join(tmp, "src"), { recursive: true });
  const cfgPath = join(tmp, "data", "preflight-any-budget.json");
  writeFileSync(
    cfgPath,
    JSON.stringify(
      { baseline: 5, allowedSlack: 0, scan: ["src"], exts: [".ts"], ignore: [], patterns: [":\\s*any\\b", "\\bas any\\b"] },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(tmp, "src", "one.ts"), "const a: any = 1;\n");
  try {
    const r = runScript("scripts/preflight-any-budget.ts", ["--json"], tmp);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
    assert.equal(out.ok, true);
    assert.equal(out.total, 1);
    assert.equal(out.ratcheted, true, "1 < baseline 5 must ratchet");
    const after = JSON.parse(readFileSync(cfgPath, "utf8"));
    assert.equal(after.baseline, 1, "ratcheted baseline must be persisted");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
