import type { ComponentProps } from "react";
import type { RunConfirmationPanel } from "../components/run-confirmation";
import { authFetch } from "./queryClient";

type Run = { id: number; objective: string | null; status: string };
type Confirmation = ComponentProps<typeof RunConfirmationPanel>["confirmation"];
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Inspect existing evidence only. Never re-execute a workflow to confirm it. */
export async function checkLatestRun(fetcher: Fetcher = authFetch): Promise<{
  run: Run;
  confirmation?: Confirmation;
} | null> {
  const options: RequestInit = {
    method: "GET", credentials: "include", cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  };
  async function read(url: string) {
    const response = await fetcher(url, options);
    if (!response.ok) throw new Error("Could not check your run. Please try again.");
    return response.json();
  }
  const list = await read("/api/agent-insights/runs?limit=1");
  if (!Array.isArray(list?.runs)) throw new Error("Run list could not be read. Please try again.");
  if (list.runs.length === 0) return null;
  const id = list.runs[0]?.id;
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Run identity could not be read.");
  const detail = await read(`/api/agent-insights/runs/${id}`);
  if (detail?.id !== id || typeof detail.status !== "string") {
    throw new Error("Run details did not match. Please try again.");
  }
  const receipt = detail.confirmation;
  if (receipt != null && (
    !["confirmed", "failed", "unverified"].includes(receipt.status)
    || !Array.isArray(receipt.checks)
    || !receipt.checks.every((check: any) =>
      check && ["passed", "failed", "unverified"].includes(check.status))
  )) throw new Error("Confirmation evidence could not be read. Please try again.");
  return {
    run: { id, objective: typeof detail.objective === "string" ? detail.objective : null, status: detail.status },
    confirmation: receipt ?? undefined,
  };
}
