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

/**
 * Authorization-aware discovery filter (Aug 2026 architect finding).
 *
 * introspect_tools is surfaced to EVERY persona (tool-router ALWAYS_INCLUDE,
 * rung zero of the tool-escalation ladder), so its list/search/inspect output
 * must apply the SAME visibility rule persona-sync R115.1 applies to the
 * prompt doc: trustedPersonasOnly tools are hidden from non-trusted personas
 * unless the tool's extraAllowedPersonas names them. Fail-CLOSED: a missing /
 * unresolvable persona identity is treated as non-trusted (the runtime
 * destructive-tool gate is name-based and would block execution anyway —
 * discovery must not advertise what execution denies).
 *
 * Returns a predicate: (toolName) => visible-to-this-caller.
 */
async function buildToolVisibilityFilter(ctx: ToolContext): Promise<(toolName: string) => boolean> {
  const { TOOL_POLICIES, TRUSTED_PERSONA_NAMES } = await import("../../../safety/destructive-tool-policy");
  // Owner directive (Bob, Aug 2026): work running under the ADMIN tenant gets
  // FULL catalog visibility — no discovery limits on his own account. This is
  // visibility only; the runtime destructive-tool gate (persona-name-based,
  // approval flows, spend caps) still governs EXECUTION unchanged. Customer
  // tenants keep the persona-filtered view below.
  const { ADMIN_TENANT_ID } = await import("../../../tenant-constants");
  if (ctx.tenantId === ADMIN_TENANT_ID) return () => true;
  let personaName: string | undefined;
  if (typeof ctx.personaId === "number") {
    try {
      const { storage } = await import("../../../storage");
      personaName = (await storage.getPersona(ctx.personaId))?.name;
    } catch {
      personaName = undefined; // fail-closed below
    }
  }
  const trusted = !!personaName && TRUSTED_PERSONA_NAMES.has(personaName);
  return (toolName: string) => {
    if (trusted) return true;
    const pol = TOOL_POLICIES[toolName];
    if (!pol?.trustedPersonasOnly) return true;
    return !!personaName && (pol.extraAllowedPersonas?.includes(personaName) ?? false);
  };
}

async function introspectToolsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { introspectTool, searchTools, listToolSummaries } = await import("../../../self-reflection");
  const isVisible = await buildToolVisibilityFilter(ctx);
  if (params.action === "inspect") {
    if (!params.tool_name) return { error: "tool_name is required for 'inspect' action" };
    // Restricted tools are indistinguishable from nonexistent ones to
    // non-trusted callers (no oracle for probing the restricted set).
    if (!isVisible(params.tool_name)) return { error: `Tool "${params.tool_name}" not found. Use action "search" to find it.` };
    const schema = introspectTool(params.tool_name);
    if (!schema) return { error: `Tool "${params.tool_name}" not found. Use action "search" to find it.` };
    return { tool: schema };
  }
  if (params.action === "search") {
    if (!params.query) return { error: "query is required for 'search' action" };
    const results = await searchTools(params.query);
    const visible = results.filter((r: any) => isVisible(r?.name ?? r?.tool ?? ""));
    return { matches: visible, count: visible.length };
  }
  const summaries = await listToolSummaries();
  const visible = summaries.filter((s: any) => isVisible(s?.name ?? s?.tool ?? ""));
  return { tools: visible, count: visible.length };
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
