import { sql } from "drizzle-orm";
import { db } from "./db";

export const PUBLIC_CHAT_BUDGET_LABEL = "anonymous-public-chat-daily-admission";

function readLimit(env: NodeJS.ProcessEnv, name: string, defaultValue: number): number {
  const raw = env[name];
  if (raw === undefined) return defaultValue;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`[public-chat-budget] ${name} must be a nonnegative integer`);
  }
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit)) {
    throw new Error(`[public-chat-budget] ${name} must be a nonnegative integer`);
  }
  return limit;
}

export function publicChatDailyLimits(env: NodeJS.ProcessEnv = process.env): { tenant: number; global: number } {
  return {
    tenant: readLimit(env, "PUBLIC_CHAT_DAILY_TENANT_LIMIT", 40),
    global: readLimit(env, "PUBLIC_CHAT_DAILY_GLOBAL_LIMIT", 200),
  };
}

/**
 * Reserve one anonymous request (covering its primary and possible fallback)
 * before any message/provider work. A global transaction lock serializes all
 * admissions for this independent label; the tenant lock also documents and
 * preserves tenant-level serialization if the global mechanism is later split.
 */
export async function claimPublicChatAdmission(
  tenantId: number,
): Promise<{ admitted: boolean; tenantCount: number; globalCount: number; tenantLimit: number; globalLimit: number }> {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new Error("[public-chat-budget] a validated tenant is required");
  }
  const { tenant: tenantLimit, global: globalLimit } = publicChatDailyLimits();

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('public-chat-daily-admission'), 0)`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('public-chat-daily-admission'), ${tenantId})`);

    // All rows for this label are protected by the global lock, so pruning
    // cannot race another admission or disturb other budget users.
    await tx.execute(sql`
      DELETE FROM autonomous_budget_claims
      WHERE label = ${PUBLIC_CHAT_BUDGET_LABEL}
        AND (created_at IS NULL OR created_at < date_trunc('day', now() AT TIME ZONE 'UTC'))
    `);

    const result: any = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE tenant_id = ${tenantId})::int AS tenant_count,
        COUNT(*)::int AS global_count
      FROM autonomous_budget_claims
      WHERE label = ${PUBLIC_CHAT_BUDGET_LABEL}
        AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
        AND created_at < date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day'
    `);
    const rows = result.rows || result;
    const tenantCount = Number(rows?.[0]?.tenant_count);
    const globalCount = Number(rows?.[0]?.global_count);
    if (!Number.isSafeInteger(tenantCount) || !Number.isSafeInteger(globalCount)) {
      throw new Error("[public-chat-budget] admission counts could not be verified");
    }

    if (tenantCount >= tenantLimit || globalCount >= globalLimit) {
      return { admitted: false, tenantCount, globalCount, tenantLimit, globalLimit };
    }

    await tx.execute(sql`
      INSERT INTO autonomous_budget_claims (tenant_id, label, estimated_usd, created_at)
      VALUES (${tenantId}, ${PUBLIC_CHAT_BUDGET_LABEL}, 1, now() AT TIME ZONE 'UTC')
    `);
    return { admitted: true, tenantCount: tenantCount + 1, globalCount: globalCount + 1, tenantLimit, globalLimit };
  });
}