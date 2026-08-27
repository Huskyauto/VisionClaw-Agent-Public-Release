// R98.25 — MNEMA Nugget 5: decline events as first-class typed rows.
//
// Today refusals are scattered: intent-gate writes security_intent_checks,
// destructive-tool-policy writes security_tool_blocks, persona "I don't have
// enough info" replies are just LLM strings, and restraint-budget timeouts are
// console.warn lines. None of those feed Nugget 2's restraint-precision counter
// because that counter needs a *single* canonical event stream of "X declined
// because Y" rows.
//
// This module provides that single stream. Existing block sites keep their
// dedicated audit tables (don't break the security forensic trail) and ALSO
// emit a decline_event for the cross-cutting telemetry.
//
// Fail-open: a DB hiccup must not turn a refusal into an accidental allow.
// All writes are best-effort, fire-and-forget unless the caller explicitly
// awaits.

import { db } from "../db";
import { sql } from "drizzle-orm";

export type DeclineSource =
  | "intent_gate"
  | "tool_policy"
  | "moa"
  | "persona"
  | "safety_guard"
  | "scheduler";

export type DeclineReason =
  | "insufficient_evidence"
  | "policy_block"
  | "cross_family_disagreement"
  | "restraint_budget"
  | "safety_guard"
  | "approval_required";

const VALID_SOURCES = new Set<DeclineSource>([
  "intent_gate", "tool_policy", "moa", "persona", "safety_guard", "scheduler",
]);
const VALID_REASONS = new Set<DeclineReason>([
  "insufficient_evidence", "policy_block", "cross_family_disagreement",
  "restraint_budget", "safety_guard", "approval_required",
]);

export interface RecordDeclineOpts {
  tenantId: number;
  personaId?: number | null;
  conversationId?: number | null;
  source: DeclineSource;
  reason: DeclineReason;
  detail?: string;
  toolName?: string;
  flaggedCategories?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Insert a typed decline_event row. Returns { ok } so callers can know if the
 * write succeeded but never throws — refusal flow MUST NOT depend on this
 * succeeding (logging the refusal is a nice-to-have; refusing is the safety
 * critical part).
 */
export async function recordDecline(opts: RecordDeclineOpts): Promise<{ ok: boolean; error?: string }> {
  if (!opts.tenantId || !Number.isInteger(opts.tenantId)) {
    return { ok: false, error: "tenantId required" };
  }
  if (!VALID_SOURCES.has(opts.source)) return { ok: false, error: `invalid source: ${opts.source}` };
  if (!VALID_REASONS.has(opts.reason)) return { ok: false, error: `invalid reason: ${opts.reason}` };
  try {
    const detail = (opts.detail || "").replace(/\u0000/g, "").slice(0, 500); // bounded + null-byte safe
    // R98.27.4 — strip NUL bytes BEFORE escaping; pg rejects NUL in text values
    // and the {literal} builder won't catch it. Architect MEDIUM finding.
    const flagged = (opts.flaggedCategories || [])
      .slice(0, 20)
      .map(c => String(c).replace(/\u0000/g, "").slice(0, 80))
      .filter(s => s.length > 0);
    // Drizzle's sql`` template binds JS arrays as a single parameter; pg then
    // hands the value to Postgres as a scalar string and the `::text[]` cast
    // fails with "malformed array literal" (caught in CI 25525911070). Build
    // the Postgres array literal ourselves — same pattern as server/tools.ts
    // and server/routes/projects.ts use for the projects.tags column.
    const flaggedLiteral = flagged.length > 0
      ? `{${flagged.map(c => `"${c.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`
      : null;
    await db.execute(sql`
      INSERT INTO decline_events (
        tenant_id, persona_id, conversation_id, source, reason,
        detail, tool_name, flagged_categories, metadata
      ) VALUES (
        ${opts.tenantId},
        ${opts.personaId ?? null},
        ${opts.conversationId ?? null},
        ${opts.source},
        ${opts.reason},
        ${detail || null},
        ${opts.toolName || null},
        ${flaggedLiteral}::text[],
        ${opts.metadata ? JSON.stringify(opts.metadata) : null}::jsonb
      )
    `);
    return { ok: true };
  } catch (err) {
    // Quiet warn — refusal already happened upstream; this is just telemetry.
    console.warn(`[decline-events] insert failed (non-fatal): ${(err as Error).message?.slice(0, 160)}`);
    return { ok: false, error: (err as Error).message?.slice(0, 200) };
  }
}

/**
 * Convenience: record AND fire-and-forget. Use this in safety-critical paths
 * where you don't want to await before returning the refusal to the user.
 */
export function recordDeclineAsync(opts: RecordDeclineOpts): void {
  // Detached promise; we already log inside recordDecline on failure.
  void recordDecline(opts);
}
