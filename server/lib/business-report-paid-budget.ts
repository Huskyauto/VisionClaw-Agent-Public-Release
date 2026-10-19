import type { BusinessReportReviewInput } from "./business-report-review";

export const ALDON_JURY_BATCH = "aldon-comparison-2026-10-15";
export const ALDON_COMPLETION_BATCH = "aldon-completion-2026-10-15";
// Owner approved one fresh attempt per report, $3 each, on October 16.
export const ALDON_RERUN_BATCH = "aldon-rerun-2026-10-16";
// Owner separately approved another pair after both rerun slots were consumed.
export const ALDON_RECOVERY_BATCH = "aldon-recovery-2026-10-16";
const EXPIRES = Date.parse("2026-10-17T04:00:00Z");
function reportJuryCeiling(batch: string): number {
  if (batch === ALDON_JURY_BATCH) return 2_000_000;
  if (batch === ALDON_COMPLETION_BATCH) return 3_000_000;
  if (batch === ALDON_RERUN_BATCH) return 3_000_000;
  if (batch === ALDON_RECOVERY_BATCH) return 3_000_000;
  throw new Error("Report paid-jury approval is absent");
}
type Slot = { operatorId: string; reservedMicros: number; claims: string[] };
type Budget = Partial<Record<"executive" | "readiness", Slot>>;

export function assertReportJuryApproval(input: Pick<BusinessReportReviewInput,
  "tenantId" | "paidJuryBatch" | "kind" | "operatorJobId" | "intake">, now = Date.now()) {
  if (input.tenantId !== 1 || ![ALDON_JURY_BATCH, ALDON_COMPLETION_BATCH, ALDON_RERUN_BATCH, ALDON_RECOVERY_BATCH].includes(input.paidJuryBatch || "") ||
      !["executive", "readiness"].includes(input.kind) || !input.operatorJobId ||
      input.intake.company !== "Aldon Company" || input.intake.website !== "https://www.aldonco.com/" ||
      (input.kind === "executive" && input.intake.focus !== "full") ||
      now >= EXPIRES || process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1") {
    throw new Error("Report paid-jury approval is absent, expired or outside its scope");
  }
}

/** Integer microdollars round UP; reservations survive failure and never refund. */
export function nextReportJuryBudget(state: Budget, claim: {
  kind: "executive" | "readiness"; operatorId: string; key: string; amount: number;
}, batch = ALDON_JURY_BATCH): Budget {
  const ceiling = reportJuryCeiling(batch);
  if (typeof claim.amount !== "number" || !Number.isFinite(claim.amount) || claim.amount <= 0) {
    throw new Error("Invalid jury reservation amount");
  }
  if (!["executive", "readiness"].includes(claim.kind) || !claim.operatorId || !claim.key) {
    throw new Error("Invalid jury reservation identity");
  }
  const slot = state[claim.kind] ?? { operatorId: claim.operatorId, reservedMicros: 0, claims: [] };
  if (slot.operatorId !== claim.operatorId) throw new Error("Report budget already bound to another operator");
  if (!Number.isSafeInteger(slot.reservedMicros) || slot.reservedMicros < 0 ||
      !Array.isArray(slot.claims) || slot.claims.some(key => typeof key !== "string")) {
    throw new Error("Invalid stored report budget");
  }
  if (slot.claims.includes(claim.key)) throw new Error("Jury dispatch already reserved; no automatic retry");
  const reservedMicros = slot.reservedMicros + Math.ceil(claim.amount * 1_000_000);
  if (!Number.isSafeInteger(reservedMicros) || reservedMicros > ceiling) {
    throw new Error(`Report jury $${ceiling / 1_000_000} ceiling reached`);
  }
  return { ...state, [claim.kind]: { ...slot, reservedMicros, claims: [...slot.claims, claim.key] } };
}

/** Existing queue table stores a completed control record, NOT a runnable job.
 * The transaction lock serializes both slots across workers and publications. */
export async function reservePaidReportJury(
  input: BusinessReportReviewInput, jobId: number, attempt: number, phaseKey: string, model: string, amount: number,
  dependencies?: { db: Pick<typeof import("../db").db, "transaction"> },
) {
  assertReportJuryApproval(input);
  const { db } = dependencies ?? await import("../db");
  const { sql } = await import("drizzle-orm");
  const compiler = phaseKey.startsWith("compiler:");
  if (compiler && model !== "gemini-4-argon") throw new Error("Report compiler model binding lost");
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(17421, 1)`);
    const live: any = await tx.execute(sql`SELECT payload FROM agent_jobs WHERE id=${jobId}
      AND tenant_id=${input.tenantId} AND kind='business_report_review' AND status='running'
      AND attempts=${attempt} AND lease_until > NOW()
      AND payload->'state'->>'phase'=${compiler ? "compiling" : "jury_started"} FOR UPDATE`);
    const payload = (live.rows || live)[0]?.payload;
    if (!payload || payload.input?.operatorJobId !== input.operatorJobId ||
        payload.input?.kind !== input.kind ||
        payload.input?.paidJuryBatch !== input.paidJuryBatch ||
        !/^(initial_jury|final_jury|compiler):/.test(phaseKey) ||
        (!compiler && payload.state.juryFrom !== phaseKey.split(":")[0]) ||
        `${payload.state.round}:${payload.state.requestId}` !== phaseKey.split(":").slice(1).join(":")) {
      throw new Error("Report paid-jury lease/revision binding lost");
    }
    assertReportJuryApproval(payload.input);
    const rows: any = await tx.execute(sql`SELECT id,payload FROM agent_jobs
      WHERE tenant_id=${input.tenantId} AND kind='business_report_jury_budget'
      AND payload->>'batch'=${input.paidJuryBatch} FOR UPDATE`);
    const records = rows.rows || rows;
    if (records.length > 1) throw new Error("Ambiguous report budget records");
    const record = records[0];
    const state = record ? record.payload.allocations : {};
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Invalid report budget state");
    const allocations = nextReportJuryBudget(state, { kind: input.kind,
      operatorId: input.operatorJobId!, key: `${jobId}:${phaseKey}:${model}`, amount }, input.paidJuryBatch);
    const value = JSON.stringify({ batch: input.paidJuryBatch, expiresAt: new Date(EXPIRES).toISOString(), allocations });
    if (record) {
      await tx.execute(sql`UPDATE agent_jobs SET payload=${value}::jsonb
        WHERE id=${record.id} AND tenant_id=${input.tenantId} AND kind='business_report_jury_budget'`);
    } else {
      await tx.execute(sql`INSERT INTO agent_jobs(kind,tenant_id,status,payload,attempts,max_attempts,completed_at)
        VALUES('business_report_jury_budget',${input.tenantId},'succeeded',${value}::jsonb,0,1,NOW())`);
    }
  });
}
