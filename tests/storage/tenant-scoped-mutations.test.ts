import { test } from "node:test";
import assert from "node:assert/strict";

// These are live-DB contract tests when DATABASE_URL is available. They stay
// query-free in the default test environment while still proving the storage
// boundary's fail-closed validation.
const skip = !process.env.DATABASE_URL;

async function makeTenant(name: string): Promise<number> {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const result: any = await db.execute(sql`
    INSERT INTO tenants (name, email, password_hash)
    VALUES (${name}, ${name + "@tenant-mutation.test"}, 'x')
    RETURNING id
  `);
  return Number((result.rows || result)[0].id);
}

async function removeTenant(id: number): Promise<void> {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM heartbeat_tasks WHERE tenant_id = ${id}`);
  await db.execute(sql`DELETE FROM memory_entries WHERE tenant_id = ${id}`);
  await db.execute(sql`DELETE FROM tenants WHERE id = ${id}`);
}

test("memory mutations require a tenant scope even for empty batches", async () => {
  const { storage } = await import("../../server/storage");
  await assert.rejects(
    () => (storage as any).deleteMemoryEntry(1),
    /tenantId is required/,
  );
  await assert.rejects(
    () => (storage as any).touchMemoryEntries([], undefined),
    /tenantId is required/,
  );
});

test("wrong-tenant memory delete and touch are no-ops", { skip }, async () => {
  const { storage } = await import("../../server/storage");
  const tenantA = await makeTenant("memory-mutation-A-" + Date.now());
  const tenantB = await makeTenant("memory-mutation-B-" + Date.now());
  try {
    const entry = await storage.createMemoryEntry({
      fact: "tenant A fact",
      category: "test",
      source: "tenant-mutation-test",
      status: "active",
      tenantId: tenantA,
      personaId: null,
    } as any);

    await storage.touchMemoryEntries([entry.id], tenantB);
    const untouched = await storage.getMemoryEntry(entry.id, tenantA);
    assert.equal(untouched?.accessCount, 0);

    await storage.deleteMemoryEntry(entry.id, tenantB);
    const stillActive = await storage.getMemoryEntry(entry.id, tenantA);
    assert.equal(stillActive?.status, "active");

    await storage.touchMemoryEntries([entry.id], tenantA);
    await storage.deleteMemoryEntry(entry.id, tenantA);
    const deleted = await storage.getMemoryEntry(entry.id, tenantA);
    assert.equal(deleted?.status, "superseded");
  } finally {
    await removeTenant(tenantA);
    await removeTenant(tenantB);
  }
});

test("wrong-tenant heartbeat update is a no-op", { skip }, async () => {
  const { storage } = await import("../../server/storage");
  const tenantA = await makeTenant("heartbeat-mutation-A-" + Date.now());
  const tenantB = await makeTenant("heartbeat-mutation-B-" + Date.now());
  try {
    const task = await storage.createHeartbeatTask({
      name: "tenant mutation test",
      description: "tenant mutation test",
      type: "test",
      cronExpression: "*/30 * * * *",
      enabled: true,
      promptContent: "tenant mutation test",
      model: "gpt-5-nano",
      personaId: null,
      createdBy: "test",
      parentTaskId: null,
      runOnce: false,
      tenantId: tenantA,
    } as any);

    const wrongTenant = await storage.updateHeartbeatTask(
      task.id,
      { enabled: false },
      tenantB,
    );
    assert.equal(wrongTenant, undefined);
    const unchanged = await storage.getHeartbeatTask(task.id, tenantA);
    assert.equal(unchanged?.enabled, true);

    const ownTenant = await storage.updateHeartbeatTask(
      task.id,
      { enabled: false },
      tenantA,
    );
    assert.equal(ownTenant?.enabled, false);
  } finally {
    await removeTenant(tenantA);
    await removeTenant(tenantB);
  }
});

test("heartbeat update rejects an omitted tenant scope", async () => {
  const { storage } = await import("../../server/storage");
  await assert.rejects(
    () => (storage as any).updateHeartbeatTask(1, { enabled: false }),
    /tenantId is required/,
  );
});