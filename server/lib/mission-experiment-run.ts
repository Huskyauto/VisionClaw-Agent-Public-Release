// ─────────────────────────────────────────────────────────────────────────────
// Verified Revenue Missions — S3: approved experiment → capped send via the
// existing outreach machinery (outreach_sequences / outreach_enrollments),
// plus reply-evidence helpers and kill-time enrollment pausing.
// Feature contract: data/feature-contracts/revenue-missions.
//
// HITL fail-closed: the send path is UNREACHABLE unless the experiment carries
// approvedByOwnerAt (assertSendAllowed throws before any write). Caps are
// enforced by REFUSING, never truncating. Deterministic module — no LLM calls
// (reply classification here is a keyword heuristic; the LLM classifier in
// agentic-features is not on this path).
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  canTransition,
  getExperiment,
  getMission,
  HARD_CAPS,
  clampCap,
  type ExperimentProspect,
  type ExperimentVariant,
} from "./revenue-missions";

function rows(res: unknown): any[] {
  return ((res as any)?.rows || res || []) as any[];
}

function assertTenant(tenantId: number): void {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`mission-experiment-run: invalid tenantId ${tenantId} (fail closed)`);
  }
}

/** Mandatory opt-out line — appended to EVERY outgoing variant (contract). */
export const OPT_OUT_LINE =
  "P.S. If you'd rather not hear about this, just reply \"no thanks\" and I won't bring it up again.";

/**
 * Fail-closed HITL gate. Throws unless the experiment row carries
 * approved_by_owner_at AND is in a sendable status. Pure — no DB access.
 */
export function assertSendAllowed(exp: any): void {
  if (!exp) throw new Error("experiment not found (fail closed)");
  if (!exp.approved_by_owner_at) {
    throw new Error("experiment is not owner-approved — send path is unreachable (HITL, fail closed)");
  }
  if (exp.status !== "approved") {
    throw new Error(`experiment status is '${exp.status}' — only 'approved' can start sending`);
  }
}

/**
 * Build the outreach sequence steps from the experiment variants. Pure.
 * - Caps steps at maxContactsPerProspect (clamped to the contract ceiling).
 * - Every step body gets the reply token footer + mandatory opt-out line.
 * - Refuses (throws) on zero variants — never sends an empty sequence.
 */
export function buildSequenceSteps(
  variants: ExperimentVariant[],
  maxContactsPerProspect: number,
  replyToken: string,
): Array<{ subject: string; bodyTemplate: string; waitDays: number }> {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error("experiment has no message variants (refusing)");
  }
  const cap = clampCap(maxContactsPerProspect, HARD_CAPS.maxContactsPerProspect);
  return variants.slice(0, cap).map((v, i) => ({
    subject: `${v.subject} [${replyToken}]`,
    bodyTemplate: `${v.body.trim()}\n\n${OPT_OUT_LINE}\n[ref: ${replyToken}]`,
    waitDays: i === 0 ? 3 : 4,
  }));
}

/** Deterministic keyword classifier for scanned replies. Pure. */
export function classifyReplyText(text: string): "positive_reply" | "negative_reply" {
  const t = (text || "").toLowerCase();
  const negative = [
    "unsubscribe", "no thanks", "not interested", "stop emailing", "stop contacting",
    "remove me", "don't contact", "do not contact", "opt out", "opt-out", "leave me alone",
  ];
  return negative.some((k) => t.includes(k)) ? "negative_reply" : "positive_reply";
}

export interface RunResult {
  alreadyRan: boolean;
  sequenceId?: number;
  enrolled?: number;
  skipped?: Array<{ email: string; reason: string }>;
}

/**
 * Turn an APPROVED experiment into a live capped outreach sequence.
 * Idempotent: if the experiment already carries a sequence_id, no-op.
 * Refuses (never truncates) when prospects exceed the stored cap.
 */
export async function runApprovedExperiment(args: {
  tenantId: number;
  experimentId: number;
}): Promise<RunResult> {
  assertTenant(args.tenantId);
  const exp = await getExperiment(args.tenantId, args.experimentId);
  if (!exp) throw new Error("experiment not found");
  if (exp.sequence_id) return { alreadyRan: true, sequenceId: Number(exp.sequence_id) };
  assertSendAllowed(exp);

  const mission = await getMission(args.tenantId, Number(exp.mission_id));
  if (!mission) throw new Error("mission not found");
  if (mission.stage === "killed") throw new Error("mission is killed — refusing to send");

  // Spend-cap gate (fail closed): refuse to launch if the mission's recorded
  // spend already meets/exceeds the experiment's clamped spend cap, or if the
  // recorded spend cannot be parsed as a number. Email sends are zero-marginal-
  // cost, but the ceiling must be PROVEN headroom, not assumed.
  const spendCap = clampCap(exp.max_spend_usd_cents, HARD_CAPS.maxSpendUsdCents);
  const spendSoFar = Number(mission.spend_usd_cents ?? 0);
  if (!Number.isFinite(spendSoFar)) {
    throw new Error("mission spend_usd_cents is unreadable — refusing to send (fail closed)");
  }
  if (spendSoFar >= spendCap) {
    throw new Error(`spend cap reached: ${spendSoFar} >= ${spendCap} usd cents (refusing to send)`);
  }

  const prospects: ExperimentProspect[] = Array.isArray(exp.prospects) ? exp.prospects : [];
  const maxProspects = clampCap(exp.max_prospects, HARD_CAPS.maxProspects);
  if (prospects.length === 0) throw new Error("experiment has no prospects (refusing)");
  if (prospects.length > maxProspects) {
    throw new Error(`prospect cap exceeded: ${prospects.length} > ${maxProspects} (refusing, not truncating)`);
  }
  const variants: ExperimentVariant[] = Array.isArray(exp.variants) ? exp.variants : [];
  const steps = buildSequenceSteps(variants, exp.max_contacts_per_prospect, exp.reply_token || `vcm-${exp.mission_id}-${exp.id}`);

  // Concurrency-safe launch claim (CAS): exactly ONE caller may move the row
  // from 'approved' to 'launching'. A concurrent second approve sees 0 rows
  // and returns as an idempotent no-op instead of creating a duplicate send.
  const claim = await db.execute(sql`
    UPDATE mission_experiments
    SET status = 'launching', updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${args.tenantId} AND id = ${args.experimentId}
      AND status = 'approved' AND sequence_id IS NULL
      AND approved_by_owner_at IS NOT NULL
    RETURNING id
  `);
  if (rows(claim).length === 0) {
    const latest = await getExperiment(args.tenantId, args.experimentId);
    return { alreadyRan: true, sequenceId: latest?.sequence_id ? Number(latest.sequence_id) : undefined };
  }

  const { createSequence, enrollInSequence } = await import("../agentic-features");
  let seq: Awaited<ReturnType<typeof createSequence>>;
  try {
    seq = await createSequence({
      tenantId: args.tenantId,
      name: `mission-${exp.mission_id}-exp-${exp.id}: ${exp.name}`,
      description: `Revenue Mission ${exp.mission_id} experiment ${exp.id} (reply token ${exp.reply_token ?? "n/a"})`,
      steps,
    });
    if (!seq.success || !seq.sequenceId) {
      throw new Error(`sequence creation failed: ${(seq as any).error ?? "unknown"}`);
    }
  } catch (e) {
    // Roll the claim back so a later retry can re-launch (only if we still
    // hold the claim — never clobber a row another path has since moved on).
    await db.execute(sql`
      UPDATE mission_experiments
      SET status = 'approved', updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${args.tenantId} AND id = ${args.experimentId}
        AND status = 'launching' AND sequence_id IS NULL
    `).catch(() => {});
    throw e;
  }

  let enrolled = 0;
  const skipped: Array<{ email: string; reason: string }> = [];
  for (const p of prospects) {
    const r = await enrollInSequence({
      tenantId: args.tenantId,
      sequenceId: seq.sequenceId,
      contactName: p.name,
      contactEmail: p.email,
      personalContext: p.whyMatched,
    });
    if (r.success) enrolled += 1;
    else skipped.push({ email: p.email, reason: String((r as any).error ?? "unknown") });
  }

  await db.execute(sql`
    UPDATE mission_experiments
    SET status = 'live', sequence_id = ${seq.sequenceId}, enrolled_count = ${enrolled},
        dry_run = false, updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${args.tenantId} AND id = ${args.experimentId}
  `);
  await db.execute(sql`
    UPDATE revenue_missions
    SET leads_contacted = leads_contacted + ${enrolled}, updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${args.tenantId} AND id = ${exp.mission_id}
  `);
  try {
    if (canTransition(mission.stage, "experiment_live")) {
      const { setStage } = await import("./revenue-missions");
      await setStage(args.tenantId, Number(exp.mission_id), "experiment_live");
    }
  } catch (e) {
    console.warn("[mission-experiment-run] stage advance failed (best-effort):", (e as any)?.message ?? e);
  }

  // Follow-up: check replies in 3 days (best-effort — the reply scan script is
  // also operator-runnable at any time).
  try {
    const { scheduleWake } = await import("../agentic/wake-scheduler");
    await scheduleWake({
      tenantId: args.tenantId,
      goal: `Check replies for Revenue Mission ${exp.mission_id} experiment ${exp.id}: run scripts/mission-reply-scan.ts and summarize evidence`,
      wakeAt: new Date(Date.now() + 3 * 86400000),
      kind: "revenue_mission_reply_check",
      createdBy: "revenue-missions-s3",
    });
  } catch (e) {
    console.warn("[mission-experiment-run] scheduleWake failed (best-effort):", (e as any)?.message ?? e);
  }

  return { alreadyRan: false, sequenceId: seq.sequenceId, enrolled, skipped };
}

/**
 * Kill-time: stop every live/paused enrollment attached to the mission's
 * experiments and mark live experiments cancelled. Idempotent.
 */
export async function pauseMissionEnrollments(tenantId: number, missionId: number): Promise<{ stoppedEnrollments: number; cancelledExperiments: number }> {
  assertTenant(tenantId);
  const stop = await db.execute(sql`
    UPDATE outreach_enrollments
    SET status = 'stopped', updated_at = NOW()
    WHERE tenant_id = ${tenantId}
      AND status IN ('active', 'paused')
      AND sequence_id IN (
        SELECT sequence_id FROM mission_experiments
        WHERE tenant_id = ${tenantId} AND mission_id = ${missionId} AND sequence_id IS NOT NULL
      )
    RETURNING id
  `);
  const cancel = await db.execute(sql`
    UPDATE mission_experiments
    SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${tenantId} AND mission_id = ${missionId} AND status IN ('live', 'launching', 'approved', 'awaiting_approval')
    RETURNING id
  `);
  return { stoppedEnrollments: rows(stop).length, cancelledExperiments: rows(cancel).length };
}
