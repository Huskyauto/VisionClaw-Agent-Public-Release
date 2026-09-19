/**
 * Tools-layer-split S27 — codebase-graph-domain tool definitions.
 *
 * The codebase self-knowledge pair (2 tools): `codebase_graph_query` +
 * `codebase_diff_impact` (R98.27.8). Both are thin wrappers over
 * `server/lib/codebase-graph` (`queryGraph` / `computeDiffImpact`).
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they
 * were inline object literals, not pre-existing const refs); the facade now
 * re-imports these const refs so the LLM-facing surface (name, description,
 * parameter schema, ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const codebaseGraphQueryDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "codebase_graph_query",
    description: "R98.27.8 — Query the self-knowledge graph of the VisionClaw codebase (Understand-Anything-inspired). Returns nodes (files) + their direct dependencies and dependents, layer-tagged (API / Lib / Data / Tools / Safety / Personas / Orchestration / Delivery / UI-* / Shared / Script). Use BEFORE running ripgrep blindly to find where something lives. Filter by `file` (path substring), `exportName` (substring of an exported function/class/const/type/interface), or `layer` (exact match). Combine filters to narrow. If no results, the file may not be a .ts/.tsx file or the graph may need rebuild (`npx tsx scripts/build-codebase-graph.ts`).",
    parameters: {
      type: "object",
      properties: {
        file: { type: "string", description: "Path substring to match (case-insensitive). E.g. 'delivery-pipeline' or 'safety/'. Omit to skip path filter." },
        exportName: { type: "string", description: "Substring of an exported symbol name. E.g. 'deliverDigitalProduct' or 'tenantId'. Omit to skip export filter." },
        layer: { type: "string", description: "Exact layer name. One of: API, Lib, Data, Tools, Safety, Personas, Orchestration, Delivery, Heartbeat, Server-Other, UI-Component, UI-Page, UI-Hook, UI-Lib, UI-Shadcn, UI-Other, Shared, Script." },
        limit: { type: "number", description: "Max nodes to return. Default 30, capped 200." },
      },
      required: [],
    },
  },
};

export const codebaseDiffImpactDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "codebase_diff_impact",
    description: "R98.27.8 — Compute blast-radius for the current uncommitted change set (or against a specific git ref). Returns directly-changed files plus the transitive set of files that import them, layer-tagged so you can SEE which sensitive layers (Data / Tools / Safety / API / Personas / Orchestration / Delivery) are touched before committing. Run this BEFORE Auto Git Push and BEFORE the architect post-edit-code-review pass — feed the result into the review prompt so the architect knows where to look. `riskNotes` flags wide blast radius and sensitive-layer hits.",
    parameters: {
      type: "object",
      properties: {
        baseRef: { type: "string", description: "Git ref to diff against. Default 'HEAD~1'. Use 'HEAD' to compare against the working tree." },
        depth: { type: "number", description: "How many import-edge hops to traverse for transitive callers. Default 3, capped 6." },
        changedFiles: { type: "array", items: { type: "string" }, description: "Optional explicit list of changed files (skips git invocation). Useful for testing." },
      },
      required: [],
    },
  },
};

export const codebaseGraphDomainDefinitions: ToolDefinition[] = [
  codebaseGraphQueryDefinition,
  codebaseDiffImpactDefinition,
];
