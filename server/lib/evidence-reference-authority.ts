import { sql, type SQL } from "drizzle-orm";

/** Used inside the INSERT, so source and hypothesis ownership cannot race. */
export function evidenceReferenceAuthority(kind: string, reference: string, tenantId: number): SQL {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error("A positive tenant ID is required");
  if (kind === "free_text" || kind === "tool_result") return sql`TRUE`;
  if (kind !== "memory_entry" && kind !== "finding") throw new Error("Unknown evidence kind");
  if (!/^[1-9]\d*$/.test(reference) || !Number.isSafeInteger(Number(reference)) ||
      Number(reference) > 2_147_483_647) {
    throw new Error("Structured evidence requires an exact positive record ID");
  }
  const id = Number(reference);
  return kind === "memory_entry"
    ? sql`EXISTS (SELECT 1 FROM memory_entries WHERE id = ${id} AND tenant_id = ${tenantId} AND deleted_at IS NULL)`
    : sql`EXISTS (SELECT 1 FROM parallel_job_findings WHERE id = ${id} AND tenant_id = ${tenantId})`;
}
