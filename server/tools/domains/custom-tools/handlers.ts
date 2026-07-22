/**
 * Tools-layer-split S29 — custom-tools domain migrated handlers.
 *
 * The custom-tool learning family (3 tools): create_tool, list_custom_tools,
 * delete_custom_tool — thin wrappers over server/tool-learning.ts. Bodies are a
 * MECHANICAL move of the legacy switch arms (standing rules: no renames, no
 * behavior change, no added/removed gate; error strings preserved VERBATIM).
 *
 * SEAM (read-from-ctx): each legacy arm read the dispatcher-STRIPPED
 * `params._tenantId` DIRECTLY as its fail-closed tenant guard AND as the
 * tenantId threaded to the tool-learning call. Migrated handlers read
 * `ctx.tenantId` (the same platform-derived value) with IDENTICAL guards and
 * error strings. `_tenantId` is the ONLY stripped signal these arms read — the
 * public `params.description` / `params.name` stay verbatim `params` reads.
 *
 * `../../../tool-learning` is pulled via call-time dynamic `import(...)` — NOT a
 * top-level static import — so the domain module statically imports only within
 * server/tools/ and cannot recurse into the app graph (acyclicity invariant,
 * plan.md S2). `server/tool-learning` has only a TYPE-ONLY import of the tools
 * facade (`import type { ToolDefinition }`) — erased at runtime, no cycle.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  createToolDefinition,
  listCustomToolsDefinition,
  deleteCustomToolDefinition,
} from "./definitions";

async function createToolHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { createCustomTool } = await import("../../../tool-learning");
  const tid = ctx.tenantId;
  if (!tid) return { error: "tenantId required for custom tool creation" };
  return createCustomTool(params.description, tid);
}

async function listCustomToolsHandler(
  _params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { listCustomTools } = await import("../../../tool-learning");
  const tid = ctx.tenantId;
  if (!tid) return { error: "tenantId required" };
  return { tools: await listCustomTools(tid) };
}

async function deleteCustomToolHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { deleteCustomTool } = await import("../../../tool-learning");
  const tid = ctx.tenantId;
  if (!tid) return { error: "tenantId required" };
  return deleteCustomTool(params.name, tid);
}

/** Registered by ./index.ts at import time. */
export const customToolsDomainTools: RegisteredTool[] = [
  defineTool(createToolDefinition, createToolHandler),
  defineTool(listCustomToolsDefinition, listCustomToolsHandler),
  defineTool(deleteCustomToolDefinition, deleteCustomToolHandler),
];
