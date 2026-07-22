/**
 * Wire the three R125+13.8 wedge tracks into VC's agent infrastructure.
 *
 * Idempotent on every concern. Safe to re-run.
 *
 * What this does:
 *   1. Creates 3 wedge tracker projects (one per track) with proper tags +
 *      Drive folders. Each project gets a hand-written project-brain file at
 *      project-brains/project-{id}-brain.md so Felix's `project get_state`
 *      tool returns rich context, not just a name.
 *   2. Indexes the launch plan + 3 one-pagers + 3 wedge SOPs into
 *      knowledge_entries (category = "wedge:<slug>") so Felix's
 *      `search_knowledge` retrieves them.
 *   3. Inserts 3 heartbeat_tasks rows (idempotent on name) — auto-score,
 *      weekly digest, lead nurture — each with a prompt that instructs
 *      Felix to invoke the cron script via `execute_code`.
 *   4. Regenerates data/output-skills/_registry.json with sha256 + bytes
 *      pins for the 3 new wedge SOP files (the runtime integrity check
 *      will refuse to serve any wedge SOP whose pin is missing or
 *      mismatched).
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

// R125+13.8+sec (architect HIGH closed): tenant must be explicit. Previously
// hardcoded to 1, which would silently cross-tenant if ever run on a
// multi-tenant install. Accept --tenant-id=N OR WEDGE_TENANT_ID env; default
// remains 1 ONLY when ALLOW_DEFAULT_TENANT=1 is also set (matches the
// rescue-script pattern from R112.16+sec).
function resolveTenantId(): number {
  const argv = process.argv.find((a) => a.startsWith("--tenant-id="));
  const fromArg = argv ? Number(argv.split("=")[1]) : NaN;
  const fromEnv = Number(process.env.WEDGE_TENANT_ID || NaN);
  const id = Number.isFinite(fromArg) ? fromArg : Number.isFinite(fromEnv) ? fromEnv : NaN;
  if (Number.isFinite(id) && id > 0) return id;
  if (process.env.ALLOW_DEFAULT_TENANT === "1") return 1;
  console.error("[wire-wedges] tenant required: pass --tenant-id=N or WEDGE_TENANT_ID env, or set ALLOW_DEFAULT_TENANT=1 for the legacy single-tenant default.");
  process.exit(2);
}
const TENANT_ID = resolveTenantId();

const WEDGES = [
  {
    slug: "audit-pro",
    name: "Wedge: AI-Native Readiness Audit Pro",
    fullDescription:
      "R125+13.8 active wedge track A (Isenberg portfolio). $299 one-shot AI-readiness audit + $99/mo monitoring upsell. SLA: 5 business days. Lives on /audit waitlist. SOP: data/output-skills/wedge-audit-pro-sop.md. Owner: Felix. Concierge delivery via Chief of Staff. Kill criteria + pipeline + metrics all spec'd in the SOP.",
    tags: ["wedge:audit-pro", "wedge", "stage:validation", "track:isenberg-portfolio"],
    sopFile: "data/output-skills/wedge-audit-pro-sop.md",
    onePager: null,
  },
  {
    slug: "built-with-x",
    name: "Wedge: Built-With-X Channel-in-a-Box",
    fullDescription:
      "R125+13.8 active wedge track B (agent-originals top pick, concept #12). $99/$299/$999 per month channel-in-a-box for solopreneurs with a story. Bob himself + BWB channel are case-study #1. SOP: data/output-skills/wedge-built-with-x-sop.md. Pipeline: scripts/build-bwb-video.ts (same as BWB). Owner: Felix.",
    tags: ["wedge:built-with-x", "wedge", "stage:validation", "track:agent-originals"],
    sopFile: "data/output-skills/wedge-built-with-x-sop.md",
    onePager: "docs/agent-original-concepts-2026-05-25.md",
  },
  {
    slug: "youtube-portfolio-ops",
    name: "Wedge: YouTube Portfolio Ops",
    fullDescription:
      "R125+13.8 active wedge track C (Bob's explicit pick — top S-tier Isenberg IOTD 2026-04-07). $199/$499/$999 per month portfolio ops for multi-channel YouTube operators. 14-day validation, 21-day to first design partner. SOP: data/output-skills/wedge-youtube-portfolio-ops-sop.md. One-pager: docs/youtube-portfolio-ops-onepager-2026-05-25.md. Owner: Felix.",
    tags: ["wedge:youtube-portfolio-ops", "wedge", "stage:validation", "track:isenberg-iotd"],
    sopFile: "data/output-skills/wedge-youtube-portfolio-ops-sop.md",
    onePager: "docs/youtube-portfolio-ops-onepager-2026-05-25.md",
  },
];

const CRON_TASKS = [
  {
    name: "wedge:auto-score-new-isenberg",
    type: "routine",
    cron: "0 6 * * *",
    description: "Daily 06:00 — score newly-ingested Isenberg/IdeaBrowser IOTD entries; surface new S/A tier picks. Idempotent (skips already-scored).",
    prompt:
      "You are Felix executing the daily Isenberg IOTD auto-score cron (R125+13.8 wedge_auto_score_iotd capability). Invoke the deterministic script via execute_code tool: `npx tsx scripts/auto-score-new-isenberg.ts`. Read its stdout. If any new S/A-tier projects were scored in the last 24h, log a one-line summary to memory under category 'wedge:auto-score-daily'. If the script exits non-zero, log the failure and DO NOT silently swallow — surface to ops next time Bob is in chat. Do not invoke any other tools; this is a deterministic pipeline.",
  },
  {
    name: "wedge:weekly-digest",
    type: "routine",
    cron: "0 8 * * 1",
    description: "Monday 08:00 — per-track waitlist deltas + content shipped + agent recommendations; uploads markdown to project #234 Drive folder.",
    prompt:
      "You are Felix executing the weekly wedge digest cron (R125+13.8 wedge_weekly_digest capability). Invoke `npx tsx scripts/weekly-wedge-digest.ts` via execute_code. The script writes docs/wedge-digest-YYYY-MM-DD.md and uploads it to the Bob's Replit Ideabrowser project Drive folder. After completion, summarize the script's stdout in one paragraph and log to memory under category 'wedge:weekly-digest'. If any wedge shows a strong-signal week (>=5 signups), schedule a follow-up self-task to draft the founder-led X post for that wedge using Teagan via delegate_task.",
  },
  {
    name: "wedge:lead-nurture-daily",
    type: "routine",
    cron: "0 9 * * *",
    description: "Daily 09:00 — drafts personalized nurture emails for waitlist leads stale ≥7d into lead_nurture_drafts table. HITL approval before any send.",
    prompt:
      "You are Felix executing the daily lead-nurture cron (R125+13.8 wedge_lead_nurture capability). Invoke `npx tsx scripts/lead-nurture-cron.ts` via execute_code. The script populates the lead_nurture_drafts table with status='pending_review' rows. After completion, count the new drafts by wedge_slug and log to memory under category 'wedge:nurture-daily'. CRITICAL: do NOT auto-send any draft. If the count is >0, mention in the log so Bob sees it in the next /admin review.",
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
  // Best-effort: parse common patterns; fallback to "in 1 hour"
  // For ANY pattern starting with `0 H`, next-occurrence-at-hour-H today/tomorrow.
  const m = cronExpr.match(/^(\d+) (\d+) (\S+) (\S+) (\S+)$/);
  if (!m) return new Date(Date.now() + 60 * 60 * 1000);
  const [, mm, hh, dom, mon, dow] = m;
  const minute = parseInt(mm, 10);
  const hour = parseInt(hh, 10);
  const next = new Date();
  next.setSeconds(0, 0);
  next.setMinutes(minute);
  next.setHours(hour);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  // dow-specific (cron 0 8 * * 1 = monday) — advance until matching weekday
  if (dow !== "*") {
    const targetDow = parseInt(dow, 10);
    let safety = 8;
    while (next.getDay() !== targetDow && safety-- > 0) {
      next.setDate(next.getDate() + 1);
    }
  }
  return next;
}

async function upsertProject(w: typeof WEDGES[number]): Promise<{ id: number; created: boolean }> {
  const existing: any = await db.execute(sql`
    SELECT id FROM projects WHERE tenant_id=${TENANT_ID} AND name=${w.name} LIMIT 1
  `);
  const row = (existing.rows || existing)[0];
  if (row) return { id: row.id, created: false };
  const tagLiteral = `{${w.tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(",")}}`;
  const ins: any = await db.execute(sql`
    INSERT INTO projects (name, description, status, tags, tenant_id)
    VALUES (${w.name}, ${w.fullDescription}, 'active', ${tagLiteral}::text[], ${TENANT_ID})
    RETURNING id
  `);
  return { id: ((ins.rows || ins)[0] as any).id, created: true };
}

async function ensureBrainFile(projectId: number, w: typeof WEDGES[number]): Promise<string> {
  const dir = "project-brains";
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `project-${projectId}-brain.md`);
  if (fs.existsSync(p)) return p;
  const body = `# ${w.name}\n\n` +
    `**Project ID:** ${projectId}\n` +
    `**Tenant:** ${TENANT_ID}\n` +
    `**Tags:** ${w.tags.join(", ")}\n` +
    `**SOP:** \`${w.sopFile}\` — Felix fetches via \`lookup_output_skill\` with topic \`wedge-${w.slug}-sop\`\n` +
    (w.onePager ? `**One-pager:** \`${w.onePager}\`\n` : "") +
    `\n## What this project tracks\n\n` +
    `${w.fullDescription}\n\n` +
    `## How Felix should approach work on this wedge\n\n` +
    `1. Call \`lookup_output_skill\` with topic \`wedge-${w.slug}-sop\` to get the canonical procedure.\n` +
    `2. Use \`search_knowledge\` with category \`wedge:${w.slug}\` for accumulated context (waitlist signals, past deliveries, customer notes).\n` +
    `3. Use the \`project\` tool with this project id (${projectId}) to record status changes, deliverables, customer interactions.\n` +
    `4. For deliveries, ALWAYS route through \`deliver_product\` (HARD RULE — never \`uploadAndShare\` directly).\n` +
    `5. For media production on this wedge, obey the YouTube/spec hard rules in \`replit.md\` (1920x1080 H.264 +faststart, gpt-image-2 image cascade, BWB build script for any Built-With-X video).\n\n` +
    `## Cron jobs that feed this project\n\n` +
    `- \`scripts/auto-score-new-isenberg.ts\` (daily 06:00) — scores new IOTDs that might land in this wedge's tier\n` +
    `- \`scripts/weekly-wedge-digest.ts\` (Mon 08:00) — surfaces per-wedge metric deltas\n` +
    `- \`scripts/lead-nurture-cron.ts\` (daily 09:00) — drafts personalized follow-ups for stale waitlist leads\n\n` +
    `_Auto-generated by \`scripts/wire-wedges.ts\` — safe to re-run; this file regenerates if missing._\n`;
  fs.writeFileSync(p, body, "utf-8");
  return p;
}

async function indexKnowledge(category: string, title: string, filePath: string): Promise<boolean> {
  if (!fs.existsSync(filePath)) {
    console.warn(`[wire] knowledge skip — missing file ${filePath}`);
    return false;
  }
  const content = fs.readFileSync(filePath, "utf-8");
  // Avoid duplicate inserts (idempotent on tenant+category+title)
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
    // Update cron + prompt to match latest (in case SOPs evolve)
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
    VALUES (${t.name}, ${t.description}, ${t.type}, ${t.cron}, true, ${t.prompt}, 'claude-sonnet-4-5', ${personaId}, 'wire-wedges', ${TENANT_ID}, ${nextCronRun(t.cron)})
    RETURNING id
  `);
  return { id: ((ins.rows || ins)[0] as any).id, created: true };
}

function regenOutputSkillsRegistry(): { added: number; updated: number } {
  const regPath = "data/output-skills/_registry.json";
  const reg = JSON.parse(fs.readFileSync(regPath, "utf-8"));
  let added = 0;
  let updated = 0;
  for (const w of WEDGES) {
    const fileName = path.basename(w.sopFile);
    const topic = path.basename(fileName, ".md");
    const full = w.sopFile;
    if (!fs.existsSync(full)) {
      console.warn(`[wire] SOP missing ${full} — registry pin skipped`);
      continue;
    }
    const buf = fs.readFileSync(full);
    const sha = createHash("sha256").update(buf).digest("hex");
    const bytes = buf.length;
    const existingIdx = reg.skills.findIndex((s: any) => s.topic === topic);
    const entry = {
      topic,
      file: fileName,
      department: "Strategy",
      persona_fit: ["felix", "minerva", "ceo"],
      last_reviewed: new Date().toISOString().slice(0, 10),
      sha256: sha,
      bytes,
      is_public: false,
      summary: `R125+13.8 wedge SOP for ${w.name.replace(/^Wedge: /, "")} — the canonical Felix-executes-this procedure with kill criteria, pipeline steps, and metrics.`,
    };
    if (existingIdx >= 0) {
      reg.skills[existingIdx] = { ...reg.skills[existingIdx], ...entry };
      updated++;
    } else {
      reg.skills.push(entry);
      added++;
    }
  }
  // Atomic write (mirror saveManifest pattern)
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

  const summary: { wedge: string; projectId: number; brain: string; knowledgeAdded: number; }[] = [];

  // 1+2+3 per wedge
  for (const w of WEDGES) {
    const proj = await upsertProject(w);
    console.log(`[wire] project ${w.slug}: #${proj.id} ${proj.created ? "(created)" : "(reused)"}`);

    // Drive folder (idempotent — google-drive caches on project id)
    try {
      const existingFolder: any = await db.execute(sql`SELECT drive_folder_id FROM projects WHERE id=${proj.id}`);
      const dfid = (existingFolder.rows || existingFolder)[0]?.drive_folder_id;
      if (!dfid) {
        const folder = await ensureProjectFolder(proj.id, w.name, TENANT_ID, tenantName);
        await db.execute(sql`UPDATE projects SET drive_folder_id=${folder.id}, drive_folder_url=${folder.url} WHERE id=${proj.id}`);
        console.log(`[wire] drive folder for ${w.slug}: ${folder.url}`);
      }
    } catch (e: any) {
      console.warn(`[wire] drive folder skipped for ${w.slug}: ${e.message}`);
    }

    const brain = await ensureBrainFile(proj.id, w);

    // Knowledge index — SOP + one-pager (if any) + the wedge-launch-plan applies to all
    let kAdded = 0;
    if (await indexKnowledge(`wedge:${w.slug}`, `SOP — ${w.name}`, w.sopFile)) kAdded++;
    if (w.onePager && await indexKnowledge(`wedge:${w.slug}`, `One-pager — ${w.name}`, w.onePager)) kAdded++;
    if (await indexKnowledge(`wedge:${w.slug}`, `Launch plan — three-wedge`, "docs/wedge-launch-plan-2026-05-25.md")) kAdded++;

    summary.push({ wedge: w.slug, projectId: proj.id, brain, knowledgeAdded: kAdded });
  }

  // 3. Heartbeat tasks
  for (const t of CRON_TASKS) {
    const r = await upsertHeartbeatTask(t, personaId);
    console.log(`[wire] heartbeat ${t.name}: #${r.id} ${r.created ? "(created)" : "(updated)"} — next run ${nextCronRun(t.cron).toISOString()}`);
  }

  // 4. _registry.json regen with sha+bytes pins
  const reg = regenOutputSkillsRegistry();
  console.log(`[wire] output-skills registry: +${reg.added} new, ~${reg.updated} updated entries`);

  console.log(`\n========== SUMMARY ==========`);
  for (const s of summary) {
    console.log(`  ${s.wedge}: project #${s.projectId} · brain=${s.brain} · +${s.knowledgeAdded} knowledge rows`);
  }
  console.log(`\nNext: restart Start application workflow so capability-registry syncs the 6 new WEDGES rows.`);
  process.exit(0);
})().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
