/**
 * Tools-layer-split S28 — context-compressor-domain migrated handler.
 *
 * `compress_context` — a thin wrapper over server/context-compressor.ts. The
 * body is a MECHANICAL move of the legacy switch arm (standing rules: no
 * renames, no behavior change, no added/removed gate; validation, param
 * coercions with the SAME defaults, and the stats payload shape preserved
 * VERBATIM — incl. the "messages must be an array of {role, content}" error).
 *
 * SEAM: NONE — the legacy arm read NO dispatcher-stripped trust signal
 * (no `_tenantId`/`_personaId`/`_conversationId`/`_projectId`; grepped). It is
 * a pure message-array transform, so `ctx` is intentionally unused.
 *
 * `./context-compressor` is pulled via call-time dynamic `import(...)` — NOT a
 * top-level static import — so the domain module statically imports only within
 * server/tools/ and cannot recurse into the app graph (acyclicity invariant,
 * plan.md S2). `server/context-compressor` does not import the tools facade
 * (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { compressContextDefinition } from "./definitions";

async function compressContextHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  if (!Array.isArray(params.messages)) return { error: "messages must be an array of {role, content}" };
  const { compressMessages, estimateMessagesTokens } = await import("../../../context-compressor");
  const originalTokens = estimateMessagesTokens(params.messages);
  const result = await compressMessages(params.messages, {
    protectFirstN: Number(params.keepHead) || 3,
    protectLastN: Number(params.keepTail) || 12,
    summaryTargetTokens: Number(params.targetTokens) || 2500,
  });
  const finalTokens = estimateMessagesTokens(result.messages);
  return {
    compressed: result.messages,
    stats: {
      originalTokens,
      finalTokens,
      tokensSaved: originalTokens - finalTokens,
      summarized: result.summarized,
      turnsSummarized: result.turnsSummarized,
    },
  };
}

/** Registered by ./index.ts at import time. */
export const contextCompressorDomainTools: RegisteredTool[] = [
  defineTool(compressContextDefinition, compressContextHandler),
];
