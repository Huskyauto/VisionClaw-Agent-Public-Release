/**
 * Tools-layer-split S26e — knowledge-nudges-domain tool definition.
 *
 * The single nudge-stats tool (`knowledge_nudge_stats`) — backed solely by
 * `server/knowledge-nudges` (`getNudgeStats`).
 *
 * Definition is moved VERBATIM from the legacy TOOL_DEFINITIONS array (it was an
 * inline object literal, not a pre-existing const ref); the facade now re-imports
 * this const ref so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const knowledgeNudgeStatsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "knowledge_nudge_stats",
    description: "View statistics about proactively-saved knowledge nudges — information the system auto-detected as high-value from user messages and saved without being asked. Shows total nudges, recent activity, and categories.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

export const knowledgeNudgesDomainDefinitions: ToolDefinition[] = [
  knowledgeNudgeStatsDefinition,
];
