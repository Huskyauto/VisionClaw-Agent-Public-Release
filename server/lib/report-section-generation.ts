/** A section is not successful merely because the provider returned HTTP 200.
 * Keep this report-only: short tool answers elsewhere can be perfectly valid. */
export function substantiveReportSection(text: unknown): text is string {
  return typeof text === "string" && text.trim().length >= 200 &&
    (text.match(/\b[\p{L}\p{N}][\p{L}\p{N}'-]*\b/gu)?.length ?? 0) >= 35;
}

type Resolve = (model: string, tenant: number, options: {
  forbidMeteredFallback: true; providerLane?: "replit" | "openference";
}) => Promise<{ actualModelId: string; client: { chat: { completions: {
  create(params: any, options?: any): Promise<any>;
} } } }>;

/** Bounded, zero-metered recovery. Preserve the original prompt and never
 * accept length-truncated prose. This does not approve or bypass report review. */
export async function generateReportSection(input: {
  modelId: string; tenantId: number; messages: Array<{ role: "system" | "user"; content: string }>;
}, resolve?: Resolve): Promise<string> {
  const getClient = resolve ?? (await import("../providers")).getClientForModel;
  const routes = [
    { model: input.modelId, lane: undefined },
    { model: "gpt-5.4", lane: "replit" as const },
    { model: "openference/minimax-m3", lane: "openference" as const },
  ];
  for (const [index, route] of routes.entries()) {
    try {
      const { client, actualModelId } = await getClient(route.model,
        input.tenantId, { forbidMeteredFallback: true, ...(route.lane ? { providerLane: route.lane } : {}) });
      const response = await client.chat.completions.create({
        model: actualModelId, messages: input.messages, temperature: 0.4, max_tokens: 8192,
      }, { timeout: 120_000, maxRetries: 0 });
      const choice = response?.choices?.[0];
      const text = choice?.message?.content;
      if (choice?.finish_reason !== "stop" || !substantiveReportSection(text)) {
        throw new Error("Report section was incomplete, truncated or non-substantive");
      }
      return text.trim();
    } catch {
      // No private source/provider error bodies in logs. The final caller owns
      // the existing one-retry quality gate and incident reporting.
      if (index === routes.length - 1) throw new Error("Report section failed on all bounded free drafting lanes");
      console.warn("[report-section] Draft unavailable/incomplete; advancing to next pinned free report fallback");
    }
  }
  throw new Error("Report section generation did not complete");
}
