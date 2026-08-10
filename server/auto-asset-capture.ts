import { db } from "./db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

import { logSilentCatch } from "./lib/silent-catch";
import { assertConversationInTenant } from "./storage-helpers/project-tenant-guard";
const ASSET_DIR = path.resolve(process.cwd(), "project-assets");

interface DetectedAsset {
  type: string;
  title: string;
  content: string;
  extension: string;
}

function detectDeliverables(response: string): DetectedAsset[] {
  const assets: DetectedAsset[] = [];
  const cleanResponse = response
    .replace(/<!-- tools:\[.*?\] -->/gs, "")
    .replace(/<!-- route:.*? -->/g, "")
    .replace(/<think>[\s\S]*?<\/think>/g, "");

  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(cleanResponse)) !== null) {
    const lang = match[1]?.toLowerCase() || "";
    const code = match[2].trim();
    if (code.length < 100) continue;

    const contextBefore = cleanResponse.slice(Math.max(0, match.index - 300), match.index);

    if (lang === "html" || lang === "htm") {
      const titleMatch = contextBefore.match(/(?:slide\s*deck|presentation|slides)/i);
      if (titleMatch || code.includes("<section") || code.includes("slide")) {
        const name = extractTitle(contextBefore, "Slide Deck");
        assets.push({ type: "slide_deck", title: name, content: code, extension: "html" });
      }
    }

    if (/script|teleprompter|narration|voiceover|voice.?over/i.test(contextBefore)) {
      const name = extractTitle(contextBefore, "Script");
      assets.push({ type: "script", title: name, content: code, extension: lang === "markdown" || lang === "md" ? "md" : "txt" });
    }

    if (lang === "python" || lang === "javascript" || lang === "typescript" || lang === "bash" || lang === "sh") {
      if (code.length > 200) {
        const name = extractTitle(contextBefore, `Code (${lang})`);
        assets.push({ type: "code", title: name, content: code, extension: lang === "python" ? "py" : lang === "typescript" ? "ts" : lang === "javascript" ? "js" : "sh" });
      }
    }

    if (lang === "json" && code.length > 200) {
      const name = extractTitle(contextBefore, "Data");
      assets.push({ type: "data", title: name, content: code, extension: "json" });
    }
  }

  const scriptPatterns = [
    /#{1,3}\s*(?:video\s*)?script[\s\S]{200,}?(?=\n#{1,3}\s|\n---|\Z)/gi,
    /(?:^|\n)(?:SCENE|INT\.|EXT\.)\s[\s\S]{200,}?(?=\n#{1,3}\s|\n---|\Z)/gi,
  ];
  for (const pat of scriptPatterns) {
    let m;
    while ((m = pat.exec(cleanResponse)) !== null) {
      const existing = assets.find(a => a.type === "script");
      if (!existing) {
        assets.push({ type: "script", title: "Video Script", content: m[0].trim(), extension: "md" });
      }
    }
  }

  const longformPatterns = [
    { regex: /#{1,3}\s*(?:blog\s*post|article)[\s\S]{500,}?(?=\n#{1,2}\s[A-Z]|\Z)/gi, type: "blog_post", defaultTitle: "Blog Post" },
    { regex: /#{1,3}\s*(?:email\s*(?:draft|template|copy))[\s\S]{200,}?(?=\n#{1,2}\s[A-Z]|\Z)/gi, type: "email_draft", defaultTitle: "Email Draft" },
    { regex: /#{1,3}\s*(?:social\s*media\s*(?:post|content)|tweet\s*thread)[\s\S]{200,}?(?=\n#{1,2}\s[A-Z]|\Z)/gi, type: "social_content", defaultTitle: "Social Media Content" },
  ];
  for (const { regex, type, defaultTitle } of longformPatterns) {
    let m;
    while ((m = regex.exec(cleanResponse)) !== null) {
      assets.push({ type, title: defaultTitle, content: m[0].trim(), extension: "md" });
    }
  }

  return assets;
}

function extractTitle(context: string, fallback: string): string {
  const titlePatterns = [
    /[""]([^""]{5,60})[""](?:\s*(?:script|deck|presentation|document))?/i,
    /(?:titled?|called?|named?)\s+[""]?([^"""\n]{5,60})[""]?/i,
    /(?:Video\s*\d+|Part\s*\d+)[:\s]+([^\n]{5,60})/i,
  ];
  for (const pat of titlePatterns) {
    const m = context.match(pat);
    if (m?.[1]) return m[1].trim();
  }
  return fallback;
}

export async function captureProjectAssets(
  conversationId: number,
  tenantId: number,
  assistantResponse: string
): Promise<number> {
  try {
    // Fail-closed tenant-ownership guard: the project-scoped project_files INSERT
    // below has no tenant_id of its own (isolation is transitive via the parent
    // project). Prove the acting tenant owns this conversation before deriving its
    // project_id, or a foreign/LLM-supplied conversationId could write across
    // tenants. (closes deferred tenant-scoping audit for this autonomous site.)
    if (!(await assertConversationInTenant(conversationId, tenantId))) return 0;
    const convRes = await db.execute(sql`
      SELECT project_id FROM conversations WHERE id = ${conversationId} AND tenant_id = ${tenantId}
    `);
    const convRows = (convRes as any).rows || convRes;
    const projectId = convRows?.[0]?.project_id;
    if (!projectId) return 0;

    const assets = detectDeliverables(assistantResponse);
    if (assets.length === 0) return 0;

    if (!fs.existsSync(ASSET_DIR)) {
      fs.mkdirSync(ASSET_DIR, { recursive: true });
    }

    let saved = 0;
    for (const asset of assets) {
      const safeTitle = asset.title.replace(/[^a-zA-Z0-9-_ ]/g, "").slice(0, 50).trim().replace(/\s+/g, "-") || asset.type;
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `proj-${projectId}_${asset.type}_${safeTitle}_${timestamp}.${asset.extension}`;
      const filePath = path.join(ASSET_DIR, filename);

      const header = `/* Asset: ${asset.title}\n * Type: ${asset.type}\n * Project: #${projectId}\n * Conversation: #${conversationId}\n * Created: ${new Date().toISOString()}\n * Auto-captured from agent response\n */\n\n`;

      const finalContent = asset.extension === "html" || asset.extension === "json"
        ? asset.content
        : (asset.extension === "md" || asset.extension === "txt"
          ? `<!-- Asset: ${asset.title} | Type: ${asset.type} | Project: #${projectId} | Created: ${new Date().toISOString()} -->\n\n${asset.content}`
          : header + asset.content);

      fs.writeFileSync(filePath, finalContent, "utf-8");

      try {
        await db.execute(sql`
          INSERT INTO project_files (project_id, file_name, file_type, file_path, uploaded_by)
          VALUES (
            ${projectId},
            ${filename},
            ${asset.extension === "html" ? "text/html" : asset.extension === "json" ? "application/json" : asset.extension === "md" ? "text/markdown" : "text/plain"},
            ${filePath},
            ${"auto-capture-" + asset.type}
          )
        `);
        saved++;
        console.log(`[asset-capture] Saved ${asset.type}: "${asset.title}" → ${filename}`);
      } catch (dbErr: any) {
        console.error(`[asset-capture] DB insert failed for ${filename}:`, dbErr.message);
      }
    }

    if (saved > 0) {
      try {
        await db.execute(sql`
          INSERT INTO project_notes (project_id, note, author)
          VALUES (
            ${projectId},
            ${"Auto-captured " + saved + " asset(s): " + assets.map(a => a.title + " (" + a.type + ")").join(", ")},
            'system'
          )
        `);
      } catch (_silentErr) { logSilentCatch("server/auto-asset-capture.ts", _silentErr); }
    }

    return saved;
  } catch (err: any) {
    console.error(`[asset-capture] Error for conv ${conversationId}:`, err.message);
    return 0;
  }
}

export async function backfillProjectAssets(): Promise<void> {
  try {
    const convRes = await db.execute(sql`
      SELECT DISTINCT c.id, c.project_id, c.tenant_id
      FROM conversations c
      WHERE c.project_id IS NOT NULL
        AND (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND role = 'assistant') > 0
      ORDER BY c.id
    `);
    const convs = (convRes as any).rows || convRes;
    if (!Array.isArray(convs) || convs.length === 0) {
      console.log("[asset-capture] No project conversations to backfill");
      return;
    }

    if (!fs.existsSync(ASSET_DIR)) {
      fs.mkdirSync(ASSET_DIR, { recursive: true });
    }

    const existingAssets = fs.existsSync(ASSET_DIR) ? fs.readdirSync(ASSET_DIR) : [];
    let totalCaptured = 0;

    for (const c of convs) {
      const alreadyHas = existingAssets.some(f => f.startsWith(`proj-${c.project_id}_`) && f.includes(`conv-${c.id}`) === false);
      
      const msgRes = await db.execute(sql`
        SELECT content FROM messages
        WHERE conversation_id = ${c.id} AND role = 'assistant'
        ORDER BY created_at ASC
      `);
      const msgs = (msgRes as any).rows || msgRes;
      if (!Array.isArray(msgs)) continue;

      for (const m of msgs) {
        const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        const captured = await captureProjectAssets(c.id, c.tenant_id, text);
        totalCaptured += captured;
      }
    }

    console.log(`[asset-capture] Backfill complete: captured ${totalCaptured} assets from ${convs.length} project conversations`);
  } catch (err: any) {
    console.error("[asset-capture] Backfill error:", err.message);
  }
}
