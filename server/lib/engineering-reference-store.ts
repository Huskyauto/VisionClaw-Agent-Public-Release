import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { engineeringReferenceLibraries } from "@shared/schema";
import { engineeringLibraryWriteSchema, type EngineeringLibrary } from "@shared/engineering-reference";
import type { EngineeringReferenceStore } from "../routes/engineering-reference";

function validTenant(tenantId: number) {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error("Invalid tenant scope.");
}

export const engineeringReferenceStore: EngineeringReferenceStore = {
  async read(tenantId) {
    validTenant(tenantId);
    const [row] = await db.select().from(engineeringReferenceLibraries)
      .where(eq(engineeringReferenceLibraries.tenantId, tenantId)).limit(1);
    return row ? engineeringLibraryWriteSchema.parse(rowPayload(row)) : { version: 0, notes: [] };
  },
  async write(tenantId, input) {
    validTenant(tenantId);
    const library = engineeringLibraryWriteSchema.parse(input);
    return db.transaction(async tx => {
      // Serializes first insert as well as subsequent writes across replicas.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(19472737, ${tenantId}::int)`);
      const [row] = await tx.select().from(engineeringReferenceLibraries)
        .where(eq(engineeringReferenceLibraries.tenantId, tenantId)).for("update").limit(1);
      const current: EngineeringLibrary = row
        ? engineeringLibraryWriteSchema.parse(rowPayload(row)) : { version: 0, notes: [] };
      if (JSON.stringify(current.notes) === JSON.stringify(library.notes)) {
        return { kind: "saved" as const, library: current };
      }
      if (current.version !== library.version) return { kind: "conflict" as const };
      const next: EngineeringLibrary = { version: current.version + 1, notes: library.notes };
      if (row) {
        const changed = await tx.update(engineeringReferenceLibraries)
          .set({ notes: next.notes, version: next.version, updatedAt: new Date() })
          .where(and(eq(engineeringReferenceLibraries.tenantId, tenantId),
            eq(engineeringReferenceLibraries.version, current.version))).returning();
        if (!changed.length) return { kind: "conflict" as const };
      } else {
        await tx.insert(engineeringReferenceLibraries).values({ tenantId, version: next.version, notes: next.notes });
      }
      return { kind: "saved" as const, library: next };
    });
  },
};

function rowPayload(row: { version: number; notes: unknown }) {
  return { version: row.version, notes: row.notes };
}
