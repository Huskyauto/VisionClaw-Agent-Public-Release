import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as weeklyMaintenance from "../server/weekly-maintenance-cron";
import * as autoTuner from "../server/auto-tuner";
import { getRegisteredKinds, withWeeklyJobLease } from "../server/job-worker";

const weeklyCronSource = readFileSync(new URL("../server/weekly-maintenance-cron.ts", import.meta.url), "utf8");
const jobQueueSource = readFileSync(new URL("../server/job-queue.ts", import.meta.url), "utf8");
const jobWorkerSource = readFileSync(new URL("../server/job-worker.ts", import.meta.url), "utf8");
const emailSource = readFileSync(new URL("../server/email.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");

test("weekly maintenance uses a stable UTC ISO-week dedupe key", () => {
  const monday = new Date("2026-09-28T00:00:00.000Z");
  assert.equal(weeklyMaintenance.getWeeklyMaintenanceDedupeKey(monday), "weekly-maintenance:2026-W40");
  assert.equal(
    weeklyMaintenance.getWeeklyMaintenanceDedupeKey(new Date("2026-10-04T23:59:59.999Z")),
    weeklyMaintenance.getWeeklyMaintenanceDedupeKey(monday),
  );
  assert.notEqual(
    weeklyMaintenance.getWeeklyMaintenanceDedupeKey(new Date("2026-10-05T00:00:00.000Z")),
    weeklyMaintenance.getWeeklyMaintenanceDedupeKey(monday),
  );
});

test("weekly scheduled work uses transactional tenant-scoped queue deduplication", () => {
  assert.match(weeklyCronSource, /const SCHEDULED_JOB_KIND = "weekly_maintenance"/);
  assert.match(weeklyCronSource, /enqueueUniqueJob\(\s*SCHEDULED_JOB_KIND/);
  assert.match(weeklyCronSource, /enqueueScheduledWeeklyMaintenance\(\)/);
  assert.match(jobQueueSource, /pg_advisory_xact_lock\(hashtext/);
  assert.match(jobQueueSource, /WHERE kind = \$\{kind\}\s+AND tenant_id = \$\{opts\.tenantId\}\s+AND payload->>'dedupeKey' = \$\{dedupeKey\}/);
  assert.match(jobWorkerSource, /registerJobHandler\("weekly_maintenance"/);
  assert.match(jobWorkerSource, /if \(!result\.ok\) \{[\s\S]*?throw new Error\("weekly_maintenance execution failed"\)/);
  assert.ok(getRegisteredKinds().includes("weekly_maintenance"));
});

test("queue failure keeps a retryable maintenance attempt pending", () => {
  const failJobStart = jobQueueSource.indexOf("export async function failJob(");
  const failJobEnd = jobQueueSource.indexOf("export async function cancelJob(", failJobStart);
  const failJobSource = jobQueueSource.slice(failJobStart, failJobEnd);
  assert.match(failJobSource, /SET status = 'pending'[\s\S]*?WHERE id = \$\{id\}[\s\S]*?AND status = 'running'[\s\S]*?AND attempts = \$\{attempts\}/);
  assert.match(failJobSource, /attempts >= maxAttempts/);
  assert.match(jobWorkerSource, /await failJob\(job\.id, job\.attempts, msg\)/);
});

test("weekly lease renewal is fenced by tenant, job, attempt, status, and live expiry", () => {
  const renewStart = jobQueueSource.indexOf("export async function renewJobLease(");
  const renewEnd = jobQueueSource.indexOf("export type WeeklyMaintenanceEmailState", renewStart);
  const renewSource = jobQueueSource.slice(renewStart, renewEnd);
  assert.match(renewSource, /WHERE id = \$\{id\}[\s\S]*?AND tenant_id = \$\{tenantId\}[\s\S]*?AND attempts = \$\{attempts\}[\s\S]*?AND status = 'running'[\s\S]*?AND lease_until > NOW\(\)/);
  assert.match(jobQueueSource, /WHERE id = \$\{id\}[\s\S]*?AND tenant_id = \$\{tenantId\}[\s\S]*?weeklyMaintenanceEmailState/);
  assert.match(jobQueueSource, /AND lease_until > NOW\(\)[\s\S]*?RETURNING id/);
  assert.match(jobQueueSource, /priorState === "ambiguous" \|\| priorState === "started"\) return "ambiguous"/);
  assert.match(jobQueueSource, /priorState !== "rejected"/);
  assert.match(jobWorkerSource, /beforeEmail: async \(\) => \{\s*await assertOwned\(\);\s*return beginWeeklyMaintenanceEmailAttempt/);
  assert.match(jobQueueSource, /export async function completeJob[\s\S]*?AND lease_until > NOW\(\)/);
  assert.match(jobWorkerSource, /if \(err instanceof WeeklyJobLeaseLost\)[\s\S]*?return;/);
});

test("email provider rejection is retryable; ambiguous acceptance is not claimed", () => {
  assert.equal(weeklyMaintenance.classifyWeeklyEmailFailure({ status: 401 }), "rejected");
  assert.equal(weeklyMaintenance.classifyWeeklyEmailFailure({ status: 429 }), "rejected");
  assert.equal(weeklyMaintenance.classifyWeeklyEmailFailure({ status: 408 }), "ambiguous");
  assert.equal(weeklyMaintenance.classifyWeeklyEmailFailure({ status: 503 }), "ambiguous");
  assert.equal(weeklyMaintenance.classifyWeeklyEmailFailure(new Error("socket timeout")), "ambiguous");
  assert.match(jobWorkerSource, /result\.emailOutcome === "rejected"[\s\S]*?throw new Error/);
  assert.match(weeklyCronSource, /\.\.\.\(options\.beforeEmail \? \{ retryAmbiguous: false \} : \{\}\)/);
  assert.match(emailSource, /err\.status === 429\s*\|\|\s*\(params\.retryAmbiguous !== false && \(!err\.status \|\| err\.status >= 500\)\)/);
});

test("missing or uncertain weekly email never closes the queue as succeeded", () => {
  assert.match(jobWorkerSource, /result\.emailOutcome !== "accepted"\)\s*\{\s*throw new WeeklyEmailNeedsReview/);
  assert.match(jobWorkerSource, /err instanceof WeeklyEmailNeedsReview[\s\S]*?failJob\(job\.id,\s*job\.attempts,\s*err\.message,\s*\{\s*stopRetry:\s*true/);
  assert.match(jobQueueSource, /const goTerminal = opts\.stopRetry === true \|\| !policy\.retryable/);
  assert.match(jobQueueSource, /if \(priorState === "ambiguous" \|\| priorState === "started"\) return "ambiguous"/);
});

test("authenticated manual trigger uses the same durable week-keyed queue", () => {
  const endpoint = routesSource.slice(routesSource.indexOf('app.post("/api/cron/weekly-maintenance"'), routesSource.indexOf("// Task #63", routesSource.indexOf('app.post("/api/cron/weekly-maintenance"')));
  assert.match(endpoint, /await enqueueScheduledWeeklyMaintenance\(\)/);
  assert.doesNotMatch(endpoint, /runScheduledMaintenance\(\)|runWeeklyMaintenance\(\)/);
  assert.match(weeklyCronSource, /export async function runScheduledMaintenance\(\): Promise<void> \{\s*await enqueueScheduledWeeklyMaintenance\(\)/);
});

test("weekly handler renewal continues while work is live", async () => {
  const job = { id: 41, kind: "weekly_maintenance", tenantId: 1, attempts: 2 } as any;
  let renewals = 0;
  const result = await withWeeklyJobLease(job, async (context) => {
    await new Promise((resolve) => setTimeout(resolve, 8));
    await context.assertLeaseOwned();
    return "finished";
  }, {
    renewLease: async () => { renewals += 1; return new Date(Date.now() + 300_000); },
    renewalIntervalMs: 2,
    maxRuntimeMs: 1_000,
  });
  assert.equal(result, "finished");
  assert.ok(renewals >= 3);
});

test("lost weekly claim refuses the pre-email ownership gate and never completes", async () => {
  const job = { id: 42, kind: "weekly_maintenance", tenantId: 1, attempts: 3 } as any;
  let renewals = 0;
  let emailSideEffectStarted = false;
  const work = withWeeklyJobLease(job, async (context) => {
    await new Promise((resolve) => setTimeout(resolve, 12));
    await context.assertLeaseOwned();
    emailSideEffectStarted = true;
  }, {
    renewLease: async () => {
      renewals += 1;
      return renewals === 1 ? new Date(Date.now() + 300_000) : null;
    },
    renewalIntervalMs: 1,
    maxRuntimeMs: 1_000,
  });
  await assert.rejects(work, /fenced lease renewal found no live owned claim/i);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(renewals >= 2);
  assert.equal(emailSideEffectStarted, false);
});

test("only durable recent tuner evidence suppresses the immediate startup cycle", () => {
  const now = 10_000_000;
  assert.equal(autoTuner.hasRecentTuningEvidence(now - 59_000, now, 86_400_000), true);
  assert.equal(autoTuner.hasRecentTuningEvidence(now - 86_400_001, now, 86_400_000), false);
  assert.equal(autoTuner.hasRecentTuningEvidence(null, now, 86_400_000), false);
  assert.equal(autoTuner.hasRecentTuningEvidence(Number.NaN, now, 86_400_000), false);
});

test("concurrent tuner cycles join only within the same tenant", async () => {
  let completeFirst!: (value: string) => void;
  let firstRuns = 0;
  const first = autoTuner.withTuningCycleLock(1, async () => {
    firstRuns += 1;
    return new Promise<string>((resolve) => { completeFirst = resolve; });
  });
  const duplicate = autoTuner.withTuningCycleLock(1, async () => {
    firstRuns += 1;
    return "unexpected second run";
  });
  let secondTenantRuns = 0;
  const otherTenant = autoTuner.withTuningCycleLock(2, async () => {
    secondTenantRuns += 1;
    return "separate tenant";
  });

  assert.equal(firstRuns, 1);
  assert.equal(await otherTenant, "separate tenant");
  assert.equal(secondTenantRuns, 1);
  completeFirst("shared cycle");
  assert.deepEqual(await Promise.all([first, duplicate]), ["shared cycle", "shared cycle"]);
});