import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { getSubscriptionAccessToken } from "./oauth-subscriptions";
import { decryptApiKey } from "./crypto";
import crypto from "crypto";
import { isClaudeRunnerAvailable, getClaudeRunnerBaseUrl } from "./claude-runner";
export {
  TEST_MODEL_IDS,
  checkModelFreshness,
  getTestModelForProvider,
  isModelFreshnessCheckDue,
} from "./model-freshness";

import { logSilentCatch } from "./lib/silent-catch";

export const COST_LEDGER_RECORDED = Symbol.for("visionclaw.cost-ledger-recorded");
import { wrapClientWithParamAdaptation } from "./lib/param-adaptation";
// R94 SECURITY — static import (tsx/ESM does NOT define `require`; the previous
// dynamic require() silently threw and made every cost lookup fall back to ADMIN).
import { currentTenantId } from "./lib/tenant-context";
import { PROFUNDO_CLIENT_MARKER, configureProviderRecovery, trySubscriptionAuth, markSubscriptionFailed, markProviderUnhealthy, isProviderHealthy, getUnhealthyProviders, resetProviderHealth, createBackgroundCompletion, preferOAuthSubscriptions, meteredLlmEnabled, LAST_RESORT_MODEL, lastResortEnabled, claimLastResortSlot } from "./provider-recovery";
export { markSubscriptionFailed, markProviderUnhealthy, isProviderHealthy, getUnhealthyProviders, resetProviderHealth, createBackgroundCompletion, preferOAuthSubscriptions, meteredLlmEnabled, LAST_RESORT_MODEL, lastResortEnabled, claimLastResortSlot } from "./provider-recovery";

// R64.C — sentinel for cost-attribution fallback ONLY. Authn/authz happens
// upstream via storage.getTenantProviderKey(tenantId, provider). This sentinel
// exists so missing-tenant-context bugs are loud (warn + stack) rather than
// silently misattributing cost to whoever happens to be tenant 1.
// Task 104 girth split — the static model catalog lives in model-registry.ts;
// imported + re-exported here so existing importers are unchanged.
import {
  type ModelInfo,
  MODEL_REGISTRY,
  getMultimodalModelsForTier,
  getMaxOutputTokens,
} from "./model-registry";
export {
  type ModelInfo,
  MODEL_REGISTRY,
  isExplorationFriendly,
  isModelMultimodal,
  getMultimodalModelsForTier,
  getMaxOutputTokens,
  TIER_COST_ESTIMATES,
} from "./model-registry";

const ADMIN_TENANT_ID_FALLBACK = 1;
/**
 * Round 31 — single source of truth for cost-tracking a chat.completions.create
 * call, supporting both the non-streaming shape (await → object with .usage)
 * and the streaming shape (await → AsyncIterable of chunks where the final
 * chunk carries .usage when stream_options.include_usage=true). For streaming
 * calls we auto-inject stream_options.include_usage=true if the caller didn't
 * set it, so we can actually see the usage. We also wrap the iterator so the
 * caller's for-await loop is unaffected.
 *
 * Best-effort: any cost-track failure must never break the underlying LLM
 * call. Both call sites (wrapClientWithCostTracking and the replitOpenai
 * monkey-patch) use this.
 */
/**
 * Normalize a provider usage object into a single billing shape across OpenAI,
 * Anthropic (native) and Gemini. Prompt-cache fields differ per provider:
 *   - OpenAI / Gemini-OpenAI-compat: prompt_tokens INCLUDES cached; the cached
 *     subset is prompt_tokens_details.cached_tokens.
 *   - Anthropic native: input_tokens EXCLUDES cache read/creation — they are
 *     reported separately (cache_read_input_tokens, cache_creation_input_tokens),
 *     so we ADD them back so tokensIn is the TRUE total (this also fixes a latent
 *     under-count of Anthropic input whenever the cache is active).
 *   - Gemini native: usageMetadata.cachedContentTokenCount (subset of prompt).
 * Returns cachedTokensIn + cacheWriteTokens as SUBSETS of the returned tokensIn,
 * which is the contract estimateCostUsd() relies on for discounting.
 */
function extractUsageTokens(u: any): {
  tokensIn: number;
  tokensOut: number;
  cachedTokensIn: number;
  cacheWriteTokens: number;
} {
  if (!u) return { tokensIn: 0, tokensOut: 0, cachedTokensIn: 0, cacheWriteTokens: 0 };
  const tokensOut = u.completion_tokens || u.output_tokens || u.candidatesTokenCount || 0;
  const cachedTokensIn =
    u.prompt_tokens_details?.cached_tokens ??
    u.cache_read_input_tokens ??
    u.cachedContentTokenCount ??
    0;
  const cacheWriteTokens = u.cache_creation_input_tokens ?? 0;
  let tokensIn = u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount ?? 0;
  // Anthropic native shape: input_tokens does NOT include cache read/creation.
  // Detect it (input_tokens present, prompt_tokens absent) and add the cache
  // tokens so tokensIn is the total and the subsets stay valid.
  if (u.prompt_tokens === undefined && u.input_tokens !== undefined) {
    tokensIn = (u.input_tokens || 0) + cachedTokensIn + cacheWriteTokens;
  }
  return { tokensIn, tokensOut, cachedTokensIn, cacheWriteTokens };
}

function buildPatchedCreate(
  origCreate: Function,
  modelResolver: (params: any) => string,
  tenantResolver: () => number,
  providerLabel: string,
) {
  return async function patchedCreate(params: any, options?: any) {
    const isStream = params?.stream === true;
    if (isStream) {
      // Auto-inject usage tracking so the final chunk carries .usage.
      // Never overwrite an explicit caller setting.
      params.stream_options = params.stream_options || {};
      if (params.stream_options.include_usage === undefined) {
        params.stream_options.include_usage = true;
      }
    }

    // R92 — Anthropic system_and_3 prompt caching. When this client is bound
    // to an Anthropic-style endpoint and the caller hasn't already set
    // cache_control on any message, mark the system message + last 3
    // non-system messages as cacheable so long persistent prompts (CORPORATE
    // IDENTITY + TOOL PLAYBOOK + SOUL + ACTIVE SKILLS, ~10–40K tokens) get
    // billed at the cached rate on the second turn onward. Best-effort;
    // errors here never break the call. Provider labels can be "anthropic",
    // "llm.anthropic", or model-id-prefixed — match by substring.
    // Profundo flat-rate lane: bare claude-* ids served on Bob's flat $20/mo
    // membership. They must NOT be treated as metered Anthropic — skip the
    // Anthropic cache-control injection (OpenAI-compatible proxy, not the
    // Anthropic API), skip the metered-Anthropic daily breaker (flat plan can
    // never be a runaway spend), and record $0 in the cost ledger below.
    const isFlatRate =
      providerLabel.startsWith("llm.profundo") ||
      providerLabel.startsWith("llm.openference") ||
      providerLabel.startsWith("llm.claude-runner");
    const isAnthropic =
      !isFlatRate &&
      (providerLabel.toLowerCase().includes("anthropic") ||
        String(modelResolver(params) || "").toLowerCase().startsWith("claude"));
    if (isAnthropic && Array.isArray(params?.messages)) {
      try {
        const callerSetCache = params.messages.some((m: any) => {
          if (m?.cache_control) return true;
          if (Array.isArray(m?.content)) return m.content.some((b: any) => b?.cache_control);
          return false;
        });
        if (!callerSetCache) {
          const { applyAnthropicCacheControl } = await import("./anthropic-prompt-cache");
          params.messages = applyAnthropicCacheControl(params.messages, "5m");
        }
      } catch (_e) { logSilentCatch("server/providers.ts", _e); }
    }

    // ── Metered-Anthropic daily circuit breaker (Bob 2026-06-12) ──────────
    // Opus/Claude is jury-only + cost-capped. Once today's METERED Claude spend
    // crosses the ceiling, fail CLOSED on any further Anthropic completion so a
    // runaway loop (cf. the $440 / 752-call burst) can't keep burning. The
    // flat-rate Claude Runner records ~$0 and so never trips this; callers with
    // a fallback chain (now non-Anthropic) catch the throw and reroute to a
    // free/cheap lane. Best-effort import mirrors the cost-track pattern below.
    // Cost-exempt lanes (jury vote + once-weekly BWB flagship recap) bypass the
    // breaker — same policy as the spend tally, centralized in isCostExemptLane.
    // Imported here (not top-level) to mirror the dynamic-import cost-track
    // pattern below and avoid a providers⇄cost-ledger module cycle.
    if (isAnthropic) {
      let gate: { exceeded: boolean; spent: number; ceiling: number } | null = null;
      let exempt = false;
      try {
        const { meteredAnthropicCeiling, isCostExemptLane } = await import("./agentic/cost-ledger");
        exempt = isCostExemptLane(providerLabel);
        if (!exempt) gate = meteredAnthropicCeiling();
      } catch (e: any) {
        // FAIL CLOSED: this is a SPEND BACKSTOP (Bob added it after a $440 /
        // 752-call burst). If the guard itself can't run — e.g. the dynamic
        // cost-ledger import throws — it must NOT silently disable the cap and
        // let metered Anthropic spend run uncapped. Block the call instead;
        // callers with a fallback chain catch the throw and reroute to a
        // free/cheap lane (graceful, not a hard outage). Exempt lanes (jury +
        // flagship recap) must never be blocked, so mirror isCostExemptLane's
        // rule inline as a last resort when the canonical fn is unreachable
        // (keep in sync with server/agentic/cost-ledger.ts::isCostExemptLane).
        // Operator escape hatch: ANTHROPIC_BREAKER_FAIL_OPEN=1.
        logSilentCatch("server/providers.ts", e);
        const exemptFallback =
          typeof providerLabel === "string" &&
          (providerLabel.includes(":jury") || providerLabel.includes(":flagship"));
        if (!exemptFallback && process.env.ANTHROPIC_BREAKER_FAIL_OPEN !== "1") {
          throw new Error(
            `[providers] metered Anthropic breaker guard failed to evaluate (${e?.message}); ` +
            `failing CLOSED to prevent uncapped spend. Route to a free/cheap lane, ` +
            `or set ANTHROPIC_BREAKER_FAIL_OPEN=1 to override.`,
          );
        }
      }
      if (gate?.exceeded && !exempt) {
        throw new Error(
          `[providers] metered Anthropic daily ceiling reached ($${gate.spent.toFixed(2)} ≥ $${gate.ceiling}). ` +
          `Claude/Opus is jury-only and cost-capped (Bob 2026-06-12). Call blocked to prevent a cost runaway — ` +
          `route this to a free/cheap lane, or raise ANTHROPIC_DAILY_CEILING_USD.`,
        );
      }
    }

    const result: any = await origCreate(params, options);

    // Non-streaming path: usage is on the result object itself.
    if (!isStream) {
      try {
        const { tokensIn, tokensOut, cachedTokensIn, cacheWriteTokens } = extractUsageTokens(result?.usage);
        if (tokensIn || tokensOut) {
          const { recordCost } = await import("./agentic/cost-ledger");
          const recorded = await recordCost({
            tenantId: tenantResolver(),
            toolName: providerLabel,
            model: modelResolver(params),
            tokensIn,
            tokensOut,
            cachedTokensIn,
            cacheWriteTokens,
            operation: "chat.completions.create",
            // Flat membership: $0 marginal regardless of model id. Without this,
            // claude-* ids served via Profundo would be priced as metered
            // Anthropic spend AND increment the Anthropic daily breaker.
            ...(isFlatRate ? { costUsd: 0 } : {}),
          });
          Object.defineProperty(result, COST_LEDGER_RECORDED, {
            value: recorded === true,
            enumerable: false,
            configurable: true,
          });
        }
      } catch (e: any) {
        if (result && typeof result === "object") {
          Object.defineProperty(result, COST_LEDGER_RECORDED, {
            value: false,
            enumerable: false,
            configurable: true,
          });
        }
        console.warn(`[providers] cost-track failed (${providerLabel}): ${e?.message}`);
      }
      return result;
    }

    // Streaming path: wrap the async iterable so we can sniff .usage on
    // the final chunk without disturbing the caller's iteration. The
    // OpenAI SDK's stream returned from .create() is itself an
    // AsyncIterable<ChatCompletionChunk> — we delegate to its iterator
    // and intercept each chunk.
    if (!result || typeof result[Symbol.asyncIterator] !== "function") {
      // Not an iterable (defensive — shouldn't happen for stream:true)
      return result;
    }
    const wrapped = (async function* () {
      let lastUsage: any = null;
      try {
        for await (const chunk of result as AsyncIterable<any>) {
          if (chunk?.usage) lastUsage = chunk.usage;
          yield chunk;
        }
      } finally {
        try {
          if (lastUsage) {
            const { tokensIn, tokensOut, cachedTokensIn, cacheWriteTokens } = extractUsageTokens(lastUsage);
            if (tokensIn || tokensOut) {
              const { recordCost } = await import("./agentic/cost-ledger");
              await recordCost({
                tenantId: tenantResolver(),
                toolName: providerLabel,
                model: modelResolver(params),
                tokensIn,
                tokensOut,
                cachedTokensIn,
                cacheWriteTokens,
                operation: "chat.completions.create.stream",
                ...(isFlatRate ? { costUsd: 0 } : {}),
              });
            }
          }
        } catch (e: any) {
          console.warn(`[providers] streaming cost-track failed (${providerLabel}): ${e?.message}`);
        }
      }
    })();
    // Preserve any extra props the original stream object might expose
    // (controller, response, etc.) by copying them onto the wrapped iterator.
    for (const key of Object.keys(result)) {
      if (!(key in wrapped)) {
        try { (wrapped as any)[key] = result[key]; } catch (_silentErr) { logSilentCatch("server/providers.ts", _silentErr); }
      }
    }
    return wrapped;
  };
}

// R125+137.93 SECURITY/CORRECTNESS — request-local cost-tracking facade.
// The previous implementation MUTATED the shared cached client's
// chat.completions.create in place on EVERY getClientForModel call. Because
// clients are process-wide cached (getUserClient / getSubscriptionClient /
// getIntegrationClient / getVertexExpressClient), each call stacked another
// recording layer on top of the last: one API call was recorded N times in the
// cost ledger (probe measured 3 inserts after 3 wraps), inflating spend
// tallies and the metered circuit breakers, and tenant/model attribution was
// whatever the LATEST concurrent wrap had set (cross-tenant mis-billing race).
// The facade never touches the shared client: it returns a Proxy whose
// chat.completions.create is a per-call patched fn; everything else delegates.
function wrapClientWithCostTracking(client: OpenAI, modelId: string, tenantId: number, providerLabel: string): OpenAI {
  const patchedCreate = buildPatchedCreate(
    client.chat.completions.create.bind(client.chat.completions),
    () => modelId,
    () => tenantId,
    providerLabel,
  );
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== "chat") {
        const v = Reflect.get(target, prop, target);
        return typeof v === "function" ? v.bind(target) : v;
      }
      const chat = (target as any).chat;
      return new Proxy(chat, {
        get(chatT, chatP) {
          if (chatP !== "completions") {
            const v = (chatT as any)[chatP];
            return typeof v === "function" ? v.bind(chatT) : v;
          }
          const completions = (chatT as any).completions;
          return new Proxy(completions, {
            get(compT, compP) {
              if (compP === "create") return patchedCreate;
              const v = (compT as any)[compP];
              return typeof v === "function" ? v.bind(compT) : v;
            },
          });
        },
      });
    },
  }) as OpenAI;
}

export const replitOpenai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Round 30 — cost telemetry instrumentation. ~30 sites across the codebase
// call replitOpenai.chat.completions.create directly (task-planner,
// critique-agent, memory-graph, research-pipeline, voice, self-improvement,
// agent-eval, agentic-features, debate-engine, …) — every one of them was
// invisible to the cost ledger. Patch the prototype'd create() once at
// export so all of them flow through recordCost without touching each
// caller. The wrapper reads model from params, defaults tenantId=1
// (single-tenant deployment), and is best-effort: cost-track failures
// must never break the underlying LLM call.
{
  const origCreate = replitOpenai.chat.completions.create.bind(replitOpenai.chat.completions);
  // R94 SECURITY — read tenant from AsyncLocalStorage context set by the
  // auth middleware (or the background-job wrapper). This eliminates the
  // hardcoded `() => 1` cross-tenant cost-leak: tenant A's request now
  // bills tenant A even though replitOpenai is a process-wide singleton.
  // Falls back to ADMIN_TENANT_ID_FALLBACK with a one-line warn for
  // genuinely contextless calls (boot-time health checks, etc.).
  const replitTenantWarned = new Set<string>();
  // Round 31 — same wrapper now handles streaming responses (auto-injects
  // stream_options.include_usage and intercepts the final chunk's .usage).
  (replitOpenai.chat.completions as any).create = buildPatchedCreate(
    origCreate,
    (params) => params?.model || "unknown",
    () => {
      try {
        const tid = currentTenantId();
        if (typeof tid === "number") return tid;
      } catch (_silentErr) { logSilentCatch("server/providers.ts", _silentErr); }
      const stack = new Error().stack?.split("\n").slice(2, 5).join(" | ") || "";
      const stackKey = stack.slice(0, 120);
      if (!replitTenantWarned.has(stackKey)) {
        replitTenantWarned.add(stackKey);
        console.warn(`[providers] replitOpenai called without tenant context — billing ADMIN. caller: ${stackKey}`);
      }
      return ADMIN_TENANT_ID_FALLBACK;
    },
    "replit-openai",
  );
  console.log("[providers] replitOpenai cost-tracking wrapper installed (R94 — AsyncLocalStorage tenant context)");
}

export const PROVIDER_CONFIG: Record<string, { name: string; baseUrl: string; description: string }> = {
  replit: { name: "Replit AI (Built-in)", baseUrl: "", description: "Built-in - GPT-5.4, GPT-5.1, no API key needed" },
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1", description: "GPT-4o, GPT-4.1, GPT-5 Mini" },
  anthropic: { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", description: "Claude Opus 4.6, Sonnet 4.6, Haiku 4.5" },
  xai: { name: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", description: "Grok 4, Grok 3, Grok 3 Mini" },
  google: { name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", description: "Gemini 3.1 Pro, 3 Pro, 3 Flash, 2.5 Pro - cheapest & fastest" },
  perplexity: { name: "Perplexity", baseUrl: "https://api.perplexity.ai", description: "Web research - Sonar, Sonar Pro, Deep Research" },
  openrouter: { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", description: "MiMo V2, Grok 4.1 Fast, DeepSeek V3.2, Qwen 3.6, Gemma 4, GLM 5.2, Llama 4 & more — one key, frontier models" },
  profundo: { name: "Profundo AI", baseUrl: "https://api.profundoai.com/v1", description: "Flat $20/mo unlimited — GLM 5.2, GLM 4.7 Flash, Kimi K3, Gemini 3.5 Flash/3.1 Pro, DeepSeek V4 Flash, Grok 4.5, Gemma 4 & more; no token meter" },
  zai: { name: "Z.AI (direct)", baseUrl: "https://api.z.ai/api/paas/v4", description: "Direct Z.AI lane — GLM-5.3 (743B agentic/cyber flagship) via Bob's funded Z.AI account; pay-per-token, deliberately funded 2026-08-14" },
  openference: { name: "Openference", baseUrl: "https://api.openference.com/v1", description: "Auto Agent flat-rate lane — DeepSeek V4, Kimi K3, MiniMax M3, Qwen 3.8, GLM 5.3 & more" },
};

// A provider lane is a concrete account/transport identity, not merely the
// registry provider named by a model. MoA uses this to keep simultaneous jury
// seats independently paced and health-scoped instead of letting the generic
// fallback ladder collapse every vote onto one endpoint.
export type ProviderLane = "openference" | "profundo" | "claude-runner" | "anthropic-api" | "zai" | "openrouter";

export function providerLaneCanServeModel(lane: ProviderLane, modelId: string): boolean {
  switch (lane) {
    case "openference":
      return !!OPENFERENCE_MODEL_MAP[modelId];
    case "profundo":
      return !!PROFUNDO_MODEL_MAP[modelId];
    case "claude-runner":
      return MODEL_REGISTRY.some((model) => model.id === modelId && model.provider === "anthropic");
    case "anthropic-api":
      return MODEL_REGISTRY.some((model) => model.id === modelId && model.provider === "anthropic");
    case "zai":
      return !!ZAI_MODEL_MAP[modelId];
    case "openrouter":
      return MODEL_REGISTRY.some((model) => model.id === modelId && model.provider === "openrouter");
  }
}

// ── Profundo flat-rate lane (Bob 2026-08-08) ────────────────────────────────
// Bob's $20/mo unlimited plan at api.profundoai.com (OpenAI-compatible, Bearer
// key, chat completions incl. tools; Responses API exists but tool OUTPUT compat
// is unsupported — always use chat completions). Registry ids map to Profundo's
// bare catalog ids. Marginal cost is $0 (flat membership), so this lane runs
// BEFORE the $0-policy substitution: a mapped metered model routes here at full
// quality instead of being downgraded to free modelfarm. 429 = fair-use pacing
// (pace, don't parallelize); 401 = key revoked.
const PROFUNDO_MODEL_MAP: Record<string, string> = {
  "z-ai/glm-5.2": "glm-5.2",
  "moonshotai/kimi-k3": "kimi-k3",
  "gemini-3.5-flash": "gemini-3.5-flash",
  "gemini-3.1-pro-preview": "gemini-3.1-pro",
  "deepseek/deepseek-v4-flash": "deepseek-v4-flash",
  // Catalog expansion verified live 2026-08-10 (all three answered chat completions):
  "z-ai/glm-4.7-flash": "glm-4.7-flash",
  "x-ai/grok-4.5": "grok-4.5",
  "google/gemma-4-31b-it": "gemma-4",
  // High-end additions verified live 2026-08-11 (all answered chat completions).
  // These give tool-capable calls the REAL model at $0 flat rate instead of the
  // $0-policy modelfarm downgrade. Claude Runner (no-tools) still runs first for
  // anthropic ids; this lane catches the tools-required path.
  "claude-opus-5": "claude-opus-5",
  "claude-opus-4-8": "claude-opus-4-8",
  // Fable-5 stays LAST-RESORT by doctrine (never a default), but when it IS
  // reached it now serves flat-rate instead of metered Anthropic key.
  "claude-fable-5": "claude-fable-5",
  // High-end expansion verified live on /v1/models 2026-08-14 (Bob: "wire in all
  // those high-end models"). gpt-5.6-sol/gpt-5.5 were previously $0-downgraded to
  // modelfarm gpt-5.4 (both are REPLIT_MODELFARM_UNSUPPORTED) — Profundo now
  // serves the REAL models at $0 flat rate. gpt-5.4/gpt-5-mini/gpt-5 stay on the
  // native modelfarm lane (already free + supported; do NOT add them here).
  "gpt-5.6-sol": "gpt-5.6-sol",
  "gpt-5.6-luna": "gpt-5.6-luna",
  "gpt-5.6-terra": "gpt-5.6-terra",
  "gpt-5.5": "gpt-5.5",
  "gpt-5.3-codex-spark": "gpt-5.3-codex-spark",
  "claude-sonnet-5": "claude-sonnet-5",
  "claude-haiku-4-5": "claude-haiku-4-5",
  "minimax/minimax-m3": "minimax-m3",
  "xiaomi/mimo-v2.5-pro": "mimo-v2.5-pro",
  "qwen/qwen3.6-plus": "qwen3.6-plus",
  "mistralai/mistral-large": "mistral-large",
  "moonshotai/kimi-k2.7-code": "kimi-k2.7-code",
};

function getProfundoKey(): string | null {
  // The stored secret can carry a stray whitespace char from the paste — strip
  // ALL whitespace, not just trim (verified live 2026-08-08: raw key 401s,
  // stripped key authenticates).
  const raw = process.env.PROFUNDO_API_KEY;
  if (!raw) return null;
  const key = raw.replace(/\s+/g, "");
  return key.length >= 20 ? key : null;
}

function getProfundoClient(): OpenAI | null {
  const key = getProfundoKey();
  if (!key) return null;
  const cacheKey = "profundo-flat";
  if (!clientCache.has(cacheKey)) {
    clientCache.set(cacheKey, new OpenAI({
      apiKey: key,
      baseURL: PROVIDER_CONFIG.profundo.baseUrl,
      timeout: 90_000,
      maxRetries: 0,
    }));
  }
  return wrapClientWithParamAdaptation(clientCache.get(cacheKey)!);
}

// Request-local facade (never an in-place patch of the cached client) that marks
// the "profundo" health identity on auth/rate-limit/outage errors so the router
// stops routing to a dead Profundo lane for the health TTL, WITHOUT poisoning the
// registry provider (openrouter/google) whose health state is unrelated transport.
export function wrapProfundoFailureMarking(client: OpenAI): OpenAI {
  const wrapped = Object.create(client);
  const completions = Object.create(client.chat.completions);
  const origCreate = client.chat.completions.create.bind(client.chat.completions);
  completions.create = (async (...args: Parameters<typeof origCreate>) => {
    try {
      return await origCreate(...args);
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      const errorName = String(err?.name || "");
      const errorCode = String(err?.code || "");
      const isTransportFailure =
        status == null &&
        (
          errorName === "APIConnectionError" ||
          errorName === "APIConnectionTimeoutError" ||
          ["ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "ETIMEDOUT"].includes(errorCode)
        );
      if (
        status === 401 ||
        status === 403 ||
        status === 429 ||
        (status >= 500 && status <= 599) ||
        isTransportFailure
      ) {
        const reason = status
          ? `HTTP ${status}: ${String(err?.message || "").slice(0, 60)}`
          : `${errorName || errorCode || "transport failure"}: ${String(err?.message || "").slice(0, 60)}`;
        markProviderUnhealthy("profundo", reason);
      }
      throw err;
    }
  }) as typeof origCreate;
  const chat = Object.create(client.chat);
  chat.completions = completions;
  wrapped.chat = chat;
  return wrapped as OpenAI;
}

const profundoStartGate = createProfundoStartGate();

function wrapProfundoPacing(client: OpenAI): OpenAI {
  const wrapped = Object.create(client);
  const completions = Object.create(client.chat.completions);
  const origCreate = client.chat.completions.create.bind(client.chat.completions);
  completions.create = async (...args: Parameters<typeof origCreate>) => {
    await profundoStartGate.waitForStart(args[1]?.signal ?? undefined);
    return origCreate(...args);
  };
  const chat = Object.create(client.chat);
  chat.completions = completions;
  wrapped.chat = chat;
  return wrapped as OpenAI;
}

// Shared Profundo flat-lane resolver (R125+154): returns a cost-tracked client
// when the model is on Bob's flat $20/mo membership and the lane is healthy,
// else null so the caller falls through to its normal ladder. Used both by the
// main non-replit path AND early in the replit branch (so gpt-5.6-sol / gpt-5.5
// serve the REAL model via Profundo instead of the modelfarm gpt-5.4 downgrade).
function tryProfundoLane(
  modelId: string,
  tenantId: number | undefined,
): { client: OpenAI; actualModelId: string } | null {
  const profundoId = PROFUNDO_MODEL_MAP[modelId];
  if (!profundoId || !isProviderHealthy("profundo")) return null;
  const profundoClient = getProfundoClient();
  if (!profundoClient) return null;
  const profundoTenant = (() => {
    if (typeof tenantId === "number" && tenantId > 0) return tenantId;
    console.warn(`[providers] missing tenantId for profundo/${modelId} cost attribution — falling back to ADMIN_TENANT_ID. Stack:\n${new Error().stack?.split("\n").slice(2, 6).join("\n")}`);
    return ADMIN_TENANT_ID_FALLBACK;
  })();
  console.log(`[providers] Routing ${modelId} → Profundo flat-rate lane as ${profundoId} ($0 marginal — flat membership, no token meter)`);
  return {
    client: Object.assign(wrapClientWithCostTracking(
      wrapProfundoPacing(wrapProfundoFailureMarking(profundoClient)),
      profundoId,
      profundoTenant,
      "llm.profundo",
    ), { [PROFUNDO_CLIENT_MARKER]: true }),
    actualModelId: profundoId,
  };
}

// ── Openference Auto Agent lane ─────────────────────────────────────────────
// The Auto Agent plan authorizes generic runtimes such as VisionClaw. Its
// OpenAI-compatible API uses Bearer authentication and charges a flat plan fee,
// so each completion has zero marginal ledger cost. The provider can still
// return 429s, so all request creation shares one modest paced queue.
const OPENFERENCE_MODEL_MAP: Record<string, string> = {
  "openference/deepseek-v4-pro": "DeepSeek-V4-Pro",
  "openference/deepseek-v4-pro-0813": "DeepSeek-V4-Pro-0813",
  "openference/deepseek-v4-flash-vision-exp": "DeepSeek-V4-Flash-Vision-Exp",
  "openference/kimi-k3": "Kimi K3",
  "openference/minimax-m3": "MiniMax M3",
  "openference/qwen3.8-27b": "Qwen3.8 27b",
  "openference/glm-5.3": "GLM-5.3",
  "openference/glm-5.2": "GLM-5.2",
  "openference/ox-alpha": "Ox Alpha",
};

function getOpenferenceKey(): string | null {
  const raw = process.env.OPENFERENCE_API_KEY;
  if (!raw) return null;
  const key = raw.replace(/\s+/g, "");
  return key.length >= 20 ? key : null;
}

export function hasOpenferenceKey(): boolean {
  return !!getOpenferenceKey();
}

function getOpenferenceClient(): OpenAI | null {
  const key = getOpenferenceKey();
  if (!key) return null;
  const cacheKey = `openference-${crypto.createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
  if (!clientCache.has(cacheKey)) {
    clientCache.set(cacheKey, new OpenAI({
      apiKey: key,
      baseURL: PROVIDER_CONFIG.openference.baseUrl,
      timeout: 90_000,
      maxRetries: 0,
    }));
  }
  return wrapClientWithParamAdaptation(clientCache.get(cacheKey)!);
}

function createProviderStartGate(
  provider: string,
  options: { intervalMs?: number; queueTimeoutMs?: number } = {},
) {
  const intervalMs = Math.max(0, Math.min(options.intervalMs ?? 250, 60_000));
  const queueTimeoutMs = Math.max(1, Math.min(options.queueTimeoutMs ?? 10_000, 60_000));
  let queue: Promise<void> = Promise.resolve();
  let nextAllowedAt = 0;

  return {
    waitForStart(signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) return Promise.reject(new Error(`${provider} paced request was aborted`));

      let cancelled = false;
      const scheduled = queue.then(async () => {
        if (cancelled) return;
        const waitMs = Math.max(0, nextAllowedAt - Date.now());
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
        if (cancelled) return;
        nextAllowedAt = Date.now() + intervalMs;
      });
      // Release the FIFO after granting a start slot, never after the completion
      // itself. A slow upstream response must not turn pacing into a global stall.
      queue = scheduled.then(() => undefined, () => undefined);

      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
          callback();
        };
        const onAbort = () => {
          cancelled = true;
          finish(() => reject(new Error(`${provider} paced request was aborted`)));
        };
        const timeout = setTimeout(() => {
          cancelled = true;
          finish(() => reject(new Error(`${provider} pacing queue exceeded ${queueTimeoutMs}ms`)));
        }, queueTimeoutMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        scheduled.then(
          () => {
            if (!cancelled) finish(resolve);
          },
          (error) => finish(() => reject(error)),
        );
      });
    },
  };
}

export function createOpenferenceStartGate(options: { intervalMs?: number; queueTimeoutMs?: number } = {}) {
  return createProviderStartGate("Openference", options);
}

export function createProfundoStartGate(options: { intervalMs?: number; queueTimeoutMs?: number } = {}) {
  return createProviderStartGate("Profundo", { intervalMs: 500, queueTimeoutMs: 15_000, ...options });
}

export function createClaudeRunnerStartGate(options: { intervalMs?: number; queueTimeoutMs?: number } = {}) {
  return createProviderStartGate("Claude Runner", { intervalMs: 400, queueTimeoutMs: 15_000, ...options });
}

const openferenceStartGate = createOpenferenceStartGate();

function wrapOpenferencePacing(client: OpenAI): OpenAI {
  const wrapped = Object.create(client);
  const completions = Object.create(client.chat.completions);
  const origCreate = client.chat.completions.create.bind(client.chat.completions);
  completions.create = async (...args: Parameters<typeof origCreate>) => {
    await openferenceStartGate.waitForStart(args[1]?.signal ?? undefined);
    return origCreate(...args);
  };
  const chat = Object.create(client.chat);
  chat.completions = completions;
  wrapped.chat = chat;
  return wrapped as OpenAI;
}

function wrapOpenferenceFailureMarking(client: OpenAI): OpenAI {
  const wrapped = Object.create(client);
  const completions = Object.create(client.chat.completions);
  const origCreate = client.chat.completions.create.bind(client.chat.completions);
  completions.create = (async (...args: Parameters<typeof origCreate>) => {
    try {
      return await origCreate(...args);
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if (status === 401 || status === 403 || status === 429 || (status >= 500 && status <= 599)) {
        markProviderUnhealthy("openference", `HTTP ${status}: ${String(err?.message || "").slice(0, 60)}`);
      }
      throw err;
    }
  }) as typeof origCreate;
  const chat = Object.create(client.chat);
  chat.completions = completions;
  wrapped.chat = chat;
  return wrapped as OpenAI;
}

function tryOpenferenceLane(
  modelId: string,
  tenantId: number | undefined,
): { client: OpenAI; actualModelId: string } | null {
  const actualModelId = OPENFERENCE_MODEL_MAP[modelId];
  if (!actualModelId || !isProviderHealthy("openference")) return null;
  const client = getOpenferenceClient();
  if (!client) return null;
  const costTenant = typeof tenantId === "number" && tenantId > 0 ? tenantId : ADMIN_TENANT_ID_FALLBACK;
  console.log(`[providers] Routing ${modelId} → Openference Auto Agent as ${actualModelId} ($0 marginal — provider pacing enabled)`);
  return {
    client: wrapClientWithCostTracking(
      wrapOpenferencePacing(wrapOpenferenceFailureMarking(client)),
      actualModelId,
      costTenant,
      "llm.openference",
    ),
    actualModelId,
  };
}

// ── Z.AI direct lane (Bob 2026-08-14) ───────────────────────────────────────
// Bob deliberately funded a Z.AI account (ZAI_GLM5_API_KEY) to reach GLM-5.3
// (743B agentic/cyber flagship, launched 2026-08-14) BEFORE it lands on the
// flat-rate lanes. This is a METERED lane by design — owner-blessed exception
// to the $0 policy, scoped to ONLY the ids in ZAI_MODEL_MAP. Everything else
// (incl. glm-5.2, which Profundo serves at $0 flat) must NOT be added here.
// If Z.AI is down/unauthorized, the failure marker sidelines the lane and the
// request falls through to the normal ladder ($0 substitution — never fails).
// NOTE: glm-5.3 is permission-gated on Z.AI's side as of 2026-08-14 (error
// 1220); wiring is ready so it lights up the moment Bob's account is granted.
const ZAI_MODEL_MAP: Record<string, string> = {
  "z-ai/glm-5.3": "glm-5.3",
};

function getZaiKey(): string | null {
  const raw = process.env.ZAI_GLM5_API_KEY;
  if (!raw) return null;
  const key = raw.replace(/\s+/g, "");
  return key.length >= 20 ? key : null;
}

function getZaiClient(): OpenAI | null {
  const key = getZaiKey();
  if (!key) return null;
  const cacheKey = "zai-direct";
  if (!clientCache.has(cacheKey)) {
    clientCache.set(cacheKey, new OpenAI({ apiKey: key, baseURL: PROVIDER_CONFIG.zai.baseUrl }));
  }
  return wrapClientWithParamAdaptation(clientCache.get(cacheKey)!);
}

// Request-local facade (same pattern as wrapProfundoFailureMarking — never an
// in-place patch of the cached client). Marks the "zai" health identity on
// auth/permission/rate-limit/outage errors so the router stops paying the
// round-trip while the lane is dead; the caller falls to the normal ladder.
function wrapZaiFailureMarking(client: OpenAI): OpenAI {
  const wrapped = Object.create(client);
  const completions = Object.create(client.chat.completions);
  const origCreate = client.chat.completions.create.bind(client.chat.completions);
  completions.create = (async (...args: Parameters<typeof origCreate>) => {
    try {
      return await origCreate(...args);
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if (status === 401 || status === 403 || status === 429 || (status >= 500 && status <= 599)) {
        markProviderUnhealthy("zai", `HTTP ${status}: ${String(err?.message || "").slice(0, 60)}`);
      }
      throw err;
    }
  }) as typeof origCreate;
  const chat = Object.create(client.chat);
  chat.completions = completions;
  wrapped.chat = chat;
  return wrapped as OpenAI;
}

function tryZaiLane(
  modelId: string,
  tenantId: number | undefined,
): { client: OpenAI; actualModelId: string } | null {
  if (tenantId !== ADMIN_TENANT_ID_FALLBACK) return null;
  const zaiId = ZAI_MODEL_MAP[modelId];
  if (!zaiId || !isProviderHealthy("zai")) return null;
  const zaiClient = getZaiClient();
  if (!zaiClient) return null;
  const zaiTenant = (() => {
    if (typeof tenantId === "number" && tenantId > 0) return tenantId;
    console.warn(`[providers] missing tenantId for zai/${modelId} cost attribution — falling back to ADMIN_TENANT_ID. Stack:\n${new Error().stack?.split("\n").slice(2, 6).join("\n")}`);
    return ADMIN_TENANT_ID_FALLBACK;
  })();
  console.log(`[providers] Routing ${modelId} → Z.AI direct lane as ${zaiId} (metered — owner-funded Z.AI account, Bob 2026-08-14)`);
  return {
    client: wrapClientWithCostTracking(wrapZaiFailureMarking(zaiClient), zaiId, zaiTenant, "llm.zai"),
    actualModelId: zaiId,
  };
}

const INTEGRATION_ENV: Record<string, { apiKeyEnv: string; baseUrlEnv: string }> = {
  anthropic: { apiKeyEnv: "AI_INTEGRATIONS_ANTHROPIC_API_KEY", baseUrlEnv: "AI_INTEGRATIONS_ANTHROPIC_BASE_URL" },
  google: { apiKeyEnv: "AI_INTEGRATIONS_GEMINI_API_KEY", baseUrlEnv: "AI_INTEGRATIONS_GEMINI_BASE_URL" },
};

function getIntegrationClient(provider: string): OpenAI | null {
  const env = INTEGRATION_ENV[provider];
  if (!env) return null;
  const apiKey = process.env[env.apiKeyEnv];
  const baseURL = process.env[env.baseUrlEnv];
  if (!apiKey || !baseURL) return null;
  const cacheKey = `integration-${provider}`;
  if (!clientCache.has(cacheKey)) {
    clientCache.set(cacheKey, new OpenAI({ apiKey, baseURL }));
  }
  return wrapClientWithParamAdaptation(clientCache.get(cacheKey)!);
}

export function hasIntegrationFallback(provider: string): boolean {
  const env = INTEGRATION_ENV[provider];
  if (!env) return false;
  return !!(process.env[env.apiKeyEnv] && process.env[env.baseUrlEnv]);
}

const clientCache = new Map<string, OpenAI>();
const claudeRunnerStartGate = createClaudeRunnerStartGate();

// Exported to keep the real Claude Runner bridge path regression-testable
// without needing to start a subscription-backed CLI process in node:test.
export function wrapClaudeRunnerPacing(
  client: OpenAI,
  startGate = claudeRunnerStartGate,
): OpenAI {
  const wrapped = Object.create(client);
  const completions = Object.create(client.chat.completions);
  const origCreate = client.chat.completions.create.bind(client.chat.completions);
  completions.create = async (...args: Parameters<typeof origCreate>) => {
    await startGate.waitForStart(args[1]?.signal ?? undefined);
    return origCreate(...args);
  };
  const chat = Object.create(client.chat);
  chat.completions = completions;
  wrapped.chat = chat;
  return wrapped as OpenAI;
}

function getReplit(): OpenAI {
  if (!clientCache.has("replit")) {
    clientCache.set("replit", new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    }));
  }
  return wrapClientWithParamAdaptation(clientCache.get("replit")!);
}

const SUBSCRIPTION_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
};

function getSubscriptionClient(provider: string, token: string): OpenAI {
  // R94 SECURITY — cache by SHA256(full token) instead of last-8-chars suffix
  // to eliminate cross-tenant client/token confusion via suffix collision.
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex").slice(0, 32);
  const cacheKey = `sub-${provider}-${tokenHash}`;
  if (!clientCache.has(cacheKey)) {
    clientCache.set(cacheKey, new OpenAI({
      apiKey: token,
      baseURL: SUBSCRIPTION_BASE_URLS[provider] || PROVIDER_CONFIG[provider]?.baseUrl,
    }));
  }
  return wrapClientWithParamAdaptation(clientCache.get(cacheKey)!);
}

configureProviderRecovery({
  resolveClientForModel: getClientForModel,
  getSubscriptionClient,
  supportsSubscription: (provider) => !!SUBSCRIPTION_BASE_URLS[provider],
});

export const LEGACY_MODEL_ALIASES: Record<string, string> = {
  "gpt-4o-mini": "gpt-5-mini",
  "gpt-4o": "gpt-5.4",
  "gpt-4": "gpt-5",
  "gpt-4-turbo": "gpt-5",
  "gpt-4.1": "gpt-5", // Task 72 — app upgraded off gpt-4.1; any straggler (stored defaultModel etc.) lands on gpt-5
  "claude-3-opus": "claude-opus-4-5",
  "claude-3-sonnet": "claude-sonnet-4-5",
  "claude-3-haiku": "gpt-5-mini",
  "gemini-pro": "gemini-3-flash-preview",
  "gemini-1.5-pro": "gemini-3-flash-preview",
};

/**
 * Normalize a (possibly legacy/persisted) model id to its current canonical
 * registry id. Task 72: conversations/settings persisted before the gpt-4.1 →
 * gpt-5 upgrade still carry "gpt-4.1"; request paths that hard-validate against
 * MODEL_REGISTRY must run this BEFORE the registry lookup or those rows fail
 * with "Unknown model" even though getClientForModel would have aliased them.
 */
export function normalizeModelId(modelId: string): string {
  return LEGACY_MODEL_ALIASES[modelId] || modelId;
}

function tryClaudeRunnerLane(
  modelId: string,
  tenantId: number | undefined,
  requiresTools: boolean | undefined,
): { client: OpenAI; actualModelId: string } | null {
  if (requiresTools || !isClaudeRunnerAvailable()) return null;
  const cacheKey = "claude-runner-bridge";
  if (!clientCache.has(cacheKey)) {
    clientCache.set(cacheKey, new OpenAI({
      apiKey: "claude-runner-local",
      baseURL: getClaudeRunnerBaseUrl(),
    }));
  }
  const costTenant = typeof tenantId === "number" && tenantId > 0 ? tenantId : ADMIN_TENANT_ID_FALLBACK;
  console.log(`[providers] Routing ${modelId} through Claude Runner bridge (subscription lane, $0 marginal)`);
  return {
    client: wrapClientWithCostTracking(
      wrapClaudeRunnerPacing(wrapClientWithParamAdaptation(clientCache.get(cacheKey)!)),
      modelId,
      costTenant,
      "llm.claude-runner",
    ),
    actualModelId: modelId,
  };
}

export function wrapOpenRouterFailureMarking(client: OpenAI): OpenAI {
  const wrapped = Object.create(client);
  const completions = Object.create(client.chat.completions);
  const origCreate = client.chat.completions.create.bind(client.chat.completions);
  completions.create = (async (...args: Parameters<typeof origCreate>) => {
    try {
      return await origCreate(...args);
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      const errorName = String(err?.name || "");
      const errorCode = String(err?.code || "");
      const isTransportFailure =
        status == null &&
        (
          errorName === "APIConnectionError" ||
          errorName === "APIConnectionTimeoutError" ||
          ["ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "ETIMEDOUT"].includes(errorCode)
        );
      if (
        status === 401 ||
        status === 403 ||
        status === 429 ||
        (status >= 500 && status <= 599) ||
        isTransportFailure
      ) {
        const failureIdentity = status ?? (errorCode || errorName || "transport");
        markProviderUnhealthy("openrouter", `HTTP ${failureIdentity}: ${String(err?.message || "").slice(0, 60)}`);
      }
      throw err;
    }
  }) as typeof origCreate;
  const chat = Object.create(client.chat);
  chat.completions = completions;
  wrapped.chat = chat;
  return wrapped as OpenAI;
}

function tryPinnedOpenRouterLane(
  modelId: string,
  tenantId: number | undefined,
): { client: OpenAI; actualModelId: string } | null {
  if (!isProviderHealthy("openrouter")) return null;
  const key = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!key.startsWith("sk-or-")) return null;
  const costTenant = typeof tenantId === "number" && tenantId > 0
    ? tenantId
    : ADMIN_TENANT_ID_FALLBACK;
  console.log(`[providers] Routing ${modelId} → OpenRouter metered recovery lane (health-aware provider fallback enabled)`);
  return {
    client: wrapClientWithCostTracking(
      wrapOpenRouterFailureMarking(getUserClient("openrouter", key)),
      modelId,
      costTenant,
      "llm.openrouter",
    ),
    actualModelId: modelId,
  };
}

function tryPinnedAnthropicApiLane(
  modelId: string,
  tenantId: number | undefined,
): { client: OpenAI; actualModelId: string } | null {
  if (!isProviderHealthy("anthropic-api")) return null;
  const configuredDirectKey = process.env.ANTHROPIC_API_TOKEN ?? process.env.ANTHROPIC_API_KEY;
  const directKey = (configuredDirectKey || "").trim();
  if (configuredDirectKey !== undefined && !directKey.startsWith("sk-ant-")) return null;
  const anthropicClient = directKey
    ? getUserClient("anthropic", directKey)
    : getIntegrationClient("anthropic");
  if (!anthropicClient) return null;
  const costTenant = typeof tenantId === "number" && tenantId > 0
    ? tenantId
    : ADMIN_TENANT_ID_FALLBACK;
  console.log(`[providers] Routing ${modelId} → Anthropic API jury lane (owner-funded metered key)`);
  return {
    client: wrapClientWithCostTracking(
      wrapAnthropicApiFailureMarking(anthropicClient),
      modelId,
      costTenant,
      "llm.anthropic:jury",
    ),
    actualModelId: modelId,
  };
}

function wrapAnthropicApiFailureMarking(client: OpenAI): OpenAI {
  const wrapped = Object.create(client);
  const completions = Object.create(client.chat.completions);
  const origCreate = client.chat.completions.create.bind(client.chat.completions);
  completions.create = (async (...args: Parameters<typeof origCreate>) => {
    try {
      return await origCreate(...args);
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if (!status || status === 401 || status === 403 || status === 429 || (status >= 500 && status <= 599)) {
        markProviderUnhealthy("anthropic-api", `HTTP ${status || "transport"}: ${String(err?.message || "").slice(0, 60)}`);
      }
      throw err;
    }
  }) as typeof origCreate;
  const chat = Object.create(client.chat);
  chat.completions = completions;
  wrapped.chat = chat;
  return wrapped as OpenAI;
}

async function getPinnedProviderLane(
  lane: ProviderLane,
  modelId: string,
  model: ModelInfo | undefined,
  tenantId: number | undefined,
  requiresTools: boolean | undefined,
  meteredOverride: boolean | undefined,
): Promise<{ client: OpenAI; actualModelId: string }> {
  if (lane === "zai" || lane === "openrouter" || lane === "anthropic-api") {
    if (tenantId !== ADMIN_TENANT_ID_FALLBACK) {
      throw new Error(`[providers] owner-only metered jury lane "${lane}" denied for tenant ${tenantId ?? "unknown"}`);
    }
    if (meteredOverride !== true) {
      throw new Error(`[providers] pinned provider lane "${lane}" requires the owner metered override`);
    }
    const { ownerJuryMeteredEnabled } = await import("./agentic/cost-ledger");
    if (!ownerJuryMeteredEnabled()) {
      throw new Error(`[providers] owner jury metered recovery is disabled for pinned lane "${lane}"`);
    }
  }
  switch (lane) {
    case "openference": {
      if (!providerLaneCanServeModel(lane, modelId)) {
        throw new Error(`[providers] pinned provider lane "openference" cannot serve model "${modelId}"`);
      }
      const resolved = tryOpenferenceLane(modelId, tenantId);
      if (!resolved) throw new Error(`[providers] pinned provider lane "openference" is unavailable for "${modelId}"`);
      return resolved;
    }
    case "profundo": {
      if (!providerLaneCanServeModel(lane, modelId)) {
        throw new Error(`[providers] pinned provider lane "profundo" cannot serve model "${modelId}"`);
      }
      const resolved = tryProfundoLane(modelId, tenantId);
      if (!resolved) throw new Error(`[providers] pinned provider lane "profundo" is unavailable for "${modelId}"`);
      return resolved;
    }
    case "claude-runner": {
      if (!providerLaneCanServeModel(lane, modelId) || model?.provider !== "anthropic") {
        throw new Error(`[providers] pinned provider lane "claude-runner" cannot serve model "${modelId}"`);
      }
      if (requiresTools) {
        throw new Error(`[providers] pinned provider lane "claude-runner" cannot serve tool-enabled requests`);
      }
      const resolved = tryClaudeRunnerLane(modelId, tenantId, requiresTools);
      if (!resolved) throw new Error(`[providers] pinned provider lane "claude-runner" is unavailable for "${modelId}"`);
      return resolved;
    }
    case "anthropic-api": {
      if (!providerLaneCanServeModel(lane, modelId) || model?.provider !== "anthropic") {
        throw new Error(`[providers] pinned provider lane "anthropic-api" cannot serve model "${modelId}"`);
      }
      const resolved = tryPinnedAnthropicApiLane(modelId, tenantId);
      if (!resolved) throw new Error(`[providers] pinned provider lane "anthropic-api" is unavailable for "${modelId}"`);
      return resolved;
    }
    case "zai": {
      if (!providerLaneCanServeModel(lane, modelId)) {
        throw new Error(`[providers] pinned provider lane "zai" cannot serve model "${modelId}"`);
      }
      const resolved = tryZaiLane(modelId, tenantId);
      if (!resolved) throw new Error(`[providers] pinned provider lane "zai" is unavailable for "${modelId}"`);
      return resolved;
    }
    case "openrouter": {
      if (!providerLaneCanServeModel(lane, modelId)) {
        throw new Error(`[providers] pinned provider lane "openrouter" cannot serve model "${modelId}"`);
      }
      const resolved = tryPinnedOpenRouterLane(modelId, tenantId);
      if (!resolved) throw new Error(`[providers] pinned provider lane "openrouter" is unavailable for "${modelId}"`);
      return resolved;
    }
  }
}

export async function getClientForModel(
  modelId: string,
  tenantId?: number,
  options?: {
    requiresTools?: boolean;
    juryLane?: boolean;
    costExemptLane?: boolean;
    meteredOverride?: boolean;
    providerLane?: ProviderLane;
    // Per-call deny floor for an unsupported Replit model. Applied after a
    // pinned flat lane but before any OAuth/API-key fallback, so a caller can
    // prove that global ALLOW_METERED_LLM cannot spend on its behalf.
    forbidMeteredFallback?: boolean;
  },
): Promise<{ client: OpenAI; actualModelId: string }> {
  if (LEGACY_MODEL_ALIASES[modelId]) {
    console.log(`[providers] Legacy model alias: "${modelId}" → "${LEGACY_MODEL_ALIASES[modelId]}"`);
    modelId = LEGACY_MODEL_ALIASES[modelId];
  }
  let model = MODEL_REGISTRY.find((m) => m.id === modelId);

  // Normalize provider-prefixed ids (e.g. "openai/gpt-4.1-mini",
  // "deepseek/deepseek-v3.2") to the canonical unprefixed registry id. Several
  // callers pass the OpenRouter-style "provider/model" form; the registry uses
  // unprefixed ids, so without this the lookup misses and the request silently
  // falls through the !model fallback ladder to the Anthropic default instead of
  // the intended (often cheaper) model. Only rewrites when the stripped id
  // actually exists in the registry, so genuine OpenRouter-only ids are untouched.
  if (!model && modelId.includes("/")) {
    const stripped = modelId.slice(modelId.indexOf("/") + 1);
    const canonical = MODEL_REGISTRY.find((m) => m.id === stripped);
    if (canonical) {
      console.log(`[providers] Normalized prefixed model id "${modelId}" → "${stripped}"`);
      modelId = stripped;
      model = canonical;
    }
  }

  // Strict lane pins are intentionally resolved before every generic fallback.
  // A frontier seat that asks for Profundo must fail as that seat when Profundo
  // is unavailable; silently landing on Openference or Replit would turn one
  // provider's fair-use event into misleading, non-independent jury evidence.
  if (options?.providerLane) {
    return await getPinnedProviderLane(
      options.providerLane,
      modelId,
      model,
      tenantId,
      options.requiresTools,
      options.meteredOverride,
    );
  }

  if (!model || model.provider === "replit") {
    // Profundo flat lane FIRST for replit-provider ids on the membership
    // (gpt-5.6-sol / gpt-5.6-luna / gpt-5.6-terra / gpt-5.5 / gpt-5.3-codex-spark):
    // these are either modelfarm-unsupported (would $0-downgrade to gpt-5.4) or
    // absent from mapReplitToOpenAI (would hit the UNKNOWN path). Profundo serves
    // the REAL model at $0 flat rate. gpt-5.4/gpt-5-mini/gpt-5 are NOT in the map,
    // so the native modelfarm lane below still handles them unchanged.
    // DELIBERATE ordering (Bob 2026-08-14): Profundo outranks the OAuth ChatGPT
    // subscription for these ids — both are flat-rate/$0-marginal, but Profundo
    // serves the EXACT requested variant (e.g. gpt-5.6-luna) while the OAuth lane
    // only serves the mapReplitToOpenAI-mapped id. When Profundo is unhealthy the
    // ladder below (OAuth sub → env key → $0 substitution) applies unchanged.
    {
      const profundo = tryProfundoLane(modelId, tenantId);
      if (profundo) return profundo;
    }
    const mapped = mapReplitToOpenAI(modelId);

    // Models that Replit's modelfarm hasn't onboarded yet (returns 404 at inference).
    // These still use the OAuth-provided OPENAI_API_KEY one rung down — same auth path,
    // just not through the modelfarm proxy. Remove from this set when modelfarm catches up.
    const REPLIT_MODELFARM_UNSUPPORTED = new Set([
      "gpt-5.5",
      "gpt-5.6-sol",
      // Profundo-only 5.6 variants + codex-spark (2026-08-14): modelfarm has never
      // onboarded these. Listing them here (paired with their truthy
      // mapReplitToOpenAI self-entries) makes an UNHEALTHY Profundo lane fall
      // deterministically into the $0 substitution below (→ supported gpt-5.4),
      // instead of leaking the raw id to modelfarm's likely-404 unknown path.
      "gpt-5.6-luna",
      "gpt-5.6-terra",
      "gpt-5.3-codex-spark",
    ]);

    const replitKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const replitBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    if (mapped && !REPLIT_MODELFARM_UNSUPPORTED.has(modelId) && replitKey && replitKey.length > 5 && replitBaseUrl && replitBaseUrl.length > 5) {
      const replitClient = getReplit();
      console.log(`[providers] Replit model ${modelId} → modelfarm integration (${mapped}, $0 cost)`);
      return { client: replitClient, actualModelId: mapped };
    }

    if (mapped && options?.forbidMeteredFallback) {
      throw new Error(
        `[providers] metered fallback forbidden for "${modelId}"; ` +
        `the requested model is unavailable on a flat/free lane`,
      );
    }

    // $0 policy (Bob 2026-06-16): reaching here with a KNOWN model (`mapped`
    // truthy) means it is in REPLIT_MODELFARM_UNSUPPORTED (e.g. gpt-5.5) — every
    // lane below is a METERED OpenAI/Anthropic key. Unless metered is explicitly
    // re-enabled (ALLOW_METERED_LLM=true) or this is the :flagship lane, hard-
    // substitute a SUPPORTED free modelfarm id and route through the proxy rather
    // than leaking to a paid key. Gated on `mapped` so a truly-unknown id still
    // falls to the loud UNKNOWN path below (don't mask a broken model id as gpt-5.4).
    // If the modelfarm proxy creds are absent there is no free lane, so this FAILS
    // CLOSED (throws) rather than leaking to a paid key — see below.
    if (mapped && !meteredLlmEnabled() && !options?.costExemptLane && !options?.meteredOverride) {
      const haveModelfarm = !!(
        replitKey &&
        replitKey.length > 5 &&
        replitBaseUrl &&
        replitBaseUrl.length > 5
      );
      const freeId =
        model?.tier === "fast" || model?.tier === "balanced" ? "gpt-5-mini" : "gpt-5.4";
      // Fail CLOSED: if the free modelfarm lane is unavailable, do NOT silently fall
      // through to a metered OpenAI/Anthropic key — that would defeat the explicit
      // $0 policy. meteredLlmEnabled()=false is a cost-safety guard, so it fails
      // closed (throw loudly) like the other cost/safety guards. Restore modelfarm
      // creds or set ALLOW_METERED_LLM=true to deliberately allow metered billing.
      if (!haveModelfarm) {
        throw new Error(
          `[providers] $0 policy fail-closed: "${modelId}" would fall through to a METERED ` +
            `OpenAI/Anthropic key, but the free modelfarm lane is unavailable ` +
            `(AI_INTEGRATIONS_OPENAI_API_KEY / AI_INTEGRATIONS_OPENAI_BASE_URL missing). ` +
            `Restore modelfarm creds or set ALLOW_METERED_LLM=true to allow metered billing.`,
        );
      }
      const mappedFree = mapReplitToOpenAI(freeId) || freeId;
      console.warn(
        `[providers] $0 policy: unsupported Replit model ${modelId} → free modelfarm ${freeId} ` +
          `(metered OpenAI/Anthropic lanes skipped). Set ALLOW_METERED_LLM=true to use the metered key.`,
      );
      return { client: getReplit(), actualModelId: mappedFree };
    }

    // Prefer Bob's ChatGPT subscription over the metered OpenAI key lanes below
    // (env key / tenant key / global DB key). Fails through to those when no
    // subscription is connected.
    if (mapped && preferOAuthSubscriptions()) {
      const subClient = await trySubscriptionAuth("openai", tenantId);
      if (subClient) {
        console.log(`[providers] Replit model ${modelId} → OpenAI subscription (preferred — flat-rate plan, not per-token API billing)`);
        return { client: subClient, actualModelId: mapped };
      }
    }

    const openaiEnvKey = process.env.OPENAI_API_KEY;
    if (mapped && openaiEnvKey && openaiEnvKey.length > 5) {
      console.log(`[providers] Replit model ${modelId} → OpenAI env key direct (${mapped})`);
      return { client: getUserClient("openai", openaiEnvKey), actualModelId: mapped };
    }

    const tenantKey = tenantId ? await storage.getTenantProviderKey(tenantId, "openai") : null;
    if (tenantKey?.api_key && mapped) {
      return { client: getUserClient("openai", decryptApiKey(tenantKey.api_key)), actualModelId: mapped };
    }
    const openaiUserKey = await storage.getProviderKey("openai");
    if (openaiUserKey && openaiUserKey.enabled && openaiUserKey.apiKey && mapped) {
      return { client: getUserClient("openai", decryptApiKey(openaiUserKey.apiKey)), actualModelId: mapped };
    }

    if (mapped) {
      const subClient = await trySubscriptionAuth("openai", tenantId);
      if (subClient) return { client: subClient, actualModelId: mapped };
    }

    // R125+52.33 SECURITY — the Anthropic last-resort fallbacks below are gated
    // on `mapped` (a real Replit→OpenAI mapping exists). Without this gate a
    // TRULY-UNKNOWN model id (typo / unregistered) — for which every `mapped`
    // OpenAI lane above is skipped — would silently land here and execute as
    // claude-sonnet-4 with the WRONG cost attribution. Gating on `mapped` keeps
    // the legit "real Replit model, all OpenAI lanes down → Anthropic" path
    // intact while routing unknown ids to the loud UNKNOWN-model warn path below.
    const anthropicIntegration = getIntegrationClient("anthropic");
    if (mapped && anthropicIntegration) {
      console.log(`[providers] Replit model ${modelId} → Anthropic integration fallback (claude-sonnet-4-5)`);
      return { client: anthropicIntegration, actualModelId: "claude-sonnet-4-5" };
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (mapped && anthropicKey && anthropicKey.length > 5) {
      console.log(`[providers] Replit model ${modelId} → Anthropic env key fallback (claude-sonnet-4-5)`);
      return { client: getUserClient("anthropic", anthropicKey), actualModelId: "claude-sonnet-4-5" };
    }

    const mappedFinal = mapReplitToOpenAI(modelId);
    if (!model && !mappedFinal) {
      // Truly-unknown model id (not in MODEL_REGISTRY, no Replit mapping) — do
      // NOT silently route it as the raw id; log loud so wrong-model/wrong-cost
      // routing is visible instead of a quiet 404 at inference.
      console.warn(`[providers] UNKNOWN model id "${modelId}" — no registry entry and no Replit mapping; falling back to modelfarm with raw id (likely 404). Check the caller's model id against MODEL_REGISTRY.`);
    }
    return { client: getReplit(), actualModelId: mappedFinal || modelId };
  }

  let actualModelId = modelId;
  if (modelId === "o4-mini-openai") actualModelId = "gpt-5-mini"; // legacy alias — o4-mini retired (Task 74)

  if (model.provider === "anthropic") {
    const claudeRunner = tryClaudeRunnerLane(modelId, tenantId, options?.requiresTools);
    if (claudeRunner) return claudeRunner;
    if (options?.requiresTools && isClaudeRunnerAvailable()) {
      console.log(`[providers] Skipping Claude Runner for ${modelId} (tools required — bridge doesn't support tool calls)`);
    }
  }

  // ── Profundo flat-rate lane (Bob 2026-08-08) ────────────────────────────────
  // Before the $0 substitution: if the requested model is on Bob's flat $20/mo
  // Profundo membership, serve it there at $0 marginal cost — full model quality
  // instead of the modelfarm downgrade. Supports tools via chat completions.
  {
    const profundo = tryProfundoLane(modelId, tenantId);
    if (profundo) return profundo;
  }

  {
    const openference = tryOpenferenceLane(modelId, tenantId);
    if (openference) return openference;
  }

  // ── $0-cost substitution (Bob 2026-06-16) ────────────────────────────────────
  // At this point `model` is a registry model with a real per-token-billed provider
  // (anthropic/google/openai/openrouter/xai/perplexity) — the "replit" modelfarm
  // models already returned above, and the flat-rate Claude Runner just returned if
  // available. Unless metered is explicitly re-enabled (ALLOW_METERED_LLM=true) or
  // this is the cost-exempt :flagship lane (weekly BWB recap), SUBSTITUTE
  // the free modelfarm OpenAI-family equivalent instead of falling through to the
  // metered key lanes below. Substitution (not refusal) keeps every caller working —
  // including the direct, hardcoded `getClientForModel("claude-opus-4-8")` callsites
  // that bypass tier/jury config and produced the untagged Jun-11/12 burst. Reverse
  // with ALLOW_METERED_LLM=true. See meteredLlmEnabled() for the full rationale.
  // NOTE: the jury lane (:jury) is intentionally NOT exempt — the platform defaults to
  // ensemble_query for "thinking", so leaving it metered would keep burning Claude on
  // every vote. The jury still runs, on the free modelfarm models pinned in
  // data/model-tiers.json. Only :flagship (once-weekly BWB recap, ≤3 Opus calls) stays
  // metered by default. Full metered restore: ALLOW_METERED_LLM=true (+ revert tiers).
  const costExemptCall = !!options?.costExemptLane;
  if (!meteredLlmEnabled() && !costExemptCall && !options?.meteredOverride) {
    const freeId =
      model.tier === "fast" || model.tier === "balanced" ? "gpt-5-mini" : "gpt-5.4";
    const mappedFree = mapReplitToOpenAI(freeId) || freeId;
    console.warn(
      `[providers] $0 policy: ${model.provider}/${modelId} (metered) → free modelfarm ${freeId}. ` +
        `Set ALLOW_METERED_LLM=true to use the metered ${model.provider} key.`,
    );
    return { client: getReplit(), actualModelId: mappedFree };
  }

  const ENV_KEY_FALLBACK: Record<string, string> = {
    openrouter: "OPENROUTER_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    xai: "XAI_API_KEY",
    perplexity: "PERPLEXITY_API_KEY",
  };
  const PROVIDER_KEY_PREFIXES: Record<string, string> = {
    openrouter: "sk-or-",
    openai: "sk-",
    anthropic: "sk-ant-",
  };

  // R64.C — cost-attribution tenant. If caller didn't pass tenantId we fall
  // back to ADMIN_TENANT_ID (1) but emit a stack-traced warning so we can
  // hunt the missing-context callsite. Never silent. Authn/authz still
  // happen earlier in storage.getTenantProviderKey — this is purely the
  // billing-attribution sentinel.
  const costTenant = (() => {
    if (typeof tenantId === "number" && tenantId > 0) return tenantId;
    console.warn(`[providers] missing tenantId for ${model.provider}/${modelId} cost attribution — falling back to ADMIN_TENANT_ID. Stack:\n${new Error().stack?.split("\n").slice(2, 6).join("\n")}`);
    return ADMIN_TENANT_ID_FALLBACK;
  })();

  // Cost-exempt lane markers (Bob 2026-06-12): tag the providerLabel so the
  // metered-Anthropic daily circuit breaker AND the spend tally both exempt the
  // two owner-blessed high-value Opus uses. Everyday metered Claude stays capped.
  //   • ":jury"     — the MoA multi-model decision vote (never block the vote).
  //   • ":flagship" — the once-weekly Built With Bob recap (bounded ≤3 Opus
  //                   calls/run; must never be killed mid-render). Threaded in
  //                   via runLlmTask({costExempt:true}) → resilientChatCompletion.
  const laneMarker = options?.juryLane ? ":jury" : options?.costExemptLane ? ":flagship" : "";
  const provLabel = `llm.${model.provider}${laneMarker}`;

  // Provider quarantine is a transport-level circuit breaker, not merely a
  // tier-selection hint. Enforce it before every credential path so direct
  // requests and selection-to-execution races cannot revive an unhealthy lane.
  if (!isProviderHealthy(model.provider)) {
    throw new Error(
      `${PROVIDER_CONFIG[model.provider]?.name || model.provider} is temporarily unavailable after repeated provider failures`,
    );
  }

  // Prefer Bob's flat-rate subscription over the metered key lanes below (tenant
  // key → global DB key → env key). In practice this activates only for providers
  // in SUBSCRIPTION_BASE_URLS (currently OpenAI/ChatGPT) — trySubscriptionAuth
  // returns null for any other provider or for a tenant without a connected
  // subscription, so it cleanly falls through to the metered lanes. Google is
  // intentionally NOT eligible (Gemini has no programmatic subscription; see the
  // note on preferOAuthSubscriptions). Anthropic/Claude uses the Claude Runner
  // bridge above, not this lane.
  if (preferOAuthSubscriptions()) {
    const preferredSub = await trySubscriptionAuth(model.provider, tenantId);
    if (preferredSub) {
      console.log(`[providers] ${model.provider}/${modelId} → OAuth subscription (preferred — flat-rate plan, not per-token API billing)`);
      return { client: wrapClientWithCostTracking(preferredSub, actualModelId, costTenant, provLabel), actualModelId };
    }
  }

  const tenantKey = tenantId ? await storage.getTenantProviderKey(tenantId, model.provider) : null;
  if (tenantKey?.api_key) {
    console.log(`[providers] ${model.provider}/${modelId} → tenant direct key (priority lane)`);
    const c = getUserClient(model.provider, decryptApiKey(tenantKey.api_key));
    return { client: wrapClientWithCostTracking(c, actualModelId, costTenant, provLabel), actualModelId };
  }

  const providerKey = await storage.getProviderKey(model.provider);
  const rawDbKey = providerKey?.enabled && providerKey?.apiKey ? providerKey.apiKey : null;
  const dbKey = rawDbKey ? decryptApiKey(rawDbKey) : null;

  const expectedPrefix = PROVIDER_KEY_PREFIXES[model.provider];
  const dbKeyValid = dbKey && (!expectedPrefix || dbKey.startsWith(expectedPrefix));

  if (dbKeyValid && dbKey) {
    console.log(`[providers] ${model.provider}/${modelId} → DB direct key (priority lane)`);
    const c = getUserClient(model.provider, dbKey);
    return { client: wrapClientWithCostTracking(c, actualModelId, costTenant, provLabel), actualModelId };
  }

  if (dbKey && !dbKeyValid) {
    console.warn(`[providers] DB key for ${model.provider} has invalid prefix (len=${dbKey.length}), skipping`);
  }

  const envVarName = ENV_KEY_FALLBACK[model.provider];
  const envKey = envVarName ? process.env[envVarName] : undefined;
  if (envKey && envKey.length > 5) {
    const envKeyValid = !expectedPrefix || envKey.startsWith(expectedPrefix);
    if (envKeyValid) {
      console.log(`[providers] ${model.provider}/${modelId} → env var ${envVarName} direct key`);
      const c = getUserClient(model.provider, envKey);
      return { client: wrapClientWithCostTracking(c, actualModelId, costTenant, provLabel), actualModelId };
    }
  }

  // Vertex AI express-mode lane (google provider only) — sits after the explicit
  // GOOGLE_API_KEY env lane and before the Replit-metered integration fallback,
  // so Bob's GCP-billed express key is preferred over Replit metering for Gemini.
  // NOTE: cost tracking records the BARE model id (pricing maps are keyed bare);
  // the returned actualModelId carries the "google/" prefix this endpoint requires.
  if (model.provider === "google") {
    const vertexClient = getVertexExpressClient();
    if (vertexClient) {
      const vertexModelId = actualModelId.startsWith("google/") ? actualModelId : `google/${actualModelId}`;
      console.log(`[providers] google/${modelId} → Vertex AI express key (GCP-billed lane)`);
      return { client: wrapClientWithCostTracking(vertexClient, actualModelId, costTenant, provLabel), actualModelId: vertexModelId };
    }
  }

  const subClient = await trySubscriptionAuth(model.provider, tenantId);
  if (subClient) {
    console.log(`[providers] ${model.provider}/${modelId} → Replit subscription (fallback lane)`);
    return { client: wrapClientWithCostTracking(subClient, actualModelId, costTenant, provLabel), actualModelId };
  }

  const fallbackClient = getIntegrationClient(model.provider);
  if (fallbackClient) {
    return { client: wrapClientWithCostTracking(fallbackClient, actualModelId, costTenant, provLabel), actualModelId };
  }

  throw new Error(`No API key configured for ${PROVIDER_CONFIG[model.provider]?.name || model.provider}. Add it in Settings > API Keys.`);
}

export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return "****";
  const prefix = key.slice(0, Math.min(key.indexOf("-") + 1 || 3, 6));
  const suffix = key.slice(-4);
  return `${prefix}...${suffix}`;
}

function mapReplitToOpenAI(modelId: string): string | null {
  const map: Record<string, string> = {
    "gpt-5.6-sol": "gpt-5.6-sol",
    // Truthy entries ONLY so the $0-policy substitution (gated on `mapped`) can
    // catch these when Profundo is down — REPLIT_MODELFARM_UNSUPPORTED blocks the
    // direct modelfarm return, so these values are never sent to modelfarm.
    "gpt-5.6-luna": "gpt-5.6-luna",
    "gpt-5.6-terra": "gpt-5.6-terra",
    "gpt-5.3-codex-spark": "gpt-5.3-codex-spark",
    "gpt-5.5": "gpt-5.5",
    "gpt-5.4": "gpt-5.4",
    "gpt-5-mini": "gpt-5-mini",
    "gpt-5": "gpt-5", // Task 72 — modelfarm serves gpt-5 (verified live 2026-07-27, resolves to gpt-5-2025-08-07)
    "o4-mini": "gpt-5-mini", // legacy alias — o4-mini retired (Task 74)
  };
  return map[modelId] || null;
}

function getUserClient(provider: string, apiKey: string): OpenAI {
  const cleanKey = apiKey.replace(/[^\x20-\x7E]/g, (ch) => {
    const c = ch.charCodeAt(0);
    if (c === 0x2014 || c === 0x2013) return "-";
    return "";
  });
  // R94 SECURITY — cache by SHA256(full key) instead of last-8-chars suffix
  // (suffix collision could route tenant A's request through tenant B's client).
  const keyHash = crypto.createHash("sha256").update(cleanKey).digest("hex").slice(0, 32);
  const cacheKey = `${provider}-${keyHash}`;
  if (!clientCache.has(cacheKey)) {
    const baseUrl = PROVIDER_CONFIG[provider].baseUrl;
    const opts: any = { apiKey: cleanKey, baseURL: baseUrl };
    if (provider === "openrouter") {
      opts.defaultHeaders = {
        "HTTP-Referer": process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` : (process.env.PRODUCTION_DOMAIN ? `https://${process.env.PRODUCTION_DOMAIN}` : "https://localhost:5000"),
        "X-Title": "VisionClaw Agent",
      };
    }
    clientCache.set(cacheKey, new OpenAI(opts));
  }
  return wrapClientWithParamAdaptation(clientCache.get(cacheKey)!);
}

// R125+137.92 — Google Vertex AI express-mode lane. Bob's GCP key (GOOGLE_CLOUD_API_KEY)
// is a Vertex express key: it is REJECTED by generativelanguage.googleapis.com (403 blocked)
// and by Bearer auth, but works against the aiplatform OpenAI-compatibility endpoint when
// sent as the x-goog-api-key header. Model ids on this endpoint need a "google/" prefix.
// Bills to Bob's GCP project — reachable only through the metered google lanes (the $0
// policy short-circuits to free modelfarm long before this, unchanged).
function getVertexExpressClient(): OpenAI | null {
  const key = process.env.GOOGLE_CLOUD_API_KEY;
  const project = process.env.GOOGLE_CLOUD_PROJECT_NUMBER;
  if (!key || key.length < 20 || !project || !/^\d+$/.test(project)) return null;
  const cacheKey = "vertex-express";
  if (!clientCache.has(cacheKey)) {
    clientCache.set(cacheKey, new OpenAI({
      apiKey: "unused-vertex-express-auth-is-header", // real auth is x-goog-api-key
      baseURL: `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/endpoints/openapi`,
      // Authorization: null strips the SDK's Bearer header — Google 401s any request
      // carrying an invalid Bearer even when a valid x-goog-api-key is present.
      defaultHeaders: { "x-goog-api-key": key, Authorization: null as unknown as string },
    }));
  }
  return wrapClientWithParamAdaptation(clientCache.get(cacheKey)!);
}

export function clearClientCache() {
  clientCache.delete("replit");
  for (const key of clientCache.keys()) {
    if (key !== "replit") clientCache.delete(key);
  }
}

// .unref() so this housekeeping timer never holds the event loop open — a bare
// interval here made every node:test suite that transitively imports providers
// hang at exit (60s timeout → exit 124 under tests/run.sh).
setInterval(() => {
  const platformKeys = new Set(["replit", "openai", "anthropic", "google", "xai", "openrouter", "perplexity"]);
  let pruned = 0;
  for (const key of clientCache.keys()) {
    if (!platformKeys.has(key) && !key.startsWith("openference-")) {
      clientCache.delete(key);
      pruned++;
    }
  }
  if (pruned > 0) console.log(`[providers] Pruned ${pruned} cached tenant clients`);
}, 60 * 60 * 1000).unref();

const _lastAutoRouteLog = new Map<string, { model: string; ts: number }>();
const AUTO_ROUTE_LOG_TTL = 60_000;

function logAutoRoute(tier: string, model: string, via: string) {
  const last = _lastAutoRouteLog.get(tier);
  if (last && last.model === model && Date.now() - last.ts < AUTO_ROUTE_LOG_TTL) return;
  _lastAutoRouteLog.set(tier, { model, ts: Date.now() });
  console.log(`[auto-route] ${tier} → ${model} via ${via}`);
}

export async function getModelForTierAsync(
  tier: "fast" | "balanced" | "powerful" | "reasoning",
  tenantId?: number,
  options?: { freeTierOnly?: boolean },
): Promise<string> {
  const freeTierOnly = options?.freeTierOnly ?? (process.env.BACKGROUND_FREE_TIER_ONLY === "true");
  // Flat subscription lanes count as free for routing purposes, matching the
  // existing Openference behavior in the freeTierOnly branch below.
  const preferredProfundoByTier: Partial<Record<typeof tier, string>> = {
    fast: "z-ai/glm-4.7-flash",
    powerful: "gpt-5.6-luna",
    reasoning: "xiaomi/mimo-v2.5-pro",
  } as const;
  const preferredProfundo = preferredProfundoByTier[tier];
  if (
    preferredProfundo &&
    getProfundoKey() &&
    isProviderHealthy("profundo") &&
    providerLaneCanServeModel("profundo", preferredProfundo)
  ) {
    logAutoRoute(tier, preferredProfundo, "Profundo flat-rate plan ($0 marginal)");
    return preferredProfundo;
  }
  const keys = await storage.getProviderKeys();
  const enabled = new Set(keys.filter((k) => k.enabled && k.apiKey).map((k) => k.provider));
  if (hasOpenferenceKey()) enabled.add("openference");

  const subscriptionProviders = new Set<string>();
  if (tenantId) {
    for (const provider of Object.keys(SUBSCRIPTION_BASE_URLS)) {
      try {
        const token = await getSubscriptionAccessToken(provider, tenantId);
        if (token) subscriptionProviders.add(provider);
      } catch (_silentErr) { logSilentCatch("server/providers.ts", _silentErr); }
    }
  }

  const tierModels: Record<string, { provider: string; model: string }[]> = {
    // R81 — promoted by hard-bench (5 reasoning tasks): llama-4-maverick 25/25 @ 145 tok,
    // ling-2.6-flash 21/25 @ 173 tok, ling-2.6-1t:free 22/25 @ 171 tok. Order = quality-then-efficiency.
    fast: [
      { provider: "openrouter", model: "meta-llama/llama-4-maverick" },     // 25/25 hard, 145 tok — winner
      { provider: "openrouter", model: "inclusionai/ling-2.6-flash" },      // 21/25 hard, 173 tok — execution-first
      { provider: "openrouter", model: "inclusionai/ling-2.6-1t:free" },    // 22/25 hard, 171 tok — FREE
      { provider: "google", model: "gemini-2.5-flash" },                    // 23/25 hard, 202 tok
      { provider: "google", model: "gemini-3-flash-preview" },
      { provider: "openai", model: "gpt-5-mini" },
      { provider: "replit", model: "gpt-5-mini" },
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      { provider: "openrouter", model: "z-ai/glm-4.7-flash" },
      { provider: "openrouter", model: "xiaomi/mimo-v2-flash" },
      { provider: "openrouter", model: "google/gemma-4-31b-it" },
    ],
    balanced: [
      { provider: "openrouter", model: "meta-llama/llama-4-maverick" },     // 25/25 hard, 145 tok
      { provider: "openrouter", model: "inclusionai/ling-2.6-1t:free" },    // 22/25 hard, 171 tok — FREE
      { provider: "openrouter", model: "inclusionai/ling-2.6-flash" },      // 21/25 hard, 173 tok
      { provider: "google", model: "gemini-2.5-flash" },                    // 23/25 hard, 202 tok
      { provider: "google", model: "gemini-3-flash-preview" },
      { provider: "replit", model: "gpt-5.4" },
      { provider: "replit", model: "gpt-5" },
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      { provider: "openrouter", model: "xiaomi/mimo-v2-flash" },
      { provider: "openrouter", model: "google/gemma-4-31b-it" },
      { provider: "openrouter", model: "z-ai/glm-4.5-air:free" },
    ],
    // Cost policy (Bob 2026-06-12): the everyday powerful/reasoning tiers no longer
    // list any Anthropic model. Claude is metered-only for tool-bearing calls (the
    // flat-rate runner bridge can't carry tools) so it's reserved for the high-value
    // jury (server/moa.ts) — NOT the everyday workhorse. Free Gemini + OpenAI(-sub)
    // lanes lead; OpenRouter lanes backstop. Restore CLAUDE_CODE_OAUTH_TOKEN to make
    // the jury's (toolless) Claude calls bill the Max plan instead of the metered key.
    powerful: [
      { provider: "openference", model: "openference/deepseek-v4-pro" },
      { provider: "openference", model: "openference/kimi-k3" },
      { provider: "openference", model: "openference/glm-5.3" },
      { provider: "openference", model: "openference/qwen3.8-27b" },
      { provider: "google", model: "gemini-3.5-flash" },
      { provider: "google", model: "gemini-3.1-pro-preview" },
      { provider: "google", model: "gemini-3-pro-preview" },
      { provider: "replit", model: "gpt-5.4" },
      { provider: "replit", model: "gpt-5" },
      // Preferred paid OpenRouter fallback: strong agent/tool model at
      // $0.085/M input + $0.40/M output (live rate verified 2026-09-03).
      { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b" },
      { provider: "openrouter", model: "z-ai/glm-5.2" },  // OpenRouter default GLM (Bob 2026-06-23) — top-tier flagship
      { provider: "openrouter", model: "x-ai/grok-4.20-multi-agent" },  // R81 — top-tier multi-agent orchestration workhorse
      { provider: "openrouter", model: "moonshotai/kimi-k2.6" },
      { provider: "openrouter", model: "deepseek/deepseek-v3.2" },
      { provider: "openrouter", model: "xiaomi/mimo-v2-omni" },
      { provider: "openrouter", model: "z-ai/glm-5" },
      { provider: "openrouter", model: "z-ai/glm-5.1" },
      { provider: "openrouter", model: "meta-llama/llama-4-maverick" },
    ],
    reasoning: [
      { provider: "openference", model: "openference/deepseek-v4-pro" },
      { provider: "openference", model: "openference/glm-5.3" },
      { provider: "openference", model: "openference/kimi-k3" },
      { provider: "google", model: "gemini-3.5-flash" },
      { provider: "google", model: "gemini-3.1-pro-preview" },
      { provider: "replit", model: "gpt-5-mini" },
      { provider: "replit", model: "gpt-5.4" },
      { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b" },
      { provider: "openrouter", model: "z-ai/glm-5.2" },
      { provider: "openrouter", model: "deepseek/deepseek-r1" },
      { provider: "openrouter", model: "deepseek/deepseek-v3.2" },
      { provider: "openrouter", model: "z-ai/glm-5.1" },
    ],
  };

  const candidates = tierModels[tier] || tierModels.balanced;

  for (const c of candidates) {
    if (c.provider === "anthropic" && isClaudeRunnerAvailable()) {
      logAutoRoute(tier, c.model, "Claude Runner (OAuth — plan quota)");
      return c.model;
    }
    if (subscriptionProviders.has(c.provider) && isProviderHealthy(c.provider)) {
      logAutoRoute(tier, c.model, `${c.provider} OAuth subscription`);
      return c.model;
    }
    if (c.provider === "replit") {
      const mapped = mapReplitToOpenAI(c.model);
      if (mapped && subscriptionProviders.has("openai") && isProviderHealthy("openai")) {
        logAutoRoute(tier, c.model, "replit→openai OAuth");
        return c.model;
      }
    }
  }

  if (freeTierOnly) {
    for (const c of candidates) {
      if (c.provider === "replit") {
        logAutoRoute(tier, c.model, "replit modelfarm (free-tier-only mode — no paid lane)");
        return c.model;
      }
      if (hasIntegrationFallback(c.provider) && isProviderHealthy(c.provider)) {
        logAutoRoute(tier, c.model, `${c.provider} integration (free-tier-only mode)`);
        return c.model;
      }
      if (c.provider === "openference" && hasOpenferenceKey() && isProviderHealthy("openference")) {
        logAutoRoute(tier, c.model, "Openference Auto Agent flat-rate plan (free-tier-only mode)");
        return c.model;
      }
    }
    console.warn(`[auto-route] BACKGROUND_FREE_TIER_ONLY=true and no free lane available for tier=${tier}. Falling back to gpt-5-mini (Replit modelfarm) instead of paid API.`);
    return "gpt-5-mini";
  }

  for (const c of candidates) {
    if (c.provider === "anthropic") {
      if (isClaudeRunnerAvailable()) {
        logAutoRoute(tier, c.model, "Claude Runner (fallback)");
        return c.model;
      }
      // Cost policy (Bob 2026-06-12): the tier resolver must NEVER fall back to the
      // metered Anthropic API key. Claude is flat-rate (runner) or jury-only — never
      // the everyday metered workhorse. Skip and let a free/sub lane win.
      continue;
    }
    // An enabled key is not sufficient: repeated auth/rate-limit/transport
    // failures quarantine the provider temporarily so tier routing can advance
    // to a healthy fallback instead of repeatedly selecting a known-bad lane.
    if (enabled.has(c.provider) && isProviderHealthy(c.provider)) {
      logAutoRoute(tier, c.model, `${c.provider} direct key (fallback — PAID API)`);
      return c.model;
    }
    if (hasIntegrationFallback(c.provider) && isProviderHealthy(c.provider)) {
      logAutoRoute(tier, c.model, `${c.provider} integration (fallback)`);
      return c.model;
    }
  }
  for (const c of candidates) {
    if (c.provider === "replit") {
      logAutoRoute(tier, c.model, "replit proxy (last resort)");
      return c.model;
    }
  }
  logAutoRoute(tier, candidates[candidates.length - 1].model, "no provider matched");
  return candidates[candidates.length - 1].model;
}

export function getModelForTier(tier: "fast" | "balanced" | "powerful" | "reasoning"): string {
  // Cost policy (Bob 2026-06-14): cheap/autonomous tiers run on the FREE modelfarm
  // lane (gemini-2.5-flash); only the heavier tiers use metered gemini-3.5-flash.
  // gemini-3.5-flash is NOT on the free Replit modelfarm lane — it bills the metered
  // Google API key (~$0.12/call), so reserve it for genuinely complex work.
  const tierMap: Record<string, string> = {
    fast: "gemini-2.5-flash",
    balanced: "gemini-2.5-flash",
    powerful: hasOpenferenceKey() ? "openference/deepseek-v4-pro" : "gemini-3.5-flash",
    reasoning: hasOpenferenceKey() ? "openference/glm-5.3" : "gemini-3.5-flash",
  };
  return tierMap[tier] || "gemini-2.5-flash";
}

export async function getAvailableModels(): Promise<ModelInfo[]> {
  const keys = await storage.getProviderKeys();
  const enabledProviders = new Set(keys.filter((k) => k.enabled).map((k) => k.provider));
  enabledProviders.add("replit");
  if (hasOpenferenceKey()) enabledProviders.add("openference");
  for (const provider of Object.keys(INTEGRATION_ENV)) {
    if (hasIntegrationFallback(provider)) {
      enabledProviders.add(provider);
    }
  }
  return MODEL_REGISTRY.filter((m) => enabledProviders.has(m.provider));
}

export async function getAvailableModelsForTenant(tenantId: number, isAdmin: boolean): Promise<ModelInfo[]> {
  const keys = await storage.getProviderKeys();
  const userKeyProviders = new Set(keys.filter((k) => k.enabled).map((k) => k.provider));

  const enabledProviders = new Set<string>();
  if (hasOpenferenceKey()) enabledProviders.add("openference");

  if (isAdmin) {
    for (const p of userKeyProviders) enabledProviders.add(p);
    enabledProviders.add("replit");
    for (const provider of Object.keys(INTEGRATION_ENV)) {
      if (hasIntegrationFallback(provider)) {
        enabledProviders.add(provider);
      }
    }
  } else {
    enabledProviders.add("openrouter");
    for (const provider of userKeyProviders) {
      enabledProviders.add(provider);
    }
  }

  for (const provider of Object.keys(SUBSCRIPTION_BASE_URLS)) {
    try {
      const token = await getSubscriptionAccessToken(provider, tenantId);
      if (token) enabledProviders.add(provider);
    } catch (_silentErr) { logSilentCatch("server/providers.ts", _silentErr); }
  }

  const models = MODEL_REGISTRY.filter((m) => enabledProviders.has(m.provider));
  if (!models.find(m => m.id === "auto")) {
    const auto = MODEL_REGISTRY.find(m => m.id === "auto");
    if (auto) models.unshift(auto);
  }
  return models;
}

/**
 * Round 35 — Single metered OpenAI client factory.
 *
 * Code review (Round 34/35) found ~6 sites that constructed raw
 * `new OpenAI(...)` clients and so escaped the Round 30/31
 * `replitOpenai` chat-completions monkey-patch entirely:
 *   - server/auto-qa.ts (chat)
 *   - server/embeddings.ts (embeddings)
 *   - server/voice.ts (TTS, STT)
 *   - server/tools.ts generate_audio (TTS, primary + fallback)
 *
 * This factory wraps a fresh client's chat / embeddings / audio APIs
 * with `recordCost` calls so every endpoint shows up in the cost
 * ledger. Each wrapper is best-effort — cost-track failures must
 * never break the underlying call.
 *
 * Pricing for embeddings + audio lives in `agentic/cost-ledger.ts`
 * MODEL_COST_PER_1K (Round 35 entries). For TTS we record the input
 * character count in the `tokensOut` column — the cost-ledger formula
 * `(tokensOut * pricing.out) / 1000` then yields correct $ for the
 * gpt-4o-mini-tts and tts-1/-hd entries.
 */
export function createMeteredOpenAIClient(opts: {
  apiKey: string;
  baseURL?: string;
  providerLabel: string;
  tenantId?: number;
}): OpenAI {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
  });
  // R94 SECURITY — tenant resolution priority:
  //   1) explicit opts.tenantId (caller passed it deliberately)
  //   2) AsyncLocalStorage context (set by auth middleware / job worker)
  //   3) ADMIN_TENANT_ID_FALLBACK (warn-once; truly contextless system call)
  // This means voice.ts/embeddings.ts/etc. callsites that don't pass tenantId
  // still get correct attribution as long as they run inside an authenticated
  // request — no per-callsite plumbing needed.
  const explicitTenantId = opts.tenantId;
  const label = opts.providerLabel;
  const meteredWarned = new Set<string>();

  const resolveTenant = (): number => {
    if (typeof explicitTenantId === "number") return explicitTenantId;
    try {
      const tid = currentTenantId();
      if (typeof tid === "number") return tid;
    } catch (_silentErr) { logSilentCatch("server/providers.ts", _silentErr); }
    if (!meteredWarned.has(label)) {
      meteredWarned.add(label);
      console.warn(`[providers] ${label} called without tenant context — billing ADMIN`);
    }
    return ADMIN_TENANT_ID_FALLBACK;
  };

  // chat.completions.create — reuse the existing patcher (handles
  // streaming + non-streaming + auto-injects stream_options.include_usage)
  const origChatCreate = client.chat.completions.create.bind(client.chat.completions);
  (client.chat.completions as any).create = buildPatchedCreate(
    origChatCreate,
    (params: any) => params?.model || "unknown",
    resolveTenant,
    label,
  );

  // embeddings.create — record prompt_tokens via recordCost
  if (client.embeddings && typeof client.embeddings.create === "function") {
    const origEmbeddings = client.embeddings.create.bind(client.embeddings);
    (client.embeddings as any).create = async function patchedEmbeddings(params: any, options?: any) {
      const result: any = await origEmbeddings(params, options);
      try {
        const tokensIn = result?.usage?.prompt_tokens || result?.usage?.total_tokens || 0;
        if (tokensIn) {
          const { recordCost } = await import("./agentic/cost-ledger");
          await recordCost({
            tenantId: resolveTenant(),
            toolName: label,
            model: params?.model,
            tokensIn,
            tokensOut: 0,
            operation: "embeddings.create",
          });
        }
      } catch (e: any) {
        console.warn(`[providers] cost-track failed (${label}.embeddings): ${e?.message}`);
      }
      return result;
    };
  }

  // audio.speech.create (TTS) — bill input character count as tokensOut
  if (client.audio?.speech && typeof client.audio.speech.create === "function") {
    const origSpeech = client.audio.speech.create.bind(client.audio.speech);
    (client.audio.speech as any).create = async function patchedSpeech(params: any, options?: any) {
      const result = await origSpeech(params, options);
      try {
        const chars = (params?.input || "").length;
        if (chars) {
          const { recordCost } = await import("./agentic/cost-ledger");
          await recordCost({
            tenantId: resolveTenant(),
            toolName: label,
            model: params?.model,
            tokensIn: 0,
            tokensOut: chars,
            operation: "audio.speech.create",
          });
        }
      } catch (e: any) {
        console.warn(`[providers] cost-track failed (${label}.tts): ${e?.message}`);
      }
      return result;
    };
  }

  // audio.transcriptions.create (STT/Whisper) — log a marker; precise
  // cost is duration-based and not always recoverable from the response.
  if (client.audio?.transcriptions && typeof client.audio.transcriptions.create === "function") {
    const origStt = client.audio.transcriptions.create.bind(client.audio.transcriptions);
    (client.audio.transcriptions as any).create = async function patchedStt(params: any, options?: any) {
      const result = await origStt(params, options);
      try {
        const { recordCost } = await import("./agentic/cost-ledger");
        await recordCost({
          tenantId: resolveTenant(),
          toolName: label,
          model: params?.model || "whisper-1",
          tokensIn: 0,
          tokensOut: 0,
          operation: "audio.transcriptions.create",
        });
      } catch (e: any) {
        console.warn(`[providers] cost-track failed (${label}.stt): ${e?.message}`);
      }
      return result;
    };
  }

  return client;
}
