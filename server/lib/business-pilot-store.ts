import { sql } from "drizzle-orm";
import { db } from "../db";
import { type PilotKind } from "../../shared/business-pilots";
import { parsePilotState, PilotError, type PilotRun } from "./business-pilot-state";
import { BUSINESS_PILOT_FILE_PREFIX } from "./private-business-pilot-files";

/** Existing tenant-private durable JSON namespace; no ephemeral runtime files. */
export async function withPilotStore<T>(
  tenantId: number, kind: PilotKind, operation: (runs: PilotRun[]) => { runs?: PilotRun[]; value: T },
): Promise<T> {
  if (!Number.isSafeInteger(tenantId) || tenantId < 1) throw new PilotError("Tenant required", 403);
  const filename = `${BUSINESS_PILOT_FILE_PREFIX}${kind}.json`;
  return db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout = '8s'`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`business-pilot:${tenantId}:${kind}`}))`);
    const rows: any = await tx.execute(sql`
      SELECT left(data, 1200001) AS data, length(data) AS encoded_size, is_public
      FROM file_storage WHERE tenant_id = ${tenantId} AND filename = ${filename}
    `);
    const row = (rows.rows || rows)[0];
    if (row && (Number(row.encoded_size) > 1_200_000 || row.is_public))
      throw new PilotError("Saved pilot storage is oversized or not private; no changes were made.", 500);
    const runs = parsePilotState(row ? Buffer.from(row.data, "base64").toString("utf8") : null, kind);
    const outcome = operation(runs);
    if (outcome.runs) {
      const content = JSON.stringify({ version: 1, runs: outcome.runs });
      const encoded = Buffer.from(content).toString("base64");
      await tx.execute(sql`
        INSERT INTO file_storage (filename, original_name, mime_type, size, data, tenant_id, is_public)
        VALUES (${filename}, ${filename}, 'application/json', ${Buffer.byteLength(content)}, ${encoded}, ${tenantId}, false)
        ON CONFLICT (tenant_id, filename) WHERE filename LIKE 'local-state-%'
        DO UPDATE SET data = EXCLUDED.data, size = EXCLUDED.size, is_public = false
      `);
    }
    return outcome.value;
  });
}
