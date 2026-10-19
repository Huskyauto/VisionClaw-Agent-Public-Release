import { sql } from "drizzle-orm";
import { db } from "../db";
import type { OutcomeCounts } from "../lib/outcome-economics";

/** Same persisted-receipt requirements as delivery-receipt-policy, in one aggregate.
 * Never probes providers or returns customer names, paths, links or raw metadata. */
export async function getDeliveryOutcomeCounts(tenantId: number, days: number): Promise<OutcomeCounts> {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0 ||
      !Number.isSafeInteger(days) || days < 1 || days > 90) throw new Error("Invalid outcome audit scope");
  const result = await db.execute(sql`
    WITH measured AS (
      SELECT d.status,
        (d.status = 'completed'
          AND NULLIF(d.drive_file_id, '') IS NOT NULL
          AND NULLIF(d.shareable_link, '') IS NOT NULL
          AND NULLIF(d.download_link, '') IS NOT NULL
          AND NULLIF(d.folder_link, '') IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM artifact_records a
            WHERE a.tenant_id = ${tenantId} AND a.delivery_log_id = d.id
              AND a.drive_file_id = d.drive_file_id AND a.status = 'durable'
          )
          AND NOT EXISTS (
            SELECT 1 FROM artifact_records a
            WHERE a.tenant_id = ${tenantId} AND a.delivery_log_id = d.id
              AND a.status IS DISTINCT FROM 'durable'
          )
        ) AS receipt_backed
      FROM delivery_logs d
      WHERE d.tenant_id = ${tenantId}
        AND d.created_at >= NOW() - (${days} * INTERVAL '1 day')
    )
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE receipt_backed)::int AS receipt_backed,
      COUNT(*) FILTER (WHERE status = 'completed' AND NOT receipt_backed)::int AS completed_unverified,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE status NOT IN ('completed', 'failed'))::int AS pending
    FROM measured
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("Outcome aggregate returned no row");
  return {
    total: Number(row.total), receiptBacked: Number(row.receipt_backed),
    completedUnverified: Number(row.completed_unverified),
    failed: Number(row.failed), pending: Number(row.pending),
  };
}
