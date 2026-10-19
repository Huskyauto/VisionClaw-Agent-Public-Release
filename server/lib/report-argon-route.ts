import type OpenAI from "openai";
import { hasOwnerJuryApiGrant } from "./owner-jury-api-route";

export const REPORT_ARGON_MODEL = "google/gemini-4-argon";

/** Return only the guarded completion operation, not a reusable paid client. */
export function guardReportArgonClient(client: OpenAI, tenantId: number): OpenAI {
  return { chat: { completions: { create: async (params: any, options: any = {}) => {
    if (tenantId !== 1 || !hasOwnerJuryApiGrant(tenantId, "openrouter", REPORT_ARGON_MODEL) ||
        process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1" ||
        params.model !== REPORT_ARGON_MODEL || params.stream || params.tools ||
        params.n && params.n !== 1 ||
        params.max_completion_tokens !== 4096 || params.max_tokens !== undefined ||
        !Array.isArray(params.messages) || params.messages.length !== 2 ||
        params.messages[0]?.role !== "system" || params.messages[1]?.role !== "user" ||
        params.messages.some((m: any) => typeof m.content !== "string")) {
      throw new Error("Argon requires the exact bounded owner report grant and output limit");
    }
    const response = await client.chat.completions.create({
      model: REPORT_ARGON_MODEL, messages: params.messages, max_tokens: 4096,
      provider: { allow_fallbacks: false, require_parameters: true },
    } as any, { signal: options.signal, timeout: 120_000, maxRetries: 0 });
    if (![REPORT_ARGON_MODEL, "gemini-4-argon"].includes(response.model)) {
      const observed = typeof response.model === "string" && /^[a-zA-Z0-9/._:-]{1,100}$/.test(response.model)
        ? response.model : "[missing or invalid]";
      throw new Error(`Argon response model identity mismatch: observed ${observed}; reservation retained`);
    }
    return response;
  } } } } as unknown as OpenAI;
}
