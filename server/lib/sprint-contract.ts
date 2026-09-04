/**
 * Sprint Contract (R115.5) — pre-flight "done condition" pin.
 *
 * Inspired by Osmani's "Agent Harness Engineering" (O'Reilly Radar,
 * 2026-05-15) and Anthropic's long-running-harness post: separating
 * generation from evaluation outperforms self-evaluation, and writing the
 * acceptance criteria down BEFORE the work starts catches more scope drift
 * than any prompt change.
 *
 * Lifecycle:
 *   1. Caller (Felix / a subagent / a task agent) pins a contract at job
 *      kickoff via `pinDoneCondition` — passes `{refKind, refId,
 *      doneCondition}`. The contract gets sha256-stamped + tenant-scoped.
 *   2. Generator does the work without seeing the evaluator's view.
 *   3. Evaluator calls `getDoneCondition` and grades against the verbatim
 *      pinned text (NOT a re-imagined criterion).
 *   4. Caller records the verdict via `evaluateAgainstContract`.
 *
 * Pinning policy:
 *   - One OPEN contract per (tenantId, refKind, refId) at a time. Pinning
 *     when an open contract already exists with DIFFERENT doneCondition
 *     fails CLOSED unless `force:true` — then the prior is cancelled and a
 *     new row is inserted (audit trail preserved).
 *   - Idempotent: pinning the SAME content for the SAME (refKind, refId)
 *     returns the existing row unchanged.
 *   - doneCondition must be 10–2000 chars after trim. Anything shorter is
 *     not a real acceptance criterion; anything longer is a runbook, not a
 *     contract.
 *
 * Tenant isolation: every read + write filters by session-derived tenantId.
 * There is NO mode where a contract can be read or written cross-tenant.
 *
 * Security posture: read-only LLM evaluation; non-destructive; not in
 * TOOL_POLICIES destructive surface (but `pin_done_condition` is marked
 * `sensitive` MEDIUM because it can mark a sibling contract as cancelled
 * via force=true).
 */

import { createHash } from "node:crypto";
import { db } from "../db";
import { sprintContracts, type SprintContract } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";

export const SPRINT_CONTRACT_STATUSES = ["open", "passed", "failed", "cancelled"] as const;
export type SprintContractStatus = (typeof SPRINT_CONTRACT_STATUSES)[number];

export const MIN_DONE_CONDITION_CHARS = 10;
export const MAX_DONE_CONDITION_CHARS = 2000;

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function normalizeDoneCondition(raw: string): string {
  // Whitespace-normalize: trim, collapse internal runs of whitespace to
  // single spaces. Two contracts that differ only in trailing newline are
  // the SAME contract.
  return String(raw || "").replace(/\s+/g, " ").trim();
}

export interface PinDoneConditionInput {
  tenantId: number;
  refKind: string;
  refId: string;
  doneCondition: string;
  criteria?: Record<string, unknown>;
  pinnedBy?: string;
  force?: boolean;
}

export interface PinDoneConditionResult {
  ok: boolean;
  contract?: SprintContract;
  cancelledPriorId?: number;
  reused?: boolean;
  error?: string;
}

export async function pinDoneCondition(input: PinDoneConditionInput): Promise<PinDoneConditionResult> {
  return pinDoneConditionInternal(input, /*attempt*/ 0);
}

// R115.5 MED-1 (architect close): pin path now race-safe via partial unique
// index `uq_sprint_contracts_open_per_ref` (at most one OPEN row per
// tenant+refKind+refId). On the 23505 unique-violation race, we re-run the
// lookup ONCE — the winner's row is now visible and we apply the standard
// idempotent-reuse / force-cancel / collision-error logic to it.
async function pinDoneConditionInternal(input: PinDoneConditionInput, attempt: number): Promise<PinDoneConditionResult> {
  if (typeof input.tenantId !== "number" || !Number.isInteger(input.tenantId) || input.tenantId <= 0) {
    return { ok: false, error: "tenantId required" };
  }
  const refKind = String(input.refKind || "").trim();
  const refId = String(input.refId || "").trim();
  if (!refKind) return { ok: false, error: "refKind required" };
  if (!refId) return { ok: false, error: "refId required" };
  const normalized = normalizeDoneCondition(input.doneCondition);
  if (normalized.length < MIN_DONE_CONDITION_CHARS) {
    return { ok: false, error: `doneCondition must be ≥${MIN_DONE_CONDITION_CHARS} chars after trim` };
  }
  if (normalized.length > MAX_DONE_CONDITION_CHARS) {
    return { ok: false, error: `doneCondition must be ≤${MAX_DONE_CONDITION_CHARS} chars after trim` };
  }
  const hash = sha256(normalized);

  // Look up existing open contract for this (tenantId, refKind, refId).
  const existing = await db.select().from(sprintContracts).where(and(
    eq(sprintContracts.tenantId, input.tenantId),
    eq(sprintContracts.refKind, refKind),
    eq(sprintContracts.refId, refId),
    eq(sprintContracts.status, "open"),
  ));

  if (existing.length > 0) {
    const prior = existing[0];
    if (prior.contentSha256 === hash) {
      // Same content — idempotent reuse.
      return { ok: true, contract: prior, reused: true };
    }
    if (!input.force) {
      return {
        ok: false,
        error: `open contract already exists for (${refKind}, ${refId}) with different doneCondition; pass force:true to override (prior id=${prior.id})`,
      };
    }
    // Force path: cancel prior, then insert. If a concurrent caller pinned
    // between our cancel and insert, the partial unique index will reject
    // our insert with 23505 and we re-run once.
    await db.update(sprintContracts).set({ status: "cancelled" }).where(and(
      eq(sprintContracts.id, prior.id),
      eq(sprintContracts.tenantId, input.tenantId), // belt + suspenders
    ));
    try {
      const [inserted] = await db.insert(sprintContracts).values({
        tenantId: input.tenantId,
        refKind,
        refId,
        doneCondition: normalized,
        criteria: input.criteria || {},
        pinnedBy: input.pinnedBy || null,
        contentSha256: hash,
      }).returning();
      return { ok: true, contract: inserted, cancelledPriorId: prior.id };
    } catch (e: any) {
      if (isUniqueViolation(e) && attempt === 0) {
        return pinDoneConditionInternal(input, 1);
      }
      throw e;
    }
  }

  try {
    const [inserted] = await db.insert(sprintContracts).values({
      tenantId: input.tenantId,
      refKind,
      refId,
      doneCondition: normalized,
      criteria: input.criteria || {},
      pinnedBy: input.pinnedBy || null,
      contentSha256: hash,
    }).returning();
    return { ok: true, contract: inserted };
  } catch (e: any) {
    if (isUniqueViolation(e) && attempt === 0) {
      // A concurrent caller won the race; re-run lookup-first path so we
      // see their row and apply idempotent/force/collision logic.
      return pinDoneConditionInternal(input, 1);
    }
    throw e;
  }
}

function isUniqueViolation(e: any): boolean {
  // Postgres SQLSTATE 23505. Drizzle bubbles either `e.code` or
  // `e.cause.code`; both are checked.
  return Boolean(e && (e.code === "23505" || (e.cause && e.cause.code === "23505")));
}

export interface GetDoneConditionInput {
  tenantId: number;
  refKind: string;
  refId: string;
  status?: SprintContractStatus; // default 'open'
}

export async function getDoneCondition(input: GetDoneConditionInput): Promise<{ ok: boolean; contract?: SprintContract; error?: string }> {
  if (typeof input.tenantId !== "number" || !Number.isInteger(input.tenantId) || input.tenantId <= 0) {
    return { ok: false, error: "tenantId required" };
  }
  const status = input.status || "open";
  if (!(SPRINT_CONTRACT_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: `status must be one of ${SPRINT_CONTRACT_STATUSES.join("|")}` };
  }
  const rows = await db.select().from(sprintContracts).where(and(
    eq(sprintContracts.tenantId, input.tenantId),
    eq(sprintContracts.refKind, String(input.refKind || "").trim()),
    eq(sprintContracts.refId, String(input.refId || "").trim()),
    eq(sprintContracts.status, status),
  )).limit(1);
  if (rows.length === 0) return { ok: false, error: "no_contract" };
  return { ok: true, contract: rows[0] };
}

export interface EvaluateAgainstContractInput {
  tenantId: number;
  refKind: string;
  refId: string;
  evidence: string;       // submitted artifact / summary to grade
  verdict: "passed" | "failed";
  scoredBy?: string;      // 'felix' | 'architect-subagent' | 'human' | etc.
  notes?: string;
}

export async function evaluateAgainstContract(input: EvaluateAgainstContractInput): Promise<{ ok: boolean; contract?: SprintContract; error?: string }> {
  if (input.verdict !== "passed" && input.verdict !== "failed") {
    return { ok: false, error: "verdict must be 'passed' or 'failed'" };
  }
  const lookup = await getDoneCondition({ tenantId: input.tenantId, refKind: input.refKind, refId: input.refId, status: "open" });
  if (!lookup.ok || !lookup.contract) return { ok: false, error: lookup.error || "no_open_contract" };
  const prior = lookup.contract;
  // CAS-pin check: refuse to grade if the on-row sha256 doesn't match what
  // we just hashed from the stored doneCondition (tamper detection).
  if (prior.contentSha256 !== sha256(prior.doneCondition)) {
    return { ok: false, error: "contract_tampered: doneCondition hash mismatch" };
  }
  const evaluation = {
    verdict: input.verdict,
    scoredBy: input.scoredBy || "system",
    notes: String(input.notes || "").slice(0, 4000),
    evidence: String(input.evidence || "").slice(0, 4000),
    evaluatedAt: new Date().toISOString(),
    contractSha256: prior.contentSha256,
  };
  const [updated] = await db.update(sprintContracts).set({
    status: input.verdict === "passed" ? "passed" : "failed",
    evaluatedAt: new Date(),
    evaluation,
  }).where(and(
    eq(sprintContracts.id, prior.id),
    eq(sprintContracts.tenantId, input.tenantId),
    eq(sprintContracts.status, "open"),
  )).returning();
  if (!updated) return { ok: false, error: "claim_failed (concurrent state change)" };
  return { ok: true, contract: updated };
}

export interface ListSprintContractsInput {
  tenantId: number;
  status?: SprintContractStatus;
  refKind?: string;
  limit?: number;
}

export async function listSprintContracts(input: ListSprintContractsInput): Promise<SprintContract[]> {
  const limit = Math.max(1, Math.min(200, Number(input.limit) || 50));
  const filters: any[] = [eq(sprintContracts.tenantId, input.tenantId)];
  if (input.status) filters.push(eq(sprintContracts.status, input.status));
  if (input.refKind) filters.push(eq(sprintContracts.refKind, input.refKind));
  return db.select().from(sprintContracts)
    .where(and(...filters))
    .orderBy(sql`pinned_at DESC`)
    .limit(limit);
}
