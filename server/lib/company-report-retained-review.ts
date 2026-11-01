import { buildReportJurySnapshot } from "./business-report-review";
import { hashReportBytes, minimizeReportText } from "./business-report-evidence";
import { REPORT_PAID_SEATS } from "./business-report-paid-jury";
import { restoreReportBallotSnapshot, validReportBallot } from "./report-ballot-runner";
import { parseReportVote } from "./report-vote-contract";
import { _parseVote } from "./jury-triage";

/** Reconcile ALL retained votes, including minority FIX obligations, against
 * the saved checklist/history. Used again under the compiler row lock. */
export function retainedCompilerReviewMatches(payload: any, jobId: number): boolean {
  try {
    const { input, state } = payload;
    if (input?.tenantId !== 1 || state?.round !== 1 || state.juryHistory?.length !== 1) return false;
    const snapshot = buildReportJurySnapshot({ input, state: { ...state, correctionChecklist: [] } }, true);
    const binding = { jobId, tenantId: 1, inputDigest: state.digest, reportSha256: hashReportBytes(snapshot) };
    const seats = payload.paidJuryRuns?.[`initial_jury:1:${state.requestId}`]?.proposers;
    if (!Array.isArray(seats) || seats.length !== 3) return false;
    const corrections: Array<{ id: string; text: string }> = [];
    const votes = REPORT_PAID_SEATS.map(spec => {
      const matches = seats.filter((s: any) => s.modelId === spec.modelId);
      if (matches.length !== 1) throw new Error("Missing seat");
      const s = matches[0], restored = restoreReportBallotSnapshot(s, snapshot, binding);
      if (s.requestedModel !== spec.modelId || !(s.reportedModel === spec.modelId ||
          spec.modelId === "gpt-5.4" && /^gpt-5\.4-\d{4}-\d{2}-\d{2}$/.test(s.reportedModel)) ||
          !validReportBallot(restored, binding)) throw new Error("Invalid owned ballot");
      const vote = _parseVote(parseReportVote(s.answer, restored.evidence!.receipts).text);
      if (!["FIX", "REJECT"].includes(vote.verdict)) throw new Error("Unusable vote");
      if (vote.verdict === "FIX") corrections.push({ id: `C1-1-${corrections.length + 1}`,
        text: minimizeReportText(vote.fixProposal || vote.rationale).slice(0, 6000) });
      return { verdict: vote.verdict, model: s.reportedModel };
    });
    const history = JSON.parse(state.juryHistory[0].rationale);
    return history.votes?.length === 3 && history.votes.every((v: any, i: number) =>
      v.ok === true && v.verdict === votes[i].verdict && v.model === votes[i].model) &&
      state.juryHistory[0].verdict === (votes.filter(v => v.verdict === "FIX").length >= 2 ? "FIX" : "REJECT") &&
      hashReportBytes(JSON.stringify(state.correctionChecklist || [])) === hashReportBytes(JSON.stringify(corrections));
  } catch { return false; }
}
