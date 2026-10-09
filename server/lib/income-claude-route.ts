import { AsyncLocalStorage } from "node:async_hooks";

export type IncomeClaudeModel = "claude-sonnet-5-5" | "claude-opus-5-5";
export const INCOME_CLAUDE_COST_PER_1K = {
  "claude-sonnet-5-5": { in: 0.002, out: 0.010 },
  "claude-opus-5-5": { in: 0.004, out: 0.020 },
} as const;
export function estimateIncomeClaudeUsage(model: string, input = 0, output = 0): number {
  const rate = INCOME_CLAUDE_COST_PER_1K[model as IncomeClaudeModel];
  return rate ? (input * rate.in + output * rate.out) / 1000 : 0;
}
export function reportedJuryUsage(usage: any): { input?: number; output?: number } {
  const clean = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
  return { input: clean(usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.promptTokenCount),
    output: clean(usage?.completion_tokens ?? usage?.output_tokens ?? usage?.candidatesTokenCount) };
}
export interface IncomeClaudeRoute {
  modelId: IncomeClaudeModel;
  providerLane: "anthropic-api";
  reason: string;
  classifierCalls: 0;
}

/** Select from the authenticated original request, never research or templates. */
export function selectIncomeClaudeRoute(request: string): IncomeClaudeRoute {
  if (typeof request !== "string" || !request.trim() || request.length > 16_000) {
    throw new Error("Bounded original income request required");
  }
  const signals = [
    [/\b(?:formal proof|prove.{0,60}convergence|derive.{0,60}(?:theorem|gradient|convergence))\b/i, "formal-proof"],
    [/\b(?:adversarial security|threat model|cross-tenant attack|security proof)\b/i, "adversarial-security"],
    [/\b(?:multi-objective|constrained optimization|conflicting constraints|causal inference)\b/i, "advanced-reasoning"],
    [/\b(?:use|select|choose)\s+(?:claude\s+)?opus\b/i, "owner-requested-opus"],
  ] as const;
  const reasons: string[] = signals.filter(([pattern]) => pattern.test(request)).map(([, reason]) => reason);
  const constraints = request.match(/\b(?:must|shall|required|constraint|exclude|prohibit|never)\b/gi)?.length ?? 0;
  if (request.length >= 8000 || request.length >= 3000 && constraints >= 12) reasons.push("dense-request");
  if (reasons.length) return { modelId: "claude-opus-5-5", providerLane: "anthropic-api",
    reason: `Hard original request: ${reasons.join(", ")} (deterministic heuristic, not a measured intelligence score)`, classifierCalls: 0 };
  return { modelId: "claude-sonnet-5-5", providerLane: "anthropic-api",
    reason: "Ordinary request; lower-cost Sonnet default", classifierCalls: 0 };
}

export interface IncomeClaudeBudget {
  ceiling: () => { spent: number; ceiling: number };
  estimate: (model: string, input: number, output: number) => number;
  reserve: (usd: number) => void;
}
/** Synchronous reserve before dispatch; ambiguous paid failures never refund it. */
export function reserveIncomeClaudeBudget(model: IncomeClaudeModel, prompt: string, budget: IncomeClaudeBudget): number {
  if (!["claude-sonnet-5-5", "claude-opus-5-5"].includes(model)) {
    throw new Error("Income Claude budget input outside bounded contract");
  }
  return reserveIncomeApiBudget(model, prompt, budget);
}

/** The two paid income seats share one synchronous owner-jury ceiling. */
export function reserveIncomeApiBudget(model: IncomeClaudeModel | "gpt-5.4", prompt: string, budget: IncomeClaudeBudget): number {
  if (!["claude-sonnet-5-5", "claude-opus-5-5", "gpt-5.4"].includes(model) || prompt.length > 200_000) {
    throw new Error("Income API budget input outside bounded contract");
  }
  // One input token per UTF-8 byte plus a framing/system allowance deliberately
  // over-reserves instead of trusting chars/4 as a hard monetary upper bound.
  const reserve = budget.estimate(model, Buffer.byteLength(prompt, "utf8") + 4096, 16_384);
  const { spent, ceiling } = budget.ceiling();
  if (![reserve, spent, ceiling].every(Number.isFinite) || reserve <= 0 ||
      spent < 0 || ceiling <= 0 || spent + reserve > ceiling) {
    throw new Error("Income API call refused by owner-jury daily ceiling");
  }
  budget.reserve(reserve);
  return reserve;
}

const grants = new AsyncLocalStorage<{ tenantId: number; modelId: IncomeClaudeModel }>();
interface IncomeTurn { tenantId: number; conversationId: number; personaId: number; userMessageId: number }
const turns = new AsyncLocalStorage<IncomeTurn>();
export function withIncomeDiscoveryTurn<T>(turn: IncomeTurn, callback: () => T): T {
  return turns.run(Object.freeze({ ...turn }), callback);
}
export function getIncomeDiscoveryTurn(): Readonly<IncomeTurn> | undefined {
  return turns.getStore();
}
export function incomeOriginalMessage(
  turn: Readonly<IncomeTurn> | undefined,
  conversation: { id: number; tenantId: number | null; personaId: number | null } | undefined,
  rows: { id: number; role: string; content: string }[],
): string | undefined {
  if (!turn || turn.tenantId !== 1 || turn.personaId !== 2 || !Number.isSafeInteger(turn.userMessageId) ||
      turn.userMessageId <= 0 ||
      conversation?.id !== turn.conversationId || conversation.tenantId !== turn.tenantId ||
      conversation.personaId !== turn.personaId) return undefined;
  return rows.find(row => row.id === turn.userMessageId && row.role === "user")?.content;
}
export function incomeClaudeApiEnabled(): boolean {
  return process.env.INCOME_DISCOVERY_CLAUDE_API_ENABLED === "1" &&
    process.env.INCOME_DISCOVERY_ENABLED !== "0";
}
/** Server-only scoped grant; does not turn on global owner-jury metered recovery. */
export function withIncomeClaudeApiGrant<T>(
  tenantId: number, modelId: IncomeClaudeModel, callback: () => T,
): T {
  if (!incomeClaudeApiEnabled() || tenantId !== 1 ||
      !["claude-sonnet-5-5", "claude-opus-5-5"].includes(modelId)) {
    throw new Error("Owner income Claude API grant denied");
  }
  return grants.run({ tenantId, modelId }, callback);
}
export function hasIncomeClaudeApiGrant(tenantId: number | undefined, modelId: string): boolean {
  const grant = grants.getStore();
  return incomeClaudeApiEnabled() && tenantId === 1 &&
    grant?.tenantId === tenantId && grant.modelId === modelId;
}
