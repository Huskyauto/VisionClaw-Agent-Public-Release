import { MODEL_REGISTRY } from "./model-registry";
import { siteConfig } from "./site-config";
import { logSilentCatch } from "./lib/silent-catch";

let lastModelFreshnessCheck = 0;
const MODEL_FRESHNESS_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

export const TEST_MODEL_IDS: Record<string, string> = {
  openai: "gpt-5-mini",
  anthropic: "claude-sonnet-4-5",
  xai: "grok-4",  // for validating user-supplied xAI API keys (test path only, not user-facing model selection)
  google: "gemini-2.5-flash",
  perplexity: "sonar",
  openrouter: "deepseek/deepseek-v3.2",
  openference: "openference/deepseek-v4-pro",
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