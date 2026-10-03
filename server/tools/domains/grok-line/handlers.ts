import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { grokSendMessageDefinition } from "./definitions";

async function grokSendMessageHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!Number.isSafeInteger(ctx.tenantId) || (ctx.tenantId as number) <= 0) {
    return { error: "A positive tenant context is required" };
  }
  if (ctx.personaId !== 2) {
    return { error: "grok_send_message is Felix-only" };
  }

  const message = params && typeof params === "object" && !Array.isArray(params) ? params.message : undefined;
  if (typeof message !== "string" || message.trim().length === 0 || message.length > 4000) {
    return { error: "message must contain 1–4000 non-whitespace characters" };
  }

  try {
    const { ownerTenantId } = await import("../../../agentic/autonomous-budget");
    const tenantId = ctx.tenantId as number;
    if (tenantId !== ownerTenantId()) {
      return { error: "grok_send_message is restricted to the owner tenant" };
    }

    const grokLine = await import("../../../grok-line");
    const personaId = ctx.personaId as number;
    try {
      const { outboxId, queuedAt } = await grokLine.sendGrokMessage(tenantId, personaId, message, ctx.conversationId);
      return { success: true, outboxId, queuedAt };
    } catch (error) {
      if (error instanceof grokLine.GrokLineRateLimitError) {
        return { error: "Grok Line message rate limit reached", status: 429 };
      }
      if (error instanceof grokLine.GrokLineDisabledError) {
        return { error: "Grok Line is disabled" };
      }
      if (error instanceof Error && error.name === "SparkLineContentError") {
        return { error: "Message rejected by Grok Line content policy" };
      }
      return { error: "Unable to queue Grok Line message" };
    }
  } catch {
    // Do not expose owner-lookup, import, database, or service internals to the model.
    return { error: "Unable to queue Grok Line message" };
  }
}

export const grokLineDomainTools: RegisteredTool[] = [
  defineTool(grokSendMessageDefinition, grokSendMessageHandler),
];
