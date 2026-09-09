/**
 * Tenant-scoped, read-only proof-backed capability evidence report.
 *
 * Usage:
 *   npx tsx scripts/capability-evidence-shadow-report.ts --tenant 1 [--days 30]
 */
import { db, pool } from "../server/db";
import { sql } from "drizzle-orm";
import {
  isCapabilityEvidenceReadyForReview,
  normalizeCapabilityIdentity,
  parseCapabilityEvidenceObservation,
  type CapabilityEvidenceObservation,
} from "../server/lib/capability-evidence-shadow";

function positiveInt(flag: string, fallback?: number): number {
  const index = process.argv.indexOf(flag);
  if (index < 0 && fallback !== undefined) return fallback;
  const value = Number(index >= 0 ? process.argv[index + 1] : NaN);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${flag} requires a positive integer`);
  return value;
}

async function main() {
  const tenantId = positiveInt("--tenant");
  const days = Math.min(365, positiveInt("--days", 30));
  const result: any = await db.execute(sql`
    SELECT
      e.data,
      sr.id AS verified_reward_id,
      sr.agent AS verified_agent,
      sr.signals->>'execModel' AS verified_exec_model,
      sr.score AS verified_score,
      sr.step_index AS verified_step_index,
      sr.signals AS verified_signals
    FROM event_log e
    LEFT JOIN step_rewards sr
      ON sr.tenant_id = ${tenantId}
     AND sr.id = CASE
       WHEN (e.data->>'rewardId') ~ '^[0-9]+$' THEN (e.data->>'rewardId')::bigint
       ELSE NULL
     END
    WHERE e.tenant_id = ${tenantId}
      AND e.event_type = 'capability_evidence_shadow'
      AND e.status = 'shadow'
      AND e.created_at > now() - make_interval(days => ${days}::int)
    ORDER BY e.created_at DESC
    LIMIT 1000
  `);
  const rows: any[] = result.rows ?? result;
  const byCapability = new Map<string, CapabilityEvidenceObservation[]>();
  const corroborated = new Set<number>();
  const seen = new Set<string>();
  let invalid = 0;
  let uncorroborated = 0;
  let duplicates = 0;

  for (const row of rows) {
    let raw: unknown = row.data;
    try {
      if (typeof raw === "string") raw = JSON.parse(raw);
    } catch {
      invalid++;
      continue;
    }
    const observation = parseCapabilityEvidenceObservation(raw);
    if (!observation) {
      invalid++;
      continue;
    }
    if (seen.has(observation.eventKey)) {
      duplicates++;
      continue;
    }
    seen.add(observation.eventKey);
    let signals: Record<string, unknown>;
    try {
      signals = typeof row.verified_signals === "string"
        ? JSON.parse(row.verified_signals)
        : row.verified_signals ?? {};
      if (!signals || typeof signals !== "object" || Array.isArray(signals)) throw new Error("invalid signals");
    } catch {
      uncorroborated++;
      continue;
    }
    const expectedSuccess = signals.failed !== true;
    const expectedClass = !expectedSuccess
      ? "failed"
      : Number(signals.outputLen ?? 0) < 20
        ? "hollow_success"
        : "verified_success";
    const authoritative =
      Number(row.verified_reward_id) === observation.rewardId &&
      Number(row.verified_score) === observation.score &&
      Number(row.verified_step_index) === observation.stepIndex &&
      Number(signals.outputLen ?? 0) === observation.outputLen &&
      normalizeCapabilityIdentity(row.verified_agent || row.verified_exec_model) === observation.capability &&
      expectedSuccess === observation.success &&
      expectedClass === observation.evidenceClass;
    if (!authoritative) {
      uncorroborated++;
      continue;
    }
    corroborated.add(observation.rewardId);
    const group = byCapability.get(observation.capability) ?? [];
    group.push(observation);
    byCapability.set(observation.capability, group);
  }

  console.log(`\n=== Capability evidence shadow (${days} day(s), tenant ${tenantId}) ===`);
  console.log("Authority effect: NONE — this report cannot grant permissions, promote agents, or change routing.");
  if (rows.length === 0) console.log("Evidence verdict: NOT STARTED — no observations in this window.");
  for (const [capability, observations] of [...byCapability].sort(([a], [b]) => a.localeCompare(b))) {
    const successes = observations.filter((o) => o.evidenceClass === "verified_success").length;
    const ready = isCapabilityEvidenceReadyForReview(observations, corroborated);
    console.log(`\n${capability}`);
    console.log(`  Corroborated witnesses: ${observations.length}`);
    console.log(`  Verified successes: ${successes}`);
    console.log(`  Evidence verdict: ${ready ? "READY FOR HUMAN REVIEW" : "PRELIMINARY"}`);
  }
  console.log("\n--- Integrity summary ---");
  console.log(`Rows inspected: ${rows.length}`);
  console.log(`Invalid rows excluded: ${invalid}`);
  console.log(`Uncorroborated rows excluded: ${uncorroborated}`);
  console.log(`Duplicate rows excluded: ${duplicates}`);
  if (invalid > 0 || uncorroborated > 0) {
    console.log("Overall verdict: INCONCLUSIVE — excluded evidence exists.");
  }
}

void main()
  .catch((error) => {
    console.error("[capability-evidence-shadow-report] failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (error: any) {
      console.error("[capability-evidence-shadow-report] pool shutdown failed:", error?.message || error);
      process.exitCode = 1;
    }
  })
  .catch((error) => {
    console.error("[capability-evidence-shadow-report] finalization failed:", error?.message || error);
    process.exitCode = 1;
  });