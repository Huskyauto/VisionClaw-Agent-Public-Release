import { writeFileSync, mkdirSync } from "fs";
import { Pool } from "pg";

const SYNC_OUTPUT = "dist/dev-data-snapshot.json";

async function syncDevData() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log("[sync] Exporting dev research data for production...");

    const programs = await pool.query(`
      SELECT tenant_id, persona_id, name, objective, constraints, metrics,
             exploration_strategy, model, max_experiments_per_session, is_active
      FROM research_programs ORDER BY id
    `);

    const sessions = await pool.query(`
      SELECT tenant_id, program_id, status, started_at, ended_at,
             total_experiments, experiments_kept, experiments_discarded,
             experiments_crashed, total_tokens_used, summary, model
      FROM research_sessions ORDER BY id
    `);

    const experiments = await pool.query(`
      SELECT session_id, tenant_id, program_id, hypothesis, approach, result,
             metric, metric_value, status, parent_experiment_id, tokens_used,
             duration_ms, model, created_at
      FROM research_experiments ORDER BY id
    `);

    const programNames = programs.rows.map(p => p.name);

    const snapshot = {
      exportedAt: new Date().toISOString(),
      programs: programs.rows,
      sessions: sessions.rows,
      experiments: experiments.rows,
      programNames,
    };

    mkdirSync("dist", { recursive: true });
    writeFileSync(SYNC_OUTPUT, JSON.stringify(snapshot, null, 2));
    console.log(`[sync] Exported ${programs.rows.length} programs, ${sessions.rows.length} sessions, ${experiments.rows.length} experiments`);
    console.log(`[sync] Snapshot saved to ${SYNC_OUTPUT}`);
  } catch (err: any) {
    console.error("[sync] Export failed (non-fatal):", err.message);
  } finally {
    await pool.end();
  }
}

syncDevData();
