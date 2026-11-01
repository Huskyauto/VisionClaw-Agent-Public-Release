import { acceptCompilation } from "./company-compilation-content";
import { compilationOperations } from "./company-compilation-matrix";
import { compilationReceiptDigest, correctionCheck, hasCompilationCorrectionApproval } from "./company-compilation-correction-policy";
import { companyCompilationSubject } from "./company-package-v3";

/** Bob's explicit approval: ONE extra correction of this exact saved dental
 * author, inside the existing $150 cap. Source-owned, not caller-writable config.
 * No other job/operation/response can inherit this exception. */
export const TARGETED_COMPILATION_REPAIR_GRANT = Object.freeze({
  version: 1, jobId: 2032, tenantId: 1, operation: "author:readiness:gpt-5.4",
  subject: "2178e68ba37437019d6afd801442dda4811caade6711c2ab7dcca813e99de3ad",
  originalDigest: "2c4439a351008f5b97e4cfcdd2782a2567d10b46724aaf3831e9945234dd138a",
  failedCorrectionDigest: "7fafed79621c520923c0e55a1df390c9285bf6097171537adb4dd7ed6579b76a",
  maxExtraCalls: 1, maxModelBudgetMicros: 150_000_000, approvedAt: "2026-10-21",
});
type Grant = { [K in keyof typeof TARGETED_COMPILATION_REPAIR_GRANT]:
  typeof TARGETED_COMPILATION_REPAIR_GRANT[K] extends number ? number : string };

/** Pure structural check for testing. Supplying a grant here is NOT authority;
 * all admission, execution and spending use the source-owned grant below. */
export function matchesTargetedRepairSource(job: any, grant: Grant): boolean {
  try {
    const payload = job?.payload, state = payload?.state, matrix = state?.compilation;
    const op = compilationOperations().find(op => op.key === grant.operation);
    const slot = matrix?.slots?.[grant.operation], correction = slot?.correction;
    if (job.id !== grant.jobId || (job.tenantId ?? job.tenant_id) !== grant.tenantId ||
        job.tenant_id !== undefined && job.tenant_id !== grant.tenantId ||
        !hasCompilationCorrectionApproval(payload) || !op || op.stage !== "author" ||
        payload.modelBudgetMicros > grant.maxModelBudgetMicros || state.research?.complete !== true ||
        matrix.subject !== grant.subject || companyCompilationSubject(state) !== grant.subject ||
        !["received", "complete"].includes(slot?.phase) || matrix.replacements?.[op.key] ||
        correction?.phase !== "received" || correction.check !== "AUTHOR_SIZE_LIMIT" ||
        correction.originalDigest !== grant.originalDigest ||
        compilationReceiptDigest(slot.raw) !== grant.originalDigest ||
        compilationReceiptDigest(correction.raw) !== grant.failedCorrectionDigest) return false;
    const spend = payload.packageSpend;
    if (!spend || !Number.isSafeInteger(spend[`matrix:${op.key}`]) || spend[`matrix:${op.key}`] <= 0 ||
        !Number.isSafeInteger(spend[`matrix:${op.key}:correction:${grant.originalDigest}`]) ||
        spend[`matrix:${op.key}:correction:${grant.originalDigest}`] <= 0 ||
        Object.values(spend).some(v => !Number.isSafeInteger(v) || (v as number) < 0)) return false;
    const total = Object.values(spend).reduce((n: number, value) => n + (value as number), 0);
    if (!Number.isSafeInteger(total) || total > payload.modelBudgetMicros) return false;
    for (const raw of [slot.raw, correction.raw]) {
      let check: string | undefined;
      try { acceptCompilation(state, op, raw); } catch (error) { check = correctionCheck(op, raw, error); }
      if (check !== "AUTHOR_SIZE_LIMIT") return false;
    }
    return true;
  } catch { return false; }
}
export function targetedRepairSpendKey(): string {
  const grant = TARGETED_COMPILATION_REPAIR_GRANT;
  return `matrix:${grant.operation}:targeted-repair:${grant.failedCorrectionDigest}`;
}
export function hasTargetedRepairApproval(job: any): boolean {
  const grant = TARGETED_COMPILATION_REPAIR_GRANT, approved = job?.payload?.compilationTargetedRepairApproval;
  return !!approved && Object.keys(approved).length === Object.keys(grant).length &&
    Object.entries(grant).every(([key, value]) => approved[key] === value) &&
    matchesTargetedRepairSource(job, grant);
}
export function canApproveTargetedRepair(job: any): boolean {
  const grant = TARGETED_COMPILATION_REPAIR_GRANT;
  return job?.payload?.state?.phase === "blocked" &&
    !["pending", "running", "cancelled"].includes(job.status) &&
    !job.payload.state.compilation?.slots?.[grant.operation]?.targetedRepair &&
    !Object.hasOwn(job.payload.packageSpend ?? {}, targetedRepairSpendKey()) &&
    (!job.payload.compilationTargetedRepairApproval || hasTargetedRepairApproval(job)) &&
    matchesTargetedRepairSource(job, grant);
}
export function approveTargetedRepair(job: any): void {
  if (!canApproveTargetedRepair(job)) throw new Error("Targeted compilation repair is not authorized for these saved responses");
  job.payload.compilationTargetedRepairApproval = { ...TARGETED_COMPILATION_REPAIR_GRANT };
}

/** Called again under the central package-spend row lock before dispatch. */
export function assertTargetedRepairClaim(job: any, key: string): void {
  const grant = TARGETED_COMPILATION_REPAIR_GRANT;
  const slot = job?.payload?.state?.compilation?.slots?.[grant.operation], repair = slot?.targetedRepair;
  if (!hasTargetedRepairApproval(job) || key !== targetedRepairSpendKey() ||
      slot?.phase !== "received" || repair?.phase !== "claimed" || repair.raw !== undefined ||
      repair.originalDigest !== grant.failedCorrectionDigest || repair.check !== "AUTHOR_SIZE_LIMIT")
    throw new Error("Targeted compilation repair lacks exact owner authority");
}
