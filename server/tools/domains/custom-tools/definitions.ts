/**
 * Tools-layer-split S29 — custom-tools domain tool DEFINITIONS.
 *
 * The custom-tool learning family (3 tools): create_tool, list_custom_tools,
 * delete_custom_tool. Each const below is a VERBATIM lift of the inline object
 * literal previously in server/tools.ts's TOOL_DEFINITIONS array — same
 * name/description/parameters (the LLM-facing contract is byte-identical); only
 * the storage location changes. The facade re-imports these const refs and
 * splices them back at their original array positions.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const createToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_tool",
    description: "Create a new custom tool that the AI agent can use in future conversations. Describe what the tool should do and the system will generate a safe, sandboxed implementation. Created tools persist across conversations. Use when a recurring task would benefit from a dedicated tool rather than repeated manual steps.",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "What the tool should do — be specific about inputs, outputs, and behavior" },
      },
      required: ["description"],
    },
  },
};

export const listCustomToolsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_custom_tools",
    description: "Use when auditing what custom tools the learning system has registered, when troubleshooting \"the agent has a tool I don't recognize\", or before delete_custom_tool. Returns custom-tool rows with name, description, usage count, active flag. Custom tools live alongside the 259 built-ins.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

export const deleteCustomToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "delete_custom_tool",
    description: "Use ONLY after explicit Bob approval to permanently remove a registered custom tool by name (typically because the tool turned out to be wrong, redundant, or unused). Returns success/failure. Cannot be undone — to temporarily disable, prefer toggling is_active via the custom-tool admin path.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The name of the custom tool to delete (e.g., custom_calculator)" },
      },
      required: ["name"],
    },
  },
};

export const customToolsDomainDefinitions: ToolDefinition[] = [
  createToolDefinition,
  listCustomToolsDefinition,
  deleteCustomToolDefinition,
];
