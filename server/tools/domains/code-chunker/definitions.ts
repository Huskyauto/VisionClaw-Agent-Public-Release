/**
 * Tools-layer-split S27 — code-chunker-domain tool definition.
 *
 * Single tool: `chunk_code` (cAST context-aware code splitting), a wrapper over
 * `server/code-chunker` (`chunkCodeContextAware` / `isSupportedCodeFile`).
 *
 * Definition is moved VERBATIM from the legacy TOOL_DEFINITIONS array (it was an
 * inline object literal, not a pre-existing const ref); the facade now re-imports
 * this const ref so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const chunkCodeDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "chunk_code",
    description: "Split a source file into context-aware chunks (cAST: Context-Aware Splitting Tree). Splits at top-level function/class/export boundaries (TS/JS/Python supported), with a header per chunk recording parentFile + symbol + line range. Falls back to fixed-size chunks for unsupported languages. Use to prepare code for embedding/indexing or to summarize long files in pieces.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Absolute or workspace-relative path to the source file." },
        maxTokens: { type: "number", description: "Soft max tokens per chunk (default 800)." },
        previewOnly: { type: "boolean", description: "If true, returns chunk metadata only (no content) — useful for very large files." },
      },
      required: ["filePath"],
    },
  },
};

export const codeChunkerDomainDefinitions: ToolDefinition[] = [
  chunkCodeDefinition,
];
