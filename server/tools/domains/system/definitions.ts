/**
 * Tools-layer-split S3 — system-domain tool DEFINITIONS (definitions only;
 * handlers stay in the legacy monolith until S4+).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 *
 * Each const below was moved VERBATIM from `server/tools.ts`, which now
 * references these consts in the exact original TOOL_DEFINITIONS array
 * positions — array order (and therefore the LLM-facing tool ordering and
 * `scripts/list-tools.ts` output) is byte-identical.
 */

import type { ToolDefinition } from "../../types";

export const testApiKeysDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "test_api_keys",
    description: "Test all configured AI provider API keys for connectivity. Returns status, latency, and details for each provider (OpenAI, Anthropic, xAI, Google, Perplexity, OpenRouter, Replit).",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const checkSystemStatusDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "check_system_status",
    description: "THE comprehensive self-test for THIS platform. Use it first whenever asked to \"test all the systems\", \"is everything working\", \"how is everything\", after a republish/deploy, when investigating a slow/odd response, or before a complex multi-tool plan. Returns the app's own web-server reachability (in-process loopback ping → {reachable, httpStatus, responseMs}), uptime, conversation/message counts, memory stats, heartbeat status, and active persona. DO NOT try to confirm the app's own server is up by browsing/curling localhost or 127.0.0.1 — those internal addresses are blocked by security policy; this tool reports web-server health directly. Pair with test_api_keys for provider/model connectivity.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const listModelsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_models",
    description: "Use when picking a model for a specific job, when an unfamiliar model_id appears in logs, or when troubleshooting \"why did my call route to X\". Returns every available model with name, provider, tier (free/cheap/premium), and capabilities. Pair with the cost-aware doctrine to pick the right tier. NOTE: For tasks needing parallel multi-agent orchestration OR genuinely massive context (>1M tokens), the top-end workhorse is x-ai/grok-4.20-multi-agent (2M context window, $1.25/$2.50 per M, premium — use sparingly).",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const templateScraperStatsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "template_scraper_stats",
    description: "Show all cached template-scrape recipes, how many times each has run from cache, and which have graduated to fully-deterministic execution. Use to audit cost savings from the template scraper.",
    parameters: { type: "object", properties: {} },
  },
};

export const getUsageAnalyticsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "get_usage_analytics",
    description: "Pull this tenant's chat-usage analytics for the last N days: total sessions/messages, estimated tokens in/out, estimated cost in USD, breakdown by model, tool-usage histogram, activity by hour-of-day and day-of-week, and the top sessions by token count. Use when Bob asks anything like 'how much am I spending', 'what's my usage', 'which model do I use most', 'when am I most active', or 'show me my analytics'. Default window is 30 days.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "number", description: "Window in days (default 30, max 365)." },
      },
      required: [],
    },
  },
};

/** All system-domain definitions migrated so far (S3). */
export const systemDomainDefinitions: ToolDefinition[] = [
  testApiKeysDefinition,
  checkSystemStatusDefinition,
  listModelsDefinition,
  templateScraperStatsDefinition,
  getUsageAnalyticsDefinition,
];
