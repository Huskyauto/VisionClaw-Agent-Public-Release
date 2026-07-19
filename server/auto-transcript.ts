import { db } from "./db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { assertConversationInTenant } from "./storage-helpers/project-tenant-guard";

const TRANSCRIPT_DIR = path.resolve(process.cwd(), "project-transcripts");

function stripToolXml(text: string): string {
  return text
    .replace(/<!-- tools:\[.*?\] -->/gs, "")
    .replace(/<!-- route:.*? -->/g, "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim();
}

export async function autoSaveProjectTranscript(conversationId: number, tenantId: number): Promise<void> {
  try {
    // Fail-closed tenant-ownership guard before the project-scoped project_files
    // write below (project_files has no tenant_id; isolation is transitive via the
    // parent project). Prove the acting tenant owns this conversation first.
    if (!(await assertConversationInTenant(conversationId, tenantId))) return;
    const convRes = await db.execute(sql`
      SELECT c.id, c.title, c.project_id, c.persona_id, p.name as persona_name
      FROM conversations c
      LEFT JOIN personas p ON p.id = c.persona_id
      WHERE c.id = ${conversationId} AND c.tenant_id = ${tenantId}
    `);
    const convRows = (convRes as any).rows || convRes;
    const conv = convRows?.[0];
    if (!conv?.project_id) return;

    const projectId = conv.project_id;

    // Fail-closed: prove the acting tenant OWNS this project before any
    // project_files read/write below. conv.project_id is trusted only as far as
    // the conversation row (a poisoned/cross-tenant project_id must not let us
    // read foreign project metadata or stamp transcript rows onto another
    // tenant's project). project_files has no tenant_id — isolation is transitive
    // via projects.tenant_id, so the gate lives here.
    const projRes = await db.execute(sql`SELECT name FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}`);
    const projRows = (projRes as any).rows || projRes;
    if (!Array.isArray(projRows) || projRows.length === 0) return;
    const projectName = projRows?.[0]?.name || `Project ${projectId}`;

    const msgRes = await db.execute(sql`
      SELECT role, content, created_at FROM messages
      WHERE conversation_id = ${conversationId}
      ORDER BY created_at ASC
    `);
    const messages = (msgRes as any).rows || msgRes;
    if (!Array.isArray(messages) || messages.length === 0) return;

    const lines: string[] = [
      `# Conversation Transcript`,
      `- **Project:** ${projectName} (#${projectId})`,
      `- **Conversation:** ${conv.title || "Untitled"} (#${conversationId})`,
      `- **Persona:** ${conv.persona_name || "Unknown"}`,
      `- **Started:** ${messages[0]?.created_at ? new Date(messages[0].created_at).toISOString() : "Unknown"}`,
      `- **Last Updated:** ${new Date().toISOString()}`,
      `- **Messages:** ${messages.length}`,
      ``,
      `---`,
      ``,
    ];

    for (const m of messages) {
      const timestamp = m.created_at ? new Date(m.created_at).toLocaleString("en-US", { timeZone: "America/Chicago" }) : "";
      const rawContent = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      const cleanContent = stripToolXml(rawContent);
      if (!cleanContent) continue;

      const roleLabel = m.role === "user" ? "USER" : m.role === "assistant" ? (conv.persona_name || "ASSISTANT").toUpperCase() : "SYSTEM";
      lines.push(`### [${roleLabel}] — ${timestamp}`);
      lines.push(``);
      lines.push(cleanContent);
      lines.push(``);
      lines.push(`---`);
      lines.push(``);
    }

    if (!fs.existsSync(TRANSCRIPT_DIR)) {
      fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
    }

    const safeTitle = (conv.title || "untitled").replace(/[^a-zA-Z0-9-_ ]/g, "").slice(0, 50).trim().replace(/\s+/g, "-");
    const filename = `proj-${projectId}_conv-${conversationId}_${safeTitle}.md`;
    const filePath = path.join(TRANSCRIPT_DIR, filename);
    fs.writeFileSync(filePath, lines.join("\n"), "utf-8");

    const existingFile = await db.execute(sql`
      SELECT id FROM project_files
      WHERE project_id = ${projectId} AND file_name = ${filename}
    `);
    const existingRows = (existingFile as any).rows || existingFile;

    if (Array.isArray(existingRows) && existingRows.length > 0) {
      await db.execute(sql`
        UPDATE project_files
        SET file_path = ${filePath}
        WHERE id = ${existingRows[0].id}
      `);
    } else {
      await db.execute(sql`
        INSERT INTO project_files (project_id, file_name, file_type, file_path, uploaded_by)
        VALUES (
          ${projectId},
          ${filename},
          'text/markdown',
          ${filePath},
          'system-auto-transcript'
        )
      `);
    }

    console.log(`[transcript] Saved ${messages.length} messages for conv #${conversationId} → ${filename}`);
  } catch (err: any) {
    console.error(`[transcript] Auto-save failed for conv ${conversationId}:`, err.message);
  }
}

export async function backfillProjectTranscripts(): Promise<void> {
  try {
    if (!fs.existsSync(TRANSCRIPT_DIR)) {
      fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
    }

    const convRes = await db.execute(sql`
      SELECT DISTINCT c.id, c.project_id, c.tenant_id
      FROM conversations c
      WHERE c.project_id IS NOT NULL
        AND (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) > 0
      ORDER BY c.id
    `);
    const convs = (convRes as any).rows || convRes;
    if (!Array.isArray(convs) || convs.length === 0) {
      console.log("[transcript] No project conversations to backfill");
      return;
    }

    let created = 0;
    let skipped = 0;
    for (const c of convs) {
      const existing = fs.readdirSync(TRANSCRIPT_DIR).filter((f: string) => f.startsWith(`proj-${c.project_id}_conv-${c.id}_`));
      if (existing.length > 0) {
        skipped++;
        continue;
      }
      await autoSaveProjectTranscript(c.id, c.tenant_id);
      created++;
    }

    const alsoLinked = await db.execute(sql`
      SELECT DISTINCT pc.conversation_id, pc.project_id, c.tenant_id
      FROM project_conversations pc
      JOIN conversations c ON c.id = pc.conversation_id
      JOIN projects p ON p.id = pc.project_id AND p.tenant_id = c.tenant_id
      WHERE c.project_id IS NULL
        AND pc.project_id IS NOT NULL
        AND (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) > 0
    `);
    const linked = (alsoLinked as any).rows || alsoLinked;
    if (Array.isArray(linked)) {
      for (const c of linked) {
        await db.execute(sql`UPDATE conversations SET project_id = ${c.project_id} WHERE id = ${c.conversation_id} AND project_id IS NULL`).catch(() => {});
        await autoSaveProjectTranscript(c.conversation_id, c.tenant_id);
        created++;
      }
    }

    const missingLinks = await db.execute(sql`
      SELECT c.id, c.project_id, c.tenant_id FROM conversations c
      WHERE c.project_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM project_conversations pc WHERE pc.project_id = c.project_id AND pc.conversation_id = c.id)
    `);
    const mlRows = (missingLinks as any).rows || missingLinks;
    if (Array.isArray(mlRows) && mlRows.length > 0) {
      for (const r of mlRows) {
        await db.execute(sql`INSERT INTO project_conversations (project_id, conversation_id) VALUES (${r.project_id}, ${r.id}) ON CONFLICT DO NOTHING`).catch(() => {});
      }
      console.log(`[transcript] Backfilled ${mlRows.length} missing project_conversations links`);
    }

    console.log(`[transcript] Backfill complete: ${created} created, ${skipped} already existed (${convs.length} total project convs)`);
  } catch (err: any) {
    console.error("[transcript] Backfill error:", err.message);
  }
}
