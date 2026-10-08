import { defineTool } from "../../define-tool";
import { copilotChatDefinition } from "./definitions";

export const copilotChatTool = defineTool(copilotChatDefinition, async (params, ctx) => {
  if (!ctx.tenantId || ![2, 3].includes(ctx.personaId ?? 0)) return { error: "Copilot requires trusted owner and Felix/Forge context" };
  const { ownerTenantId } = await import("../../../agentic/autonomous-budget");
  if (ctx.tenantId !== ownerTenantId() || !ctx.conversationId) return { error: "Copilot requires an authenticated owner conversation" };
  const { db } = await import("../../../db");
  const { sql } = await import("drizzle-orm");
  const result = await db.execute(sql`
    SELECT m.id, m.content FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.id = ${ctx.conversationId} AND c.tenant_id = ${ctx.tenantId} AND m.tenant_id = ${ctx.tenantId} AND m.role = 'user'
    ORDER BY m.id DESC LIMIT 1`);
  const ownerText = result.rows[0]?.content;
  const { approvedCopilotPrompt } = await import("../../../copilot-chat-policy");
  const prompt = approvedCopilotPrompt(ownerText);
  if (!prompt) return { error: "Bob must explicitly request Copilot in his latest message (for example: Copilot: explain this design). No context was sent." };
  const { runCopilotChat } = await import("../../../copilot-chat");
  return runCopilotChat({ tenantId: ctx.tenantId, prompt, model: params.model, ownerMessageId: result.rows[0].id });
});
