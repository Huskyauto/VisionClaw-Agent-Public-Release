import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { auditJobState } from "../../server/lib/tenant-audit-job-state";
import {
  isTenantAuditCheckpointValid, tenantAuditCheckpointChecksum,
} from "../../scripts/lib/tenant-audit-checkpoint";

// PostgreSQL jsonb retains values, not JavaScript object insertion order.
function jsonbOrder(value: any): any {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort((a, b) => a.length - b.length || a.localeCompare(b))
      .map(key => [key, jsonbOrder(value[key])]),
  );
  return value;
}
const finding = { file: "server/example.ts", severity: "HIGH", issue: "Fixture", line: 12 };
function fixture() {
  const unsigned = { version: 1 as const, sourceHash: "fixture-source", model: "fixture-model",
    chunksTotal: 3, completed: { "0": [finding] },
    updatedAt: "2026-10-25T00:00:00.000Z",
    pending: { chunk: 1, completed: { "0": { findings: [finding], provider: "replit", model: "gpt-fixture" } }, nextRoute: 4 } };
  return { ...unsigned, checksum: tenantAuditCheckpointChecksum(unsigned) };
}
function valid(checkpoint: any) {
  return isTenantAuditCheckpointValid({ checkpoint, sourceHash: "fixture-source",
    model: "fixture-model", chunksTotal: 3, routeCount: 5,
    isCompletedEntryValid: (entry: typeof finding) => entry.file === "server/example.ts" && entry.issue === "Fixture" });
}

test("durable audit checkpoint resumes after jsonb reorders all nested object keys", async () => {
  const original = fixture();
  assert.equal(valid(original), true);
  const restored = await auditJobState("auditCheckpoint", original, { id: 7, attempt: 2 },
    async () => ({ rows: [{ payload: { auditCheckpoint: jsonbOrder(original) } }] }));
  assert.notEqual(JSON.stringify(restored), JSON.stringify(original));
  assert.equal(valid(restored), true, "a database round trip must not restart completed source work");
  assert.deepEqual(restored.completed, original.completed);
  assert.deepEqual(restored.pending, original.pending);
});

test("order-independent audit checksums still reject source drift, gaps and changed findings", () => {
  const restored = jsonbOrder(fixture());
  assert.equal(valid({ ...restored, sourceHash: "changed-source" }), false);
  const gap = structuredClone(restored);
  gap.completed["2"] = [];
  gap.checksum = tenantAuditCheckpointChecksum((({ checksum, ...rest }) => rest)(gap));
  assert.equal(valid(gap), false);
  const altered = structuredClone(restored);
  altered.completed["0"][0].issue = "Changed";
  assert.equal(valid(altered), false);
});

test("legacy ordered local checkpoints remain readable without blessing altered bytes", () => {
  const { checksum, ...unsigned } = fixture();
  const legacy = { ...unsigned, checksum: createHash("sha256").update(JSON.stringify(unsigned)).digest("hex") };
  assert.equal(valid(legacy), true);
  legacy.completed["0"][0] = { ...finding, issue: "Changed" };
  assert.equal(valid(legacy), false);
});
