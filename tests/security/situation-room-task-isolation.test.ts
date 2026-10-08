import assert from "node:assert/strict";
import test from "node:test";
import { collectHeartbeatTasksForTenant, type TrackedHeartbeatTask } from "../../server/lib/situation-room-task-collector";

test("situation-room running task names, personas, and timestamps are isolated between tenants", () => {
  const tracker = new Map<number, TrackedHeartbeatTask>([
    [1, { tenantId: 2, taskName: "tenant-2 confidential task", personaId: 2, personaName: "Tenant Two", startedAt: 2000 }],
    [2, { tenantId: 3, taskName: "tenant-3 confidential task", personaId: 3, personaName: "Tenant Three", startedAt: 3000 }],
    [3, { taskName: "legacy unscoped confidential task", personaId: 4, personaName: "Unscoped Persona", startedAt: 4000 }],
  ]);

  tracker.set(4, { tenantId: 2, taskName: "tenant-2 own task", personaId: 5, personaName: "Own Persona", startedAt: 5000 });
  const tenantTwo = collectHeartbeatTasksForTenant(2, tracker);
  const tenantThree = collectHeartbeatTasksForTenant(3, tracker);

  assert.deepEqual(tenantTwo, [
    { taskName: "tenant-2 confidential task", personaName: "Tenant Two", runningSince: "2000" },
    { taskName: "tenant-2 own task", personaName: "Own Persona", runningSince: "5000" },
  ]);
  assert.deepEqual(tenantThree, [
    { taskName: "tenant-3 confidential task", personaName: "Tenant Three", runningSince: "3000" },
  ]);
  assert.doesNotMatch(JSON.stringify(tenantTwo), /tenant-3 confidential|Tenant Three|3000/);
  assert.doesNotMatch(JSON.stringify(tenantThree), /tenant-2 confidential|Tenant Two|2000|tenant-2 own|Own Persona|5000/);
});

test("missing, nonpositive, and malformed tenant context fails without exposing tracked task data", () => {
  const tracker = new Map<number, TrackedHeartbeatTask>([
    [1, { tenantId: 2, taskName: "secret task name", personaId: 2, personaName: "Secret Persona", startedAt: 1000 }],
  ]);

  for (const tenantId of [undefined, null, 0, -1, 2.5, Number.NaN]) {
    let error: unknown;
    try {
      collectHeartbeatTasksForTenant(tenantId as number, tracker);
    } catch (caught) {
      error = caught;
    }
    assert.match(String(error), /positive trusted tenant ID is required/);
    assert.doesNotMatch(String(error), /secret task name|Secret Persona|1000/);
  }
});