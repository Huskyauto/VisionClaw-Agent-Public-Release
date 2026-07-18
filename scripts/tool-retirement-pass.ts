// Tool Retirement Pass — the eviction loop driver (flag-only, $0, no LLM).
// Contract: data/feature-contracts/tool-forge-eviction/spec.md.
//
// What it does: enumerates the registered tool surface (server/tool-registry.ts
// metadata — does NOT import server/tools.ts), aggregates tool_performance
// globally, classifies retirement candidates (zero invocations over window OR
// high failure rate with sample), dedupes against existing approvals, and
// queues NEW candidates into the HITL approval queue. Never deletes anything.
//
// Run: npx tsx scripts/tool-retirement-pass.ts
// Env: TOOL_RETIREMENT_WINDOW_DAYS (45), TOOL_RETIREMENT_MAX_CANDIDATES (10),
//      TOOL_RETIREMENT_MIN_SAMPLE (10), TOOL_RETIREMENT_FAIL_RATE (0.5),
//      DRY_RUN=1 (classify + report, queue nothing).
// Exit: 0 = clean (including zero candidates), 1 = hard error (a future agent
//      should read the stderr line — it names the failing stage).

import fs from "node:fs";
import path from "node:path";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { getAllRegisteredTools, getToolMeta } from "../server/tool-registry";
import {
  classifyRetirementCandidates,
  parseExemptions,
  type RetirementExemptions,
  type RetirementUsage,
} from "../server/lib/tool-retirement";
import { createApproval } from "../server/agentic/approvals";

const ADMIN_TENANT_ID = 1;
const REQUESTED_BY = "tool-retirement";

function envInt(name: string, dflt: number): number {
  const v = parseInt(process.env[name] || "", 10);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
}
function envFloat(name: string, dflt: number): number {
  const v = parseFloat(process.env[name] || "");
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : dflt;
}

async function main() {
  const windowDays = envInt("TOOL_RETIREMENT_WINDOW_DAYS", 45);
  const maxCandidates = envInt("TOOL_RETIREMENT_MAX_CANDIDATES", 10);
  const minSample = envInt("TOOL_RETIREMENT_MIN_SAMPLE", 10);
  const failRateThreshold = envFloat("TOOL_RETIREMENT_FAIL_RATE", 0.5);
  const dryRun = process.env.DRY_RUN === "1";

  // 1. Registry surface (metadata registrations, no tools.ts import).
  const toolNames = getAllRegisteredTools();
  if (toolNames.length < 100) {
    console.error(`[tool-retirement] registry looks broken: only ${toolNames.length} tools registered — refusing to classify (a thin registry would flag everything)`);
    process.exit(1);
  }
  const tools = toolNames.map((name) => ({ name, categories: getToolMeta(name)?.categories ?? [] }));

  // 2. Exemptions (fail closed: unreadable file = abort, never classify unguarded).
  const exemptionsPath = path.resolve("data/tool-retirement-exemptions.json");
  let exemptions: RetirementExemptions;
  try {
    const raw = JSON.parse(fs.readFileSync(exemptionsPath, "utf8"));
    exemptions = parseExemptions(raw);
  } catch (e: any) {
    console.error(`[tool-retirement] cannot read/validate ${exemptionsPath}: ${e?.message || e} — aborting (exemptions are mandatory and fail closed)`);
    process.exit(1);
    return;
  }

  // 3. Global usage aggregates (across ALL tenants — retirement is platform-level).
  const usageRes: any = await db.execute(sql`
    SELECT tool_name,
           SUM(success_count)::bigint AS success_count,
           SUM(fail_count)::bigint AS fail_count,
           MAX(GREATEST(COALESCE(last_success_at, 'epoch'::timestamptz), COALESCE(last_failure_at, 'epoch'::timestamptz))) AS last_activity_at
    FROM tool_performance
    GROUP BY tool_name
  `);
  const usageRows = (usageRes as any).rows || usageRes;
  const usage = new Map<string, RetirementUsage>();
  for (const r of usageRows) {
    const last = r.last_activity_at ? new Date(r.last_activity_at) : null;
    usage.set(String(r.tool_name), {
      successCount: parseInt(r.success_count, 10) || 0,
      failCount: parseInt(r.fail_count, 10) || 0,
      lastActivityAt: last && last.getTime() > 0 ? last : null,
    });
  }

  // 4. Classify.
  const candidates = classifyRetirementCandidates({
    tools, usage, exemptions, windowDays, minSample, failRateThreshold,
    maxCandidates: maxCandidates * 3, // overfetch: dedupe below prunes already-queued
    now: new Date(),
  });

  // 5. Dedupe vs ANY prior approval for the same tool (pending or decided —
  //    a rejected retirement must not be re-nagged; re-flag only if Bob clears it).
  const priorRes: any = await db.execute(sql`
    SELECT context->>'tool' AS tool FROM agent_approvals
    WHERE requested_by = ${REQUESTED_BY} AND tenant_id = ${ADMIN_TENANT_ID}
  `);
  const priorTools = new Set(((priorRes as any).rows || priorRes).map((r: any) => String(r.tool)));
  const fresh = candidates.filter((c) => !priorTools.has(c.tool)).slice(0, maxCandidates);

  // 6. Queue (unless dry run).
  let queued = 0;
  if (!dryRun) {
    for (const c of fresh) {
      await createApproval({
        tenantId: ADMIN_TENANT_ID,
        requestedBy: REQUESTED_BY,
        question:
          c.reason === "zero_invocations"
            ? `Retire tool "${c.tool}"? Zero invocations in the last ${windowDays} days (last activity: ${c.evidence.lastActivityAt ?? "never"}). Approving flags it for removal in a future session — nothing is deleted automatically.`
            : `Retire or repair tool "${c.tool}"? Failure rate ${(100 * (c.evidence.failRate ?? 0)).toFixed(0)}% over ${c.evidence.successCount + c.evidence.failCount} invocations. Approving flags it for removal/repair in a future session — nothing is deleted automatically.`,
        context: { tool: c.tool, reason: c.reason, evidence: c.evidence, source: REQUESTED_BY },
        ttlHours: 24 * 7,
      });
      queued++;
    }
  }

  // 7. Report.
  const report = {
    ranAt: new Date().toISOString(),
    dryRun,
    params: { windowDays, maxCandidates, minSample, failRateThreshold },
    registrySize: toolNames.length,
    usageRows: usage.size,
    exempted: tools.filter((t) => exemptions.tools.has(t.name) || t.categories.some((c) => exemptions.categories.has(c))).length,
    classified: candidates.length,
    alreadyQueued: candidates.length - Math.min(candidates.length, candidates.filter((c) => !priorTools.has(c.tool)).length),
    queuedThisRun: queued,
    candidates: fresh,
  };
  fs.mkdirSync("data/tool-retirement", { recursive: true });
  fs.writeFileSync("data/tool-retirement/latest.json", JSON.stringify(report, null, 2));
  console.log(`[tool-retirement] registry=${toolNames.length} usageRows=${usage.size} classified=${candidates.length} queued=${queued}${dryRun ? " (DRY_RUN)" : ""} → data/tool-retirement/latest.json`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`[tool-retirement] FAILED: ${e?.message || e}`);
  process.exit(1);
});
