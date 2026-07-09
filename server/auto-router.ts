import { getClientForModel, getUnhealthyProviders } from "./providers";
import { MODEL_REGISTRY, getAvailableModels, type ModelInfo } from "./providers";
import { isClaudeRunnerAvailable } from "./claude-runner";

import { logSilentCatch } from "./lib/silent-catch";
const COST_RANK: Record<string, number> = { free: 0, cheap: 1, paid: 2 };

function getEffectiveCostClass(model: ModelInfo): "free" | "cheap" | "paid" {
  if (model.costClass) {
    if (model.provider === "anthropic" && model.costClass === "free" && !isClaudeRunnerAvailable()) {
      return "paid";
    }
    return model.costClass;
  }
  if (model.provider === "replit" || model.provider === "google") return "free";
  if (model.provider === "anthropic") return isClaudeRunnerAvailable() ? "free" : "paid";
  if (model.provider === "openai") return "free";
  return "paid";
}

export interface RouteDecision {
  modelId: string;
  label: string;
  reason: string;
  category: string;
  confidence: number;
}

/** The categories the router can route to — consumed by the Reasoning Front Door. */
export function listRouteCategories(): string[] {
  return Object.keys(TASK_CATEGORIES);
}

const TASK_CATEGORIES: Record<string, { models: string[]; description: string }> = {
  "simple-chat": {
    models: [
      "gpt-4.1",
      "claude-sonnet-4-20250514",
      "gpt-5.5",
    ],
    description: "Greetings, small talk, simple Q&A, yes/no, quick facts",
  },
  "general": {
    models: [
      "gpt-4.1",
      "claude-sonnet-4-20250514",
      "gpt-5.5",
    ],
    description: "General questions, summaries, explanations, light writing",
  },
  "writing": {
    models: [
      "gemini-3.5-flash",
      "gemini-3-flash-preview",
      "gpt-4.1",
      "claude-sonnet-4-20250514",
      "gpt-5.5",
      "z-ai/glm-5.2",
      "z-ai/glm-5.1",
      "deepseek/deepseek-v3.2",
    ],
    description: "Creative writing, essays, emails, long-form content, editing",
  },
  "coding": {
    models: [
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview",
      "gpt-5.5",
      "gpt-4.1",
      "deepseek/deepseek-v3.2",
      "xiaomi/mimo-v2-flash",
    ],
    description: "Code generation, debugging, refactoring, technical architecture (free Gemini + OpenAI-sub lanes only; Claude/Opus REMOVED from everyday routing — Opus is jury-only, Bob 2026-06-12 cost policy)",
  },
  "reasoning": {
    models: [
      "gemini-3.5-flash",
      "gpt-5.5",
      "o4-mini",
      "o4-mini-openai",
      "gemini-3.1-pro-preview",
      "deepseek/deepseek-r1",
      "deepseek/deepseek-v3.2",
      "z-ai/glm-5.2",
      "z-ai/glm-5.1",
    ],
    description: "Math, logic, puzzles, multi-step analysis, complex problem solving (free Gemini + OpenAI-sub lanes only; Claude/Opus REMOVED from everyday routing — Opus is jury-only, Bob 2026-06-12 cost policy)",
  },
  "research": {
    models: [
      "sonar",
      "sonar-pro",
      "sonar-reasoning-pro",
      "sonar-deep-research",
      "gemini-3.5-flash",
      "gemini-3-flash-preview",
      "gpt-4.1",
    ],
    description: "Web research, fact-checking, current events, deep investigation",
  },
  "vision": {
    models: [
      "gemini-3.5-flash",
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "xiaomi/mimo-v2-omni",
      "z-ai/glm-5.2",
      "z-ai/glm-5.1",
      "gpt-5.5",
    ],
    description: "Image analysis, visual understanding, OCR, describe images",
  },
  "agentic": {
    models: [
      "gemini-3.5-flash",
      "gpt-5.5",
      "gpt-4.1",
      "xiaomi/mimo-v2-flash",
      "x-ai/grok-4.20-multi-agent",
    ],
    description: "Multi-step tasks, tool use, delegation, workflow orchestration, video/media production (free Gemini + OpenAI-sub lanes only; Claude/Opus REMOVED from everyday routing — Opus is jury-only, Bob 2026-06-12 cost policy)",
  },
  "translation": {
    models: [
      "gpt-4.1",
      "claude-sonnet-4-20250514",
      "gpt-5.5",
    ],
    description: "Language translation, multilingual content",
  },
  "data-analysis": {
    models: [
      "gemini-3.5-flash",
      "gpt-4.1",
      "deepseek/deepseek-r1",
      "deepseek/deepseek-v3.2",
      "xiaomi/mimo-v2-flash",
    ],
    description: "Data analysis, spreadsheets, statistics, charts, structured data",
  },
};

const CLASSIFICATION_PROMPT = `You are a task classifier for an AI routing system. Analyze the user's message and determine the best task category.

Categories:
${Object.entries(TASK_CATEGORIES).map(([k, v]) => `- "${k}": ${v.description}`).join("\n")}

Also estimate the complexity:
- "low": Simple, quick response needed (1-2 sentences)
- "medium": Moderate detail needed (paragraph-level)
- "high": Complex, detailed, multi-step response needed

Respond with ONLY valid JSON, no other text:
{"category":"<category>","complexity":"low|medium|high","reason":"<brief 5-10 word reason>"}`;

function hasAttachments(message: string): boolean {
  return /<!-- attachments:/.test(message);
}

function hasImageAttachments(message: string): boolean {
  return /<!-- attachments:.*"type"\s*:\s*"image\//.test(message);
}

function looksLikeCode(message: string): boolean {
  return /```[\s\S]*```/.test(message) ||
    /(function|const|let|var|import|export|class|def |if\s*\(|for\s*\(|while\s*\()/.test(message) ||
    /(fix|debug|refactor|implement|code|program|script|API|endpoint|function|bug)/i.test(message);
}

function looksLikeResearch(message: string): boolean {
  return /(search|research|find out|look up|what is the latest|current events|news about|fact.?check)/i.test(message);
}

function looksLikeReasoning(message: string): boolean {
  return /(solve|calculate|prove|analyze|compare|evaluate|explain why|step by step|reasoning|logic|math|equation)/i.test(message);
}

const SIMPLE_GREETINGS = /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|good|great|bye|goodbye|gm|gn|lol|haha|yes|no|sure|nah|yep|nope|hmm|wow|damn|bruh|what's up|wassup|howdy|cheers|ty|thx|np|yw|k|kk|gotcha|roger|bet|word|dope|sick|lit|facts|cap|no cap|gg|gl|hf)\s*[!.?]*$/i;

const COMPLEX_KEYWORDS = new Set([
  "debug", "debugging", "implement", "implementation", "refactor",
  "patch", "traceback", "stacktrace", "exception", "error",
  "analyze", "analysis", "investigate", "architecture", "design",
  "compare", "benchmark", "optimize", "optimise", "review",
  "terminal", "shell", "pytest", "test", "tests",
  "plan", "planning", "delegate", "subagent", "cron",
  "docker", "kubernetes", "deploy", "migrate", "migration",
  "security", "vulnerability", "audit", "performance", "profil",
  "integrate", "integration", "workflow", "pipeline", "orchestrat",
]);

const URL_RE = /https?:\/\/|www\./i;

function looksLikeSimple(message: string): boolean {
  const stripped = message.replace(/<!-- attachments:[\s\S]*?-->\n?/, "").trim();
  if (SIMPLE_GREETINGS.test(stripped)) return true;

  const words = stripped.split(/\s+/);
  const charCount = stripped.length;

  if (charCount > 300 || words.length > 40) return false;
  if (URL_RE.test(stripped)) return false;

  const lowerWords = words.map(w => w.toLowerCase().replace(/[^a-z]/g, ""));
  if (lowerWords.some(w => COMPLEX_KEYWORDS.has(w))) return false;

  if (charCount <= 80 && words.length <= 12 && !looksLikeCode(stripped) && !looksLikeReasoning(stripped)) {
    return true;
  }

  return false;
}

function looksLikeDataAnalysis(message: string): boolean {
  return /(csv|spreadsheet|excel|pivot|chart|graph|histogram|scatter|data.*analy|statistic|regression|correlation|mean|median|standard deviation|aggregat)/i.test(message);
}

function looksLikeTranslation(message: string): boolean {
  return /(translat|convert.*to.*language|say.*in\s+(spanish|french|german|chinese|japanese|korean|arabic|hindi|portuguese|russian|italian)|locali[sz])/i.test(message);
}

function looksLikeAgentic(message: string): boolean {
  return /\b(video|youtube|produce|create.*video|make.*video|slideshow|slides?\b.*present|audio\b.*generat|narrat|tts|mp4|upload.*drive|send.*email.*link|delegate|orchestrat)\b/i.test(message);
}

function estimateComplexity(message: string): "low" | "medium" | "high" {
  const stripped = message.replace(/<!-- attachments:[\s\S]*?-->\n?/, "").trim();
  const words = stripped.split(/\s+/);
  const charCount = stripped.length;

  if (charCount <= 80 && words.length <= 12) return "low";
  if (charCount <= 300 && words.length <= 50) return "medium";
  return "high";
}

function quickClassify(message: string): { category: string; complexity: string } | null {
  if (hasImageAttachments(message)) return { category: "vision", complexity: "medium" };
  if (looksLikeAgentic(message)) return { category: "agentic", complexity: "high" };
  if (looksLikeResearch(message)) return { category: "research", complexity: "medium" };
  if (looksLikeDataAnalysis(message)) return { category: "data-analysis", complexity: estimateComplexity(message) };
  if (looksLikeTranslation(message)) return { category: "translation", complexity: "low" };

  const codeScore = looksLikeCode(message) ? 1 : 0;
  const reasonScore = looksLikeReasoning(message) ? 1 : 0;

  if (codeScore && !reasonScore) return { category: "coding", complexity: estimateComplexity(message) };
  if (reasonScore && !codeScore) return { category: "reasoning", complexity: estimateComplexity(message) };

  if (looksLikeSimple(message)) return { category: "simple-chat", complexity: "low" };

  return null;
}

// Fail-open hard timeout for the routing classifier LLM call (hot path — runs
// before the first streamed token of every "auto" chat turn). Env parse is
// clamped to a sane band so a typo'd/negative value can't collapse the
// classifier to an instant abort (or an unbounded hang).
export function parseTimeoutMs(raw: string | undefined, def: number, min = 1_000, max = 120_000): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= min && n <= max) return n;
  if (raw !== undefined && raw !== "") {
    // One-time boot warning: fail-open to the default, but never silently —
    // a typo'd env timeout hiding behind a plausible default is the silent-failure bug class.
    console.warn(`[parseTimeoutMs] invalid timeout value "${raw}" (allowed ${min}-${max}ms) — using default ${def}ms`);
  }
  return def;
}
const CLASSIFY_TIMEOUT_MS = parseTimeoutMs(process.env.AUTO_ROUTER_CLASSIFY_TIMEOUT_MS, 8_000);

async function llmClassify(message: string): Promise<{ category: string; complexity: string; reason: string }> {
  try {
    const truncated = message.length > 500 ? message.slice(0, 500) + "..." : message;

    // Cost policy (Bob 2026-06-14): classification is cheap autonomous work — lead with
    // the FREE Replit modelfarm lane (gemini-2.5-flash). Metered gemini-3.5-flash
    // (~$0.12/call, bills the Google API key) is a LAST-RESORT fallback only, never preferred.
    const classifierModels = [
      "gemini-2.5-flash",
      "gemini-3-flash-preview",
      "gpt-4.1-mini",
      "gpt-5-mini",
      "deepseek/deepseek-v3.2",
      "gemini-3.5-flash",
    ];

    let client;
    let modelId = "gemini-2.5-flash";

    const available = await getAvailableModels();
    const availableIds = new Set(available.map(m => m.id));
    const unhealthy = getUnhealthyProviders();

    for (const cm of classifierModels) {
      if (!availableIds.has(cm)) continue;
      const cmProvider = MODEL_REGISTRY.find(m => m.id === cm)?.provider;
      if (cmProvider && unhealthy.has(cmProvider)) continue;
      try {
        const result = await getClientForModel(cm);
        client = result.client;
        modelId = result.actualModelId;
        break;
      } catch (_silentErr) { logSilentCatch("server/auto-router.ts", _silentErr); }
    }

    if (!client) {
      for (const cm of classifierModels) {
        if (!availableIds.has(cm)) continue;
        try {
          const result = await getClientForModel(cm);
          client = result.client;
          modelId = result.actualModelId;
          break;
        } catch (_silentErr) { logSilentCatch("server/auto-router.ts", _silentErr); }
      }
    }

    if (!client) {
      const result = await getClientForModel("gemini-2.5-flash");
      client = result.client;
      modelId = result.actualModelId;
    }

    // Hard latency bound: classification sits on the chat hot path BEFORE any
    // token streams. A hung provider here used to hold the whole turn open for
    // minutes ("Routing to the best model…" stuck). Fail open to the heuristic
    // default after CLASSIFY_TIMEOUT_MS — a mis-routed model beats a dead turn.
    const classifyAbort = new AbortController();
    let classifyTimer: ReturnType<typeof setTimeout> | undefined;
    // HARD bound: race create() against the timeout so a provider that ignores
    // the abort signal can't hold the classifier (and thus the turn) open past
    // CLASSIFY_TIMEOUT_MS. On timeout we reject → the outer catch fails OPEN to
    // the heuristic default. The losing create() is aborted + its late settle
    // swallowed so it can never surface as an unhandled rejection.
    const classifyTimeoutP = new Promise<never>((_resolve, reject) => {
      classifyTimer = setTimeout(() => {
        classifyAbort.abort();
        reject(new Error(`classify timeout after ${CLASSIFY_TIMEOUT_MS}ms`));
      }, CLASSIFY_TIMEOUT_MS);
    });
    let resp;
    try {
      const createP = client.chat.completions.create({
        model: modelId,
        messages: [
          { role: "system", content: CLASSIFICATION_PROMPT },
          { role: "user", content: truncated },
        ],
        max_completion_tokens: 100,
      }, { signal: classifyAbort.signal });
      createP.catch(() => {});
      resp = await Promise.race([createP, classifyTimeoutP]);
    } finally {
      if (classifyTimer) clearTimeout(classifyTimer);
    }

    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (TASK_CATEGORIES[parsed.category]) {
        return {
          category: parsed.category,
          complexity: parsed.complexity || "medium",
          reason: parsed.reason || "Classified by AI",
        };
      }
    }
  } catch (err) {
    console.error("[auto-router] LLM classification failed:", err);
  }
  return { category: "general", complexity: "medium", reason: "Default fallback" };
}

const META_MODEL_IDS = new Set(["auto"]);

const PREMIUM_MODELS = new Set([
  "claude-sonnet-4-20250514", "claude-opus-4-20250514",
  "claude-sonnet-4-6", "claude-opus-4-6",
  "x-ai/grok-4.20-multi-agent", "deepseek/deepseek-v3.2",
]);

const OAUTH_MODELS = new Set([
  "gpt-5.5", "gpt-4.1", "gpt-4.1-mini", "gpt-5-mini",
  "o4-mini", "o4-mini-openai",
  "gemini-3.5-flash",
  "gemini-3.1-pro-preview", "gemini-3-pro-preview",
  "gemini-3-flash-preview", "gemini-2.5-flash",
]);

// R77.5 (KisMATH §5.1-5.3): RLVR-trained models collapse the answer distribution
// to "exponential" (one peak, narrow exploration). For exploration-heavy categories
// — open-ended reasoning, ideation, debate, agentic planning — we prefer non-RLVR
// (distilled / sft / base) models because they keep "bell-shape" distributions and
// catch more candidate answers. For deterministic categories — coding,
// translation, simple-chat — RLVR is fine (better exploitation accuracy).
const EXPLORATION_CATEGORIES = new Set(["reasoning", "agentic", "research", "data-analysis"]);

function preferExplorationFriendly(category: string, complexity: string): boolean {
  if (!EXPLORATION_CATEGORIES.has(category)) return false;
  // For "low" complexity in exploration cats, RLVR exploitation wins (faster + cheaper).
  // Only steer away from RLVR when complexity is medium or high.
  return complexity === "medium" || complexity === "high";
}

function pickBestAvailable(preferredModels: string[], available: ModelInfo[], complexity: string, category?: string): ModelInfo | null {
  const concrete = available.filter(m => !META_MODEL_IDS.has(m.id));
  const exploreMode = category ? preferExplorationFriendly(category, complexity) : false;

  let sortedByPreferenceAndCost = preferredModels
    .map(id => concrete.find(m => m.id === id))
    .filter((m): m is ModelInfo => !!m)
    .sort((a, b) => {
      // R77.5: when exploring, demote RLVR models within the preferred list.
      if (exploreMode) {
        const aRl = a.trainingRegime === "rlvr" ? 1 : 0;
        const bRl = b.trainingRegime === "rlvr" ? 1 : 0;
        if (aRl !== bRl) return aRl - bRl;
      }
      const costA = COST_RANK[getEffectiveCostClass(a)] ?? 2;
      const costB = COST_RANK[getEffectiveCostClass(b)] ?? 2;
      return costA - costB;
    });

  if (sortedByPreferenceAndCost.length > 0) {
    const choice = sortedByPreferenceAndCost[0];
    if (exploreMode && choice.trainingRegime === "rlvr") {
      // No non-RLVR option in the preferred list — log it so we can refresh the
      // category whitelist if this happens often (KisMATH dictates we'd rather
      // ensemble than ride a single RLVR model on hard exploration tasks).
      console.log(`[auto-router] KisMATH-warn: exploration category "${category}" picked RLVR model ${choice.id} — no non-RLVR alternative available in preferred list`);
    }
    const alt = sortedByPreferenceAndCost.find(m => m.id !== choice.id);
    if (alt && getEffectiveCostClass(choice) !== "free") {
      console.log(`[auto-router] Cost-aware pick: ${choice.id} (${getEffectiveCostClass(choice)}), no free option available for category`);
    }
    return choice;
  }

  const fallbackPool = [...concrete].sort((a, b) => {
    const costA = COST_RANK[getEffectiveCostClass(a)] ?? 2;
    const costB = COST_RANK[getEffectiveCostClass(b)] ?? 2;
    return costA - costB;
  });

  if (complexity === "low") {
    const fast = fallbackPool.find(m => m.tier === "fast");
    if (fast) return fast;
  }
  if (complexity === "high") {
    const powerful = fallbackPool.find(m => m.tier === "powerful" && getEffectiveCostClass(m) === "free");
    if (powerful) return powerful;
    const cheapPowerful = fallbackPool.find(m => m.tier === "powerful");
    if (cheapPowerful) return cheapPowerful;
  }

  return fallbackPool.find(m => m.tier === "balanced") || fallbackPool[0] || null;
}

const TIER_RANK: Record<string, number> = { fast: 0, balanced: 1, powerful: 2, reasoning: 3 };

interface RoundHistory {
  round: number;
  tier: string;
  category: string;
  complexity: string;
  toolsUsed: string[];
}

const conversationRoundHistory = new Map<number, { history: RoundHistory[]; lastUpdatedAt: number }>();
const ROUND_HISTORY_TTL = 600_000;
const roundHistoryCleanup = setInterval(() => {
  const cutoff = Date.now() - ROUND_HISTORY_TTL;
  for (const [key, entry] of conversationRoundHistory) {
    if (entry.lastUpdatedAt < cutoff) conversationRoundHistory.delete(key);
  }
}, 120_000);
if (roundHistoryCleanup.unref) roundHistoryCleanup.unref();

function analyzeToolCallComplexity(toolsUsed: string[]): "low" | "medium" | "high" {
  if (toolsUsed.length === 0) return "low";

  const heavyTools = ["deep_research", "orchestrate", "debate", "plan_and_execute", "tree_of_thought", "delegate_task"];
  const mediumTools = ["web_search", "web_fetch", "browser", "execute_code", "llm_task", "critique_response"];

  const hasHeavy = toolsUsed.some(t => heavyTools.includes(t));
  const hasMedium = toolsUsed.some(t => mediumTools.includes(t));

  if (hasHeavy) return "high";
  if (hasMedium || toolsUsed.length >= 3) return "medium";
  return "low";
}

export function assessRoundComplexity(
  userMessage: string,
  roundIndex: number,
  previousModel: string,
  conversationId?: number,
  toolsUsedThisRound?: string[]
): {
  shouldDowngrade: boolean;
  shouldUpgrade: boolean;
  suggestedTier: "fast" | "balanced" | "powerful" | "reasoning";
  reason: string;
} {
  const currentModel = MODEL_REGISTRY.find(m => m.id === previousModel);
  const currentTier = currentModel?.tier || "balanced";

  const quick = quickClassify(userMessage);
  const category = quick?.category || "general";
  const complexity = quick?.complexity || "medium";

  const toolComplexity = toolsUsedThisRound ? analyzeToolCallComplexity(toolsUsedThisRound) : "low";

  if (conversationId) {
    const entry = conversationRoundHistory.get(conversationId) || { history: [], lastUpdatedAt: Date.now() };
    entry.history.push({
      round: roundIndex,
      tier: currentTier,
      category,
      complexity,
      toolsUsed: toolsUsedThisRound || [],
    });
    if (entry.history.length > 20) entry.history.shift();
    entry.lastUpdatedAt = Date.now();
    conversationRoundHistory.set(conversationId, entry);
  }

  let targetTier: "fast" | "balanced" | "powerful" | "reasoning";

  if (complexity === "low" && toolComplexity === "low" && (category === "simple-chat" || category === "general")) {
    targetTier = "fast";
  } else if (complexity === "low" && toolComplexity === "low") {
    targetTier = "balanced";
  } else if (complexity === "medium" || toolComplexity === "medium") {
    targetTier = "balanced";
  } else {
    targetTier = "powerful";
  }

  if (category === "reasoning") {
    targetTier = complexity === "low" ? "balanced" : "reasoning";
  }
  if (category === "coding" && complexity === "high") {
    targetTier = "powerful";
  }
  if (toolComplexity === "high") {
    targetTier = targetTier === "fast" ? "balanced" : targetTier;
  }

  if (conversationId) {
    const entry = conversationRoundHistory.get(conversationId);
    if (entry) {
      const recentHeavy = entry.history.slice(-3).filter(h =>
        h.toolsUsed.some(t => ["deep_research", "orchestrate", "plan_and_execute"].includes(t))
      ).length;
      if (recentHeavy >= 2 && targetTier === "fast") {
        targetTier = "balanced";
      }
    }
  }

  const targetRank = TIER_RANK[targetTier] ?? 1;
  const currentRank = TIER_RANK[currentTier] ?? 1;

  if (roundIndex === 0) {
    return { shouldDowngrade: false, shouldUpgrade: false, suggestedTier: currentTier as any, reason: "First round — no change" };
  }

  if (targetRank < currentRank && (currentRank - targetRank >= 1)) {
    return {
      shouldDowngrade: true,
      shouldUpgrade: false,
      suggestedTier: targetTier,
      reason: `Round ${roundIndex}: "${category}" (${complexity}, tools: ${toolComplexity}) needs only ${targetTier} tier, currently on ${currentTier}`,
    };
  }

  if (targetRank > currentRank) {
    return {
      shouldUpgrade: true,
      shouldDowngrade: false,
      suggestedTier: targetTier,
      reason: `Round ${roundIndex}: "${category}" (${complexity}, tools: ${toolComplexity}) needs ${targetTier} tier, upgrading from ${currentTier}`,
    };
  }

  return { shouldDowngrade: false, shouldUpgrade: false, suggestedTier: currentTier as any, reason: "Tier is appropriate" };
}

export function getConversationRoundHistory(conversationId: number): RoundHistory[] {
  return conversationRoundHistory.get(conversationId)?.history || [];
}

export function clearConversationRoundHistory(conversationId: number): void {
  conversationRoundHistory.delete(conversationId);
}

export function getModelForTier(tier: "fast" | "balanced" | "powerful" | "reasoning", availableModels: ModelInfo[]): ModelInfo | null {
  const concrete = availableModels.filter(m => !META_MODEL_IDS.has(m.id));
  return concrete.find(m => m.tier === tier) || null;
}

export async function autoRouteModel(userMessage: string, tenantId?: number, categoryOverride?: string): Promise<RouteDecision> {
  const allAvailable = await getAvailableModels();
  const unhealthy = getUnhealthyProviders();
  let available = unhealthy.size > 0
    ? allAvailable.filter(m => !unhealthy.has(m.provider))
    : allAvailable;
  if (available.length === 0) available.push(...allAvailable);

  let throttlePremium = false;
  if (tenantId) {
    try {
      const { shouldThrottlePremium } = await import("./agentic/cost-ledger");
      throttlePremium = await shouldThrottlePremium(tenantId);
    } catch (_silentErr) { logSilentCatch("server/auto-router.ts", _silentErr); }
  }
  if (throttlePremium) {
    const filtered = available.filter(m => !m.id.includes("opus") && !m.id.includes("gpt-5.5"));
    if (filtered.length > 0) {
      available = filtered;
      console.log(`[auto-router] Tenant ${tenantId} burn ratio > 0.5 — downgrading away from premium models`);
    }
  }

  let category: string;
  let complexity: string;
  let reason: string;
  let patternMatched = false;

  // Reasoning Front Door override: when the agent has formed a confident plan,
  // ITS category drives routing — the classifier is demoted to a hint. Only a
  // category the router actually knows reaches here (validated upstream), and a
  // bad value still falls through to the classifier below.
  if (categoryOverride && TASK_CATEGORIES[categoryOverride]) {
    category = categoryOverride;
    complexity = estimateComplexity(userMessage);
    reason = "Reasoning front door: agent-selected route";
    patternMatched = true;
  } else {
    const quick = quickClassify(userMessage);
    if (quick) {
      category = quick.category;
      complexity = quick.complexity;
      reason = `Pattern match: ${category}`;
      patternMatched = true;
    } else {
      const result = await llmClassify(userMessage);
      category = result.category;
      complexity = result.complexity;
      reason = result.reason;
    }
  }

  if (complexity === "high" && category === "coding") {
    const preferred = TASK_CATEGORIES[category].models;
    const premiumCoding = preferred.filter(id =>
      id.includes("opus") || id.includes("gpt-5")
    );
    const rest = preferred.filter(id => !premiumCoding.includes(id));
    const chosen = pickBestAvailable(
      [...premiumCoding, ...rest],
      available,
      complexity,
      category,
    );
    if (chosen) {
      return {
        modelId: chosen.id,
        label: chosen.label,
        reason: `High complexity coding → premium model: ${reason}`,
        category,
        confidence: 0.95,
      };
    }
  }

  if (complexity === "high" && category === "agentic") {
    const preferred = TASK_CATEGORIES[category].models;
    const chosen = pickBestAvailable(preferred, available, complexity, category);
    if (chosen) {
      return {
        modelId: chosen.id,
        label: chosen.label,
        reason: `High complexity ${category}: ${reason}`,
        category,
        confidence: 0.85,
      };
    }
  }

  const preferredModels = TASK_CATEGORIES[category]?.models || TASK_CATEGORIES["general"].models;
  const chosen = pickBestAvailable(preferredModels, available, complexity, category);

  if (!chosen) {
    return {
      modelId: "deepseek/deepseek-v3.2",
      label: "DeepSeek V3.2",
      reason: "No preferred models available, using budget default",
      category: "general",
      confidence: 0.5,
    };
  }

  return {
    modelId: chosen.id,
    label: chosen.label,
    reason,
    category,
    confidence: patternMatched ? 0.9 : 0.8,
  };
}
