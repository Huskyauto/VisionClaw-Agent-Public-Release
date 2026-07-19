import { db } from "./db";
import { sql } from "drizzle-orm";
import { uploadToDrive } from "./google-drive";

const SOFT_DELETE_DAYS = 30;

export async function ensureDataProtectionColumns(): Promise<void> {
  try {
    // Round 18 — tenant-level user profile + skill overrides (OpenClaw USER.md / skill hierarchy)
    await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS user_notes_markdown text`);
    await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS disabled_skill_names text[]`);

    await db.execute(sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_by TEXT`);
    await db.execute(sql`ALTER TABLE memory_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_conversations_deleted ON conversations(deleted_at) WHERE deleted_at IS NOT NULL`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS memory_categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id INTEGER,
        description TEXT,
        tenant_id INTEGER DEFAULT 1,
        persona_id INTEGER REFERENCES personas(id) ON DELETE SET NULL,
        memory_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_memory_categories_tenant ON memory_categories(tenant_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_memory_categories_parent ON memory_categories(parent_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS memory_links (
        id SERIAL PRIMARY KEY,
        source_memory_id INTEGER NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
        target_memory_id INTEGER NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
        link_type TEXT NOT NULL DEFAULT 'related',
        strength REAL NOT NULL DEFAULT 0.5,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_memory_links_source ON memory_links(source_memory_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links(target_memory_id)`);

    await db.execute(sql`ALTER TABLE memory_entries ADD COLUMN IF NOT EXISTS category_id INTEGER`);

    await db.execute(sql`ALTER TABLE agent_knowledge ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1`);

    console.log("[data-protection] Schema columns ready");
  } catch (err: any) {
    console.warn("[data-protection] Column setup warning:", err.message);
  }
}

export async function softDeleteConversation(
  conversationId: number,
  tenantId: number,
  deletedBy: string = "user"
): Promise<{ success: boolean; recoveryDeadline?: string; error?: string }> {
  try {
    const convRows = await db.execute(
      sql`SELECT id, title, tenant_id FROM conversations WHERE id = ${conversationId} AND tenant_id = ${tenantId} AND deleted_at IS NULL`
    );
    const conv = ((convRows as any).rows || convRows)[0];
    if (!conv) {
      return { success: false, error: "Conversation not found or already deleted" };
    }

    const recoveryDeadline = new Date(Date.now() + SOFT_DELETE_DAYS * 24 * 60 * 60 * 1000);

    await db.execute(
      sql`UPDATE conversations SET deleted_at = NOW(), deleted_by = ${deletedBy} WHERE id = ${conversationId}`
    );

    console.log(`[data-protection] Soft-deleted conversation ${conversationId} (tenant ${tenantId}), recoverable until ${recoveryDeadline.toISOString()}`);

    return {
      success: true,
      recoveryDeadline: recoveryDeadline.toISOString(),
    };
  } catch (err: any) {
    console.error(`[data-protection] Soft-delete failed for conv ${conversationId}:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function recoverConversation(
  conversationId: number,
  tenantId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await db.execute(
      sql`UPDATE conversations SET deleted_at = NULL, deleted_by = NULL WHERE id = ${conversationId} AND tenant_id = ${tenantId} AND deleted_at IS NOT NULL RETURNING id`
    );
    const rows = (result as any).rows || result;
    if (!rows.length) {
      return { success: false, error: "Conversation not found or not in deleted state" };
    }
    console.log(`[data-protection] Recovered conversation ${conversationId} (tenant ${tenantId})`);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function permanentlyPurgeSoftDeleted(): Promise<{ purged: number }> {
  try {
    const cutoff = new Date(Date.now() - SOFT_DELETE_DAYS * 24 * 60 * 60 * 1000);

    const expired = await db.execute(
      sql`SELECT id, tenant_id, title FROM conversations WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}`
    );
    const rows = (expired as any).rows || expired;

    if (rows.length === 0) return { purged: 0 };

    for (const conv of rows) {
      try {
        await backupConversationToDrive(conv.id, conv.tenant_id);
      } catch (backupErr: any) {
        console.warn(`[data-protection] Drive backup failed for conv ${conv.id} before purge (proceeding anyway):`, backupErr.message);
      }

      await db.execute(sql`DELETE FROM messages WHERE conversation_id = ${conv.id}`);
      await db.execute(sql`DELETE FROM compaction_archives WHERE conversation_id = ${conv.id}`);
      await db.execute(sql`DELETE FROM conversations WHERE id = ${conv.id}`);
    }

    console.log(`[data-protection] Purged ${rows.length} soft-deleted conversations past ${SOFT_DELETE_DAYS}-day recovery window`);
    return { purged: rows.length };
  } catch (err: any) {
    console.error("[data-protection] Purge error:", err.message);
    return { purged: 0 };
  }
}

export async function verifyMessageSaved(
  conversationId: number,
  role: string,
  content: string
): Promise<boolean> {
  try {
    const result = await db.execute(
      sql`SELECT id FROM messages WHERE conversation_id = ${conversationId} AND role = ${role} ORDER BY created_at DESC LIMIT 1`
    );
    const rows = (result as any).rows || result;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function backupConversationToDrive(
  conversationId: number,
  tenantId: number
): Promise<{ success: boolean; driveUrl?: string; error?: string }> {
  try {
    // SECURITY (R74.13u-sec): scope by tenant_id as well as conversationId.
    // Without this predicate, a mismatched (conversationId, tenantId) pair
    // would back up another tenant's conversation into the caller's tenant
    // Drive folder, leaking conversations across tenant boundaries.
    const convResult = await db.execute(
      sql`SELECT id, title, persona_id, created_at, updated_at FROM conversations WHERE id = ${conversationId} AND tenant_id = ${tenantId}`
    );
    const conv = ((convResult as any).rows || convResult)[0];
    if (!conv) return { success: false, error: "Conversation not found for this tenant" };

    const msgResult = await db.execute(
      sql`SELECT role, content, created_at FROM messages WHERE conversation_id = ${conversationId} ORDER BY created_at ASC`
    );
    const msgs = (msgResult as any).rows || msgResult;

    if (msgs.length === 0) return { success: true, driveUrl: undefined };

    const archiveResult = await db.execute(
      sql`SELECT content, archived_at FROM compaction_archives WHERE conversation_id = ${conversationId} ORDER BY archived_at ASC`
    );
    const archives = (archiveResult as any).rows || archiveResult;

    let backup = `# Conversation Backup\n`;
    backup += `- ID: ${conv.id}\n`;
    backup += `- Title: ${conv.title}\n`;
    backup += `- Persona ID: ${conv.persona_id}\n`;
    backup += `- Created: ${conv.created_at}\n`;
    backup += `- Last Updated: ${conv.updated_at}\n`;
    backup += `- Tenant ID: ${tenantId}\n`;
    backup += `- Backup Date: ${new Date().toISOString()}\n\n`;

    if (archives.length > 0) {
      backup += `---\n\n## Compaction Archives (${archives.length} entries)\n\n`;
      for (const arch of archives) {
        backup += `### Archive from ${arch.archived_at}\n\n${arch.content}\n\n`;
      }
    }

    backup += `---\n\n## Messages (${msgs.length} total)\n\n`;
    for (const msg of msgs) {
      const role = (msg.role || "unknown").toUpperCase();
      const content = (msg.content || "").replace(/<!-- auto_route:.*?-->\n?/g, "").replace(/<!-- tools:.*?-->\n?/g, "").trim();
      backup += `### [${role}] — ${msg.created_at}\n\n${content}\n\n`;
    }

    const fileName = `conv-${conversationId}-backup-${new Date().toISOString().split("T")[0]}.md`;

    const result = await uploadToDrive({
      fileData: Buffer.from(backup, "utf-8"),
      fileName,
      mimeType: "text/markdown",
      description: `Conversation backup: ${conv.title} (ID: ${conversationId})`,
      folderLabel: `tenant-${tenantId}-backups`,
    });

    if (result.success) {
      console.log(`[data-protection] Backed up conv ${conversationId} to Drive: ${result.shareableLink}`);
      return { success: true, driveUrl: result.shareableLink };
    }
    return { success: false, error: result.error };
  } catch (err: any) {
    console.error(`[data-protection] Drive backup failed for conv ${conversationId}:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function backupTenantDataToDrive(
  tenantId: number
): Promise<{ success: boolean; files: string[]; errors: string[] }> {
  const files: string[] = [];
  const errors: string[] = [];

  try {
    const memResult = await db.execute(
      sql`SELECT id, fact, category, source, status, persona_id, created_at, last_accessed FROM memory_entries WHERE tenant_id = ${tenantId} ORDER BY created_at ASC`
    );
    const memories = (memResult as any).rows || memResult;

    if (memories.length > 0) {
      let memBackup = `# Memory Entries Backup\n`;
      memBackup += `- Tenant ID: ${tenantId}\n`;
      memBackup += `- Total Entries: ${memories.length}\n`;
      memBackup += `- Backup Date: ${new Date().toISOString()}\n\n---\n\n`;

      for (const mem of memories) {
        memBackup += `## Memory #${mem.id} [${mem.status}]\n`;
        memBackup += `- Category: ${mem.category}\n`;
        memBackup += `- Source: ${mem.source}\n`;
        memBackup += `- Persona: ${mem.persona_id || "global"}\n`;
        memBackup += `- Created: ${mem.created_at}\n`;
        memBackup += `- Last Accessed: ${mem.last_accessed}\n\n`;
        memBackup += `${mem.fact}\n\n---\n\n`;
      }

      const r = await uploadToDrive({
        fileData: Buffer.from(memBackup, "utf-8"),
        fileName: `tenant-${tenantId}-memories-${new Date().toISOString().split("T")[0]}.md`,
        mimeType: "text/markdown",
        description: `Memory entries backup for tenant ${tenantId}`,
        folderLabel: `tenant-${tenantId}-backups`,
      });
      if (r.success) files.push(r.shareableLink || "memories backed up");
      else errors.push(`Memories: ${r.error}`);
    }

    const knResult = await db.execute(
      sql`SELECT id, title, content, category, priority, source, persona_id, created_at FROM agent_knowledge WHERE tenant_id = ${tenantId} ORDER BY created_at ASC`
    );
    const knowledge = (knResult as any).rows || knResult;

    if (knowledge.length > 0) {
      let knBackup = `# Knowledge Base Backup\n`;
      knBackup += `- Tenant ID: ${tenantId}\n`;
      knBackup += `- Total Entries: ${knowledge.length}\n`;
      knBackup += `- Backup Date: ${new Date().toISOString()}\n\n---\n\n`;

      for (const kn of knowledge) {
        knBackup += `## ${kn.title} (#${kn.id}) [${kn.category}]\n`;
        knBackup += `- Priority: ${kn.priority}\n`;
        knBackup += `- Source: ${kn.source}\n`;
        knBackup += `- Persona: ${kn.persona_id || "global"}\n`;
        knBackup += `- Created: ${kn.created_at}\n\n`;
        knBackup += `${kn.content}\n\n---\n\n`;
      }

      const r = await uploadToDrive({
        fileData: Buffer.from(knBackup, "utf-8"),
        fileName: `tenant-${tenantId}-knowledge-${new Date().toISOString().split("T")[0]}.md`,
        mimeType: "text/markdown",
        description: `Knowledge base backup for tenant ${tenantId}`,
        folderLabel: `tenant-${tenantId}-backups`,
      });
      if (r.success) files.push(r.shareableLink || "knowledge backed up");
      else errors.push(`Knowledge: ${r.error}`);
    }

    const projResult = await db.execute(
      sql`SELECT id, name, description, status, created_at FROM projects WHERE tenant_id = ${tenantId} ORDER BY created_at ASC`
    );
    const projects = (projResult as any).rows || projResult;

    if (projects.length > 0) {
      let projBackup = `# Projects Backup\n`;
      projBackup += `- Tenant ID: ${tenantId}\n`;
      projBackup += `- Total Projects: ${projects.length}\n`;
      projBackup += `- Backup Date: ${new Date().toISOString()}\n\n---\n\n`;

      for (const proj of projects) {
        projBackup += `## ${proj.name} (#${proj.id}) [${proj.status}]\n`;
        projBackup += `- Created: ${proj.created_at}\n\n`;
        projBackup += `${proj.description || "(no description)"}\n\n`;

        const notesResult = await db.execute(
          sql`SELECT title, content, created_at FROM project_notes WHERE project_id = ${proj.id} ORDER BY created_at ASC`
        );
        const notes = (notesResult as any).rows || notesResult;
        if (notes.length > 0) {
          projBackup += `### Notes (${notes.length})\n\n`;
          for (const note of notes) {
            projBackup += `#### ${note.title || "Untitled"} — ${note.created_at}\n\n${note.content}\n\n`;
          }
        }

        const filesResult = await db.execute(
          sql`SELECT file_name, file_type, file_url, created_at FROM project_files WHERE project_id = ${proj.id} ORDER BY created_at ASC`
        );
        const pFiles = (filesResult as any).rows || filesResult;
        if (pFiles.length > 0) {
          projBackup += `### Files (${pFiles.length})\n\n`;
          for (const f of pFiles) {
            projBackup += `- ${f.file_name} (${f.file_type}) — ${f.created_at}${f.file_url ? " — " + f.file_url : ""}\n`;
          }
          projBackup += `\n`;
        }

        projBackup += `---\n\n`;
      }

      const r = await uploadToDrive({
        fileData: Buffer.from(projBackup, "utf-8"),
        fileName: `tenant-${tenantId}-projects-${new Date().toISOString().split("T")[0]}.md`,
        mimeType: "text/markdown",
        description: `Projects backup for tenant ${tenantId}`,
        folderLabel: `tenant-${tenantId}-backups`,
      });
      if (r.success) files.push(r.shareableLink || "projects backed up");
      else errors.push(`Projects: ${r.error}`);
    }

    const convResult = await db.execute(
      sql`SELECT id FROM conversations WHERE tenant_id = ${tenantId} AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100`
    );
    const convos = (convResult as any).rows || convResult;

    let convoBackupCount = 0;
    for (const conv of convos) {
      const msgCheck = await db.execute(
        sql`SELECT COUNT(*)::int as cnt FROM messages WHERE conversation_id = ${conv.id}`
      );
      const cnt = ((msgCheck as any).rows || msgCheck)[0]?.cnt || 0;
      if (cnt === 0) continue;

      const r = await backupConversationToDrive(conv.id, tenantId);
      if (r.success && r.driveUrl) {
        files.push(r.driveUrl);
        convoBackupCount++;
      } else if (r.error) {
        errors.push(`Conv ${conv.id}: ${r.error}`);
      }
    }

    if (convoBackupCount > 0) {
      console.log(`[data-protection] Backed up ${convoBackupCount} conversations for tenant ${tenantId}`);
    }

    console.log(`[data-protection] Full tenant backup complete: ${files.length} files, ${errors.length} errors`);
    return { success: errors.length === 0, files, errors };
  } catch (err: any) {
    console.error(`[data-protection] Tenant backup failed:`, err.message);
    errors.push(err.message);
    return { success: false, files, errors };
  }
}

export function safeCompactionGuard(archiveSuccess: boolean): boolean {
  if (!archiveSuccess) {
    console.error("[data-protection] BLOCKING COMPACTION: Archive save failed. Messages will NOT be compacted until archive succeeds.");
    return false;
  }
  return true;
}

export async function getDeletedConversations(tenantId: number): Promise<any[]> {
  try {
    const result = await db.execute(
      sql`SELECT id, title, deleted_at, deleted_by, 
          (SELECT COUNT(*)::int FROM messages WHERE conversation_id = conversations.id) as message_count
          FROM conversations 
          WHERE tenant_id = ${tenantId} AND deleted_at IS NOT NULL 
          ORDER BY deleted_at DESC`
    );
    return (result as any).rows || result;
  } catch {
    return [];
  }
}
