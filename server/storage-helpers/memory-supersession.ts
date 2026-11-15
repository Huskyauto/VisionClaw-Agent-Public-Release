import { sql } from "drizzle-orm";
import type { db } from "../db";
import type { InsertMemoryEntry, MemoryEntry } from "@shared/schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Lock the owned fact and commit its replacement and successor link together. */
export async function persistMemorySupersession(
  database: Pick<typeof db, "transaction">,
  createMemoryEntry: (input: InsertMemoryEntry, transaction: Transaction) => Promise<MemoryEntry>,
  oldId: number,
  input: InsertMemoryEntry,
): Promise<MemoryEntry | undefined> {
  if (!Number.isSafeInteger(oldId) || oldId <= 0
    || !Number.isSafeInteger(input.tenantId) || Number(input.tenantId) <= 0) {
    throw new Error("Memory supersession requires an owned fact");
  }
  return database.transaction(async tx => {
    const result = await tx.execute(sql`
      SELECT id, fact, category, persona_id FROM memory_entries
      WHERE id = ${oldId} AND tenant_id = ${input.tenantId}
        AND status = 'active' AND deleted_at IS NULL
      FOR UPDATE
    `);
    const old = result.rows[0];
    if (!old) return undefined;
    const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalize(String(old.fact)) === normalize(input.fact)) {
      throw new Error("Replacement must differ from the old fact");
    }
    // The storage callback retains its redaction and tombstone checks and MUST
    // use this transaction, not a separately committed insert.
    const replacement = await createMemoryEntry({
      ...input, personaId: old.persona_id as number | null,
      category: input.category || String(old.category || "preference"), status: "active",
    }, tx);
    await tx.execute(sql`
      UPDATE memory_entries SET status = 'superseded',
        succeeded_by_id = ${replacement.id}, valid_until = NOW()
      WHERE id = ${oldId} AND tenant_id = ${input.tenantId} AND status = 'active'
    `);
    return replacement;
  });
}
