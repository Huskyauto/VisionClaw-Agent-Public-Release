import type { MoAOptions, MoAResult, ProposerResult } from "../moa";
import { callProposer, resolveProposerSpecs } from "../moa";
import { providerLaneCanServeModel, providerLaneLocallyReady } from "../providers";
import { collectReportBallots, type ReportAttemptEvent } from "./report-ballot-collector";
import { JURY_BACKUPS } from "./subscription-jury-recovery";
import { juryEvidencePrompt } from "./jury-evidence";
import { parseReportVote } from "./report-vote-contract";
import { reportBallotHasEvidence, type ReportJuryBinding } from "./jury-package";
import { _parseVote } from "./jury-triage";

export function validReportBallot(result: ProposerResult, binding: ReportJuryBinding): boolean {
  if (!result.ok || !result.answer || /length|max_tokens|incomplete|content_filter/i.test(result.finishReason || "")) return false;
  const parsed = parseReportVote(result.answer, result.evidence?.receipts), vote = _parseVote(parsed.text);
  const verdicts = [...parsed.text.matchAll(/^\s*VERDICT:\s*(FIX|REJECT|ESCALATE)\s*$/gm)];
  return verdicts.length === 1 && ["FIX", "REJECT", "ESCALATE"].includes(vote.verdict) &&
    reportBallotHasEvidence({ ...vote, model: result.modelId, provider: result.provider,
      reportedModel: result.reportedModel, evidence: result.evidence, citations: parsed.citations,
      unknowns: parsed.unknowns, ok: true }, binding);
}

/** No generic synthesis, advisory inference, unpinned routing or paid fallback.
 * Existing paid-batch reviews keep their separately reserved execution path. */
export async function runReportBallots(options: MoAOptions, binding: ReportJuryBinding, audit: {
  record(event: ReportAttemptEvent): Promise<void>;
  assertLive(): Promise<void>;
  signal?: AbortSignal;
  budgetMs?: number;
}): Promise<MoAResult> {
  if (options.tenantId !== 1 || binding.tenantId !== options.tenantId ||
      options.invokedVia !== "business-report-evidence-review" || !options.collectProposerEvidence) {
    throw new Error("Report ballot runner requires owner-bound evidence");
  }
  const allowed = new Set(["profundo", "claude-runner", "standard-compute", "openference", "replit"]);
  const eligibleCandidates = [...resolveProposerSpecs("frontier", undefined, options.tenantId), ...JURY_BACKUPS]
    .filter(spec => !!spec.providerLane && allowed.has(spec.providerLane));
  // Prefer a different authorized lane before another model on an already
  // attempted account. This is an ordering preference, not an identity claim.
  const lanes = new Set<string>();
  const firstRoutes = eligibleCandidates.filter(spec => {
    if (lanes.has(spec.providerLane!)) return false;
    lanes.add(spec.providerLane!);
    return true;
  });
  const candidates = [...firstRoutes, ...eligibleCandidates.filter(spec => !firstRoutes.includes(spec))];
  const result = await collectReportBallots({
    candidates, signal: audit.signal, record: audit.record, budgetMs: audit.budgetMs,
    eligible: spec => !!spec.providerLane && providerLaneCanServeModel(spec.providerLane, spec.modelId) &&
      providerLaneLocallyReady(spec.providerLane),
    valid: value => validReportBallot(value, binding),
    attempt: async (spec, signal) => {
      signal.throwIfAborted();
      const evidence = await options.collectProposerEvidence!(spec);
      signal.throwIfAborted();
      const value = await callProposer({ ...spec, signal, beforeDispatch: async () => {
        await audit.assertLive();
        signal.throwIfAborted();
        if (process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1" ||
            !spec.providerLane || !providerLaneLocallyReady(spec.providerLane)) {
          throw new Error("Report dispatch stopped");
        }
      } }, options.question + juryEvidencePrompt(evidence, "report-json"), options.tenantId, false);
      return { ...value, evidence };
    },
  });
  return { question: options.question, tenantId: options.tenantId, proposers: result.results,
    jurySeatCount: 3, aggregated: `Report ballot collection: ${result.reason}`,
    aggregatorModel: "none:individual-report-ballots", totalLatencyMs: result.elapsedMs,
    concordance: null, shouldEscalate: !result.complete };
}
