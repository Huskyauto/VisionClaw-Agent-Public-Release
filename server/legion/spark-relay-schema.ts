import { AGENT_JOB_STATUSES } from "../../shared/agent-job-status";

interface SqlClient { query(text: string, values?: any[]): Promise<{ rows: any[] }> }
const quoted = AGENT_JOB_STATUSES.map(status => `'${status}'`).join(",");
const normalize = (text: string) => {
  const literals: string[] = [];
  const shape = text.replace(/'(?:''|[^'])*'/g, literal => {
    literals.push(literal); return "?";
  }).replace(/::text(?:\[\])?/g, "").replace(/\s+/g, "");
  return JSON.stringify([shape, literals]);
};
const expected = normalize(`CHECK((status=ANY(ARRAY[${quoted}])))`);
export async function checkSparkRelaySchema(client: SqlClient) {
  const result = await client.query(`SELECT convalidated,pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid='agent_jobs'::regclass AND conname='agent_jobs_status_check'`);
  const row = result.rows[0];
  return { ready: row?.convalidated === true && normalize(row.definition) === expected,
    present: !!row, validated: row?.convalidated === true };
}
/** Caller supplies a development or disposable-fixture connection. No startup DDL. */
export async function migrateSparkRelaySchema(client: SqlClient) {
  if ((await checkSparkRelaySchema(client)).ready) return { ready: true, changed: false };
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    // Atomic replacement preserves the old constraint if any step fails.
    // Only compile-time constants enter this DDL; no caller identifiers/values.
    await client.query(`ALTER TABLE agent_jobs DROP CONSTRAINT IF EXISTS agent_jobs_status_check,
      ADD CONSTRAINT agent_jobs_status_check CHECK (status IN (${quoted})) NOT VALID`);
    await client.query("ALTER TABLE agent_jobs VALIDATE CONSTRAINT agent_jobs_status_check");
    if (!(await checkSparkRelaySchema(client)).ready) throw Error("Relay status constraint verification failed");
    await client.query("COMMIT");
    return { ready: true, changed: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
