/**
 * R106 Nugget #1 — L0–L5 Failure Attribution Levels (LuaN1aoAgent, Apache-2.0).
 *
 * Strict-progressive attribution: a failure is only attributed to a higher
 * level after lower levels have been excluded. Used by the reflexive auto-
 * revise loops (Felix grade-then-revise, build_html_app retry, commitments
 * scanner) to decide whether to retry as-is, fix prerequisites, back off,
 * regenerate the hypothesis, or escalate to HITL.
 *
 * L0 OBSERVATION       — raw uninterpreted output (informational only)
 * L1 TOOL_FAILURE       — tool itself blew up (network, syntax, perms) → RETRY
 * L2 PREREQUISITE       — auth expired, dependency missing → FIX_PREREQ
 * L3 ENVIRONMENT        — rate-limited, blocked, upstream down → BACKOFF
 * L4 HYPOTHESIS         — underlying assumption falsified → REGENERATE_PLAN
 * L5 STRATEGY           — strategic deadlock / goal drift → ESCALATE_HITL
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

export type FailureLevel = "L0" | "L1" | "L2" | "L3" | "L4" | "L5";

export type FailureAction =
  | "RETRY"
  | "FIX_PREREQ"
  | "BACKOFF"
  | "REGENERATE_PLAN"
  | "ESCALATE_HITL"
  | "OBSERVE_ONLY";

export const LEVEL_TO_ACTION: Record<FailureLevel, FailureAction> = {
  L0: "OBSERVE_ONLY",
  L1: "RETRY",
  L2: "FIX_PREREQ",
  L3: "BACKOFF",
  L4: "REGENERATE_PLAN",
  L5: "ESCALATE_HITL",
};

export interface AttributionInput {
  tenantId: number;
  scope: string;       // 'grade_deliverable' | 'build_html_app' | 'commitment' | 'subagent_chunk' | etc.
  scopeRef: string;    // a stable id within scope (job id, commitment id, etc.)
  level: FailureLevel;
  detail?: string;
  context?: Record<string, any>;
}

export interface AttributionRow extends AttributionInput {
  id: number;
  createdAt: Date;
  recommendedAction: FailureAction;
}

export async function recordAttribution(input: AttributionInput): Promise<AttributionRow> {
  const r = await db.execute(sql`
    INSERT INTO failure_attributions (tenant_id, scope, scope_ref, level, detail, context)
    VALUES (${input.tenantId}, ${input.scope}, ${input.scopeRef}, ${input.level},
            ${input.detail ?? ""}, ${JSON.stringify(input.context ?? {})}::jsonb)
    RETURNING id, created_at
  `);
  const row = ((r as any).rows ?? r)[0];
  return {
    ...input,
    id: Number(row.id),
    createdAt: row.created_at,
    recommendedAction: LEVEL_TO_ACTION[input.level],
  };
}

export async function recentAttributions(
  tenantId: number,
  scope: string,
  scopeRef: string,
  limit = 10,
): Promise<AttributionRow[]> {
  const r = await db.execute(sql`
    SELECT id, level, detail, context, created_at
    FROM failure_attributions
    WHERE tenant_id = ${tenantId} AND scope = ${scope} AND scope_ref = ${scopeRef}
    ORDER BY id DESC LIMIT ${limit}
  `);
  return ((r as any).rows ?? r).map((row: any) => ({
    id: Number(row.id),
    tenantId,
    scope,
    scopeRef,
    level: row.level as FailureLevel,
    detail: row.detail || "",
    context: row.context || {},
    createdAt: row.created_at,
    recommendedAction: LEVEL_TO_ACTION[row.level as FailureLevel] ?? "OBSERVE_ONLY",
  }));
}

/**
 * Given the most-recent N attributions for a scope_ref, decide what to do
 * next. Implements the "consecutive >=3 L4s ⇒ promote to L5" pattern from
 * the LuaN1aoAgent reflection_principles trigger table.
 */
export function decideNextAction(history: AttributionRow[]): {
  action: FailureAction;
  reason: string;
  promoted?: boolean;
} {
  if (history.length === 0) return { action: "RETRY", reason: "no prior attribution" };
  const head = history[0];
  // True contiguous-prefix counting from the head (most recent backwards
  // until we hit a different level). Prevents false promotion on
  // interleaved sequences like L4,L1,L4,L1,L4 — which is NOT a streak.
  function contiguousPrefixCount(level: FailureLevel): number {
    let n = 0;
    for (const h of history) {
      if (h.level === level) n++;
      else break;
    }
    return n;
  }
  // Promote L4 streak ≥3 to L5 strategy failure (deep-reflection trigger).
  if (head.level === "L4") {
    const l4Streak = contiguousPrefixCount("L4");
    if (l4Streak >= 3) {
      return {
        action: "ESCALATE_HITL",
        reason: `${l4Streak} consecutive L4 falsifications — promoted to L5 strategic failure (deep-reflection trigger)`,
        promoted: true,
      };
    }
  }
  // L1 streak ≥3 means retry isn't working — escalate one level.
  if (head.level === "L1") {
    const l1Streak = contiguousPrefixCount("L1");
    if (l1Streak >= 3) {
      return { action: "BACKOFF", reason: `${l1Streak} consecutive L1 tool failures — backing off` };
    }
  }
  return { action: head.recommendedAction, reason: `latest attribution is ${head.level}` };
}
