import { sql } from "drizzle-orm";

export type AuditStateField = "auditCheckpoint" | "auditReport" | "auditPrecision" | "auditHandoff" | "auditProviderHealth" | "auditPaidAttempts";
export interface AuditJobIdentity { id: number; attempt: number }
export class TenantAuditStop extends Error {}
export class TenantAuditLeaseLost extends TenantAuditStop {}
type AuditExecute = (query: any) => Promise<any>;
type AuditTransaction = (work: (execute: AuditExecute) => Promise<boolean>) => Promise<boolean>;

/** One model-dispatch batch per UTC day, across old/new campaign rows.
 * Reserve before spawning: a crash consumes today's batch, never buys a retry.
 * The lock and the following read must be separate statements in one transaction
 * so a waiting replica reads the committed reservation, not an old snapshot.
 */
export async function claimAuditDailyBatch(identity: AuditJobIdentity,
  transaction?: AuditTransaction): Promise<boolean> {
  if (![identity.id, identity.attempt].every(n => Number.isSafeInteger(n) && n > 0))
    throw new TenantAuditStop("Invalid daily audit authority");
  const transact: AuditTransaction = transaction ?? (async work => {
    const { db } = await import("../db");
    return db.transaction(tx => work(query => tx.execute(query)));
  });
  return transact(async execute => {
    await execute(sql`SELECT pg_advisory_xact_lock(hashtext('tenant-audit-daily-batch:1'))`);
    const prior = await execute(sql`SELECT id FROM agent_jobs
      WHERE tenant_id=1 AND kind='tenant_isolation_audit'
      AND payload->>'auditBatchDay'=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') LIMIT 1`);
    const consumed = (prior.rows ?? prior).length > 0;
    const result = consumed
      ? await execute(sql`UPDATE agent_jobs SET status='pending',
          next_run_at=(date_trunc('day',now() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC',
          lease_until=NULL,error=NULL
          WHERE id=${identity.id} AND tenant_id=1 AND kind='tenant_isolation_audit'
          AND status='running' AND attempts=${identity.attempt} AND lease_until > now() RETURNING id`)
      : await execute(sql`UPDATE agent_jobs SET payload=jsonb_set(jsonb_set(payload,
          '{auditBatchDay}',to_jsonb(to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'))),
          '{auditSlices}',to_jsonb(COALESCE((payload->>'auditSlices')::int,0)+1))
          WHERE id=${identity.id} AND tenant_id=1 AND kind='tenant_isolation_audit'
          AND status='running' AND attempts=${identity.attempt} AND lease_until > now() RETURNING id`);
    if ((result.rows ?? result).length !== 1) throw new TenantAuditLeaseLost("Daily audit admission fenced");
    return !consumed;
  });
}
/** The handler already performed its fenced running → pending transition.
 * Completing that old claim would manufacture a lease-loss warning. */
export function isTenantAuditContinuation(kind: string, result: unknown): boolean {
  if (kind !== "tenant_isolation_audit" || !result || typeof result !== "object") return false;
  const outcome = result as { continued?: unknown; status?: unknown };
  return outcome.continued === true &&
    (outcome.status === "incomplete" || outcome.status === "provider_backoff" || outcome.status === "daily_batch_wait");
}
export function auditJobIdentity(env: NodeJS.ProcessEnv = process.env): AuditJobIdentity | null {
  if (env.TENANT_AUDIT_JOB_ID === undefined && env.TENANT_AUDIT_JOB_ATTEMPT === undefined) return null;
  const id = Number(env.TENANT_AUDIT_JOB_ID), attempt = Number(env.TENANT_AUDIT_JOB_ATTEMPT);
  if (![id, attempt].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error("Invalid tenant audit job authority");
  return { id, attempt };
}
// A scheduled child has no authority to write arbitrary job kinds/tenants, nor
// to continue spending after its claim was cancelled, reclaimed or expired.
export async function auditJobState(field?: AuditStateField, value?: unknown,
  identity = auditJobIdentity(), execute?: (query: any) => Promise<any>): Promise<any> {
  if (!identity) return undefined;
  if (![identity.id, identity.attempt].every(n => Number.isSafeInteger(n) && n > 0))
    throw new Error("Invalid tenant audit job authority");
  if (field && !["auditCheckpoint", "auditReport", "auditPrecision", "auditHandoff", "auditProviderHealth", "auditPaidAttempts"].includes(field))
    throw new Error("Invalid tenant audit state field");
  const serialized = value === undefined ? undefined : JSON.stringify(value);
  if (value !== undefined && (!field || Buffer.byteLength(serialized!, "utf8") > 8 * 1024 * 1024))
    throw new Error("Tenant audit durable state outside bounds");
  const fieldValue = field === "auditPaidAttempts"
    ? sql`COALESCE(payload->'auditPaidAttempts','{}'::jsonb) || ${serialized}::jsonb`
    : sql`${serialized}::jsonb`;
  const run = execute ?? (async query => (await import("../db")).db.execute(query));
  const result: any = value === undefined
    ? await run(sql`SELECT payload FROM agent_jobs WHERE id=${identity.id} AND tenant_id=1
        AND kind='tenant_isolation_audit' AND status='running' AND attempts=${identity.attempt}
        AND lease_until > now()`)
    : await run(sql`UPDATE agent_jobs SET payload=jsonb_set(
        jsonb_set(payload, ARRAY[${field!}]::text[], ${fieldValue}),
        '{auditProgressAt}', to_jsonb(now()::text))
        WHERE id=${identity.id} AND tenant_id=1 AND kind='tenant_isolation_audit'
        AND status='running' AND attempts=${identity.attempt} AND lease_until > now()
        RETURNING payload`);
  const records = result.rows ?? result;
  if (records.length !== 1) throw new TenantAuditLeaseLost("Tenant audit job lease lost; stopping");
  return field ? records[0].payload[field] : records[0].payload;
}

/** Attempt numbers stay monotonic after REAL work: decrementing here creates
 * an ABA window where an old worker can complete the next claim. */
export async function continueAuditJob(identity: AuditJobIdentity,
  execute?: (query: any) => Promise<any>): Promise<void> {
  const run = execute ?? (async query => (await import("../db")).db.execute(query));
  const result: any = await run(sql`UPDATE agent_jobs SET status='pending',
    payload=jsonb_set(jsonb_set(payload,'{auditOutages}','0'::jsonb),'{auditDeadlineStalls}','0'::jsonb),
    next_run_at=(date_trunc('day',now() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC',
    lease_until=NULL, error=NULL
    WHERE id=${identity.id} AND tenant_id=1 AND kind='tenant_isolation_audit'
    AND status='running' AND attempts=${identity.attempt} AND lease_until > now() RETURNING id`);
  if ((result.rows ?? result).length !== 1) throw new Error("Tenant audit continuation fenced");
}

/** Scheduling hangs are distinct from provider outages and real progress.
 * Never refund a real attempt or promptly loop thousands of hung children.
 */
export async function deferAuditDeadline(identity: AuditJobIdentity, previousStalls: number,
  execute?: (query: any) => Promise<any>): Promise<void> {
  if (!Number.isSafeInteger(previousStalls) || previousStalls < 0)
    throw new TenantAuditStop("Invalid audit deadline stall state");
  if (previousStalls >= 2) throw new TenantAuditStop("Tenant audit stopped after three deadlines without completed work");
  const run = execute ?? (async query => (await import("../db")).db.execute(query));
  const result: any = await run(sql`UPDATE agent_jobs SET status='pending',
    payload=jsonb_set(payload,'{auditDeadlineStalls}',to_jsonb(${previousStalls + 1}::int)),
    next_run_at=now()+make_interval(secs => ${300 * 2 ** previousStalls}),
    lease_until=NULL,error='Audit scheduling deadline without completed work; coverage incomplete'
    WHERE id=${identity.id} AND tenant_id=1 AND kind='tenant_isolation_audit'
    AND status='running' AND attempts=${identity.attempt} AND lease_until > now() RETURNING id`);
  if ((result.rows ?? result).length !== 1) throw new TenantAuditLeaseLost("Tenant audit deadline deferral fenced");
}

export async function deferAuditCapacity(identity: AuditJobIdentity,
  execute?: (query: any) => Promise<any>): Promise<void> {
  const run = execute ?? (async query => (await import("../db")).db.execute(query));
  const result: any = await run(sql`UPDATE agent_jobs SET status='pending',
    attempts=GREATEST(attempts-1,0), next_run_at=now()+interval '2 minutes', lease_until=NULL
    WHERE id=${identity.id} AND tenant_id=1 AND kind='tenant_isolation_audit'
    AND status='running' AND attempts=${identity.attempt} AND lease_until > now() RETURNING id`);
  if ((result.rows ?? result).length !== 1) throw new Error("Tenant audit capacity deferral fenced");
}

export async function recordAuditFailure(identity: AuditJobIdentity,
  execute?: (query: any) => Promise<any>): Promise<void> {
  const run = execute ?? (async query => (await import("../db")).db.execute(query));
  const result: any = await run(sql`UPDATE agent_jobs SET payload=jsonb_set(payload,
    '{auditFailures}',to_jsonb(COALESCE((payload->>'auditFailures')::int,0)+1))
    WHERE id=${identity.id} AND tenant_id=1 AND kind='tenant_isolation_audit'
    AND status='running' AND attempts=${identity.attempt} AND lease_until > now()
    RETURNING payload->>'auditFailures' AS failures`);
  const records = result.rows ?? result;
  if (records.length !== 1) throw new Error("Tenant audit failure receipt fenced");
  if (Number(records[0].failures) >= 3) throw new TenantAuditStop("Tenant audit stopped after three failures; retained coverage is incomplete");
}

/** Real attempts remain monotonic. Provider outages are not terminal code failures. */
export async function backoffAuditJob(identity: AuditJobIdentity,
  execute?: (query: any) => Promise<any>, completedWork = false): Promise<void> {
  const run = execute ?? (async query => (await import("../db")).db.execute(query));
  const result: any = await run(sql`UPDATE agent_jobs SET status='pending',
    payload=jsonb_set(jsonb_set(payload,'{auditOutages}',to_jsonb(CASE WHEN ${completedWork}
      THEN 0 ELSE LEAST(12,COALESCE((payload->>'auditOutages')::int,0)+1) END)),
      '{auditDeadlineStalls}',CASE WHEN ${completedWork} THEN '0'::jsonb
        ELSE COALESCE(payload->'auditDeadlineStalls','0'::jsonb) END),
    next_run_at=now()+make_interval(secs => CASE WHEN ${completedWork} THEN 300
      ELSE LEAST(3600,300*power(2,LEAST(4,COALESCE((payload->>'auditOutages')::int,0))))::int END),
    lease_until=NULL,error='Audit provider recovery pending; coverage incomplete'
    WHERE id=${identity.id} AND tenant_id=1 AND kind='tenant_isolation_audit'
    AND status='running' AND attempts=${identity.attempt} AND lease_until > now() RETURNING id`);
  if ((result.rows ?? result).length !== 1) throw new TenantAuditLeaseLost("Tenant audit recovery fenced");
}
