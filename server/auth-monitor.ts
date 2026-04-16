import { storage } from "./storage";
import { getClientForModel, clearClientCache, PROVIDER_CONFIG } from "./providers";

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

async function checkProvider(provider: string, apiKey: string): Promise<ProviderHealth> {
  const displayName = PROVIDER_CONFIG[provider]?.name || provider;
  const modelId = TEST_MODELS[provider];
  if (!modelId) {
    return { provider, displayName, status: "error", detail: "Unknown provider", lastChecked: Date.now() };
  }

  const start = Date.now();
  try {
    const { client, actualModelId } = await getClientForModel(modelId);
    const response = await client.chat.completions.create({
      model: actualModelId,
      messages: [{ role: "user", content: "Reply with only the word: connected" }],
      max_tokens: 10,
    });
    const latencyMs = Date.now() - start;
    const reply = response.choices?.[0]?.message?.content?.trim() || "";
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
    const msg = err.message || "Unknown error";

    let status: ProviderHealth["status"] = "error";
    if (msg.includes("401") || msg.includes("Unauthorized") || msg.includes("invalid_api_key") || msg.includes("expired")) {
      status = "expired";
    }

    return {
      provider,
      displayName,
      status,
      detail: msg.slice(0, 200),
      latencyMs,
      lastChecked: Date.now(),
    };
  }
}

export async function getProviderHealth(forceRefresh = false): Promise<Record<string, ProviderHealth>> {
  const now = Date.now();
  if (!forceRefresh && now - lastFullCheck < CHECK_INTERVAL_MS && healthCache.size > 0) {
    return Object.fromEntries(healthCache);
  }

  clearClientCache();
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
}, CHECK_INTERVAL_MS * 2);
