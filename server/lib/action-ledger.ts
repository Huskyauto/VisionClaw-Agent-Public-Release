// Action Ledger primitives (S1 — feature contract: data/feature-contracts/action-ledger/).
// Durable record of side-effecting tool attempts: a `prepared` row is persisted BEFORE
// crossing the external boundary, the external call carries a deterministic idempotency
// key, and the row is settled to committed/failed after — or parked as `unknown` on
// timeout/crash, where a reconciler (S3) must prove non-commit before any retry.
//
// S1 scope: pure helpers + tenant-scoped storage helpers ONLY. Nothing calls this yet;
// the S2 middleware wrap (server/tools/middleware/) is a separate slice. Risk classes
// REUSE the destructive-tool-policy taxonomy (type-only import — no runtime coupling).

import { createHash } from "node:crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import type { ToolRiskLevel } from "../safety/destructive-tool-policy";

export type ActionAttemptState =
  | "prepared"
  | "executing"
  | "committed"
  | "failed"
  | "unknown"
  | "compensated";

/**
 * Legal state machine. `failed` and `compensated` are terminal — a retry is a NEW
 * row that reuses the SAME idempotency key (so providers dedupe), never a state flip.
 */
const TRANSITIONS: Record<ActionAttemptState, ActionAttemptState[]> = {
  prepared: ["executing", "committed", "failed", "unknown"],
  executing: ["committed", "failed", "unknown"],
  unknown: ["committed", "failed", "compensated"],
  committed: ["compensated"],
  failed: [],
  compensated: [],
};

export function isValidTransition(from: ActionAttemptState, to: ActionAttemptState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Ledger obligation per the destructive-tool-policy risk taxonomy (spec: mandatory
 * for destructive [incl. financial], opt-in for sensitive writes, never for safe/read).
 */
export function ledgerObligation(risk: ToolRiskLevel): "mandatory" | "opt-in" | "never" {
  if (risk === "destructive") return "mandatory";
  if (risk === "sensitive") return "opt-in";
  return "never";
}

/** Deterministic, key-order-insensitive hash of tool arguments. */
export function hashArgs(args: unknown): string {
  return createHash("sha256").update(stableStringify(args)).digest("hex");
}

/**
 * Deterministic idempotency key: same operation + same args ⇒ same key, so a
 * reconciled retry dedupes at providers that honor idempotency (Stripe et al.).
 * Prefixed + truncated to stay within common provider key-length limits (≤255).
 */
export function deriveIdempotencyKey(operationId: string, argumentsHash: string): string {
  if (!operationId || !argumentsHash) {
    throw new Error("[action-ledger] deriveIdempotencyKey requires operationId and argumentsHash");
  }
  const digest = createHash("sha256").update(`${operationId}:${argumentsHash}`).digest("hex");
  return `vc-al1-${digest.slice(0, 48)}`;
}

/** Shape of every key deriveIdempotencyKey can produce (S5 reuse validation). */
export const IDEMPOTENCY_KEY_SHAPE = /^vc-al1-[0-9a-f]{48}$/;

/** Stable JSON: object keys sorted recursively; undefined ≡ absent (JSON semantics). */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>)
    .filter(k => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

function assertTenant(tenantId: number, fn: string): void {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`[action-ledger] ${fn} requires a positive integer tenantId (got ${tenantId})`);
  }
}

export interface PrepareAttemptInput {
  tenantId: number;
  operationId: string;
  toolName: string;
  args: unknown;
  risk: ToolRiskLevel;
  planId?: number | null;
  runId?: number | null;
  conversationId?: number | null;
  /**
   * S5 — reconciled-timeout retry: reuse the ORIGINAL attempt's deterministic
   * key VERBATIM instead of deriving a fresh one ("a retry is a NEW row that
   * reuses the SAME idempotency key — so providers dedupe"). Only the S2
   * middleware passes this, sourced from the unforgeable ALS retry directive.
   * Malformed keys throw (fail closed — a bad key defeats provider dedupe).
   */
  reuseIdempotencyKey?: string;
  /** S5 — id of the original attempt this retry supersedes (receipt linkage). */
  retryOfAttemptId?: number;
}

export interface PreparedAttempt {
  id: number;
  idempotencyKey: string;
  argumentsHash: string;
}

/**
 * Persist a `prepared` row BEFORE crossing the external boundary. Throws on failure —
 * a ledger-mandatory tool must NOT execute if the prepare write failed (fail closed);
 * the S2 caller decides that, not this helper.
 */
export async function prepareAttempt(i: PrepareAttemptInput): Promise<PreparedAttempt> {
  assertTenant(i.tenantId, "prepareAttempt");
  if (!i.operationId || !i.toolName) {
    throw new Error("[action-ledger] prepareAttempt requires operationId and toolName");
  }
  const argumentsHash = hashArgs(i.args);
  let idempotencyKey: string;
  if (i.reuseIdempotencyKey !== undefined) {
    if (!IDEMPOTENCY_KEY_SHAPE.test(i.reuseIdempotencyKey)) {
      throw new Error(`[action-ledger] reuseIdempotencyKey is not a valid vc-al1 key (fail closed)`);
    }
    idempotencyKey = i.reuseIdempotencyKey;
  } else {
    idempotencyKey = deriveIdempotencyKey(i.operationId, argumentsHash);
  }
  const retryReceipt = i.retryOfAttemptId !== undefined && Number.isInteger(i.retryOfAttemptId) && i.retryOfAttemptId > 0
    ? JSON.stringify({ retry_of_attempt_id: i.retryOfAttemptId })
    : null;
  const result = await db.execute(sql`
    INSERT INTO action_attempts
      (tenant_id, operation_id, plan_id, run_id, conversation_id, tool_name, arguments_hash, idempotency_key, risk, state, provider_receipt)
    VALUES
      (${i.tenantId}, ${i.operationId}, ${i.planId ?? null}, ${i.runId ?? null}, ${i.conversationId ?? null},
       ${i.toolName}, ${argumentsHash}, ${idempotencyKey}, ${i.risk}, 'prepared', ${retryReceipt}::jsonb)
    RETURNING id
  `);
  const rows = (result as any).rows || result;
  const id = Number(rows?.[0]?.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("[action-ledger] prepareAttempt insert returned no id");
  }
  return { id, idempotencyKey, argumentsHash };
}

/** Mark a prepared row as executing (optional checkpoint; not required by S2). */
export async function markExecuting(id: number, tenantId: number): Promise<boolean> {
  return transition(id, tenantId, ["prepared"], "executing", {});
}

/**
 * Settle to a terminal-ish outcome. Guarded UPDATE: only fires if the current state
 * legally precedes the target (the WHERE clause IS the state machine — concurrent
 * settlers can't double-settle). Returns false if no row transitioned.
 */
export async function settleAttempt(
  id: number,
  tenantId: number,
  outcome: "committed" | "failed",
  opts: { providerReceipt?: unknown; error?: string } = {},
): Promise<boolean> {
  const from: ActionAttemptState[] = outcome === "committed"
    ? ["prepared", "executing", "unknown"]
    : ["prepared", "executing", "unknown"];
  return transition(id, tenantId, from, outcome, opts);
}

/** Park as `unknown` (timeout/crash — outcome unprovable until the reconciler settles it). */
export async function markUnknown(id: number, tenantId: number, reason?: string): Promise<boolean> {
  return transition(id, tenantId, ["prepared", "executing"], "unknown", { error: reason });
}

/** Record a compensation (true rollback) of a committed or unknown attempt. */
export async function markCompensated(
  id: number,
  tenantId: number,
  opts: { providerReceipt?: unknown; error?: string } = {},
): Promise<boolean> {
  return transition(id, tenantId, ["committed", "unknown"], "compensated", opts);
}

async function transition(
  id: number,
  tenantId: number,
  from: ActionAttemptState[],
  to: ActionAttemptState,
  opts: { providerReceipt?: unknown; error?: string },
): Promise<boolean> {
  assertTenant(tenantId, `transition(${to})`);
  for (const f of from) {
    if (!isValidTransition(f, to)) {
      throw new Error(`[action-ledger] illegal transition ${f} -> ${to}`);
    }
  }
  const receiptJson = opts.providerReceipt !== undefined ? JSON.stringify(opts.providerReceipt) : null;
  const result = await db.execute(sql`
    UPDATE action_attempts
    SET state = ${to},
        settled_at = CASE WHEN ${to} IN ('committed','failed','compensated') THEN now() ELSE settled_at END,
        committed_at = CASE WHEN ${to} = 'committed' THEN now() ELSE committed_at END,
        provider_receipt = COALESCE(${receiptJson}::jsonb, provider_receipt),
        error = COALESCE(${opts.error ?? null}, error)
    WHERE id = ${id} AND tenant_id = ${tenantId} AND state = ANY(${`{${from.join(",")}}`}::text[])
  `);
  const rowCount = Number((result as any).rowCount ?? (result as any).count ?? 0);
  return rowCount > 0;
}

/** S5 — read a single attempt's current state (timeout-retry reconcile poll). */
export async function getAttemptState(id: number, tenantId: number): Promise<ActionAttemptState | undefined> {
  assertTenant(tenantId, "getAttemptState");
  const result = await db.execute(sql`
    SELECT state FROM action_attempts WHERE id = ${id} AND tenant_id = ${tenantId}
  `);
  const rows = (result as any).rows || result;
  const s = rows?.[0]?.state;
  return typeof s === "string" ? (s as ActionAttemptState) : undefined;
}

/** Bounded fetch of `unknown` rows for the S3 reconciler. Tenant-scoped. */
export async function listUnknownAttempts(tenantId: number, limit = 25): Promise<Array<Record<string, unknown>>> {
  assertTenant(tenantId, "listUnknownAttempts");
  const capped = Math.max(1, Math.min(200, Math.floor(limit)));
  const result = await db.execute(sql`
    SELECT id, operation_id, tool_name, arguments_hash, idempotency_key, risk, started_at, error
    FROM action_attempts
    WHERE tenant_id = ${tenantId} AND state = 'unknown'
    ORDER BY started_at ASC
    LIMIT ${capped}
  `);
  return ((result as any).rows || result) as Array<Record<string, unknown>>;
}

// ── S3 reconciler helpers (contract: plan.md § S3) ──────────────────────────
// The three helpers below are CROSS-TENANT BY DESIGN: the reconciler is a
// platform-maintenance loop (same class as checkPace/heartbeat_logs — see the
// pace-gate global-by-design precedent), not a tenant-facing query surface.
// Every row it touches still carries its own tenant_id, and every WRITE it
// performs goes through the tenant-scoped transition()/markReconcilerDigested
// with the row's OWN tenant — no write ever crosses tenants.

/** Shape the reconciler consumes. `digestedAt` is the owner-digest dedup marker. */
export interface UnknownAttemptRow {
  id: number;
  tenantId: number;
  operationId: string;
  toolName: string;
  argumentsHash: string;
  idempotencyKey: string;
  risk: string;
  startedAt: Date | string;
  error: string | null;
  digestedAt: string | null;
}

/** Bounded cross-tenant fetch of `unknown` rows, oldest first. */
export async function listUnknownAttemptsAllTenants(limit = 50): Promise<UnknownAttemptRow[]> {
  const capped = Math.max(1, Math.min(200, Math.floor(limit)));
  const result = await db.execute(sql`
    SELECT id, tenant_id, operation_id, tool_name, arguments_hash, idempotency_key, risk,
           started_at, error, provider_receipt->>'reconciler_digested_at' AS digested_at
    FROM action_attempts
    WHERE state = 'unknown'
    ORDER BY started_at ASC
    LIMIT ${capped}
  `);
  const rows = ((result as any).rows || result) as Array<Record<string, any>>;
  return rows.map(r => ({
    id: Number(r.id),
    tenantId: Number(r.tenant_id),
    operationId: String(r.operation_id),
    toolName: String(r.tool_name),
    argumentsHash: String(r.arguments_hash),
    idempotencyKey: String(r.idempotency_key),
    risk: String(r.risk),
    startedAt: r.started_at,
    error: r.error ?? null,
    digestedAt: r.digested_at ?? null,
  }));
}

/**
 * Sweep stale in-flight rows (`prepared`/`executing` older than the threshold)
 * to `unknown` — the crash-recovery half of the reconciler (contract acceptance:
 * "a crash between prepare and settle leaves a row the reconciler finds").
 * A row this old means the process died or hung past any tool timeout; the
 * outcome is unprovable, which is exactly what `unknown` states. Bounded and
 * guarded: only the two in-flight states can transition (same edges the state
 * machine allows), and the batch is capped.
 */
export async function sweepStaleAttempts(olderThanMinutes = 30, limit = 200): Promise<number> {
  const mins = Math.max(5, Math.floor(olderThanMinutes));
  const capped = Math.max(1, Math.min(500, Math.floor(limit)));
  const reason = `stale: swept to unknown by reconciler after ${mins}m in-flight`;
  const result = await db.execute(sql`
    UPDATE action_attempts
    SET state = 'unknown', error = COALESCE(error, ${reason})
    WHERE id IN (
      SELECT id FROM action_attempts
      WHERE state IN ('prepared','executing')
        AND started_at < now() - (${mins} * interval '1 minute')
      ORDER BY started_at ASC
      LIMIT ${capped}
    )
  `);
  return Number((result as any).rowCount ?? (result as any).count ?? 0);
}

/**
 * Stamp the owner-digest dedup marker into provider_receipt so an unresolvable
 * `unknown` row is digested to the owner ONCE, never re-paged on every sweep.
 * Merge-only jsonb write; the row stays `unknown` (still visible/settleable).
 */
export async function markReconcilerDigested(id: number, tenantId: number): Promise<boolean> {
  assertTenant(tenantId, "markReconcilerDigested");
  const result = await db.execute(sql`
    UPDATE action_attempts
    SET provider_receipt = COALESCE(provider_receipt, '{}'::jsonb)
                           || jsonb_build_object('reconciler_digested_at', now()::text)
    WHERE id = ${id} AND tenant_id = ${tenantId} AND state = 'unknown'
  `);
  return Number((result as any).rowCount ?? (result as any).count ?? 0) > 0;
}
