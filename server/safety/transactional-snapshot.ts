// R100 — Transactional No-Regression (TNR)
//
// Pre-action snapshot + post-action undo for tools marked `irreversible`
// in TOOL_POLICIES. The destructive-tool-policy layer (AHB) decides
// WHETHER a destructive call may run; this layer decides WHAT to do if
// the call later turns out to have been a mistake.
//
// Contract:
//   1. captureSnapshot(toolName, args, ctx) is called BEFORE dispatch when
//      policy.irreversible is set. Returns an actionId (uuid). Failure to
//      capture is fail-CLOSED for write integrity (we'd rather refuse than
//      perform an undoable action with no undo path).
//   2. restoreSnapshot(actionId, ctx) re-applies the captured pre-state.
//      Tenant-scoped — never restores across tenants.
//   3. Each adapter declares { capture, restore }. Adding a new irreversible
//      tool requires adding both halves OR declining to mark it irreversible.
//
// Snapshots auto-expire after policy.irreversible.ttlMinutes. After expiry
// the snapshot row stays for forensics but undo is rejected.

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import { logSilentCatch } from "../lib/silent-catch";

export type SnapshotKind =
  | "scheduled_message_cancel"
  | "custom_tool_delete"
  | "scraped_pages_delete";

export interface SnapshotCtx {
  tenantId: number;
  personaId?: number | null;
}

export interface SnapshotAdapter {
  kind: SnapshotKind;
  /**
   * Capture pre-state. Throws if state cannot be captured (fail-closed).
   * Return value is JSON-serialized into action_snapshots.payload.
   */
  capture: (args: any, ctx: SnapshotCtx) => Promise<unknown>;
  /**
   * Reapply captured state. MUST scope to ctx.tenantId. Throws on any
   * partial failure so the undo result is unambiguous.
   */
  restore: (payload: any, ctx: SnapshotCtx) => Promise<{ restored: number; detail?: string }>;
}

// ──────────────────────────────────────────────────────────────────────────
// Adapter: scheduled_message_cancel
//   cancelScheduledMessage flips agent_knowledge.category from
//   'recurring_message' or 'recurring_message_paused' to
//   'recurring_message_cancelled'. Undo flips it back to the prior value.
// ──────────────────────────────────────────────────────────────────────────
const scheduledMessageCancelAdapter: SnapshotAdapter = {
  kind: "scheduled_message_cancel",
  async capture(args, ctx) {
    const id = Number(args?.id);
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error("scheduled_message_cancel: id required");
    }
    const r: any = await db.execute(sql`
      SELECT id, category, content
        FROM agent_knowledge
       WHERE id = ${id}
         AND tenant_id = ${ctx.tenantId}
         AND category IN ('recurring_message', 'recurring_message_paused')
       LIMIT 1
    `);
    const row = (r.rows || r)[0];
    if (!row) throw new Error(`scheduled_message_cancel: row ${id} not found in tenant ${ctx.tenantId}`);
    return { id: row.id, priorCategory: row.category };
  },
  async restore(payload, ctx) {
    const id = Number(payload?.id);
    const priorCategory = String(payload?.priorCategory || "recurring_message");
    if (!Number.isFinite(id)) throw new Error("restore: missing snapshot id");
    if (priorCategory !== "recurring_message" && priorCategory !== "recurring_message_paused") {
      throw new Error(`restore: refusing to restore unexpected category "${priorCategory}"`);
    }
    const r: any = await db.execute(sql`
      UPDATE agent_knowledge
         SET category = ${priorCategory}, updated_at = NOW()
       WHERE id = ${id}
         AND tenant_id = ${ctx.tenantId}
         AND category = 'recurring_message_cancelled'
    `);
    const restored = (r as any).rowCount ?? (r as any).rows?.length ?? 0;
    if (restored === 0) {
      throw new Error(`restore: row ${id} no longer in 'cancelled' state — already restored or modified`);
    }
    return { restored, detail: `scheduled message ${id} restored to "${priorCategory}"` };
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Adapter: custom_tool_delete
//   delete_custom_tool removes a row from custom_tools by name. Undo
//   re-INSERTs the captured row (id is regenerated).
// ──────────────────────────────────────────────────────────────────────────
const customToolDeleteAdapter: SnapshotAdapter = {
  kind: "custom_tool_delete",
  async capture(args, ctx) {
    const name = String(args?.name || "").trim();
    if (!name) throw new Error("custom_tool_delete: name required");
    const r: any = await db.execute(sql`
      SELECT id, name, description, parameters, implementation, created_by, is_active, usage_count, tenant_id
        FROM custom_tools
       WHERE name = ${name}
         AND tenant_id = ${ctx.tenantId}
       LIMIT 1
    `);
    const row = (r.rows || r)[0];
    if (!row) throw new Error(`custom_tool_delete: tool "${name}" not found in tenant ${ctx.tenantId}`);
    return {
      name: row.name,
      description: row.description,
      parameters: row.parameters,
      implementation: row.implementation,
      createdBy: row.created_by,
      isActive: row.is_active,
      usageCount: row.usage_count,
    };
  },
  async restore(payload, ctx) {
    const name = String(payload?.name || "").trim();
    if (!name) throw new Error("restore: missing snapshot name");
    // Conflict guard — if a tool with the same name exists now, refuse
    // (don't silently overwrite something the user re-created).
    const exists: any = await db.execute(sql`
      SELECT 1 FROM custom_tools WHERE name = ${name} AND tenant_id = ${ctx.tenantId} LIMIT 1
    `);
    if ((exists.rows || exists)[0]) {
      throw new Error(`restore: a custom_tool named "${name}" already exists — undo would overwrite`);
    }
    const r: any = await db.execute(sql`
      INSERT INTO custom_tools (name, description, parameters, implementation, created_by, is_active, usage_count, tenant_id)
      VALUES (
        ${name},
        ${payload.description || ""},
        ${JSON.stringify(payload.parameters || [])}::jsonb,
        ${payload.implementation || ""},
        ${payload.createdBy || "agent"},
        ${payload.isActive ?? true},
        ${Number(payload.usageCount) || 0},
        ${ctx.tenantId}
      )
      RETURNING id
    `);
    const newId = (r.rows || r)[0]?.id;
    return { restored: 1, detail: `custom_tool "${name}" restored as id=${newId}` };
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Adapter: scraped_pages_delete
//   scraped_pages_delete removes rows by id list, domain, or age. Undo
//   re-INSERTs captured rows. Hard cap of 100 rows per snapshot to keep
//   payload size bounded — beyond that, the snapshot records the predicate
//   only and undo is a no-op (with a clear "snapshot_too_large" detail).
// ──────────────────────────────────────────────────────────────────────────
const SCRAPED_PAGES_SNAPSHOT_CAP = 100;
const scrapedPagesDeleteAdapter: SnapshotAdapter = {
  kind: "scraped_pages_delete",
  async capture(args, ctx) {
    const ids: number[] = Array.isArray(args?.pageIds) ? args.pageIds.map(Number).filter(Number.isFinite) : [];
    const domain: string | null = args?.domain ? String(args.domain) : null;
    const olderThanDays: number | null = Number.isFinite(args?.olderThanDays) ? Number(args.olderThanDays) : null;

    let rows: any[] = [];
    if (ids.length > 0) {
      const r: any = await db.execute(sql`
        SELECT * FROM scraped_pages
         WHERE id = ANY(${ids}::int[])
           AND tenant_id = ${ctx.tenantId}
         LIMIT ${SCRAPED_PAGES_SNAPSHOT_CAP + 1}
      `);
      rows = r.rows || r;
    } else if (domain) {
      const r: any = await db.execute(sql`
        SELECT * FROM scraped_pages
         WHERE url LIKE ${"%" + domain + "%"}
           AND tenant_id = ${ctx.tenantId}
         LIMIT ${SCRAPED_PAGES_SNAPSHOT_CAP + 1}
      `);
      rows = r.rows || r;
    } else if (olderThanDays !== null) {
      const r: any = await db.execute(sql`
        SELECT * FROM scraped_pages
         WHERE created_at < NOW() - (${olderThanDays}::int * INTERVAL '1 day')
           AND tenant_id = ${ctx.tenantId}
         LIMIT ${SCRAPED_PAGES_SNAPSHOT_CAP + 1}
      `);
      rows = r.rows || r;
    }

    const tooLarge = rows.length > SCRAPED_PAGES_SNAPSHOT_CAP;
    return {
      tooLarge,
      capturedCount: tooLarge ? SCRAPED_PAGES_SNAPSHOT_CAP : rows.length,
      rows: tooLarge ? [] : rows.slice(0, SCRAPED_PAGES_SNAPSHOT_CAP),
      predicate: { ids, domain, olderThanDays },
    };
  },
  async restore(payload, ctx) {
    if (payload?.tooLarge) {
      return { restored: 0, detail: `snapshot exceeded ${SCRAPED_PAGES_SNAPSHOT_CAP}-row cap; cannot undo (re-scrape required)` };
    }
    const rows: any[] = Array.isArray(payload?.rows) ? payload.rows : [];
    if (rows.length === 0) return { restored: 0, detail: "snapshot was empty (nothing was deleted)" };

    let restored = 0;
    for (const row of rows) {
      try {
        await db.execute(sql`
          INSERT INTO scraped_pages (url, title, content, tenant_id, created_at)
          VALUES (
            ${row.url},
            ${row.title || ""},
            ${row.content || ""},
            ${ctx.tenantId},
            ${row.created_at || new Date()}
          )
          ON CONFLICT DO NOTHING
        `);
        restored++;
      } catch (e: any) {
        logSilentCatch("server/safety/transactional-snapshot.ts (scraped_pages restore)", e);
      }
    }
    return { restored, detail: `${restored}/${rows.length} scraped_pages rows restored` };
  },
};

// Registry — single source of truth.
const ADAPTERS: Record<SnapshotKind, SnapshotAdapter> = {
  scheduled_message_cancel: scheduledMessageCancelAdapter,
  custom_tool_delete: customToolDeleteAdapter,
  scraped_pages_delete: scrapedPagesDeleteAdapter,
};

export function getAdapter(kind: SnapshotKind): SnapshotAdapter | undefined {
  return ADAPTERS[kind];
}

// Redact obvious secret-shaped fields before persisting args. Defense-in-depth
// for the case where a tool author inadvertently passes a token through args.
function redactArgs(args: any): any {
  if (!args || typeof args !== "object") return args;
  const out: any = Array.isArray(args) ? [] : {};
  const SUSPICIOUS = /^(.*token.*|.*secret.*|.*password.*|.*api_key.*|.*authorization.*)$/i;
  for (const [k, v] of Object.entries(args)) {
    if (k.startsWith("_")) continue; // strip internal dispatch fields
    if (SUSPICIOUS.test(k)) { out[k] = "[REDACTED]"; continue; }
    if (v && typeof v === "object") { out[k] = redactArgs(v); continue; }
    out[k] = v;
  }
  return out;
}

export interface CaptureResult {
  actionId: string;
  expiresAt: Date;
}

/**
 * Capture pre-state for an irreversible tool call. Persists the snapshot
 * row and returns the actionId for surfacing to the caller. Throws on any
 * failure (fail-CLOSED — refuse to run the irreversible call without an
 * undo path).
 */
export async function captureSnapshot(
  toolName: string,
  kind: SnapshotKind,
  ttlMinutes: number,
  args: any,
  ctx: SnapshotCtx,
): Promise<CaptureResult> {
  const adapter = ADAPTERS[kind];
  if (!adapter) throw new Error(`captureSnapshot: no adapter registered for kind="${kind}"`);
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") {
    throw new Error("captureSnapshot: tenantId required (TNR cannot snapshot without tenant scope)");
  }

  const payload = await adapter.capture(args, ctx);
  const actionId = randomUUID();
  const expiresAt = new Date(Date.now() + Math.max(1, ttlMinutes) * 60_000);

  await db.execute(sql`
    INSERT INTO action_snapshots
      (tenant_id, action_id, tool_name, snapshot_kind, payload, args_redacted, persona_id, expires_at)
    VALUES (
      ${ctx.tenantId},
      ${actionId},
      ${toolName},
      ${kind},
      ${JSON.stringify(payload)}::jsonb,
      ${JSON.stringify(redactArgs(args))}::jsonb,
      ${ctx.personaId ?? null},
      ${expiresAt.toISOString()}
    )
  `);

  return { actionId, expiresAt };
}

export interface RestoreResult {
  success: boolean;
  actionId: string;
  toolName: string;
  snapshotKind: SnapshotKind;
  restored: number;
  detail: string;
  error?: string;
}

/**
 * Restore the most-recent un-undone snapshot for the tenant (or a specific
 * actionId if provided). Tenant-scoped — never crosses tenants.
 */
export async function restoreLastAction(
  ctx: SnapshotCtx,
  options?: { actionId?: string; toolName?: string },
): Promise<RestoreResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") {
    return { success: false, actionId: "", toolName: "", snapshotKind: "scheduled_message_cancel", restored: 0, detail: "", error: "tenantId required" };
  }

  let row: any;
  try {
    if (options?.actionId) {
      const r: any = await db.execute(sql`
        SELECT * FROM action_snapshots
         WHERE action_id = ${options.actionId}
           AND tenant_id = ${ctx.tenantId}
         LIMIT 1
      `);
      row = (r.rows || r)[0];
    } else if (options?.toolName) {
      const r: any = await db.execute(sql`
        SELECT * FROM action_snapshots
         WHERE tenant_id = ${ctx.tenantId}
           AND tool_name = ${options.toolName}
           AND undone_at IS NULL
           AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1
      `);
      row = (r.rows || r)[0];
    } else {
      const r: any = await db.execute(sql`
        SELECT * FROM action_snapshots
         WHERE tenant_id = ${ctx.tenantId}
           AND undone_at IS NULL
           AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1
      `);
      row = (r.rows || r)[0];
    }
  } catch (e: any) {
    return { success: false, actionId: "", toolName: "", snapshotKind: "scheduled_message_cancel", restored: 0, detail: "", error: `lookup failed: ${e?.message || e}` };
  }

  if (!row) {
    return { success: false, actionId: options?.actionId || "", toolName: options?.toolName || "", snapshotKind: "scheduled_message_cancel", restored: 0, detail: "", error: "no eligible snapshot found (already undone, expired, or wrong tenant)" };
  }
  if (row.undone_at) {
    return { success: false, actionId: row.action_id, toolName: row.tool_name, snapshotKind: row.snapshot_kind, restored: 0, detail: "", error: "snapshot was already undone" };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { success: false, actionId: row.action_id, toolName: row.tool_name, snapshotKind: row.snapshot_kind, restored: 0, detail: "", error: "snapshot expired" };
  }

  const adapter = ADAPTERS[row.snapshot_kind as SnapshotKind];
  if (!adapter) {
    return { success: false, actionId: row.action_id, toolName: row.tool_name, snapshotKind: row.snapshot_kind, restored: 0, detail: "", error: `no adapter for snapshot_kind="${row.snapshot_kind}"` };
  }

  // Atomic claim — mark undone_at NOW only if still null. Prevents
  // double-undo races when two callers fire concurrently.
  const claim: any = await db.execute(sql`
    UPDATE action_snapshots
       SET undone_at = NOW()
     WHERE id = ${row.id}
       AND tenant_id = ${ctx.tenantId}
       AND undone_at IS NULL
  `);
  const claimed = (claim as any).rowCount ?? 0;
  if (claimed === 0) {
    return { success: false, actionId: row.action_id, toolName: row.tool_name, snapshotKind: row.snapshot_kind, restored: 0, detail: "", error: "another caller already claimed this undo (race)" };
  }

  try {
    const result = await adapter.restore(row.payload, ctx);
    return {
      success: true,
      actionId: row.action_id,
      toolName: row.tool_name,
      snapshotKind: row.snapshot_kind,
      restored: result.restored,
      detail: result.detail || "",
    };
  } catch (e: any) {
    // Roll back the claim so the caller can retry / report accurately.
    // If the rollback write ITSELF fails, the snapshot stays claimed (undone_at
    // set) with nothing restored — surface that loudly instead of swallowing it,
    // or retries silently hit the "already claimed" race branch forever.
    let rollbackFailed: string | null = null;
    try {
      await pool.query(`UPDATE action_snapshots SET undone_at = NULL WHERE id = $1 AND tenant_id = $2`, [row.id, ctx.tenantId]);
    } catch (rbErr: any) {
      rollbackFailed = rbErr?.message || String(rbErr);
      console.error(`[transactional-snapshot] restore failed AND claim rollback failed — snapshot ${row.id} (tenant ${ctx.tenantId}, action ${row.action_id}) remains claimed with nothing restored; manual reset of undone_at may be required:`, rbErr);
    }
    return { success: false, actionId: row.action_id, toolName: row.tool_name, snapshotKind: row.snapshot_kind, restored: 0, detail: "", error: `restore failed: ${e?.message || e}${rollbackFailed ? `; claim rollback ALSO failed (${rollbackFailed}) — snapshot remains claimed, retry blocked until undone_at is reset` : ""}` };
  }
}

export const SNAPSHOT_KINDS: SnapshotKind[] = Object.keys(ADAPTERS) as SnapshotKind[];
