import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../../server/db";
import {
  getRecoveryCheckpoint,
  listRecoveryCheckpoints,
  listRecoveryTimeline,
  recordRecoveryCheckpoint,
} from "../../server/recovery-manifests";
import { appendStep, createRun, failRun, updateRunState } from "../../server/agentic/runs";
import { withTenantContext } from "../../server/lib/tenant-context";
import { withRootSpan } from "../../server/lib/agent-trace";

// The seed tenant is the durable owner tenant. The other ID is used only for a
// tenant-scoped read predicate; no tenant-2 data is required to prove it cannot
// read a uniquely-scoped tenant-1 record.
const TENANT_A = 1;
const TENANT_B = 2;
const TRACE_ID = `recovery-test-${randomUUID()}`;
const createdRunIds: Array<{ tenantId: number; runId: number }> = [];

after(async () => {
  await pool.query("DELETE FROM agent_recovery_manifests WHERE tenant_id = $1 AND trace_id = $2", [TENANT_A, TRACE_ID]).catch(() => {});
  for (const run of createdRunIds) {
    await pool.query("DELETE FROM agent_recovery_manifests WHERE tenant_id = $1 AND run_id = $2", [run.tenantId, run.runId]).catch(() => {});
    await pool.query("DELETE FROM agent_runs WHERE tenant_id = $1 AND id = $2", [run.tenantId, run.runId]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

test("recovery manifests are append-only, idempotent, ordered, and tenant-scoped", async () => {
  const base = {
    tenantId: TENANT_A,
    scope: { traceId: TRACE_ID },
    eventType: "trace.root.started",
    eventIndex: 0,
    state: { phase: "started", apiKey: "must-not-persist" },
    payload: { component: "test", authorization: "Bearer must-not-persist" },
  };

  const first = await recordRecoveryCheckpoint(base);
  assert.equal(first.recorded, true);
  assert.ok(first.record);
  assert.doesNotMatch(JSON.stringify(first.record?.payload), /must-not-persist/);

  const duplicate = await recordRecoveryCheckpoint(base);
  assert.equal(duplicate.recorded, false);
  assert.equal(duplicate.record?.id, first.record?.id);

  const final = await recordRecoveryCheckpoint({
    ...base,
    eventType: "trace.root.completed",
    eventIndex: 1,
    state: { phase: "completed" },
  });
  assert.equal(final.recorded, true);

  const timeline = await listRecoveryTimeline({ tenantId: TENANT_A, traceId: TRACE_ID });
  assert.deepEqual(timeline.map((row) => row.eventType), ["trace.root.started", "trace.root.completed"]);
  assert.equal((timeline[0].nextCursor as any).mode, "inspect-only");

  const otherTenantList = await listRecoveryCheckpoints({ tenantId: TENANT_B, traceId: TRACE_ID });
  assert.equal(otherTenantList.length, 0);
  const otherTenantRead = await getRecoveryCheckpoint(TENANT_B, first.record!.id);
  assert.equal(otherTenantRead, undefined);
});

test("agent-run durable boundaries create report-only recovery evidence", async () => {
  const run = await createRun({
    tenantId: TENANT_A,
    runType: "recovery-manifest-test",
    goal: "This goal must not be copied into recovery payloads.",
    state: { stage: "created", token: "must-not-persist" },
  });
  createdRunIds.push({ tenantId: TENANT_A, runId: run.id });

  await withTenantContext({ tenantId: TENANT_A, source: "explicit" }, () =>
    withRootSpan(
      { recoveryScope: { runId: run.id }, agentName: "recovery-manifest-test" },
      async () => undefined,
    ),
  );
  await updateRunState(run.id, TENANT_A, { stage: "research" });
  await updateRunState(run.id, TENANT_A, { stage: "analysis" });
  await appendStep(run.id, TENANT_A, {
    at: new Date().toISOString(),
    step: "collect",
    status: "completed",
    detail: { authorization: "Bearer must-not-persist" },
  });
  await failRun(run.id, TENANT_A, "simulated stopped worker Bearer secret-token-that-must-not-persist");

  const timeline = await listRecoveryTimeline({ tenantId: TENANT_A, runId: run.id });
  assert.deepEqual(timeline.map((row) => row.eventType), [
    "run.created",
    "trace.root.started",
    "trace.root.completed",
    "run.state.updated",
    "run.state.updated",
    "run.step.completed",
    "run.failed",
  ]);
  assert.deepEqual(timeline.map((row) => row.eventIndex), [0, 1, 2, 3, 4, 5, 6]);
  const persisted = JSON.stringify(timeline);
  assert.doesNotMatch(persisted, /This goal must not be copied/);
  assert.doesNotMatch(persisted, /must-not-persist/);
  assert.doesNotMatch(persisted, /secret-token-that-must-not-persist/);
  assert.ok(timeline.every((row) => (row.nextCursor as any).mode === "inspect-only"));
});

test("recovery evidence rejects a run identifier owned by another tenant", async () => {
  const foreignRun = await createRun({
    tenantId: TENANT_B,
    runType: "recovery-manifest-ownership-test",
    goal: "ownership check",
  });
  createdRunIds.push({ tenantId: TENANT_B, runId: foreignRun.id });

  await assert.rejects(
    recordRecoveryCheckpoint({
      tenantId: TENANT_A,
      scope: { runId: foreignRun.id },
      eventType: "run.state.updated",
      eventIndex: 1,
      state: {},
    }),
    /not found for tenant/,
  );
});