"use strict";

const { Client } = require("pg");

async function main() {
  if (process.env.ISOLATED_STAGING !== "1") {
    throw new Error("Refusing staging schema reconciliation without ISOLATED_STAGING=1");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "ALTER TABLE revenue_orchestrator_mission_links DROP CONSTRAINT IF EXISTS revenue_orchestrator_links_tenant_source_run_fk",
    );
    await client.query(
      "ALTER TABLE revenue_orchestrator_mission_links DROP CONSTRAINT IF EXISTS revenue_orchestrator_links_tenant_mission_fk",
    );
    await client.query("ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_tenant_id_unique");
    await client.query("ALTER TABLE revenue_missions DROP CONSTRAINT IF EXISTS revenue_missions_tenant_id_unique");
    await client.query("ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_tenant_id_unique UNIQUE (tenant_id, id)");
    await client.query("ALTER TABLE revenue_missions ADD CONSTRAINT revenue_missions_tenant_id_unique UNIQUE (tenant_id, id)");
    await client.query(`
      ALTER TABLE revenue_orchestrator_mission_links
      ADD CONSTRAINT revenue_orchestrator_links_tenant_source_run_fk
      FOREIGN KEY (tenant_id, source_run_id) REFERENCES agent_runs (tenant_id, id)
    `);
    await client.query(`
      ALTER TABLE revenue_orchestrator_mission_links
      ADD CONSTRAINT revenue_orchestrator_links_tenant_mission_fk
      FOREIGN KEY (tenant_id, mission_id) REFERENCES revenue_missions (tenant_id, id)
    `);
    const verified = await client.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conname = ANY($1::text[])
    `, [[
      "agent_runs_tenant_id_unique",
      "revenue_missions_tenant_id_unique",
      "revenue_orchestrator_links_tenant_source_run_fk",
      "revenue_orchestrator_links_tenant_mission_fk",
    ]]);
    if (verified.rowCount !== 4) {
      throw new Error(`constraint verification failed: expected 4, found ${verified.rowCount}`);
    }
    await client.query("COMMIT");
    console.log("[staging-schema-repair] Reconciled and verified 2 composite unique keys + 2 tenant-safe foreign keys");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[staging-schema-repair] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});