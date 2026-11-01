export type OperatorJobAction = "retry" | "cancel";

type ActionRequest = (method: string, url: string) => Promise<any>;
const inFlight = new Set<number>();

/** Do not report success or clear the confirmation until the API acknowledges it. */
export async function submitOperatorJobAction(
  id: number, action: OperatorJobAction, request: ActionRequest,
): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0 || !["retry", "cancel"].includes(action)) {
    throw new Error("A valid job and action are required.");
  }
  if (inFlight.has(id)) throw new Error("An action is already in progress for this job.");
  inFlight.add(id);
  try {
    const response = await request("POST", `/api/admin/agent-jobs/${id}/${action}`);
    const result = response && typeof response.json === "function" ? await response.json() : response;
    if (result?.success !== true || result?.id !== id) {
      throw new Error("The job action was not confirmed by the server. Refresh its status before trying again.");
    }
  } finally {
    inFlight.delete(id);
  }
}
