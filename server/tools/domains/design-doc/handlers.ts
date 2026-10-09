/**
 * Tools-layer-split S25x — design-doc-domain migrated handler.
 *
 * Selection: the 1 native design-language extraction tool — `generate_design_doc`.
 * Backed solely by `server/design-doc-tool` (`generateDesignDoc`) — one coherent
 * cluster. (`deep_research`, the other web-adjacent remainder, was already migrated
 * to the research domain — not this slice.)
 *
 * Handler body is a MECHANICAL move of the legacy switch arm (standing rules: no
 * renames, no behavior change, no added/removed gate).
 *
 * SEAM (re-stamp, NOT read-from-ctx-only): the legacy arm was a bare passthrough
 * (`return generateDesignDoc(params || {})`) with NO `params._` read in the arm —
 * but the backing fn `generateDesignDoc` READS `params._tenantId` ITSELF
 * (server/design-doc-tool.ts:166 — `typeof params?._tenantId === "number" ?
 * params._tenantId : undefined`, used to best-effort attach the tenant for the
 * doc's optional persistence/cost path; the doc still returns when it's absent).
 * `_tenantId` is a dispatcher-STRIPPED trust signal (context.ts TRUST_SIGNAL_KEYS),
 * so a naive `generateDesignDoc(params)` in the migrated path would always pass
 * `_tenantId=undefined` and silently disable that tenant path. Fix (S25q re-stamp
 * precedent): the handler re-stamps `generateDesignDoc({ ...params, _tenantId:
 * ctx.tenantId })` — `ctx.tenantId` is the platform-derived value of the exact
 * pre-strip `params._tenantId` the legacy monolith read, so behavior is identical.
 * No OTHER stripped signal is read by `generateDesignDoc` (grepped: only `_tenantId`).
 *
 * The backing `../../../design-doc-tool` module is pulled via call-time dynamic
 * `import(...)` — NOT a top-level static import — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { generateDesignDocDefinition } from "./definitions";

async function generateDesignDocHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R125+37 — URL → semantic DESIGN.md. SSRF-jailed fetch (page + same-origin
  // CSS) + ONE LLM synthesis pass. The fetched (untrusted) page content is
  // fenced via wrapExternalContent INSIDE the tool before it reaches the
  // synthesizing model; raw HTML is never returned to the caller.
  const { generateDesignDoc } = await import("../../../design-doc-tool");
  return generateDesignDoc({ ...params, _tenantId: ctx.tenantId });
}

/** Registered by ./index.ts at import time. */
export const designDocDomainTools: RegisteredTool[] = [
  defineTool(generateDesignDocDefinition, generateDesignDocHandler),
];
