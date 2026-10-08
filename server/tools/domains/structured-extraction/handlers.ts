/**
 * Tools-layer-split S28 — structured-extraction-domain migrated handler.
 *
 * `template_scrape` — a thin wrapper over server/structured-extraction.ts. The
 * body is a MECHANICAL move of the legacy switch arm (standing rules: no
 * renames, no behavior change, no added/removed gate; the templateScrape call
 * shape and its passed fields preserved VERBATIM).
 *
 * SEAM (read-from-ctx, NOT re-stamp): the legacy arm read the dispatcher-
 * STRIPPED `params._tenantId` DIRECTLY and threaded it into the backing lib's
 * `_tenantId` argument (recipe-cache tenant scope). The migrated handler reads
 * `ctx.tenantId` (the same platform-derived value) into that same `_tenantId`
 * field. `_tenantId` is the ONLY stripped signal this arm reads (grepped — no
 * `_personaId`/`_conversationId`/`_projectId`).
 *
 * `./structured-extraction` is pulled via call-time dynamic `import(...)` — NOT
 * a top-level static import — so the domain module statically imports only
 * within server/tools/ and cannot recurse into the app graph (acyclicity
 * invariant, plan.md S2). `server/structured-extraction` does not import the
 * tools facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { templateScrapeDefinition } from "./definitions";

async function templateScrapeHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { templateScrape } = await import("../../../structured-extraction");
  return templateScrape({
    url: params.url,
    schema: params.schema,
    schemaName: params.schemaName,
    forceRegenerate: params.forceRegenerate,
    _tenantId: ctx.tenantId,
  });
}

/** Registered by ./index.ts at import time. */
export const structuredExtractionDomainTools: RegisteredTool[] = [
  defineTool(templateScrapeDefinition, templateScrapeHandler),
];
