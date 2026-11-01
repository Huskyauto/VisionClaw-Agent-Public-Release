import { compilationReceiptDigest, correctionCheck, hasCompilationCorrectionApproval } from "./company-compilation-correction-policy";
import { acceptCompilation } from "./company-compilation-content";
import { compilationOperations } from "./company-compilation-matrix";
import { companyCompilationSubject } from "./company-package-v3";

/** Reconcile only this proven PRE-reservation legacy failure. This is not an
 * extra correction grant: its already-approved first correction was never sent.
 * Never apply this to a reserved, received, targeted, active or different claim. */
export const UNSPENT_COMPILATION_RECONCILIATION = Object.freeze({
  jobId: 2032, tenantId: 1, operation: "author:opportunities:claude-opus-5-5",
  subject: "2178e68ba37437019d6afd801442dda4811caade6711c2ab7dcca813e99de3ad",
  legacyDigest: "aa365c885f36e41b6db77b182728d4c925276c58f16b22c899df2ead0fd434c0",
  canonicalRawDigest: "b3af7011e1b33c67b3aaa1d77d617a9325e8288dc820e4a854322eae79167180",
  check: "SOURCE_EXCERPT_MISMATCH",
});
type Binding = { jobId: number; tenantId: number; operation: string; subject: string;
  legacyDigest: string; canonicalRawDigest: string; check: string };

/** Pure matcher for tests; all production callers use the source-owned binding. */
export function matchesUnspentCompilationClaim(job: any, binding: Binding): boolean {
  try {
    const payload = job?.payload, state = payload?.state, matrix = state?.compilation;
    const slot = matrix?.slots?.[binding.operation], claim = slot?.correction;
    const op = compilationOperations().find(op => op.key === binding.operation);
    if (job.id !== binding.jobId || job.tenant_id !== binding.tenantId ||
        payload?.tenantId !== binding.tenantId || !hasCompilationCorrectionApproval(payload) ||
        !["succeeded", "failed", "failed_terminal"].includes(job.status) ||
        state?.phase !== "blocked" || state.research?.complete !== true ||
        matrix?.phase !== "blocked" || matrix.subject !== binding.subject ||
        companyCompilationSubject(state) !== binding.subject || !op || op.stage !== "author" ||
        matrix.replacements?.[op.key] || slot?.phase !== "received" ||
        slot.targetedRepair || slot.reconciledUnspentClaim ||
        claim?.phase !== "claimed" || Object.hasOwn(claim, "raw") || claim.digestVersion !== undefined ||
        claim.originalDigest !== binding.legacyDigest || claim.check !== binding.check ||
        compilationReceiptDigest(slot.raw, 2) !== binding.canonicalRawDigest) return false;
    const spend = payload.packageSpend;
    if (!spend || !Number.isSafeInteger(spend[`matrix:${op.key}`]) || spend[`matrix:${op.key}`] <= 0 ||
        Object.entries(spend).some(([key, value]) => !Number.isSafeInteger(value) || (value as number) < 0 ||
          key.startsWith(`matrix:${op.key}:correction:`) || key.startsWith(`matrix:${op.key}:targeted-repair:`)) ||
        Object.values(spend).reduce((sum: number, value) => sum + (value as number), 0) > payload.modelBudgetMicros)
      return false;
    let check: string | undefined;
    try { acceptCompilation(state, op, slot.raw); } catch (error) { check = correctionCheck(op, slot.raw, error); }
    return check === binding.check;
  } catch { return false; }
}
export const canReconcileUnspentCompilation = (job: any): boolean =>
  matchesUnspentCompilationClaim(job, UNSPENT_COMPILATION_RECONCILIATION);

/** Called only inside the existing authenticated owner resume row lock. Retain
 * the old unsent claim separately; the normal first-correction policy, canonical
 * new claim, central spend reservation, cap and lease checks remain mandatory. */
export function reconcileUnspentCompilation(job: any): void {
  if (!canReconcileUnspentCompilation(job)) throw new Error("Unspent correction reconciliation unavailable");
  const slot = job.payload.state.compilation.slots[UNSPENT_COMPILATION_RECONCILIATION.operation];
  slot.reconciledUnspentClaim = { ...slot.correction };
  delete slot.correction;
}
