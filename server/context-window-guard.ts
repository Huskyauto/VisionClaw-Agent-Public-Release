const CHARS_PER_TOKEN_ESTIMATE = 3.5;

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-5.4": 1_000_000,
  "gpt-5-mini": 1_000_000,
  "gpt-4.1": 1_000_000,
  "gpt-4.1-mini": 1_000_000,
  "o4-mini": 200_000,
  "o4-mini-openai": 200_000,
  "claude-sonnet-4-20250514": 200_000,
  "claude-opus-4-20250514": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-opus-4-6": 200_000,
  "gemini-3.1-pro-preview": 1_000_000,
  "gemini-3-pro-preview": 1_000_000,
  "gemini-3-flash-preview": 1_000_000,
  "gemini-2.5-flash": 1_000_000,
  "grok-4": 256_000,
  "grok-3": 131_072,
  "grok-3-mini": 131_072,
  "moonshotai/kimi-k2.5": 131_072,
  "xiaomi/mimo-v2-flash": 256_000,
  "xiaomi/mimo-v2-omni": 256_000,
  "x-ai/grok-4.1-fast": 2_000_000,
  "deepseek/deepseek-v3.2": 128_000,
  "deepseek/deepseek-r1": 64_000,
  "z-ai/glm-5.1": 202_752,
  "z-ai/glm-4.5-air:free": 131_072,
  "google/gemma-4-31b-it": 131_072,
  "z-ai/glm-5": 80_000,
  "z-ai/glm-4.7-flash": 200_000,
  "nvidia/nemotron-3-super-120b-a12b": 131_072,
  "meta-llama/llama-4-maverick": 131_072,
  "google/gemini-3-flash-preview": 1_000_000,
  "sonar": 128_000,
  "sonar-pro": 200_000,
  "sonar-reasoning-pro": 200_000,
  "sonar-deep-research": 128_000,
};

const DEFAULT_CONTEXT_WINDOW = 128_000;
const WARN_USAGE_RATIO = 0.85;
const MAX_USAGE_RATIO = 0.95;
const RESERVED_OUTPUT_TOKENS = 16_384;

export interface ContextWindowInfo {
  modelId: string;
  contextWindow: number;
  estimatedTokens: number;
  usageRatio: number;
  reservedForOutput: number;
  availableTokens: number;
}

export type ContextGuardResult =
  | { action: "ok"; info: ContextWindowInfo }
  | { action: "warn"; info: ContextWindowInfo; message: string }
  | { action: "truncate"; info: ContextWindowInfo; message: string; truncateToMessages: number };

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

function estimateMessagesTokens(messages: Array<{ role: string; content: any }>): number {
  let total = 0;
  for (const msg of messages) {
    total += 4;
    if (typeof msg.content === "string") {
      total += estimateTokenCount(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && typeof part.text === "string") {
          total += estimateTokenCount(part.text);
        } else if (part.type === "image_url") {
          total += 765;
        }
      }
    }
    total += estimateTokenCount(msg.role);
  }
  return total;
}

export function getContextWindow(modelId: string): number {
  return MODEL_CONTEXT_WINDOWS[modelId] || DEFAULT_CONTEXT_WINDOW;
}

export function evaluateContextGuard(
  modelId: string,
  messages: Array<{ role: string; content: any }>
): ContextGuardResult {
  const contextWindow = getContextWindow(modelId);
  const estimatedTokens = estimateMessagesTokens(messages);
  const availableTokens = contextWindow - RESERVED_OUTPUT_TOKENS;
  const usageRatio = estimatedTokens / availableTokens;

  const info: ContextWindowInfo = {
    modelId,
    contextWindow,
    estimatedTokens,
    usageRatio,
    reservedForOutput: RESERVED_OUTPUT_TOKENS,
    availableTokens,
  };

  if (usageRatio > MAX_USAGE_RATIO) {
    const targetTokens = Math.floor(availableTokens * WARN_USAGE_RATIO);
    let cumulative = 0;
    let keepCount = 0;

    const systemMsg = messages[0];
    if (systemMsg) {
      cumulative += typeof systemMsg.content === "string"
        ? estimateTokenCount(systemMsg.content) + 4
        : 100;
    }

    const nonSystemMessages = messages.slice(1);
    for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
      const msg = nonSystemMessages[i];
      const msgTokens = typeof msg.content === "string"
        ? estimateTokenCount(msg.content) + 4
        : 100;
      if (cumulative + msgTokens > targetTokens) break;
      cumulative += msgTokens;
      keepCount++;
    }

    return {
      action: "truncate",
      info,
      message: `Context approaching limit: ~${estimatedTokens.toLocaleString()} of ${availableTokens.toLocaleString()} tokens (${Math.round(usageRatio * 100)}%). Truncating to ${keepCount + 1} messages.`,
      truncateToMessages: keepCount + 1,
    };
  }

  if (usageRatio > WARN_USAGE_RATIO) {
    return {
      action: "warn",
      info,
      message: `Context window at ${Math.round(usageRatio * 100)}%: ~${estimatedTokens.toLocaleString()} of ${availableTokens.toLocaleString()} tokens used.`,
    };
  }

  return { action: "ok", info };
}

export function truncateMessages(
  messages: Array<{ role: string; content: any }>,
  keepCount: number
): Array<{ role: string; content: any }> {
  if (messages.length <= keepCount) return messages;

  const systemMsg = messages[0]?.role === "system" ? messages[0] : null;
  const nonSystem = systemMsg ? messages.slice(1) : messages;

  const kept = nonSystem.slice(nonSystem.length - (keepCount - (systemMsg ? 1 : 0)));

  return systemMsg ? [systemMsg, ...kept] : kept;
}

export function extractDroppedMessagesSummary(
  messages: Array<{ role: string; content: any }>,
  keepCount: number
): string | null {
  if (messages.length <= keepCount) return null;

  const systemMsg = messages[0]?.role === "system" ? messages[0] : null;
  const nonSystem = systemMsg ? messages.slice(1) : messages;
  const dropCount = nonSystem.length - (keepCount - (systemMsg ? 1 : 0));
  if (dropCount <= 0) return null;

  const dropped = nonSystem.slice(0, dropCount);
  const summaryParts: string[] = [];
  for (const msg of dropped) {
    const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    const clean = text.replace(/<!--[\s\S]*?-->/g, "").trim();
    if (clean.length > 10) {
      summaryParts.push(`[${msg.role}]: ${clean.slice(0, 300)}`);
    }
  }

  if (summaryParts.length === 0) return null;
  return `Context snapshot (${dropped.length} messages dropped at ${new Date().toISOString()}):\n${summaryParts.join("\n")}`;
}

export function buildConversationSummary(
  droppedMessages: Array<{ role: string; content: any }>
): string {
  const userTopics: string[] = [];
  const assistantActions: string[] = [];
  const toolsUsed: Set<string> = new Set();
  let turnCount = 0;

  for (const msg of droppedMessages) {
    turnCount++;
    const text = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ")
        : JSON.stringify(msg.content);

    const clean = text.replace(/<!--[\s\S]*?-->/g, "").trim();
    if (!clean || clean.length < 10) continue;

    if (msg.role === "user") {
      userTopics.push(clean.slice(0, 200));
    } else if (msg.role === "assistant") {
      const snippet = clean.slice(0, 300);
      assistantActions.push(snippet);
      const toolMatches = clean.match(/\[tool:\s*(\w+)\]|Executing:\s*(\w+)|Called\s+(\w+)/gi);
      if (toolMatches) {
        for (const m of toolMatches) {
          const name = m.replace(/\[tool:\s*|\]|Executing:\s*|Called\s+/gi, "").trim();
          if (name) toolsUsed.add(name);
        }
      }
    }
  }

  const parts: string[] = [
    `[Conversation History Summary — ${turnCount} messages condensed]`,
  ];

  if (userTopics.length > 0) {
    const topicSample = userTopics.slice(-5).map((t, i) => `  ${i + 1}. ${t}`).join("\n");
    parts.push(`User discussed:\n${topicSample}`);
  }

  if (assistantActions.length > 0) {
    const actionSample = assistantActions.slice(-3).map((a, i) => `  ${i + 1}. ${a.slice(0, 200)}`).join("\n");
    parts.push(`Assistant actions:\n${actionSample}`);
  }

  if (toolsUsed.size > 0) {
    parts.push(`Tools used: ${[...toolsUsed].join(", ")}`);
  }

  return parts.join("\n\n");
}

export function truncateWithSummary(
  messages: Array<{ role: string; content: any }>,
  keepCount: number
): Array<{ role: string; content: any }> {
  if (messages.length <= keepCount) return messages;

  const systemMsg = messages[0]?.role === "system" ? messages[0] : null;
  const nonSystem = systemMsg ? messages.slice(1) : messages;
  const keepN = keepCount - (systemMsg ? 1 : 0) - 1;
  const dropCount = nonSystem.length - keepN;
  if (dropCount <= 0) return messages;

  const dropped = nonSystem.slice(0, dropCount);
  const kept = nonSystem.slice(dropCount);

  const summary = buildConversationSummary(dropped);
  const summaryMessage = {
    role: "system" as const,
    content: summary,
  };

  const result: Array<{ role: string; content: any }> = [];
  if (systemMsg) result.push(systemMsg);
  result.push(summaryMessage);
  result.push(...kept);

  return result;
}
