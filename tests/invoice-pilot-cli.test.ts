import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { syntheticInvoicePilot } from "../server/lib/invoice-pilot-evaluation";

function run(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/evaluate-invoice-pilot.ts", ...args], {
    encoding: "utf8", timeout: 10_000,
    // No database, provider or owner credentials inherited by this scorer test.
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

test("operator CLI demonstrates synthetic scoring but never certifies readiness", () => {
  const result = run("--demo");
  assert.equal(result.status, 0);
  const score = JSON.parse(result.stdout);
  assert.equal(score.documents, 20);
  assert.equal(score.readyForPaidPilot, false);
  assert.deepEqual(score.blockers, ["real-sample-required"]);
  assert.doesNotMatch(result.stdout, /Example Supplier|EX-1|example_1/);
});

test("operator CLI rejects unknown flags before opening input", () => {
  const result = run("--dry-run");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});

test("operator CLI bounds input, refuses symlinks and returns a failure status for an insufficient pilot", t => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-pilot-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "private-sentinel.json");
  const input = syntheticInvoicePilot();
  input.dataClass = "customer-approved";
  writeFileSync(path, JSON.stringify(input));
  const passed = run("--input", path);
  assert.equal(passed.status, 0);
  assert.equal(JSON.parse(passed.stdout).readyForPaidPilot, true);
  input.predictions.pop();
  writeFileSync(path, JSON.stringify(input));
  const failed = run("--input", path);
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stdout).missingDocuments, 1);
  assert.doesNotMatch(failed.stdout + failed.stderr, /private-sentinel|Example Supplier/);
  writeFileSync(path, "x".repeat(1_048_577));
  const oversized = run("--input", path);
  assert.equal(oversized.status, 2);
  writeFileSync(path, '{"PRIVATE-SENTINEL"');
  const malformed = run("--input", path);
  assert.equal(malformed.status, 2);
  const link = join(dir, "symlink.json");
  symlinkSync(path, link);
  const symlink = run("--input", link);
  assert.equal(symlink.status, 2);
  for (const result of [oversized, malformed, symlink]) {
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /PRIVATE-SENTINEL|private-sentinel|SyntaxError| at /);
  }
});
