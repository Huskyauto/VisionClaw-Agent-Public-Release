/**
 * Tools-layer-split S33 — sessions-domain tool definitions.
 *
 * The 2 read-only session-inspection tools (`sessions_list`, `sessions_history`)
 * — backed solely by `server/sessions` (`sessionsList` / `sessionsHistory`).
 *
 * NOTE (partial domain, by design): `sessions_send` and `sessions_spawn` are NOT
 * migrated in this slice. `sessions_send` reads the caller-supplied
 * `_sourcePersonaName` trust signal (a persona-name-class channel not covered by
 * ToolContext — the deferred trust-seam carve-out, plan.md); `sessions_spawn`
 * delegates to the subagent module, a different backing family. Both stay as
 * legacy switch arms until their seams are ready (strangler-fig: arms migrate
 * independently). The migrated-surface guard tracks exactly which names moved.
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const sessionsListDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "sessions_list",
    description: "List active agent sessions (conversations) across the VisionClaw platform. Use to discover other agents/personas and their active sessions before sending inter-agent messages. Returns session keys, persona info, models, and activity timestamps.",
    parameters: {
      type: "object",
      properties: {
        kinds: {
          type: "array",
          items: { type: "string", enum: ["main", "group", "cron", "hook", "node", "other"] },
          description: "Filter by session kind(s). Omit to list all.",
        },
        limit: { type: "number", description: "Max sessions to return (default 50, max 200)" },
        activeMinutes: { type: "number", description: "Only sessions updated within the last N minutes" },
        messageLimit: { type: "number", description: "Include last N messages per session (0 = none, default 0)" },
      },
      required: [],
    },
  },
};

export const sessionsHistoryDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "sessions_history",
    description: "Use when continuing another agent's work, when auditing inter-agent communication, or when Bob asks \"what did <persona> say about X in that other thread\". Returns the full transcript of a target session by id. Pair with list_conversations to find the right session_id first.",
    parameters: {
      type: "object",
      properties: {
        sessionKey: { type: "string", description: "Session key (e.g. 'agent:1:webchat:conv:5') or session ID (conversation number)" },
        limit: { type: "number", description: "Max messages to return (default 100, max 500)" },
        includeTools: { type: "boolean", description: "Include tool call/result messages (default false)" },
      },
      required: ["sessionKey"],
    },
  },
};

export const sessionsDomainDefinitions: ToolDefinition[] = [
  sessionsListDefinition,
  sessionsHistoryDefinition,
];
