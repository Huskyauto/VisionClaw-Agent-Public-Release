import { db } from "../db";
import { sql } from "drizzle-orm";
import type { Conversation } from "@shared/schema";
import { logSilentCatch } from "../lib/silent-catch";

export async function getConversationProjectContext(conversationId: number, conv: Conversation): Promise<{ projectId: number; context: string; driveFolderId: string | null } | null> {
  // R54.D: tenant-scope every project query — was unfiltered IDOR vector
  const tenantId: number | undefined = conv?.tenantId;
  if (!tenantId) {
    console.warn(`[getConversationProjectContext] no tenantId on conv ${conversationId} — refusing (R54.D)`);
    return null;
  }

  let projectId: number | null = null;

  const pidRes = await db.execute(sql`SELECT project_id FROM conversations WHERE id = ${conversationId} AND tenant_id = ${tenantId}`);
  const pidRows = (pidRes as any).rows || pidRes;
  if (Array.isArray(pidRows) && pidRows[0]?.project_id) {
    projectId = pidRows[0].project_id;
  }

  if (!projectId) {
    const linkRes = await db.execute(sql`
      SELECT pc.project_id
      FROM project_conversations pc
      JOIN projects p ON p.id = pc.project_id
      WHERE pc.conversation_id = ${conversationId} AND p.tenant_id = ${tenantId}
      LIMIT 1
    `);
    const linkRows = (linkRes as any).rows || linkRes;
    if (Array.isArray(linkRows) && linkRows[0]?.project_id) {
      projectId = linkRows[0].project_id;
    }
  }

  if (!projectId) return null;

  const linkedProjectRes = await db.execute(sql`
    SELECT p.id
    FROM projects p
    WHERE p.tenant_id = ${tenantId}
      AND (
        p.id = (SELECT project_id FROM conversations WHERE id = ${conversationId} AND tenant_id = ${tenantId})
        OR EXISTS (
          SELECT 1 FROM project_conversations pc
          WHERE pc.conversation_id = ${conversationId} AND pc.project_id = p.id
        )
      )
    ORDER BY p.id
  `);
  const linkedProjectRows = (linkedProjectRes as any).rows || linkedProjectRes;
  const linkedProjectIds = Array.isArray(linkedProjectRows)
    ? linkedProjectRows.map((row: any) => Number(row.id)).filter((id: number) => Number.isInteger(id) && id > 0)
    : [projectId];

  const pRes = await db.execute(sql`SELECT * FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}`);
  const pRows = (pRes as any).rows || pRes;
  const project = Array.isArray(pRows) ? pRows[0] : null;
  if (!project) return null;

  const driveFolderId: string | null = project.drive_folder_id || null;

  const lines: string[] = [];
  let remainingCompassChars = 4000;
  const primaryCompassBudget = Math.floor(remainingCompassChars / Math.max(1, linkedProjectIds.length));

  try {
    const { loadProjectBrain } = await import("../project-brain");
    const brain = loadProjectBrain(projectId);
    if (brain) {
      lines.push(`## PROJECT BRAIN — Living Knowledge File`);
      lines.push(`_This is your persistent memory for this project. It auto-updates after every conversation. Treat it like your replit.md — it's always current._\n`);
      const trimmedBrain = brain.length > 6000 ? brain.slice(0, 6000) + "\n...(brain file truncated — key info is above)" : brain;
      lines.push(trimmedBrain);
      lines.push("");
    }
  } catch (_silentErr) { logSilentCatch("server/chat-engine.ts", _silentErr); }

  lines.push(`## ACTIVE PROJECT CONTEXT — #${project.id}: ${project.name}`);
  lines.push(`**THIS CONVERSATION IS LINKED TO PROJECT #${project.id}.**`);
  lines.push(`Status: ${project.status}`);
  if (project.customer_name) lines.push(`Customer: ${project.customer_name}${project.customer_email ? ` (${project.customer_email})` : ''}`);
  if (project.description) lines.push(`Description: ${project.description}`);
  if (project.tags?.length) lines.push(`Tags: ${project.tags.join(', ')}`);

  try {
    const { renderProjectCompassContext } = await import("../lib/project-compass-core");
    if (process.env.PROJECT_COMPASS_ENABLED === "0") {
      const compassBlock = renderProjectCompassContext([], primaryCompassBudget);
      lines.push(compassBlock);
      remainingCompassChars -= compassBlock.length;
      console.log(`[project-compass] project=${projectId} state=disabled-fallback`);
    } else {
      const { getProjectCompass } = await import("../project-compass");
      const compass = await getProjectCompass(projectId, tenantId);
      const entries = compass?.entries || [];
      const compassBlock = renderProjectCompassContext(entries, primaryCompassBudget);
      lines.push(compassBlock);
      remainingCompassChars -= compassBlock.length;
      console.log(`[project-compass] project=${projectId} state=${entries.length ? "populated" : "empty-fallback"} count=${entries.length}`);
    }
  } catch (error) {
    const { renderProjectCompassContext } = await import("../lib/project-compass-core");
    const compassBlock = renderProjectCompassContext([], primaryCompassBudget);
    lines.push(compassBlock);
    remainingCompassChars -= compassBlock.length;
    console.warn(`[project-compass] project=${projectId} state=read-failed-fallback error=${error instanceof Error ? error.message : "unknown"}`);
  }

  const additionalProjectIds = linkedProjectIds.filter((id: number) => id !== projectId);
  if (additionalProjectIds.length > 0 && remainingCompassChars > 0) {
    const sectionHeading = "\n## ADDITIONAL LINKED PROJECT COMPASSES";
    lines.push(sectionHeading);
    remainingCompassChars = Math.max(0, remainingCompassChars - sectionHeading.length);
    for (const [linkedIndex, linkedProjectId] of additionalProjectIds.entries()) {
      if (remainingCompassChars <= 0) break;
      const linkedProjectResult = await db.execute(sql`
        SELECT id, name FROM projects WHERE id = ${linkedProjectId} AND tenant_id = ${tenantId}
      `);
      const linkedProjectRows = (linkedProjectResult as any).rows || linkedProjectResult;
      const linkedProject = Array.isArray(linkedProjectRows) ? linkedProjectRows[0] : null;
      if (!linkedProject) continue;
      try {
        const { getProjectCompass } = await import("../project-compass");
        const { renderProjectCompassContext } = await import("../lib/project-compass-core");
        const linkedCompass = process.env.PROJECT_COMPASS_ENABLED === "0"
          ? null
          : await getProjectCompass(linkedProjectId, tenantId);
        const remainingProjects = additionalProjectIds.length - linkedIndex;
        const allocation = Math.floor(remainingCompassChars / Math.max(1, remainingProjects));
        const fullHeading = `\n### Linked project #${linkedProject.id}: ${linkedProject.name}`;
        const minimumMarker = `\n#${linkedProject.id}: Compass omitted`;
        const heading = fullHeading.length < allocation
          ? fullHeading
          : minimumMarker.slice(0, Math.max(1, allocation));
        const blockBudget = Math.max(0, allocation - heading.length);
        const block = blockBudget > 0 ? renderProjectCompassContext(linkedCompass?.entries || [], blockBudget) : "";
        lines.push(heading, block);
        remainingCompassChars -= heading.length + block.length;
      } catch (error) {
        const { renderProjectCompassContext } = await import("../lib/project-compass-core");
        const remainingProjects = additionalProjectIds.length - linkedIndex;
        const allocation = Math.floor(remainingCompassChars / Math.max(1, remainingProjects));
        const fullHeading = `\n### Linked project #${linkedProject.id}: ${linkedProject.name}`;
        const minimumMarker = `\n#${linkedProject.id}: Compass unavailable`;
        const heading = fullHeading.length < allocation
          ? fullHeading
          : minimumMarker.slice(0, Math.max(1, allocation));
        const blockBudget = Math.max(0, allocation - heading.length);
        const block = blockBudget > 0 ? renderProjectCompassContext([], blockBudget) : "";
        lines.push(heading, block);
        remainingCompassChars -= heading.length + block.length;
        console.warn(`[project-compass] project=${linkedProjectId} state=additional-read-failed-fallback error=${error instanceof Error ? error.message : "unknown"}`);
      }
    }
  }

  // R54.D: project_files is scoped via projectId already verified to belong to tenantId above; safe.
  const filesRes = await db.execute(sql`SELECT file_name, file_type, file_path, file_url, uploaded_by FROM project_files WHERE project_id = ${projectId} ORDER BY created_at DESC`);
  const files = (filesRes as any).rows || filesRes;
  if (Array.isArray(files) && files.length > 0) {
    lines.push(`\n### PROJECT FILES (${files.length} total) — PRIOR WORK LIVES HERE. REUSE BEFORE RESEARCH.`);
    lines.push(`Before re-investigating ANYTHING (websites, companies, data), check whether a prior session already produced it below. If a relevant report/analysis exists, read_file it and build on it — re-doing filed research wastes your tool budget and can strand the deliverable at the cap.`);
    for (const f of files) {
      const link = f.file_url ? ` [Link: ${f.file_url}]` : '';
      const by = f.uploaded_by ? ` (by ${f.uploaded_by})` : '';
      lines.push(`- **${f.file_name}** (${f.file_type || 'file'}) at \`${f.file_path || 'N/A'}\`${link}${by}`);
    }
  }

  const notesRes = await db.execute(sql`SELECT note, author, created_at FROM project_notes WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 20`);
  const notes = (notesRes as any).rows || notesRes;
  if (Array.isArray(notes) && notes.length > 0) {
    lines.push(`\n### PROJECT NOTES (most recent first)`);
    for (const n of notes) {
      const date = new Date(n.created_at).toISOString().split('T')[0];
      lines.push(`- [${date}] ${n.author}: ${n.note}`);
    }
  }

  const convsRes = await db.execute(sql`
    SELECT c.id, c.title, c.created_at
    FROM project_conversations pc JOIN conversations c ON c.id = pc.conversation_id
    WHERE pc.project_id = ${projectId} AND c.id != ${conversationId} AND c.tenant_id = ${tenantId}
    ORDER BY c.created_at DESC LIMIT 10
  `);
  const convs = (convsRes as any).rows || convsRes;
  if (Array.isArray(convs) && convs.length > 0) {
    lines.push(`\n### PRIOR PROJECT CONVERSATIONS — FULL CONTINUITY`);
    lines.push(`You have access to the history of all previous conversations in this project. This IS your memory across sessions.`);

    let totalContextChars = 0;
    const MAX_PROJECT_CONTEXT_CHARS = 15000;

    const fs = await import("fs");
    const path = await import("path");
    const TRANSCRIPT_DIR = path.resolve(process.cwd(), "project-transcripts");

    for (const c of convs) {
      if (totalContextChars >= MAX_PROJECT_CONTEXT_CHARS) break;
      lines.push(`\n#### Conv #${c.id}: "${c.title}" (${new Date(c.created_at).toISOString().split('T')[0]})`);

      let foundTranscript = false;
      try {
        if (fs.existsSync(TRANSCRIPT_DIR)) {
          const files = fs.readdirSync(TRANSCRIPT_DIR).filter((f: string) => f.startsWith(`proj-${projectId}_conv-${c.id}_`));
          if (files.length > 0) {
            let transcript = fs.readFileSync(path.join(TRANSCRIPT_DIR, files[0]), "utf-8");
            if (transcript.length > 4000) transcript = transcript.slice(0, 4000) + "\n...(transcript truncated — use recall_context with projectWide:true and keywords to search full history)";
            lines.push(`**Full transcript on file:**`);
            lines.push(transcript);
            totalContextChars += transcript.length;
            foundTranscript = true;
          }
        }
      } catch (_silentErr) { logSilentCatch("server/chat-engine.ts", _silentErr); }

      if (!foundTranscript) {
        try {
          const archiveRes = await db.execute(sql`
            SELECT summary, content FROM compaction_archives
             WHERE conversation_id = ${c.id} AND tenant_id = ${tenantId}
            ORDER BY archived_at DESC LIMIT 1
          `);
          const archiveRows = (archiveRes as any).rows || archiveRes;
          if (Array.isArray(archiveRows) && archiveRows[0]) {
            const summary = archiveRows[0].summary || archiveRows[0].content;
            if (summary) {
              const truncated = summary.length > 3000 ? summary.slice(0, 3000) + "\n...(truncated)" : summary;
              lines.push(`**Compacted history:** ${truncated}`);
              totalContextChars += truncated.length;
            }
          }
        } catch (_silentErr) { logSilentCatch("server/chat-engine.ts", _silentErr); }

        if (totalContextChars < MAX_PROJECT_CONTEXT_CHARS) {
          try {
            const msgRes = await db.execute(sql`
              SELECT role, content, created_at FROM messages
               WHERE conversation_id = ${c.id} AND tenant_id = ${tenantId}
              ORDER BY created_at ASC
            `);
            const msgs = (msgRes as any).rows || msgRes;
            if (Array.isArray(msgs) && msgs.length > 0) {
              lines.push(`**Message history (chronological):**`);
              for (const m of msgs) {
                const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
                const clean = text.replace(/<!-- tools:\[.*?\] -->/gs, "").replace(/<!-- route:.*? -->/g, "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
                if (!clean) continue;
                const ts = m.created_at ? new Date(m.created_at).toLocaleString("en-US", { timeZone: "America/Chicago" }) : "";
                const trimmed = clean.length > 600 ? clean.slice(0, 600) + "..." : clean;
                lines.push(`- [${m.role.toUpperCase()} @ ${ts}]: ${trimmed}`);
                totalContextChars += trimmed.length;
              }
            }
          } catch (_silentErr) { logSilentCatch("server/chat-engine.ts", _silentErr); }
        }
      }
    }
  }

  lines.push(`\n### PROJECT WORKFLOW RULES
- You are working inside project #${project.id}. All work you do here is part of this project.
- **YOU HAVE A PROJECT BRAIN.** The "Project Brain" above is your living knowledge file — like a replit.md for this project. It tracks every asset, decision, session, and next step automatically. READ IT FIRST before doing anything.
- **YOU HAVE FULL CONTINUITY.** The conversation transcripts, brain file, and messages above ARE your memory of what happened in prior sessions. READ THEM CAREFULLY before asking the user to repeat anything.
- If the user asks "where are we" or "what's the status", REFERENCE THE PROJECT BRAIN AND PRIOR CONVERSATIONS for project content/deliverable status. For infrastructure status (API connections, Google Drive, tool availability), DO NOT rely on old conversation data — use system_status tool to get the current live status. Old conversations may contain transient errors that have since been resolved.
- **IMPORTANT: Infrastructure status from prior conversations is STALE.** If a prior conversation says "Google Drive not connected" or any service is down, DO NOT repeat that claim. Services auto-reconnect. Only report infrastructure issues if you verify them RIGHT NOW with a fresh system_status check.
- After creating any file, ALWAYS add it to this project: project add_file with id=${project.id}
- Add progress notes as you work: project add_note with id=${project.id}
- **ASSET RULE**: When you create documents, scripts, slide decks, or any deliverable, ALWAYS save them as actual files (Google Drive or local) AND add them to the project. Deliverables must exist as permanent, retrievable assets — not just text in a chat.
- If you need more detail from prior conversations, use recall_context with projectWide:true and keywords.
- NEVER ask the user to re-upload files that are already listed in PROJECT FILES above. Use them directly.
- This conversation is already linked to the project. No need to create a new project or re-link.
- CRITICAL: When you pick up work from a prior session, start by telling the user exactly where things stand — referencing specific assets, files, and versions from the Project Brain. Be precise.`);

  return { projectId, context: lines.join("\n"), driveFolderId };
}

