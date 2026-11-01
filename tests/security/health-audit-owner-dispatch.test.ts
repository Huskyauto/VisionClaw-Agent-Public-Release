import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("scheduled global health maintenance checks owner authority before importing or applying", () => {
  const source = readFileSync("server/heartbeat.ts", "utf8");
  const start = source.indexOf('if (task.type === "health_audit")');
  const branch = source.slice(start, source.indexOf("const highCount", start));
  assert.ok(branch.includes("assertHealthAuditOwner(task.tenantId)"),
    "a customer-approved task type must not be sufficient for global maintenance");
  assert.ok(branch.indexOf("assertHealthAuditOwner(task.tenantId)") <
    branch.indexOf('await import("./health-audit")'));
});

test("health-audit owner gate rejects absent, malformed and non-owner tenant identities", async () => {
  const { assertHealthAuditOwner } = await import("../../server/lib/health-audit-authority");
  assert.doesNotThrow(() => assertHealthAuditOwner(1));
  for (const tenant of [undefined, null, 0, 2, -1, NaN, "1", { tenantId: 1 }]) {
    assert.throws(() => assertHealthAuditOwner(tenant));
  }
});
