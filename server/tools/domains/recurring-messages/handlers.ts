/**
 * Tools-layer-split S26d — recurring-messages-domain migrated handlers.
 *
 * Selection: the 3 recurring-schedule tools — `schedule_message` /
 * `list_scheduled_messages` / `cancel_scheduled_message`. Backed solely by
 * `server/recurring-messages` (`createScheduledMessage` / `listScheduledMessages` /
 * `cancelScheduledMessage`).
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added/removed gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): each legacy arm read the dispatcher-STRIPPED
 * `params._tenantId` DIRECTLY — for its fail-closed tenant-context guard
 * (`if (!params._tenantId) return { error: "Tenant context required for <tool> (cross-tenant isolation guard)" }`)
 * AND as the backing-lib `tenantId` scope. Migrated handlers read `ctx.tenantId`
 * (the same platform-derived value) in the SAME order with IDENTICAL error strings,
 * guards, and return shapes. `_tenantId` is the ONLY stripped signal these arms read
 * (grepped — no `_personaId`/`_conversationId`/`_projectId`). Every OTHER field
 * (`title`/`cron`/`prompt`/`channel`/`activeOnly`/`id`/target fields) is a PUBLIC
 * caller param and stays read from `params` verbatim.
 *
 * The backing `../../../recurring-messages` module is pulled via call-time dynamic
 * `import(...)` — NOT a top-level static import — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2). `recurring-messages` does not import the tools
 * facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  scheduleMessageDefinition,
  listScheduledMessagesDefinition,
  cancelScheduledMessageDefinition,
} from "./definitions";

async function scheduleMessageHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for schedule_message (cross-tenant isolation guard)" };
  const { createScheduledMessage } = await import("../../../recurring-messages");
  return await createScheduledMessage({
    title: params.title,
    cron: params.cron,
    naturalSchedule: params.naturalSchedule,
    prompt: params.prompt,
    expandViaPersona: params.expandViaPersona,
    target: {
      channel: params.channel,
      telegramChatId: params.telegramChatId,
      phoneNumber: params.phoneNumber,
      email: params.email,
      conversationId: params.conversationId,
    },
    tenantId: ctx.tenantId as number,
  });
}

async function listScheduledMessagesHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for list_scheduled_messages (cross-tenant isolation guard)" };
  const { listScheduledMessages } = await import("../../../recurring-messages");
  const list = await listScheduledMessages({ activeOnly: params.activeOnly, tenantId: ctx.tenantId as number });
  return { count: list.length, messages: list };
}

async function cancelScheduledMessageHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for cancel_scheduled_message (cross-tenant isolation guard)" };
  const { cancelScheduledMessage } = await import("../../../recurring-messages");
  return await cancelScheduledMessage(params.id, ctx.tenantId as number);
}

/** Registered by ./index.ts at import time. */
export const recurringMessagesDomainTools: RegisteredTool[] = [
  defineTool(scheduleMessageDefinition, scheduleMessageHandler),
  defineTool(listScheduledMessagesDefinition, listScheduledMessagesHandler),
  defineTool(cancelScheduledMessageDefinition, cancelScheduledMessageHandler),
];
