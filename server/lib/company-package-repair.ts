import { randomUUID } from "node:crypto";
import { hashReportBytes } from "./business-report-evidence";
import { buildReportJurySnapshot, buildMuseReportRequest } from "./business-report-review";
import { compilerContinuationPlan } from "./company-report-compiler-continuation";
import { REPORT_PAID_SEATS } from "./business-report-paid-jury";
import { validReportBallot, restoreReportBallotSnapshot } from "./report-ballot-runner";
import { completionEnvelope, PACKAGE_AGGREGATE_MAX_PACKETS } from "./company-package-completion";
import { inspectInvalidCompilerReply } from "./business-report-compiler-failure";
import { sanitizeAgentOutput } from "../safety-layer";
import { retainedCompilerReviewMatches } from "./company-report-retained-review";

/** Owner repair is a NEW bounded authority, never mutation of old receipts. */
export function packageRepairPlan(parent: any, children: any[], budgetUsd = 150) {
  const identity = (job: any) => ({ id: job.id, tenant_id: job.tenant_id, kind: job.kind,
    status: job.status, attempts: job.attempts, payload: job.payload });
  const snapshot = hashReportBytes(JSON.stringify({ parent: identity(parent),
    children: [...children].sort((a, b) => a.id - b.id).map(identity) }));
  const reasons: string[] = [];
  const reports: Array<{ childId: number; kind: string; mode: "compiler" | "missing-seat" | "compiler-correction";
    sourceRunKey?: string; snapshotSha256?: string; retainedModels?: string[]; allowedModels?: string[];
    responseHash?: string; diagnosticHash?: string; diagnostics?: Array<{ path: string; code: string }> }> = [];
  const p = parent?.payload;
  const claims = p?.packageSpend;
  if (parent?.tenant_id !== 1 || p?.tenantId !== 1 || parent.kind !== "company_report_package" ||
      p.productionVersion !== 2 || p.state?.phase !== "blocked" || ["pending", "running"].includes(parent.status) ||
      p.state.research?.complete !== true || !claims || Array.isArray(claims) ||
      Object.values(claims).some(n => !Number.isSafeInteger(n) || Number(n) <= 0))
    reasons.push("Repair requires a stopped owner package with complete research and valid retained reservations.");
  if (reasons.length) return { available: false, snapshot, reports, reasons, budgetUsd };
  const renewed = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const temporalParent = structuredClone(parent);
  temporalParent.payload.processingWindowStartedAt = new Date().toISOString();
  temporalParent.payload.modelBudgetMicros = budgetUsd * 1e6;
  const temporalChildren = children.map(c => ({ ...c, payload: { ...c.payload, state: { ...c.payload.state, expiresAt: renewed } } }));
  const compilers = compilerContinuationPlan(temporalParent, temporalChildren);
  for (const kind of ["readiness", "executive", "opportunities"]) {
    const id = p.state.reports[kind]?.jobId;
    const child = children.find(c => c.id === id), c = child?.payload;
    if (compilers.reports.some(r => r.childId === id && r.eligible)) {
      reports.push({ childId: id, kind, mode: "compiler" }); continue;
    }
    const compilerKey = `compiler:1:${c?.state?.requestId}`;
    if (child?.tenant_id === 1 && child.kind === "business_report_review" && child.status === "failed_terminal" &&
        c.input?.tenantId === 1 && c.input.reportOnly === true &&
        c.input.orderId === `company-package:${parent.id}:${kind}` && c.input.paidJuryBatch === `company-package:${parent.id}` &&
        c.input.intake?.company === p.state.intake.company && c.input.intake?.website === p.state.intake.website &&
        hashReportBytes(JSON.stringify(c.input.evidence)) === hashReportBytes(JSON.stringify(p.state.research.evidence)) &&
        c.input.compilerMode === "gemini-direct-v1" && c.input.qualityContractVersion === 1 &&
        c.state?.phase === "blocked" && c.state.round === 1 && !c.state.compilerRecoveryId &&
        /^Direct report compilation failed \(/.test(c.state.stopReason || "") &&
        !c.state.reply && !c.state.approvedSections && !c.fulfillment && !c.assemblyStarted &&
        Object.keys(c.compilerRuns ?? {}).length === 1 && c.compilerRuns[compilerKey] &&
        ["FIX", "REJECT"].includes(c.state.juryHistory?.at(-1)?.verdict)) {
      const originalSnapshot = buildReportJurySnapshot({ input: c.input, state: { ...c.state, correctionChecklist: [] } }, true);
      const binding = { jobId: id, tenantId: 1, inputDigest: c.state.digest, reportSha256: hashReportBytes(originalSnapshot) };
      const jury = c.paidJuryRuns?.[`initial_jury:1:${c.state.requestId}`]?.proposers;
      const ownedSeats = Array.isArray(jury) && jury.length === 3 && REPORT_PAID_SEATS.every(spec => {
        const matched = jury.filter((v: any) => v.modelId === spec.modelId);
        try {
          return matched.length === 1 && matched[0].requestedModel === spec.modelId &&
            (matched[0].reportedModel === spec.modelId || spec.modelId === "gpt-5.4" &&
              /^gpt-5\.4-\d{4}-\d{2}-\d{2}$/.test(matched[0].reportedModel)) &&
            validReportBallot(restoreReportBallotSnapshot(matched[0], originalSnapshot, binding), binding);
        } catch { return false; }
      });
      const invalid = ownedSeats && retainedCompilerReviewMatches(c, id) &&
        inspectInvalidCompilerReply(c.input, { ...c.state, expiresAt: renewed }, c.compilerRuns[compilerKey]);
      if (invalid) {
        const packet = JSON.stringify(buildMuseReportRequest(c.input, { ...c.state, expiresAt: renewed, compilerRepairFeedback: invalid.diagnostics }));
        if (packet.length <= 180_000 && !sanitizeAgentOutput(packet).redacted) {
          reports.push({ childId: id, kind, mode: "compiler-correction", sourceRunKey: compilerKey, ...invalid });
          continue;
        }
      }
    }
    const state = c?.state, phase = `initial_jury:1:${state?.requestId}`;
    if (!child || child.tenant_id !== 1 || child.kind !== "business_report_review" ||
        child.status !== "failed_terminal" || c.input?.tenantId !== 1 || c.input?.reportOnly !== true ||
        c.input?.orderId !== `company-package:${parent.id}:${kind}` ||
        c.input?.paidJuryBatch !== `company-package:${parent.id}` ||
        c.input?.intake?.company !== p.state.intake.company || c.input?.intake?.website !== p.state.intake.website ||
        hashReportBytes(JSON.stringify(c.input.evidence)) !== hashReportBytes(JSON.stringify(p.state.research.evidence)) ||
        state?.phase !== "blocked" || state.round !== 1 || !/^Report initial jury blocked:/.test(state.stopReason || "") ||
        state.reply || state.approvedSections || c.fulfillment || c.assemblyStarted ||
        Object.keys(c.compilerRuns ?? {}).length || Object.keys(c.paidJuryRuns ?? {}).length !== 1 ||
        c.reportJuryRuns?.[phase]?.digest !== state.digest ||
        Object.keys(claims).filter(k => k.startsWith(`review:${id}:`)).length !== 3 ||
        !REPORT_PAID_SEATS.every(s => Object.hasOwn(claims, `review:${id}:${phase}:${s.modelId}`))) {
      reasons.push(`${kind}: this state requires reconciliation rather than initial-review repair.`); continue;
    }
    const snapshotText = buildReportJurySnapshot({ input: c.input, state: { ...state, correctionChecklist: [] } }, true);
    const snapshotSha256 = hashReportBytes(snapshotText);
    const binding = { jobId: id, tenantId: 1, inputDigest: state.digest, reportSha256: snapshotSha256 };
    const seats = c.paidJuryRuns[phase]?.proposers;
    if (!Array.isArray(seats) || seats.length !== 3 || new Set(seats.map((s: any) => s.modelId)).size !== 3 ||
        !REPORT_PAID_SEATS.every(spec => seats.some((s: any) => s.modelId === spec.modelId))) {
      reasons.push(`${kind}: reviewer identities are incomplete.`); continue;
    }
    const retained = seats.filter((s: any) => {
      try { return s.requestedModel === s.modelId && (s.reportedModel === s.modelId ||
        s.modelId === "gpt-5.4" && /^gpt-5\.4-\d{4}-\d{2}-\d{2}$/.test(s.reportedModel)) &&
        validReportBallot(restoreReportBallotSnapshot(s, snapshotText, binding), binding); }
      catch { return false; }
    });
    const missing = seats.filter((s: any) => !retained.includes(s));
    if (retained.length !== 2 || missing.length !== 1 || missing[0].finishReason !== "length" ||
        !Number.isSafeInteger(missing[0].reportedTokensOut) || missing[0].reportedTokensOut <= 0) {
      reasons.push(`${kind}: only a confirmed output-exhausted single seat can be replaced by this control.`); continue;
    }
    reports.push({ childId: id, kind, mode: "missing-seat", sourceRunKey: phase, snapshotSha256,
      retainedModels: retained.map((s: any) => s.modelId), allowedModels: missing.map((s: any) => s.modelId) });
  }
  const reservedMicros = Object.values(claims).reduce((sum: number, n) => sum + Number(n), 0);
  const bounds = { remainingDrafts: 0, initialSeats: reports.filter(r => r.mode === "missing-seat").length,
    compilerRounds: 6, finalSeats: 18, aggregatePackets: PACKAGE_AGGREGATE_MAX_PACKETS };
  let envelope;
  try {
    if (!Number.isSafeInteger(budgetUsd) || budgetUsd < 10 || budgetUsd > 200) throw new Error("Invalid budget");
    envelope = completionEnvelope({ ...bounds, spentMicros: reservedMicros, ceilingMicros: budgetUsd * 1e6 });
    if (!envelope.ready) reasons.push("The complete remaining path exceeds this model reservation allowance.");
  } catch { reasons.push("The proposed model reservation allowance is invalid."); }
  return { available: reasons.length === 0 && reports.length === 3, snapshot, reports, reasons, budgetUsd,
    reservedUsd: reservedMicros / 1e6, maximumCompletionUsd: envelope ? (reservedMicros + envelope.requiredMicros) / 1e6 : null, bounds };
}

export function approvePackageRepair(parent: any, children: any[], request: {
  snapshot: string; modelBudgetUsd: number; confirmAdditionalPaidWork: boolean;
}) {
  const plan = packageRepairPlan(parent, children, request.modelBudgetUsd);
  if (!plan.available || plan.snapshot !== request.snapshot || request.confirmAdditionalPaidWork !== true)
    throw new Error("Package repair approval is stale, incomplete or outside its completion envelope");
  const payload = structuredClone(parent.payload);
  payload.modelBudgetMicros = request.modelBudgetUsd * 1e6;
  payload.completionAdmission = { version: 1, priorKeys: Object.keys(payload.packageSpend),
    bounds: plan.bounds, approvedAt: new Date().toISOString(), subject: plan.snapshot };
  payload.processingWindowStartedAt = new Date().toISOString();
  payload.state.phase = "reviewing"; delete payload.state.error;
  const updated = children.map(child => {
    const report = plan.reports.find(r => r.childId === child.id)!;
    const value = structuredClone(child.payload), old = structuredClone(value.state);
    value.packageRepairHistory = [...(value.packageRepairHistory ?? []), { state: old, approval: plan.snapshot }];
    value.state.expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    delete value.state.stopReason;
    value.state.phase = "wait_muse";
    if (report.mode === "compiler-correction") {
      const recoveryId = randomUUID();
      value.state.compilerRecoveryId = recoveryId;
      value.state.compilerRepairFeedback = report.diagnostics;
      value.compilerRecoveryGrants = { ...value.compilerRecoveryGrants, [recoveryId]: {
        kind: "confirmed-invalid", jobId: child.id, tenantId: 1, requestId: value.state.requestId,
        digest: value.state.digest, round: value.state.round, priorKey: report.sourceRunKey,
        priorResponseHash: report.responseHash, diagnosticHash: report.diagnosticHash,
        authorizedAt: new Date().toISOString(), maxAdditionalMicros: 2_000_000,
      } };
    }
    if (report.mode === "missing-seat") {
      value.state.phase = "initial_jury"; value.state.requestId = randomUUID();
      value.state.juryHistory = []; value.state.correctionChecklist = [];
      value.jurySeatRecovery = { ...report, requestId: value.state.requestId, digest: value.state.digest };
    }
    payload.state.reports[report.kind].status = "pending"; delete payload.state.reports[report.kind].error;
    return { id: child.id, payload: value };
  });
  return { payload, children: updated };
}
