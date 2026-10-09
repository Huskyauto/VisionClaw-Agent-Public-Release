import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql } from "drizzle-orm";

test("temporal writes are atomic, retry-safe, and keep newer facts active",
  { skip: process.env.RUN_DB_INTEGRATION !== "1" }, async () => {
    const { db } = await import("../../server/db");
    const { persistTemporalTriple } = await import("../../server/memory/temporal-triple-store");
    const subject = `__triple_probe_${randomUUID()}__`;
    const predicate = "works at";
    const rollback = new Error("ROLLBACK_TEMPORAL_TEST");
    await assert.rejects(db.transaction(async (tx) => {
      const first = await persistTemporalTriple(tx, {
        tenantId: 1, subject, predicate, object: "Old", confidence: 1,
        source: "conversation", validFrom: new Date("2025-01-01T00:00:00Z"),
        requestedValidUntil: null, wing: null, room: null, personaId: null,
        sourceMessageId: 900001,
      });
      const second = await persistTemporalTriple(tx, {
        tenantId: 1, subject, predicate, object: "New", confidence: 1,
        source: "conversation", validFrom: new Date("2026-01-01T00:00:00Z"),
        requestedValidUntil: null, wing: null, room: null, personaId: null,
        sourceMessageId: 900002,
      });
      assert.equal(first.created, true);
      assert.equal(second.created, true);
      assert.deepEqual(second.superseded, [first.id]);

      const retry = await persistTemporalTriple(tx, {
        tenantId: 1, subject, predicate, object: "Old", confidence: 1,
        source: "conversation", validFrom: new Date("2025-01-01T00:00:00Z"),
        requestedValidUntil: null, wing: null, room: null, personaId: null,
        sourceMessageId: 900001,
      });
      assert.equal(retry.created, false);

      const history = await persistTemporalTriple(tx, {
        tenantId: 1, subject, predicate, object: "Intermediate", confidence: 1,
        source: "agent", validFrom: new Date("2025-06-01T00:00:00Z"),
        requestedValidUntil: null, wing: null, room: null, personaId: null,
      });
      assert.equal(history.created, true);
      assert.equal(history.validUntil?.toISOString(), "2026-01-01T00:00:00.000Z");
      assert.deepEqual(history.superseded, []);

      const rows = await tx.execute(sql`
        SELECT id, object, valid_until FROM knowledge_triples
        WHERE tenant_id = ${1} AND subject = ${subject}
      `);
      assert.equal(rows.rows.length, 3);
      assert.equal(rows.rows.find(r => r.id === second.id)?.valid_until, null);
      const wrongTenant = await tx.execute(sql`
        SELECT id FROM knowledge_triples WHERE tenant_id = ${2} AND subject = ${subject}
      `);
      assert.equal(wrongTenant.rows.length, 0);
      throw rollback; // No fixture or test data survives this transaction.
    }), (error: unknown) => error === rollback);
  });

test("two concurrent writers for one subject cannot leave contradictory facts active",
  { skip: process.env.RUN_DB_INTEGRATION !== "1" }, async () => {
    const { db } = await import("../../server/db");
    const { persistTemporalTriple } = await import("../../server/memory/temporal-triple-store");
    const subject = `__concurrent_triple_probe_${randomUUID()}__`;
    try {
      await Promise.all(["One", "Two"].map((object, index) =>
        db.transaction(tx => persistTemporalTriple(tx, {
          tenantId: 1, subject, predicate: "works at", object,
          confidence: 1, source: "agent",
          validFrom: new Date(`2026-0${index + 1}-01T00:00:00Z`),
          requestedValidUntil: null, wing: null, room: null, personaId: null,
        })),
      ));
      const rows = await db.execute(sql`
        SELECT id FROM knowledge_triples
        WHERE tenant_id = ${1} AND subject = ${subject} AND valid_until IS NULL
      `);
      assert.equal(rows.rows.length, 1);
    } finally {
      // Only remove the synthetic fixture generated in this test.
      await db.execute(sql`DELETE FROM knowledge_triples WHERE tenant_id = ${1} AND subject = ${subject}`);
    }
  });

test("an erased fact is refused under the same transaction as its triple insert",
  { skip: process.env.RUN_DB_INTEGRATION !== "1" }, async () => {
    const { db } = await import("../../server/db");
    const { canonicalMemoryValue, memoryValueDigest, assertMemoryValueNotTombstonedInTx } =
      await import("../../server/memory/tombstones");
    const { persistTemporalTriple } = await import("../../server/memory/temporal-triple-store");
    const subject = `__erased_triple_probe_${randomUUID()}__`;
    const parts = [subject, "works at", "Synthetic Corp"];
    const digest = memoryValueDigest(1, "knowledge_triples", canonicalMemoryValue(parts));
    const rollback = new Error("ROLLBACK_ERASURE_TEST");
    await assert.rejects(db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO memory_tombstones (tenant_id, source, source_id, value_digest, request_key)
        VALUES (${1}, ${"knowledge_triples"}, ${subject}, ${digest}, ${subject})
      `);
      await assert.rejects(
        assertMemoryValueNotTombstonedInTx(tx, {
          tenantId: 1, source: "knowledge_triples", parts,
        }),
        /erased content cannot be restored/,
      );
      await assert.rejects(
        persistTemporalTriple(tx, {
          tenantId: 1, subject, predicate: "works at", object: "Synthetic Corp",
          confidence: 1, source: "agent", validFrom: new Date("2026-01-01T00:00:00Z"),
          requestedValidUntil: null, wing: null, room: null, personaId: null,
        }),
        /erased content cannot be restored/,
      );
      throw rollback;
    }), (error: unknown) => error === rollback);
  });

test("independent message assertions of one fact retain separate temporal provenance",
  { skip: process.env.RUN_DB_INTEGRATION !== "1" }, async () => {
    const { db } = await import("../../server/db");
    const { persistTemporalTriple } = await import("../../server/memory/temporal-triple-store");
    const subject = `__reasserted_triple_probe_${randomUUID()}__`;
    const rollback = new Error("ROLLBACK_REASSERTION_TEST");
    const input = {
      tenantId: 1, subject, predicate: "works at", object: "Synthetic Corp",
      confidence: 1, source: "conversation", requestedValidUntil: null,
      wing: null, room: null, personaId: null,
    };
    await assert.rejects(db.transaction(async (tx) => {
      const first = await persistTemporalTriple(tx, {
        ...input, validFrom: new Date("2025-01-01T00:00:00Z"), sourceMessageId: 900101,
      });
      const second = await persistTemporalTriple(tx, {
        ...input, validFrom: new Date("2026-01-01T00:00:00Z"), sourceMessageId: 900102,
      });
      assert.equal(first.created, true);
      assert.equal(second.created, true);
      assert.notEqual(first.id, second.id);
      assert.deepEqual(second.superseded, [first.id]);
      const firstRetry = await persistTemporalTriple(tx, {
        ...input, validFrom: new Date("2025-01-01T00:00:00Z"), sourceMessageId: 900101,
      });
      assert.equal(firstRetry.created, false);
      const rows = await tx.execute(sql`
        SELECT id FROM knowledge_triples WHERE tenant_id = ${1}
          AND subject = ${subject} AND valid_until IS NULL
      `);
      assert.deepEqual(rows.rows.map(row => row.id), [second.id]);
      throw rollback;
    }), (error: unknown) => error === rollback);
  });

test("same-date reassertions keep both sources valid; a same-date contradiction is rejected",
  { skip: process.env.RUN_DB_INTEGRATION !== "1" }, async () => {
    const { db } = await import("../../server/db");
    const { persistTemporalTriple } = await import("../../server/memory/temporal-triple-store");
    const subject = `__same_date_triple_probe_${randomUUID()}__`;
    const rollback = new Error("ROLLBACK_SAME_DATE_TEST");
    const input = {
      tenantId: 1, subject, predicate: "works at", object: "Synthetic Corp",
      confidence: 1, source: "conversation", validFrom: new Date("2026-01-01T00:00:00Z"),
      requestedValidUntil: null, wing: null, room: null, personaId: null,
    };
    await assert.rejects(db.transaction(async (tx) => {
      const first = await persistTemporalTriple(tx, { ...input, sourceMessageId: 900201 });
      const second = await persistTemporalTriple(tx, { ...input, sourceMessageId: 900202 });
      assert.equal(first.created, true);
      assert.equal(second.created, true);
      assert.deepEqual(second.superseded, []);
      await assert.rejects(
        persistTemporalTriple(tx, { ...input, object: "Different Corp", sourceMessageId: 900203 }),
        /conflicting triple has the same valid_from/,
      );
      const current = await tx.execute(sql`
        SELECT id FROM knowledge_triples WHERE tenant_id = ${1}
          AND subject = ${subject} AND valid_until IS NULL
      `);
      assert.deepEqual(current.rows.map(row => row.id).sort(), [first.id, second.id].sort());
      const later = await persistTemporalTriple(tx, {
        ...input, object: "Newer Corp", validFrom: new Date("2026-02-01T00:00:00Z"),
        sourceMessageId: 900204,
      });
      assert.deepEqual(later.superseded.sort(), [first.id, second.id].sort());
      throw rollback;
    }), (error: unknown) => error === rollback);
  });