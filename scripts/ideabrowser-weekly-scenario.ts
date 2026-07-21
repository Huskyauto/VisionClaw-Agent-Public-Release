/**
 * Weekly IdeaBrowser money-scenario runner — Felix's Monday pass.
 *
 * Flow:
 *   1. Ingest any new Greg-Isenberg "Idea of the Day" emails from the last 7 days
 *      (shared lib — idempotent on message_id, one idea-stage project per email).
 *   2. Score any unscored isenberg projects with the existing portfolio rubric.
 *   3. Pick the TOP 5 ideas from the last 7 days by composite score (falls back
 *      to the top 5 unbuilt S/A-tier ideas overall if fewer than 5 arrived).
 *   4. Run each through a "money scenario" simulation: a venture-analyst LLM pass
 *      that projects 12-month revenue, cost-to-implement USING VisionClaw's own
 *      capabilities (full tool stack, Felix pipelines, wedge landings), time-to-first-
 *      dollar, and risk — then ranks by ROI (revenue per dollar+hour of cost).
 *   5. Output: markdown report in docs/, Drive upload to the "Bob's Replit
 *      Ideabrowser" project folder, owner email with the winner + full ranking.
 *
 * One-line agent-runnable, no prompts. Exit codes:
 *   0 — success (report written; email/upload best-effort)
 *   1 — scenario LLM pass failed for ALL candidates
 *   2 — db/candidate selection failed
 *   3 — fewer than 1 candidate available (nothing to simulate)
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { ingestNewIdeabrowser } from "../server/lib/ideabrowser-ingest";
import { scoreUnscoredIsenberg } from "../server/lib/ideabrowser-score";
import { resolveOwnerEmail } from "../server/lib/owner-email";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import {
  type Candidate,
  type Scenario,
  runScenario,
  runValidation,
} from "../server/lib/ideabrowser-scenario";

const TENANT_ID = 1;
const TOP_N = 5;

(async () => {
  const today = new Date().toISOString().slice(0, 10);

  // TEST MODE: `npx tsx scripts/ideabrowser-weekly-scenario.ts --test [projectId]`
  // Runs the scenario simulation for ONE idea and prints it. NO ingest, NO
  // scoring, NO report/Drive/email/metadata side effects. Safe to run anytime.
  const testIdx = process.argv.indexOf("--test");
  if (testIdx >= 0) {
    if (!process.env.ANTHROPIC_API_KEY) { console.error("[test] ANTHROPIC_API_KEY not set"); process.exit(1); }
    const idArg = Number(process.argv[testIdx + 1]);
    const r: any = await db.execute(sql`
      SELECT id, name, description,
             metadata->'priority'->>'tier' AS tier,
             (metadata->'priority'->>'composite')::int AS composite
      FROM projects
      WHERE tenant_id = ${TENANT_ID}
        AND ('isenberg' = ANY(tags) OR 'isenberg-iotd' = ANY(tags) OR 'ideabrowser' = ANY(tags))
        AND ${Number.isFinite(idArg) ? sql`id = ${idArg}` : sql`(metadata ? 'priority')`}
      ORDER BY (metadata->'priority'->>'composite')::int DESC NULLS LAST
      LIMIT 1
    `);
    const row = ((r.rows || r) as any[])[0];
    if (!row) { console.error(`[test] no matching idea project${Number.isFinite(idArg) ? ` #${idArg}` : ""}`); process.exit(3); }
    const c: Candidate = { id: row.id, name: row.name, description: row.description || "", tier: row.tier, composite: row.composite };
    console.log(`[test] simulating #${c.id} "${c.name}" [${c.tier} ${c.composite}] …`);
    const s = await runScenario(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), c);
    if (!s) { console.error("[test] scenario pass failed"); process.exit(1); }
    console.log(`\n=== TEST SCENARIO: ${s.name} (#${s.projectId}) ===`);
    console.log(`Success probability : ${s.successProbabilityPct}%`);
    console.log(`Expected profit     : $${s.expectedProfitUsd.toLocaleString()} (probability-weighted, 12 mo)`);
    console.log(`ROI                 : ${s.roi}x`);
    console.log(`12-mo revenue       : $${s.revenue12moUsd.toLocaleString()}`);
    console.log(`Cost to implement   : $${s.buildCostUsd.toLocaleString()} + ${s.buildHours} Bob-hours + $${s.monthlyRunCostUsd}/mo`);
    console.log(`Days to first $     : ${s.daysToFirstDollar}`);
    console.log(`Leverage            : ${s.visionclawLeverage}`);
    console.log(`Go-to-market        : ${s.goToMarket}`);
    console.log(`Top risk            : ${s.topRisk}`);
    console.log(`Verdict             : ${s.verdict}`);
    console.log(`\n[test] running independent validation pass …`);
    const v = await runValidation(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), c, s);
    if (v) {
      console.log(`\n=== VALIDATION (second opinion) ===`);
      console.log(`What it is          : ${v.whatItIs}`);
      console.log(`Numbers verdict     : ${v.numbersVerdict}`);
      console.log(`Adjusted P(success) : ${v.adjustedSuccessProbabilityPct}% (analyst said ${s.successProbabilityPct}%)`);
      console.log(`Cheapest money plan (total out-of-pocket $${v.totalOutOfPocketUsd.toLocaleString()}):`);
      v.cheapestMoneyPlan.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
      console.log(`Week-1 actions      :`);
      v.week1Actions.forEach((a) => console.log(`  - ${a}`));
      console.log(`Go / No-go          : ${v.goNoGo}`);
    } else {
      console.warn("[test] validation pass failed (scenario above still valid)");
    }
    process.exit(0);
  }

  console.log(`[weekly-scenario] ${today} — starting`);

  // 1. Ingest last 7 days of ideabrowser emails (never throws).
  const ing = await ingestNewIdeabrowser({ tenantId: TENANT_ID, sinceDays: 7 });
  console.log(`[weekly-scenario] ingest: fetched=${ing.fetched} new=${ing.newlyStored} projects=${ing.createdProjectIds.length} errors=${ing.errors.length}`);
  for (const e of ing.errors) console.warn(`[weekly-scenario] ingest error: ${e}`);

  // 2. Score anything unscored (never throws).
  const sc = await scoreUnscoredIsenberg({ tenantId: TENANT_ID });
  console.log(`[weekly-scenario] scored ${sc.scored} new (S=${sc.tiers.S} A=${sc.tiers.A})`);
  for (const e of sc.errors) console.warn(`[weekly-scenario] score error: ${e}`);

  // 3. Candidate selection: top 5 from last 7d, else top 5 unbuilt S/A overall.
  let candidates: Candidate[] = [];
  let selectionMode = "last-7-days";
  try {
    const pick = async (whereExtra: any) => {
      const r: any = await db.execute(sql`
        SELECT id, name, description,
               metadata->'priority'->>'tier' AS tier,
               (metadata->'priority'->>'composite')::int AS composite
        FROM projects
        WHERE tenant_id = ${TENANT_ID}
          AND ('isenberg' = ANY(tags) OR 'isenberg-iotd' = ANY(tags) OR 'ideabrowser' = ANY(tags))
          AND NOT ('autobuilt' = ANY(tags))
          AND NOT ('ideabrowser-weekly-run' = ANY(tags))
          AND (metadata ? 'priority')
          AND ${whereExtra}
        ORDER BY (metadata->'priority'->>'composite')::int DESC NULLS LAST
        LIMIT ${TOP_N}
      `);
      return ((r.rows || r) as any[]).map((row) => ({
        id: row.id, name: row.name, description: row.description || "",
        tier: row.tier, composite: row.composite,
      }));
    };
    candidates = await pick(sql`created_at > NOW() - INTERVAL '7 days'`);
    if (candidates.length < TOP_N) {
      selectionMode = candidates.length === 0 ? "all-time-fallback" : "last-7-days+backfill";
      const fallback = await pick(sql`metadata->'priority'->>'tier' IN ('S','A')`);
      for (const f of fallback) {
        if (candidates.length >= TOP_N) break;
        if (!candidates.some((c) => c.id === f.id)) candidates.push(f);
      }
    }
  } catch (e: any) {
    console.error(`[weekly-scenario] candidate query failed: ${e?.message || e}`);
    process.exit(2);
  }

  if (candidates.length === 0) {
    console.error("[weekly-scenario] no candidates available — nothing to simulate");
    process.exit(3);
  }
  console.log(`[weekly-scenario] candidates (${selectionMode}): ${candidates.map((c) => `#${c.id} ${c.name} [${c.tier} ${c.composite}]`).join(" | ")}`);

  // 4. Scenario simulation (parallel, per-idea failure tolerated).
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[weekly-scenario] ANTHROPIC_API_KEY not set — cannot run scenarios");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const results = (await Promise.all(candidates.map((c) => runScenario(client, c))))
    .filter((s): s is Scenario => s !== null)
    .sort((a, b) => b.expectedProfitUsd - a.expectedProfitUsd);

  if (results.length === 0) {
    console.error("[weekly-scenario] ALL scenario passes failed");
    process.exit(1);
  }
  const winner = results[0];
  const failed = candidates.length - results.length;

  // 4.5 Independent validation pass on the winner: a skeptical second opinion
  // that explains what the project is, sanity-checks the analyst's numbers,
  // and lays out the cheapest out-of-pocket path to first revenue.
  // Best-effort — a validation failure never blocks the report.
  const winnerCandidate = candidates.find((c) => c.id === winner.projectId);
  const validation = winnerCandidate ? await runValidation(client, winnerCandidate, winner) : null;
  if (!validation) console.warn("[weekly-scenario] winner validation pass unavailable (report ships without it)");

  // 5. Report.
  let md = `# IdeaBrowser Weekly Money Scenario — ${today}\n\n`;
  md += `Autogenerated by \`scripts/ideabrowser-weekly-scenario.ts\` (selection: ${selectionMode}${failed ? `; ${failed} scenario pass(es) failed` : ""}).\n\n`;
  md += `## 🏆 Winner: ${winner.name}\n\n`;
  md += `- **Expected profit (probability-weighted):** $${winner.expectedProfitUsd.toLocaleString()} at ${winner.successProbabilityPct}% success probability\n`;
  md += `- **ROI:** ${winner.roi}x (12-mo revenue per $ of total cost, Bob-hours valued at $50)\n`;
  md += `- **Projected 12-mo revenue:** $${winner.revenue12moUsd.toLocaleString()}\n`;
  md += `- **Cost to implement:** $${winner.buildCostUsd.toLocaleString()} + ${winner.buildHours} Bob-hours + $${winner.monthlyRunCostUsd}/mo\n`;
  md += `- **Days to first dollar:** ${winner.daysToFirstDollar}\n`;
  md += `- **VisionClaw leverage:** ${winner.visionclawLeverage}\n`;
  md += `- **Go-to-market:** ${winner.goToMarket}\n`;
  md += `- **Top risk:** ${winner.topRisk}\n`;
  md += `- **Verdict:** ${winner.verdict}\n\n`;
  if (validation) {
    md += `## ✅ Validation — independent second opinion\n\n`;
    md += `**What it is:** ${validation.whatItIs}\n\n`;
    md += `**Numbers check:** ${validation.numbersVerdict}\n\n`;
    md += `**Adjusted success probability:** ${validation.adjustedSuccessProbabilityPct}% (analyst said ${winner.successProbabilityPct}%)\n\n`;
    md += `**Cheapest path to first revenue** (total out-of-pocket **$${validation.totalOutOfPocketUsd.toLocaleString()}**):\n\n`;
    validation.cheapestMoneyPlan.forEach((step, i) => { md += `${i + 1}. ${step}\n`; });
    md += `\n**Week-1 actions:**\n\n`;
    validation.week1Actions.forEach((a) => { md += `- ${a}\n`; });
    md += `\n**Go / No-go:** ${validation.goNoGo}\n\n`;
  }
  md += `## Full ranking\n\n`;
  md += `| # | Idea | E[profit] | P(success) | ROI | 12-mo rev | Build cost | Hours | $/mo | Days→$1 |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  results.forEach((s, i) => {
    md += `| ${i + 1} | ${s.name.slice(0, 60)} (#${s.projectId}) | $${s.expectedProfitUsd.toLocaleString()} | ${s.successProbabilityPct}% | ${s.roi}x | $${s.revenue12moUsd.toLocaleString()} | $${s.buildCostUsd.toLocaleString()} | ${s.buildHours} | $${s.monthlyRunCostUsd} | ${s.daysToFirstDollar} |\n`;
  });
  md += `\nRanked by **expected profit** = P(success) × 12-mo revenue − total cost (build + 12 mo run + Bob-hours @$50).\n`;
  md += `\n## Scenario details\n\n`;
  for (const s of results) {
    md += `### ${s.name}\n- Leverage: ${s.visionclawLeverage}\n- GTM: ${s.goToMarket}\n- Risk: ${s.topRisk}\n- Verdict: ${s.verdict}\n\n`;
  }

  const outPath = `docs/ideabrowser-weekly-scenario-${today}.md`;
  fs.writeFileSync(outPath, md, "utf-8");
  console.log(`[weekly-scenario] wrote ${outPath} (${md.length} chars)`);

  // Persist the scenario onto the winning project's metadata (idempotent per date).
  try {
    await db.execute(sql`
      UPDATE projects
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('weeklyScenario', jsonb_build_object(
        'date', ${today}::text, 'roi', ${winner.roi}::numeric,
        'revenue12moUsd', ${winner.revenue12moUsd}::int, 'buildCostUsd', ${winner.buildCostUsd}::int,
        'verdict', ${winner.verdict}::text, 'winner', true))
      WHERE id = ${winner.projectId} AND tenant_id = ${TENANT_ID}
    `);
    console.log(`[weekly-scenario] stamped winner metadata on project #${winner.projectId}`);
  } catch (e: any) {
    console.warn(`[weekly-scenario] winner metadata stamp failed: ${e?.message || e}`);
  }

  // File this run inside the IdeaBrowser folder in Projects: one
  // "Weekly Run YYYY-MM-DD" project per pass (idempotent per date),
  // tagged ideabrowser-weekly-run so the UI groups it and the candidate
  // query above excludes it.
  let runProjectId: number | null = null;
  let reportUrl: string | null = null;
  try {
    const runName = `Weekly Run ${today}`;
    const existing: any = await db.execute(sql`
      SELECT id FROM projects
      WHERE tenant_id = ${TENANT_ID} AND name = ${runName}
        AND 'ideabrowser-weekly-run' = ANY(tags)
      LIMIT 1
    `);
    const existingRows = (existing.rows || existing) as any[];
    const runDesc = `IdeaBrowser weekly money scenario — winner: ${winner.name} (E[profit] $${winner.expectedProfitUsd.toLocaleString()} @ ${winner.successProbabilityPct}%, ROI ${winner.roi}x). ${results.length} scenario(s) ranked, selection: ${selectionMode}.`;
    if (existingRows.length > 0) {
      runProjectId = existingRows[0].id;
      await db.execute(sql`
        UPDATE projects SET description = ${runDesc}, updated_at = NOW()
        WHERE id = ${runProjectId} AND tenant_id = ${TENANT_ID}
      `);
    } else {
      const tagsLiteral = `{"ideabrowser","ideabrowser-weekly-run"}`;
      const ins: any = await db.execute(sql`
        INSERT INTO projects (tenant_id, name, description, status, tags, metadata)
        VALUES (${TENANT_ID}, ${runName}, ${runDesc}, 'completed', ${tagsLiteral}::text[],
                jsonb_build_object('kind', 'ideabrowser-weekly-run', 'date', ${today}::text,
                  'winnerProjectId', ${winner.projectId}, 'roi', ${winner.roi}::numeric,
                  'expectedProfitUsd', ${winner.expectedProfitUsd}::int,
                  'successProbabilityPct', ${winner.successProbabilityPct}::int))
        RETURNING id
      `);
      runProjectId = ((ins.rows || ins) as any[])[0]?.id ?? null;
    }
    if (runProjectId) {
      const rankingNote = `Winner: ${winner.name} — E[profit] $${winner.expectedProfitUsd.toLocaleString()} @ ${winner.successProbabilityPct}% · ROI ${winner.roi}x · verdict: ${winner.verdict}\n\nFull ranking:\n${results.map((s, i) => `${i + 1}. ${s.name} (#${s.projectId}) — E[profit] $${s.expectedProfitUsd.toLocaleString()} @ ${s.successProbabilityPct}% · ROI ${s.roi}x`).join("\n")}`;
      await db.execute(sql`
        INSERT INTO project_notes (project_id, note, author)
        SELECT ${runProjectId}, ${rankingNote}, 'felix-weekly-scenario'
        WHERE NOT EXISTS (
          SELECT 1 FROM project_notes WHERE project_id = ${runProjectId} AND author = 'felix-weekly-scenario'
        )
      `);
      console.log(`[weekly-scenario] filed run project #${runProjectId} ("${runName}") in IdeaBrowser folder`);
    }
  } catch (e: any) {
    console.warn(`[weekly-scenario] weekly-run project filing failed: ${e?.message || e}`);
  }

  // Deliver the report to Bob through the mandated delivery pipeline
  // (HARD RULE: never uploadAndShare directly for human-facing files).
  // Best-effort — the report file in docs/ is the durable core artifact.
  try {
    const to = resolveOwnerEmail();
    const { deliverDigitalProduct } = await import("../server/delivery-pipeline");
    const top3 = results.slice(0, 3).map((s, i) => `${i + 1}. ${s.name} — E[profit] $${s.expectedProfitUsd.toLocaleString()} @ ${s.successProbabilityPct}% · ROI ${s.roi}x ($${s.revenue12moUsd.toLocaleString()} rev / $${s.buildCostUsd.toLocaleString()} + ${s.buildHours}h cost)`).join("\n");
    const dr = await deliverDigitalProduct({
      tenantId: TENANT_ID,
      customerName: "Bob (owner)",
      customerEmail: to || undefined,
      productName: `IdeaBrowser Weekly Scenario ${today}`,
      filePath: outPath,
      fileName: path.basename(outPath),
      mimeType: "text/markdown",
      sendEmail: Boolean(to),
      emailSubject: `IdeaBrowser Weekly Scenario ${today} — winner: ${winner.name} (ROI ${winner.roi}x)`,
      emailBody: `Felix ran this week's top ${results.length} IdeaBrowser concepts through the money scenario.\n\nWINNER: ${winner.name}\nExpected profit: $${winner.expectedProfitUsd.toLocaleString()} at ${winner.successProbabilityPct}% success probability\nROI: ${winner.roi}x · 12-mo revenue $${winner.revenue12moUsd.toLocaleString()} · cost $${winner.buildCostUsd.toLocaleString()} + ${winner.buildHours} Bob-hours · first dollar in ~${winner.daysToFirstDollar} days\nLeverage: ${winner.visionclawLeverage}\nGTM: ${winner.goToMarket}\nRisk: ${winner.topRisk}\nVerdict: ${winner.verdict}\n${validation ? `\nVALIDATION (independent second opinion):\nWhat it is: ${validation.whatItIs}\nNumbers check: ${validation.numbersVerdict}\nAdjusted P(success): ${validation.adjustedSuccessProbabilityPct}%\nCheapest path to first revenue (total out-of-pocket $${validation.totalOutOfPocketUsd.toLocaleString()}):\n${validation.cheapestMoneyPlan.map((step, i) => `  ${i + 1}. ${step}`).join("\n")}\nWeek-1 actions:\n${validation.week1Actions.map((a) => `  - ${a}`).join("\n")}\nGo/No-go: ${validation.goNoGo}\n` : ""}\nTop 3:\n${top3}\n`,
      metadata: { kind: "ideabrowser-weekly-scenario", date: today, winnerProjectId: winner.projectId, roi: winner.roi },
    });
    if (dr.success) {
      console.log(`[weekly-scenario] delivered: drive=${dr.shareableLink || dr.downloadLink || "n/a"} email=${dr.emailSent}`);
      reportUrl = dr.shareableLink || dr.downloadLink || null;
    } else {
      console.warn(`[weekly-scenario] delivery pipeline reported failure (report still at ${outPath})`);
    }
  } catch (e: any) {
    console.warn(`[weekly-scenario] delivery failed: ${e?.message || e} (report still at ${outPath})`);
  }

  // Attach the report to the weekly-run project (idempotent per file name).
  if (runProjectId) {
    try {
      const reportFileName = path.basename(outPath);
      await db.execute(sql`
        INSERT INTO project_files (project_id, file_name, file_path, file_url, file_type, uploaded_by)
        SELECT ${runProjectId}, ${reportFileName}, ${outPath}, ${reportUrl}, 'text/markdown', 'felix-weekly-scenario'
        WHERE NOT EXISTS (
          SELECT 1 FROM project_files WHERE project_id = ${runProjectId} AND file_name = ${reportFileName}
        )
      `);
      if (reportUrl) {
        await db.execute(sql`
          UPDATE project_files SET file_url = ${reportUrl}
          WHERE project_id = ${runProjectId} AND file_name = ${reportFileName} AND file_url IS NULL
        `);
      }
      console.log(`[weekly-scenario] attached report to run project #${runProjectId}`);
    } catch (e: any) {
      console.warn(`[weekly-scenario] report attach failed: ${e?.message || e}`);
    }
  }

  console.log(`[weekly-scenario] SUMMARY ingest_errors=${ing.errors.length} score_errors=${sc.errors.length} candidates=${candidates.length} scenarios_ok=${results.length} scenarios_failed=${failed}`);
  console.log(`[weekly-scenario] DONE — winner #${winner.projectId} "${winner.name}" ROI ${winner.roi}x`);
  process.exit(0);
})().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
