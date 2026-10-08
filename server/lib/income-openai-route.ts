import { AsyncLocalStorage } from "node:async_hooks";

export const INCOME_OPENAI_MODEL = "gpt-5.4" as const;
const grants = new AsyncLocalStorage<{ tenantId: number; modelId: string }>();

export function incomeOpenaiApiEnabled(): boolean {
  return process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED === "1" &&
    process.env.INCOME_DISCOVERY_ENABLED !== "0";
}

/** A server-owned income-seat grant, never a global metered-policy override. */
export function withIncomeOpenaiApiGrant<T>(tenantId: number, modelId: string, callback: () => T): T {
  if (!incomeOpenaiApiEnabled() || tenantId !== 1 || modelId !== INCOME_OPENAI_MODEL) {
    throw new Error("Owner income OpenAI API grant denied");
  }
  return grants.run({ tenantId, modelId }, callback);
}

export function hasIncomeOpenaiApiGrant(tenantId: number | undefined, modelId: string): boolean {
  const grant = grants.getStore();
  return incomeOpenaiApiEnabled() && tenantId === 1 &&
    grant?.tenantId === tenantId && grant.modelId === modelId;
}
