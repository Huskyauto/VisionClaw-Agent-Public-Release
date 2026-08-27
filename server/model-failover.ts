import { MODEL_REGISTRY, type ModelInfo, getClientForModel, markSubscriptionFailed, markProviderUnhealthy, getUnhealthyProviders, resetProviderHealth, LAST_RESORT_MODEL } from "./providers";

import { logSilentCatch } from "./lib/silent-catch";
export type FailoverReason =
  | "rate_limit"
  | "billing"
  | "auth"
  | "auth_permanent"
  | "overloaded"
  | "timeout"
  | "model_not_found"
  | "format"
  | "network"
  | "unknown";

type ErrorPattern = RegExp | string;

const ERROR_PATTERNS: Record<string, ErrorPattern[]> = {
  rate_limit: [
    /rate[_ ]limit/i,
    /too many requests/i,
    /429/,
    "exceeded your current quota",
    "resource has been exhausted",
    "quota exceeded",
    "resource_exhausted",
    /\btpm\b/i,
    "tokens per minute",
    "tokens per day",
    /daily.*limit.*(?:exhausted|reached|exceeded)/i,
    /monthly.*limit/i,
    /usage limit/i,
  ],
  billing: [
    /["']?(?:status|code)["']?\s*[:=]\s*402\b/i,
    /\bhttp\s*402\b/i,
    /\b402\s+payment/i,
    "payment required",
    "insufficient credits",
    /insufficient[_ ]quota/i,
    "credit balance",
    "plans & billing",
    "insufficient balance",
    /requires?\s+more\s+credits/i,
    /billing/i,
  ],
  auth_permanent: [
    /api[_ ]?key[_ ]?(?:revoked|invalid|deactivated|deleted)/i,
    "invalid_api_key",
    "key has been disabled",
    "key has been revoked",
    "account has been deactivated",
    /could not (?:authenticate|validate).*(?:api[_ ]?key|credentials)/i,
    "permission_error",
    "not allowed for this organization",
  ],
  auth: [
    /invalid[_ ]?api[_ ]?key/i,
    "incorrect api key",
    "invalid token",
    /\b401\b/,
    /\b403\b/,
    "unauthorized",
    "forbidden",
    "access denied",
    "insufficient permissions",
    /missing scopes?:/i,
    "expired",
    "token has expired",
    "no credentials found",
    "no api key found",
    "re-authenticate",
    "oauth token refresh failed",
  ],
  overloaded: [
    /overloaded/i,
    /service[_ ]unavailable.*(?:overload|capacity|high[_ ]demand)/i,
    /(?:overload|capacity|high[_ ]demand).*service[_ ]unavailable/i,
    "high demand",
  ],
  timeout: [
    "timeout",
    "timed out",
    "deadline exceeded",
    "context deadline exceeded",
    "connection error",
    "network error",
    "network request failed",
    "fetch failed",
    "socket hang up",
  ],
  network: [
    /\beconnrefused\b/i,
    /\beconnreset\b/i,
    /\beconnaborted\b/i,
    /\benetunreach\b/i,
    /\behostunreach\b/i,
    /\behostdown\b/i,
    /\benetreset\b/i,
    /\betimedout\b/i,
    /\bepipe\b/i,
    /\benotfound\b/i,
    /\beai_again\b/i,
    "service unavailable",
    "bad gateway",
    /\b502\b/,
    /\b503\b/,
    /\b504\b/,
  ],
  model_not_found: [
    "model not found",
    "does not exist",
    /\b404\b/,
    "no such model",
    "invalid model",
    "model_not_found",
  ],
  format: [
    "string should match pattern",
    "invalid request format",
    "malformed",
    /\b400\b.*(?:invalid|bad request)/i,
  ],
};

function matchesPatterns(raw: string, patterns: ErrorPattern[]): boolean {
  if (!raw) return false;
  const lower = raw.toLowerCase();
  return patterns.some((p) =>
    p instanceof RegExp ? p.test(raw) : lower.includes(p.toLowerCase())
  );
}

export function classifyError(error: any): { reason: FailoverReason; status?: number } {
  const status = error?.status || error?.statusCode;
  const msg = String(error?.message || error || "");
  const code = error?.code || error?.errno || "";

  if (status === 402 || matchesPatterns(msg, ERROR_PATTERNS.billing)) {
    return { reason: "billing", status };
  }
  if (status === 429 || matchesPatterns(msg, ERROR_PATTERNS.rate_limit)) {
    return { reason: "rate_limit", status };
  }
  if (matchesPatterns(msg, ERROR_PATTERNS.auth_permanent)) {
    return { reason: "auth_permanent", status };
  }
  if (status === 401 || status === 403 || matchesPatterns(msg, ERROR_PATTERNS.auth)) {
    return { reason: "auth", status };
  }
  if (matchesPatterns(msg, ERROR_PATTERNS.overloaded)) {
    return { reason: "overloaded", status };
  }
  if (status === 404 || matchesPatterns(msg, ERROR_PATTERNS.model_not_found)) {
    return { reason: "model_not_found", status };
  }
  if (matchesPatterns(msg, ERROR_PATTERNS.format)) {
    return { reason: "format", status };
  }
  if (matchesPatterns(msg, ERROR_PATTERNS.timeout)) {
    return { reason: "timeout", status };
  }
  if (matchesPatterns(code, ERROR_PATTERNS.network) || matchesPatterns(msg, ERROR_PATTERNS.network)) {
    return { reason: "network", status };
  }
  if (status && status >= 500) {
    const hasTransientSignal = /overload|capacity|temporarily|retry|backend|upstream|internal.*error/i.test(msg);
    if (hasTransientSignal) {
      return { reason: "overloaded", status };
    }
    return { reason: "network", status };
  }
  const errorType = error?.type || error?.error?.type || "";
  if (errorType === "api_error" || errorType === "server_error") {
    if (status && status >= 500) {
      const hasTransientSignal = /overload|capacity|temporarily|retry|backend|upstream/i.test(msg);
      return { reason: hasTransientSignal ? "overloaded" : "network", status };
    }
    return { reason: "unknown", status };
  }
  return { reason: "unknown", status };
}

export function isRetryableError(error: any): boolean {
  const { reason } = classifyError(error);
  return shouldFailover(reason);
}

const FAILOVER_ELIGIBLE: Set<FailoverReason> = new Set([
  "rate_limit",
  "billing",
  "auth",
  "overloaded",
  "timeout",
  "network",
  "model_not_found",
  "format",
  "unknown",
]);

const EXCLUDE_PROVIDER_REASONS: Set<FailoverReason> = new Set([
  "auth",
  "auth_permanent",
  "billing",
]);

export function shouldFailover(reason: FailoverReason): boolean {
  return FAILOVER_ELIGIBLE.has(reason);
}

export function shouldExcludeProvider(reason: FailoverReason): boolean {
  return EXCLUDE_PROVIDER_REASONS.has(reason);
}

export interface FailoverResult {
  client: any;
  actualModelId: string;
  failoverUsed: boolean;
  originalModel: string;
  failoverModel?: string;
  failoverReason?: string;
  failoverClassification?: FailoverReason;
}

const TIER_FALLBACK_ORDER: Record<string, string[]> = {
  powerful: ["balanced", "fast"],
  balanced: ["fast"],
  reasoning: ["powerful", "balanced"],
  fast: [],
};

const PROVIDER_PRIORITY = ["anthropic", "openai", "google", "openrouter", "xai", "perplexity", "replit"];

export function findFallbackModel(
  failedModelId: string,
  availableModels: ModelInfo[],
  excludeProviders?: Set<string>
): ModelInfo | null {
  const failedModel = MODEL_REGISTRY.find((m) => m.id === failedModelId);
  if (!failedModel) return null;

  // LAST-RESORT guard (Bob 2026-07-01): the super-expert escalation model is
  // NEVER a generic failover candidate — it is METERED and reachable ONLY via
  // resilientChatCompletion's explicit terminal rung (claim-before-spend,
  // daily-capped). Excluding it here covers every generic pool consumer
  // (pickNextModel, getClientWithFailover) in one place.
  const base = availableModels.filter((m) => m.id !== LAST_RESORT_MODEL);
  const candidates = excludeProviders
    ? base.filter((m) => !excludeProviders.has(m.provider))
    : base;

  const sameTierSameProvider = candidates.find(
    (m) => m.id !== failedModelId && m.provider === failedModel.provider && m.tier === failedModel.tier
  );
  if (sameTierSameProvider) return sameTierSameProvider;

  const sameTierDiffProvider = candidates
    .filter((m) => m.id !== failedModelId && m.tier === failedModel.tier && m.provider !== failedModel.provider)
    .sort((a, b) => PROVIDER_PRIORITY.indexOf(a.provider) - PROVIDER_PRIORITY.indexOf(b.provider));
  if (sameTierDiffProvider.length > 0) return sameTierDiffProvider[0];

  const fallbackTiers = TIER_FALLBACK_ORDER[failedModel.tier] || [];
  for (const tier of fallbackTiers) {
    const candidate = candidates
      .filter((m) => m.tier === tier)
      .sort((a, b) => PROVIDER_PRIORITY.indexOf(a.provider) - PROVIDER_PRIORITY.indexOf(b.provider));
    if (candidate.length > 0) return candidate[0];
  }

  const replitFallback = candidates.find(
    (m) => m.provider === "replit" && m.id !== failedModelId
  );
  if (replitFallback) return replitFallback;

  return null;
}

export async function getClientWithFailover(
  modelId: string,
  availableModels: ModelInfo[],
  tenantId?: number
): Promise<FailoverResult> {
  try {
    const result = await getClientForModel(modelId, tenantId);
    return {
      ...result,
      failoverUsed: false,
      originalModel: modelId,
    };
  } catch (primaryError: any) {
    const { reason } = classifyError(primaryError);

    if (!shouldFailover(reason)) {
      throw primaryError;
    }

    const excludeProviders = shouldExcludeProvider(reason)
      ? new Set([MODEL_REGISTRY.find((m) => m.id === modelId)?.provider || ""])
      : undefined;

    const fallback = findFallbackModel(modelId, availableModels, excludeProviders);
    if (!fallback) throw primaryError;

    try {
      const result = await getClientForModel(fallback.id, tenantId);
      console.log(`[failover] ${modelId} → ${fallback.id} (${reason}: ${primaryError.message?.slice(0, 100)})`);
      return {
        ...result,
        failoverUsed: true,
        originalModel: modelId,
        failoverModel: fallback.id,
        failoverReason: primaryError.message,
        failoverClassification: reason,
      };
    } catch {
      throw primaryError;
    }
  }
}

const MAX_FAILOVER_ATTEMPTS = 5;

// R45.A: cap any single LLM call at 90s. Without this, a hung deepseek (or any
// provider) blocks the whole replay/research pipeline forever — the silent
// failure mode that killed the Apr-19 drain script. Timeout throws with
// classifyError-friendly message so existing failover logic kicks in.
const LLM_CALL_TIMEOUT_MS = 90_000;

function withLLMTimeout<T>(p: Promise<T>, modelId: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      const err: any = new Error(`LLM call timed out after ${LLM_CALL_TIMEOUT_MS}ms (model=${modelId})`);
      err.status = 504;
      err.code = "ETIMEDOUT";
      reject(err);
    }, LLM_CALL_TIMEOUT_MS);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export async function executeWithFailover<T>(
  modelId: string,
  availableModels: ModelInfo[],
  fn: (client: any, actualModelId: string) => Promise<T>,
  tenantId?: number
): Promise<{ result: T; failoverUsed: boolean; usedModel: string; failoverReason?: string; failoverClassification?: FailoverReason }> {
  const unhealthyProviders = getUnhealthyProviders();
  const primaryProvider = MODEL_REGISTRY.find((m) => m.id === modelId)?.provider;

  if (primaryProvider && unhealthyProviders.has(primaryProvider)) {
    const healthyModels = availableModels.filter(m => !unhealthyProviders.has(m.provider));
    const preemptiveFallback = healthyModels.length > 0 ? findFallbackModel(modelId, healthyModels) : null;
    if (preemptiveFallback) {
      console.log(`[failover] Skipping unhealthy ${primaryProvider}, using ${preemptiveFallback.id} (${preemptiveFallback.provider})`);
      try {
        const fb = await getClientForModel(preemptiveFallback.id, tenantId);
        const result = await withLLMTimeout(fn(fb.client, fb.actualModelId), fb.actualModelId);
        resetProviderHealth(preemptiveFallback.provider);
        return {
          result,
          failoverUsed: true,
          usedModel: preemptiveFallback.id,
          failoverReason: `${primaryProvider} unhealthy`,
          failoverClassification: "auth",
        };
      } catch (_silentErr) { logSilentCatch("server/model-failover.ts", _silentErr); }
    }
  }

  const { client, actualModelId, failoverUsed, failoverModel, failoverReason, failoverClassification } =
    await getClientWithFailover(modelId, availableModels, tenantId);

  try {
    const result = await withLLMTimeout(fn(client, actualModelId), actualModelId);
    const usedProvider = MODEL_REGISTRY.find((m) => m.id === (failoverModel || modelId))?.provider;
    if (usedProvider) resetProviderHealth(usedProvider);
    return {
      result,
      failoverUsed,
      usedModel: failoverModel || modelId,
      failoverReason,
      failoverClassification,
    };
  } catch (execError: any) {
    const { reason, status } = classifyError(execError);
    const errProvider = MODEL_REGISTRY.find((m) => m.id === (failoverModel || modelId))?.provider;

    if (errProvider) {
      markProviderUnhealthy(errProvider, String(execError?.message || ""));
      if ((reason === "auth" || reason === "auth_permanent" || reason === "billing" || reason === "rate_limit") && tenantId) {
        markSubscriptionFailed(errProvider, tenantId, status);
      }
    }

    if (shouldFailover(reason)) {
      const excludedProviders = new Set<string>();
      if (primaryProvider) excludedProviders.add(primaryProvider);
      if (errProvider && errProvider !== primaryProvider) excludedProviders.add(errProvider);
      for (const p of getUnhealthyProviders()) excludedProviders.add(p);

      let lastError = execError;
      for (let attempt = 0; attempt < MAX_FAILOVER_ATTEMPTS; attempt++) {
        const filteredModels = availableModels.filter((m) => !excludedProviders.has(m.provider));
        if (filteredModels.length === 0) {
          console.warn(`[failover] No remaining providers after excluding ${[...excludedProviders].join(", ")}`);
          break;
        }
        const fallback = findFallbackModel(modelId, filteredModels);
        if (!fallback) break;

        try {
          const fb = await getClientForModel(fallback.id, tenantId);
          console.log(`[failover] Attempt ${attempt + 1}: ${modelId} → ${fallback.id} (${fallback.provider}) — ${reason}: ${execError.message?.slice(0, 60)}`);
          const result = await withLLMTimeout(fn(fb.client, fb.actualModelId), fb.actualModelId);
          resetProviderHealth(fallback.provider);
          return {
            result,
            failoverUsed: true,
            usedModel: fallback.id,
            failoverReason: execError.message,
            failoverClassification: reason,
          };
        } catch (fbError: any) {
          const fbClassified = classifyError(fbError);
          const fbMsg = String(fbError?.message || "");
          console.warn(`[failover] ${fallback.id} (${fallback.provider}) failed: ${fbClassified.reason} — ${fbMsg.slice(0, 60)}`);
          markProviderUnhealthy(fallback.provider, fbMsg);
          lastError = fbError;
          excludedProviders.add(fallback.provider);
        }
      }
      // R98.16 #3 — translateLlmError attaches an actionable .friendly line
      // to the thrown error so Felix / log surfaces / chat replies get
      // "Auth rejected (401/403). Rotate the key" instead of raw provider
      // gibberish. Original .message is preserved untouched for forensics.
      try {
        const { translateLlmError, formatTranslated } = await import("./lib/translate-llm-error");
        const t = translateLlmError(lastError);
        (lastError as any).friendly = formatTranslated(t);
        (lastError as any).translated = t;
      } catch (_silentErr) { logSilentCatch("server/model-failover.ts", _silentErr); }
      throw lastError;
    }
    try {
      const { translateLlmError, formatTranslated } = await import("./lib/translate-llm-error");
      const t = translateLlmError(execError);
      (execError as any).friendly = formatTranslated(t);
      (execError as any).translated = t;
    } catch (_silentErr) { logSilentCatch("server/model-failover.ts", _silentErr); }
    throw execError;
  }
}
