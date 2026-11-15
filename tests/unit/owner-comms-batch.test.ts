import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderOwnerCommsBatch, isOwnerCommsSchedule, prepareOwnerCommsBatch, ownerWeekDate, type OwnerCommsEvidence } from "../../server/lib/owner-comms-batch";

const now = new Date("2026-11-09T19:00:00Z");
const fixture = (): OwnerCommsEvidence => ({
  now, weight: { currentWeight: 264, totalLost: 240, startWeight: 504, updatedAt: new Date("2026-11-09T12:00:00Z") },
  jobs: [{ name: "Revenue Mission Opportunity Scan (weekly)", status: "success",
    createdAt: now, output: "no proposal: portfolio at capacity (2/2 active unproven) — kill or prove before proposing" }],
  notifications: [], wedges: [], legacyJobsEnabled: 5,
  weekly: {
    id: 463, date: "2026-11-09", createdAt: now, winner: "AI cost tracker tool for completed tasks",
    expectedProfitUsd: 1200, successProbabilityPct: 28, roi: 4.69,
    verdict: "Skip—too narrow ICP", confidence: "Low",
  },
});

test("batch uses current evidence, distinguishes fresh weight and a completed no-proposal scan", () => {
  const text = renderOwnerCommsBatch(fixture());
  assert.match(text, /264 lb/);
  assert.match(text, /240 lb lost/);
  assert.match(text, /504 lb start/);
  assert.match(text, /no reminder needed/i);
  assert.match(text, /scan completed.*no proposal.*capacity/i);
  assert.match(text, /AI cost tracker/);
  assert.match(text, /2026-11-09/);
  assert.match(text, /1,200/);
  assert.match(text, /not earnings/i);
  assert.match(text, /Skip/);
  assert.doesNotMatch(text, /admin@visionclaw\.ai|2612|transcript|90-day agent|No.*data found/i);
});

test("old or future records cannot become current because they were recalled today", () => {
  const e = fixture();
  e.weight.updatedAt = new Date("2026-11-01T12:00:00Z");
  e.jobs[0].createdAt = new Date("2026-11-02T18:59:59Z");
  e.weekly!.date = "2026-11-02";
  e.notifications = [{ title: "old transcript blocker", createdAt: new Date("2026-10-01") },
    { title: "future claim", createdAt: new Date("2026-11-10") }];
  e.wedges = [{ name: "Audit Pro", currentState: "2026-10-26 · stage:traction · signups 7d=5/21d=5 · paid orders 7d=0" }];
  const text = renderOwnerCommsBatch(e);
  assert.doesNotMatch(text, /264 lb|AI cost tracker|old transcript|future claim|Audit Pro/);
  assert.match(text, /last recorded.*2026-11-01/i);
  assert.match(text, /scan.*no.*verified.*result/i);
  assert.match(text, /no.*current.week.*report/i);
});

const job = { id: 2612, tenantId: 1, title: "Owner Communications Batch (Monday 13:00)", source: "cron_scheduler", expandViaPersona: "6" };
test("only the owner's exact existing schedule is handled; canonical owner email replaces historical target", async () => {
  assert.equal(isOwnerCommsSchedule(job, 1), true);
  for (const change of [{ tenantId: 2 }, { id: 9000 }]) {
    assert.equal(isOwnerCommsSchedule({ ...job, ...change }, 1), false);
  }
  let reads = 0;
  const dependencies = { ownerTenantId: 1, ownerEmail: "owner@example.test",
    load: async (tenantId: number, at: Date) => {
      assert.equal(tenantId, 1);
      assert.equal(at, now);
      reads++;
      return fixture();
    } };
  const result = await prepareOwnerCommsBatch(job, now, dependencies);
  assert.deepEqual(result.target, { channel: "email", email: "owner@example.test" });
  assert.match(result.text, /AI cost tracker/);
  assert.equal(reads, 1);
  await assert.rejects(prepareOwnerCommsBatch({ ...job, tenantId: 2 }, now, dependencies), /owner.*schedule/i);
  await assert.rejects(prepareOwnerCommsBatch(job, now, { ...dependencies, ownerEmail: "" }), /owner email/i);
  await assert.rejects(prepareOwnerCommsBatch(job, now, { ...dependencies, ownerEmail: "admin@visionclaw.ai" }), /owner email/i);
  assert.equal(reads, 1, "authorization and recipient validation happen before private reads");
  for (const change of [{ title: "Renamed" }, { source: "user" }, { expandViaPersona: 2 }]) {
    assert.equal(isOwnerCommsSchedule({ ...job, ...change }, 1), true, "reserved row cannot fall back to chat when its fields drift");
    await assert.rejects(prepareOwnerCommsBatch({ ...job, ...change }, now, dependencies), /schedule.*changed/i);
  }
  assert.equal(reads, 1);
  await assert.rejects(prepareOwnerCommsBatch(job, now, { ...dependencies, load: async () => { throw new Error("source unavailable"); } }), /source unavailable/);
});

test("scheduler selects provenance and takes the claimed deterministic branch before persona expansion", () => {
  const source = readFileSync(new URL("../../server/recurring-messages.ts", import.meta.url), "utf8");
  const runner = source.slice(source.indexOf("async function _runDueInner"));
  assert.match(runner, /SELECT id, title, content, tenant_id, source/);
  assert.ok(runner.indexOf("runClaimedRecurringOccurrence") < runner.indexOf("buildOwnerCommsBatch(batchJob, now)"));
  assert.match(runner, /if \(isOwnerCommsSchedule\(batchJob, ownerTenantId\(\)\)\)[\s\S]*?await buildOwnerCommsBatch\(batchJob, now\)[\s\S]*?else if \(p.expandViaPersona\)/);
  assert.match(runner, /deliverMessage\(target,/);
});

test("failed scans are visible, only current wedge metrics are reported, sections retain their priority and budget", () => {
  const e = fixture();
  e.jobs[0].status = "error";
  e.notifications = Array.from({ length: 20 }, () => ({ title: "a ".repeat(150), createdAt: now }));
  e.wedges = Array.from({ length: 10 }, () => ({ name: "b ".repeat(150),
    currentState: "2026-10-26 · stage:traction · signups 7d=5/21d=5 · paid orders 7d=0\n2026-11-09 · stage:traction · signups 7d=0/21d=5 · paid orders 7d=0" }));
  const text = renderOwnerCommsBatch(e);
  assert.match(text, /Scan failed/);
  assert.doesNotMatch(text, /Scan completed|5 signups/);
  assert.match(text, /0 signups and 0 paid orders in 7 days/);
  assert.ok(text.split(/\s+/).length <= 400);
  assert.ok(text.length <= 3900);
  for (let i = 1; i < 5; i++) assert.ok(text.indexOf(`${i})`) < text.indexOf(`${i + 1})`));
});

test("week identity follows Chicago even when UTC has already reached Monday", () => {
  assert.equal(ownerWeekDate(new Date("2026-11-09T05:59:00Z")), "2026-11-02");
  assert.equal(ownerWeekDate(new Date("2026-11-09T06:00:00Z")), "2026-11-09");
});

test("late previous-Monday scan and wedge results are not this week's evidence", () => {
  const e = fixture();
  e.jobs[0].createdAt = new Date("2026-11-02T23:30:00Z"); // Within rolling seven days.
  e.wedges = [{ name: "Audit Pro", currentState: "2026-11-02 · stage:traction · signups 7d=5/21d=5 · paid orders 7d=0" }];
  const text = renderOwnerCommsBatch(e);
  assert.doesNotMatch(text, /Scan completed|Audit Pro|5 signups/);
  assert.match(text, /no verified result/);
  assert.doesNotMatch(text, /Consolidation incomplete/);
});
