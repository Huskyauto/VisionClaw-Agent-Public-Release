import { db } from "./db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

const BRAIN_DIR = path.resolve(process.cwd(), "project-brains");

function ensureBrainDir() {
  if (!fs.existsSync(BRAIN_DIR)) {
    fs.mkdirSync(BRAIN_DIR, { recursive: true });
  }
}

function brainFilePath(projectId: number): string {
  return path.join(BRAIN_DIR, `project-${projectId}-brain.md`);
}

interface BrainSection {
  overview: string;
  status: string;
  assets: string[];
  decisions: string[];
  conversationLog: string[];
  nextSteps: string[];
  keyFacts: string[];
}

function parseBrain(content: string): BrainSection {
  const brain: BrainSection = {
    overview: "",
    status: "In Progress",
    assets: [],
    decisions: [],
    conversationLog: [],
    nextSteps: [],
    keyFacts: [],
  };

  const sections: Record<string, string> = {};
  let currentSection = "";
  for (const line of content.split("\n")) {
    const headerMatch = line.match(/^## (.+)/);
    if (headerMatch) {
      currentSection = headerMatch[1].trim().toLowerCase();
      sections[currentSection] = "";
    } else if (currentSection) {
      sections[currentSection] = (sections[currentSection] || "") + line + "\n";
    }
  }

  brain.overview = (sections["overview"] || "").trim();
  brain.status = (sections["status"] || "In Progress").trim() || "In Progress";
  brain.assets = extractBulletItems(sections["assets & deliverables"] || sections["assets"] || "");
  brain.decisions = extractBulletItems(sections["decisions & direction"] || sections["decisions"] || "");
  brain.conversationLog = extractBulletItems(sections["session log"] || sections["conversation log"] || "");
  brain.nextSteps = extractBulletItems(sections["next steps"] || sections["what's next"] || "");
  brain.keyFacts = extractBulletItems(sections["key facts"] || sections["facts"] || "");

  return brain;
}

function extractBulletItems(text: string): string[] {
  return text
    .split("\n")
    .filter(l => l.trim().startsWith("- "))
    .map(l => l.trim());
}

function serializeBrain(brain: BrainSection, projectName: string, projectId: number): string {
  const lines: string[] = [];
  lines.push(`# Project Brain: ${projectName} (#${projectId})`);
  lines.push(`_Auto-maintained knowledge file. Last updated: ${new Date().toISOString()}_\n`);

  lines.push(`## Overview`);
  lines.push(brain.overview || "_No overview yet._");
  lines.push("");

  lines.push(`## Status`);
  lines.push(brain.status);
  lines.push("");

  lines.push(`## Assets & Deliverables`);
  if (brain.assets.length > 0) {
    lines.push(...brain.assets);
  } else {
    lines.push("_No assets created yet._");
  }
  lines.push("");

  lines.push(`## Decisions & Direction`);
  if (brain.decisions.length > 0) {
    lines.push(...brain.decisions);
  } else {
    lines.push("_No decisions recorded yet._");
  }
  lines.push("");

  lines.push(`## Key Facts`);
  if (brain.keyFacts.length > 0) {
    lines.push(...brain.keyFacts);
  } else {
    lines.push("_No key facts recorded yet._");
  }
  lines.push("");

  lines.push(`## Session Log`);
  if (brain.conversationLog.length > 0) {
    const recentLogs = brain.conversationLog.slice(-30);
    lines.push(...recentLogs);
  } else {
    lines.push("_No sessions recorded yet._");
  }
  lines.push("");

  lines.push(`## Next Steps`);
  if (brain.nextSteps.length > 0) {
    lines.push(...brain.nextSteps);
  } else {
    lines.push("_No next steps defined._");
  }

  return lines.join("\n");
}

export async function updateProjectBrain(
  projectId: number,
  conversationId: number,
  userMessage: string,
  assistantResponse: string,
  personaName?: string
): Promise<void> {
  try {
    ensureBrainDir();

    const pRes = await db.execute(sql`SELECT name, status, description FROM projects WHERE id = ${projectId}`);
    const pRows = (pRes as any).rows || pRes;
    const project = Array.isArray(pRows) ? pRows[0] : null;
    if (!project) return;

    const filePath = brainFilePath(projectId);
    let brain: BrainSection;

    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, "utf-8");
      brain = parseBrain(existing);
    } else {
      brain = {
        overview: project.description || project.name || "",
        status: project.status || "In Progress",
        assets: [],
        decisions: [],
        conversationLog: [],
        nextSteps: [],
        keyFacts: [],
      };
    }

    const cleanResponse = assistantResponse
      .replace(/<!-- tools:\[.*?\] -->/gs, "")
      .replace(/<!-- route:.*? -->/g, "")
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .trim();

    const timestamp = new Date().toISOString().split("T")[0];
    const persona = personaName || "Agent";
    const userSnippet = userMessage.length > 100 ? userMessage.slice(0, 100) + "..." : userMessage;
    brain.conversationLog.push(`- [${timestamp}] Conv #${conversationId} (${persona}): User asked: "${userSnippet}"`);

    const responseSnippet = cleanResponse.length > 150 ? cleanResponse.slice(0, 150) + "..." : cleanResponse;
    brain.conversationLog.push(`- [${timestamp}] Conv #${conversationId} (${persona}): ${responseSnippet}`);

    const newAssets = extractCreatedAssets(cleanResponse, userMessage);
    for (const asset of newAssets) {
      const entry = `- [${timestamp}] **${asset.name}** (${asset.type}) — Conv #${conversationId}${asset.location ? ` at ${asset.location}` : ""}`;
      if (!brain.assets.some(a => a.includes(asset.name))) {
        brain.assets.push(entry);
      }
    }

    const newDecisions = extractDecisions(cleanResponse, userMessage);
    for (const decision of newDecisions) {
      brain.decisions.push(`- [${timestamp}] ${decision}`);
    }

    const newFacts = extractKeyFacts(cleanResponse, userMessage);
    for (const fact of newFacts) {
      if (!brain.keyFacts.some(f => f.toLowerCase().includes(fact.toLowerCase().slice(0, 30)))) {
        brain.keyFacts.push(`- ${fact}`);
      }
    }

    if (brain.keyFacts.length > 50) brain.keyFacts = brain.keyFacts.slice(-50);
    if (brain.decisions.length > 30) brain.decisions = brain.decisions.slice(-30);
    if (brain.conversationLog.length > 60) brain.conversationLog = brain.conversationLog.slice(-60);

    const output = serializeBrain(brain, project.name, projectId);
    fs.writeFileSync(filePath, output, "utf-8");

    console.log(`[project-brain] Updated brain for project #${projectId} (${brain.assets.length} assets, ${brain.conversationLog.length} log entries)`);
  } catch (err: any) {
    console.error(`[project-brain] Error updating project #${projectId}:`, err.message);
  }
}

interface DetectedAsset {
  name: string;
  type: string;
  location?: string;
}

function extractCreatedAssets(response: string, userMessage: string): DetectedAsset[] {
  const assets: DetectedAsset[] = [];

  const fileCreationPatterns = [
    /(?:created|saved|generated|wrote|uploaded|built)\s+(?:a\s+)?(?:the\s+)?["']?([^"'\n]{5,60})["']?\s+(?:file|document|script|deck|slide|presentation|report|spreadsheet|dashboard)/gi,
    /(?:file|document|script|deck|presentation)\s+["']([^"'\n]{5,60})["']\s+(?:has been|was|is)\s+(?:created|saved|generated)/gi,
    /saved\s+(?:to|as|at)\s+[`"]?([^\s`"]+\.\w{2,5})[`"]?/gi,
    /uploaded\s+(?:to\s+)?(?:Google\s+Drive|Drive)[:\s]+["']?([^"'\n]{5,60})["']?/gi,
  ];

  for (const pat of fileCreationPatterns) {
    let m;
    while ((m = pat.exec(response)) !== null) {
      const name = m[1].trim();
      if (name.length > 4 && !assets.some(a => a.name === name)) {
        let type = "document";
        if (/\.py$/i.test(name)) type = "Python script";
        else if (/\.ts$/i.test(name)) type = "TypeScript";
        else if (/\.js$/i.test(name)) type = "JavaScript";
        else if (/\.html$/i.test(name)) type = "HTML";
        else if (/\.md$/i.test(name)) type = "Markdown";
        else if (/slide|deck|presentation/i.test(name)) type = "Slide deck";
        else if (/script/i.test(name)) type = "Script";
        else if (/report/i.test(name)) type = "Report";
        else if (/pdf/i.test(name)) type = "PDF";

        assets.push({ name, type });
      }
    }
  }

  const codeBlocks = response.match(/```(\w+)?\n[\s\S]{200,}?```/g);
  if (codeBlocks && codeBlocks.length > 0) {
    for (const block of codeBlocks) {
      const langMatch = block.match(/```(\w+)/);
      const lang = langMatch?.[1]?.toLowerCase() || "";

      if (lang === "html" && (block.includes("<section") || block.includes("slide") || /presentation|deck/i.test(response.slice(0, 300)))) {
        if (!assets.some(a => a.type === "Slide deck")) {
          assets.push({ name: "Slide Deck", type: "Slide deck" });
        }
      }

      if ((lang === "markdown" || lang === "md") && (/script|narration|voice/i.test(response.slice(0, 500)))) {
        if (!assets.some(a => a.type === "Script")) {
          assets.push({ name: "Video Script", type: "Script" });
        }
      }
    }
  }

  const driveLinks = response.match(/https:\/\/drive\.google\.com\/\S+/g);
  if (driveLinks) {
    for (const link of driveLinks) {
      if (!assets.some(a => a.location === link)) {
        assets.push({ name: "Google Drive file", type: "Drive upload", location: link });
      }
    }
  }

  return assets;
}

function extractDecisions(response: string, userMessage: string): string[] {
  const decisions: string[] = [];

  const decisionPatterns = [
    /(?:decided|agreed|chose|selected|going with|will use|switching to|settled on)\s+(.{10,80})/gi,
    /(?:the plan is|the approach is|strategy is|direction is)\s+(.{10,80})/gi,
  ];

  for (const pat of decisionPatterns) {
    let m;
    while ((m = pat.exec(response)) !== null) {
      const decision = m[1].replace(/[.!,]$/, "").trim();
      if (decision.length > 10 && !decisions.includes(decision)) {
        decisions.push(decision);
      }
    }
  }

  return decisions.slice(0, 3);
}

function extractKeyFacts(response: string, userMessage: string): string[] {
  const facts: string[] = [];

  const factPatterns = [
    /(?:budget|price|cost)\s*(?:is|:)\s*\$?([\d,]+(?:\.\d{2})?)/gi,
    /(?:deadline|due|target\s*date|launch)\s*(?:is|:)\s*([\w\s,]+\d{4})/gi,
    /(?:client|customer|stakeholder)\s*(?:is|:)\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/g,
    /(?:brand|company|business)\s*(?:name|called)\s*(?:is|:)\s*["']?([^"'\n]{3,40})["']?/gi,
  ];

  for (const pat of factPatterns) {
    let m;
    while ((m = pat.exec(response + " " + userMessage)) !== null) {
      const fact = m[0].trim().slice(0, 80);
      if (!facts.includes(fact)) facts.push(fact);
    }
  }

  return facts.slice(0, 5);
}

export function loadProjectBrain(projectId: number): string | null {
  try {
    const filePath = brainFilePath(projectId);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8");
    }
    return null;
  } catch {
    return null;
  }
}

export async function backfillProjectBrains(): Promise<void> {
  try {
    ensureBrainDir();

    const projRes = await db.execute(sql`
      SELECT DISTINCT p.id, p.name
      FROM projects p
      JOIN conversations c ON c.project_id = p.id
      WHERE (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND role = 'assistant') > 0
    `);
    const projects = (projRes as any).rows || projRes;
    if (!Array.isArray(projects) || projects.length === 0) {
      console.log("[project-brain] No projects to backfill");
      return;
    }

    let updated = 0;
    for (const proj of projects) {
      const filePath = brainFilePath(proj.id);
      if (fs.existsSync(filePath)) continue;

      const convRes = await db.execute(sql`
        SELECT c.id, c.title
        FROM conversations c
        WHERE c.project_id = ${proj.id}
        ORDER BY c.created_at ASC
      `);
      const convs = (convRes as any).rows || convRes;
      if (!Array.isArray(convs) || convs.length === 0) continue;

      for (const conv of convs) {
        const msgRes = await db.execute(sql`
          SELECT role, content FROM messages
          WHERE conversation_id = ${conv.id}
          ORDER BY created_at ASC
        `);
        const msgs = (msgRes as any).rows || msgRes;
        if (!Array.isArray(msgs)) continue;

        const userMsgs = msgs.filter((m: any) => m.role === "user").map((m: any) => typeof m.content === "string" ? m.content : JSON.stringify(m.content));
        const assistMsgs = msgs.filter((m: any) => m.role === "assistant").map((m: any) => typeof m.content === "string" ? m.content : JSON.stringify(m.content));

        if (userMsgs.length > 0 && assistMsgs.length > 0) {
          await updateProjectBrain(
            proj.id,
            conv.id,
            userMsgs.join("\n---\n"),
            assistMsgs.join("\n---\n"),
            conv.title
          );
        }
      }
      updated++;
    }

    console.log(`[project-brain] Backfill complete: ${updated} project brains created`);
  } catch (err: any) {
    console.error("[project-brain] Backfill error:", err.message);
  }
}
