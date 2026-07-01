// Incremental IdeaBrowser (Greg Isenberg "Idea of the Day") email ingest.
//
// This is the DAILY, incremental counterpart to scripts/backfill-isenberg-projects.ts
// (which is a one-time 400-day backfill). It pulls only recent ideabrowser emails
// (newer_than:Nd), stores any new ones in inbox_messages (idempotent on message_id),
// extracts the IOTD idea from each, and creates an idea-stage project per new idea.
//
// Shared building block for the autonomous auto-build loop. Never throws — returns
// a structured summary; all per-message failures are collected in `errors`.

import { db } from "../db";
import { sql } from "drizzle-orm";
import { getGmailDirectAccessToken } from "./gmail-direct-token";

const IDEABROWSER_FROM = "notifications@mail.ideabrowser.com";
const GMAIL_INBOX_ID = "gmail:huskyauto@gmail.com";
const MAX_MESSAGES = 50; // daily incremental — small window, never a backfill

export interface IngestSummary {
  fetched: number;
  newlyStored: number;
  createdProjectIds: number[];
  errors: string[];
}

interface ExtractedIdea {
  messageId: string;
  receivedDate: string;
  ideaName: string;
  ideaSlug: string | null;
  ideaUrl: string | null;
  leadParagraph: string;
}

async function gmailFetch(token: string, url: string): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

function extractBody(part: any): { text: string; html: string } {
  let text = "";
  let html = "";
  function walk(p: any): void {
    if (!p) return;
    if (p.body?.data) {
      const decoded = Buffer.from(p.body.data, "base64url").toString("utf-8");
      if (p.mimeType === "text/plain") text += decoded;
      else if (p.mimeType === "text/html") html += decoded;
    }
    if (p.parts) p.parts.forEach(walk);
  }
  walk(part);
  return { text, html };
}

function getHeader(msg: any, name: string): string {
  return (msg.payload?.headers || []).find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function extractIdeaFromEmail(row: {
  message_id: string;
  subject: string;
  body_text: string;
  received_at: Date;
}): ExtractedIdea | null {
  const subject = row.subject || "";
  let ideaName = subject.replace(/^.*Idea of the Day:\s*/i, "").trim();
  if (!ideaName || ideaName === subject) {
    ideaName = subject.replace(/^\[.*?\]\s*/, "").trim();
  }
  if (!ideaName) return null;

  const slugMatch = (row.body_text || "").match(/ideabrowser\.com\/idea\/([a-z0-9-]+)/i);
  const ideaSlug = slugMatch?.[1] || null;
  const ideaUrl = ideaSlug ? `https://www.ideabrowser.com/idea/${ideaSlug}` : null;

  let leadParagraph = "";
  const body = row.body_text || "";
  const lines = body.split(/\r?\n/).map((l) => l.trim());
  const iotdIdx = lines.findIndex((l) => /^Idea of the Day$/i.test(l));
  if (iotdIdx >= 0) {
    for (let i = iotdIdx + 1; i < Math.min(iotdIdx + 30, lines.length); i++) {
      const l = lines[i];
      if (!l) continue;
      if (/^(Browse this idea|View full idea|Today's report|Also released|---)/i.test(l)) break;
      if (/^https?:/.test(l)) continue;
      if (l.length < 40) continue;
      leadParagraph = l;
      break;
    }
  }
  if (!leadParagraph) {
    const m = body.match(/[A-Z][^.]{60,400}\./);
    leadParagraph = m?.[0] || body.slice(0, 300).replace(/\s+/g, " ").trim();
  }
  leadParagraph = leadParagraph.replace(/\s+/g, " ").trim().slice(0, 600);

  return {
    messageId: row.message_id,
    receivedDate: row.received_at.toISOString().slice(0, 10),
    ideaName,
    ideaSlug,
    ideaUrl,
    leadParagraph,
  };
}

async function projectExists(tenantId: number, name: string, slugTag: string | null): Promise<boolean> {
  const res: any = await db.execute(sql`
    SELECT id FROM projects
    WHERE tenant_id = ${tenantId}
      AND (name = ${name} OR (${slugTag}::text IS NOT NULL AND ${slugTag} = ANY(tags)))
    LIMIT 1
  `);
  const rows = res?.rows || res || [];
  return rows.length > 0;
}

async function createProjectFromIdea(tenantId: number, idea: ExtractedIdea): Promise<number | null> {
  const projectName = `${idea.ideaName} (Isenberg IOTD ${idea.receivedDate})`;
  const slugTag = idea.ideaSlug ? `ideabrowser-slug:${idea.ideaSlug}` : null;

  if (await projectExists(tenantId, projectName, slugTag)) return null;

  const description =
    `Idea-stage project sourced from Greg Isenberg's Idea Browser Idea of the Day, ${idea.receivedDate}.\n\n` +
    `Concept: ${idea.leadParagraph}\n\n` +
    (idea.ideaUrl ? `Source: ${idea.ideaUrl}\n` : "") +
    `Email message id: ${idea.messageId}\n\n` +
    `Status: idea-stage — needs ICP validation, monetization model, and a build-vs-buy decision before promotion to active wedge.`;

  const tags = ["isenberg", "ideabrowser", "iotd", "idea-stage"];
  if (slugTag) tags.push(slugTag);
  const tagLiteral = `{${tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(",")}}`;

  const insertResult: any = await db.execute(sql`
    INSERT INTO projects (name, description, status, tags, tenant_id)
    VALUES (${projectName}, ${description}, 'active', ${tagLiteral}::text[], ${tenantId})
    RETURNING id
  `);
  const rows = insertResult?.rows || insertResult;
  const project = Array.isArray(rows) ? rows[0] : rows;
  return project?.id ?? null;
}

/**
 * Pull recent ideabrowser emails, store new ones, and create a project per new idea.
 * Never throws — failures are collected in `errors`.
 */
export async function ingestNewIdeabrowser(opts: {
  tenantId: number;
  sinceDays?: number;
}): Promise<IngestSummary> {
  const tenantId = opts.tenantId;
  const sinceDays = Math.max(1, Math.min(opts.sinceDays ?? 2, 30));
  const summary: IngestSummary = { fetched: 0, newlyStored: 0, createdProjectIds: [], errors: [] };

  const token = await getGmailDirectAccessToken();
  if (!token) {
    summary.errors.push("No gmail-direct access token — run /api/admin/gmail-direct/auth first");
    return summary;
  }

  const query = `from:${IDEABROWSER_FROM} newer_than:${sinceDays}d`;
  let list: any;
  try {
    list = await gmailFetch(
      token,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${MAX_MESSAGES}`,
    );
  } catch (e: any) {
    summary.errors.push(`gmail-list: ${e?.message || e}`);
    return summary;
  }
  const ids: string[] = (list.messages || []).map((m: any) => m.id);
  summary.fetched = ids.length;

  for (const id of ids) {
    let msg: any;
    try {
      msg = await gmailFetch(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
    } catch (e: any) {
      summary.errors.push(`gmail-get ${id}: ${e?.message || e}`);
      continue;
    }
    const from = getHeader(msg, "From");
    const to = getHeader(msg, "To");
    const subject = getHeader(msg, "Subject") || "(No Subject)";
    const dateHdr = getHeader(msg, "Date");
    const { text, html } = extractBody(msg.payload);
    const receivedAt = dateHdr ? new Date(dateHdr) : new Date();

    let stored = false;
    try {
      const res: any = await db.execute(sql`
        INSERT INTO inbox_messages
          (tenant_id, message_id, inbox_id, from_address, to_address, subject,
           body_text, body_html, thread_id, received_at, direction, quarantined)
        VALUES
          (${tenantId}, ${id}, ${GMAIL_INBOX_ID}, ${from}, ${to}, ${subject},
           ${text || ""}, ${html || ""}, ${msg.threadId || null}, ${receivedAt}, ${"inbound"}, false)
        ON CONFLICT (message_id) DO NOTHING
        RETURNING id
      `);
      const rows = res?.rows || res || [];
      stored = rows.length > 0;
    } catch (e: any) {
      summary.errors.push(`store ${id}: ${e?.message || e}`);
      continue;
    }
    if (!stored) continue; // dupe — already ingested + projectized on a prior run
    summary.newlyStored++;

    const idea = extractIdeaFromEmail({ message_id: id, subject, body_text: text || "", received_at: receivedAt });
    if (!idea) continue;
    try {
      const pid = await createProjectFromIdea(tenantId, idea);
      if (pid) summary.createdProjectIds.push(pid);
    } catch (e: any) {
      summary.errors.push(`project ${idea.ideaName}: ${e?.message || e}`);
    }
  }

  return summary;
}
