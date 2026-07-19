/**
 * R125+13.12 — wire the Creator Sponsor Ops wedge (Plugger-style, ideabrowser IOTD 2026-05-20)
 * into VCA's agent infrastructure. CONCIERGE-MODE ONLY — no public landing yet.
 *
 * Pattern: mirrors scripts/wire-archive-rescue.ts. Idempotent on every concern.
 *
 * What this does:
 *   1. Creates the Creator Sponsor Ops wedge project (tag wedge:creator-sponsor-ops +
 *      stage:validation + track:ideabrowser-iotd) with Drive folder + auto-
 *      generated project-brain file.
 *   2. Indexes the SOP into agent_knowledge under category wedge:creator-sponsor-ops
 *      so search_knowledge retrieves it.
 *   3. Inserts/updates the SOP entry in data/output-skills/_registry.json with
 *      sha256 + bytes pin (runtime integrity check will refuse to serve a
 *      mismatched SOP).
 *   4. Inserts/updates three heartbeat tasks for the deterministic pipeline:
 *      cso:deadline-scan-daily       (cron 0 8 * * *)
 *      cso:weekly-digest             (cron 0 9 * * 1)
 *      cso:pro-brand-discovery-monthly (cron 0 10 1 * *)
 *
 * Tenant resolution: --tenant-id=N | WEDGE_TENANT_ID env | ALLOW_DEFAULT_TENANT=1.
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
  console.error("[wire-creator-sponsor-ops] tenant required: --tenant-id=N or WEDGE_TENANT_ID or ALLOW_DEFAULT_TENANT=1");
  process.exit(2);
}
const TENANT_ID = resolveTenantId();

const WEDGE = {
  slug: "creator-sponsor-ops",
  name: "Wedge: Creator Sponsor Ops",
  fullDescription:
    "R125+13.12 active wedge — concierge sponsor-back-office for creators running 5+ brand deals. Starter $99 90-day audit / Standard $299/mo ongoing extraction + digests / Pro $499/mo + Monid-powered brand-discovery outreach. CONCIERGE-MODE — no public landing until 3 paying Standard customers. Sourced from Ideabrowser IOTD 2026-05-20 \"Sponsorship back office for creators\". SOP: data/output-skills/wedge-creator-sponsor-ops-sop.md. Owner: Felix. HITL on first customer per tier + 10% spot check after.",
  tags: ["wedge:creator-sponsor-ops", "wedge", "stage:validation", "track:ideabrowser-iotd"],
  sopFile: "data/output-skills/wedge-creator-sponsor-ops-sop.md",
};

const CRON_TASKS = [
  {
    name: "cso:deadline-scan-daily",
    type: "routine",
    cron: "0 8 * * *",
    description: "Daily 08:00 — scan knowledge_entries category creator-sponsor-ops:* for deliverables due in 7d/3d/1d; email + (optional) SMS reminder to each Standard/Pro customer.",
    prompt:
      "You are Felix executing the Creator Sponsor Ops daily deadline scan. (1) search_knowledge category prefix 'creator-sponsor-ops:' across all paying customers. (2) For each extracted deal, parse deliverables[] and paymentDueDate. (3) If any deliverable.dueDate or paymentDueDate falls within next 1d/3d/7d AND status != 'done', queue a reminder email via send_email to the customer's primary contact (from customer sub-project metadata). (4) Log each reminder under category 'creator-sponsor-ops:reminders' for the per-customer weekly digest. (5) If a customer has NO active deals, skip — do not send 'all clear' emails. Never auto-send to the BRAND (sponsor) — only to the creator. HARD RULE: deliver_product (not uploadAndShare) if any reminder bundles a PDF.",
  },
  {
    name: "cso:weekly-digest",
    type: "routine",
    cron: "0 9 * * 1",
    description: "Monday 09:00 — per-customer weekly digest of last-7d extractions + active-deal status + deadline forecast. Delivered as PDF via deliver_product + email.",
    prompt:
      "You are Felix executing the Creator Sponsor Ops weekly digest. (1) For each paying customer (project with tag 'creator-sponsor-ops:customer-*'), pull last 7d knowledge_entries category 'creator-sponsor-ops:<slug>'. (2) Render markdown digest: new extractions this week / active deals table / deliverables due next 14d / payments owed / conflicts flagged. (3) Render to PDF via create_pdf with the creator's brand color if known. (4) deliver_product (HARD RULE) — surface Drive viewUrl AND inline PDF in the email body. (5) Log digest delivery under category 'creator-sponsor-ops:digest-log'. (6) On error per-customer, log and continue — never abort the entire cron on one failure.",
  },
  {
    name: "cso:pro-brand-discovery-monthly",
    type: "routine",
    cron: "0 10 1 * *",
    description: "Monthly 1st 10:00 — for each PRO-tier customer, profile their channel via Monid scrapers, match against sponsor-brand directory, draft 10 outreach emails into lead_nurture_drafts for HITL review.",
    prompt:
      "You are Felix executing the Creator Sponsor Ops monthly brand-discovery cron (PRO tier only). (1) For each customer project tagged 'creator-sponsor-ops:customer-*' AND tier=pro: (a) Read channel handle from sub-project metadata. (b) monid_run id=apify/streamers/youtube-scraper to pull latest 50 videos + channel metadata (cost ~$0.025); use channel handle as searchTerms with maxItems=50. If creator is TikTok-first, use monid_run id=apify/apidojo/tiktok-profile-scraper instead (~$0.025). (c) Extract topics + audience signal from video titles + descriptions. (d) Search internal sponsor_brand_directory for matches by topic-vector + recent sponsor-spend signal. (e) Top-10 matches → for each, draft a personalized outreach email mentioning a specific recent video of theirs + why the brand fits. (f) Write each draft to lead_nurture_drafts table with customerProjectId + brand + status='draft'. NEVER auto-send. (2) Log under category 'creator-sponsor-ops:brand-discovery'. (3) Cost cap: if total Monid spend in this cron run exceeds $10, abort remaining customers and alert owner.",
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
  const [, mm, hh, dom, , dow] = m;
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
  if (dom !== "*") {
    const targetDom = parseInt(dom, 10);
    let safety = 32;
    while (next.getDate() !== targetDom && safety-- > 0) next.setDate(next.getDate() + 1);
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
    `**SOP:** \`${WEDGE.sopFile}\` — Felix fetches via \`lookup_output_skill\` topic \`wedge-creator-sponsor-ops-sop\`\n` +
    `**Source idea:** Ideabrowser IOTD 2026-05-20 "Sponsorship back office for creators" — https://www.ideabrowser.com/idea/sponsorship-management-platform-for-creators\n\n` +
    `## What this project tracks\n\n${WEDGE.fullDescription}\n\n` +
    `## How Felix should approach work on this wedge\n\n` +
    `1. \`lookup_output_skill\` topic=\`wedge-creator-sponsor-ops-sop\` for the canonical procedure.\n` +
    `2. \`search_knowledge\` category=\`wedge:creator-sponsor-ops\` for accumulated context (per-customer notes, extraction quirks, sponsor-brand patterns).\n` +
    `3. Per paying customer, spawn a sub-project under tag \`creator-sponsor-ops:customer-<slug>\` with metadata { tier, forwardingAddress, channelHandle, primaryContact, brandColor? }.\n` +
    `4. All sponsor-email extractions log to \`knowledge_entries\` category \`creator-sponsor-ops:<slug>\` with the canonical deal schema.\n` +
    `5. Three crons handle the recurring work: \`cso:deadline-scan-daily\`, \`cso:weekly-digest\`, \`cso:pro-brand-discovery-monthly\` (PRO only, Monid-powered).\n` +
    `6. Deliveries: ALWAYS \`deliver_product\` (HARD RULE — never \`uploadAndShare\` directly).\n` +
    `7. HITL gate on FIRST customer per tier: Bob reviews 1 extraction + 1 digest + (Pro) 1 outreach draft before delivery. After first per-tier, 10% spot check.\n` +
    `8. CONCIERGE-MODE PHASE (R125+13.12): no public landing yet. Graduation to landing requires 3 paying Standard customers OR 1 paying Pro customer.\n\n` +
    `_Auto-generated by \`scripts/wire-creator-sponsor-ops.ts\` — safe to re-run; regenerates if missing._\n`;
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
    VALUES (${t.name}, ${t.description}, ${t.type}, ${t.cron}, true, ${t.prompt}, 'claude-sonnet-4-20250514', ${personaId}, 'wire-creator-sponsor-ops', ${TENANT_ID}, ${nextCronRun(t.cron)})
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
    summary: `R125+13.12 wedge SOP for Creator Sponsor Ops — concierge sponsor-back-office for creators with 5+ brand deals at $99 / $299mo / $499mo. Felix's canonical procedure with kill criteria + 3-cron pipeline + Monid-powered Pro brand-discovery.`,
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

  const k1 = await indexKnowledge(`wedge:${WEDGE.slug}`, `SOP — ${WEDGE.name}`, WEDGE.sopFile);
  console.log(`[wire] knowledge: ${k1 ? "+1 SOP" : "SOP already indexed"}`);

  const reg = upsertRegistryPin();
  console.log(`[wire] output-skills registry: ${reg.added ? "+1 new" : reg.updated ? "~1 updated" : "no change"}`);

  for (const t of CRON_TASKS) {
    const r = await upsertHeartbeatTask(t, personaId);
    console.log(`[wire] heartbeat ${t.name}: #${r.id} ${r.created ? "(created)" : "(updated)"} — next ${nextCronRun(t.cron).toISOString()}`);
  }

  console.log(`\n========== SUMMARY ==========`);
  console.log(`  creator-sponsor-ops: project #${proj.id} · brain=${brain}`);
  console.log(`  3 heartbeat crons wired (deadline-scan-daily / weekly-digest / pro-brand-discovery-monthly).`);
  console.log(`  CONCIERGE-MODE — no public landing until 3 paying Standard customers OR 1 paying Pro customer.`);
  console.log(`  Source: ideabrowser IOTD 2026-05-20 "Sponsorship back office for creators".`);
  process.exit(0);
})().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
