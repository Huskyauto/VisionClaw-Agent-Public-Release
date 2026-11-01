import { createHash, randomUUID } from "node:crypto";
import { PACKAGE_SPEND_CAP_MICROS } from "./company-report-production";
import { substantiveReportSection } from "./report-section-generation";
import { packageBudgetMicros } from "./company-package-completion";

/** Used only after the route proves the exact owner/parent/company binding.
 * Reservations are authoritative: even one microdollar forbids this restart.
 * Failed pre-dispatch initial ballots are audit records, not paid completions. */
export function canRestartUnspentPackageReview(childId: number, payload: any, claims: Record<string, number>): boolean {
  if (Object.keys(claims).some(key => key.startsWith(`review:${childId}:`) || key.startsWith(`compiler:${childId}:`)) ||
      payload.fulfillment || payload.state?.approvedSections) return false;
  const state = payload.state;
  const runs: any[] = Object.values(payload.paidJuryRuns || {});
  if (/^Parent report package is unavailable/.test(state?.stopReason || ""))
    return !(state.juryHistory || []).length && runs.length === 0;
  if (state?.phase !== "blocked" ||
      state.stopReason !== "Report initial jury blocked: verdict=ESCALATE, successful votes=0/3; owner review required; no customer delivery" ||
      !Array.isArray(state.juryHistory) || state.juryHistory.length !== 1 ||
      state.juryHistory[0].verdict !== "ESCALATE" || runs.length !== 1) return false;
  const audits: any[] = Object.values(payload.reportJuryRuns || {});
  return audits.length === 1 && Array.isArray(audits[0].events) && audits[0].events.length === 0 &&
    Array.isArray(runs[0].proposers) && runs[0].proposers.length === 3 &&
    runs[0].proposers.every((seat: any) => seat.ok === false);
}

/** A preview is not approval. The authenticated POST must present this exact
 * snapshot again while holding the parent lock, before any state changes. */
export function packageRecoveryPlan(job: any) {
  const p = job.payload, state = p.state;
  const claims: Record<string, number> = p.packageSpend ?? {};
  const validClaims = claims && typeof claims === "object" && !Array.isArray(claims) &&
    Object.values(claims).every(v => Number.isSafeInteger(v) && v > 0);
  let ceiling = PACKAGE_SPEND_CAP_MICROS;
  try { ceiling = packageBudgetMicros(p); } catch { /* malformed authority stays unavailable below */ }
  const reserved = validClaims ? Object.values(claims).reduce((a, b) => a + b, 0) : ceiling;
  const retryKeys = Object.keys(claims).filter(key => key.startsWith("draft:") &&
    !substantiveReportSection(p.packageDrafts?.[key.slice(6)]?.text)).sort();
  const completeIds = Object.values(state.reports ?? {}).filter((r: any) =>
    r.status === "done" && Number.isSafeInteger(r.jobId) && r.jobId > 0)
    .map((r: any) => String(r.jobId));
  const unsafeReview = Object.keys(claims).some(key => !key.startsWith("draft:") &&
    !completeIds.some(id => new RegExp(`^(?:review|compiler):${id}:`).test(key)));
  const researchRepairNeeded = !!state.research?.map?.pages?.some((page: any) =>
    page.status === "rendered" && page.factsVersion !== 1);
  const reasons: string[] = [];
  if (researchRepairNeeded && (Object.values(state.reports ?? {}).some((r: any) => r.status === "done") ||
      state.files?.some((file: any) => file.category === "full")))
    reasons.push("Completed reports are tied to the original research; inspect their evidence before refreshing this package.");
  if (researchRepairNeeded && (state.research.map.discoveryComplete !== true ||
      state.research.map.sitemapQueue?.length || (state.research.coverage?.pending ?? 0) > 0))
    reasons.push("Finish pending discovery/browser pages before using saved-capture-only refresh.");
  if (p.tenantId !== 1) reasons.push("Only the owner can recover this package.");
  if (state.phase !== "blocked" || ["pending", "running"].includes(job.status)) reasons.push("This package is still active or already finished.");
  if (state.research?.map?.overflow) reasons.push("Research exceeded its documented size limit.");
  if (!validClaims) reasons.push("Stored spending reservations need operator inspection.");
  if (reserved >= ceiling) reasons.push("The approved model reservation ceiling is exhausted.");
  if (unsafeReview) reasons.push("An unfinished paid review or compiler attempt needs inspection before recovery.");
  const snapshot = createHash("sha256").update(JSON.stringify({ id: job.id, status: job.status,
    attempts: job.attempts, digest: p.digest, phase: state.phase, reports: state.reports,
    research: state.research?.evidence?.sources?.map((s: any) => [s.id, s.sha256]),
    claims, receipts: Object.entries(p.packageDrafts ?? {}).map(([key, receipt]: [string, any]) =>
      [key, receipt.model, createHash("sha256").update(typeof receipt.text === "string" ? receipt.text : "").digest("hex")]).sort(),
    repair: p.researchOnly,
    researchRepairNeeded })).digest("hex");
  return { available: reasons.length === 0 && !researchRepairNeeded,
    canRepairResearch: reasons.length === 0 && researchRepairNeeded,
    requiresPaidRetryApproval: retryKeys.length > 0, retryKeys, snapshot,
    reservedUsd: reserved / 1e6, remainingUsd: Math.max(0, (ceiling - reserved) / 1e6),
    reasons: researchRepairNeeded ? [...reasons, "Refresh saved factual research before resuming models."] : reasons };
}

export function approvePackageRecovery(job: any, request: {
  snapshot?: string; acceptResearchCost?: boolean; confirmUncertainPaidRetry?: boolean; researchOnly?: boolean;
}) {
  const plan = packageRecoveryPlan(job);
  if (request.snapshot !== plan.snapshot) throw new Error("Package changed; refresh its status before recovery.");
  const researchOnly = request.researchOnly === true;
  if (researchOnly ? !plan.canRepairResearch : !plan.available)
    throw new Error(plan.reasons.join(" ") || "Package recovery is unavailable.");
  if (!researchOnly && request.acceptResearchCost !== true) throw new Error("Approve the existing report cost before recovery.");
  if (!researchOnly && plan.requiresPaidRetryApproval && request.confirmUncertainPaidRetry !== true)
    throw new Error("Explicit approval is required to retry uncertain paid drafts; earlier reservations remain counted.");
  const payload = structuredClone(job.payload);
  const state = payload.state;
  payload.processingWindowStartedAt = new Date().toISOString();
  payload.productionVersion = 2;
  payload.researchOnly = request.researchOnly === true;
  payload.packageRecovery = { id: randomUUID(), subject: plan.snapshot, approvedAt: new Date().toISOString(),
    retryKeys: request.researchOnly ? [] : plan.retryKeys, researchOnly: request.researchOnly === true };
  state.error = undefined;
  if (researchOnly) {
    state.research.complete = false; state.phase = "researching";
  } else {
    state.phase = !state.research ? "new" : state.research.complete === false ? "researching" : "drafting";
    for (const [kind, report] of Object.entries(state.reports) as [string, any][]) {
      if (!report.jobId && report.status !== "done") delete state.reports[kind];
      else if (report.status === "error") { report.status = "pending"; delete report.error; }
    }
  }
  return payload;
}
