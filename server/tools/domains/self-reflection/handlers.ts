/**
 * Tools-layer-split S25p — self-reflection-domain migrated handlers.
 *
 * Selection: the 2 contiguous self-awareness tools — `introspect_tools`,
 * `self_diagnose`. Both backed by `server/self-reflection`, one coherent cluster.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, no added gate). Seam edits:
 *  - `introspect_tools` reads ONLY public params (`action`, `tool_name`,
 *    `query`) — no trust signals, so it moves verbatim.
 *  - `self_diagnose` read TWO stripped trust signals: `params._tenantId` and
 *    `params._personaId`. Both are in `TRUST_SIGNAL_KEYS` (server/tools/
 *    context.ts) and are DELETED from params before a handler runs, so they are
 *    read from the trusted ctx instead: `params._tenantId → ctx.tenantId`,
 *    `params._personaId → ctx.personaId`. No cast needed: both reads sit inside
 *    truthy guards (`ctx.tenantId ? … : []` and `if (lesson && ctx.tenantId)`)
 *    where TS narrows `ctx.tenantId` from `number|undefined` to `number`, and
 *    `storeLesson`'s third arg is `personaId?: number` (ctx.personaId fits).
 *    Runtime-identical: the dispatcher stamps ctx from the same pre-strip
 *    `params._tenantId`/`params._personaId` the legacy arm read.
 *  - All other reads (`params_used`, `result_received`, `expected_outcome`) and
 *    the diagnosis/lesson/return shapes are verbatim.
 *
 * The backing dependency (`../../../self-reflection`) is pulled via call-time
 * dynamic `import(...)` inside each handler — NOT a top-level static import — so
 * the domain module statically imports only within server/tools/ and cannot
 * recurse back into the app graph (acyclicity invariant, plan.md S2; mirrors the
 * scratchpad/agent-eval domains' seam).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  introspectToolsDefinition,
  selfDiagnoseDefinition,
} from "./definitions";

async function introspectToolsHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { introspectTool, searchTools, listToolSummaries } = await import("../../../self-reflection");
  if (params.action === "inspect") {
    if (!params.tool_name) return { error: "tool_name is required for 'inspect' action" };
    const schema = introspectTool(params.tool_name);
    if (!schema) return { error: `Tool "${params.tool_name}" not found. Use action "search" to find it.` };
    return { tool: schema };
  }
  if (params.action === "search") {
    if (!params.query) return { error: "query is required for 'search' action" };
    const results = await searchTools(params.query);
    return { matches: results, count: results.length };
  }
  const summaries = await listToolSummaries();
  return { tools: summaries, count: summaries.length };
}

async function selfDiagnoseHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { diagnoseToolResult, parseLessonFromDiagnosis, storeLesson, recallLessons } = await import("../../../self-reflection");
  if (!params.tool_name) return { error: "tool_name is required" };
  const existingLessons = ctx.tenantId ? await recallLessons(params.tool_name, ctx.tenantId) : [];
  const diagnosis = diagnoseToolResult({
    toolName: params.tool_name,
    paramsUsed: params.params_used || {},
    resultReceived: params.result_received || "",
    expectedOutcome: params.expected_outcome || "",
  });
  const lesson = parseLessonFromDiagnosis(params.tool_name, diagnosis, params.expected_outcome || "");
  if (lesson && ctx.tenantId) {
    await storeLesson(lesson, ctx.tenantId, ctx.personaId);
  }
  return {
    ...diagnosis,
    lessonStored: !!lesson,
    existingLessons: existingLessons.length > 0 ? existingLessons : undefined,
  };
}

/** Registered by ./index.ts at import time. */
export const selfReflectionDomainTools: RegisteredTool[] = [
  defineTool(introspectToolsDefinition, introspectToolsHandler),
  defineTool(selfDiagnoseDefinition, selfDiagnoseHandler),
];
