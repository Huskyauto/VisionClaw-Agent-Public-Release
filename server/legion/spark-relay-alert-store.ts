import { sql } from "drizzle-orm";
import type { RelayDatabase } from "./spark-relay-store";
import type { RelayAlertState } from "./spark-relay-alerts";

export const RELAY_ALERT_KIND = "legion_spark_alert_state";
const rows = (r: any): any[] => r.rows ?? r;

/** Separate non-runnable state, serialized across health calls and replicas.
 * Uses an existing inert status; never creates queued/running inference work. */
export function createSparkRelayAlertUpdater(db: RelayDatabase) {
  return async <T>(environment: string, fn: (state: RelayAlertState) => T): Promise<T> => {
    if (environment !== "production") throw Error("Spark alerts require production scope");
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`spark-alert:1:${environment}`}))`);
      const prior = rows(await tx.execute(sql`SELECT id,payload FROM agent_jobs
        WHERE tenant_id=1 AND kind=${RELAY_ALERT_KIND} AND payload->>'environment'=${environment}
        ORDER BY id LIMIT 1`))[0];
      const state: RelayAlertState = prior ? prior.payload.state : {};
      if (!state || typeof state !== "object" || Array.isArray(state))
        throw Error("Invalid Spark alert state; notification suppressed");
      const result = fn(state);
      const payload = JSON.stringify({ environment, state });
      if (prior) {
        await tx.execute(sql`UPDATE agent_jobs SET payload=${payload}::jsonb
          WHERE id=${prior.id} AND tenant_id=1 AND kind=${RELAY_ALERT_KIND}
            AND payload->>'environment'=${environment}`);
      } else {
        await tx.execute(sql`INSERT INTO agent_jobs (tenant_id,kind,status,payload,max_attempts)
          VALUES (1,${RELAY_ALERT_KIND},'relay_worker',${payload}::jsonb,1)`);
      }
      return result;
    });
  };
}
