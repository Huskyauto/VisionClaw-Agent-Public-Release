/**
 * Tools-layer-split S25o — scratchpad-domain migrated handlers.
 *
 * Selection: the 2 contiguous delegation-scratchpad tools — `write_scratchpad`,
 * `read_scratchpad`. Both backed by `server/heartbeat`
 * (writeDelegationScratchpad / readDelegationScratchpad), one coherent cluster.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, no added gate). Seam edits:
 *  - `params._tenantId` (a stripped+re-stamped trust signal) → `ctx.tenantId`,
 *    PLUS a type-only cast (`ctx.tenantId as number`): both backing fns require
 *    a non-optional `number`, while `ctx.tenantId` is `number|undefined` and the
 *    legacy passed untyped `params._tenantId` (any). Runtime-identical — the
 *    dispatcher always stamps a real tenantId.
 *  - `params._conversationId` IS a trust signal (in TRUST_SIGNAL_KEYS — the
 *    dispatcher strips it), so the default chain-key fallback reads the trusted
 *    `ctx.conversationId` instead of the (now-absent) `params._conversationId`.
 *    Runtime-identical: the dispatcher stamps `ctx.conversationId` from the same
 *    `params._conversationId` the legacy arm read, so an omitted `chain_key`
 *    still resolves to `conv-<conversationId>` (NOT `conv-default`).
 *  - `params._personaName` is NOT a trust signal (deliberately absent from
 *    TRUST_SIGNAL_KEYS — see context.ts) — it stays a VERBATIM `params` read,
 *    exactly as the legacy arm consumed it (non-authoritative `agentName`
 *    passthrough).
 *
 * The `chain_key || conv-${conversationId || "default"}` fallbacks (source
 * swapped params→ctx per above), the `params._personaName || "Unknown"`
 * default, and the success/error return shapes are all otherwise verbatim. The backing dependency (`../../../heartbeat`) is
 * pulled via call-time dynamic `import(...)` inside each handler — NOT a
 * top-level static import — so the domain module statically imports only within
 * server/tools/ and cannot recurse back into the app graph (acyclicity
 * invariant, plan.md S2; mirrors the treasury/agent-eval domains' seam).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  writeScratchpadDefinition,
  readScratchpadDefinition,
} from "./definitions";

async function writeScratchpadHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { writeDelegationScratchpad } = await import("../../../heartbeat");
  const chainKey = params.chain_key || `conv-${ctx.conversationId || "default"}`;
  const success = await writeDelegationScratchpad(
    chainKey,
    ctx.tenantId as number,
    params._personaName || "Unknown",
    params.key,
    params.value,
  );
  return success
    ? { success: true, message: `Scratchpad entry "${params.key}" saved for chain ${chainKey}` }
    : { success: false, error: "Failed to write to scratchpad" };
}

async function readScratchpadHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { readDelegationScratchpad } = await import("../../../heartbeat");
  const rChainKey = params.chain_key || `conv-${ctx.conversationId || "default"}`;
  const entries = await readDelegationScratchpad(rChainKey, ctx.tenantId as number);
  return { entries, count: entries.length };
}

/** Registered by ./index.ts at import time. */
export const scratchpadDomainTools: RegisteredTool[] = [
  defineTool(writeScratchpadDefinition, writeScratchpadHandler),
  defineTool(readScratchpadDefinition, readScratchpadHandler),
];
