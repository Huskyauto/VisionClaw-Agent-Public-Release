import { REPORT_PAID_SEATS } from "../../server/lib/business-report-paid-jury";
import { buildReportJurySnapshot, initialBusinessReportReview } from "../../server/lib/business-report-review";
import { hashReportBytes } from "../../server/lib/business-report-evidence";

export function retainedCompanyReviewFixture() {
  const text = "The company installs and maintains residential heating systems.";
  const evidence = { version: 1 as const, capturedAt: "2026-10-20T07:00:00Z", limitations: [],
    sources: [{ id: "S1", title: "Heating", url: "https://example.test/heating/", text,
      sha256: hashReportBytes(text), retrievedAt: "2026-10-20T07:00:00Z", kind: "public" as const }] };
  const intake = { company: "Fixture", website: "https://example.test/" };
  const input = { tenantId: 1, kind: "executive" as const, orderId: "company-package:50:executive",
    paidJuryBatch: "company-package:50", reportOnly: true, qualityContractVersion: 1 as const,
    compilerMode: "gemini-direct-v1" as const, reportFormat: "detailed-v1" as const,
    modelId: "fixture", customerEmail: "", intake, evidence,
    sections: [{ heading: "Executive Summary", body: "A retained substantive report draft with practical advice. ".repeat(10) }] };
  const state: any = { ...initialBusinessReportReview(input), phase: "blocked",
    stopReason: "Direct report compilation failed (provider, source validation or checkpoint uncertainty); retained draft/reservation preserved, no automatic paid retry" };
  const phase = `initial_jury:1:${state.requestId}`;
  const snapshotHash = hashReportBytes(buildReportJurySnapshot({ input, state }, true));
  const fix = "Give each pilot an accountable implementation owner.";
  const proposers = REPORT_PAID_SEATS.map((spec, index) => {
    const runId = `offline-${index}`;
    const receipt = { id: `${runId}:report-snapshot`, runId, tool: "report_snapshot_read", ok: true,
      sha256: snapshotHash, reportInspection: { jobId: 7, tenantId: 1, inputDigest: state.digest, reportSha256: snapshotHash } };
    return { modelId: spec.modelId, requestedModel: spec.modelId, reportedModel: spec.modelId, ok: true,
      answer: JSON.stringify({ verdict: "FIX", rationale: "Needs a concrete owner.", fixProposal: fix,
        citations: [receipt.id], unknowns: ["Private operating costs are unknown."] }),
      evidence: { seatId: spec.modelId, runId, actor: "server-owned-juror-evidence-runner",
        receipts: [receipt] } };
  });
  state.correctionChecklist = proposers.map((_p, index) => ({ id: `C1-1-${index + 1}`, text: fix }));
  state.juryHistory = [{ verdict: "FIX", rationale: JSON.stringify({
    votes: proposers.map(p => ({ model: p.reportedModel, verdict: "FIX", ok: true, rationale: "Needs a concrete owner." })),
    corrections: fix, unknowns: ["Private operating costs are unknown."],
  }) }];
  const child: any = { id: 7, tenant_id: 1, kind: "business_report_review", status: "failed_terminal", attempts: 3,
    payload: { input, state, paidJuryRuns: { [phase]: { proposers } },
      reportJuryRuns: { [phase]: { digest: state.digest, deadlineAt: state.expiresAt, events: [] } } } };
  const claims = Object.fromEntries(proposers.map(p => [`review:7:${phase}:${p.modelId}`, 100000]));
  const parent: any = { id: 50, tenant_id: 1, kind: "company_report_package", status: "succeeded", attempts: 4,
    payload: { tenantId: 1, productionVersion: 2, digest: "fixture",
      processingWindowStartedAt: new Date().toISOString(), packageSpend: { "draft:executive:fixture": 500000, ...claims },
      state: { phase: "blocked", intake, files: [], reports: { executive: { jobId: 7, status: "error" } },
        research: { complete: true, evidence, map: {} } } } };
  return { parent, child, phase };
}
