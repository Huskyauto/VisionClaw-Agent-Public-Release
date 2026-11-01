type Sender = (url: string, init: RequestInit) => Promise<Response>;

export const PACKAGE_CONFIRMATION_ERROR =
  "The server connection failed while confirming your report. Your inputs and request ID are saved. Check Recent packages, then retry without editing the inputs to avoid duplicate work.";

/** Admission only: never invokes model generation or retries a report job. */
export async function submitCompanyPackage(
  body: string,
  send: Sender,
  pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 600)),
): Promise<Response> {
  const payload = JSON.parse(body);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload?.requestId || "")
    || payload.acceptResearchCost !== true) {
    throw new Error("A saved request identity and explicit report approval are required.");
  }
  const request = () => send("/api/admin/company-report-packages", {
    method: "POST", headers: { "Content-Type": "application/json" }, body,
  });
  const retry = async () => {
    await pause();
    try {
      return await request();
    } catch (error) {
      if (error instanceof TypeError) throw new Error(PACKAGE_CONFIRMATION_ERROR);
      throw error;
    }
  };
  let response: Response;
  try {
    response = await request();
  } catch (error) {
    // Fetch network failures are ambiguous: the server may already have committed.
    // Same-ID admission replay is safe; a new ID or a paid-job retry is not.
    if (!(error instanceof TypeError)) throw error;
    return retry();
  }
  if (![502, 503, 504].includes(response.status)
    || response.headers.get("x-app-origin") === "express") return response;
  // At most one retry, with byte-identical input and the same approval/identity.
  return retry();
}
