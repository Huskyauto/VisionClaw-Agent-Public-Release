/**
 * MASTER IdeaBrowser money-scenario pass — one-off archive sweep (Bob, 2026-07-20).
 *
 * Scope: the ENTIRE scored IdeaBrowser archive EXCLUDING the last 7 days
 * (the last-7-days window belongs to Felix's weekly prod cron). Picks the
 * strongest candidates by portfolio composite score, runs each through the
 * SAME money-scenario analyst as the weekly pass (shared lib
 * server/lib/ideabrowser-scenario.ts), ranks by probability-weighted expected
 * profit, runs the independent skeptical validation on the winner, writes a
 * markdown report to docs/, and delivers it via the mandated delivery
 * pipeline (Drive + owner email).
 *
 * One-line agent-runnable, no prompts, no ingest, no scoring (archive is
 * fully scored). Env knobs: SIM_N (how many top-composite ideas to simulate,
 * default 12), REPORT_TOP (rows highlighted as the Top-N pick, default 5).
 * Exit codes: 0 success · 1 all scenario passes failed / no API key ·
 * 2 candidate query failed · 3 no candidates.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
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
const SIM_N = Math.max(5, Math.min(30, Number(process.env.SIM_N) || 12));
const REPORT_TOP = Math.max(1, Math.min(SIM_N, Number(process.env.REPORT_TOP) || 5));

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`[master-scenario] ${today} — archive sweep starting (simulate top ${SIM_N} by composite, report top ${REPORT_TOP})`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[master-scenario] ANTHROPIC_API_KEY not set — cannot run scenarios");
    process.exit(1);
  }

  let candidates: Candidate[] = [];
  let poolSize = 0;
  try {
    const poolR: any = await db.execute(sql`
      SELECT count(*)::int AS n
      FROM projects
      WHERE tenant_id = ${TENANT_ID}
        AND ('isenberg' = ANY(tags) OR 'isenberg-iotd' = ANY(tags) OR 'ideabrowser' = ANY(tags))
        AND NOT ('autobuilt' = ANY(tags))
        AND NOT ('ideabrowser-weekly-run' = ANY(tags))
        AND NOT ('ideabrowser-master-run' = ANY(tags))
        AND (metadata ? 'priority')
        AND created_at <= NOW() - INTERVAL '7 days'
    `);
    poolSize = ((poolR.rows || poolR) as any[])[0]?.n ?? 0;
    const r: any = await db.execute(sql`
      SELECT id, name, description,
             metadata->'priority'->>'tier' AS tier,
             (metadata->'priority'->>'composite')::int AS composite
      FROM projects
      WHERE tenant_id = ${TENANT_ID}
        AND ('isenberg' = ANY(tags) OR 'isenberg-iotd' = ANY(tags) OR 'ideabrowser' = ANY(tags))
        AND NOT ('autobuilt' = ANY(tags))
        AND NOT ('ideabrowser-weekly-run' = ANY(tags))
        AND NOT ('ideabrowser-master-run' = ANY(tags))
        AND (metadata ? 'priority')
        AND created_at <= NOW() - INTERVAL '7 days'
      ORDER BY (metadata->'priority'->>'composite')::int DESC NULLS LAST
      LIMIT ${SIM_N}
    `);
    candidates = ((r.rows || r) as any[]).map((row) => ({
      id: row.id, name: row.name, description: row.description || "",
      tier: row.tier, composite: row.composite,
    }));
  } catch (e: any) {
    console.error(`[master-scenario] candidate query failed: ${e?.message || e}`);
    process.exit(2);
  }

  if (candidates.length === 0) {
    console.error("[master-scenario] no candidates available — nothing to simulate");
    process.exit(3);
  }
  console.log(`[master-scenario] pool=${poolSize} ideas (archive, >7 days old); simulating ${candidates.length}: ${candidates.map((c) => `#${c.id} ${c.name} [${c.tier} ${c.composite}]`).join(" | ")}`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const results = (await Promise.all(candidates.map((c) => runScenario(client, c))))
    .filter((s): s is Scenario => s !== null)
    .sort((a, b) => b.expectedProfitUsd - a.expectedProfitUsd);

  if (results.length === 0) {
    console.error("[master-scenario] ALL scenario passes failed");
    process.exit(1);
  }
  const winner = results[0];
  const failed = candidates.length - results.length;
  const top = results.slice(0, REPORT_TOP);

  const winnerCandidate = candidates.find((c) => c.id === winner.projectId);
  const validation = winnerCandidate ? await runValidation(client, winnerCandidate, winner) : null;
  if (!validation) console.warn("[master-scenario] winner validation pass unavailable (report ships without it)");

  let md = `# IdeaBrowser MASTER Money Scenario — ${today}\n\n`;
  md += `One-off archive sweep across the ENTIRE scored IdeaBrowser backlog **excluding the last 7 days** — pool of **${poolSize} ideas**; the **top ${candidates.length} by portfolio composite score** were each run through the money-scenario analyst${failed ? ` (${failed} scenario pass(es) failed)` : ""}, then ranked by probability-weighted expected profit. Generated by \`scripts/ideabrowser-master-scenario.ts\`.\n\n`;
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
  md += `## Top ${top.length} (of ${results.length} simulated)\n\n`;
  md += `| # | Idea | E[profit] | P(success) | ROI | 12-mo rev | Build cost | Hours | $/mo | Days→$1 |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  results.forEach((s, i) => {
    md += `| ${i + 1} | ${s.name.slice(0, 60)} (#${s.projectId}) | $${s.expectedProfitUsd.toLocaleString()} | ${s.successProbabilityPct}% | ${s.roi}x | $${s.revenue12moUsd.toLocaleString()} | $${s.buildCostUsd.toLocaleString()} | ${s.buildHours} | $${s.monthlyRunCostUsd} | ${s.daysToFirstDollar} |\n`;
  });
  md += `\nRanked by **expected profit** = P(success) × 12-mo revenue − total cost (build + 12 mo run + Bob-hours @$50).\n`;
  md += `\n## Scenario details\n\n`;
  for (const s of results) {
    md += `### ${s.name}\n- Leverage: ${s.visionclawLeverage}\n- GTM: ${s.goToMarket}\n- Risk: ${s.topRisk}\n- Verdict: ${s.verdict}\n\n`;
  }

  const outPath = `docs/ideabrowser-master-scenario-${today}.md`;
  fs.writeFileSync(outPath, md, "utf-8");
  console.log(`[master-scenario] wrote ${outPath} (${md.length} chars)`);

  // Stamp winner metadata (idempotent, distinct key from weeklyScenario).
  try {
    await db.execute(sql`
      UPDATE projects
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('masterScenario', jsonb_build_object(
        'date', ${today}::text, 'roi', ${winner.roi}::numeric,
        'revenue12moUsd', ${winner.revenue12moUsd}::int, 'buildCostUsd', ${winner.buildCostUsd}::int,
        'verdict', ${winner.verdict}::text, 'winner', true))
      WHERE id = ${winner.projectId} AND tenant_id = ${TENANT_ID}
    `);
    console.log(`[master-scenario] stamped winner metadata on project #${winner.projectId}`);
  } catch (e: any) {
    console.warn(`[master-scenario] winner metadata stamp failed: ${e?.message || e}`);
  }

  // File this run inside the IdeaBrowser folder in Projects: one
  // "Master Run YYYY-MM-DD" project per pass (idempotent per date),
  // tagged ideabrowser-master-run so the UI groups it and the candidate
  // queries above exclude it.
  try {
    const runName = `Master Run ${today}`;
    const existing: any = await db.execute(sql`
      SELECT id FROM projects
      WHERE tenant_id = ${TENANT_ID} AND name = ${runName}
        AND 'ideabrowser-master-run' = ANY(tags)
      LIMIT 1
    `);
    const existingRows = (existing.rows || existing) as any[];
    const runDesc = `IdeaBrowser MASTER archive sweep — pool ${poolSize} scored ideas older than 7 days, top ${candidates.length} by composite simulated. Winner: ${winner.name} (E[profit] $${winner.expectedProfitUsd.toLocaleString()} @ ${winner.successProbabilityPct}%, ROI ${winner.roi}x).`;
    let runProjectId: number | null = null;
    if (existingRows.length > 0) {
      runProjectId = existingRows[0].id;
      await db.execute(sql`
        UPDATE projects SET description = ${runDesc}, updated_at = NOW()
        WHERE id = ${runProjectId} AND tenant_id = ${TENANT_ID}
      `);
    } else {
      const tagsLiteral = `{"ideabrowser","ideabrowser-master-run"}`;
      const ins: any = await db.execute(sql`
        INSERT INTO projects (tenant_id, name, description, status, tags, metadata)
        VALUES (${TENANT_ID}, ${runName}, ${runDesc}, 'completed', ${tagsLiteral}::text[],
                jsonb_build_object('kind', 'ideabrowser-master-run', 'date', ${today}::text,
                  'poolSize', ${poolSize}::int, 'simulated', ${candidates.length}::int,
                  'winnerProjectId', ${winner.projectId}, 'roi', ${winner.roi}::numeric,
                  'expectedProfitUsd', ${winner.expectedProfitUsd}::int,
                  'successProbabilityPct', ${winner.successProbabilityPct}::int))
        RETURNING id
      `);
      runProjectId = ((ins.rows || ins) as any[])[0]?.id ?? null;
    }
    if (runProjectId) {
      const rankingNote = `MASTER sweep winner: ${winner.name} — E[profit] $${winner.expectedProfitUsd.toLocaleString()} @ ${winner.successProbabilityPct}% · ROI ${winner.roi}x · verdict: ${winner.verdict}${validation ? `\nValidation: adjusted P(success) ${validation.adjustedSuccessProbabilityPct}% · out-of-pocket $${validation.totalOutOfPocketUsd.toLocaleString()} · ${validation.goNoGo}` : ""}\n\nFull ranking (${results.length} of ${candidates.length} simulated; pool ${poolSize}):\n${results.map((s, i) => `${i + 1}. ${s.name} (#${s.projectId}) — E[profit] $${s.expectedProfitUsd.toLocaleString()} @ ${s.successProbabilityPct}% · ROI ${s.roi}x`).join("\n")}\n\nReport: ${outPath}`;
      await db.execute(sql`
        INSERT INTO project_notes (project_id, note, author)
        SELECT ${runProjectId}, ${rankingNote}, 'felix-master-scenario'
        WHERE NOT EXISTS (
          SELECT 1 FROM project_notes WHERE project_id = ${runProjectId} AND author = 'felix-master-scenario'
        )
      `);
      console.log(`[master-scenario] filed run project #${runProjectId} ("${runName}") in IdeaBrowser folder`);
    }
  } catch (e: any) {
    console.warn(`[master-scenario] master-run project filing failed: ${e?.message || e}`);
  }

  // Deliver via the mandated pipeline (HARD RULE — never uploadAndShare directly).
  try {
    const to = resolveOwnerEmail();
    const { deliverDigitalProduct } = await import("../server/delivery-pipeline");
    const topLines = top.map((s, i) => `${i + 1}. ${s.name} — E[profit] $${s.expectedProfitUsd.toLocaleString()} @ ${s.successProbabilityPct}% · ROI ${s.roi}x ($${s.revenue12moUsd.toLocaleString()} rev / $${s.buildCostUsd.toLocaleString()} + ${s.buildHours}h cost)`).join("\n");
    const dr = await deliverDigitalProduct({
      tenantId: TENANT_ID,
      customerName: "Bob (owner)",
      customerEmail: to || undefined,
      productName: `IdeaBrowser MASTER Scenario ${today}`,
      filePath: outPath,
      fileName: path.basename(outPath),
      mimeType: "text/markdown",
      sendEmail: Boolean(to),
      emailSubject: `IdeaBrowser MASTER Scenario ${today} — winner: ${winner.name} (E[profit] $${winner.expectedProfitUsd.toLocaleString()})`,
      emailBody: `Master archive sweep: ${poolSize} scored ideas older than 7 days; top ${candidates.length} by composite simulated.\n\nWINNER: ${winner.name}\nExpected profit: $${winner.expectedProfitUsd.toLocaleString()} at ${winner.successProbabilityPct}% success probability\nROI: ${winner.roi}x · 12-mo revenue $${winner.revenue12moUsd.toLocaleString()} · cost $${winner.buildCostUsd.toLocaleString()} + ${winner.buildHours} Bob-hours · first dollar in ~${winner.daysToFirstDollar} days\nLeverage: ${winner.visionclawLeverage}\nGTM: ${winner.goToMarket}\nRisk: ${winner.topRisk}\nVerdict: ${winner.verdict}\n${validation ? `\nVALIDATION (independent second opinion):\nWhat it is: ${validation.whatItIs}\nNumbers check: ${validation.numbersVerdict}\nAdjusted P(success): ${validation.adjustedSuccessProbabilityPct}%\nCheapest path to first revenue (total out-of-pocket $${validation.totalOutOfPocketUsd.toLocaleString()}):\n${validation.cheapestMoneyPlan.map((step, i) => `  ${i + 1}. ${step}`).join("\n")}\nWeek-1 actions:\n${validation.week1Actions.map((a) => `  - ${a}`).join("\n")}\nGo/No-go: ${validation.goNoGo}\n` : ""}\nTop ${top.length}:\n${topLines}\n`,
      metadata: { kind: "ideabrowser-master-scenario", date: today, winnerProjectId: winner.projectId, roi: winner.roi, poolSize },
    });
    if (dr.success) {
      console.log(`[master-scenario] delivered: drive=${dr.shareableLink || dr.downloadLink || "n/a"} email=${dr.emailSent}`);
    } else {
      console.warn(`[master-scenario] delivery pipeline reported failure (report still at ${outPath})`);
    }
  } catch (e: any) {
    console.warn(`[master-scenario] delivery failed: ${e?.message || e} (report still at ${outPath})`);
  }

  console.log(`[master-scenario] SUMMARY pool=${poolSize} simulated=${candidates.length} scenarios_ok=${results.length} scenarios_failed=${failed}`);
  console.log(`[master-scenario] DONE — winner #${winner.projectId} "${winner.name}" E[profit] $${winner.expectedProfitUsd.toLocaleString()} ROI ${winner.roi}x`);
  process.exit(0);
})().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
