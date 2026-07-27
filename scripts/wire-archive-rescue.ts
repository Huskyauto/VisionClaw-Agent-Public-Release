/**
 * R125+13.10 — wire the Archive Rescue wedge (Cabinet to Cloud, ideabrowser IOTD 2026-05-25)
 * into VCA's agent infrastructure, AND wire the two inbox-ingest heartbeat crons
 * that were missing (pipeline existed but nothing scheduled it).
 *
 * Idempotent on every concern. Safe to re-run.
 *
 * What this does:
 *   1. Creates the Archive Rescue wedge project (tag wedge:archive-rescue +
 *      stage:validation + track:ideabrowser-iotd) with Drive folder + auto-
 *      generated project-brain file.
 *   2. Indexes the SOP into agent_knowledge under category wedge:archive-rescue
 *      so search_knowledge retrieves it.
 *   3. Inserts/updates the SOP entry in data/output-skills/_registry.json with
 *      sha256 + bytes pin (runtime integrity check will refuse to serve a
 *      mismatched SOP).
 *   4. Inserts/updates two heartbeat tasks for the inbox-ingest pipeline:
 *      inbox:ingest-daily (cron 0 7 * * *) — runs scripts/inbox-ingest.ts
 *      inbox:digest-daily (cron 30 7 * * *) — runs scripts/inbox-digest.ts
 *
 * Tenant resolution mirrors scripts/wire-wedges.ts (architect HIGH closed):
 * --tenant-id=N | WEDGE_TENANT_ID env | ALLOW_DEFAULT_TENANT=1.
 *
 * Exit codes: 0 success; non-zero category-specific failure.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { storage } from "../server/storage";
import { ensureProjectFolder } from "../server/google-drive";
import { createHash } from "node:crypto";
import * as fs from "fs";
import * as path from "path";

function resolveTenantId(): number {
  const argv = process.argv.find((a) => a.startsWith("--tenant-id="));
  const fromArg = argv ? Number(argv.split("=")[1]) : NaN;
  const fromEnv = Number(process.env.WEDGE_TENANT_ID || NaN);
  const id = Number.isFinite(fromArg) ? fromArg : Number.isFinite(fromEnv) ? fromEnv : NaN;
  if (Number.isFinite(id) && id > 0) return id;
  if (process.env.ALLOW_DEFAULT_TENANT === "1") return 1;
  console.error("[wire-archive-rescue] tenant required: --tenant-id=N or WEDGE_TENANT_ID or ALLOW_DEFAULT_TENANT=1");
  process.exit(2);
}
const TENANT_ID = resolveTenantId();

const WEDGE = {
  slug: "archive-rescue",
  name: "Wedge: Archive Rescue (Cabinet to Cloud)",
  fullDescription:
    "R125+13.10 active wedge — phone-camera → searchable digital archive for small museums, law firms, historical societies. Enterprise scanning vendors quote $30K–$50K; we deliver Starter $99 / Standard $299 / Pro $999+$49/mo. Sourced from Ideabrowser IOTD 2026-05-25 \"Cabinet to Cloud\". SOP: data/output-skills/wedge-archive-rescue-sop.md. Owner: Felix. Concierge delivery via Chief of Staff. HITL on first 20 OCR pages per tier.",
  tags: ["wedge:archive-rescue", "wedge", "stage:validation", "track:ideabrowser-iotd"],
  sopFile: "data/output-skills/wedge-archive-rescue-sop.md",
};

const CRON_TASKS = [
  {
    name: "inbox:ingest-daily",
    type: "routine",
    cron: "0 7 * * *",
    description: "Daily 07:00 — sweep allowlisted Gmail senders (last 2d), classify each new message, route per kind. Surfaces money-opportunity + bwb_video_idea + competitor_intel + capability_gap signals into review queues.",
    prompt:
      "You are Felix executing the daily inbox-ingest cron. Invoke the deterministic script via execute_code tool: `npx tsx scripts/inbox-ingest.ts`. The script fetches Gmail messages from inbox_sender_allowlist senders, dedups against inbox_messages, classifies each new message, and routes per kind (bwb_video_idea → data/youtube/scripts/_idea-gmail-*.md, money_opportunity → data/money-opportunities/*.md, vca_capability_gap → capability_gaps table, competitor_intel → digest, idea_log/noise → log only). Read its stdout. If summary.errors is non-empty, log the failures under category 'inbox:ingest-errors' so they're visible at next chat. If any money_opportunity or vca_capability_gap was routed, log a one-line per-file summary under category 'inbox:high-signal' so the next chat sees them. Do not invoke other tools; this is a deterministic pipeline.",
  },
  {
    name: "inbox:digest-daily",
    type: "routine",
    cron: "30 7 * * *",
    description: "Daily 07:30 — 30min after ingest. Builds the inbox digest from last 24h of classifications and emails OWNER_EMAIL with the high-signal items (money_opportunity + bwb_video_idea + vca_capability_gap + competitor_intel).",
    prompt:
      "You are Felix executing the daily inbox-digest cron. Invoke `npx tsx scripts/inbox-digest.ts` via execute_code. The script reads inbox_classifications from the last 24h, builds a markdown digest, and emails it to OWNER_EMAIL via Gmail. Read its stdout. If it exits non-zero, log under category 'inbox:digest-errors'. Do not retry on transient send failure (script handles its own retries).",
  },
];

async function safeFelixPersonaId(): Promise<number | null> {
  try {
    const r: any = await db.execute(sql`SELECT id FROM personas WHERE name='Felix' LIMIT 1`);
    return (r.rows || r)[0]?.id ?? null;
  } catch {
    return null;
  }
}

function nextCronRun(cronExpr: string): Date {
  const m = cronExpr.match(/^(\d+) (\d+) (\S+) (\S+) (\S+)$/);
  if (!m) return new Date(Date.now() + 60 * 60 * 1000);
  const [, mm, hh, , , dow] = m;
  const next = new Date();
  next.setSeconds(0, 0);
  next.setMinutes(parseInt(mm, 10));
  next.setHours(parseInt(hh, 10));
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  if (dow !== "*") {
    const targetDow = parseInt(dow, 10);
    let safety = 8;
    while (next.getDay() !== targetDow && safety-- > 0) next.setDate(next.getDate() + 1);
  }
  return next;
}

async function upsertProject(): Promise<{ id: number; created: boolean }> {
  const existing: any = await db.execute(sql`
    SELECT id FROM projects WHERE tenant_id=${TENANT_ID} AND name=${WEDGE.name} LIMIT 1
  `);
  const row = (existing.rows || existing)[0];
  if (row) return { id: row.id, created: false };
  const tagLiteral = `{${WEDGE.tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(",")}}`;
  const ins: any = await db.execute(sql`
    INSERT INTO projects (name, description, status, tags, tenant_id)
    VALUES (${WEDGE.name}, ${WEDGE.fullDescription}, 'active', ${tagLiteral}::text[], ${TENANT_ID})
    RETURNING id
  `);
  return { id: ((ins.rows || ins)[0] as any).id, created: true };
}

function ensureBrainFile(projectId: number): string {
  const dir = "project-brains";
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `project-${projectId}-brain.md`);
  if (fs.existsSync(p)) return p;
  const body = `# ${WEDGE.name}\n\n` +
    `**Project ID:** ${projectId}\n` +
    `**Tenant:** ${TENANT_ID}\n` +
    `**Tags:** ${WEDGE.tags.join(", ")}\n` +
    `**SOP:** \`${WEDGE.sopFile}\` — Felix fetches via \`lookup_output_skill\` topic \`wedge-archive-rescue-sop\`\n` +
    `**Source idea:** Ideabrowser IOTD 2026-05-25 "Cabinet to Cloud" — https://www.ideabrowser.com/idea/digitizeondemand-ai-driven-archival-document-conversion-3687\n\n` +
    `## What this project tracks\n\n${WEDGE.fullDescription}\n\n` +
    `## How Felix should approach work on this wedge\n\n` +
    `1. \`lookup_output_skill\` topic=\`wedge-archive-rescue-sop\` for the canonical procedure.\n` +
    `2. \`search_knowledge\` category=\`wedge:archive-rescue\` for accumulated context (per-customer notes, OCR quirks, pricing-tier mix).\n` +
    `3. Per paying customer, spawn a sub-project under tag \`archive-rescue:customer-<slug>\` and log status changes via the \`project\` tool with id=${projectId}.\n` +
    `4. Deliveries: ALWAYS \`deliver_product\` (HARD RULE — never \`uploadAndShare\` directly). Per-org search portal URL + Drive ZIP both surfaced.\n` +
    `5. OCR pass: \`generate_image\` with \`purpose: "ocr_dense_text"\` (cost-aware cascade). Chunk-and-parallel any batch >100 pages.\n` +
    `6. HITL gate on FIRST customer per tier: Bob reviews 20 sample pages before final delivery. After first per-tier, 10% spot check.\n\n` +
    `_Auto-generated by \`scripts/wire-archive-rescue.ts\` — safe to re-run; regenerates if missing._\n`;
  fs.writeFileSync(p, body, "utf-8");
  return p;
}

async function indexKnowledge(category: string, title: string, filePath: string): Promise<boolean> {
  if (!fs.existsSync(filePath)) {
    console.warn(`[wire] knowledge skip — missing ${filePath}`);
    return false;
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const dupe: any = await db.execute(sql`
    SELECT id FROM agent_knowledge
    WHERE tenant_id=${TENANT_ID} AND category=${category} AND title=${title} LIMIT 1
  `);
  if ((dupe.rows || dupe)[0]) return false;
  try {
    await storage.createKnowledge({
      title,
      content: content.slice(0, 60_000),
      category,
      priority: 4,
      personaId: null as any,
      tenantId: TENANT_ID,
    } as any);
    return true;
  } catch (e: any) {
    console.warn(`[wire] knowledge insert failed for ${title}: ${e.message}`);
    return false;
  }
}

async function upsertHeartbeatTask(t: typeof CRON_TASKS[number], personaId: number | null): Promise<{ id: number; created: boolean }> {
  const existing: any = await db.execute(sql`
    SELECT id FROM heartbeat_tasks WHERE tenant_id=${TENANT_ID} AND name=${t.name} LIMIT 1
  `);
  const row = (existing.rows || existing)[0];
  if (row) {
    await db.execute(sql`
      UPDATE heartbeat_tasks
      SET cron_expression=${t.cron}, prompt_content=${t.prompt}, description=${t.description},
          enabled=true, next_run_at=${nextCronRun(t.cron)}
      WHERE id=${row.id}
    `);
    return { id: row.id, created: false };
  }
  const ins: any = await db.execute(sql`
    INSERT INTO heartbeat_tasks (name, description, type, cron_expression, enabled, prompt_content, model, persona_id, created_by, tenant_id, next_run_at)
    VALUES (${t.name}, ${t.description}, ${t.type}, ${t.cron}, true, ${t.prompt}, 'claude-sonnet-4-5', ${personaId}, 'wire-archive-rescue', ${TENANT_ID}, ${nextCronRun(t.cron)})
    RETURNING id
  `);
  return { id: ((ins.rows || ins)[0] as any).id, created: true };
}

function upsertRegistryPin(): { added: boolean; updated: boolean } {
  const regPath = "data/output-skills/_registry.json";
  const reg = JSON.parse(fs.readFileSync(regPath, "utf-8"));
  const fileName = path.basename(WEDGE.sopFile);
  const topic = path.basename(fileName, ".md");
  if (!fs.existsSync(WEDGE.sopFile)) {
    console.warn(`[wire] SOP missing ${WEDGE.sopFile} — registry pin skipped`);
    return { added: false, updated: false };
  }
  const buf = fs.readFileSync(WEDGE.sopFile);
  const sha = createHash("sha256").update(buf).digest("hex");
  const bytes = buf.length;
  const idx = reg.skills.findIndex((s: any) => s.topic === topic);
  const entry = {
    topic,
    file: fileName,
    department: "Strategy",
    persona_fit: ["felix", "minerva", "ceo"],
    last_reviewed: new Date().toISOString().slice(0, 10),
    sha256: sha,
    bytes,
    is_public: false,
    summary: `R125+13.10 wedge SOP for Archive Rescue (Cabinet to Cloud) — phone-camera → searchable digital archive for small orgs at $99–$999. Felix's canonical procedure with kill criteria + pipeline + metrics.`,
  };
  let added = false, updated = false;
  if (idx >= 0) { reg.skills[idx] = { ...reg.skills[idx], ...entry }; updated = true; }
  else { reg.skills.push(entry); added = true; }
  const tmp = regPath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, regPath);
  return { added, updated };
}

(async () => {
  const tenant = await storage.getTenant(TENANT_ID);
  const tenantName = tenant?.name || `tenant-${TENANT_ID}`;
  const personaId = await safeFelixPersonaId();
  console.log(`[wire] tenant=${tenantName} felix_persona_id=${personaId}`);

  // 1. Wedge project
  const proj = await upsertProject();
  console.log(`[wire] project ${WEDGE.slug}: #${proj.id} ${proj.created ? "(created)" : "(reused)"}`);

  try {
    const existingFolder: any = await db.execute(sql`SELECT drive_folder_id FROM projects WHERE id=${proj.id}`);
    const dfid = (existingFolder.rows || existingFolder)[0]?.drive_folder_id;
    if (!dfid) {
      const folder = await ensureProjectFolder(proj.id, WEDGE.name, TENANT_ID, tenantName);
      await db.execute(sql`UPDATE projects SET drive_folder_id=${folder.id}, drive_folder_url=${folder.url} WHERE id=${proj.id}`);
      console.log(`[wire] drive folder: ${folder.url}`);
    }
  } catch (e: any) {
    console.warn(`[wire] drive folder skipped: ${e.message}`);
  }

  const brain = ensureBrainFile(proj.id);
  console.log(`[wire] brain: ${brain}`);

  // 2. Knowledge index
  const k1 = await indexKnowledge(`wedge:${WEDGE.slug}`, `SOP — ${WEDGE.name}`, WEDGE.sopFile);
  console.log(`[wire] knowledge: ${k1 ? "+1 SOP" : "SOP already indexed"}`);

  // 3. Registry pin
  const reg = upsertRegistryPin();
  console.log(`[wire] output-skills registry: ${reg.added ? "+1 new" : reg.updated ? "~1 updated" : "no change"}`);

  // 4. Inbox heartbeat tasks
  for (const t of CRON_TASKS) {
    const r = await upsertHeartbeatTask(t, personaId);
    console.log(`[wire] heartbeat ${t.name}: #${r.id} ${r.created ? "(created)" : "(updated)"} — next ${nextCronRun(t.cron).toISOString()}`);
  }

  console.log(`\n========== SUMMARY ==========`);
  console.log(`  archive-rescue: project #${proj.id} · brain=${brain}`);
  console.log(`  inbox-ingest cron + inbox-digest cron wired (daily 07:00 / 07:30 UTC).`);
  console.log(`  Classifier now recognizes "money_opportunity" kind → data/money-opportunities/*.md queue.`);
  process.exit(0);
})().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
