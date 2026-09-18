#!/usr/bin/env tsx
/**
 * Roll up durable HyDE retrieval observations.
 *
 * Usage:
 *   npx tsx scripts/hyde-shadow-report.ts [--days N] [--json]
 *
 * Attempt rows provide the timeout denominator. Shadow rows compare HyDE's
 * live top-five with the raw-query counterfactual. The report is read-only and
 * intentionally omits tenant ids and user messages.
 */

import { db, pool } from "../server/db";
import { sql } from "drizzle-orm";
import {
  aggregateHydeObservations,
  HYDE_QUERY_CATEGORIES,
  type HydeObservation,
  type HydeQueryCategory,
  type HydeRetrievalSurface,
} from "../server/lib/hyde-observability";
import { runHydeRetrievalGoldenEval } from "../server/lib/hyde-quality-eval";

function parseDays(): number {
  const arg = process.argv.find((value) => value.startsWith("--days="));
  const separate = process.argv.indexOf("--days");
  const raw = arg ? arg.slice("--days=".length) : separate >= 0 ? process.argv[separate + 1] : undefined;
  const days = Number(raw);
  return Number.isInteger(days) && days > 0 && days <= 365 ? days : 7;
}

function isCategory(value: unknown): value is HydeQueryCategory {
  return typeof value === "string" && (HYDE_QUERY_CATEGORIES as readonly string[]).includes(value);
}

function isSurface(value: unknown): value is HydeRetrievalSurface {
  return value === "personal_memory" || value === "agent_knowledge";
}

function parseObservation(data: unknown): HydeObservation | null {
  const value = typeof data === "string" ? JSON.parse(data) : data;
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!isCategory(row.category)) return null;
  if (
    typeof row.retrievalId !== "string" ||
    row.retrievalId.length < 8 ||
    row.retrievalId.length > 100 ||
    !isSurface(row.surface)
  ) return null;

  if (
    row.kind === "attempt" &&
    ["success", "timeout", "error", "empty"].includes(row.outcome)
  ) {
    return {
      kind: "attempt",
      retrievalId: row.retrievalId,
      surface: row.surface,
      category: row.category,
      outcome: row.outcome,
    };
  }
  if (
    row.kind === "shadow" &&
    Number.isFinite(Number(row.deltaTop5)) &&
    Number(row.deltaTop5) >= 0 &&
    (row.rankDisplacement === null || Number.isFinite(Number(row.rankDisplacement)))
  ) {
    return {
      kind: "shadow",
      retrievalId: row.retrievalId,
      surface: row.surface,
      category: row.category,
      deltaTop5: Number(row.deltaTop5),
      rankDisplacement: row.rankDisplacement === null ? null : Number(row.rankDisplacement),
    };
  }
  if (
    row.kind === "comparison_failure" &&
    typeof row.reason === "string" &&
    row.reason.length > 0 &&
    row.reason.length <= 100
  ) {
    return {
      kind: "comparison_failure",
      retrievalId: row.retrievalId,
      surface: row.surface,
      category: row.category,
      reason: row.reason,
    };
  }
  return null;
}

async function main() {
  const days = parseDays();
  const asJson = process.argv.includes("--json");
  try {
    const result = await db.execute(sql`
      SELECT data
      FROM event_log
      WHERE event_type = 'memory_hyde_observation'
        AND status = 'shadow'
        AND created_at > now() - make_interval(days => ${days}::int)
      ORDER BY created_at ASC
    `);
    const rows = Array.isArray(result)
      ? result as Array<Record<string, unknown>>
      : result && typeof result === "object" && "rows" in result &&
          Array.isArray((result as { rows?: unknown }).rows)
        ? (result as { rows: Array<Record<string, unknown>> }).rows
        : [];
    const observations: HydeObservation[] = [];
    let malformedRows = 0;
    for (const row of rows) {
      try {
        const observation = parseObservation(row?.data);
        if (observation) observations.push(observation);
        else malformedRows++;
      } catch {
        malformedRows++;
      }
    }

    const aggregate = aggregateHydeObservations(observations);
    let quality: Awaited<ReturnType<typeof runHydeRetrievalGoldenEval>>["aggregate"] | null = null;
    let qualityError: string | null = null;
    if (process.argv.includes("--quality-eval")) {
      try {
        quality = (await runHydeRetrievalGoldenEval()).aggregate;
      } catch (error) {
        qualityError = String((error as Error)?.message ?? error);
      }
    }
    const report = {
      generatedAt: new Date().toISOString(),
      windowDays: days,
      sourceRows: rows.length,
      malformedRows,
      ...aggregate,
      quality,
      qualityError,
    };

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`\n=== HyDE memory retrieval report (last ${days} day(s)) ===`);
    console.log(`Observations:          ${observations.length} (${malformedRows} malformed)`);
    console.log(`HyDE attempts:         ${aggregate.attempts}`);
    console.log(`Successful generations:${aggregate.successes}`);
    console.log(`HyDE timeouts:         ${aggregate.timeouts} (${aggregate.timeoutRatePct}%)`);
    console.log(`Errors / empty:        ${aggregate.errors} / ${aggregate.emptyResponses}`);
    console.log(`Shadow comparisons:    ${aggregate.shadowComparisons}`);
    console.log(`Comparison failures:   ${aggregate.comparisonFailures}`);
    console.log(`Comparison coverage:   ${aggregate.comparisonCoveragePct ?? "n/a"}% (${aggregate.missingComparisons} missing)`);
    console.log(`Average top-5 delta:   ${aggregate.avgDeltaTop5 ?? "n/a"} different memories`);
    console.log(`Average rank movement: ${aggregate.avgRankDisplacement ?? "n/a"}`);
    console.log("\nCategory result-set divergence (sorted by average top-5 delta):");
    for (const category of aggregate.categories) {
      console.log(
        `  ${category.category}: attempts=${category.attempts} ` +
        `timeouts=${category.timeouts} shadows=${category.shadowComparisons} ` +
        `avg_delta=${category.avgDeltaTop5 ?? "n/a"} ` +
        `avg_rank_movement=${category.avgRankDisplacement ?? "n/a"}`,
      );
    }
    console.log("\nRetrieval surfaces:");
    for (const surface of aggregate.surfaces) {
      console.log(
        `  ${surface.surface}: attempts=${surface.attempts} successes=${surface.successes} ` +
        `shadows=${surface.shadowComparisons} missing=${surface.missingComparisons}`,
      );
    }
    if (aggregate.recommendation) console.log(`\nALERT: ${aggregate.recommendation}`);
    if (quality) {
      console.log("\nGolden relevance evaluation:");
      console.log(`  samples=${quality.evaluatedSamples}/${quality.expectedSamples} decision=${quality.decision}`);
      console.log(`  wins=${quality.wins} losses=${quality.losses} ties=${quality.ties}`);
      console.log(`  Recall@5 raw=${quality.rawRecallAt5 ?? "n/a"} HyDE=${quality.hydeRecallAt5 ?? "n/a"}`);
      console.log(`  MRR raw=${quality.rawMrr ?? "n/a"} HyDE=${quality.hydeMrr ?? "n/a"} delta=${quality.scoreDelta ?? "n/a"}`);
    } else if (qualityError) {
      console.log(`\nGolden relevance evaluation unavailable: ${qualityError}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[hyde-shadow-report] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});