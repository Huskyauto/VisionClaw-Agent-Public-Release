/**
 * Tools-layer-split S26e — user-modeling-domain tool definition.
 *
 * The single dialectic user-model tool (`user_model_query`) — backed solely by
 * `server/user-modeling` (`queryUserModel`).
 *
 * Definition is moved VERBATIM from the legacy TOOL_DEFINITIONS array (it was an
 * inline object literal, not a pre-existing const ref); the facade now re-imports
 * this const ref so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const userModelQueryDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "user_model_query",
    description: "Query the dialectic user model — a progressively-built profile of the user's communication style, decision patterns, preferences, and personality traits. Built automatically from conversation analysis. Use to understand how to personalize responses, predict user needs, or adapt tone and format. Optionally ask a specific question about the user.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "Optional specific question about the user (e.g., 'Does this user prefer detailed or concise responses?')" },
      },
      required: [],
    },
  },
};

export const userModelingDomainDefinitions: ToolDefinition[] = [
  userModelQueryDefinition,
];
