import { sql } from "drizzle-orm";
import { db } from "../db";

const MAX_COOLDOWN_MS = 86_400_000;

function hostnameOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] } | null)?.rows ?? []);
}

export type DomainClaim =
  | { allowed: true }
  | { allowed: false; reason: string; retryAfterMs?: number; hardCeiling?: boolean };

export async function claimWebDomainUsage(tenantId: number, url: string): Promise<DomainClaim> {
  const hostname = hostnameOf(url);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId}::int, hashtext(${hostname})::int)`);
    await tx.execute(sql`
      DELETE FROM web_domain_usage_events
      WHERE tenant_id = ${tenantId}
        AND hostname = ${hostname}
        AND occurred_at <= NOW() - INTERVAL '1 day'
    `);
    const cooldownResult = await tx.execute(sql`
      SELECT cooldown_until
      FROM web_domain_cooldowns
      WHERE tenant_id = ${tenantId} AND hostname = ${hostname}
      LIMIT 1
    `);
    const cooldown = rowsOf<{ cooldown_until: Date | string }>(cooldownResult)[0];
    if (cooldown) {
      const until = new Date(cooldown.cooldown_until).getTime();
      if (until > Date.now()) {
        return {
          allowed: false,
          retryAfterMs: until - Date.now(),
          reason: "Domain is cooling down after an upstream rate-limit response",
        };
      }
    }
    const countResult = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE occurred_at > NOW() - INTERVAL '1 minute')::int AS minute_count,
        COUNT(*) FILTER (WHERE occurred_at > NOW() - INTERVAL '1 hour')::int AS hour_count,
        COUNT(*)::int AS day_count
      FROM web_domain_usage_events
      WHERE tenant_id = ${tenantId} AND hostname = ${hostname}
        AND occurred_at > NOW() - INTERVAL '1 day'
    `);
    const counts = rowsOf<{ minute_count: number; hour_count: number; day_count: number }>(countResult)[0]
      ?? { minute_count: 0, hour_count: 0, day_count: 0 };
    if (Number(counts.minute_count) >= 3) {
      return { allowed: false, reason: "Shared domain pace limit reached; wait before using another lane" };
    }
    if (Number(counts.hour_count) >= 15 || Number(counts.day_count) >= 50) {
      return {
        allowed: false,
        hardCeiling: true,
        reason: "Shared domain hard ceiling reached; sibling lanes will not be used to evade it",
      };
    }
    await tx.execute(sql`
      INSERT INTO web_domain_usage_events (tenant_id, hostname, occurred_at)
      VALUES (${tenantId}, ${hostname}, NOW())
    `);
    return { allowed: true };
  });
}

export async function reportWebDomainCooldown(
  tenantId: number,
  url: string,
  retryAfterMs: number,
): Promise<void> {
  const hostname = hostnameOf(url);
  const boundedMs = Math.min(Math.max(Math.trunc(retryAfterMs), 1_000), MAX_COOLDOWN_MS);
  const until = new Date(Date.now() + boundedMs);
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId}::int, hashtext(${hostname})::int)`);
    await tx.execute(sql`
      INSERT INTO web_domain_cooldowns (tenant_id, hostname, cooldown_until, updated_at)
      VALUES (${tenantId}, ${hostname}, ${until}, NOW())
      ON CONFLICT (tenant_id, hostname) DO UPDATE
      SET cooldown_until = GREATEST(web_domain_cooldowns.cooldown_until, EXCLUDED.cooldown_until),
          updated_at = NOW()
    `);
  });
}