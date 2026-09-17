// ─────────────────────────────────────────────────────────────────────────────
// Sandbox Retention — weekly TTL purge of Simulation Sandbox data
// Contract: data/feature-contracts/simulation-sandbox/
// ─────────────────────────────────────────────────────────────────────────────
// Deletes sandbox_runs older than SANDBOX_RETENTION_DAYS (default 14).
// sandbox_results rows cascade with their run (FK ON DELETE CASCADE).
// Promoted improvements (sandbox_improvements) SURVIVE — their run_id is
// ON DELETE SET NULL, so the jury-vetted Improvement list is durable while
// bulky per-item replay data is not.
//
// One-line agent-runnable: no prompts, env-configured, meaningful exit codes:
//   0  success (purge completed; summary on stdout)
//   1  fatal error (DB unreachable / purge crashed)
// Env knobs: SANDBOX_RETENTION_DAYS (default 14, min 3 — a lower value is
// clamped so a typo can't wipe fresh runs), SANDBOX_RETENTION_DRY_RUN=1
// (count only, delete nothing).
// ─────────────────────────────────────────────────────────────────────────────

import { pool } from "../server/db";

function retentionDays(): number {
  const raw = Number(process.env.SANDBOX_RETENTION_DAYS ?? 14);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 14;
  return Math.max(3, Math.floor(raw));
}

async function main(): Promise<number> {
  const days = retentionDays();
  const dryRun = process.env.SANDBOX_RETENTION_DRY_RUN === "1";
  const cutoffSql = `now() - make_interval(days => $1)`;

  const counts = await pool.query(
    `SELECT
       (SELECT count(*) FROM sandbox_runs WHERE started_at < ${cutoffSql}) AS runs,
       (SELECT count(*) FROM sandbox_results r WHERE EXISTS (
          SELECT 1 FROM sandbox_runs s WHERE s.id = r.run_id AND s.started_at < ${cutoffSql}
        )) AS results`,
    [days],
  );
  const eligibleRuns = Number(counts.rows[0]?.runs ?? 0);
  const eligibleResults = Number(counts.rows[0]?.results ?? 0);
  console.log(
    `[sandbox-retention] cutoff=${days}d eligible: ${eligibleRuns} run(s), ${eligibleResults} result row(s)` +
      (dryRun ? " — DRY RUN, deleting nothing" : ""),
  );

  if (!dryRun && eligibleRuns > 0) {
    // Single statement: results cascade via FK; improvements keep their row
    // (run_id → NULL). No per-row loop needed.
    const del = await pool.query(
      `DELETE FROM sandbox_runs WHERE started_at < ${cutoffSql}`,
      [days],
    );
    console.log(`[sandbox-retention] deleted ${del.rowCount} run(s) (results cascaded, improvements preserved via SET NULL)`);
  }

  const survivors = await pool.query(
    `SELECT count(*) AS improvements, count(*) FILTER (WHERE run_id IS NULL) AS detached
     FROM sandbox_improvements`,
  );
  console.log(
    `[sandbox-retention] improvements intact: ${survivors.rows[0]?.improvements ?? 0} total, ${survivors.rows[0]?.detached ?? 0} detached from purged runs`,
  );
  return 0;
}

main()
  .then(async (code) => {
    await pool.end().catch(() => {});
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(`[sandbox-retention] FATAL: ${err?.message || err}`);
    await pool.end().catch(() => {});
    process.exit(1);
  });
