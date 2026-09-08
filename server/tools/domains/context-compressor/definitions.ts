/**
 * Tools-layer-split S28 — context-compressor-domain tool definition.
 *
 * `compress_context` — a single thin wrapper over server/context-compressor.ts.
 * Definition is a VERBATIM lift of the inline object literal previously in
 * server/tools.ts's TOOL_DEFINITIONS array — same name/description/parameters
 * (the LLM-facing contract is byte-identical); only its storage location
 * changes. The facade re-imports this const ref and splices it back at its
 * original array position.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const compressContextDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "compress_context",
    description: "Compress a long list of chat messages by keeping the head + tail and summarizing the middle through a cheap auxiliary model. Repairs orphan tool_call/tool_result pairs that would otherwise crash a strict provider. Use when you're about to delegate a long-running plan to a sub-agent and want to hand off a smaller context, or when you see a 'context window exceeded' error. Returns {compressed: messages[], stats: {originalTokens, finalTokens, droppedCount}}.",
    parameters: {
      type: "object",
      properties: {
        messages: { type: "array", description: "Array of {role, content} messages to compress.", items: { type: "object" } },
        targetTokens: { type: "number", description: "Target token budget for the output. Default 32000." },
        keepHead: { type: "number", description: "How many leading messages to keep verbatim. Default 2." },
        keepTail: { type: "number", description: "How many trailing messages to keep verbatim. Default 12." },
      },
      required: ["messages"],
    },
  },
};

export const contextCompressorDomainDefinitions: ToolDefinition[] = [
  compressContextDefinition,
];
