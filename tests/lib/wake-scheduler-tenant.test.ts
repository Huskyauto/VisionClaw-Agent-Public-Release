/**
 * Regression: scheduleWake must fail CLOSED on invalid tenantId BEFORE any DB
 * query (72h review follow-up). Query-free by design — the guard throws before
 * db.execute, so no pg pool activity occurs (see node-test-db-pool-hang memory).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleWake } from "../../server/agentic/wake-scheduler";

const base = { goal: "test goal", wakeAt: new Date(Date.now() + 60_000) };

for (const bad of [0, -1, 1.5, NaN, undefined as any, null as any, "1" as any]) {
  test(`scheduleWake rejects invalid tenantId ${String(bad)}`, async () => {
    await assert.rejects(
      () => scheduleWake({ ...base, tenantId: bad }),
      /valid positive integer tenantId/,
    );
  });
}
