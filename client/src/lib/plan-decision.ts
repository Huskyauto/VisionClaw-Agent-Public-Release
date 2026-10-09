export const FELIX_ONE_TAP_APPROVAL_REASON = "Approved by Felix from Plans Awaiting Felix.";
const approvalsInFlight = new Set<number>();

type DecisionRequest = (
  method: string,
  url: string,
  body: { decision: "approve"; reason: string },
) => Promise<any>;

export async function approvePlanFromFelix(
  planId: number,
  request: DecisionRequest,
): Promise<{ ok: true; status: string }> {
  if (!Number.isInteger(planId) || planId <= 0) {
    throw new Error("A valid plan ID is required for approval.");
  }
  if (approvalsInFlight.has(planId)) {
    throw new Error("Approval is already in progress for this plan.");
  }
  approvalsInFlight.add(planId);
  try {
    const response = await request("POST", `/api/plans/${planId}/decide`, {
      decision: "approve",
      reason: FELIX_ONE_TAP_APPROVAL_REASON,
    });
    const result = response && typeof response.json === "function"
      ? await response.json()
      : response;
    const acceptedStatuses = new Set(["approved", "executing", "completed"]);
    if (result?.ok !== true || !acceptedStatuses.has(String(result?.status))) {
      throw new Error(`Approval was not confirmed by the server (status: ${String(result?.status || "unknown")}).`);
    }
    return { ok: true, status: String(result.status) };
  } finally {
    approvalsInFlight.delete(planId);
  }
}