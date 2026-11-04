import { confirmationDigest, createRunConfirmation } from "./run-confirmation";

/** Read-only assessment of persisted run evidence; never trusts output.verified. */
export function assessPlanRun(input: {
  id: number; tenantId: number; status: string; steps: unknown; log: unknown;
}) {
  const steps = Array.isArray(input.steps) ? input.steps : [];
  const log = Array.isArray(input.log) ? input.log : [];
  const results = log.filter(e => e && Number.isSafeInteger(e.step) && e.step > 0 &&
    typeof e.success === "boolean");
  const plannedIds = steps.map(s => s?.n);
  const observedIds = results.map(r => r.step);
  const coverage = steps.length > 0 && steps.length <= 128 &&
    plannedIds.every(n => Number.isSafeInteger(n) && n > 0) &&
    new Set(plannedIds).size === plannedIds.length &&
    new Set(observedIds).size === observedIds.length &&
    observedIds.length === plannedIds.length && plannedIds.every(n => observedIds.includes(n));
  // Do not hash output payloads (may contain private data). The digest binds
  // this minimal observed trace, not the artifact bytes or user objective.
  const subjectDigest = confirmationDigest({
    verifier: "plan-trace-v1", tenantId: input.tenantId, planId: input.id,
    status: input.status, plannedIds, results: results.map(r => ({ step: r.step, success: r.success })),
  });
  return createRunConfirmation({
    scope: "Read-only plan execution trace; business outcomes and deliverable contents are not independently verified.",
    subjectDigest, currentDigest: subjectDigest,
    requirements: [
      { id: "terminal", label: "Run reached a completed state" },
      { id: "coverage", label: "Every original planned step has one recorded result" },
      { id: "attempts", label: "All recorded step attempts succeeded" },
      { id: "outcome", label: "Requested outcome independently verified" },
    ],
    observations: [
      { id: "terminal", status: ["failed", "rejected"].includes(input.status) ? "failed"
        : input.status === "completed" ? "passed" : "unverified",
      evidence: input.status === "completed" ? "Stored run status is completed; this is not outcome proof."
        : "Run is failed, rejected, pending, handed off or still executing." },
      { id: "coverage", status: coverage ? "passed" : "unverified",
        evidence: coverage ? `${steps.length} planned steps match ${results.length} recorded results.`
          : "Missing, duplicate, malformed or replanned steps prevent exact original-plan coverage confirmation." },
      { id: "attempts", status: results.some(r => r.success === false) ? "failed" : results.length ? "passed" : "unverified",
        evidence: results.some(r => r.success === false) ? "At least one recorded attempt failed."
          : results.length ? "Recorded results report success; no side effects were repeated." : "No step results recorded." },
      { id: "outcome", status: "unverified",
        evidence: "No independent outcome verifier is attached. Model prose, success flags and tool-return claims are not proof." },
    ],
  });
}
