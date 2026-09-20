import { test } from "node:test";
import assert from "node:assert/strict";
import { launchBwbWeeklyRecapFromOwnerWebChat } from "../../server/lib/bwb-web-chat-launch";
import { claimBwbLaunchJob, findActiveBwbLaunchJob } from "../../server/lib/bwb-job-progress";

const PROMPT = "Build this week’s Built With Bob weekly recap. Week window 2026-09-06 → 2026-09-12. Weight facts: current 269 lbs, total lost 235 lbs, start 504 lbs. Use the weekly builder on the GitHub render farm, auto-discover my Drive daily clips — don’t hand-write it.";

test("authenticated owner web chat routes an Agent Blueprint recap to Felix with a stable claim", async () => {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const result = await launchBwbWeeklyRecapFromOwnerWebChat(PROMPT, {
    ownerAuthorized: true,
    tenantId: 1,
    sourcePersonaId: 5,
    resolveFelix: async () => ({ id: 2, name: "Felix" }),
    enforcePolicy: async () => ({ action: "allow" }),
    execute: async (name, params) => {
      calls.push({ name, params });
      return { started: true, job_id: "vj_test_owner_chat" };
    },
  });

  assert.equal(result?.jobId, "vj_test_owner_chat");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "bwb_weekly_build");
  assert.deepEqual(calls[0].params, {
    weekStart: "2026-09-06",
    weekEnd: "2026-09-12",
    currentWeight: 269,
    totalLost: 235,
    startWeight: 504,
    _tenantId: 1,
    _personaId: 2,
    _launchKey: "owner-web-chat:1:2026-09-06:2026-09-12:269:235:504",
  });
});

test("non-owner and non-recap messages never execute", async () => {
  let executions = 0;
  const deps = {
    tenantId: 1,
    sourcePersonaId: 5,
    resolveFelix: async () => ({ id: 2, name: "Felix" }),
    enforcePolicy: async () => ({ action: "allow" as const }),
    execute: async () => {
      executions += 1;
      return { started: true, job_id: "vj_should_not_run" };
    },
  };
  assert.equal(await launchBwbWeeklyRecapFromOwnerWebChat(PROMPT, { ...deps, ownerAuthorized: false }), null);
  assert.equal(await launchBwbWeeklyRecapFromOwnerWebChat("Help me plan next week", { ...deps, ownerAuthorized: true }), null);
  assert.equal(executions, 0);
});

test("an unpinned request resolves to the actual completed week and preserves decimal weights", async () => {
  let params: Record<string, unknown> = {};
  await launchBwbWeeklyRecapFromOwnerWebChat(
    "Build this week’s Built With Bob weekly recap. Current 269.5 lbs, total lost 234.5 lbs, start 504 lbs.",
    {
      ownerAuthorized: true,
      tenantId: 1,
      sourcePersonaId: 5,
      now: new Date("2026-09-15T12:00:00-05:00"),
      resolveFelix: async () => ({ id: 2, name: "Felix" }),
      enforcePolicy: async () => ({ action: "allow" }),
      execute: async (_name, input) => {
        params = input;
        return { started: true, job_id: "vj_decimal_test" };
      },
    },
  );
  assert.equal(params.weekStart, "2026-09-06");
  assert.equal(params.weekEnd, "2026-09-12");
  assert.equal(params.currentWeight, 269.5);
  assert.equal(params.totalLost, 234.5);
  assert.equal(params._launchKey, "owner-web-chat:1:2026-09-06:2026-09-12:269.5:234.5:504");
});

test("Felix identity, policy, and durable launch acknowledgement fail closed", async () => {
  const base = {
    ownerAuthorized: true,
    tenantId: 1,
    sourcePersonaId: 5,
    execute: async () => ({ started: true, job_id: "vj_test" }),
  };
  await assert.rejects(
    launchBwbWeeklyRecapFromOwnerWebChat(PROMPT, {
      ...base,
      resolveFelix: async () => ({ id: 9, name: "Felix" }),
      enforcePolicy: async () => ({ action: "allow" }),
    }),
    /Felix identity/,
  );
  await assert.rejects(
    launchBwbWeeklyRecapFromOwnerWebChat(PROMPT, {
      ...base,
      resolveFelix: async () => ({ id: 2, name: "Felix" }),
      enforcePolicy: async () => ({ action: "block", reason: "approval required" }),
    }),
    /blocked by tool policy/,
  );
  await assert.rejects(
    launchBwbWeeklyRecapFromOwnerWebChat(PROMPT, {
      ...base,
      resolveFelix: async () => ({ id: 2, name: "Felix" }),
      enforcePolicy: async () => ({ action: "allow" }),
      execute: async () => ({ started: false }),
    }),
    /durable job acknowledgement/,
  );
});

test("terminal attempts advance to one deterministic replacement and concurrent retries reuse it", async () => {
  const rows = new Map<string, string>();
  const deps = {
    create: async ({ jobId }: any) => {
      if (rows.has(jobId)) return false;
      rows.set(jobId, "rendering");
      return true;
    },
    get: async (jobId: string) => rows.has(jobId) ? { jobId, status: rows.get(jobId)! } : null,
  };
  const first = await claimBwbLaunchJob({ launchKey: "owner-web-chat:1:2026-09-06:2026-09-12:269:235:504", tenantId: 1 }, deps as any);
  assert.equal(first?.created, true);
  rows.set(first!.jobId, "done");
  const [retryA, retryB] = await Promise.all([
    claimBwbLaunchJob({ launchKey: "owner-web-chat:1:2026-09-06:2026-09-12:269:235:504", tenantId: 1 }, deps as any),
    claimBwbLaunchJob({ launchKey: "owner-web-chat:1:2026-09-06:2026-09-12:269:235:504", tenantId: 1 }, deps as any),
  ]);
  assert.equal(retryA?.jobId, retryB?.jobId);
  assert.deepEqual([retryA?.created, retryB?.created].sort(), [false, true]);
  assert.equal(rows.size, 2);
  const active = await findActiveBwbLaunchJob(
    "owner-web-chat:1:2026-09-06:2026-09-12:269:235:504",
    1,
    { get: deps.get } as any,
  );
  assert.equal(active?.jobId, retryA?.jobId);
});