import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Explicit development opt-in: no live DB mutation in the default test suite.
test("engineering notebook SQL serializes first writes, isolates tenants and deduplicates uncertain-success retries",
  { skip: process.env.RUN_ENGINEERING_REFERENCE_DB_TEST !== "1" }, async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "Development fixture only");
    const { db } = await import("../../server/db");
    const { tenants } = await import("../../shared/schema");
    const { eq, inArray } = await import("drizzle-orm");
    const { engineeringReferenceStore: store } = await import("../../server/lib/engineering-reference-store");
    const created: number[] = [];
    try {
      for (let i = 0; i < 2; i++) {
        const [tenant] = await db.insert(tenants).values({
          name: "Engineering notebook isolated test",
          email: `${randomUUID()}@engineering-reference.invalid`,
          isActive: false,
        }).returning({ id: tenants.id });
        created.push(tenant.id);
      }
      const [first, second] = created;
      const initial = await store.read(first);
      assert.deepEqual(initial, { version: 0, notes: [] });
      const baseNote = {
        id: randomUUID(), question: "Fixture concurrency question",
        answer: "First writer", category: "Production" as const, sourceUrl: "",
      };
      const writes = [
        { version: 0, notes: [baseNote] },
        { version: 0, notes: [{ ...baseNote, answer: "Second writer" }] },
      ];
      const results = await Promise.all(writes.map(input => store.write(first, input)));
      assert.equal(results.filter(result => result.kind === "saved").length, 1);
      assert.equal(results.filter(result => result.kind === "conflict").length, 1);
      const winner = await store.read(first);
      assert.equal(winner.version, 1);
      assert.equal(winner.notes.length, 1);
      assert.deepEqual(await store.read(second), { version: 0, notes: [] });
      const retry = await store.write(first, { version: 0, notes: winner.notes });
      assert.deepEqual(retry, { kind: "saved", library: winner });
      const stale = await store.write(first, { version: 0, notes: [] });
      assert.equal(stale.kind, "conflict");
      assert.deepEqual(await store.read(first), winner);
      const cleared = await store.write(first, { version: winner.version, notes: [] });
      assert.equal(cleared.kind, "saved");
      assert.deepEqual(await store.read(first), { version: 2, notes: [] });
      assert.equal((await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, second))).length, 1);
    } finally {
      // Only the two inactive tenants created by this test; notes cascade.
      if (created.length) await db.delete(tenants).where(inArray(tenants.id, created));
    }
  });
