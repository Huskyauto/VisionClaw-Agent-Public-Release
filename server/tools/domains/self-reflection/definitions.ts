/**
 * Tools-layer-split S25p — self-reflection-domain tool definitions.
 *
 * The 2 contiguous self-awareness tools (`introspect_tools`, `self_diagnose`) —
 * both backed by `server/self-reflection`, one coherent cluster (the agent's
 * own tool-registry introspection + post-hoc failure diagnosis).
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array; the
 * facade re-imports these const refs so the LLM-facing surface (names,
 * descriptions, parameter schemas, ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const introspectToolsDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "introspect_tools",
    description: "Inspect your own tool registry. Use 'list' to see all available tools, 'inspect' to get a specific tool's full parameter schema, or 'search' to find tools matching a capability query. This is your self-awareness layer — use it to understand what you can do before attempting a task, or to debug why a tool call didn't work as expected.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "inspect", "search"], description: "'list' = all tools, 'inspect' = full schema for one tool, 'search' = find tools by capability" },
        tool_name: { type: "string", description: "Tool name to inspect (required for 'inspect' action)" },
        query: { type: "string", description: "Capability search query (required for 'search' action), e.g. 'create presentation slides'" },
      },
      required: ["action"],
    },
  },
};

export const selfDiagnoseDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "self_diagnose",
    description: "Diagnose why a tool execution didn't produce the expected result. Analyzes the tool's schema against the parameters you used and the result you got, then suggests corrections. Automatically stores actionable lessons in memory so you don't repeat the same mistake. Use this AFTER a tool call produces unexpected results.",
    parameters: {
      type: "object",
      properties: {
        tool_name: { type: "string", description: "The tool that was called" },
        params_used: { type: "object", description: "The parameters you passed to the tool" },
        result_received: { type: "string", description: "Brief description of what the tool returned" },
        expected_outcome: { type: "string", description: "What you expected the tool to produce" },
      },
      required: ["tool_name", "expected_outcome"],
    },
  },
};

/** All self-reflection-domain definitions, in facade splice order. */
export const selfReflectionDomainDefinitions: ToolDefinition[] = [
  introspectToolsDefinition,
  selfDiagnoseDefinition,
];
