/**
 * Tools-layer-split S28 — minds-domain migrated handlers.
 *
 * The Imbue-inspired autonomous multi-agent "Mind" family (2 tools):
 * `create_mind` + `mind_ticket`. Both are command-dispatch wrappers over
 * server/minds-engine.ts — bodies are a MECHANICAL move of the legacy switch
 * arms (standing rules: no renames, no behavior change, no added/removed gate;
 * command branches, field caps/slices, type coercions and error strings
 * preserved VERBATIM).
 *
 * SEAM (read-from-ctx, NOT re-stamp): each legacy arm read the dispatcher-
 * STRIPPED `params._tenantId` DIRECTLY for its admin-gate (`!== 1`), its
 * fail-closed tenant-context guard, AND the local `tenantId` threaded into
 * every minds-engine call. Migrated handlers read `ctx.tenantId` (the same
 * platform-derived value) in the SAME order with IDENTICAL guards and error
 * strings. `_tenantId` is the ONLY stripped signal these arms read — the
 * `personaId` fields (talkingPersonaId / thinkingPersonaId on create_mind,
 * personaId on mind_ticket delegate) are PUBLIC request params (worker
 * assignment), NOT the stripped `_personaId` trust signal (grepped — no
 * `_personaId`/`_conversationId`/`_projectId`).
 *
 * `./minds-engine` is pulled via call-time dynamic `import(...)` — NOT a
 * top-level static import — so the domain module statically imports only within
 * server/tools/ and cannot recurse into the app graph (acyclicity invariant,
 * plan.md S2). `server/minds-engine` does not import the tools facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { createMindDefinition, mindTicketDefinition } from "./definitions";

async function createMindHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.tenantId !== 1) return { error: "Admin-only tool" };
  if (!ctx.tenantId) return { error: "Tenant context required for create_mind" };
  const tenantId = ctx.tenantId;
  const command = params.command || "list";

  if (command === "create") {
    const name = typeof params.name === "string" ? params.name.slice(0, 200) : "";
    if (!name) return { error: "name is required" };
    const purpose = typeof params.purpose === "string" ? params.purpose.slice(0, 4000) : "";
    if (!purpose) return { error: "purpose is required" };
    const { createMind } = await import("../../../minds-engine");
    return createMind({
      tenantId,
      name,
      purpose,
      soul: typeof params.soul === "string" ? params.soul.slice(0, 2000) : undefined,
      talkingPersonaId: typeof params.talkingPersonaId === "number" ? params.talkingPersonaId : undefined,
      thinkingPersonaId: typeof params.thinkingPersonaId === "number" ? params.thinkingPersonaId : undefined,
      maxConcurrentWorkers: typeof params.maxConcurrentWorkers === "number" ? params.maxConcurrentWorkers : undefined,
    });
  }
  if (command === "list") {
    const { listMinds } = await import("../../../minds-engine");
    return listMinds(tenantId);
  }
  if (command === "dashboard") {
    if (!params.mindId) return { error: "mindId required for dashboard" };
    const { getMindDashboard } = await import("../../../minds-engine");
    return getMindDashboard(params.mindId, tenantId);
  }
  if (command === "update") {
    if (!params.mindId) return { error: "mindId required for update" };
    const { updateMind } = await import("../../../minds-engine");
    return updateMind(params.mindId, tenantId, {
      name: typeof params.name === "string" ? params.name : undefined,
      purpose: typeof params.purpose === "string" ? params.purpose : undefined,
      soul: typeof params.soul === "string" ? params.soul : undefined,
      maxConcurrentWorkers: typeof params.maxConcurrentWorkers === "number" ? params.maxConcurrentWorkers : undefined,
    });
  }
  if (command === "idle_check") {
    if (!params.mindId) return { error: "mindId required for idle_check" };
    const { processIdleCheck } = await import("../../../minds-engine");
    return processIdleCheck(params.mindId, tenantId);
  }
  return { error: `Unknown mind command: ${command}` };
}

async function mindTicketHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.tenantId !== 1) return { error: "Admin-only tool" };
  if (!ctx.tenantId) return { error: "Tenant context required for mind_ticket" };
  const tenantId = ctx.tenantId;
  const command = params.command || "list";

  if (command === "create") {
    if (!params.mindId) return { error: "mindId required for create" };
    const title = typeof params.title === "string" ? params.title.slice(0, 500) : "";
    if (!title) return { error: "title is required" };
    const { createTicket } = await import("../../../minds-engine");
    return createTicket({
      mindId: params.mindId,
      tenantId,
      title,
      description: typeof params.description === "string" ? params.description.slice(0, 4000) : "",
      acceptanceCriteria: typeof params.acceptanceCriteria === "string" ? params.acceptanceCriteria.slice(0, 2000) : undefined,
      priority: typeof params.priority === "number" ? params.priority : undefined,
      ticketType: typeof params.ticketType === "string" ? params.ticketType : undefined,
      dependsOn: Array.isArray(params.dependsOn) ? params.dependsOn.filter((n: any) => typeof n === "number") : undefined,
    });
  }
  if (command === "list") {
    if (!params.mindId) return { error: "mindId required for list" };
    const { listTickets } = await import("../../../minds-engine");
    return listTickets(params.mindId, tenantId, {
      status: typeof params.status === "string" ? params.status : undefined,
    });
  }
  if (command === "delegate") {
    if (!params.ticketId) return { error: "ticketId required for delegate" };
    const { delegateTicketToWorker } = await import("../../../minds-engine");
    return delegateTicketToWorker(params.ticketId, tenantId, {
      personaId: typeof params.personaId === "number" ? params.personaId : undefined,
      model: typeof params.model === "string" ? params.model : undefined,
    });
  }
  if (command === "verify") {
    if (!params.ticketId) return { error: "ticketId required for verify" };
    const { verifyTicketResult } = await import("../../../minds-engine");
    return verifyTicketResult(params.ticketId, tenantId);
  }
  if (command === "update_status") {
    if (!params.ticketId) return { error: "ticketId required for update_status" };
    const status = typeof params.status === "string" ? params.status : "";
    if (!status) return { error: "status is required" };
    const { updateTicketStatus } = await import("../../../minds-engine");
    return updateTicketStatus(params.ticketId, tenantId, status);
  }
  return { error: `Unknown mind_ticket command: ${command}` };
}

/** Registered by ./index.ts at import time. */
export const mindsDomainTools: RegisteredTool[] = [
  defineTool(createMindDefinition, createMindHandler),
  defineTool(mindTicketDefinition, mindTicketHandler),
];
