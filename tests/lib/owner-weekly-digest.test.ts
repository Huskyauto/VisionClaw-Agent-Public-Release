import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { enqueueForDigest, remainingAfterFlush } from "../../server/owner-email-digest";

const weekly = "🔴 [URGENT] Weekly Maintenance — RED — Week of 2026-09-21";
const entry = (subject: string, ts: string) => ({
  ts, subject, to: "owner@example.test", preview: "Maintenance is RED",
});

test("identical weekly reports occupy one digest entry with a visible repeat count", () => {
  const first = enqueueForDigest([], entry(weekly, "2026-09-21T10:00:00Z"), "Pass 1: HIGH: advisory A");
  const second = enqueueForDigest(first, entry(weekly, "2026-09-21T11:00:00Z"), "Pass 1: HIGH: advisory A");
  assert.equal(second.length, 1);
  assert.equal(second[0].repeatCount, 2);
  assert.equal(second[0].ts, "2026-09-21T11:00:00Z");
});

test("new findings, statuses, weeks, and unrelated emails never merge", () => {
  const first = enqueueForDigest([], entry(weekly, "2026-09-21T10:00:00Z"), "x".repeat(300) + "advisory A");
  assert.equal(enqueueForDigest(first, entry(weekly, "2026-09-21T11:00:00Z"), "x".repeat(300) + "advisory B").length, 2);
  assert.equal(enqueueForDigest(first, entry(weekly.replace("RED —", "YELLOW —"), "2026-09-21T11:00:00Z"), "x".repeat(300) + "advisory A").length, 2);
  assert.equal(enqueueForDigest(first, entry(weekly.replace("2026-09-21", "2026-09-28"), "2026-09-21T11:00:00Z"), "x".repeat(300) + "advisory A").length, 2);
  const other = entry("Payment failure — order 123", "2026-09-21T11:00:00Z");
  assert.equal(enqueueForDigest(enqueueForDigest([], other, "Failed"), other, "Failed").length, 2);
  assert.equal(enqueueForDigest(first, entry(weekly, "2026-09-21T11:00:00Z")).length, 2, "missing full report must not be deduped");
});

test("a flush preserves alerts queued during delivery, including repeats of an in-flight report", () => {
  const sent = enqueueForDigest([], entry(weekly, "2026-09-21T10:00:00Z"), "advisory A");
  const duringSend = enqueueForDigest(sent, entry(weekly, "2026-09-21T11:00:00Z"), "advisory A");
  const current = enqueueForDigest(duringSend, entry("New HIGH finding", "2026-09-21T11:01:00Z"), "New HIGH");
  const remaining = remainingAfterFlush(sent, current);
  assert.equal(remaining.length, 2);
  assert.equal(remaining[0].repeatCount, 1);
  assert.equal(remaining[0].ts, "2026-09-21T11:00:00Z");
  assert.equal(remaining[1].subject, "New HIGH finding");
});

test("a queue write failure cannot be reported as a successfully queued alert", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "owner-digest-failure-"));
  try {
    writeFileSync(join(sandbox, "data"), "not a directory");
    const modulePath = resolve("server/owner-email-digest.ts");
    const code = `
      process.chdir(${JSON.stringify(sandbox)});
      const { maybeQueueOwnerEmail } = await import(${JSON.stringify(modulePath)});
      try {
        const result = maybeQueueOwnerEmail({
          to: "owner@example.test", subject: ${JSON.stringify(weekly)}, text: "Finding A"
        });
        console.log(result.action);
      } catch { console.log("write-failed"); }
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
      cwd: process.cwd(), encoding: "utf8", timeout: 15_000,
      env: { ...process.env, OWNER_EMAIL: "owner@example.test", OWNER_EMAIL_MODE: "digest" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /write-failed/);
    assert.doesNotMatch(result.stdout, /queued/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("a state write failure does not claim an owner alert was queued successfully", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "owner-digest-state-failure-"));
  try {
    mkdirSync(join(sandbox, "data"));
    mkdirSync(join(sandbox, "data", "owner-email-digest-state.json"));
    const modulePath = resolve("server/owner-email-digest.ts");
    const code = `
      process.chdir(${JSON.stringify(sandbox)});
      const { maybeQueueOwnerEmail } = await import(${JSON.stringify(modulePath)});
      try {
        console.log(maybeQueueOwnerEmail({
          to: "owner@example.test", subject: ${JSON.stringify(weekly)}, text: "Finding A"
        }).action);
      } catch { console.log("state-write-failed"); }
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
      cwd: process.cwd(), encoding: "utf8", timeout: 15_000,
      env: { ...process.env, OWNER_EMAIL: "owner@example.test", OWNER_EMAIL_MODE: "digest" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /state-write-failed/);
    assert.doesNotMatch(result.stdout, /^queued$/m);
    assert.equal(JSON.parse(readFileSync(join(sandbox, "data", "owner-email-digest.json"), "utf8")).length, 1);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});