import { buildMuseReportRequest, buildReportJurySnapshot } from "./business-report-review";
import { hashReportBytes, minimizeReportText } from "./business-report-evidence";
import { REPORT_PAID_SEATS } from "./business-report-paid-jury";
import { PACKAGE_SPEND_CAP_MICROS, packageWindowOpen } from "./company-report-production";
import { parseReportVote } from "./report-vote-contract";
import { _parseVote } from "./jury-triage";
import { sanitizeAgentOutput } from "../safety-layer";
import { packageBudgetMicros } from "./company-package-completion";

class RetentionBlock extends Error {}
const requireProof = (condition: unknown, message: string): void => {
  if (!condition) throw new RetentionBlock(message);
};
const emptyRecord = (value: any) => value === undefined ||
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
const digest = (value: unknown) => hashReportBytes(JSON.stringify(value));
const KINDS = ["readiness", "executive", "opportunities"] as const;

/** Read-only inspection. A successful preview grants no execution authority.
 * Only an authenticated, snapshot-bound owner POST may schedule compilation. */
export function compilerContinuationPlan(parent: any, children: any[]) {
  const p = parent.payload, reports: Array<{ kind: string; childId: number; eligible: boolean;
    reason?: string; compilerChars?: number; compilerPacketHash?: string }> = [];
  for (const kind of KINDS) {
    const childId = p?.state?.reports?.[kind]?.jobId;
    if (!Number.isSafeInteger(childId) || childId <= 0 || p.state.reports[kind].status === "done") continue;
    try {
      requireProof(parent.tenant_id === 1 && p.tenantId === 1 && parent.kind === "company_report_package" &&
        p.productionVersion === 2 && p.state.phase === "blocked" &&
        ["succeeded", "failed", "failed_terminal"].includes(parent.status), "The parent package must be stopped and owner-scoped.");
      requireProof(packageWindowOpen(p.processingWindowStartedAt) && p.state.research?.complete === true,
        "The original processing window and completed research are required.");
      const claims = p.packageSpend;
      requireProof(claims && typeof claims === "object" && !Array.isArray(claims) &&
        Object.values(claims).every(v => Number.isSafeInteger(v) && Number(v) > 0) &&
        Object.values(claims).reduce((sum: number, value) => sum + Number(value), 0) < packageBudgetMicros(p),
      "Stored reservations are invalid or the approved model ceiling is exhausted.");
      const matching = children.filter(c => c.id === childId);
      requireProof(matching.length === 1, "The saved report is missing or ambiguous.");
      const child = matching[0], c = child.payload, input = c?.input, state = c?.state;
      requireProof(child.tenant_id === 1 && child.kind === "business_report_review" &&
        child.status === "failed_terminal" && input?.tenantId === 1 && input.reportOnly === true &&
        input.orderId === `company-package:${parent.id}:${kind}` && input.paidJuryBatch === `company-package:${parent.id}` &&
        input.intake?.company === p.state.intake.company && input.intake?.website === p.state.intake.website,
      "The saved report does not match this stopped owner package.");
      requireProof(!/^Report initial jury blocked:/.test(state?.stopReason || ""),
        "The initial paid review is incomplete; no reviewer retry is authorized.");
      requireProof(state?.phase === "blocked" && state.round === 1 &&
        /^Direct report compilation failed \(/.test(state.stopReason || "") &&
        input.compilerMode === "gemini-direct-v1" && input.qualityContractVersion === 1 &&
        Number.isFinite(Date.parse(state.expiresAt)) && Date.parse(state.expiresAt) > Date.now() &&
        !Object.hasOwn(state, "reply") && !Object.hasOwn(state, "approvedSections") &&
        !Object.hasOwn(state, "compilerRecoveryId") && !Object.hasOwn(c, "fulfillment") &&
        !Object.hasOwn(c, "assemblyStarted"), "This report is not an unspent initial compilation.");
      requireProof(emptyRecord(c.compilerRuns) &&
        !Object.keys(claims).some(key => key.startsWith(`compiler:${childId}:`)),
      "A compiler reservation or response exists; inspect it rather than replaying.");
      requireProof(digest(input.evidence) === digest(p.state.research.evidence) &&
        /^[a-f0-9]{64}$/.test(state.digest), "The retained input or source identity changed.");
      const phase = `initial_jury:1:${state.requestId}`;
      const expectedClaims = REPORT_PAID_SEATS.map(seat => `review:${childId}:${phase}:${seat.modelId}`);
      const reviewClaims = Object.keys(claims).filter(key => key.startsWith(`review:${childId}:`));
      requireProof(reviewClaims.length === 3 && expectedClaims.every(key => Object.hasOwn(claims, key)),
        "Initial jury reservations are incomplete or another paid phase exists.");
      requireProof(c.paidJuryRuns && Object.keys(c.paidJuryRuns).length === 1 &&
        c.reportJuryRuns && Object.keys(c.reportJuryRuns).length === 1 &&
        c.reportJuryRuns[phase]?.digest === state.digest, "The paid review audit does not match this revision.");
      const seats = c.paidJuryRuns[phase]?.proposers;
      requireProof(Array.isArray(seats) && seats.length === 3 &&
        Array.isArray(state.juryHistory) && state.juryHistory.length === 1 &&
        ["FIX", "REJECT"].includes(state.juryHistory[0].verdict),
      "The initial paid review is incomplete; no reviewer retry is authorized.");
      // First-round initial ballots saw an empty correction checklist. Rebuild
      // their ORIGINAL representation, not the new compiler-only references.
      const snapshotHash = hashReportBytes(buildReportJurySnapshot({
        input, state: { ...state, correctionChecklist: [] },
      }, true));
      const corrections: Array<{ id: string; text: string }> = [];
      const votes = REPORT_PAID_SEATS.map(spec => {
        const matches = seats.filter((seat: any) => seat.modelId === spec.modelId);
        requireProof(matches.length === 1, "Each pinned reviewer must have one retained response.");
        const seat = matches[0], evidence = seat.evidence, receipts = evidence?.receipts;
        requireProof(seat.ok === true && seat.requestedModel === spec.modelId &&
          (seat.reportedModel === spec.modelId || spec.modelId === "gpt-5.4" &&
            /^gpt-5\.4-\d{4}-\d{2}-\d{2}$/.test(seat.reportedModel)) &&
          typeof seat.answer === "string" && evidence?.actor === "server-owned-juror-evidence-runner" &&
          evidence.seatId === spec.modelId && Array.isArray(receipts) && receipts.length === 1,
        "A pinned reviewer response or identity is incomplete.");
        const receipt = receipts[0], binding = receipt.reportInspection;
        requireProof(receipt.ok === true && receipt.tool === "report_snapshot_read" &&
          receipt.id === `${evidence.runId}:report-snapshot` && receipt.runId === evidence.runId &&
          receipt.sha256 === snapshotHash && binding?.jobId === childId && binding.tenantId === 1 &&
          binding.inputDigest === state.digest && binding.reportSha256 === snapshotHash,
        "A paid reviewer receipt does not bind the exact retained report.");
        const normalized = parseReportVote(seat.answer, receipts), vote = _parseVote(normalized.text);
        requireProof(["FIX", "REJECT"].includes(vote.verdict) && normalized.unknowns.length > 0 &&
          normalized.citations.length > 0 && normalized.citations.every(id => id === receipt.id),
        "A retained paid ballot is invalid; no reviewer retry is authorized.");
        if (vote.verdict === "FIX") corrections.push({ id: `C1-1-${corrections.length + 1}`,
          text: minimizeReportText(vote.fixProposal || vote.rationale).slice(0, 6000) });
        return vote;
      });
      const history = JSON.parse(state.juryHistory[0].rationale);
      requireProof(history.votes?.length === 3 && history.votes.every((v: any, index: number) =>
        v.ok === true && v.verdict === votes[index].verdict && v.model === seats.find((s: any) =>
          s.modelId === REPORT_PAID_SEATS[index].modelId)?.reportedModel) &&
        state.juryHistory[0].verdict === (votes.filter(vote => vote.verdict === "FIX").length >= 2 ? "FIX" : "REJECT") &&
        digest(state.correctionChecklist || []) === digest(corrections),
      "The saved corrections do not match the paid ballots.");
      const packet = JSON.stringify(buildMuseReportRequest(input, state));
      requireProof(packet.length <= 180000 && !sanitizeAgentOutput(packet).redacted,
        "The full post-jury compiler packet still fails its size or safety bound.");
      reports.push({ kind, childId, eligible: true, compilerChars: packet.length,
        compilerPacketHash: hashReportBytes(packet) });
    } catch (error) {
      reports.push({ kind, childId, eligible: false,
        reason: error instanceof RetentionBlock ? error.message : "Saved review failed its retention checks." });
    }
  }
  return { available: reports.some(report => report.eligible), reports,
    childIds: reports.filter(report => report.eligible).map(report => report.childId),
    snapshot: digest({ version: 1, parent: { id: parent.id, status: parent.status, attempts: parent.attempts,
      payloadHash: digest(p) }, children: children.map(c => ({ id: c.id, status: c.status,
      attempts: c.attempts, payloadHash: digest(c.payload) })).sort((a, b) => a.id - b.id), reports }) };
}
