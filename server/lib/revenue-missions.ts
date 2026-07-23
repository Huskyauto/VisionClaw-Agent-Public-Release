// ─────────────────────────────────────────────────────────────────────────────
// Verified Revenue Missions — repo + deterministic lifecycle state machine.
// Feature contract: data/feature-contracts/revenue-missions (S1).
//
// A mission is a durable business experiment. Success/kill is judged from
// EXTERNAL evidence rows (replies, payments) — never model output. This module
// is deterministic: no LLM calls. All writes fail CLOSED on invalid tenantId.
// The send path is unreachable until an experiment carries approvedByOwnerAt
// (HITL, enforced here AND at the route).
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  MISSION_STAGES,
  type MissionStage,
  type MissionEvidenceType,
  MISSION_EVIDENCE_TYPES,
} from "@shared/schema";

function rows(res: unknown): any[] {
  return ((res as any)?.rows || res || []) as any[];
}

function assertTenant(tenantId: number): void {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`revenue-missions: invalid tenantId ${tenantId} (fail closed)`);
  }
}

// Legal stage transitions (deterministic ladder + kill from anywhere).
const STAGE_NEXT: Record<string, MissionStage[]> = {
  hypothesis: ["evidence_gathering", "offer_defined"],
  evidence_gathering: ["offer_defined"],
  offer_defined: ["experiment_draft"],
  experiment_draft: ["experiment_awaiting_approval"],
  experiment_awaiting_approval: ["experiment_live", "experiment_draft"],
  experiment_live: ["evaluating"],
  evaluating: ["presell", "experiment_draft", "scale_ready"],
  presell: ["scale_ready", "evaluating"],
  scale_ready: [],
  killed: [],
};

// Absolute contract ceilings for any experiment draft (S2). Mission rows may
// tighten these, never raise them — fail-closed clamp, resilient to DB drift.
export const HARD_CAPS = {
  maxProspects: 25,
  maxContactsPerProspect: 3,
  maxSpendUsdCents: 2500,
  maxConcurrentExperiments: 3,
} as const;

/** Experiment statuses that count against the concurrency ceiling — anything
 * not yet terminal (stopped/cancelled) holds a slot. Fail-closed: drafting
 * refuses when the active count is at or above the hard ceiling. */
export const ACTIVE_EXPERIMENT_STATUSES = [
  "awaiting_approval",
  "approved",
  "launching",
  "live",
] as const;

export async function countActiveExperiments(tenantId: number): Promise<number> {
  assertTenant(tenantId);
  const res = await db.execute(sql`
    SELECT count(*)::int AS n FROM mission_experiments
    WHERE tenant_id = ${tenantId}
      AND status = ANY(${`{${ACTIVE_EXPERIMENT_STATUSES.join(",")}}`}::text[])
  `);
  const n = Number(rows(res)[0]?.n);
  // Fail closed: an unreadable count is treated as at-capacity, never as zero.
  if (!Number.isFinite(n) || n < 0) return HARD_CAPS.maxConcurrentExperiments;
  return n;
}

/** Clamp a mission-supplied cap to [1, hardCeiling]; junk values fall to the ceiling's floor of safety (the hard ceiling itself only when a valid tighter value isn't provided). */
export function clampCap(value: unknown, hardCeiling: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return hardCeiling;
  return Math.min(Math.floor(n), hardCeiling);
}

export function canTransition(from: string, to: string): boolean {
  if (to === "killed") return from !== "killed";
  return (STAGE_NEXT[from] || []).includes(to as MissionStage);
}

export interface CreateMissionInput {
  tenantId: number;
  name: string;
  hypothesis: string;
  idealCustomer: string;
  offer: string;
  painStatement?: string;
  priceUsd?: number;
  acquisitionChannel?: string;
  successCriteria?: string;
  killCriteria?: string;
  projectId?: number;
  notes?: string;
}

export async function createMission(input: CreateMissionInput): Promise<any> {
  assertTenant(input.tenantId);
  const priceUsd = Number.isFinite(input.priceUsd) ? Math.max(0, Math.floor(input.priceUsd!)) : 0;
  const res = await db.execute(sql`
    INSERT INTO revenue_missions
      (tenant_id, name, hypothesis, ideal_customer, pain_statement, offer, price_usd,
       acquisition_channel, success_criteria, kill_criteria, project_id, notes)
    VALUES
      (${input.tenantId}, ${input.name}, ${input.hypothesis}, ${input.idealCustomer},
       ${input.painStatement ?? null}, ${input.offer}, ${priceUsd},
       ${input.acquisitionChannel ?? "email"}, ${input.successCriteria ?? null},
       ${input.killCriteria ?? null}, ${input.projectId ?? null}, ${input.notes ?? null})
    RETURNING *
  `);
  return rows(res)[0];
}

export async function listMissions(tenantId: number): Promise<any[]> {
  assertTenant(tenantId);
  const res = await db.execute(sql`
    SELECT * FROM revenue_missions WHERE tenant_id = ${tenantId} ORDER BY id DESC
  `);
  return rows(res);
}

export async function getMission(tenantId: number, id: number): Promise<any | null> {
  assertTenant(tenantId);
  const res = await db.execute(sql`
    SELECT * FROM revenue_missions WHERE tenant_id = ${tenantId} AND id = ${id} LIMIT 1
  `);
  return rows(res)[0] ?? null;
}

export async function setStage(tenantId: number, id: number, to: MissionStage, killedReason?: string): Promise<any | null> {
  assertTenant(tenantId);
  if (!MISSION_STAGES.includes(to)) throw new Error(`unknown stage ${to}`);
  const mission = await getMission(tenantId, id);
  if (!mission) return null;
  if (!canTransition(mission.stage, to)) {
    throw new Error(`illegal transition ${mission.stage} -> ${to}`);
  }
  const res = await db.execute(sql`
    UPDATE revenue_missions
    SET stage = ${to},
        killed_reason = ${to === "killed" ? (killedReason ?? "owner kill") : mission.killed_reason ?? null},
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${tenantId} AND id = ${id}
    RETURNING *
  `);
  return rows(res)[0] ?? null;
}

// ── Evidence ────────────────────────────────────────────────────────────────

export interface AddEvidenceInput {
  tenantId: number;
  missionId: number;
  type: MissionEvidenceType;
  summary: string;
  source: string; // gmail | stripe | manual | web | crm
  experimentId?: number;
  externalRef?: string;
  amountUsdCents?: number;
  contactEmail?: string;
  raw?: unknown;
}

/** Insert evidence AND update the mission rollup counters in one call. */
export async function addEvidence(input: AddEvidenceInput): Promise<any> {
  assertTenant(input.tenantId);
  if (!MISSION_EVIDENCE_TYPES.includes(input.type)) throw new Error(`unknown evidence type ${input.type}`);
  // Provenance contract: every non-manual evidence row must carry an externalRef
  // (Gmail message id, Stripe object id, URL, CRM id) — fail closed.
  if (input.source !== "manual" && !(typeof input.externalRef === "string" && input.externalRef.length > 0)) {
    throw new Error(`evidence from source '${input.source}' requires externalRef (provenance, fail closed)`);
  }
  const mission = await getMission(input.tenantId, input.missionId);
  if (!mission) throw new Error(`mission ${input.missionId} not found for tenant ${input.tenantId}`);
  const res = await db.execute(sql`
    INSERT INTO mission_evidence
      (tenant_id, mission_id, experiment_id, type, summary, source, external_ref, amount_usd_cents, contact_email, raw)
    VALUES
      (${input.tenantId}, ${input.missionId}, ${input.experimentId ?? null}, ${input.type},
       ${input.summary}, ${input.source}, ${input.externalRef ?? null},
       ${input.amountUsdCents ?? null}, ${input.contactEmail ?? null},
       ${JSON.stringify(input.raw ?? {})}::jsonb)
    ON CONFLICT (tenant_id, source, external_ref) WHERE external_ref IS NOT NULL DO NOTHING
    RETURNING *
  `);
  const ev = rows(res)[0];
  // Idempotent duplicate (same tenant+source+externalRef already recorded):
  // skip the rollup counter bump too — the first insert already counted it.
  if (!ev) return null;

  // Rollup counters (denormalized; evidence table is the source of truth).
  const counterSql: Record<string, ReturnType<typeof sql>> = {
    positive_reply: sql`positive_replies = positive_replies + 1`,
    negative_reply: sql`negative_replies = negative_replies + 1`,
    call_booked: sql`calls_booked = calls_booked + 1`,
    payment: sql`payments_received = payments_received + 1, revenue_usd_cents = revenue_usd_cents + ${Math.max(0, input.amountUsdCents ?? 0)}`,
    refund: sql`refunds_usd_cents = refunds_usd_cents + ${Math.max(0, input.amountUsdCents ?? 0)}`,
  };
  const upd = counterSql[input.type];
  if (upd) {
    await db.execute(sql`
      UPDATE revenue_missions SET ${upd}, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${input.tenantId} AND id = ${input.missionId}
    `);
  }
  return ev;
}

export async function listEvidence(tenantId: number, missionId: number): Promise<any[]> {
  assertTenant(tenantId);
  const res = await db.execute(sql`
    SELECT * FROM mission_evidence
    WHERE tenant_id = ${tenantId} AND mission_id = ${missionId}
    ORDER BY id DESC
  `);
  return rows(res);
}

// ── Business-event definitions of done (computed from evidence, never LLM) ──

export interface MissionDoneChecks {
  validationComplete: boolean;
  firstDollarComplete: boolean;
  detail: Record<string, number>;
}

export async function computeDoneChecks(tenantId: number, missionId: number): Promise<MissionDoneChecks> {
  assertTenant(tenantId);
  const mission = await getMission(tenantId, missionId);
  if (!mission) throw new Error("mission not found");
  const contacted = Number(mission.leads_contacted) || 0;
  const positive = Number(mission.positive_replies) || 0;
  const revenue = Number(mission.revenue_usd_cents) || 0;
  const refunds = Number(mission.refunds_usd_cents) || 0;
  const spend = Number(mission.spend_usd_cents) || 0;
  return {
    validationComplete: contacted >= 10 && positive >= 3,
    firstDollarComplete: revenue - refunds > 0 && revenue - refunds > spend,
    detail: { contacted, positive, revenueUsdCents: revenue, refundsUsdCents: refunds, spendUsdCents: spend },
  };
}

/**
 * Parse a mission id out of Stripe metadata (S4 evidence hook). Pure —
 * query-free-testable. Accepts `mission_id` or `missionId`; anything that
 * isn't a clean positive integer returns null (fail closed: no evidence write).
 */
export function missionIdFromStripeMetadata(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as any).mission_id ?? (metadata as any).missionId;
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^[0-9]+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Extract per-refund evidence items from a Stripe charge object
 * (charge.refunded event). Pure — query-free-testable.
 *
 * Identity model (architect S4 finding): dedupe MUST key on the refund id
 * (re_...), never the charge id — a charge can be partially refunded multiple
 * times and charge-level dedupe silently drops every refund after the first.
 * Charges without an expandable refunds list return [] (caller warns+skips —
 * safe: nothing recorded beats corrupted counters).
 */
export function refundEvidenceItems(charge: unknown): Array<{ externalRef: string; amountUsdCents: number }> {
  const data = (charge as any)?.refunds?.data;
  if (!Array.isArray(data)) return [];
  const out: Array<{ externalRef: string; amountUsdCents: number }> = [];
  for (const r of data) {
    if (typeof r?.id !== "string" || !r.id) continue;
    if (r.status && r.status !== "succeeded") continue;
    const amount = Math.max(0, Math.floor(Number(r.amount) || 0));
    out.push({ externalRef: r.id, amountUsdCents: amount });
  }
  return out;
}

/** Mission stages in which Stripe payment/refund evidence is plausible (post-approval). */
export const STRIPE_EVIDENCE_STAGES = ["experiment_live", "evaluating", "presell", "scale_ready"] as const;

// ── Experiments (review packet + HITL approval) ─────────────────────────────

export async function getExperiment(tenantId: number, experimentId: number): Promise<any | null> {
  assertTenant(tenantId);
  const res = await db.execute(sql`
    SELECT * FROM mission_experiments WHERE tenant_id = ${tenantId} AND id = ${experimentId} LIMIT 1
  `);
  return rows(res)[0] ?? null;
}

export async function listExperiments(tenantId: number, missionId: number): Promise<any[]> {
  assertTenant(tenantId);
  const res = await db.execute(sql`
    SELECT * FROM mission_experiments
    WHERE tenant_id = ${tenantId} AND mission_id = ${missionId}
    ORDER BY id DESC
  `);
  return rows(res);
}

export interface ExperimentProspect {
  name: string;
  email: string;
  whyMatched: string;
}
export interface ExperimentVariant {
  label: string;
  subject: string;
  body: string;
}

export async function createExperimentDraft(args: {
  tenantId: number;
  missionId: number;
  name: string;
  prospects: ExperimentProspect[];
  variants: ExperimentVariant[];
}): Promise<any> {
  assertTenant(args.tenantId);
  const mission = await getMission(args.tenantId, args.missionId);
  if (!mission) throw new Error("mission not found");
  // Contract hard ceiling: at most HARD_CAPS.maxConcurrentExperiments active
  // (non-terminal) experiments per tenant. Guard sits ABOVE the INSERT —
  // fail-closed refusal, never truncation, never a half-created row.
  const activeCount = await countActiveExperiments(args.tenantId);
  if (activeCount >= HARD_CAPS.maxConcurrentExperiments) {
    throw new Error(
      `concurrent experiment cap exceeded: ${activeCount} active >= ${HARD_CAPS.maxConcurrentExperiments} (refusing to draft; stop or cancel an active experiment first)`,
    );
  }
  // Contract hard ceilings (data/feature-contracts/revenue-missions): mission
  // rows may TIGHTEN these but can never raise them, even via direct DB edit.
  const maxProspects = clampCap(mission.max_prospects, HARD_CAPS.maxProspects);
  const maxContactsPerProspect = clampCap(mission.max_contacts_per_prospect, HARD_CAPS.maxContactsPerProspect);
  const maxSpendUsdCents = clampCap(
    Number(mission.max_cash_at_risk_usd) * 100,
    HARD_CAPS.maxSpendUsdCents,
  );
  if (args.prospects.length > maxProspects) {
    throw new Error(`prospect cap exceeded: ${args.prospects.length} > ${maxProspects} (refusing, not truncating)`);
  }
  const replyToken = `vcm-${args.missionId}-${Math.random().toString(36).slice(2, 10)}`;
  const res = await db.execute(sql`
    INSERT INTO mission_experiments
      (tenant_id, mission_id, name, status, prospects, variants,
       max_prospects, max_contacts_per_prospect, max_spend_usd_cents, reply_token)
    VALUES
      (${args.tenantId}, ${args.missionId}, ${args.name}, 'awaiting_approval',
       ${JSON.stringify(args.prospects)}::jsonb, ${JSON.stringify(args.variants)}::jsonb,
       ${maxProspects}, ${maxContactsPerProspect},
       ${maxSpendUsdCents}, ${replyToken})
    RETURNING *
  `);
  // Advance mission stage if legal (hypothesis/offer_defined → experiment path).
  try {
    if (canTransition(mission.stage, "experiment_awaiting_approval")) {
      await setStage(args.tenantId, args.missionId, "experiment_awaiting_approval");
    } else if (canTransition(mission.stage, "experiment_draft")) {
      await setStage(args.tenantId, args.missionId, "experiment_draft");
      await setStage(args.tenantId, args.missionId, "experiment_awaiting_approval");
    }
  } catch (e) { console.warn("[silent-catch] server/lib/revenue-missions.ts stage-advance (best-effort; experiment row is SoT):", (e as any)?.message ?? e); }
  return rows(res)[0];
}

/**
 * HITL approval — idempotent. Marks the experiment approved; the actual send
 * wiring (sequence + enrollments) is S3 and reads approvedByOwnerAt as its
 * fail-closed precondition.
 */
export async function approveExperiment(tenantId: number, experimentId: number, approvedBy: string): Promise<any | null> {
  assertTenant(tenantId);
  const exp = await getExperiment(tenantId, experimentId);
  if (!exp) return null;
  if (exp.approved_by_owner_at) return exp; // idempotent no-op
  if (exp.status !== "awaiting_approval") {
    throw new Error(`experiment status is '${exp.status}' — only awaiting_approval can be approved`);
  }
  const res = await db.execute(sql`
    UPDATE mission_experiments
    SET status = 'approved', approved_by_owner_at = CURRENT_TIMESTAMP,
        approved_by = ${approvedBy}, updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${tenantId} AND id = ${experimentId}
    RETURNING *
  `);
  return rows(res)[0] ?? null;
}
