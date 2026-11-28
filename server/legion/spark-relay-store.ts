import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  SPARK_RELAY, RELAY_JOB_KIND, RELAY_WORKER_KIND, relayHash, relayStatus,
  makeRelayRequest, validateRelayCompletion, type RelayBinding, type RelayOutcome,
  DIRECT_RESERVATION_KIND,
} from "./spark-relay-contract";

export interface RelayDatabase {
  execute(query: any): Promise<any>;
  transaction<T>(fn: (tx: RelayDatabase) => Promise<T>): Promise<T>;
}
export class RelayConflict extends Error {}
type Options = { environment: () => string; enabled: () => boolean; now?: () => number;
  screen: (text: string) => boolean };
const rows = (r: any): any[] => r.rows ?? r;

/** External states are deliberately NOT pending/running, so generic workers,
 * reclaimers and retry mechanisms cannot execute or refund a Spark job. */
export function createSparkRelayStore(db: RelayDatabase, opts: Options) {
  const now = opts.now ?? Date.now;
  const env = () => {
    const value = opts.environment();
    if (!["development", "production"].includes(value)) throw new RelayConflict("Invalid relay environment");
    return value;
  };
  const owner = (tenantId: number) => {
    if (tenantId !== 1) throw new RelayConflict("Owner relay scope required");
    return env();
  };
  const active = () => { if (!opts.enabled()) throw new RelayConflict("Spark relay disabled"); };
  const lock = async (tx: RelayDatabase, environment: string) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`spark-relay:1:${environment}`}))`);
  };
  async function get(tenantId: number, id: number, store: RelayDatabase = db) {
    const environment = owner(tenantId);
    if (!Number.isSafeInteger(id) || id < 1) throw new RelayConflict("Invalid relay job");
    return rows(await store.execute(sql`SELECT id,status,payload,result,created_at,started_at FROM agent_jobs
      WHERE id=${id} AND tenant_id=${tenantId} AND kind=${RELAY_JOB_KIND}
        AND payload->>'environment'=${environment}`))[0];
  }
  function binding(row: any, b: RelayBinding, apiKeyId: number) {
    const p = row?.payload;
    return p && b.protocol === SPARK_RELAY.protocol && p.requestId === b.requestId &&
      p.digest === b.digest && p.claim?.workerId === b.workerId &&
      p.claim?.apiKeyId === apiKeyId && p.claim?.tokenHash === relayHash(b.claimToken);
  }
  async function expire(tx: RelayDatabase, environment: string) {
    await tx.execute(sql`UPDATE agent_jobs SET status=CASE WHEN status='relay_running'
      THEN 'relay_uncertain' ELSE 'relay_failed_before_send' END, completed_at=NOW()
      WHERE tenant_id=1 AND kind IN (${RELAY_JOB_KIND},${DIRECT_RESERVATION_KIND}) AND payload->>'environment'=${environment}
        AND ((status IN ('relay_queued','relay_running') AND (payload->>'deadlineAt')::timestamptz<=${new Date(now())})
          OR (status='relay_claimed' AND (payload->'claim'->>'until')::timestamptz<=${new Date(now())}))`);
  }
  async function workerFreshness(tenantId: number) {
    const environment = owner(tenantId);
    const worker = rows(await db.execute(sql`SELECT payload FROM agent_jobs WHERE tenant_id=${tenantId}
      AND kind=${RELAY_WORKER_KIND} AND payload->>'environment'=${environment} ORDER BY id DESC LIMIT 1`))[0]?.payload;
    return { enabled: opts.enabled(), environment,
      worker: worker ? { workerId: worker.workerId, seenAt: worker.seenAt,
        ready: worker.ready === true && now() - Date.parse(worker.seenAt) < SPARK_RELAY.workerFreshMs } : null };
  }
  return {
    get,
    workerFreshness,
    async find(tenantId: number, body: Record<string, any>, task: string, workId: string) {
      const environment = owner(tenantId), request = makeRelayRequest(body);
      const key = relayHash(JSON.stringify([environment, tenantId, workId, task, request.digest]));
      return rows(await db.execute(sql`SELECT id,status,payload,result FROM agent_jobs WHERE tenant_id=${tenantId}
        AND kind=${RELAY_JOB_KIND} AND payload->>'environment'=${environment}
        AND payload->>'requestKey'=${key} ORDER BY id LIMIT 1`))[0];
    },
    async enqueue(tenantId: number, body: Record<string, any>, task: string, workId: string, priority = "daytime") {
      const environment = owner(tenantId); active();
      if (!SPARK_RELAY.tasks.includes(task) || !/^[a-zA-Z0-9_.:-]{1,180}$/.test(workId) ||
          !["daytime", "overnight"].includes(priority)) throw new RelayConflict("Relay task refused");
      const request = makeRelayRequest(body);
      if (!opts.screen(request.requestJson)) throw new RelayConflict("Relay egress refused");
      const requestKey = relayHash(JSON.stringify([environment, tenantId, workId, task, request.digest]));
      return db.transaction(async tx => {
        await lock(tx, environment); active();
        await expire(tx, environment);
        const prior = rows(await tx.execute(sql`SELECT id,status,payload,result FROM agent_jobs
          WHERE tenant_id=${tenantId} AND kind=${RELAY_JOB_KIND} AND payload->>'environment'=${environment}
            AND payload->>'requestKey'=${requestKey} ORDER BY id LIMIT 1`))[0];
        if (prior) return prior;
        const count = rows(await tx.execute(sql`SELECT COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '1 hour')::int AS hourly,
          COUNT(*) FILTER (WHERE status IN ('relay_queued','relay_claimed','relay_running','relay_uncertain'))::int AS waiting
          FROM agent_jobs WHERE tenant_id=${tenantId} AND kind=${RELAY_JOB_KIND}
            AND payload->>'environment'=${environment}`))[0];
        if (count.hourly >= SPARK_RELAY.maxPerHour || count.waiting >= SPARK_RELAY.maxWaiting)
          throw new RelayConflict("Relay queue capacity unavailable");
        const payload = { environment, requestKey, requestId: randomUUID(), ...request, task, priority,
          deadlineAt: new Date(now() + SPARK_RELAY.deadlineMs).toISOString() };
        const result = rows(await tx.execute(sql`INSERT INTO agent_jobs
          (tenant_id,kind,status,payload,max_attempts) VALUES (${tenantId},${RELAY_JOB_KIND},
          'relay_queued',${JSON.stringify(payload)}::jsonb,1) RETURNING id,status,payload,result`))[0];
        return result;
      });
    },
    async poll(tenantId: number, apiKeyId: number, workerId: string, ready: boolean) {
      const environment = owner(tenantId); active();
      return db.transaction(async tx => {
        await lock(tx, environment); active();
        await expire(tx, environment);
        const heartbeat = { environment, workerId, apiKeyId, ready, seenAt: new Date(now()).toISOString(),
          protocol: SPARK_RELAY.protocol, model: SPARK_RELAY.model };
        const prior = rows(await tx.execute(sql`SELECT id FROM agent_jobs WHERE tenant_id=${tenantId}
          AND kind=${RELAY_WORKER_KIND} AND payload->>'environment'=${environment} ORDER BY id LIMIT 1`))[0];
        if (prior) await tx.execute(sql`UPDATE agent_jobs SET payload=${JSON.stringify(heartbeat)}::jsonb
          WHERE id=${prior.id} AND tenant_id=${tenantId} AND kind=${RELAY_WORKER_KIND}`);
        else await tx.execute(sql`INSERT INTO agent_jobs (tenant_id,kind,status,payload,max_attempts)
          VALUES (${tenantId},${RELAY_WORKER_KIND},'relay_worker',${JSON.stringify(heartbeat)}::jsonb,1)`);
        const busy = rows(await tx.execute(sql`SELECT id FROM agent_jobs WHERE tenant_id=${tenantId}
          AND kind IN (${RELAY_JOB_KIND},${DIRECT_RESERVATION_KIND})
          AND status IN ('relay_claimed','relay_running','relay_uncertain') LIMIT 1`));
        if (!ready || busy.length) return null;
        const row = rows(await tx.execute(sql`SELECT id,payload FROM agent_jobs WHERE tenant_id=${tenantId}
          AND kind=${RELAY_JOB_KIND} AND payload->>'environment'=${environment} AND status='relay_queued'
          AND (payload->>'deadlineAt')::timestamptz>${new Date(now() + SPARK_RELAY.minStartMs)}
          ORDER BY id LIMIT 1 FOR UPDATE`))[0];
        if (!row) return null;
        const claimToken = randomUUID();
        const payload = { ...row.payload, claim: { workerId, apiKeyId, tokenHash: relayHash(claimToken),
          until: new Date(now() + SPARK_RELAY.claimMs).toISOString() } };
        await tx.execute(sql`UPDATE agent_jobs SET status='relay_claimed',payload=${JSON.stringify(payload)}::jsonb
          WHERE id=${row.id} AND tenant_id=${tenantId} AND kind=${RELAY_JOB_KIND} AND status='relay_queued'`);
        return { jobId: row.id, requestId: payload.requestId, digest: payload.digest,
          requestJson: payload.requestJson, claimToken, deadlineAt: payload.deadlineAt };
      });
    },
    async start(tenantId: number, apiKeyId: number, id: number, b: RelayBinding) {
      const environment = owner(tenantId); active();
      return db.transaction(async tx => {
        await lock(tx, environment); active(); await expire(tx, environment);
        const row = await get(tenantId, id, tx);
        if (!binding(row, b, apiKeyId) || row.status !== "relay_claimed" ||
            Date.parse(row.payload.deadlineAt) - now() < SPARK_RELAY.minStartMs)
          throw new RelayConflict("Relay start binding or deadline refused");
        const admission = rows(await tx.execute(sql`SELECT pg_try_advisory_xact_lock(872631,1) AS acquired`))[0];
        if (admission?.acquired !== true) throw new RelayConflict("Lenovo inference busy");
        const busy = rows(await tx.execute(sql`SELECT id FROM agent_jobs WHERE tenant_id=${tenantId}
          AND kind IN (${RELAY_JOB_KIND},${DIRECT_RESERVATION_KIND})
          AND status IN ('relay_running','relay_uncertain') LIMIT 1`));
        if (busy.length) throw new RelayConflict("Lenovo relay reservation unresolved");
        if (row.payload.priority === "overnight") {
          const daytime = rows(await tx.execute(sql`SELECT id FROM agent_jobs WHERE tenant_id=${tenantId}
            AND kind IN ('legion_runbook_compile','surface_runbook_rule')
            AND (status='pending' OR (status='running' AND lease_until>NOW()))
            AND payload->>'priority'='daytime' AND payload->>'environment'=${environment} LIMIT 1`));
          if (daytime.length) throw new RelayConflict("Lenovo yielding to daytime work");
        }
        const started = rows(await tx.execute(sql`UPDATE agent_jobs SET status='relay_running',started_at=NOW(),attempts=1
          WHERE id=${id} AND tenant_id=${tenantId} AND kind=${RELAY_JOB_KIND} AND status='relay_claimed' RETURNING id`));
        if (started.length !== 1) throw new RelayConflict("Relay running reservation was not acquired");
        return { started: true };
      });
    },
    async result(tenantId: number, apiKeyId: number, id: number, b: RelayBinding,
      outcome: RelayOutcome, responseJson?: string) {
      const environment = owner(tenantId);
      // Results remain receivable after revocation: record reality and release
      // reservations, but admission/acceptance still independently require opt-in.
      return db.transaction(async tx => {
        await lock(tx, environment);
        const row = await get(tenantId, id, tx);
        if (!binding(row, b, apiKeyId)) throw new RelayConflict("Relay result binding refused");
        const hash = relayHash(JSON.stringify([outcome, responseJson ?? null]));
        if (row.result?.hash) {
          if (row.result.hash === hash) return { accepted: true, duplicate: true,
            task: row.payload.task, usage: row.result.response?.usage };
          // Real saved completion may resolve an explicitly uncertain report.
          if (!(row.status === "relay_uncertain" && outcome === "complete"))
            throw new RelayConflict("Different relay result already saved");
        }
        if (!["relay_running", "relay_uncertain", "relay_claimed"].includes(row.status) ||
            (row.status === "relay_claimed" && outcome === "complete"))
          throw new RelayConflict("Relay result state refused");
        const response = outcome === "complete"
          ? validateRelayCompletion(row.payload.requestJson, responseJson!) : undefined;
        if (row.payload.task === "relay-probe" && response && response.choices[0].message.content.trim() !== "42")
          throw new RelayConflict("Fixed relay probe returned the wrong answer");
        if (responseJson && !opts.screen(responseJson)) throw new RelayConflict("Relay result storage refused");
        const result = { outcome, hash, response, responseHash: responseJson ? relayHash(responseJson) : null,
          transport: "spark-relay", providerIdentityAttested: false, ledgerConfirmed: false,
          provider: "legion-local", model: SPARK_RELAY.model, inferenceCostUsd: 0,
          latencyMs: row.started_at ? Math.max(0, now() - Date.parse(row.started_at)) : null,
          timingBasis: "server_start_to_result",
          completedAt: new Date(now()).toISOString() };
        await tx.execute(sql`UPDATE agent_jobs SET status=${`relay_${outcome}`},result=${JSON.stringify(result)}::jsonb,
          completed_at=NOW() WHERE id=${id} AND tenant_id=${tenantId} AND kind=${RELAY_JOB_KIND}`);
        return { accepted: true, duplicate: false, task: row.payload.task,
          usage: response?.usage };
      });
    },
    async cancel(tenantId: number, id: number) {
      const environment = owner(tenantId);
      await db.transaction(async tx => {
        await lock(tx, environment);
        await tx.execute(sql`UPDATE agent_jobs SET status=CASE WHEN status='relay_running'
          THEN 'relay_uncertain' ELSE 'relay_cancelled' END,completed_at=NOW()
          WHERE id=${id} AND tenant_id=${tenantId} AND kind=${RELAY_JOB_KIND}
            AND payload->>'environment'=${environment} AND status IN ('relay_queued','relay_claimed','relay_running')`);
      });
    },
    async release(tenantId: number, id: number) {
      owner(tenantId);
      const updated = rows(await db.execute(sql`UPDATE agent_jobs SET status='relay_released',
        rollback_note='Owner confirmed old Lenovo inference stopped',completed_at=NOW()
        WHERE id=${id} AND tenant_id=${tenantId} AND kind IN (${RELAY_JOB_KIND},${DIRECT_RESERVATION_KIND})
          AND payload->>'environment'=${env()} AND status='relay_uncertain' RETURNING id`));
      if (!updated.length) throw new RelayConflict("Only uncertain work can be released");
    },
    async accounting(tenantId: number, id: number, confirmed: boolean) {
      owner(tenantId);
      await db.execute(sql`UPDATE agent_jobs SET result=jsonb_set(result,'{ledgerConfirmed}',${JSON.stringify(confirmed)}::jsonb)
        WHERE id=${id} AND tenant_id=${tenantId} AND kind=${RELAY_JOB_KIND}
          AND payload->>'environment'=${env()} AND status='relay_complete'`);
    },
    async status(tenantId: number) {
      const environment = owner(tenantId);
      await expire(db, environment);
      const freshness = await workerFreshness(tenantId);
      const jobs = rows(await db.execute(sql`SELECT id,kind,status,payload,result,created_at FROM agent_jobs
        WHERE tenant_id=${tenantId} AND kind IN (${RELAY_JOB_KIND},${DIRECT_RESERVATION_KIND})
          AND payload->>'environment'=${environment}
        ORDER BY CASE WHEN status='relay_uncertain' THEN 0 ELSE 1 END,id DESC LIMIT 20`));
      return { protocol: SPARK_RELAY.protocol, ...freshness,
        jobs: jobs.map(j => ({ id: j.id, status: relayStatus(j.status), task: j.payload.task,
          requestId: j.payload.requestId, deadlineAt: j.payload.deadlineAt, createdAt: j.created_at,
          transport: j.kind === DIRECT_RESERVATION_KIND ? "direct" : "spark-relay", model: SPARK_RELAY.model,
          provider: "legion-local", inferenceCostUsd: 0,
          latencyMs: j.result?.latencyMs ?? null, timingBasis: j.result?.timingBasis ?? null,
          usage: j.result?.response?.usage ?? null, ledgerConfirmed: j.result?.ledgerConfirmed === true })) };
    },
  };
}
