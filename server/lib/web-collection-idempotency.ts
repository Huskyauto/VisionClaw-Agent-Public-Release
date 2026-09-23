import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";

const RUN_BUCKET_MS = 5 * 60_000;
const RUN_LEASE_MS = 5 * 60_000;

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] } | null)?.rows ?? []);
}

export function makeWebCollectionRunKey(
  tenantId: number,
  normalizedUrl: string,
  lanes: readonly string[],
  mode: string,
  now = Date.now(),
): { runKey: string; urlHash: string } {
  const bucket = Math.floor(now / RUN_BUCKET_MS);
  const urlHash = crypto.createHash("sha256").update(normalizedUrl).digest("hex");
  const identity = JSON.stringify([tenantId, urlHash, [...lanes].sort(), mode, bucket]);
  return {
    runKey: crypto.createHash("sha256").update(identity).digest("hex"),
    urlHash,
  };
}

export type WebCollectionClaim =
  | { state: "claimed"; claimToken: string }
  | { state: "completed"; result: Record<string, unknown> }
  | { state: "in_progress"; retryAfterMs: number };

export async function claimWebCollectionRun(
  tenantId: number,
  runKey: string,
  urlHash: string,
): Promise<WebCollectionClaim> {
  const claimToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.now() + RUN_LEASE_MS);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId}::int, hashtext(${runKey})::int)`);
    const existingResult = await tx.execute(sql`
      SELECT status, claim_token, lease_expires_at, result
      FROM web_collection_runs
      WHERE tenant_id = ${tenantId} AND run_key = ${runKey}
      LIMIT 1
    `);
    const existing = rowsOf<{
      status: string;
      claim_token: string;
      lease_expires_at: Date | string;
      result: Record<string, unknown> | null;
    }>(existingResult)[0];
    if (existing?.status === "completed" && existing.result) {
      return { state: "completed", result: existing.result };
    }
    if (existing && new Date(existing.lease_expires_at).getTime() > Date.now()) {
      return {
        state: "in_progress",
        retryAfterMs: Math.max(1_000, new Date(existing.lease_expires_at).getTime() - Date.now()),
      };
    }
    if (existing) {
      await tx.execute(sql`
        UPDATE web_collection_runs
        SET status = 'running', claim_token = ${claimToken},
            lease_expires_at = ${leaseExpiresAt}, result = NULL, updated_at = NOW()
        WHERE tenant_id = ${tenantId} AND run_key = ${runKey}
      `);
    } else {
      await tx.execute(sql`
        INSERT INTO web_collection_runs
          (tenant_id, run_key, url_hash, status, claim_token, lease_expires_at, created_at, updated_at)
        VALUES
          (${tenantId}, ${runKey}, ${urlHash}, 'running', ${claimToken}, ${leaseExpiresAt}, NOW(), NOW())
      `);
    }
    return { state: "claimed", claimToken };
  });
}

export async function completeWebCollectionRun(
  tenantId: number,
  runKey: string,
  claimToken: string,
  result: Record<string, unknown>,
): Promise<void> {
  const serialized = JSON.stringify(result);
  const update = await db.execute(sql`
    UPDATE web_collection_runs
    SET status = 'completed', result = ${serialized}::jsonb, updated_at = NOW()
    WHERE tenant_id = ${tenantId} AND run_key = ${runKey}
      AND claim_token = ${claimToken} AND status = 'running'
    RETURNING id
  `);
  if (rowsOf(update).length !== 1) {
    throw new Error("web collection idempotency claim was lost before completion");
  }
}

export async function renewWebCollectionRunLease(
  tenantId: number,
  runKey: string,
  claimToken: string,
): Promise<boolean> {
  const leaseExpiresAt = new Date(Date.now() + RUN_LEASE_MS);
  const update = await db.execute(sql`
    UPDATE web_collection_runs
    SET lease_expires_at = ${leaseExpiresAt}, updated_at = NOW()
    WHERE tenant_id = ${tenantId} AND run_key = ${runKey}
      AND claim_token = ${claimToken} AND status = 'running'
    RETURNING id
  `);
  return rowsOf(update).length === 1;
}