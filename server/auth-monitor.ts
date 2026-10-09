import { storage } from "./storage";
import { PROVIDER_CONFIG } from "./providers";

export interface ProviderHealth {
  provider: string;
  displayName: string;
  status: "ok" | "expired" | "expiring_soon" | "error" | "disabled" | "unchecked";
  detail: string;
  latencyMs?: number;
  lastChecked: number;
  expiresAt?: number;
}

const healthCache = new Map<string, ProviderHealth>();
let lastFullCheck = 0;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

import { TEST_MODEL_IDS } from "./providers";
const TEST_MODELS = TEST_MODEL_IDS;

class ProviderProbeError extends Error {
  constructor(message: string, readonly authRejected: boolean) {
    super(message);
  }
}

export async function checkProvider(
  provider: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<ProviderHealth> {
  const displayName = PROVIDER_CONFIG[provider]?.name || provider;
  const providerConfig = PROVIDER_CONFIG[provider];
  const modelId = TEST_MODELS[provider];
  if (!modelId || !providerConfig?.baseUrl) {
    return { provider, displayName, status: "error", detail: "Unknown provider", lastChecked: Date.now() };
  }

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Provider health check timed out")),
    timeoutMs,
  );
  try {
    const isAnthropic = provider === "anthropic";
    const response = await fetchImpl(`${providerConfig.baseUrl}/${isAnthropic ? "messages" : "chat/completions"}`, {
      method: "POST",
      signal: controller.signal,
      headers: isAnthropic
        ? {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          }
        : {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
      body: JSON.stringify({
        model: modelId,
        // Perplexity's sonar models reject max_tokens < 16.
        ...(provider === "openai"
          ? { max_completion_tokens: 16 }
          : { max_tokens: 16 }),
        messages: [{ role: "user", content: "Reply with only the word: connected" }],
      }),
    });
    const responseText = await response.text();
    let payload: any = {};
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = { message: responseText };
      }
    }
    if (!response.ok) {
      const providerMessage = typeof payload?.error === "string"
        ? payload.error
        : payload?.error?.message || payload?.message || response.statusText || "Provider rejected the request";
      const safeMessage = apiKey
        ? String(providerMessage).replaceAll(apiKey, "[redacted]")
        : String(providerMessage);
      const credentialRejected = /(?:invalid|incorrect|expired|revoked)\s+(?:api\s*)?(?:key|credential)|(?:api\s*)?(?:key|credential)\s+(?:is\s+)?(?:invalid|incorrect|expired|revoked)/i.test(safeMessage);
      const authRejected = response.status === 401
        || response.status === 403
        || credentialRejected;
      throw new ProviderProbeError(`HTTP ${response.status}: ${safeMessage}`, authRejected);
    }

    const latencyMs = Date.now() - start;
    const reply = isAnthropic
      ? payload?.content?.[0]?.text?.trim() || ""
      : payload?.choices?.[0]?.message?.content?.trim() || "";
    return {
      provider,
      displayName,
      status: "ok",
      detail: `OK - replied "${reply}" (${latencyMs}ms)`,
      latencyMs,
      lastChecked: Date.now(),
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const msg = controller.signal.aborted
      ? "Provider health check timed out"
      : err.message || "Unknown error";

    const status: ProviderHealth["status"] =
      err instanceof ProviderProbeError && err.authRejected ? "expired" : "error";

    return {
      provider,
      displayName,
      status,
      detail: msg.slice(0, 200),
      latencyMs,
      lastChecked: Date.now(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getProviderHealth(forceRefresh = false): Promise<Record<string, ProviderHealth>> {
  const now = Date.now();
  if (!forceRefresh && now - lastFullCheck < CHECK_INTERVAL_MS && healthCache.size > 0) {
    return Object.fromEntries(healthCache);
  }

  const keys = await storage.getProviderKeys();
  const results: Record<string, ProviderHealth> = {};

  results["replit"] = {
    provider: "replit",
    displayName: "Replit AI (Built-in)",
    status: "ok",
    detail: "Always available - no API key needed",
    lastChecked: now,
  };

  const NON_AI_PROVIDERS = new Set(["google_drive_token", "google_drive", "gdrive", "agentmail", "browserless", "firecrawl", "github", "coinbase", "stripe", "elevenlabs_tts"]);

  for (const key of keys) {
    if (NON_AI_PROVIDERS.has(key.provider)) continue;
    if (!key.enabled) {
      results[key.provider] = {
        provider: key.provider,
        displayName: PROVIDER_CONFIG[key.provider]?.name || key.provider,
        status: "disabled",
        detail: "Key disabled",
        lastChecked: now,
      };
      continue;
    }

    const health = await checkProvider(key.provider, key.apiKey);
    results[key.provider] = health;
    healthCache.set(key.provider, health);
  }

  lastFullCheck = now;
  return results;
}

export function getAuthStatusCode(health: Record<string, ProviderHealth>): number {
  const providers = Object.values(health).filter(h => h.provider !== "replit");
  if (providers.length === 0) return 0;

  const hasExpired = providers.some(p => p.status === "expired");
  const hasExpiringSoon = providers.some(p => p.status === "expiring_soon");

  if (hasExpired) return 1;
  if (hasExpiringSoon) return 2;
  return 0;
}

export function getCachedHealth(): Record<string, ProviderHealth> {
  return Object.fromEntries(healthCache);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, health] of healthCache) {
    if (now - health.lastChecked > CHECK_INTERVAL_MS * 3) {
      healthCache.delete(key);
    }
  }
}, CHECK_INTERVAL_MS * 2).unref();
