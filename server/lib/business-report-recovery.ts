import { sql } from "drizzle-orm";
import { assertReportJuryApproval } from "./business-report-paid-budget";

/** Explicit owner recovery only. Never reset a reserved/uncertain paid call. */
export async function resumeUnspentPaidReport(tenantId: number, operatorId: string,
  database?: Pick<typeof import("../db").db, "transaction">) {
  if (tenantId !== 1 || !/^[a-f0-9-]{36}$/i.test(operatorId)) throw new Error("Owner report identity required");
  const db = database ?? (await import("../db")).db;
  return db.transaction(async tx => {
    // Same lock/order as reservation: recovery cannot race a spend claim.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(17421, 1)`);
    const found: any = await tx.execute(sql`SELECT id,payload,status FROM agent_jobs
      WHERE tenant_id=${tenantId} AND kind='business_report_review'
      AND payload->'input'->>'operatorJobId'=${operatorId} FOR UPDATE`);
    const rows = found.rows || found;
    if (rows.length !== 1) throw new Error("Unique retained report required");
    const { id, payload, status } = rows[0];
    assertReportJuryApproval(payload.input);
    const state = payload.state;
    if (payload.input.tenantId !== tenantId || status !== "failed_terminal" ||
        state?.phase !== "blocked" || state.juryFrom !== "initial_jury" ||
        !Array.isArray(state.juryHistory) || state.juryHistory.length ||
        !Number.isFinite(Date.parse(state.expiresAt)) || Date.now() >= Date.parse(state.expiresAt) ||
        payload.paidJuryRuns || payload.unspentRecovery || payload.assemblyStarted ||
        payload.fulfillment || state.reply || state.approvedSections) {
      throw new Error("Report is not eligible for one-time unspent recovery");
    }
    const budgets: any = await tx.execute(sql`SELECT payload FROM agent_jobs
      WHERE tenant_id=${tenantId} AND kind='business_report_jury_budget'
      AND payload->>'batch'=${payload.input.paidJuryBatch} FOR UPDATE`);
    const records = budgets.rows || budgets;
    if (records.length > 1) throw new Error("Ambiguous paid budget; recovery refused");
    for (const record of records) {
      const allocations = record.payload?.allocations;
      if (!allocations || typeof allocations !== "object" || Array.isArray(allocations) ||
          Object.hasOwn(allocations, payload.input.kind)) {
        throw new Error("Paid reservation exists or budget is ambiguous; recovery refused");
      }
    }
    const next = { ...payload, state: { ...state, phase: "initial_jury" },
      unspentRecovery: { resumedAt: new Date().toISOString(), reason: "owner-authorized-zero-reservation-recovery" } };
    const updated: any = await tx.execute(sql`UPDATE agent_jobs
      SET payload=${JSON.stringify(next)}::jsonb,status='pending',error=NULL,failure_class=NULL,
        completed_at=NULL,lease_until=NULL,next_run_at=NOW(),max_attempts=attempts+1600
      WHERE id=${id} AND tenant_id=${tenantId} AND kind='business_report_review'
        AND status='failed_terminal' AND payload->'state'->>'phase'='blocked' RETURNING id`);
    if (!(updated.rows || updated).length) throw new Error("Report recovery claim lost");
    return { jobId: operatorId, evidenceReviewJobId: Number(id), status: "running", reviewPhase: "initial_jury" };
  });
}
