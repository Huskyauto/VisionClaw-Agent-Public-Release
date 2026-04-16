import fs from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), "data", "search-config.json");

export interface SearchConfig {
  provider: "perplexity" | "legacy";
  perplexity: {
    apiKey: string;
    baseUrl: string;
    model: string;
  };
}

const DEFAULT_CONFIG: SearchConfig = {
  provider: "legacy",
  perplexity: {
    apiKey: "",
    baseUrl: "",
    model: "sonar-pro",
  },
};

export function loadSearchConfig(): SearchConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch {}
  return { ...DEFAULT_CONFIG };
}

export function saveSearchConfig(config: Partial<SearchConfig>): SearchConfig {
  const current = loadSearchConfig();
  const merged = {
    ...current,
    ...config,
    perplexity: { ...current.perplexity, ...(config.perplexity || {}) },
  };
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

function resolveApiKey(config: SearchConfig): { key: string; baseUrl: string } | null {
  const explicit = config.perplexity.apiKey;
  const envPerplexity = process.env.PERPLEXITY_API_KEY;
  const envOpenRouter = process.env.OPENROUTER_API_KEY;

  const key = explicit || envPerplexity || envOpenRouter;
  if (!key) return null;

  if (config.perplexity.baseUrl) {
    return { key, baseUrl: config.perplexity.baseUrl };
  }

  if (key.startsWith("pplx-") || key === envPerplexity) {
    return { key, baseUrl: "https://api.perplexity.ai" };
  }
  if (key.startsWith("sk-or-") || key === envOpenRouter) {
    return { key, baseUrl: "https://openrouter.ai/api/v1" };
  }

  return { key, baseUrl: "https://openrouter.ai/api/v1" };
}

function resolveModel(config: SearchConfig, baseUrl: string): string {
  const m = config.perplexity.model || "sonar-pro";
  if (baseUrl.includes("openrouter.ai")) {
    return m.startsWith("perplexity/") ? m : `perplexity/${m}`;
  }
  return m.replace(/^perplexity\//, "");
}

export function isPerplexityAvailable(): boolean {
  const config = loadSearchConfig();
  if (config.provider !== "perplexity") return false;
  return resolveApiKey(config) !== null;
}

export interface PerplexityResult {
  success: boolean;
  query: string;
  answer?: string;
  citations?: string[];
  model?: string;
  error?: string;
}

export async function perplexitySearch(query: string): Promise<PerplexityResult> {
  const config = loadSearchConfig();
  const resolved = resolveApiKey(config);
  if (!resolved) {
    return { success: false, query, error: "No Perplexity/OpenRouter API key configured" };
  }

  const { key, baseUrl } = resolved;
  const model = resolveModel(config, baseUrl);
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(baseUrl.includes("openrouter.ai") ? { "HTTP-Referer": "https://visionclaw.app", "X-Title": "VisionClaw" } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a research assistant. Provide concise, factual answers with sources. Be direct and informative." },
          { role: "user", content: query },
        ],
        max_tokens: 2048,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error(`[perplexity] API error ${resp.status}:`, errText.slice(0, 200));
      return { success: false, query, error: `Perplexity API error: ${resp.status}` };
    }

    const data = await resp.json();
    const answer = data.choices?.[0]?.message?.content;
    const citations = data.citations || [];

    if (!answer) {
      return { success: false, query, error: "Empty response from Perplexity" };
    }

    return {
      success: true,
      query,
      answer,
      citations,
      model,
    };
  } catch (err: any) {
    console.error(`[perplexity] Search error:`, err.message);
    return { success: false, query, error: err.message };
  }
}

export function getSearchStatus(): {
  provider: string;
  available: boolean;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
} {
  const config = loadSearchConfig();
  const resolved = resolveApiKey(config);
  return {
    provider: config.provider,
    available: config.provider === "perplexity" ? !!resolved : true,
    model: config.perplexity.model || "sonar-pro",
    baseUrl: resolved?.baseUrl || config.perplexity.baseUrl || "",
    hasApiKey: !!resolved,
  };
}
