/**
 * Provider health, subscription recovery, and background completion retry lane.
 * Kept independent of providers.ts so cached-client routing remains owned there.
 */
import OpenAI from "openai";
import { getSubscriptionAccessToken } from "./oauth-subscriptions";

export const PROFUNDO_CLIENT_MARKER = Symbol("profundo-client");

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

function markProviderImmediatelyUnhealthy(provider: string, reason: string) {
  providerHealthCache.set(provider, {
    failedAt: Date.now(),
    reason,
    attempts: PROVIDER_HEALTH_MAX_ATTEMPTS,
  });
  console.warn(`[providers] Marked ${provider} unhealthy (attempt ${PROVIDER_HEALTH_MAX_ATTEMPTS}): ${reason.slice(0, 80)}`);
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

type BackgroundCompletionResolution = {
  client: OpenAI;
  actualModelId: string;
  route?: string;
};

type BackgroundCompletionResolveOptions = {
  forbidMeteredFallback?: boolean;
};

type ClientResolver = (
  modelId: string,
  tenantId?: number,
  options?: BackgroundCompletionResolveOptions,
) => Promise<BackgroundCompletionResolution>;

let resolveClientForModel: ClientResolver | undefined;
let getSubscriptionClient: ((provider: string, token: string) => OpenAI) | undefined;
let supportsSubscription: ((provider: string) => boolean) | undefined;

/** Connect the recovery lane to providers.ts without a circular runtime import. */
export function configureProviderRecovery(dependencies: {
  resolveClientForModel: ClientResolver;
  getSubscriptionClient: (provider: string, token: string) => OpenAI;
  supportsSubscription: (provider: string) => boolean;
}) {
  resolveClientForModel = dependencies.resolveClientForModel;
  getSubscriptionClient = dependencies.getSubscriptionClient;
  supportsSubscription = dependencies.supportsSubscription;
}

type ProviderError = {
  status?: number;
  response?: { status?: number };
  name?: string;
  code?: string;
  message?: string;
};

function providerError(err: unknown): ProviderError {
  return err !== null && typeof err === "object" ? err as ProviderError : {};
}

function isRetryableProfundoFailure(err: unknown): boolean {
  const details = providerError(err);
  const status = details.status ?? details.response?.status;
  if (status === 429 || (status !== undefined && status >= 500 && status <= 599)) return true;
  if (status != null) return false;
  const name = String(details.name || "");
  const code = String(details.code || "");
  return (
    name === "APIConnectionError" ||
    name === "APIConnectionTimeoutError" ||
    ["ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "ETIMEDOUT"].includes(code)
  );
}

/**
 * Background-only resilience boundary. A transient failure from the Profundo
 * flat-rate lane is retried exactly once through the existing zero-cost fallback.
 */
export async function createBackgroundCompletion(
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  options: { tenantId?: number; resolve?: ClientResolver } = {},
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const requestedModel = String(params?.model || "");
  const resolve = options.resolve ?? resolveClientForModel;
  if (!resolve) throw new Error("[providers] recovery lane was not configured");
  const first = await resolve(requestedModel, options.tenantId);
  try {
    return await first.client.chat.completions.create({ ...params, model: first.actualModelId });
  } catch (err: unknown) {
    const details = providerError(err);
    const usedProfundo =
      first.route === "profundo" ||
      Reflect.get(first.client, PROFUNDO_CLIENT_MARKER) === true;
    if (!usedProfundo || !isRetryableProfundoFailure(err)) throw err;
    markProviderImmediatelyUnhealthy(
      "profundo",
      `background retry: ${String(details.message || "transient failure").slice(0, 60)}`,
    );
    const fallback = await resolve(
      "gpt-5.4",
      options.tenantId,
      { forbidMeteredFallback: true },
    );
    if (fallback.route === "profundo" || Reflect.get(fallback.client, PROFUNDO_CLIENT_MARKER) === true) {
      throw err;
    }
    console.warn(`[providers] Profundo transient failure; retrying background completion via ${fallback.actualModelId}`);
    return fallback.client.chat.completions.create({ ...params, model: fallback.actualModelId });
  }
}

export async function trySubscriptionAuth(provider: string, tenantId: number | undefined): Promise<OpenAI | null> {
  if (!tenantId || !supportsSubscription?.(provider) || !getSubscriptionClient) return null;
  const failKey = `${provider}-${tenantId}`;
  const failEntry = subscriptionFailureCache.get(failKey);
  if (failEntry) {
    const ttl = failEntry.isRateLimit ? SUBSCRIPTION_RATE_LIMIT_TTL : SUBSCRIPTION_AUTH_FAILURE_TTL;
    if (Date.now() - failEntry.failedAt < ttl) return null;
    subscriptionFailureCache.delete(failKey);
  }
  try {
    const token = await getSubscriptionAccessToken(provider, tenantId);
    if (token) {
      console.log(`[providers] Using ${provider} subscription OAuth token for tenant ${tenantId}`);
      return getSubscriptionClient(provider, token);
    }
  } catch (err: unknown) {
    console.warn(`[providers] Subscription auth check failed for ${provider}:`, providerError(err).message);
  }
  return null;
}

export function preferOAuthSubscriptions(): boolean {
  const v = (process.env.PREFER_OAUTH_SUBSCRIPTIONS || "").trim().toLowerCase();
  if (!v) return true;
  return !(v === "false" || v === "0" || v === "no" || v === "off");
}

export function meteredLlmEnabled(): boolean {
  const v = (process.env.ALLOW_METERED_LLM || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

export const LAST_RESORT_MODEL = "claude-fable-5";
let lastResortDay = "";
let lastResortCallsToday = 0;

export function lastResortEnabled(): boolean {
  const v = (process.env.LAST_RESORT_MODEL_ENABLED ?? "true").trim().toLowerCase();
  return v !== "false" && v !== "0" && v !== "no" && v !== "off";
}

function lastResortDailyMax(): number {
  const n = Number(process.env.LAST_RESORT_DAILY_MAX);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 10;
}

export function claimLastResortSlot(label: string): boolean {
  if (!lastResortEnabled()) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastResortDay) {
    lastResortDay = today;
    lastResortCallsToday = 0;
  }
  const max = lastResortDailyMax();
  if (lastResortCallsToday >= max) {
    console.warn(`[last-resort] ${label}: daily cap hit (${lastResortCallsToday}/${max}) — NOT escalating to ${LAST_RESORT_MODEL}.`);
    return false;
  }
  lastResortCallsToday++;
  console.warn(`[last-resort] ${label}: escalating to ${LAST_RESORT_MODEL} (METERED, call ${lastResortCallsToday}/${max} today) — every other candidate model exhausted.`);
  return true;
}