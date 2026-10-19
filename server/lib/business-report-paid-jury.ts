import type { MoAOptions, MoAResult, ProposerCallSpec, ProposerResult } from "../moa";
import type { BusinessReportReviewInput } from "./business-report-review";
import { assertReportJuryApproval, reservePaidReportJury } from "./business-report-paid-budget";

/** Three model families; Gemini uses OpenRouter transport. NOT independent web research. */
export const REPORT_PAID_SEATS: ProposerCallSpec[] = [
  { modelId: "gpt-5.4", providerLane: "openai-api" },
  { modelId: "google/gemini-4-argon", providerLane: "openrouter" },
  { modelId: "claude-opus-5-5", providerLane: "anthropic-api" },
];

export async function runPaidReportJury(
  options: MoAOptions, input: BusinessReportReviewInput, jobId: number, attempt: number, phaseKey: string,
  dependencies?: {
    call: typeof import("../moa").executeBoundedReportSeat;
    reserve: typeof reservePaidReportJury;
    audit: (result: MoAResult) => Promise<void>;
  },
): Promise<MoAResult> {
  assertReportJuryApproval(input);
  if (options.tenantId !== input.tenantId || options.invokedVia !== "business-report-evidence-review" ||
      !options.collectProposerEvidence) throw new Error("Paid jury missing report evidence binding");
  const { executeBoundedReportSeat } = dependencies?.call
    ? { executeBoundedReportSeat: dependencies.call } : await import("../moa");
  const { juryEvidencePrompt } = await import("./jury-evidence");
  const started = Date.now();
  const proposers = await Promise.all(REPORT_PAID_SEATS.map(async (spec: ProposerCallSpec) => {
    let evidence: Awaited<ReturnType<NonNullable<MoAOptions["collectProposerEvidence"]>>> | undefined;
    try {
      evidence = await options.collectProposerEvidence!(spec);
      const result = await executeBoundedReportSeat(spec, options.question + juryEvidencePrompt(evidence, "report-json"),
        input.tenantId, amount => (dependencies?.reserve ?? reservePaidReportJury)(
          input, jobId, attempt, phaseKey, spec.modelId, amount));
      return { ...result, evidence };
    } catch (error) {
      const { reportJuryFailureSummary } = await import("./business-report-review");
      const failure = reportJuryFailureSummary(error);
      console.warn(`[business-report-jury] job=${jobId} seat=${spec.modelId} ${failure}`);
      return { modelId: spec.modelId, requestedModel: spec.modelId, provider: spec.providerLane!,
        providerLane: spec.providerLane, ok: false, error: failure,
        latencyMs: Date.now() - started, evidence } as ProposerResult;
    }
  }));
  const result: MoAResult = { question: options.question, tenantId: input.tenantId, proposers, jurySeatCount: 3,
    aggregated: "Report acceptance uses individual owned-receipt votes; no paid synthesis was requested.",
    aggregatorModel: "deterministic-report-vote-summary", totalLatencyMs: Date.now() - started,
    concordance: null, shouldEscalate: proposers.some(p => !p.ok) };
  if (dependencies?.audit) await dependencies.audit(result);
  else await persistPaidReportJuryAudit(result, input, jobId, attempt, phaseKey);
  return result;
}

export async function persistPaidReportJuryAudit(
  result: MoAResult, input: BusinessReportReviewInput, jobId: number, attempt: number, phaseKey: string,
  database?: Pick<typeof import("../db").db, "execute">,
) {
    const db = database ?? (await import("../db")).db;
    const { sql } = await import("drizzle-orm");
    // Retain actual answers, served model identities, usage and per-seat receipts.
    // Source bytes already live in the immutable input, not three duplicated excerpts.
    const audit = { ...result, proposers: result.proposers.map(p => ({ ...p, evidence: p.evidence && {
      ...p.evidence, receipts: p.evidence.receipts.map(({ excerpt, ...receipt }) => receipt),
    } })) };
    const saved: any = await db.execute(sql`UPDATE agent_jobs SET payload=jsonb_set(payload,
      '{paidJuryRuns}', COALESCE(payload->'paidJuryRuns','{}'::jsonb) ||
        jsonb_build_object(${phaseKey}::text,${JSON.stringify(audit)}::jsonb))
      WHERE id=${jobId} AND tenant_id=${input.tenantId} AND attempts=${attempt}
      AND kind='business_report_review' AND status='running' AND lease_until > NOW()
      AND payload->'state'->>'phase'='jury_started'
      AND payload->'state'->>'juryFrom'=${phaseKey.split(":")[0]}
      AND payload->'state'->>'requestId'=${phaseKey.split(":").at(-1)}
      RETURNING id`);
    if (!(saved.rows || saved).length) throw new Error("Paid jury audit persistence lost its lease; no automatic retry");
}
