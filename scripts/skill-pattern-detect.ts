#!/usr/bin/env tsx
// R113 — CLI wrapper for the passive skill pattern detector.
//
// Usage:
//   TENANT_ID=8 npx tsx scripts/skill-pattern-detect.ts                    # one tenant
//   TENANT_ID=8 DRY_RUN=1 npx tsx scripts/skill-pattern-detect.ts          # report only
//   ALL_TENANTS=1 npx tsx scripts/skill-pattern-detect.ts                  # every active tenant
//   WINDOW_DAYS=14 SEQ_LEN=4 MIN_REPS=4 npx tsx scripts/skill-pattern-detect.ts
//
// Exit codes:
//   0 — ran cleanly (may have produced 0 proposals)
//   1 — invalid configuration (missing tenant scope etc.)
//   2 — internal error during detection (DB unavailable etc.)
//
// Designed to be invoked by a scheduled deployment on a daily cadence;
// safe to run multiple times per day (idempotent — existing proposals
// for the same sequence hash are skipped).

import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { withTenantContext } from "../server/lib/tenant-context";
import { detectAndQueueSkillProposals } from "../server/lib/skill-pattern-detector";

function parseIntEnv(name: string, def: number | undefined): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const v = parseInt(raw, 10);
  return Number.isFinite(v) ? v : def;
}

async function listActiveTenants(): Promise<number[]> {
  // Fall back to scanning agent_trace_spans for distinct tenants in the window —
  // this avoids hard-coding any tenant list.
  try {
    const r: any = await db.execute(sql`
      SELECT DISTINCT tenant_id
        FROM agent_trace_spans
       WHERE started_at > NOW() - INTERVAL '14 days'
       ORDER BY tenant_id
    `);
    const rows = (r.rows || r) as any[];
    return rows.map((row) => row.tenant_id as number).filter((n) => typeof n === "number" && n > 0);
  } catch (e: any) {
    console.error(`[skill-pattern-detect] could not enumerate tenants: ${e?.message}`);
    return [];
  }
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "1";
  const windowDays = parseIntEnv("WINDOW_DAYS", 7);
  const sequenceLength = parseIntEnv("SEQ_LEN", 3);
  const minRepetitions = parseIntEnv("MIN_REPS", 3);
  const maxProposals = parseIntEnv("MAX_PROPOSALS", 10);

  let tenants: number[] = [];
  if (process.env.ALL_TENANTS === "1") {
    tenants = await listActiveTenants();
    if (tenants.length === 0) {
      console.error("[skill-pattern-detect] ALL_TENANTS=1 but no active tenants found in last 14d");
      process.exit(0);
    }
  } else {
    const tid = parseIntEnv("TENANT_ID", undefined);
    if (!tid) {
      console.error("[skill-pattern-detect] set TENANT_ID=<n> or ALL_TENANTS=1");
      process.exit(1);
    }
    tenants = [tid];
  }

  console.log(`[skill-pattern-detect] scanning ${tenants.length} tenant(s) | window=${windowDays}d | seq=${sequenceLength} | min_reps=${minRepetitions} | max_proposals=${maxProposals} | dry_run=${dryRun}`);

  let totalCreated = 0;
  let totalSkipped = 0;
  let totalPatterns = 0;
  for (const tenantId of tenants) {
    try {
      const result = await withTenantContext(tenantId, () =>
        detectAndQueueSkillProposals({
          tenantId,
          windowDays,
          sequenceLength,
          minRepetitions,
          maxProposals,
          dryRun,
        }),
      );
      totalCreated += result.proposalsCreated;
      totalSkipped += result.proposalsSkipped;
      totalPatterns += result.patternsFound;
      console.log(
        `[skill-pattern-detect] tenant=${tenantId} spans=${result.scannedSpans} traces=${result.scannedTraces} patterns=${result.patternsFound} created=${result.proposalsCreated} skipped=${result.proposalsSkipped}`,
      );
      for (const p of result.patterns) {
        console.log(`  • ${p.toolNames.join(" → ")}  (${p.distinctTraces} distinct traces, ${p.repetitions} occurrences, persona=${p.topPersona ?? "?"})`);
      }
    } catch (e: any) {
      console.error(`[skill-pattern-detect] tenant=${tenantId} failed: ${e?.message?.slice(0, 200)}`);
      process.exit(2);
    }
  }

  console.log(`[skill-pattern-detect] DONE — patterns_found=${totalPatterns} proposals_created=${totalCreated} skipped=${totalSkipped}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`[skill-pattern-detect] fatal: ${e?.message}`);
  process.exit(2);
});
