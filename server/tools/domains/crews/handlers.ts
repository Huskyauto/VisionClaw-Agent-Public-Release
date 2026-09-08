/**
 * Tools-layer-split S25t — crews-domain migrated handlers.
 *
 * Selection: the 2 crews tools — `create_crew` and `create_flow`. Both are
 * ADMIN-ONLY (tenant 1) and backed solely by `server/crews-engine` — one coherent
 * cluster (crewAI-inspired agent-team + event-driven-flow orchestration).
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): each legacy arm read the dispatcher-STRIPPED
 * trust signal `params._tenantId` THREE times — the admin-only check
 * (`params._tenantId !== 1`), the fail-closed tenant guard (`!params._tenantId`),
 * and the local `const tenantId`. `_tenantId` is a TRUST_SIGNAL_KEY stripped by the
 * dispatcher (server/tools/context.ts), so the migrated handlers read the trusted
 * `ctx.tenantId` instead. Same value (the dispatcher derives `ctx.tenantId` from the
 * same pre-strip `params._tenantId`), same order, same error strings — behavior is
 * byte-identical. The backing `crews-engine` fns take an explicit `tenantId` arg and
 * do NOT read `_tenantId`, so no re-stamp is needed.
 *
 * The backing `../../../crews-engine` module is pulled via call-time dynamic
 * `import(...)` inside each command branch — NOT a top-level static import — so the
 * domain module statically imports only within server/tools/ and cannot recurse back
 * into the app graph (acyclicity invariant, plan.md S2).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { createCrewDefinition, createFlowDefinition } from "./definitions";

async function createCrewHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.tenantId !== 1) return { error: "Admin-only tool" };
  if (!ctx.tenantId) return { error: "Tenant context required for create_crew" };
  const tenantId = ctx.tenantId;
  const command = params.command || "list";

  if (command === "create") {
    const name = typeof params.name === "string" ? params.name.slice(0, 255) : "";
    if (!name) return { error: "name is required" };
    const { createCrew } = await import("../../../crews-engine");
    return createCrew({
      tenantId,
      name,
      description: typeof params.description === "string" ? params.description.slice(0, 4000) : undefined,
      process: params.process === "hierarchical" ? "hierarchical" : "sequential",
      memoryEnabled: typeof params.memoryEnabled === "boolean" ? params.memoryEnabled : undefined,
    });
  }
  if (command === "list") {
    const { listCrews } = await import("../../../crews-engine");
    return listCrews(tenantId);
  }
  if (command === "get") {
    if (!params.crewId) return { error: "crewId required for get" };
    const { getCrewWithDetails } = await import("../../../crews-engine");
    // Type-only seam cast: engine returns `{...} | null`; legacy arm was `any`-typed
    // and returned the possibly-null value verbatim. Cast preserves that runtime
    // behavior (null still flows through unchanged) under ToolResult.
    return (await getCrewWithDetails(params.crewId, tenantId)) as ToolResult;
  }
  if (command === "update") {
    if (!params.crewId) return { error: "crewId required for update" };
    const { updateCrew } = await import("../../../crews-engine");
    return updateCrew(params.crewId, tenantId, {
      name: typeof params.name === "string" ? params.name : undefined,
      description: typeof params.description === "string" ? params.description : undefined,
      process: params.process === "hierarchical" ? "hierarchical" : params.process === "sequential" ? "sequential" : undefined,
      status: typeof params.status === "string" ? params.status : undefined,
    });
  }
  if (command === "delete") {
    if (!params.crewId) return { error: "crewId required for delete" };
    const { deleteCrew } = await import("../../../crews-engine");
    return deleteCrew(params.crewId, tenantId);
  }
  if (command === "add_agent") {
    if (!params.crewId) return { error: "crewId required for add_agent" };
    const name = typeof params.name === "string" ? params.name.slice(0, 255) : "";
    if (!name) return { error: "name is required for add_agent" };
    const role = typeof params.role === "string" ? params.role.slice(0, 500) : "";
    if (!role) return { error: "role is required for add_agent" };
    const goal = typeof params.goal === "string" ? params.goal.slice(0, 4000) : "";
    if (!goal) return { error: "goal is required for add_agent" };
    const { addCrewAgent } = await import("../../../crews-engine");
    return addCrewAgent({
      crewId: params.crewId,
      tenantId,
      name,
      role,
      goal,
      backstory: typeof params.backstory === "string" ? params.backstory.slice(0, 4000) : undefined,
      personaId: typeof params.personaId === "number" ? params.personaId : undefined,
      tools: Array.isArray(params.tools) ? params.tools.filter((t: any) => typeof t === "string") : undefined,
      allowDelegation: typeof params.allowDelegation === "boolean" ? params.allowDelegation : undefined,
    });
  }
  if (command === "remove_agent") {
    if (!params.agentId) return { error: "agentId required for remove_agent" };
    const { removeCrewAgent } = await import("../../../crews-engine");
    return removeCrewAgent(params.agentId, tenantId);
  }
  if (command === "add_task") {
    if (!params.crewId) return { error: "crewId required for add_task" };
    const description = typeof params.description === "string" ? params.description.slice(0, 8000) : "";
    if (!description) return { error: "description is required for add_task" };
    const expectedOutput = typeof params.expectedOutput === "string" ? params.expectedOutput.slice(0, 4000) : "";
    if (!expectedOutput) return { error: "expectedOutput is required for add_task" };
    const { addCrewTask } = await import("../../../crews-engine");
    return addCrewTask({
      crewId: params.crewId,
      tenantId,
      name: typeof params.name === "string" ? params.name.slice(0, 255) : undefined,
      description,
      expectedOutput,
      agentId: typeof params.agentId === "number" ? params.agentId : undefined,
      contextTaskIds: Array.isArray(params.contextTaskIds) ? params.contextTaskIds.filter((n: any) => typeof n === "number") : undefined,
      tools: Array.isArray(params.tools) ? params.tools.filter((t: any) => typeof t === "string") : undefined,
      guardrail: typeof params.guardrail === "string" ? params.guardrail.slice(0, 2000) : undefined,
    });
  }
  if (command === "remove_task") {
    if (!params.taskId) return { error: "taskId required for remove_task" };
    const { removeCrewTask } = await import("../../../crews-engine");
    return removeCrewTask(params.taskId, tenantId);
  }
  if (command === "kickoff") {
    if (!params.crewId) return { error: "crewId required for kickoff" };
    const { kickoffCrew } = await import("../../../crews-engine");
    return kickoffCrew(params.crewId, tenantId, typeof params.inputs === "object" && params.inputs ? params.inputs : {});
  }
  if (command === "runs") {
    if (!params.crewId) return { error: "crewId required for runs" };
    const { listCrewRuns } = await import("../../../crews-engine");
    return listCrewRuns(params.crewId, tenantId);
  }
  if (command === "run_status") {
    if (!params.runId) return { error: "runId required for run_status" };
    const { getCrewRun } = await import("../../../crews-engine");
    // Type-only seam cast (see get-crew note): engine returns `CrewRun | null`;
    // legacy arm returned it verbatim. Runtime unchanged.
    return (await getCrewRun(params.runId, tenantId)) as ToolResult;
  }
  return { error: `Unknown crew command: ${command}` };
}

async function createFlowHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.tenantId !== 1) return { error: "Admin-only tool" };
  if (!ctx.tenantId) return { error: "Tenant context required for create_flow" };
  const tenantId = ctx.tenantId;
  const command = params.command || "list";

  if (command === "create") {
    const name = typeof params.name === "string" ? params.name.slice(0, 255) : "";
    if (!name) return { error: "name is required" };
    const { createFlow } = await import("../../../crews-engine");
    return createFlow({
      tenantId,
      name,
      description: typeof params.description === "string" ? params.description.slice(0, 4000) : undefined,
    });
  }
  if (command === "list") {
    const { listFlows } = await import("../../../crews-engine");
    return listFlows(tenantId);
  }
  if (command === "add_step") {
    if (!params.flowId) return { error: "flowId required for add_step" };
    const name = typeof params.name === "string" ? params.name.slice(0, 255) : "";
    if (!name) return { error: "name is required for add_step" };
    const { addFlowStep } = await import("../../../crews-engine");
    return addFlowStep({
      flowId: params.flowId,
      tenantId,
      name,
      stepType: (params.stepType === "listen" || params.stepType === "router") ? params.stepType : "start",
      listenTo: Array.isArray(params.listenTo) ? params.listenTo.filter((s: any) => typeof s === "string") : undefined,
      routerOutputs: Array.isArray(params.routerOutputs) ? params.routerOutputs.filter((s: any) => typeof s === "string") : undefined,
      crewId: typeof params.crewId === "number" ? params.crewId : undefined,
      actionType: typeof params.actionType === "string" ? params.actionType : undefined,
      actionConfig: typeof params.actionConfig === "object" && params.actionConfig ? params.actionConfig : undefined,
    });
  }
  if (command === "list_steps") {
    if (!params.flowId) return { error: "flowId required for list_steps" };
    const { listFlowSteps } = await import("../../../crews-engine");
    return listFlowSteps(params.flowId, tenantId);
  }
  if (command === "kickoff") {
    if (!params.flowId) return { error: "flowId required for kickoff" };
    const { kickoffFlow } = await import("../../../crews-engine");
    return kickoffFlow(params.flowId, tenantId, typeof params.inputs === "object" && params.inputs ? params.inputs : {});
  }
  if (command === "delete") {
    if (!params.flowId) return { error: "flowId required for delete" };
    const { deleteFlow } = await import("../../../crews-engine");
    return deleteFlow(params.flowId, tenantId);
  }
  return { error: `Unknown flow command: ${command}` };
}

/** Registered by ./index.ts at import time. */
export const crewsDomainTools: RegisteredTool[] = [
  defineTool(createCrewDefinition, createCrewHandler),
  defineTool(createFlowDefinition, createFlowHandler),
];
