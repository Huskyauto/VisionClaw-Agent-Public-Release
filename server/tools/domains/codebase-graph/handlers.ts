/**
 * Tools-layer-split S27 — codebase-graph-domain migrated handlers.
 *
 * The codebase self-knowledge pair (2 tools): `codebase_graph_query` +
 * `codebase_diff_impact` (R98.27.8). Bodies are a MECHANICAL move of the legacy
 * switch arms (standing rules: no renames, no behavior change, no added/removed
 * gate; try/catch shape + error strings preserved VERBATIM).
 *
 * SEAM: NONE — both arms are PURE public-param wrappers over
 * `server/lib/codebase-graph`; NEITHER reads any dispatcher-stripped trust
 * signal (`_tenantId`/`_personaId`/`_conversationId`/`_projectId`), so `ctx` is
 * unused (verified against the deleted arms verbatim). The graph is a global
 * repo artifact, not tenant-scoped.
 *
 * `../../../lib/codebase-graph` is pulled via call-time dynamic `import(...)` —
 * NOT a top-level static import — so the domain module statically imports only
 * within server/tools/ and cannot recurse into the app graph (acyclicity
 * invariant, plan.md S2). `server/lib/codebase-graph` does not import the tools
 * facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  codebaseGraphQueryDefinition,
  codebaseDiffImpactDefinition,
} from "./definitions";

async function codebaseGraphQueryHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const { queryGraph } = await import("../../../lib/codebase-graph");
    const out = await queryGraph({
      file: typeof params.file === "string" ? params.file : undefined,
      exportName: typeof params.exportName === "string" ? params.exportName : undefined,
      layer: typeof params.layer === "string" ? params.layer : undefined,
      limit: typeof params.limit === "number" ? params.limit : undefined,
    });
    return out;
  } catch (e: any) {
    return { error: `codebase_graph_query failed: ${e?.message || String(e)}` };
  }
}

async function codebaseDiffImpactHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const { computeDiffImpact } = await import("../../../lib/codebase-graph");
    const out = await computeDiffImpact({
      baseRef: typeof params.baseRef === "string" ? params.baseRef : undefined,
      depth: typeof params.depth === "number" ? params.depth : undefined,
      changedFiles: Array.isArray(params.changedFiles) ? params.changedFiles.map((s: any) => String(s)) : undefined,
    });
    return out;
  } catch (e: any) {
    return { error: `codebase_diff_impact failed: ${e?.message || String(e)}` };
  }
}

/** Registered by ./index.ts at import time. */
export const codebaseGraphDomainTools: RegisteredTool[] = [
  defineTool(codebaseGraphQueryDefinition, codebaseGraphQueryHandler),
  defineTool(codebaseDiffImpactDefinition, codebaseDiffImpactHandler),
];
