import { test, after } from "node:test";
import assert from "node:assert/strict";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// Live-DB IDOR test for the conversation row-level helpers.
// Skipped automatically when no DATABASE_URL is configured (so it runs in
// dev and in CI when Postgres is provisioned, and is a no-op otherwise).
//
// Proves the round-16 fix: storage.getConversation(id, tenantId) and
// storage.updateConversation(id, data, tenantId) return undefined / no-op
// when the requested row belongs to a different tenant. Before this fix
// the routes had to remember the check; now the SQL layer enforces it.

const skip = !process.env.DATABASE_URL;

async function makeTenant(name: string): Promise<number> {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const r: any = await db.execute(sql`
    INSERT INTO tenants (name, email, password_hash)
    VALUES (${name}, ${name + "@idor.test"}, 'x')
    RETURNING id
  `);
  const rows = r.rows || r;
  return Number(rows[0].id);
}

async function dropTenant(id: number) {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM conversations WHERE tenant_id = ${id}`);
  await db.execute(sql`DELETE FROM tenants WHERE id = ${id}`);
}

test("storage.getConversation rejects cross-tenant read when scoped", { skip }, async () => {
  const { storage } = await import("../../server/storage");
  const tenantA = await makeTenant("idor-A-" + Date.now());
  const tenantB = await makeTenant("idor-B-" + Date.now());
  try {
    const convA = await storage.createConversation({
      tenantId: tenantA,
      title: "idor-test-A",
      model: "deepseek/deepseek-v3.2",
      thinking: false,
      personaId: null,
    } as any);
    const sameTenant = await storage.getConversation(convA.id, tenantA);
    assert.ok(sameTenant, "scoped read for the owning tenant must succeed");
    assert.equal(sameTenant!.id, convA.id);

    const crossTenant = await storage.getConversation(convA.id, tenantB);
    assert.equal(crossTenant, undefined, "scoped read for a different tenant must return undefined");

    // R115.5+sec round 3 — getConversation now mandates tenantId on the
    // public path. The explicit escape hatch for orchestration entrypoints
    // is getConversationUnscoped(id).
    const unscoped = await storage.getConversationUnscoped(convA.id);
    assert.ok(unscoped, "unscoped read still returns the row (admin path)");
  } finally {
    await dropTenant(tenantA);
    await dropTenant(tenantB);
  }
});

test("storage.getMessages returns empty when scoped to wrong tenant", { skip }, async () => {
  const { storage } = await import("../../server/storage");
  const tenantA = await makeTenant("idor-msg-A-" + Date.now());
  const tenantB = await makeTenant("idor-msg-B-" + Date.now());
  try {
    const conv = await storage.createConversation({
      tenantId: tenantA,
      title: "idor-msg",
      model: "deepseek/deepseek-v3.2",
      thinking: false,
      personaId: null,
    } as any);
    await storage.createMessage({
      tenantId: tenantA,
      conversationId: conv.id,
      role: "user",
      content: "secret-A",
    } as any);
    const own = await storage.getMessages(conv.id, tenantA);
    assert.equal(own.length, 1, "owner sees their message");
    const cross = await storage.getMessages(conv.id, tenantB);
    assert.equal(cross.length, 0, "wrong tenant sees zero messages");
    const paginated = await storage.getMessagesPaginated(conv.id, 100, 0, tenantB);
    assert.equal(paginated.messages.length, 0, "paginated wrong-tenant sees zero");
    assert.equal(paginated.total, 0, "paginated count must NOT leak existence");
  } finally {
    await dropTenant(tenantA);
    await dropTenant(tenantB);
  }
});

test("storage.updateConversation rejects cross-tenant write when scoped", { skip }, async () => {
  const { storage } = await import("../../server/storage");
  const tenantA = await makeTenant("idor-upd-A-" + Date.now());
  const tenantB = await makeTenant("idor-upd-B-" + Date.now());
  try {
    const convA = await storage.createConversation({
      tenantId: tenantA,
      title: "idor-test-update",
      model: "deepseek/deepseek-v3.2",
      thinking: false,
      personaId: null,
    } as any);
    const wrongScope = await storage.updateConversation(
      convA.id,
      { title: "HIJACKED" },
      tenantB,
    );
    assert.equal(wrongScope, undefined, "scoped write for a different tenant must return undefined");
    // R115.5+sec round 3 — use the explicit unscoped escape hatch.
    const unchanged = await storage.getConversationUnscoped(convA.id);
    assert.equal(unchanged!.title, "idor-test-update", "row must NOT have been mutated");
  } finally {
    await dropTenant(tenantA);
    await dropTenant(tenantB);
  }
});
