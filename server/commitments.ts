import { db } from "./db";
import { sql } from "drizzle-orm";

export type CommitmentStatus = "active" | "paused" | "completed" | "cancelled" | "escalated";

export interface CommitmentRow {
  id: number;
  tenantId: number;
  persona: string | null;
  description: string;
  dueAt: Date | null;
  heartbeatIntervalMs: number;
  lastHeartbeatAt: Date | null;
  lastNote: string | null;
  status: CommitmentStatus;
  evidence: any;
  createdAt: Date;
  escalatedAt: Date | null;
}

export interface CreateCommitmentInput {
  tenantId: number;
  persona?: string;
  description: string;
  dueAt?: Date | string | null;
  heartbeatIntervalMs?: number;
}

const MIN_HEARTBEAT_MS = 5 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 60 * 60 * 1000;

function rowsOf(result: any): any[] { return (result?.rows || result) || []; }

export async function createCommitment(input: CreateCommitmentInput): Promise<CommitmentRow> {
  if (!input.tenantId || input.tenantId <= 0) throw new Error("createCommitment requires tenantId");
  const desc = (input.description || "").trim();
  if (!desc) throw new Error("createCommitment requires description");
  const heartbeatMs = Math.max(MIN_HEARTBEAT_MS, input.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS);
  const dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) throw new Error("createCommitment dueAt is not a valid date");
  const persona = input.persona ? input.persona.slice(0, 80) : null;
  const result = await db.execute(sql`
    INSERT INTO commitments (tenant_id, persona, description, due_at, heartbeat_interval_ms, status, evidence)
    VALUES (${input.tenantId}, ${persona}, ${desc}, ${dueAt}, ${heartbeatMs}, 'active', '[]'::jsonb)
    RETURNING id, tenant_id AS "tenantId", persona, description, due_at AS "dueAt",
              heartbeat_interval_ms AS "heartbeatIntervalMs", last_heartbeat_at AS "lastHeartbeatAt",
              last_note AS "lastNote", status, evidence, created_at AS "createdAt",
              escalated_at AS "escalatedAt"
  `);
  return rowsOf(result)[0];
}

export async function listCommitments(tenantId: number, status?: CommitmentStatus): Promise<CommitmentRow[]> {
  if (!tenantId || tenantId <= 0) throw new Error("listCommitments requires tenantId");
  const result = status
    ? await db.execute(sql`
        SELECT id, tenant_id AS "tenantId", persona, description, due_at AS "dueAt",
               heartbeat_interval_ms AS "heartbeatIntervalMs", last_heartbeat_at AS "lastHeartbeatAt",
               last_note AS "lastNote", status, evidence, created_at AS "createdAt",
               escalated_at AS "escalatedAt"
        FROM commitments WHERE tenant_id = ${tenantId} AND status = ${status}
        ORDER BY COALESCE(due_at, created_at) ASC LIMIT 200`)
    : await db.execute(sql`
        SELECT id, tenant_id AS "tenantId", persona, description, due_at AS "dueAt",
               heartbeat_interval_ms AS "heartbeatIntervalMs", last_heartbeat_at AS "lastHeartbeatAt",
               last_note AS "lastNote", status, evidence, created_at AS "createdAt",
               escalated_at AS "escalatedAt"
        FROM commitments WHERE tenant_id = ${tenantId}
        ORDER BY status='active' DESC, COALESCE(due_at, created_at) ASC LIMIT 200`);
  return rowsOf(result);
}

export async function recordHeartbeat(tenantId: number, id: number, note: string, evidence?: any): Promise<CommitmentRow> {
  if (!tenantId || tenantId <= 0) throw new Error("recordHeartbeat requires tenantId");
  const safeNote = (note || "").slice(0, 1000);
  const evidenceJson = JSON.stringify(evidence ?? null);
  const result = await db.execute(sql`
    UPDATE commitments
    SET last_heartbeat_at = NOW(),
        last_note = ${safeNote},
        evidence = COALESCE(evidence, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object('at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'note', ${safeNote}::text, 'evidence', ${evidenceJson}::jsonb)
        )
    WHERE id = ${id} AND tenant_id = ${tenantId}
    RETURNING id, tenant_id AS "tenantId", persona, description, due_at AS "dueAt",
              heartbeat_interval_ms AS "heartbeatIntervalMs", last_heartbeat_at AS "lastHeartbeatAt",
              last_note AS "lastNote", status, evidence, created_at AS "createdAt",
              escalated_at AS "escalatedAt"
  `);
  const row = rowsOf(result)[0];
  if (!row) throw new Error(`commitment ${id} not found in tenant ${tenantId}`);
  return row;
}

export async function setCommitmentStatus(tenantId: number, id: number, status: CommitmentStatus, note?: string): Promise<CommitmentRow> {
  if (!tenantId || tenantId <= 0) throw new Error("setCommitmentStatus requires tenantId");
  const safeNote = note ? note.slice(0, 1000) : null;
  const result = await db.execute(sql`
    UPDATE commitments
    SET status = ${status},
        last_note = COALESCE(${safeNote}, last_note)
    WHERE id = ${id} AND tenant_id = ${tenantId}
    RETURNING id, tenant_id AS "tenantId", persona, description, due_at AS "dueAt",
              heartbeat_interval_ms AS "heartbeatIntervalMs", last_heartbeat_at AS "lastHeartbeatAt",
              last_note AS "lastNote", status, evidence, created_at AS "createdAt",
              escalated_at AS "escalatedAt"
  `);
  const row = rowsOf(result)[0];
  if (!row) throw new Error(`commitment ${id} not found in tenant ${tenantId}`);
  return row;
}

let schedulerStarted = false;
let schedulerHandle: ReturnType<typeof setInterval> | null = null;

export function startCommitmentHeartbeatScanner(intervalMs = 30 * 60 * 1000): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  console.log(`[commitments] heartbeat scanner started (tick every ${Math.round(intervalMs / 60000)}min)`);
  const tick = async () => {
    try { await scanAndEscalate(); } catch (e: any) { console.warn(`[commitments] scan failed: ${e?.message || e}`); }
  };
  tick();
  schedulerHandle = setInterval(tick, intervalMs);
  schedulerHandle.unref?.();
}

export function stopCommitmentHeartbeatScanner(): void {
  if (schedulerHandle) { clearInterval(schedulerHandle); schedulerHandle = null; }
  schedulerStarted = false;
}

export async function scanAndEscalate(): Promise<{ scanned: number; escalated: number }> {
  const result = await db.execute(sql`
    SELECT id, tenant_id AS "tenantId", description, due_at AS "dueAt",
           last_heartbeat_at AS "lastHeartbeatAt", heartbeat_interval_ms AS "heartbeatIntervalMs"
    FROM commitments
    WHERE status = 'active'
      AND due_at IS NOT NULL
      AND due_at < NOW()
      AND (escalated_at IS NULL OR escalated_at < NOW() - INTERVAL '24 hours')
  `);
  const rows = rowsOf(result);
  let escalated = 0;
  for (const row of rows) {
    const stale = !row.lastHeartbeatAt || (Date.now() - new Date(row.lastHeartbeatAt).getTime()) > Number(row.heartbeatIntervalMs);
    if (!stale) continue;
    try {
      const { maybeQueueOwnerEmail } = await import("./owner-email-digest");
      const ownerEmail = process.env.OWNER_EMAIL || process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com";
      // R105.1 +sec — Architect HIGH closed: do NOT include tenant_id or
      // free-text `description` in the owner-digest body. The scanner
      // intentionally fans-in across all tenants for platform-admin
      // visibility, so the email body stays redacted (id + due_at only).
      // Operator pulls the tenant-scoped detail by issuing
      // `commitment_list` from a trusted persona session (which re-resolves
      // tenant scope from the active session, never from the email body) —
      // there is no public admin URL because exposing one would defeat the
      // redaction (the URL itself would have to encode tenant context).
      maybeQueueOwnerEmail({
        to: ownerEmail,
        subject: `Commitment overdue (id=${row.id})`,
        text: `Commitment #${row.id} is past due_at=${row.dueAt} with no recent heartbeat.\n\nTo view the full record, open a Robert chat session and run: commitment_list (filter by id=${row.id}).\n\n(tenant content redacted from this digest by design — see replit.md R105.1)`,
        source: "commitments-heartbeat",
      });
      await db.execute(sql`UPDATE commitments SET escalated_at = NOW(), status = 'escalated' WHERE id = ${row.id} AND tenant_id = ${row.tenantId}`);
      escalated++;
    } catch (e: any) {
      console.warn(`[commitments] escalation queue failed for #${row.id}: ${e?.message || e}`);
    }
  }
  if (escalated > 0) console.log(`[commitments] scanned ${rows.length} overdue, escalated ${escalated} via owner digest`);
  return { scanned: rows.length, escalated };
}
