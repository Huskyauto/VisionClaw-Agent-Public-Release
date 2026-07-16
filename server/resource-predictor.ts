import { MODEL_REGISTRY } from "./providers";

export interface ResourceEstimate {
  estimatedToolCalls: number;
  estimatedLlmCalls: number;
  estimatedTokens: { input: number; output: number; total: number };
  estimatedCostUsd: number;
  estimatedTimeSeconds: number;
  modelBreakdown: { model: string; calls: number; costUsd: number }[];
  riskLevel: "low" | "medium" | "high";
  recommendation: string;
}

export interface LiveCostTracker {
  startedAt: number;
  steps: StepCostEntry[];
  totalTokens: { input: number; output: number };
  totalCostUsd: number;
  elapsedMs: number;
  budgetExceeded: boolean;
}

interface StepCostEntry {
  tool: string;
  model: string;
  tokens: { input: number; output: number };
  costUsd: number;
  durationMs: number;
  timestamp: number;
}

export const MODEL_COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-5.4": { input: 2.50, output: 15.00 },
  // R125+137.3 — platform default since the Sol migration; flagship-class estimate
  // (matches gpt-5.4) pending a verified live rate. Keep in sync with cost-ledger +
  // insights-engine (cross-map drift guard: tests/cost/model-pricing-drift.test.ts).
  "gpt-5.6-sol": { input: 2.50, output: 15.00 },
  "gpt-5-mini": { input: 0.25, output: 2.00 },
  "gpt-4.1": { input: 2.00, output: 8.00 },
  "gpt-4.1-mini": { input: 0.40, output: 1.60 },
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
  "claude-opus-4-20250514": { input: 15.00, output: 75.00 },
  "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
  "claude-opus-4-6": { input: 15.00, output: 75.00 },
  "claude-opus-4-7": { input: 5.00, output: 25.00 },
  "claude-opus-4-8": { input: 5.00, output: 25.00 },
  "claude-fable-5": { input: 5.00, output: 25.00 },
  "o4-mini": { input: 1.10, output: 4.40 },
  "o4-mini-openai": { input: 1.10, output: 4.40 },
  "gemini-2.5-flash": { input: 0.15, output: 0.60 },
  "gemini-3-flash-preview": { input: 0.50, output: 3.00 },
  "gemini-3-pro-preview": { input: 1.25, output: 5.00 },
  "gemini-3.1-pro-preview": { input: 1.25, output: 5.00 },
  "gemini-3.5-flash": { input: 1.25, output: 5.00 },
  "xiaomi/mimo-v2-flash": { input: 0.09, output: 0.09 },
  "xiaomi/mimo-v2-omni": { input: 0.15, output: 0.15 },
  "x-ai/grok-4.20-multi-agent": { input: 1.25, output: 2.50 },
  "x-ai/grok-4.5": { input: 2.00, output: 6.00 },
  "deepseek/deepseek-v3.2": { input: 0.214, output: 0.322 },
  "deepseek/deepseek-r1": { input: 0.55, output: 2.19 },
  "z-ai/glm-5.2": { input: 0.98, output: 3.08 },
  "z-ai/glm-5.1": { input: 0.966, output: 3.036 },
  "z-ai/glm-4.5-air:free": { input: 0.00, output: 0.00 },
  "google/gemma-4-31b-it": { input: 0.14, output: 0.14 },
  "moonshotai/kimi-k2.6": { input: 0.45, output: 1.50 },
  "meta-llama/llama-4-maverick": { input: 0.50, output: 0.77 },
  "nvidia/nemotron-3-super-120b-a12b": { input: 0.10, output: 0.50 },
  "google/gemini-3-flash-preview": { input: 0.50, output: 3.00 },
  "sonar": { input: 1.00, output: 1.00 },
  "sonar-pro": { input: 3.00, output: 15.00 },
  "sonar-reasoning-pro": { input: 2.00, output: 8.00 },
  "sonar-deep-research": { input: 2.00, output: 8.00 },
};

const TOOL_TIME_ESTIMATES: Record<string, number> = {
  web_search: 3,
  web_fetch: 4,
  browser: 8,
  analyze_pdf: 5,
  exec: 3,
  execute_code: 2,
  deep_research: 30,
  send_email: 2,
  delegate_task: 10,
  orchestrate: 20,
  debate: 15,
  plan_and_execute: 25,
  search_memory: 1,
  create_memory: 1,
  search_knowledge: 1,
  llm_task: 5,
  generate_chart: 3,
  critique_response: 3,
  tree_of_thought: 8,
  estimate_cost: 1,
  default: 2,
};

const TOOL_TOKEN_PROFILES: Record<string, { input: number; output: number }> = {
  deep_research: { input: 5000, output: 3000 },
  orchestrate: { input: 4000, output: 2500 },
  debate: { input: 3000, output: 2000 },
  plan_and_execute: { input: 4000, output: 2500 },
  tree_of_thought: { input: 3000, output: 2000 },
  llm_task: { input: 1500, output: 800 },
  delegate_task: { input: 2000, output: 1200 },
  critique_response: { input: 1500, output: 600 },
  web_search: { input: 500, output: 200 },
  web_fetch: { input: 500, output: 300 },
  browser: { input: 500, output: 500 },
  default: { input: 1000, output: 500 },
};

function getModelCost(modelId: string): { input: number; output: number } {
  if (MODEL_COST_PER_MILLION[modelId]) return MODEL_COST_PER_MILLION[modelId];

  const model = MODEL_REGISTRY.find(m => m.id === modelId);
  if (!model) return { input: 0.50, output: 2.00 };

  switch (model.tier) {
    case "fast": return { input: 0.15, output: 0.60 };
    case "balanced": return { input: 0.40, output: 1.60 };
    case "powerful": return { input: 3.00, output: 12.00 };
    case "reasoning": return { input: 1.50, output: 6.00 };
    default: return { input: 0.50, output: 2.00 };
  }
}

export function estimatePlanCost(
  steps: { tool?: string; description?: string }[],
  modelId: string = "gpt-5-mini"
): ResourceEstimate {
  const modelCost = getModelCost(modelId);
  let totalToolCalls = 0;
  let totalLlmCalls = 1;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTimeSeconds = 0;
  const modelBreakdown: { model: string; calls: number; costUsd: number }[] = [];

  totalInputTokens += 2000;
  totalOutputTokens += 500;
  totalTimeSeconds += 3;

  for (const step of steps) {
    if (step.tool) {
      totalToolCalls++;
      const toolTime = TOOL_TIME_ESTIMATES[step.tool] || TOOL_TIME_ESTIMATES.default;
      totalTimeSeconds += toolTime;

      const tokenProfile = TOOL_TOKEN_PROFILES[step.tool] || TOOL_TOKEN_PROFILES.default;

      if (["llm_task", "delegate_task", "deep_research", "orchestrate", "debate", "critique_response", "tree_of_thought"].includes(step.tool)) {
        totalLlmCalls++;
        totalInputTokens += tokenProfile.input;
        totalOutputTokens += tokenProfile.output;
      } else {
        totalInputTokens += tokenProfile.input;
        totalOutputTokens += tokenProfile.output;
      }
    } else {
      totalLlmCalls++;
      totalInputTokens += 1000;
      totalOutputTokens += 600;
    }

    totalTimeSeconds += 2;
  }

  const inputCost = (totalInputTokens / 1_000_000) * modelCost.input;
  const outputCost = (totalOutputTokens / 1_000_000) * modelCost.output;
  const totalCost = inputCost + outputCost;

  const plannerCost = (2500 / 1_000_000) * getModelCost("gemini-2.5-flash").input +
                      (500 / 1_000_000) * getModelCost("gemini-2.5-flash").output;

  const grandTotalCost = totalCost + plannerCost;

  modelBreakdown.push({
    model: modelId,
    calls: totalLlmCalls,
    costUsd: Number(totalCost.toFixed(6)),
  });

  if (totalLlmCalls > 1) {
    modelBreakdown.push({
      model: "gemini-2.5-flash (planner/sub-tasks)",
      calls: 1,
      costUsd: Number(plannerCost.toFixed(6)),
    });
  }

  let riskLevel: "low" | "medium" | "high" = "low";
  if (grandTotalCost > 0.10) riskLevel = "high";
  else if (grandTotalCost > 0.02) riskLevel = "medium";

  let recommendation = "";
  if (riskLevel === "high") {
    recommendation = `This plan involves ${steps.length} steps and an estimated cost of $${grandTotalCost.toFixed(4)}. Consider breaking into smaller tasks or using a cheaper model tier.`;
  } else if (riskLevel === "medium") {
    recommendation = `Moderate cost plan (~$${grandTotalCost.toFixed(4)}). Execution should proceed normally.`;
  } else {
    recommendation = `Low-cost plan (~$${grandTotalCost.toFixed(4)}). Efficient execution expected.`;
  }

  return {
    estimatedToolCalls: totalToolCalls,
    estimatedLlmCalls: totalLlmCalls,
    estimatedTokens: {
      input: totalInputTokens,
      output: totalOutputTokens,
      total: totalInputTokens + totalOutputTokens,
    },
    estimatedCostUsd: Number(grandTotalCost.toFixed(6)),
    estimatedTimeSeconds: totalTimeSeconds,
    modelBreakdown,
    riskLevel,
    recommendation,
  };
}

export function estimateQueryCost(
  messageLength: number,
  modelId: string,
  expectedToolCalls: number = 0
): ResourceEstimate {
  const modelCost = getModelCost(modelId);

  const inputTokens = Math.ceil(messageLength / 4) + 2000;
  const outputTokens = Math.min(4000, Math.ceil(inputTokens * 0.8));

  const toolInputTokens = expectedToolCalls * 1000;
  const toolOutputTokens = expectedToolCalls * 500;

  const totalInput = inputTokens + toolInputTokens;
  const totalOutput = outputTokens + toolOutputTokens;

  const cost = (totalInput / 1_000_000) * modelCost.input +
               (totalOutput / 1_000_000) * modelCost.output;

  const timeSeconds = 3 + (expectedToolCalls * 3);

  return {
    estimatedToolCalls: expectedToolCalls,
    estimatedLlmCalls: 1 + (expectedToolCalls > 0 ? 1 : 0),
    estimatedTokens: { input: totalInput, output: totalOutput, total: totalInput + totalOutput },
    estimatedCostUsd: Number(cost.toFixed(6)),
    estimatedTimeSeconds: timeSeconds,
    modelBreakdown: [{ model: modelId, calls: 1, costUsd: Number(cost.toFixed(6)) }],
    riskLevel: cost > 0.05 ? "high" : cost > 0.01 ? "medium" : "low",
    recommendation: `Single query on ${modelId}: ~$${cost.toFixed(4)}, ~${timeSeconds}s.`,
  };
}

export function createLiveCostTracker(budgetUsd: number = 0.50): LiveCostTracker & { recordStep: (tool: string, model: string, usage?: any, durationMs?: number) => void; isOverBudget: () => boolean; getSummary: () => string } {
  const tracker: LiveCostTracker = {
    startedAt: Date.now(),
    steps: [],
    totalTokens: { input: 0, output: 0 },
    totalCostUsd: 0,
    elapsedMs: 0,
    budgetExceeded: false,
  };

  return {
    ...tracker,
    get steps() { return tracker.steps; },
    get totalTokens() { return tracker.totalTokens; },
    get totalCostUsd() { return tracker.totalCostUsd; },
    get elapsedMs() { return Date.now() - tracker.startedAt; },
    get budgetExceeded() { return tracker.totalCostUsd > budgetUsd; },
    get startedAt() { return tracker.startedAt; },

    recordStep(tool: string, model: string, usage?: any, durationMs: number = 0) {
      const modelCost = getModelCost(model);
      const inputTokens = usage?.prompt_tokens || usage?.input_tokens || 0;
      const outputTokens = usage?.completion_tokens || usage?.output_tokens || 0;

      const stepCost = (inputTokens / 1_000_000) * modelCost.input +
                       (outputTokens / 1_000_000) * modelCost.output;

      const entry: StepCostEntry = {
        tool,
        model,
        tokens: { input: inputTokens, output: outputTokens },
        costUsd: Number(stepCost.toFixed(8)),
        durationMs,
        timestamp: Date.now(),
      };

      tracker.steps.push(entry);
      tracker.totalTokens.input += inputTokens;
      tracker.totalTokens.output += outputTokens;
      tracker.totalCostUsd += stepCost;

      if (tracker.totalCostUsd > budgetUsd) {
        tracker.budgetExceeded = true;
        console.log(`[cost-tracker] Budget exceeded: $${tracker.totalCostUsd.toFixed(4)} > $${budgetUsd.toFixed(2)}`);
      }
    },

    isOverBudget() {
      return tracker.totalCostUsd > budgetUsd;
    },

    getSummary() {
      const elapsed = Date.now() - tracker.startedAt;
      return `${tracker.steps.length} steps | ${tracker.totalTokens.input + tracker.totalTokens.output} tokens | $${tracker.totalCostUsd.toFixed(4)} | ${(elapsed / 1000).toFixed(1)}s`;
    },
  };
}

export function estimateMessageComplexityCost(
  content: string,
  modelId: string,
  conversationLength: number
): { expectedCostUsd: number; expectedToolCalls: number; suggestCheaperModel: string | null } {
  const words = content.split(/\s+/).length;
  const hasCode = /```[\s\S]*?```/m.test(content);
  const hasMultipleQuestions = (content.match(/\?/g) || []).length >= 2;
  const isShort = words < 15 && !hasCode;

  let expectedTools = 0;
  if (/search|find|look up|research/i.test(content)) expectedTools += 1;
  if (/write.*email|send.*email|draft.*email/i.test(content)) expectedTools += 1;
  if (/create.*chart|generate.*chart|plot/i.test(content)) expectedTools += 1;
  if (/browse|visit|open.*url|go to/i.test(content)) expectedTools += 1;
  if (hasCode && /run|exec|test/i.test(content)) expectedTools += 1;
  if (hasMultipleQuestions) expectedTools += 1;

  const contextTokens = Math.min(conversationLength * 300, 8000);
  const messageTokens = Math.ceil(words * 1.3);
  const totalInputTokens = contextTokens + messageTokens + 1500;
  const totalOutputTokens = isShort ? 200 : Math.min(2000, totalInputTokens);

  const modelCost = getModelCost(modelId);
  const baseCost = (totalInputTokens / 1_000_000) * modelCost.input +
                   (totalOutputTokens / 1_000_000) * modelCost.output;
  const toolCost = expectedTools * 0.0003;
  const expectedCost = baseCost + toolCost;

  let suggestCheaperModel: string | null = null;
  if (isShort && !hasCode && modelCost.input > 0.50) {
    suggestCheaperModel = "gemini-2.5-flash";
  }

  return {
    expectedCostUsd: Number(expectedCost.toFixed(6)),
    expectedToolCalls: expectedTools,
    suggestCheaperModel,
  };
}
