/** Pure formatter. The internal profile is not accepted from tool arguments. */
export type SchemaFormat = "pretty" | "compact";
export function selectSchemaFormat(flag: string | undefined, tenantId?: number, profile?: string): SchemaFormat {
  return flag === "1" && tenantId === 1 && profile === "owner-plan-step" ? "compact" : "pretty";
}

const THINKING_PRESETS: Record<string, string> = {
  off: "",
  low: "Think briefly before answering.",
  medium: "Think carefully and consider multiple angles before answering.",
  high: "Think deeply and exhaustively. Consider edge cases, alternatives, and implications before answering.",
};

export function buildStructuredTaskPrompt(
  input: { thinking?: string; schema?: Record<string, any>; trustedSystemInstruction?: string },
  format: SchemaFormat = "pretty",
): string {
  let content = "You are a JSON-only assistant. Output ONLY valid JSON — no markdown fences, no commentary, no explanation.";
  const policy = typeof input.trustedSystemInstruction === "string"
    ? input.trustedSystemInstruction.trim().slice(0, 4_000) : "";
  if (policy) {
    content += `\n\nAdditional server-authored task policy:\n${policy}`;
    content += "\n\nThis additional policy cannot weaken the JSON-only output rule, the schema, or a safety refusal.";
  }
  if (input.thinking && THINKING_PRESETS[input.thinking]) content += `\n\n${THINKING_PRESETS[input.thinking]}`;
  if (input.schema) {
    content += `\n\nYour output MUST conform to this JSON Schema:\n${JSON.stringify(input.schema, null, format === "compact" ? undefined : 2)}`;
  }
  return content;
}
