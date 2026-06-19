import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { getSubscriptionAccessToken } from "./oauth-subscriptions";
import { decryptApiKey } from "./crypto";
import crypto from "crypto";
import { isClaudeRunnerAvailable, getClaudeRunnerBaseUrl } from "./claude-runner";
import { siteConfig } from "./site-config";

import { logSilentCatch } from "./lib/silent-catch";
import { wrapClientWithParamAdaptation } from "./lib/param-adaptation";
// R94 SECURITY — static import (tsx/ESM does NOT define `require`; the previous
// dynamic require() silently threw and made every cost lookup fall back to ADMIN).
import { currentTenantId } from "./lib/tenant-context";

// R64.C — sentinel for cost-attribution fallback ONLY. Authn/authz happens
// upstream via storage.getTenantProviderKey(tenantId, provider). This sentinel
// exists so missing-tenant-context bugs are loud (warn + stack) rather than
// silently misattributing cost to whoever happens to be tenant 1.
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
    const isAnthropic =
      providerLabel.toLowerCase().includes("anthropic") ||
      String(modelResolver(params) || "").toLowerCase().startsWith("claude");
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
          await recordCost({
            tenantId: tenantResolver(),
            toolName: providerLabel,
            model: modelResolver(params),
            tokensIn,
            tokensOut,
            cachedTokensIn,
            cacheWriteTokens,
            operation: "chat.completions.create",
          });
        }
      } catch (e: any) {
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

function wrapClientWithCostTracking(client: OpenAI, modelId: string, tenantId: number, providerLabel: string): OpenAI {
  const origCreate = client.chat.completions.create.bind(client.chat.completions);
  (client.chat.completions as any).create = buildPatchedCreate(
    origCreate,
    () => modelId,
    () => tenantId,
    providerLabel,
  );
  return client;
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

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  tier: "fast" | "balanced" | "powerful" | "reasoning";
  description: string;
  capabilities?: ("vision" | "audio" | "image_gen" | "video" | "code" | "tools")[];
  costClass?: "free" | "cheap" | "paid";
  // R77.5 (KisMATH arxiv 2507.11408v2): training regime drives the answer-distribution shape.
  // KisMATH fig. 7-9 shows RLVR-trained models collapse to "exponential" overconfident distributions
  // with narrow exploration (good for deterministic exploitation, bad for ensembling/exploration).
  // Distilled / SFT / base models keep "bell-shape" distributions with broader exploration —
  // ideal as ensemble proposers and as the "second look" judge.
  //   "rlvr"      = trained with RL on verifiable rewards (DeepSeek-R1, OpenAI o-series, Claude RLAIF)
  //   "distilled" = distilled from a frontier model (DeepSeek-V series MTP, Gemma, Kimi, Nemotron, GLM)
  //   "sft"       = standard supervised fine-tune only (no RLVR collapse)
  //   "base"      = base / minimally post-trained
  //   "unknown"   = no public docs on training regime
  trainingRegime?: "base" | "sft" | "rlvr" | "distilled" | "unknown";
}

export const MODEL_REGISTRY: ModelInfo[] = [
  { id: "auto", label: "Auto Select", provider: "replit", tier: "balanced", description: "Intelligently routes to the best model for each task", costClass: "free", trainingRegime: "unknown" },
  { id: "gpt-5.5", label: "GPT-5.5", provider: "replit", tier: "powerful", description: "Latest OpenAI flagship — newest reasoning + multimodal, accessed via Replit OAuth (free)", capabilities: ["vision", "audio", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "gpt-5.4", label: "GPT-5.4", provider: "replit", tier: "powerful", description: "Previous OpenAI flagship", capabilities: ["vision", "audio", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "gpt-5-mini", label: "GPT-5 Mini", provider: "replit", tier: "balanced", description: "Fast and cost-effective", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "o4-mini", label: "o4 Mini", provider: "replit", tier: "reasoning", description: "Reasoning/thinking model", capabilities: ["code", "tools"], costClass: "free", trainingRegime: "rlvr" },

  { id: "gpt-4.1", label: "GPT-4.1", provider: "openai", tier: "powerful", description: "Coding & instruction following", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", provider: "openai", tier: "balanced", description: "Balanced speed and intelligence", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "o4-mini-openai", label: "o4 Mini (OpenAI)", provider: "openai", tier: "reasoning", description: "OpenAI reasoning model", capabilities: ["code", "tools"], costClass: "free", trainingRegime: "rlvr" },

  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (Latest)", provider: "anthropic", tier: "powerful", description: "Latest Sonnet - best balanced model", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "claude-opus-4-20250514", label: "Claude Opus 4 (Latest)", provider: "anthropic", tier: "powerful", description: "Latest Opus - most capable reasoning and coding", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic", tier: "powerful", description: "Extended thinking, hybrid reasoning", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", provider: "anthropic", tier: "powerful", description: "Deep complex reasoning and coding", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", provider: "anthropic", tier: "powerful", description: "1M context, 128K output, hi-res vision, xhigh effort, adaptive thinking; +13% over 4.6 on coding bench (superseded as flagship by 4.8)", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic", tier: "powerful", description: "DEFAULT Anthropic flagship (Bob 2026-06-11) — 1M context, 128K output, hi-res vision, xhigh effort, adaptive thinking; supersedes Opus 4.7; covered by the Claude Runner flat-rate lane", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "claude-fable-5", label: "Claude Fable 5", provider: "anthropic", tier: "powerful", description: "LAST-RESORT fallback only (Bob 2026-06-11 — pulled from the default lineup: billed metered, no flat-rate lane, 3× ~$20/day). Top-tier reasoning + coding; 1M context, 128K output, extended/adaptive thinking, hi-res vision, code execution + citations + batch (verified live on api.anthropic.com)", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },

  // R81 — all xai-direct Grok entries retired. The whole Grok line consolidates to
  // a single openrouter entry: x-ai/grok-4.20-multi-agent (see below in OR block).

  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", provider: "google", tier: "powerful", description: "FLAGSHIP Google model (Google I/O 2026-05-19) — frontier intelligence + action, excels at long-horizon agentic tasks and coding; promoted to high-end tier in R125+3.7 pending Gemini 3.5 Pro release. METERED — NOT on the free Replit modelfarm lane; bills the Google API key (~$0.12/call). Reserve for complex work / the jury; cheap autonomous work uses gemini-2.5-flash.", capabilities: ["vision", "audio", "video", "code", "tools"], costClass: "paid", trainingRegime: "rlvr" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", provider: "google", tier: "powerful", description: "Most powerful - agentic workflows, multimodal, complex reasoning", capabilities: ["vision", "audio", "video", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro", provider: "google", tier: "powerful", description: "Powerful agentic model and vibe-coding", capabilities: ["vision", "audio", "video", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", provider: "google", tier: "balanced", description: "Hybrid reasoning, good for daily use and high-volume", capabilities: ["vision", "audio", "video", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google", tier: "balanced", description: "Fast and capable, great cost-to-quality ratio", capabilities: ["vision", "audio", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },

  { id: "sonar-pro", label: "Sonar Pro", provider: "perplexity", tier: "powerful", description: "Deep web research with citations", costClass: "paid", trainingRegime: "sft" },
  { id: "sonar", label: "Sonar", provider: "perplexity", tier: "balanced", description: "Fast web search with citations", costClass: "paid", trainingRegime: "sft" },
  { id: "sonar-reasoning-pro", label: "Sonar Reasoning Pro", provider: "perplexity", tier: "reasoning", description: "Multi-step research with reasoning", costClass: "paid", trainingRegime: "rlvr" },
  { id: "sonar-deep-research", label: "Sonar Deep Research", provider: "perplexity", tier: "powerful", description: "Exhaustive multi-source research", costClass: "paid", trainingRegime: "sft" },

  { id: "xiaomi/mimo-v2-flash", label: "MiMo V2 Flash", provider: "openrouter", tier: "balanced", description: "#1 open-source SWE-bench, 309B MoE (15B active), 256K ctx, hybrid thinking — $0.09/M in", capabilities: ["code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  { id: "xiaomi/mimo-v2-omni", label: "MiMo V2 Omni", provider: "openrouter", tier: "powerful", description: "Frontier omni-modal — image/video/audio input, visual grounding, agentic tool use — $0.40/M in", capabilities: ["vision", "audio", "video", "code", "tools"], costClass: "cheap", trainingRegime: "distilled" },

  { id: "x-ai/grok-4.20-multi-agent", label: "Grok 4.20 Multi-Agent", provider: "openrouter", tier: "powerful", description: "xAI flagship multi-agent orchestration — 2M ctx, purpose-built for parallel sub-agent coordination, $2/M in $6/M out — VisionClaw top-end workhorse for parallel project execution", capabilities: ["vision", "code", "tools"], costClass: "paid", trainingRegime: "rlvr" },
  // xAI direct Grok build model — verified live on api.x.ai 2026-06-05 (in /v1/models list, 200 chat completion, emits reasoning_content). Routes via XAI_API_KEY direct path in getClientForModel.
  { id: "grok-build-0.1", label: "Grok Build 0.1", provider: "xai", tier: "reasoning", description: "xAI Grok build model — reasoning + agentic coding, emits reasoning_content; direct xAI API (XAI_API_KEY). Verified live 2026-06-05", capabilities: ["code", "tools"], costClass: "paid", trainingRegime: "rlvr" },

  { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: "openrouter", tier: "powerful", description: "FLAGSHIP — DeepSeek's newest top-tier model (Apr 2026), best for high-quality technical workloads, ensemble proposer #1", capabilities: ["vision", "code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "openrouter", tier: "balanced", description: "Fast V4 variant for high-volume tasks", capabilities: ["code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2", provider: "openrouter", tier: "powerful", description: "GPT-5 class reasoning, sparse attention, 164K ctx — $0.26/M in", capabilities: ["code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  { id: "deepseek/deepseek-r1", label: "DeepSeek R1", provider: "openrouter", tier: "reasoning", description: "Deep reasoning model — top math/code benchmarks", capabilities: ["code"], costClass: "cheap", trainingRegime: "rlvr" },

  { id: "z-ai/glm-5.1", label: "GLM 5.1", provider: "openrouter", tier: "powerful", description: "Zhipu flagship — strong reasoning, low hallucination, 202K ctx — $0.95/M in", capabilities: ["vision", "code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  { id: "z-ai/glm-4.5-air:free", label: "GLM 4.5 Air (Free)", provider: "openrouter", tier: "balanced", description: "Free Zhipu model — solid quality for zero cost, 131K ctx", capabilities: ["code", "tools"], costClass: "free", trainingRegime: "distilled" },

  { id: "google/gemma-4-31b-it", label: "Gemma 4 31B", provider: "openrouter", tier: "balanced", description: "Google 31B dense, Apache 2.0, 256K ctx, multimodal, reasoning mode — $0.14/M in", capabilities: ["vision", "code", "tools"], costClass: "cheap", trainingRegime: "distilled" },

  { id: "z-ai/glm-5", label: "GLM-5", provider: "openrouter", tier: "powerful", description: "Z.ai flagship — #1 Chatbot Arena, agentic planning, 80K ctx — $0.72/M in", capabilities: ["vision", "code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  { id: "z-ai/glm-4.7-flash", label: "GLM-4.7 Flash", provider: "openrouter", tier: "fast", description: "30B SOTA agentic coder, 202K ctx — $0.06/M in, ultra-cheap", capabilities: ["code", "tools"], costClass: "cheap", trainingRegime: "distilled" },

  { id: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super", provider: "openrouter", tier: "powerful", description: "120B MoE (12B active), 1M ctx, Mamba-Transformer hybrid — $0.10/M in", capabilities: ["code", "tools"], costClass: "cheap", trainingRegime: "distilled" },

  { id: "moonshotai/kimi-k2.6", label: "Kimi K2.6", provider: "openrouter", tier: "powerful", description: "1T MoE, 262K ctx, 1500 parallel tools, vision + agent swarm — $0.45/M in", capabilities: ["vision", "tools"], costClass: "cheap", trainingRegime: "distilled" },

  { id: "inclusionai/ling-2.6-1t:free", label: "Ling-2.6-1T (Free)", provider: "openrouter", tier: "powerful", description: "Ant Group/InclusionAI 1T MoE — non-reasoning execution-first design, 262K ctx, optimized for useful-intelligence-per-token (skips chain-of-thought narration), strong agent/tool-call workloads — FREE", capabilities: ["code", "tools"], costClass: "free", trainingRegime: "distilled" },
  { id: "inclusionai/ling-2.6-flash", label: "Ling-2.6 Flash", provider: "openrouter", tier: "fast", description: "InclusionAI flash variant — 262K ctx, ultra-cheap ($0.08/M in, $0.24/M out), execution-first non-reasoning, ideal for high-volume agent loops", capabilities: ["code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", provider: "openrouter", tier: "powerful", description: "Meta open-source flagship — vision + tools, Apache 2.0", capabilities: ["vision", "code", "tools"], costClass: "cheap", trainingRegime: "base" },

  // R125+52.40 (Bob 2026-06-16) — OpenRouter Fusion: managed multi-model
  // deliberation (panel answers in parallel → judge compares → final model
  // synthesizes), OpenRouter's hosted equivalent of our native ensemble_query/
  // jury. Registered as an OPTIONAL backend reference for deep-research /
  // expert-critique prompts ONLY (the "cost of being wrong > a few extra
  // completions" case) — NOT a default proposer/aggregator. METERED: bills the
  // OPENROUTER_API_KEY at the SUM of every panel member + judge + final
  // completion (no free lane), so the $0-policy guard in getClientForModel
  // substitutes it away by default; a caller must pass { costExemptLane: true }
  // (or run with ALLOW_METERED_LLM=true) to actually invoke it, and MUST read
  // the real cost from the response's usage.cost (the token-based estimate is
  // meaningless for a meta-model). Evaluate via scripts/fusion-vs-moa-ab.ts.
  { id: "openrouter/fusion", label: "OpenRouter Fusion (panel+judge)", provider: "openrouter", tier: "powerful", description: "Managed multi-model deliberation — a panel answers in parallel, a judge compares them, a final model synthesizes. Optional deep-research backend reference; metered (sum of all underlying completions), not a default proposer.", capabilities: ["code", "tools"], costClass: "paid", trainingRegime: "unknown" },
];

// R110.11.2 — Auto-add overlay. The catalog watcher in server/model-catalog.ts
// writes new entries (matching MODEL_AUTOADD_WATCHLIST patterns) to
// data/model-registry-overlay.json so models like ERNIE 5.1 get into the
// registry the moment they appear on OpenRouter, without a code edit. Loaded
// once at module init; appended via push() (binding stays const, contents
// grow). Failures are loud-warned, not swallowed — a corrupt overlay file
// MUST surface so we know auto-add is silently broken.
try {
  const overlayPath = path.join(process.cwd(), "data", "model-registry-overlay.json");
  if (fs.existsSync(overlayPath)) {
    const raw = fs.readFileSync(overlayPath, "utf8").trim();
    if (raw.length > 0) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        let added = 0;
        for (const entry of parsed) {
          if (!entry || typeof entry !== "object") continue;
          if (typeof entry.id !== "string" || typeof entry.label !== "string" || typeof entry.provider !== "string" || typeof entry.tier !== "string") continue;
          if (MODEL_REGISTRY.some(m => m.id === entry.id)) continue;
          MODEL_REGISTRY.push(entry as ModelInfo);
          added++;
        }
        if (added > 0) {
          console.log(`[providers] R110.11.2 overlay: appended ${added} auto-added model(s) to MODEL_REGISTRY`);
        }
      } else {
        console.warn(`[providers] overlay file ${overlayPath} is not a JSON array — ignored`);
      }
    }
  }
} catch (err: any) {
  console.warn(`[providers] R110.11.2 overlay load failed (auto-added models NOT loaded): ${err?.message || err}`);
}

// R77.5 — KisMATH-derived helper. Returns true if the model is "exploratory" (not RLVR-collapsed) —
// useful when the router needs to pick a proposer for ensembling, debate, or open-ended reasoning.
export function isExplorationFriendly(modelId: string): boolean {
  const m = MODEL_REGISTRY.find(x => x.id === modelId);
  if (!m) return false;
  // RLVR collapses the answer distribution (KisMATH fig. 7-9), making it a poor exploration source.
  return m.trainingRegime !== "rlvr";
}

export function isModelMultimodal(modelId: string): boolean {
  const model = MODEL_REGISTRY.find(m => m.id === modelId);
  return !!(model?.capabilities?.includes("vision"));
}

export function getMultimodalModelsForTier(tier: "fast" | "balanced" | "powerful" | "reasoning"): ModelInfo[] {
  return MODEL_REGISTRY.filter(m => m.tier === tier && m.capabilities?.includes("vision"));
}

export const PROVIDER_CONFIG: Record<string, { name: string; baseUrl: string; description: string }> = {
  replit: { name: "Replit AI (Built-in)", baseUrl: "", description: "Built-in - GPT-5.4, GPT-5.1, no API key needed" },
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1", description: "GPT-4o, GPT-4.1, o4-mini" },
  anthropic: { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", description: "Claude Opus 4.6, Sonnet 4.6, Haiku 4.5" },
  xai: { name: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", description: "Grok 4, Grok 3, Grok 3 Mini" },
  google: { name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", description: "Gemini 3.1 Pro, 3 Pro, 3 Flash, 2.5 Pro - cheapest & fastest" },
  perplexity: { name: "Perplexity", baseUrl: "https://api.perplexity.ai", description: "Web research - Sonar, Sonar Pro, Deep Research" },
  openrouter: { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", description: "MiMo V2, Grok 4.1 Fast, DeepSeek V3.2, Qwen 3.6, Gemma 4, GLM-5, Llama 4 & more — one key, frontier models" },
};

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

const subscriptionFailureCache = new Map<string, { failedAt: number; isRateLimit: boolean }>();
const SUBSCRIPTION_AUTH_FAILURE_TTL = 600_000;
const SUBSCRIPTION_RATE_LIMIT_TTL = 120_000;

export function markSubscriptionFailed(provider: string, tenantId: number, statusCode?: number) {
  const isRateLimit = statusCode === 429;
  subscriptionFailureCache.set(`${provider}-${tenantId}`, { failedAt: Date.now(), isRateLimit });
  console.log(`[providers] Subscription ${provider} blocked for tenant ${tenantId} (${isRateLimit ? "rate limit — 2min" : "auth failure — 10min"})`);
}

const providerHealthCache = new Map<string, { failedAt: number; reason: string; attempts: number }>();
const PROVIDER_HEALTH_TTL = 300_000;
const PROVIDER_HEALTH_MAX_ATTEMPTS = 3;

export function markProviderUnhealthy(provider: string, reason: string) {
  const existing = providerHealthCache.get(provider);
  const attempts = (existing?.attempts || 0) + 1;
  providerHealthCache.set(provider, { failedAt: Date.now(), reason, attempts });
  console.warn(`[providers] Marked ${provider} unhealthy (attempt ${attempts}): ${reason.slice(0, 80)}`);
}

export function isProviderHealthy(provider: string): boolean {
  const entry = providerHealthCache.get(provider);
  if (!entry) return true;
  if (Date.now() - entry.failedAt > PROVIDER_HEALTH_TTL) {
    providerHealthCache.delete(provider);
    return true;
  }
  return entry.attempts < PROVIDER_HEALTH_MAX_ATTEMPTS;
}

export function getUnhealthyProviders(): Set<string> {
  const unhealthy = new Set<string>();
  for (const [provider, entry] of providerHealthCache.entries()) {
    if (Date.now() - entry.failedAt <= PROVIDER_HEALTH_TTL && entry.attempts >= PROVIDER_HEALTH_MAX_ATTEMPTS) {
      unhealthy.add(provider);
    }
  }
  return unhealthy;
}

export function resetProviderHealth(provider: string) {
  providerHealthCache.delete(provider);
}

async function trySubscriptionAuth(provider: string, tenantId: number | undefined): Promise<OpenAI | null> {
  if (!tenantId) return null;
  if (!SUBSCRIPTION_BASE_URLS[provider]) return null;

  const failKey = `${provider}-${tenantId}`;
  const failEntry = subscriptionFailureCache.get(failKey);
  if (failEntry) {
    const ttl = failEntry.isRateLimit ? SUBSCRIPTION_RATE_LIMIT_TTL : SUBSCRIPTION_AUTH_FAILURE_TTL;
    if (Date.now() - failEntry.failedAt < ttl) {
      return null;
    }
    subscriptionFailureCache.delete(failKey);
  }

  try {
    const token = await getSubscriptionAccessToken(provider, tenantId);
    if (token) {
      console.log(`[providers] Using ${provider} subscription OAuth token for tenant ${tenantId}`);
      return getSubscriptionClient(provider, token);
    }
  } catch (err: any) {
    console.warn(`[providers] Subscription auth check failed for ${provider}:`, err.message);
  }
  return null;
}

// Bob 2026-06-09 — prefer his flat-rate OAuth subscriptions (ChatGPT Plus/Pro
// via OpenAI OAuth; extensible to any provider added to SUBSCRIPTION_BASE_URLS)
// over metered per-token API keys for high-end models. When ON (default),
// getClientForModel tries trySubscriptionAuth ABOVE the tenant/DB/env metered-
// key lanes — but still BELOW the $0 Replit modelfarm lane, which is free and
// shouldn't burn subscription quota on cheap tasks. trySubscriptionAuth fails
// through to null when no subscription is connected / the token is expired /
// rate-limited (it has a failure cache), so metered keys remain the fallback —
// zero behavior change for tenants without a connected subscription. Reversible:
// PREFER_OAUTH_SUBSCRIPTIONS=false restores the old metered-key-first order.
// NOTE on the other two providers Bob asked about: Anthropic/Claude has no
// OAuth-API path — it uses the Claude Runner CLI bridge (Max plan) which is a
// separate, higher-priority lane in getClientForModel. Google/Gemini has NO
// programmatic flat-rate subscription at all ("Gemini Advanced" has no API; the
// Gemini API is metered-key only, and the Google connector token is Drive/
// Workspace-scoped, not generative-language-scoped) — so Gemini intentionally
// stays on its metered key; there is nothing to shift.
export function preferOAuthSubscriptions(): boolean {
  const v = (process.env.PREFER_OAUTH_SUBSCRIPTIONS || "").trim().toLowerCase();
  if (!v) return true;
  return !(v === "false" || v === "0" || v === "no" || v === "off");
}

// $0-cost policy (Bob 2026-06-16) — metered per-token LLM lanes are OFF by default.
// Bob's standing directive: route everything through the free Replit modelfarm so
// per-token cost ≈ $0. The Replit modelfarm only exposes an OpenAI-compatible
// /chat/completions endpoint for the OpenAI integration — the Anthropic + Gemini
// modelfarm proxies are native-SDK-only, so the OpenAI-SDK router here CANNOT drive
// Claude/Gemini through modelfarm; they fall to metered keys. That metered fallback
// drove the $933 Jun-11/12 burst. When this returns false (the default),
// getClientForModel SUBSTITUTES the free modelfarm OpenAI-family equivalent for any
// registry model that would otherwise burn a metered Anthropic/Google/OpenRouter/
// xAI/Perplexity key. Set ALLOW_METERED_LLM=true to restore the metered key lanes
// (e.g. to give the jury real cross-provider diversity again). The MoA jury vote is
// NOT cost-exempt — it runs on the free modelfarm models pinned in model-tiers.json.
// The ONLY owner-blessed metered uses left by default are the once-weekly BWB
// flagship recap (options.costExemptLane) and the flat-rate Claude Runner bridge.
export function meteredLlmEnabled(): boolean {
  const v = (process.env.ALLOW_METERED_LLM || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

export const LEGACY_MODEL_ALIASES: Record<string, string> = {
  "gpt-4o-mini": "gpt-5-mini",
  "gpt-4o": "gpt-5.4",
  "gpt-4": "gpt-4.1",
  "gpt-4-turbo": "gpt-4.1",
  "claude-3-opus": "claude-opus-4-20250514",
  "claude-3-sonnet": "claude-sonnet-4-20250514",
  "claude-3-haiku": "gpt-5-mini",
  "gemini-pro": "gemini-3-flash-preview",
  "gemini-1.5-pro": "gemini-3-flash-preview",
};

export async function getClientForModel(modelId: string, tenantId?: number, options?: { requiresTools?: boolean; juryLane?: boolean; costExemptLane?: boolean }): Promise<{ client: OpenAI; actualModelId: string }> {
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

  if (!model || model.provider === "replit") {
    const mapped = mapReplitToOpenAI(modelId);

    // Models that Replit's modelfarm hasn't onboarded yet (returns 404 at inference).
    // These still use the OAuth-provided OPENAI_API_KEY one rung down — same auth path,
    // just not through the modelfarm proxy. Remove from this set when modelfarm catches up.
    const REPLIT_MODELFARM_UNSUPPORTED = new Set(["gpt-5.5"]);

    const replitKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const replitBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    if (mapped && !REPLIT_MODELFARM_UNSUPPORTED.has(modelId) && replitKey && replitKey.length > 5 && replitBaseUrl && replitBaseUrl.length > 5) {
      const replitClient = getReplit();
      console.log(`[providers] Replit model ${modelId} → modelfarm integration (${mapped}, $0 cost)`);
      return { client: replitClient, actualModelId: mapped };
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
    if (mapped && !meteredLlmEnabled() && !options?.costExemptLane) {
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
      console.log(`[providers] Replit model ${modelId} → Anthropic integration fallback (claude-sonnet-4-20250514)`);
      return { client: anthropicIntegration, actualModelId: "claude-sonnet-4-20250514" };
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (mapped && anthropicKey && anthropicKey.length > 5) {
      console.log(`[providers] Replit model ${modelId} → Anthropic env key fallback (claude-sonnet-4-20250514)`);
      return { client: getUserClient("anthropic", anthropicKey), actualModelId: "claude-sonnet-4-20250514" };
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
  if (modelId === "o4-mini-openai") actualModelId = "o4-mini";

  if (model.provider === "anthropic" && isClaudeRunnerAvailable()) {
    if (options?.requiresTools) {
      console.log(`[providers] Skipping Claude Runner for ${modelId} (tools required — bridge doesn't support tool calls)`);
    } else {
      const cacheKey = "claude-runner-bridge";
      if (!clientCache.has(cacheKey)) {
        clientCache.set(cacheKey, new OpenAI({
          apiKey: "claude-runner-local",
          baseURL: getClaudeRunnerBaseUrl(),
        }));
      }
      console.log(`[providers] Routing ${modelId} through Claude Runner bridge (OAuth runner — uses your Anthropic plan quota, NOT per-token API billing)`);
      return { client: wrapClientWithParamAdaptation(clientCache.get(cacheKey)!), actualModelId };
    }
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
  if (!meteredLlmEnabled() && !costExemptCall) {
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
    "gpt-5.5": "gpt-5.5",
    "gpt-5.4": "gpt-5.4",
    "gpt-5-mini": "gpt-5-mini",
    "o4-mini": "o4-mini",
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

export function clearClientCache() {
  clientCache.delete("replit");
  for (const key of clientCache.keys()) {
    if (key !== "replit") clientCache.delete(key);
  }
}

setInterval(() => {
  const platformKeys = new Set(["replit", "openai", "anthropic", "google", "xai", "openrouter", "perplexity"]);
  let pruned = 0;
  for (const key of clientCache.keys()) {
    if (!platformKeys.has(key)) {
      clientCache.delete(key);
      pruned++;
    }
  }
  if (pruned > 0) console.log(`[providers] Pruned ${pruned} cached tenant clients`);
}, 60 * 60 * 1000);

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
  const keys = await storage.getProviderKeys();
  const enabled = new Set(keys.filter((k) => k.enabled && k.apiKey).map((k) => k.provider));

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
      { provider: "openai", model: "gpt-4.1-mini" },
      { provider: "replit", model: "gpt-5-mini" },
      { provider: "anthropic", model: "claude-sonnet-4-20250514" },
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
      { provider: "openai", model: "gpt-4.1" },
      { provider: "anthropic", model: "claude-sonnet-4-20250514" },
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
      { provider: "google", model: "gemini-3.5-flash" },
      { provider: "google", model: "gemini-3.1-pro-preview" },
      { provider: "google", model: "gemini-3-pro-preview" },
      { provider: "replit", model: "gpt-5.4" },
      { provider: "openai", model: "gpt-4.1" },
      { provider: "openrouter", model: "x-ai/grok-4.20-multi-agent" },  // R81 — top-tier multi-agent orchestration workhorse
      { provider: "openrouter", model: "moonshotai/kimi-k2.6" },
      { provider: "openrouter", model: "deepseek/deepseek-v3.2" },
      { provider: "openrouter", model: "xiaomi/mimo-v2-omni" },
      { provider: "openrouter", model: "z-ai/glm-5" },
      { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b" },
      { provider: "openrouter", model: "z-ai/glm-5.1" },
      { provider: "openrouter", model: "meta-llama/llama-4-maverick" },
    ],
    reasoning: [
      { provider: "google", model: "gemini-3.5-flash" },
      { provider: "google", model: "gemini-3.1-pro-preview" },
      { provider: "openai", model: "o4-mini-openai" },
      { provider: "replit", model: "o4-mini" },
      { provider: "replit", model: "gpt-5.4" },
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
    if (subscriptionProviders.has(c.provider)) {
      logAutoRoute(tier, c.model, `${c.provider} OAuth subscription`);
      return c.model;
    }
    if (c.provider === "replit") {
      const mapped = mapReplitToOpenAI(c.model);
      if (mapped && subscriptionProviders.has("openai")) {
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
      if (hasIntegrationFallback(c.provider)) {
        logAutoRoute(tier, c.model, `${c.provider} integration (free-tier-only mode)`);
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
    if (enabled.has(c.provider)) {
      logAutoRoute(tier, c.model, `${c.provider} direct key (fallback — PAID API)`);
      return c.model;
    }
    if (hasIntegrationFallback(c.provider)) {
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
    powerful: "gemini-3.5-flash",
    reasoning: "gemini-3.5-flash",
  };
  return tierMap[tier] || "gemini-2.5-flash";
}

const MODEL_MAX_OUTPUT: Record<string, number> = {
  "claude-sonnet-4-20250514": 16384,
  "claude-opus-4-20250514": 16384,
  "claude-sonnet-4-6": 65536,
  "claude-opus-4-6": 65536,
  "claude-opus-4-7": 131072,
  "claude-opus-4-8": 131072,
  "claude-fable-5": 128000,
  "gpt-5.5": 65536,
  "gpt-5.4": 32768,
  "gpt-5-mini": 32768,
  "gpt-4.1": 32768,
  "gpt-4.1-mini": 32768,
  "o4-mini": 65536,
  "o4-mini-openai": 65536,
  "gemini-3.5-flash": 65536,
  "gemini-3-flash-preview": 65536,
  "gemini-3-pro-preview": 65536,
  "gemini-3.1-pro-preview": 65536,
  "gemini-2.5-flash": 65536,
  "xiaomi/mimo-v2-flash": 65536,
  "xiaomi/mimo-v2-omni": 65536,
  "x-ai/grok-4.20-multi-agent": 131072,
  "grok-build-0.1": 65536,
  "deepseek/deepseek-v4-pro": 65536,
  "deepseek/deepseek-v4-flash": 32768,
  "deepseek/deepseek-v3.2": 32768,
  "deepseek/deepseek-r1": 32768,
  "z-ai/glm-5.1": 32768,
  "z-ai/glm-4.5-air:free": 16384,
  "google/gemma-4-31b-it": 32768,
  "z-ai/glm-5": 32768,
  "z-ai/glm-4.7-flash": 16384,
  "nvidia/nemotron-3-super-120b-a12b": 32768,
  "moonshotai/kimi-k2.5": 32768,
  "meta-llama/llama-4-maverick": 16384,
  "sonar": 16384,
  "sonar-pro": 16384,
  "sonar-reasoning-pro": 16384,
  "sonar-deep-research": 16384,
};

export function getMaxOutputTokens(modelId: string): number {
  return MODEL_MAX_OUTPUT[modelId] || 16384;
}

export const TIER_COST_ESTIMATES: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  fast: { inputPer1M: 0.10, outputPer1M: 0.40 },
  balanced: { inputPer1M: 0.40, outputPer1M: 1.60 },
  powerful: { inputPer1M: 3.00, outputPer1M: 12.00 },
  reasoning: { inputPer1M: 1.10, outputPer1M: 4.40 },
};

export async function getAvailableModels(): Promise<ModelInfo[]> {
  const keys = await storage.getProviderKeys();
  const enabledProviders = new Set(keys.filter((k) => k.enabled).map((k) => k.provider));
  enabledProviders.add("replit");
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

let lastModelFreshnessCheck = 0;
const MODEL_FRESHNESS_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

export const TEST_MODEL_IDS: Record<string, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-sonnet-4-20250514",
  xai: "grok-4",  // for validating user-supplied xAI API keys (test path only, not user-facing model selection)
  google: "gemini-2.5-flash",
  perplexity: "sonar",
  openrouter: "deepseek/deepseek-v3.2",
};

export function getTestModelForProvider(provider: string): string {
  return TEST_MODEL_IDS[provider] || "gemini-2.5-flash";
}

export async function checkModelFreshness(): Promise<{ stale: string[]; checked: number; lastChecked: string }> {
  const stale: string[] = [];
  const now = Date.now();
  lastModelFreshnessCheck = now;

  const providerEndpoints: Record<string, () => Promise<string[]>> = {
    openrouter: async () => {
      try {
        const resp = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { "HTTP-Referer": siteConfig.websiteUrl || "https://localhost:5000" },
        });
        if (!resp.ok) {
          // R110.11.7 +sec — log so an upstream provider outage can be
          // distinguished from a legitimately empty model catalog. Without
          // the log, weekly-maintenance freshness checks misattribute the
          // outage as "all models stale".
          console.warn(`[providers] OpenRouter listModels HTTP ${resp.status} ${resp.statusText} — treating as empty catalog`);
          return [];
        }
        const data = await resp.json() as any;
        return (data.data || []).map((m: any) => m.id);
      } catch (err: any) {
        console.warn(`[providers] OpenRouter listModels FETCH FAILED — treating as empty catalog: ${String(err?.message || err).slice(0, 120)}`);
        return [];
      }
    },
  };

  // Known false-positives — documented & accepted, exempted to keep weekly maintenance signal honest.
  // Add a model id here only with a comment explaining WHY it's expected to flag stale.
  const FRESHNESS_EXEMPT = new Set<string>([
    "inclusionai/ling-2.6-1t:free",  // InclusionAI free tier — listed but not always in live OpenRouter response; documented non-blocking until quarterly refresh (replit.md). Slug must match `ours.id` from MODEL_REGISTRY (line 277) exactly — Set lookup is case/string sensitive.
    "grok-4",         // xAI test-path string used to validate API key health, NOT a routed model — exempted from MODEL_REGISTRY check (replit.md)
  ]);

  for (const [provider, fetchFn] of Object.entries(providerEndpoints)) {
    try {
      const liveModels = await fetchFn();
      if (liveModels.length === 0) continue;

      const ourModels = MODEL_REGISTRY.filter(m => m.provider === provider);
      for (const ours of ourModels) {
        const modelSlug = ours.id;
        if (FRESHNESS_EXEMPT.has(modelSlug)) continue;
        if (!liveModels.includes(modelSlug)) {
          stale.push(`${ours.label} (${ours.id}) — may be deprecated or renamed`);
        }
      }

      const testModel = TEST_MODEL_IDS[provider];
      if (testModel && !FRESHNESS_EXEMPT.has(testModel) && !liveModels.includes(testModel)) {
        stale.push(`TEST MODEL: ${provider} test model "${testModel}" not found in live API — needs update`);
      }
    } catch (_silentErr) { logSilentCatch("server/providers.ts", _silentErr); }
  }

  for (const [provider, testModel] of Object.entries(TEST_MODEL_IDS)) {
    if (provider === "replit") continue;
    if (FRESHNESS_EXEMPT.has(testModel)) continue;
    const inRegistry = MODEL_REGISTRY.some(m => m.id === testModel);
    if (!inRegistry) {
      stale.push(`TEST MODEL: ${provider} test model "${testModel}" not in MODEL_REGISTRY — may be outdated`);
    }
  }

  console.log(`[model-freshness] Checked ${MODEL_REGISTRY.length} models, ${stale.length} potentially stale`);
  if (stale.length > 0) {
    for (const s of stale) {
      console.warn(`[model-freshness] ${s}`);
    }
  }
  return {
    stale,
    checked: MODEL_REGISTRY.length,
    lastChecked: new Date(now).toISOString(),
  };
}

export function isModelFreshnessCheckDue(): boolean {
  return (Date.now() - lastModelFreshnessCheck) > MODEL_FRESHNESS_INTERVAL_MS;
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
