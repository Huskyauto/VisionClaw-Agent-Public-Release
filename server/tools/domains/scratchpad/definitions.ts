/**
 * Tools-layer-split S25o — scratchpad-domain tool definitions.
 *
 * The 2 contiguous delegation-scratchpad tools (`write_scratchpad`,
 * `read_scratchpad`) — both backed by `server/heartbeat`
 * (writeDelegationScratchpad / readDelegationScratchpad), one coherent cluster
 * (cross-agent shared state within a delegation chain).
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array; the
 * facade re-imports these const refs so the LLM-facing surface (names,
 * descriptions, parameter schemas, ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const writeScratchpadDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "write_scratchpad",
    description: "Write a key-value entry to the delegation scratchpad — shared state visible to parent and sibling agents in the same delegation chain. Use to pass intermediate results, discovered facts, or status updates between agents without polluting the conversation.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Short label for this entry (e.g. 'research_findings', 'slide_count', 'error_log')" },
        value: { type: "string", description: "The data to store" },
        chain_key: { type: "string", description: "Optional chain identifier. Defaults to current conversation." },
      },
      required: ["key", "value"],
    },
  },
};

export const readScratchpadDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "read_scratchpad",
    description: "Read all entries from the delegation scratchpad for a given chain. Returns entries written by any agent in the chain.",
    parameters: {
      type: "object",
      properties: {
        chain_key: { type: "string", description: "Optional chain identifier. Defaults to current conversation." },
      },
      required: [],
    },
  },
};

/** All scratchpad-domain definitions, in facade splice order. */
export const scratchpadDomainDefinitions: ToolDefinition[] = [
  writeScratchpadDefinition,
  readScratchpadDefinition,
];
