import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { instinctSendMessageDefinition } from "./definitions";

async function instinctSendMessageHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!Number.isSafeInteger(ctx.tenantId) || (ctx.tenantId as number) <= 0) {
    return { error: "A positive tenant context is required" };
  }
  if (ctx.personaId !== 2) return { error: "instinct_send_message is Felix-only" };
  const message = params && typeof params === "object" && !Array.isArray(params) ? params.message : undefined;
  if (typeof message !== "string" || message.trim().length === 0 || message.length > 4000) {
    return { error: "message must contain 1–4000 non-whitespace characters" };
  }
  try {
    const { ownerTenantId } = await import("../../../agentic/autonomous-budget");
    const tenantId = ctx.tenantId as number;
    if (tenantId !== ownerTenantId()) {
      return { error: "instinct_send_message is restricted to the owner tenant" };
    }
    const instinctLine = await import("../../../instinct-line");
    try {
      const { outboxId, queuedAt } = await instinctLine.sendInstinctMessage(
        tenantId, ctx.personaId as number, message,
        Number.isSafeInteger(ctx.conversationId) && (ctx.conversationId as number) > 0
          ? ctx.conversationId as number
          : undefined,
      );
      return { success: true, outboxId, queuedAt };
    } catch (error) {
      if (error instanceof instinctLine.InstinctLineRateLimitError) {
        return { error: "Instinct Line message rate limit reached", status: 429 };
      }
      if (error instanceof instinctLine.InstinctLineDisabledError) return { error: "Instinct Line is disabled" };
      if (error instanceof Error && error.name === "SparkLineContentError") {
        return { error: "Message rejected by Instinct Line content policy" };
      }
      return { error: "Unable to queue Instinct Line message" };
    }
  } catch {
    return { error: "Unable to queue Instinct Line message" };
  }
}

export const instinctLineDomainTools: RegisteredTool[] = [
  defineTool(instinctSendMessageDefinition, instinctSendMessageHandler),
];