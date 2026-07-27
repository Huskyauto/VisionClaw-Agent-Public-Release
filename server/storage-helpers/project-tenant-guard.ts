import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Tenant-ownership guards for project/conversation-linked writes.
 *
 * R125+14 (closes the deferred tenant-scoping audit, R125+13.19+sec1): several
 * LLM-driven / autonomous INSERT sites take a caller-supplied `project_id` or a
 * conversation-derived id and write into `project_notes` / `project_files` /
 * `project_conversations`. Those child tables carry no `tenant_id` of their own —
 * isolation is transitive via `projects.tenant_id` / `conversations.tenant_id`.
 * Before any such write, the caller MUST prove the acting tenant owns the parent
 * row, or an attacker/LLM with a foreign id can pollute or read across tenants
 * (cross-tenant write + IDOR).
 *
 * These helpers fail-CLOSED: any invalid id, missing row, or tenant mismatch
 * returns `false`. They are also the canonical names the held-out-eval-gate
 * sanitizer registry watches for (`server/safety/held-out-eval-gate.ts`), so a
 * self-improvement diff that strips these calls is flagged.
 */

function validId(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

/** True iff project `projectId` exists AND belongs to `tenantId`. Fail-closed. */
export async function assertProjectInTenant(
  projectId: unknown,
  tenantId: unknown,
): Promise<boolean> {
  if (!validId(projectId) || !validId(tenantId)) return false;
  const r = await db.execute(
    sql`SELECT 1 FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId} LIMIT 1`,
  );
  return (((r as any).rows || r) as any[]).length > 0;
}

/** True iff conversation `conversationId` exists AND belongs to `tenantId`. Fail-closed. */
export async function assertConversationInTenant(
  conversationId: unknown,
  tenantId: unknown,
): Promise<boolean> {
  if (!validId(conversationId) || !validId(tenantId)) return false;
  const r = await db.execute(
    sql`SELECT 1 FROM conversations WHERE id = ${conversationId} AND tenant_id = ${tenantId} LIMIT 1`,
  );
  return (((r as any).rows || r) as any[]).length > 0;
}
