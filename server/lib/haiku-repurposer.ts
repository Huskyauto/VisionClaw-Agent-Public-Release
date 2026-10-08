/** Task-specific paid replacement, not a global model/effort policy. */
import type Anthropic from "@anthropic-ai/sdk";
import { withTenantContext } from "./tenant-context";

const MODEL = "claude-haiku-5-5";
const CALL_BOUND = 0.003072;
interface Reply {
  model: string;
  stop_reason: string | null;
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens: number; output_tokens: number;
    cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
}
export interface RepurposerRoute {
  native: boolean;
  model: string;
  count?: (request: Anthropic.MessageCreateParamsNonStreaming, signal: AbortSignal) => Promise<number>;
  generate: (request: Anthropic.MessageCreateParamsNonStreaming, signal: AbortSignal) => Promise<Reply>;
}
export interface RepurposerDeps {
  resolve: (tenantId: number) => Promise<RepurposerRoute>;
  reserve: (tenantId: number) => Promise<boolean>;
  ceiling: () => boolean | Promise<boolean>;
  record: (cost: number, tenantId: number, reply?: Reply) => Promise<boolean>;
}

const defaults: RepurposerDeps = {
  resolve: async tenantId => {
    const { getClientForModel } = await import("../providers");
    const { ADMIN_TENANT_ID } = await import("../auth");
    // Owner-approved replacement for this previously direct paid task ONLY.
    // Resolver still prefers flat/subscription lanes; other tenants retain
    // ordinary metered policy and cannot borrow the owner's key.
    const { client, actualModelId } = await getClientForModel(MODEL, tenantId,
      { meteredOverride: tenantId === ADMIN_TENANT_ID });
    if (client.baseURL.replace(/\/$/, "") === "https://api.anthropic.com/v1") {
      if (actualModelId !== MODEL || !client.apiKey.startsWith("sk-ant-")) {
        throw new Error("HAIKU_REPURPOSE_NATIVE_ROUTE_UNAVAILABLE");
      }
      const { default: Native } = await import("@anthropic-ai/sdk");
      const native = new Native({ apiKey: client.apiKey, baseURL: "https://api.anthropic.com",
        maxRetries: 0, timeout: 20_000 });
      return { native: true, model: MODEL,
        count: async (request, signal) => (await native.messages.countTokens({
          model: MODEL, system: request.system, messages: request.messages,
        }, { signal, maxRetries: 0 })).input_tokens,
        generate: (request, signal) => native.messages.create(request, { signal, maxRetries: 0 }) };
    }
    // Keep a resolver-selected flat/free/subscription route instead of forcing
    // paid Haiku. Existing provider wrapper owns its accounting (no double count).
    return { native: false, model: actualModelId,
      generate: async (request, signal) => {
        const result = await client.chat.completions.create({
          model: actualModelId, max_tokens: 4096,
          messages: [{ role: "system", content: String(request.system) },
            { role: "user", content: String(request.messages[0].content) }],
        }, { signal });
        return { model: result.model, stop_reason: result.choices[0]?.finish_reason === "stop" ? "end_turn" : "max_tokens",
          content: [{ type: "text", text: result.choices[0]?.message.content ?? "" }] };
      } };
  },
  reserve: async tenantId => {
    const { claimAutonomousBudget } = await import("../agentic/autonomous-budget");
    const claim = await claimAutonomousBudget({ tenantId, estimatedUsd: CALL_BOUND,
      label: "content-repurposer.haiku-55" });
    return claim.ok && !claim.degraded && claim.claimedUsd >= CALL_BOUND;
  },
  ceiling: async () => {
    const { meteredAnthropicCeiling } = await import("../agentic/cost-ledger");
    const gate = meteredAnthropicCeiling();
    return !gate.exceeded && Number.isFinite(gate.ceiling) && gate.ceiling > 0 &&
      gate.spent + CALL_BOUND <= gate.ceiling;
  },
  record: async (cost, tenantId, reply) => {
    const { recordCost } = await import("../agentic/cost-ledger");
    const usage = reply?.usage;
    return recordCost({ tenantId, toolName: "llm.anthropic.content-repurposer",
      model: MODEL, costUsd: cost,
      tokensIn: usage ? usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) : 0,
      tokensOut: usage?.output_tokens ?? 0, cachedTokensIn: usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
      operation: reply ? "medium:observed_usage" : "medium:uncertain_completion_no_retry" });
  },
};

export async function runHaikuRepurposer(
  tenantId: number | undefined, prompt: string, system: string, outerSignal?: AbortSignal,
  deps: RepurposerDeps = defaults,
): Promise<string> {
  if (!Number.isSafeInteger(tenantId) || !tenantId || tenantId < 1) {
    throw new Error("HAIKU_REPURPOSE_TRUSTED_TENANT_REQUIRED");
  }
  if (Buffer.byteLength(prompt + system, "utf8") > 100_000) throw new Error("HAIKU_REPURPOSE_INPUT_TOO_LARGE");
  return withTenantContext({ tenantId, source: "explicit" }, async () => {
    const signal = outerSignal ? AbortSignal.any([outerSignal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
    signal.throwIfAborted();
    let route: RepurposerRoute;
    try { route = await deps.resolve(tenantId); }
    catch { throw new Error("HAIKU_REPURPOSE_ROUTE_UNAVAILABLE"); }
    const request: Anthropic.MessageCreateParamsNonStreaming = {
      model: route.model, max_tokens: 4096, system,
      messages: [{ role: "user", content: prompt }],
      ...(route.native ? { thinking: { type: "adaptive" as const }, output_config: { effort: "medium" as const } } : {}),
    };
    if (route.native) {
      if (route.model !== MODEL || !await deps.ceiling() ||
          !await deps.reserve(tenantId)) throw new Error("HAIKU_REPURPOSE_BUDGET_DENIED");
      let count: number;
      try { count = await route.count!(request, signal); }
      catch { throw new Error("HAIKU_REPURPOSE_TOKEN_COUNT_FAILED"); }
      if (!Number.isSafeInteger(count) || count < 0 || count > 8192) throw new Error("HAIKU_REPURPOSE_INPUT_TOO_LARGE");
    }
    signal.throwIfAborted();
    let reply: Reply;
    try { reply = await route.generate(request, signal); }
    catch {
      if (route.native && !await deps.record(CALL_BOUND, tenantId)) throw new Error("HAIKU_REPURPOSE_LEDGER_FAILED_NO_RETRY");
      throw new Error("HAIKU_REPURPOSE_COMPLETION_UNCERTAIN_NO_RETRY");
    }
    if (route.native) {
      const u = reply.usage;
      const valid = /^claude-haiku-5-5(?:-\d{8})?$/.test(reply.model) && !!u &&
        [u.input_tokens, u.output_tokens, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0]
          .every(n => Number.isSafeInteger(n) && n >= 0) &&
        u.output_tokens <= 4096 &&
        u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) <= 8192;
      const { estimateCostUsd } = await import("../agentic/cost-ledger");
      const cost = valid ? estimateCostUsd(MODEL,
        u!.input_tokens + (u!.cache_read_input_tokens ?? 0) + (u!.cache_creation_input_tokens ?? 0),
        u!.output_tokens, u!.cache_read_input_tokens ?? 0, u!.cache_creation_input_tokens ?? 0) : CALL_BOUND;
      if (!await deps.record(cost, tenantId, valid ? reply : undefined)) throw new Error("HAIKU_REPURPOSE_LEDGER_FAILED_NO_RETRY");
      if (!valid) throw new Error("HAIKU_REPURPOSE_USAGE_UNVERIFIED_NO_RETRY");
    }
    const text = reply.content.filter(b => b.type === "text").map(b => b.text ?? "").join("\n").trim();
    if (reply.stop_reason !== "end_turn" || !text) throw new Error("HAIKU_REPURPOSE_OUTPUT_INCOMPLETE_NO_RETRY");
    return text;
  });
}
