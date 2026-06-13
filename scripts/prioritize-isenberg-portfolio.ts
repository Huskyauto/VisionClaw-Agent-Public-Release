import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { storage } from "../server/storage";
import { ensureProjectFolder, uploadAndShare } from "../server/google-drive";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";

const TENANT_ID = 1;
const MODEL = "claude-sonnet-4-20250514";
const BATCH_SIZE = 10;
const PARALLEL = 4;

interface ProjectRow {
  id: number;
  name: string;
  description: string;
  tags: string[];
}

interface Score {
  id: number;
  vc_fit: number;          // 1-5: does VC's 16-persona stack + Felix media + Daedalus eng give us a 10x edge?
  market_signal: number;   // 1-5: clarity of pain, $$ category, urgency
  monetization: number;    // 1-5: can we name buyer + price in <5 min? subscription bonus
  build_complexity: number;// 1-5 (HIGHER = MORE complex, gets inverted)
  strategic_bonus: number; // 0-3: reinforces an active wedge (Monetization Plays / Audit / Daedalus / BWB)
  composite: number;       // computed
  tier: "S" | "A" | "B" | "C" | "Park";
  rationale: string;       // 1-2 sentences
  buyer_hypothesis: string;// 1 line
  build_cost_estimate: string; // S/M/L
}

const RUBRIC = `You are a venture-grade portfolio analyst scoring early-stage product ideas for VisionClaw.

VisionClaw context: a 16-persona AI corporate team (CEO + media + engineering + ops) that ships standalone products (e.g. [Your Product]) AND wedge SaaS (e.g. AI-Native Readiness Audit). Strengths: fast media generation (video/audio/images via Felix pipeline), agent orchestration, multi-tenant SaaS infra, automated content engines. Weaknesses: solo founder bandwidth, no enterprise sales motion, no hardware.

Active strategic wedges already in motion:
- Monetization Plays & Wedge (R125+8.9 GTM brief)
- AI-Native Readiness Audit (Idea Browser wedge — productized + waitlist live at /audit)
- Audit Monitoring $99/mo Recurring Tier (waitlist live)
- Daedalus — Agent-Owned Platform Engineering
- Built With Bob YouTube channel (wellness origin story)

For each project, return a JSON object with these fields:
- id (integer, match input)
- vc_fit (1-5): does VC's stack (AI personas, Felix media, ensemble jury, agent orchestration) give 10x advantage over a normal team? 5=clear unfair advantage, 1=our stack is irrelevant
- market_signal (1-5): clarity of pain, addressable $, urgency. Isenberg already filtered for this so default to 3. 5=screaming demand, 1=cute but no buyer
- monetization (1-5): can you name the buyer + a price in 5 min? subscription beats one-shot. 5=obvious SaaS pricing, 1=unclear who pays
- build_complexity (1-5): higher = more complex (will be inverted). 1=thin wrapper around free API, 5=hardware/regulatory/enterprise sales
- strategic_bonus (0-3): 0=standalone, 1=mild reinforcement, 2=feeds a wedge, 3=directly extends Monetization/Audit/Daedalus/BWB
- rationale (string, max 200 chars): 1-2 sentences why this score
- buyer_hypothesis (string, max 80 chars): "<buyer type> @ <price range>" or "unclear"
- build_cost_estimate (string): "S" (1-2 weeks solo), "M" (1-2 months), "L" (3+ months)

Return ONLY a JSON array, no prose. Score every input id.`;

function computeComposite(s: Omit<Score, "composite" | "tier">): number {
  return s.vc_fit * 2 + s.market_signal + s.monetization + (6 - s.build_complexity) + s.strategic_bonus;
}

function tierFor(c: number): Score["tier"] {
  if (c >= 22) return "S";
  if (c >= 18) return "A";
  if (c >= 14) return "B";
  if (c >= 10) return "C";
  return "Park";
}

async function scoreBatch(client: Anthropic, batch: ProjectRow[]): Promise<Score[]> {
  const input = batch.map((p) => ({
    id: p.id,
    name: p.name,
    description: (p.description || "").slice(0, 500),
    tags: p.tags,
  }));
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 6000,
    system: RUBRIC,
    messages: [{ role: "user", content: `Score these ${batch.length} projects. Be concise — keep rationale ≤120 chars.\n\n${JSON.stringify(input)}` }],
  });
  const text = msg.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`No JSON array in response: ${text.slice(0, 200)}`);
  const raw = JSON.parse(jsonMatch[0]);
  return raw.map((r: any) => {
    const partial = {
      id: r.id,
      vc_fit: Number(r.vc_fit),
      market_signal: Number(r.market_signal),
      monetization: Number(r.monetization),
      build_complexity: Number(r.build_complexity),
      strategic_bonus: Number(r.strategic_bonus) || 0,
      rationale: String(r.rationale || "").slice(0, 240),
      buyer_hypothesis: String(r.buyer_hypothesis || "unclear").slice(0, 100),
      build_cost_estimate: String(r.build_cost_estimate || "M"),
    };
    const composite = computeComposite(partial);
    return { ...partial, composite, tier: tierFor(composite) } as Score;
  });
}

async function persistScores(scores: Score[]) {
  for (const s of scores) {
    const meta = {
      priority: {
        scored_at: new Date().toISOString(),
        scorer: "isenberg-portfolio-prioritization-2026-05-25",
        rubric_version: "v1",
        vc_fit: s.vc_fit,
        market_signal: s.market_signal,
        monetization: s.monetization,
        build_complexity: s.build_complexity,
        strategic_bonus: s.strategic_bonus,
        composite: s.composite,
        tier: s.tier,
        rationale: s.rationale,
        buyer_hypothesis: s.buyer_hypothesis,
        build_cost_estimate: s.build_cost_estimate,
      },
    };
    await db.execute(sql`
      UPDATE projects
      SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(meta)}::jsonb,
          tags = (
            SELECT ARRAY(
              SELECT DISTINCT unnest(tags || ARRAY[${'tier:' + s.tier}]::text[])
            )
          )
      WHERE id = ${s.id} AND tenant_id = ${TENANT_ID}
    `);
  }
}

function fmtRow(s: Score, name: string): string {
  return `| ${s.tier} | ${s.composite} | ${name.slice(0, 70)} | ${s.buyer_hypothesis} | ${s.build_cost_estimate} | ${s.rationale} |`;
}

async function buildBrief(scored: Array<Score & { name: string; tags: string[] }>): Promise<string> {
  const byTier: Record<string, typeof scored> = { S: [], A: [], B: [], C: [], Park: [] };
  for (const s of scored) byTier[s.tier].push(s);
  for (const t of Object.keys(byTier)) byTier[t].sort((a, b) => b.composite - a.composite);

  const date = new Date().toISOString().slice(0, 10);
  const total = scored.length;
  const sCount = byTier.S.length;
  const aCount = byTier.A.length;
  const bCount = byTier.B.length;
  const cCount = byTier.C.length;
  const parkCount = byTier.Park.length;

  const wedgeReinforcers = scored.filter((s) => s.strategic_bonus >= 2 && s.tier !== "Park").slice(0, 10);

  let md = `# Isenberg / Idea Browser Portfolio Prioritization — ${date}\n\n`;
  md += `Scored ${total} projects against a 5-dimension rubric using ${MODEL}. Composite score = (vc_fit × 2) + market_signal + monetization + (6 − build_complexity) + strategic_bonus. Tiers: **S ≥22**, **A ≥18**, **B ≥14**, **C ≥10**, **Park <10**.\n\n`;

  md += `## Tier distribution\n\n`;
  md += `| Tier | Count | What it means |\n|---|---|---|\n`;
  md += `| **S** | ${sCount} | Ship-this-quarter candidates. Pick at most 2-3 to actually run; the rest go to A pipeline. |\n`;
  md += `| **A** | ${aCount} | Next-quarter queue. Hold loose until S-tier ships or stalls. |\n`;
  md += `| **B** | ${bCount} | Tracker — watch for activity signals (Isenberg re-runs, competitor entries, inbound asks). |\n`;
  md += `| **C** | ${cCount} | Dormant — keep in inventory, do nothing active. |\n`;
  md += `| **Park** | ${parkCount} | Not VC-shaped (hardware, regulated, no monetization). Archive. |\n\n`;

  md += `## How we'll utilize the 218 projects (cadence)\n\n`;
  md += `1. **This week** — pick the top 1-2 S-tier projects, draft a one-page concept brief per pick (you + me, 30 min each). Add them to the active strategy stack alongside the 5 existing wedge plans.\n`;
  md += `2. **Weekly Monday review** — the existing \`marketing-week-autopilot\` runs anyway. Add a 5-min "new IOTD review" step: any IOTD ingested in the last 7 days gets the same prioritization rubric applied automatically, and S/A new entries surface in an inbox notification.\n`;
  md += `3. **Monthly portfolio re-rank** — first Monday of every month, re-score all "tracker" (B) projects against current market context. Promote/demote as signal changes.\n`;
  md += `4. **Quarterly wedge promotion** — if no active S-tier wedge has shipped in a quarter, promote the highest-composite A-tier project that reinforces an existing wedge. Avoid stacking unrelated standalone bets while VisionClaw + [Your Product] are still scaling.\n`;
  md += `5. **Auto-decay** — any project that stays in B/C for >180 days with no activity moves to Park automatically. Keeps the active portfolio scannable.\n\n`;

  md += `## Hard constraint\n\n`;
  md += `Solo-founder reality: max **2-3 active builds** at any moment + VisionClaw factory work + [Your Product] content cadence. The portfolio is an **option pool**, not a build queue. Per replit.md: "VisionClaw is the neutral factory — personal-project features go into [Your Product] (or future standalone projects), NOT VCA core." Most S/A picks will become either (a) standalone-app spinouts like [Your Product], or (b) wedge SaaS on the VC platform.\n\n`;

  md += `## S-tier (${sCount}) — actively pick from these\n\n`;
  md += `| Tier | Score | Project | Buyer @ Price | Build | Why |\n|---|---|---|---|---|---|\n`;
  for (const s of byTier.S) md += fmtRow(s, s.name) + "\n";
  md += `\n`;

  md += `## A-tier top 15 (queue) — total A: ${aCount}\n\n`;
  md += `| Tier | Score | Project | Buyer @ Price | Build | Why |\n|---|---|---|---|---|---|\n`;
  for (const s of byTier.A.slice(0, 15)) md += fmtRow(s, s.name) + "\n";
  md += `\n`;

  md += `## Wedge reinforcers (regardless of tier — these compound active strategy)\n\n`;
  md += `| Tier | Score | Project | Buyer @ Price | Why this reinforces an existing wedge |\n|---|---|---|---|---|\n`;
  for (const s of wedgeReinforcers) md += `| ${s.tier} | ${s.composite} | ${s.name.slice(0, 70)} | ${s.buyer_hypothesis} | ${s.rationale} |\n`;
  md += `\n`;

  md += `## B-tier (${bCount}) — sample of top 20 tracked items\n\n`;
  md += `| Score | Project | Buyer @ Price | Build |\n|---|---|---|---|\n`;
  for (const s of byTier.B.slice(0, 20)) md += `| ${s.composite} | ${s.name.slice(0, 70)} | ${s.buyer_hypothesis} | ${s.build_cost_estimate} |\n`;
  md += `\n`;

  md += `## C-tier + Park (combined ${cCount + parkCount}) — archived, no action\n\n`;
  md += `These ${cCount + parkCount} projects scored below the active threshold. They remain in the database with their tier tag for traceability but do not enter any workstream unless something changes (new tech, new buyer signal, manual promotion). Sample: ${[...byTier.C, ...byTier.Park].slice(0, 5).map((s) => s.name.split(" (Isenberg")[0]).join("; ")}…\n\n`;

  md += `## Operational hooks added\n\n`;
  md += `- Each project's \`metadata.priority\` jsonb now contains the full score breakdown (queryable: \`SELECT id, name, metadata->'priority'->>'tier' FROM projects WHERE 'isenberg' = ANY(tags) ORDER BY (metadata->'priority'->>'composite')::int DESC;\`).\n`;
  md += `- Each project's \`tags\` array now includes \`tier:S\` / \`tier:A\` / etc. — filter the projects dashboard by tier tag to get an instant work-queue.\n`;
  md += `- The rubric prompt is checked into \`scripts/prioritize-isenberg-portfolio.ts\`. Re-running it re-scores everything against the latest rubric (idempotent on metadata).\n\n`;

  md += `## What I'd actually do this week (recommendation)\n\n`;
  const top3 = scored.filter((s) => s.tier === "S" || s.tier === "A").sort((a, b) => b.composite - a.composite).slice(0, 3);
  if (top3.length > 0) {
    md += `Drop everything-Isenberg-related for 7 days except these:\n\n`;
    top3.forEach((s, i) => {
      md += `${i + 1}. **${s.name}** — composite ${s.composite}, ${s.buyer_hypothesis}, ~${s.build_cost_estimate} build. ${s.rationale}\n`;
    });
    md += `\nFor each: 30-min one-pager (problem → buyer → MVP scope → revenue hypothesis → kill criteria). At the end of week 1, pick 1 of the 3 to ship in Q3. The other 2 stay in A-tier pipeline.\n`;
  }

  return md;
}

async function createPortfolioProject(tenantName: string, briefPath: string): Promise<{ id: number; driveUrl: string | null }> {
  const name = "Isenberg Portfolio Prioritization — 2026-05-25";
  const description =
    "Strategic prioritization output for the 218-project Isenberg/Idea Browser portfolio backfilled on 2026-05-25. Scores every project against a 5-dimension rubric (VC-fit × 2 + market signal + monetization + (6 − build complexity) + strategic bonus). Tiered S/A/B/C/Park with a working cadence (weekly review, monthly re-rank, quarterly wedge promotion). Hard cap: 2-3 active builds. Per-project scores persisted to projects.metadata.priority.";
  const tags = ["isenberg", "portfolio", "prioritization", "strategy", "tier:meta"];
  const tagLiteral = `{${tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(",")}}`;
  const ins: any = await db.execute(sql`
    INSERT INTO projects (name, description, status, tags, tenant_id)
    VALUES (${name}, ${description}, 'active', ${tagLiteral}::text[], ${TENANT_ID})
    RETURNING id
  `);
  const row = (ins.rows || ins)[0];
  let driveUrl: string | null = null;
  try {
    const folder = await ensureProjectFolder(row.id, name, TENANT_ID, tenantName);
    driveUrl = folder.url;
    await db.execute(sql`UPDATE projects SET drive_folder_id=${folder.id}, drive_folder_url=${folder.url} WHERE id=${row.id} AND tenant_id=${TENANT_ID}`);
    const up = await uploadAndShare({
      filePath: briefPath,
      fileName: path.basename(briefPath),
      mimeType: "text/markdown",
      folderLabel: `Projects/${name}`,
      description: "Portfolio prioritization brief",
      parentFolderId: folder.id,
      share: true,
    });
    await db.execute(sql`
      INSERT INTO project_files (project_id, file_name, file_path, file_url, file_type, file_size, uploaded_by)
      VALUES (${row.id}, ${path.basename(briefPath)}, ${briefPath}, ${up.viewUrl}, 'text/markdown', ${fs.statSync(briefPath).size}, 'prioritize-isenberg-portfolio')
    `);
    console.log(`[portfolio] Brief uploaded: ${up.viewUrl}`);
  } catch (e: any) {
    console.warn(`[portfolio] Drive setup failed: ${e.message}`);
  }
  return { id: row.id, driveUrl };
}

(async () => {
  const tenant = await storage.getTenant(TENANT_ID);
  const tenantName = tenant?.name || `tenant-${TENANT_ID}`;

  console.log("─── Phase 1: load projects ───");
  const res: any = await db.execute(sql`
    SELECT id, name, description, tags
    FROM projects
    WHERE tenant_id = ${TENANT_ID}
    ORDER BY id ASC
  `);
  const allProjects: ProjectRow[] = (res.rows || res).map((r: any) => ({
    id: r.id,
    name: r.name,
    description: r.description || "",
    tags: r.tags || [],
  }));
  console.log(`[load] ${allProjects.length} projects to score`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Skip already-scored unless RESCORE=1
  const rescore = process.env.RESCORE === "1";
  const alreadyScoredRes: any = await db.execute(sql`
    SELECT id FROM projects WHERE tenant_id=${TENANT_ID} AND metadata ? 'priority'
  `);
  const alreadyScored = new Set<number>((alreadyScoredRes.rows || alreadyScoredRes).map((r: any) => r.id));
  const toScore = rescore ? allProjects : allProjects.filter((p) => !alreadyScored.has(p.id));
  console.log(`[plan] ${toScore.length} to score (${alreadyScored.size} already scored, RESCORE=${rescore ? "1" : "0"})`);

  console.log(`─── Phase 2+3: score + persist (${PARALLEL} parallel, batch=${BATCH_SIZE}) ───`);
  const allScores: Score[] = [];
  const t0 = Date.now();
  const batches: ProjectRow[][] = [];
  for (let i = 0; i < toScore.length; i += BATCH_SIZE) batches.push(toScore.slice(i, i + BATCH_SIZE));
  for (let g = 0; g < batches.length; g += PARALLEL) {
    const group = batches.slice(g, g + PARALLEL);
    const results = await Promise.allSettled(group.map((b) => scoreBatch(client, b)));
    let groupTotal = 0;
    for (const r of results) {
      if (r.status === "fulfilled") {
        await persistScores(r.value);
        allScores.push(...r.value);
        groupTotal += r.value.length;
      } else {
        console.log(`  ✗ batch err: ${r.reason?.message || r.reason}`);
      }
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  group ${Math.floor(g / PARALLEL) + 1}/${Math.ceil(batches.length / PARALLEL)} done — +${groupTotal} scores (${elapsed}s elapsed, ${allScores.length} total)`);
  }
  // Reload all scored projects for brief
  const finalRes: any = await db.execute(sql`
    SELECT id, metadata->'priority' as p
    FROM projects WHERE tenant_id=${TENANT_ID} AND metadata ? 'priority'
  `);
  const existingScores: Score[] = (finalRes.rows || finalRes).map((r: any) => ({
    id: r.id,
    vc_fit: r.p.vc_fit,
    market_signal: r.p.market_signal,
    monetization: r.p.monetization,
    build_complexity: r.p.build_complexity,
    strategic_bonus: r.p.strategic_bonus,
    composite: r.p.composite,
    tier: r.p.tier,
    rationale: r.p.rationale,
    buyer_hypothesis: r.p.buyer_hypothesis,
    build_cost_estimate: r.p.build_cost_estimate,
  }));
  console.log(`[total] ${existingScores.length} scored projects in DB`);
  allScores.length = 0;
  allScores.push(...existingScores);

  console.log("─── Phase 4: write brief ───");
  const byId = new Map(allProjects.map((p) => [p.id, p]));
  const scoredWithMeta = allScores
    .map((s) => ({ ...s, name: byId.get(s.id)?.name || `#${s.id}`, tags: byId.get(s.id)?.tags || [] }))
    .filter((s) => s.tags.includes("isenberg") || s.tags.includes("iotd"));
  const brief = await buildBrief(scoredWithMeta);
  const briefPath = path.resolve("docs/isenberg-portfolio-prioritization-2026-05-25.md");
  fs.writeFileSync(briefPath, brief, "utf-8");
  console.log(`[brief] wrote ${briefPath} (${brief.length} chars)`);

  console.log("─── Phase 5: create portfolio review project ───");
  const portfolio = await createPortfolioProject(tenantName, briefPath);
  console.log(`[portfolio] project #${portfolio.id}${portfolio.driveUrl ? ` — ${portfolio.driveUrl}` : ""}`);

  console.log("\n========== TIER DISTRIBUTION ==========");
  const dist: Record<string, number> = { S: 0, A: 0, B: 0, C: 0, Park: 0 };
  for (const s of scoredWithMeta) dist[s.tier]++;
  for (const [t, c] of Object.entries(dist)) console.log(`  ${t}: ${c}`);

  console.log("\n========== TOP 10 OVERALL ==========");
  scoredWithMeta
    .sort((a, b) => b.composite - a.composite)
    .slice(0, 10)
    .forEach((s, i) => console.log(`  ${i + 1}. [${s.tier} ${s.composite}] ${s.name}`));

  process.exit(0);
})().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
