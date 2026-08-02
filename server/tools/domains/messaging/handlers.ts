/**
 * Tools-layer-split S26d — messaging-domain migrated handlers.
 *
 * Selection: the 2 channel-delivery tools — `send_message` / `messaging_status`.
 * Backed solely by `server/messaging-gateway` (`deliverMessage` / `getGatewayStatus`);
 * `send_message` additionally runs the outbound-redaction safety gate
 * (`server/lib/outbound-redaction` — `enforceOutbound`).
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added/removed gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): NEITHER of these two arms reads ANY
 * dispatcher-STRIPPED trust signal (grepped — no `_tenantId`/`_personaId`/
 * `_conversationId`/`_projectId`). They operate purely on PUBLIC caller params
 * (`channel`/`text`/`telegramChatId`/`phoneNumber`/`email`/`conversationId`) — which
 * stay read from `params` verbatim. The migration is therefore a pure relocation:
 * identical redaction gate, identical delivery call, identical return shape.
 *
 * The backing `../../../messaging-gateway` and `../../../lib/outbound-redaction`
 * modules are pulled via call-time dynamic `import(...)` — NOT top-level static
 * imports — so the domain module statically imports only within server/tools/ and
 * cannot recurse back into the app graph (acyclicity invariant, plan.md S2). Neither
 * backing module imports the tools facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  sendMessageDefinition,
  messagingStatusDefinition,
} from "./definitions";

async function sendMessageHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { enforceOutbound } = await import("../../../lib/outbound-redaction");
  const gate = enforceOutbound(String(params.text || ""), { surface: `send_message:${params.channel}` });
  if (!gate.ok) return { error: gate.error };
  const { deliverMessage } = await import("../../../messaging-gateway");
  const result = await deliverMessage({
    channel: params.channel,
    telegramChatId: params.telegramChatId,
    phoneNumber: params.phoneNumber,
    email: params.email,
    conversationId: params.conversationId,
  }, gate.payload);
  return gate.redacted ? { ...(result as any), redactionWarning: "Outbound payload redacted by R95 safety gate." } : result;
}

async function messagingStatusHandler(
  _params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { getGatewayStatus } = await import("../../../messaging-gateway");
  return await getGatewayStatus();
}

/** Registered by ./index.ts at import time. */
export const messagingDomainTools: RegisteredTool[] = [
  defineTool(sendMessageDefinition, sendMessageHandler),
  defineTool(messagingStatusDefinition, messagingStatusHandler),
];
