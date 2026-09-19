import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { storage } from "../server/storage";
import { ensureProjectFolder, uploadAndShare } from "../server/google-drive";
import { getGmailDirectAccessToken } from "../server/lib/gmail-direct-token";

const TENANT_ID = 1;
const IDEABROWSER_FROM = "notifications@mail.ideabrowser.com";
const SINCE_DAYS = 400;
const MAX_MESSAGES = 500;
const GMAIL_INBOX_ID = "gmail:huskyauto@gmail.com";

interface ManualPlan {
  name: string;
  description: string;
  tags: string[];
}

const MANUAL_FOOTER_PLANS: ManualPlan[] = [
  {
    name: "AI Dream Interpreter with Pattern Tracking (Isenberg IOTD 2026-05-24 footer)",
    description:
      "Footer idea from Greg Isenberg's Idea Browser Idea of the Day 2026-05-24. Concept: AI-powered dream journaling app that interprets individual dreams AND tracks recurring symbols, emotional patterns, and themes over time to surface insights a single-dream interpreter can't see. Differentiation = the longitudinal pattern layer, not the one-off interpretation. Source: ideabrowser.com/idea/ai-dream-interpreter-with-pattern-tracking. Status: idea-stage — needs ICP, monetization, and a thin-MVP scope before promotion.",
    tags: ["isenberg", "ideabrowser", "iotd", "dream-interpreter", "ai-app", "idea-stage"],
  },
  {
    name: "Virtual Style Advisor — Plus-Size Trendy Fashion (Isenberg IOTD 2026-05-24 footer)",
    description:
      "Footer idea from Greg Isenberg's Idea Browser Idea of the Day 2026-05-24. Concept: AI virtual style advisor focused on the underserved trendy plus-size fashion segment — outfit recommendations, fit guidance, brand discovery for a market most general styling apps ignore. Source: ideabrowser.com/idea/virtual-style-advisor-for-trendy-plus-size-fashion-3653. Status: idea-stage — needs ICP, monetization, and a thin-MVP scope before promotion.",
    tags: ["isenberg", "ideabrowser", "iotd", "style-advisor", "plus-size", "fashion", "ai-app", "idea-stage"],
  },
];

/* ───────────────────────── Gmail backfill (ideabrowser only) ───────────────────────── */

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

async function backfillIdeabrowser(): Promise<{ fetched: number; newlyStored: number; errors: string[] }> {
  const summary = { fetched: 0, newlyStored: 0, errors: [] as string[] };
  const token = await getGmailDirectAccessToken();
  if (!token) {
    summary.errors.push("No gmail-direct access token — run /api/admin/gmail-direct/auth first");
    return summary;
  }

  const query = `from:${IDEABROWSER_FROM} newer_than:${SINCE_DAYS}d`;
  let nextPageToken: string | undefined;
  const ids: string[] = [];

  do {
    const url =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages` +
      `?q=${encodeURIComponent(query)}&maxResults=${MAX_MESSAGES}` +
      (nextPageToken ? `&pageToken=${nextPageToken}` : "");
    let list: any;
    try {
      list = await gmailFetch(token, url);
    } catch (e: any) {
      summary.errors.push(`gmail-list: ${e.message}`);
      break;
    }
    ids.push(...(list.messages || []).map((m: any) => m.id));
    nextPageToken = list.nextPageToken;
    if (ids.length >= MAX_MESSAGES) break;
  } while (nextPageToken);

  summary.fetched = ids.length;
  console.log(`[backfill] Gmail returned ${ids.length} ideabrowser messages (last ${SINCE_DAYS}d)`);

  for (const id of ids) {
    let msg: any;
    try {
      msg = await gmailFetch(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
    } catch (e: any) {
      summary.errors.push(`gmail-get ${id}: ${e.message}`);
      continue;
    }
    const from = getHeader(msg, "From");
    const to = getHeader(msg, "To");
    const subject = getHeader(msg, "Subject") || "(No Subject)";
    const dateHdr = getHeader(msg, "Date");
    const { text, html } = extractBody(msg.payload);
    const receivedAt = dateHdr ? new Date(dateHdr) : new Date();

    const res: any = await db.execute(sql`
      INSERT INTO inbox_messages
        (tenant_id, message_id, inbox_id, from_address, to_address, subject,
         body_text, body_html, thread_id, received_at, direction, quarantined)
      VALUES
        (${TENANT_ID}, ${id}, ${GMAIL_INBOX_ID}, ${from}, ${to}, ${subject},
         ${text || ""}, ${html || ""}, ${msg.threadId || null}, ${receivedAt}, ${"inbound"}, false)
      ON CONFLICT (message_id) DO NOTHING
      RETURNING id
    `);
    const rows = res?.rows || res || [];
    if (rows.length > 0) summary.newlyStored++;
  }
  console.log(`[backfill] Stored ${summary.newlyStored} new (skipped ${summary.fetched - summary.newlyStored} dupes)`);
  return summary;
}

/* ───────────────────────── Idea extraction from IOTD body ───────────────────────── */

interface ExtractedIdea {
  emailId: number;
  messageId: string;
  receivedDate: string;
  ideaName: string;
  ideaSlug: string | null;
  ideaUrl: string | null;
  leadParagraph: string;
}

function extractIdeaFromEmail(row: {
  id: number;
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

  const receivedDate = row.received_at.toISOString().slice(0, 10);
  return {
    emailId: row.id,
    messageId: row.message_id,
    receivedDate,
    ideaName,
    ideaSlug,
    ideaUrl,
    leadParagraph,
  };
}

/* ───────────────────────── Project creation ───────────────────────── */

async function projectExists(name: string, slugTag: string | null): Promise<boolean> {
  const res: any = await db.execute(sql`
    SELECT id FROM projects
    WHERE tenant_id = ${TENANT_ID}
      AND (
        name = ${name}
        OR (${slugTag}::text IS NOT NULL AND ${slugTag} = ANY(tags))
      )
    LIMIT 1
  `);
  const rows = res?.rows || res || [];
  return rows.length > 0;
}

async function createProjectFromIdea(idea: ExtractedIdea, tenantName: string): Promise<{ id: number; name: string; driveUrl: string | null } | null> {
  const projectName = `${idea.ideaName} (Isenberg IOTD ${idea.receivedDate})`;
  const slugTag = idea.ideaSlug ? `ideabrowser-slug:${idea.ideaSlug}` : null;

  if (await projectExists(projectName, slugTag)) {
    console.log(`[backfill] SKIP existing: ${projectName}`);
    return null;
  }

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
    VALUES (${projectName}, ${description}, 'active', ${tagLiteral}::text[], ${TENANT_ID})
    RETURNING id, name
  `);
  const rows = insertResult?.rows || insertResult;
  const project = Array.isArray(rows) ? rows[0] : rows;

  console.log(`[backfill] ✓ #${project.id} ${projectName} (drive-folder lazy)`);
  return { id: project.id, name: projectName, driveUrl: null };
}

async function createManualPlan(spec: ManualPlan, tenantName: string) {
  if (await projectExists(spec.name, null)) {
    console.log(`[manual] SKIP existing: ${spec.name}`);
    return null;
  }
  const tagLiteral = `{${spec.tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(",")}}`;
  const insertResult: any = await db.execute(sql`
    INSERT INTO projects (name, description, status, tags, tenant_id)
    VALUES (${spec.name}, ${spec.description}, 'active', ${tagLiteral}::text[], ${TENANT_ID})
    RETURNING id, name
  `);
  const rows = insertResult?.rows || insertResult;
  const project = Array.isArray(rows) ? rows[0] : rows;
  let driveUrl: string | null = null;
  try {
    const folder = await ensureProjectFolder(project.id, spec.name, TENANT_ID, tenantName);
    driveUrl = folder.url;
    await db.execute(sql`
      UPDATE projects SET drive_folder_id = ${folder.id}, drive_folder_url = ${folder.url}
      WHERE id = ${project.id} AND tenant_id = ${TENANT_ID}
    `);
  } catch (e: any) {
    console.warn(`[manual] Drive folder failed for #${project.id}: ${e.message}`);
  }
  console.log(`[manual] ✓ #${project.id} ${spec.name}${driveUrl ? ` — ${driveUrl}` : ""}`);
  return { id: project.id, name: spec.name, driveUrl };
}

/* ───────────────────────── Main ───────────────────────── */

(async () => {
  const tenant = await storage.getTenant(TENANT_ID);
  const tenantName = tenant?.name || `tenant-${TENANT_ID}`;

  console.log("─── Phase 1: footer ideas from 2026-05-24 IOTD ───");
  const manualResults: any[] = [];
  for (const spec of MANUAL_FOOTER_PLANS) {
    try {
      const r = await createManualPlan(spec, tenantName);
      if (r) manualResults.push(r);
    } catch (e: any) {
      console.error(`[manual] ✗ ${spec.name}: ${e.message}`);
    }
  }

  console.log("\n─── Phase 2: Gmail backfill (ideabrowser only, last 400 days) ───");
  const ingest = await backfillIdeabrowser();
  if (ingest.errors.length) console.warn("[backfill] errors:", ingest.errors);

  console.log("\n─── Phase 3: extract + create per-IOTD projects ───");
  const allRes: any = await db.execute(sql`
    SELECT id, message_id, subject, body_text, received_at
    FROM inbox_messages
    WHERE tenant_id = ${TENANT_ID}
      AND from_address ILIKE ${`%${IDEABROWSER_FROM}%`}
    ORDER BY received_at ASC
  `);
  const allEmails = allRes?.rows || allRes || [];
  console.log(`[extract] Found ${allEmails.length} ideabrowser emails in DB`);

  const createdResults: any[] = [];
  const skippedResults: any[] = [];
  for (const row of allEmails) {
    const idea = extractIdeaFromEmail({
      id: row.id,
      message_id: row.message_id,
      subject: row.subject,
      body_text: row.body_text,
      received_at: new Date(row.received_at),
    });
    if (!idea) {
      console.log(`[extract] skip email #${row.id} — no idea name extractable from subject "${row.subject}"`);
      continue;
    }
    try {
      const r = await createProjectFromIdea(idea, tenantName);
      if (r) createdResults.push(r);
      else skippedResults.push(idea.ideaName);
    } catch (e: any) {
      console.error(`[backfill] ✗ ${idea.ideaName}: ${e.message}`);
    }
  }

  console.log("\n========== FINAL SUMMARY ==========");
  console.log(`Manual footer plans created:      ${manualResults.length}`);
  console.log(`Gmail emails fetched/newly-stored: ${ingest.fetched} / ${ingest.newlyStored}`);
  console.log(`Per-IOTD projects created:        ${createdResults.length}`);
  console.log(`Per-IOTD projects skipped (dupe): ${skippedResults.length}`);
  console.log("\nCreated projects:");
  for (const r of [...manualResults, ...createdResults]) {
    console.log(`  #${r.id} — ${r.name}${r.driveUrl ? ` — ${r.driveUrl}` : ""}`);
  }
  if (skippedResults.length) {
    console.log("\nSkipped (already exist):");
    for (const n of skippedResults) console.log(`  · ${n}`);
  }
  process.exit(0);
})().catch((err) => {
  console.error("[backfill] FATAL:", err);
  process.exit(1);
});
