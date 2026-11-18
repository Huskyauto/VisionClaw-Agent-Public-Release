import { sql } from "drizzle-orm";
import { db } from "../db";
import { legionProduction } from "./runtime";
import { assertRunbookActive } from "./runbook-hosted";
import { readLegionRunbook } from "./runbook-source";
import { LEGION_RUNBOOK_JOB, SURFACE_RULE_JOB, legionNightWindow } from "./nightly-policy";
import { localParallelEnabled, type LocalPriority } from "./local-slots";
import { surfaceLocalEnabled } from "./local-provider-runtime";

export const localMaintenanceEnvironment = () => legionProduction() ? "production" : "development";
export const resultRows = <T>(value: unknown) => ((value as { rows?: T[] }).rows ?? value) as T[];
export type LocalTask = "both" | "lenovo" | "surface";

/** Window cap and task/source snapshot are checked together BEFORE either INSERT.
 * A changed source cannot quietly reuse an older daytime answer or bypass caps. */
export async function queueLocalMaintenance(sourcePath: string, priority: LocalPriority, task: LocalTask,
  now = new Date(), delayMs = 0) {
  assertRunbookActive();
  if (!["daytime", "overnight"].includes(priority) || !["both", "lenovo", "surface"].includes(task)) {
    throw Error("Invalid local maintenance selection");
  }
  if ((task !== "lenovo" || priority === "daytime") && !localParallelEnabled()) {
    throw Error("Parallel laptop maintenance disabled");
  }
  if (task !== "lenovo" && !surfaceLocalEnabled()) throw Error("Surface maintenance disabled");
  const source = await readLegionRunbook(sourcePath);
  const environment = localMaintenanceEnvironment();
  const window = priority === "overnight" ? legionNightWindow(now) :
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric",
      month: "2-digit", day: "2-digit" }).format(now);
  const kinds = task === "both" ? [LEGION_RUNBOOK_JOB, SURFACE_RULE_JOB] :
    [task === "lenovo" ? LEGION_RUNBOOK_JOB : SURFACE_RULE_JOB];
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`local-maintenance:${environment}:${window}:${priority}:${sourcePath}`}))`);
    const prior = resultRows<{ id: number; kind: string; digest: string }>(await tx.execute(sql`
      SELECT id,kind,payload->>'sourceSha256' AS digest FROM agent_jobs
      WHERE tenant_id=1 AND kind IN (${LEGION_RUNBOOK_JOB},${SURFACE_RULE_JOB})
        AND payload->>'environment'=${environment} AND payload->>'window'=${window}
        AND payload->>'sourcePath'=${sourcePath}
        AND COALESCE(payload->>'priority','overnight')=${priority}
      ORDER BY id DESC`));
    if (priority === "daytime" && prior.some(p => kinds.includes(p.kind) && p.digest !== source.sha256)) {
      throw Error("Source changed after today's submission; daily source/task limit reached");
    }
    const ids: number[] = [];
    for (const kind of kinds) {
      const existing = prior.find(p => p.kind === kind);
      if (existing) { ids.push(existing.id); continue; }
      if (priority === "overnight") {
        const reusable = resultRows<{ id: number }>(await tx.execute(sql`
          SELECT id FROM agent_jobs WHERE tenant_id=1 AND kind=${kind} AND status='succeeded'
            AND payload->>'environment'=${environment} AND result->>'status'='compiled'
            AND result->>'sourcePath'=${sourcePath} AND result->>'sourceSha256'=${source.sha256}
          ORDER BY id DESC LIMIT 1`));
        if (reusable.length) continue;
      }
      const dedupeKey = `local-maintenance:${environment}:${window}:${priority}:${sourcePath}:${kind}:${source.sha256}`;
      const payload = { tenantId: 1, environment, window, priority, sourcePath,
        sourceSha256: source.sha256, dedupeKey };
      const inserted = resultRows<{ id: number }>(await tx.execute(sql`
        INSERT INTO agent_jobs(kind,payload,tenant_id,max_attempts,next_run_at)
        VALUES(${kind},${JSON.stringify(payload)}::jsonb,1,3,${new Date(now.getTime() + delayMs)})
        RETURNING id`));
      ids.push(inserted[0].id);
    }
    return ids;
  });
}
