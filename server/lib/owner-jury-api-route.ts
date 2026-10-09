import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomeClaudeBudget } from "./income-claude-route";
import { reserveIncomeApiBudget } from "./income-claude-route";

type PaidJuryLane = "openai-api" | "anthropic-api";
const grants = new AsyncLocalStorage<{ tenantId: number; lane: PaidJuryLane; model: string }>();
export function ownerJuryDirectApiEnabled(): boolean {
  return process.env.OWNER_JURY_DIRECT_API_ENABLED === "1";
}
function approved(lane: PaidJuryLane, model: string): boolean {
  return lane === "openai-api" ? model === "gpt-5.4" :
    lane === "anthropic-api" && ["claude-sonnet-5-5", "claude-opus-5-5"].includes(model);
}
export function hasOwnerJuryApiGrant(tenantId: number | undefined, lane: PaidJuryLane, model: string): boolean {
  const grant = grants.getStore();
  return ownerJuryDirectApiEnabled() && tenantId === 1 && grant?.tenantId === tenantId &&
    grant.lane === lane && grant.model === model && approved(lane, model);
}
/** Topic-independent, server-owned jury grant; never a generic chat paid override. */
export async function executeOwnerJuryApiCall<T>(
  tenantId: number, lane: PaidJuryLane, model: string, prompt: string,
  budget: IncomeClaudeBudget, call: () => Promise<T>,
): Promise<T> {
  if (!ownerJuryDirectApiEnabled() || tenantId !== 1 || !approved(lane, model)) {
    throw new Error("Owner jury direct API grant denied");
  }
  reserveIncomeApiBudget(model as "gpt-5.4" | "claude-sonnet-5-5" | "claude-opus-5-5", prompt, budget);
  return grants.run({ tenantId, lane, model }, call);
}
