import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { sparkSendMessageDefinition } from "./definitions";

async function sparkSendMessageHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!Number.isSafeInteger(ctx.tenantId) || (ctx.tenantId as number) <= 0) {
    return { error: "A positive tenant context is required" };
  }
  if (ctx.personaId !== 2) {
    return { error: "spark_send_message is Felix-only" };
  }

  const message = params && typeof params === "object" && !Array.isArray(params) ? params.message : undefined;
  if (typeof message !== "string" || message.trim().length === 0 || message.length > 4000) {
    return { error: "message must contain 1–4000 non-whitespace characters" };
  }

  try {
    const { ownerTenantId } = await import("../../../agentic/autonomous-budget");
    const tenantId = ctx.tenantId as number;
    if (tenantId !== ownerTenantId()) {
      return { error: "spark_send_message is restricted to the owner tenant" };
    }

    const sparkLine = await import("../../../spark-line");
    const personaId = ctx.personaId as number;
    try {
      const { outboxId, queuedAt } = await sparkLine.sendSparkMessage(tenantId, personaId, message, ctx.conversationId);
      return { success: true, outboxId, queuedAt };
    } catch (error) {
      if (error instanceof sparkLine.SparkLineRateLimitError) {
        return { error: "Spark Line message rate limit reached", status: 429 };
      }
      if (error instanceof sparkLine.SparkLineContentError) {
        return { error: "Message rejected by Spark Line content policy" };
      }
      return { error: "Unable to queue Spark Line message" };
    }
  } catch {
    // Keep service/import errors (which may contain credentials or internals)
    // out of the model-visible tool result.
    return { error: "Unable to queue Spark Line message" };
  }
}

export const sparkLineDomainTools: RegisteredTool[] = [
  defineTool(sparkSendMessageDefinition, sparkSendMessageHandler),
];