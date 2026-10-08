export const COPILOT_MODELS = ["gpt-5.4-mini", "gpt-5.4", "claude-sonnet-5"] as const;
export const COPILOT_DAILY_LIMIT = 20;
export const COPILOT_TIMEOUT_MS = 120_000;

export function enforceCopilotQuota(evidence: { used?: unknown; active?: unknown }): void {
  const { used, active } = evidence;
  if (!Number.isSafeInteger(used) || !Number.isSafeInteger(active) || (used as number) < 0 || (active as number) < 0) {
    throw new Error("Copilot quota evidence is invalid");
  }
  if ((used as number) >= COPILOT_DAILY_LIMIT) throw new Error("Copilot daily limit reached (20 per UTC day)");
  if ((active as number) > 0) throw new Error("Another Copilot request is still running or requires operator verification");
}

/** Trusted owner message only; models cannot choose additional private context. */
export function approvedCopilotPrompt(text: unknown): string | undefined {
  if (typeof text !== "string" || text.length > 12000) return;
  const value = text.trim();
  const prefix = /^(?:github\s+)?copilot\s*:\s*/i;
  if (prefix.test(value)) return value.replace(prefix, "").trim() || undefined;
  if (/^(?:please\s+)?(?:(?:can|could|would)\s+you\s+(?:please\s+)?)?(?:ask|use|consult|query)\s+(?:github\s+)?copilot\b/i.test(value)) return value;
}

export function validateCopilotRequest(
  input: { tenantId?: unknown; prompt?: unknown; model?: unknown }, owner: number,
): { prompt: string; model: string } {
  if (!Number.isSafeInteger(input.tenantId) || input.tenantId !== owner || owner <= 0) {
    throw new Error("Copilot is owner-only");
  }
  if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 12_000) {
    throw new Error("Copilot prompt must contain 1–12,000 characters");
  }
  const model = input.model === undefined ? COPILOT_MODELS[0] : input.model;
  if (typeof model !== "string" || !(COPILOT_MODELS as readonly string[]).includes(model)) {
    throw new Error("Unsupported Copilot model");
  }
  return { prompt: input.prompt, model };
}
