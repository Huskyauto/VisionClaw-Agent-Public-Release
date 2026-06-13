import { db } from "./db";
import { sql } from "drizzle-orm";

const CONVERSATIONAL_THRESHOLD = 4;

const PROJECT_SIGNAL_PATTERNS = [
  /\b(?:build|create|develop|design|make|set up|launch|start)\s+(?:a|an|the|my|our)?\s*(?:website|app|application|platform|tool|system|dashboard|landing page|api|service|bot|agent|brand|business|channel|campaign|newsletter|course|product|store|shop|portfolio)/i,
  /\b(?:write|draft|create|produce)\s+(?:a|an|the|my|our)?\s*(?:script|slide deck|presentation|proposal|pitch deck|business plan|marketing plan|content calendar|strategy|report|white paper|blog series)/i,
  /\b(?:research|analyze|investigate)\s+(?:and\s+)?(?:then\s+)?(?:write|create|build|produce|draft|develop)/i,
  /\b(?:help me|i need|i want|let's|we need to|can you)\s+(?:build|create|develop|design|launch|start|plan|set up)\b/i,
  /\b(?:youtube\s+channel|social media\s+(?:campaign|strategy)|email\s+(?:campaign|sequence)|content\s+strategy|brand\s+identity)/i,
  /\b(?:first|step\s+1|phase\s+1|let's start|getting started)\b.*\b(?:build|create|develop|design|launch)/i,
  /\b(?:project|roadmap|sprint|milestone|deliverable|timeline|deadline)\b/i,
  /\b(?:client|customer)\s+(?:wants|needs|asked for|requesting)/i,
];

const EXCLUDE_PATTERNS = [
  /\b(?:what is|who is|explain|tell me about|how does|define|what's the difference)\b/i,
  /\b(?:joke|fun fact|weather|time|date|hello|hi|hey|thanks|thank you)\b/i,
  /\b(?:fix|debug|error|bug|broken|not working|issue with)\b/i,
];

function shouldAutoCreateProject(userMessage: string, messageCount: number, allUserMessages?: string[]): boolean {
  for (const pat of EXCLUDE_PATTERNS) {
    if (pat.test(userMessage)) return false;
  }

  let signalScore = 0;
  const messagesToScan = allUserMessages?.length ? allUserMessages : [userMessage];
  for (const msg of messagesToScan) {
    for (const pat of PROJECT_SIGNAL_PATTERNS) {
      if (pat.test(msg)) { signalScore++; break; }
    }
  }

  const actionVerbs = (userMessage.match(/\b(build|create|develop|design|launch|write|draft|produce|research|analyze|deploy|plan|set up|implement|execute)\b/gi) || []);
  const uniqueActions = new Set(actionVerbs.map(v => v.toLowerCase()));
  if (uniqueActions.size >= 2) signalScore++;

  const conjunctions = (userMessage.match(/\b(and then|then|after that|next|finally|also|additionally|step \d)\b/gi) || []).length;
  if (conjunctions >= 2) signalScore++;

  if (messageCount >= CONVERSATIONAL_THRESHOLD && signalScore >= 1) {
    return true;
  }

  return signalScore >= 2;
}

function extractProjectName(conversationTitle: string, userMessages: string[]): string {
  const title = conversationTitle?.trim();
  if (title && title !== "New Chat" && title.length >= 3 && title.length <= 60) {
    return title;
  }

  for (const msg of userMessages.slice(0, 3)) {
    for (const pat of [
      /(?:build|create|develop|design|launch|start|set up)\s+(?:a|an|the|my|our)?\s*(.{5,40}?)(?:\.|,|!|\?|$|\band\b|\bthen\b|\bfor\b|\bthat\b|\bwhich\b)/i,
      /(?:youtube\s+channel|social media|email campaign|content strategy|brand identity)(?:\s+(?:for|about|called|named))?\s*(.{3,30})?/i,
      /(?:project|campaign)\s+(?:for|about|called|named)\s+["']?(.{3,40})["']?/i,
    ]) {
      const m = msg.match(pat);
      if (m?.[1]) {
        const name = m[1].trim().replace(/[.!?,;]$/, "").trim();
        if (name.length >= 3 && name.length <= 50) {
          return name.charAt(0).toUpperCase() + name.slice(1);
        }
      }
    }
  }

  const firstMsg = userMessages[0] || "Untitled Project";
  const words = firstMsg.split(/\s+/).slice(0, 8).join(" ");
  return words.length > 50 ? words.slice(0, 47) + "..." : words;
}

function buildProjectDescription(userMessages: string[], aiMessages: string[]): string {
  const lines: string[] = [];
  const limit = Math.min(userMessages.length, 3);
  for (let i = 0; i < limit; i++) {
    const userSnippet = userMessages[i]?.slice(0, 150) || "";
    if (userSnippet) lines.push(`User: ${userSnippet}`);
    const aiSnippet = (aiMessages[i] || "").replace(/<!-- tools:\[.*?\] -->/gs, "").trim().slice(0, 150);
    if (aiSnippet) lines.push(`AI: ${aiSnippet}`);
  }
  return lines.join("\n").slice(0, 500) || "Auto-created from extended conversation.";
}

export async function checkAndAutoCreateProject(
  conversationId: number,
  tenantId: number,
  userMessage: string
): Promise<{ created: boolean; projectId?: number; projectName?: string; projectDescription?: string; directive?: string; trigger?: string } | null> {
  try {
    const convRes = await db.execute(sql`
      SELECT project_id, title FROM conversations WHERE id = ${conversationId} AND tenant_id = ${tenantId}
    `);
    const convRows = (convRes as any).rows || convRes;
    const conv = convRows?.[0];
    if (!conv) return null;

    if (conv.project_id) return null;

    const linkRes = await db.execute(sql`
      SELECT pc.project_id FROM project_conversations pc
      JOIN projects p ON p.id = pc.project_id AND p.tenant_id = ${tenantId}
      WHERE pc.conversation_id = ${conversationId} LIMIT 1
    `);
    const linkRows = (linkRes as any).rows || linkRes;
    if (linkRows?.[0]?.project_id) return null;

    const msgRes = await db.execute(sql`
      SELECT role, LEFT(content, 300) as content FROM messages 
      WHERE conversation_id = ${conversationId} 
      ORDER BY id ASC LIMIT 20
    `);
    const msgRows = (msgRes as any).rows || msgRes;
    const messageCount = msgRows.length;
    const userMessages = msgRows.filter((m: any) => m.role === "user").map((m: any) => m.content || "");
    const aiMessages = msgRows.filter((m: any) => m.role === "assistant").map((m: any) => m.content || "");

    if (!shouldAutoCreateProject(userMessage, messageCount, userMessages)) return null;

    const trigger = messageCount >= CONVERSATIONAL_THRESHOLD ? "extended_conversation" : "project_keywords";

    const projectName = extractProjectName(conv.title, userMessages);
    const projectDescription = buildProjectDescription(userMessages, aiMessages);
    const noteText = "Project auto-created from conversation #" + conversationId + " (" + trigger + "). " + (userMessages[0]?.slice(0, 200) || "");

    const txResult = await db.execute(sql`
      WITH new_project AS (
        INSERT INTO projects (name, description, status, tenant_id, created_at, updated_at)
        VALUES (${projectName}, ${projectDescription}, 'active', ${tenantId}, NOW(), NOW())
        RETURNING id
      ),
      link_conv AS (
        UPDATE conversations SET project_id = (SELECT id FROM new_project) WHERE id = ${conversationId}
      ),
      link_project AS (
        INSERT INTO project_conversations (project_id, conversation_id)
        SELECT id, ${conversationId} FROM new_project
        ON CONFLICT DO NOTHING
      ),
      add_note AS (
        INSERT INTO project_notes (project_id, note, author)
        SELECT id, ${noteText}, 'system' FROM new_project
      )
      SELECT id FROM new_project
    `);
    const txRows = (txResult as any).rows || txResult;
    const projectId = txRows?.[0]?.id;
    if (!projectId) return null;

    console.log(`[auto-project] Created project #${projectId}: "${projectName}" from conv #${conversationId} (trigger: ${trigger})`);

    const directive = `\n\nSYSTEM NOTIFICATION — PROJECT AUTO-CREATED:
This conversation has been automatically organized into a project:
- **Project: "${projectName}"** (ID #${projectId})
- Trigger: ${trigger === "extended_conversation" ? "This conversation has grown into an extended discussion" : "Project-level work detected"}

IMPORTANT — TELL THE USER:
1. Let them know: "I've organized our conversation into a project called '${projectName}' so we can keep track of everything we're working on."
2. Explain: "All our discussion, files, and progress are now saved in this project. You can find it anytime in the Projects section."
3. Tell them: "You can rename this project to whatever makes sense to you — just click the project name to edit it."
4. Tell them: "When you come back to continue this work, open the project from the Projects page and start a new chat there. I'll remember everything we've discussed."
5. Continue helping with their current request — don't interrupt the flow.`;

    return { created: true, projectId, projectName, projectDescription, directive, trigger };
  } catch (err: any) {
    console.error(`[auto-project] Error:`, err.message);
    return null;
  }
}
