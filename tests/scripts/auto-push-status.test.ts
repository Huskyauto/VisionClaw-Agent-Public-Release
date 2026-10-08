import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const helper = path.resolve(import.meta.dirname, "../../scripts/lib/auto-push-status.sh");

test("audit run-state alone cannot generate a backup commit, but review decisions and code can", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "auto-push-status-"));
  const run = (command: string) => {
    const result = spawnSync("bash", ["-c", command], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  try {
    run("git init -q && git config user.email test@local && git config user.name test");
    mkdirSync(path.join(dir, "data/tenant-isolation-audit"), { recursive: true });
    mkdirSync(path.join(dir, "docs"));
    writeFileSync(path.join(dir, "data/tenant-isolation-audit/degraded-latest.json"), "old");
    writeFileSync(path.join(dir, "docs/tenant-isolation-audit-report-degraded.md"), "old");
    writeFileSync(path.join(dir, "data/tenant-isolation-audit/deferrals.json"), "old");
    writeFileSync(path.join(dir, "app.ts"), "old");
    run("git add -A && git commit -qm baseline");

    writeFileSync(path.join(dir, "data/tenant-isolation-audit/degraded-latest.json"), "new");
    writeFileSync(path.join(dir, "docs/tenant-isolation-audit-report-degraded.md"), "new");
    writeFileSync(path.join(dir, "data/tenant-isolation-audit/checkpoint.json"), "run-state");
    assert.equal(run(`source "${helper}"; auto_push_actionable_status`), "");

    writeFileSync(path.join(dir, "data/tenant-isolation-audit/deferrals.json"), "reviewed");
    assert.match(run(`source "${helper}"; auto_push_actionable_status`), /deferrals\.json/);

    run("git add -A && git commit -qm reviewed");
    writeFileSync(path.join(dir, "app.ts"), "updated");
    assert.match(run(`source "${helper}"; auto_push_actionable_status`), /app\.ts/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});