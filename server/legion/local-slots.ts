import { AsyncLocalStorage } from "node:async_hooks";
import { currentTenantId } from "../lib/tenant-context";
import { legionBackgroundEnabled, legionPool, legionProduction } from "./runtime";
import type { LocalProvider } from "./local-router";
import { DIRECT_RESERVATION_KIND, RELAY_JOB_KIND } from "./spark-relay-contract";
import { randomUUID } from "node:crypto";

export class LocalAdmissionDeferred extends Error {
  constructor(message: string, public generationStarted = false) { super(message); }
}
export type LocalPriority = "daytime" | "overnight";
const priorities = new AsyncLocalStorage<LocalPriority>();
export const currentLocalPriority = () => priorities.getStore() ?? "daytime";
export const withLocalPriority = <T>(priority: LocalPriority, fn: () => T) => priorities.run(priority, fn);
export const localParallelEnabled = () =>
  legionBackgroundEnabled() && process.env.LOCAL_PARALLEL_ENABLED === "1";
export const localSlotKey = (provider: LocalProvider) => provider === "legion-local" ? 1 : 2;
export const localDeviceEnvironmentAllowed = (provider: LocalProvider, env: NodeJS.ProcessEnv = process.env) =>
  provider !== "legion-local" || env.LEGION_SPARK_RELAY_ENABLED !== "1" ||
    env.REPLIT_DEPLOYMENT === "1";

interface Lease {
  signal: AbortSignal; release(): Promise<void>;
  beforeGenerate?(): Promise<void>;
  finishGenerate?(definite: boolean): Promise<void>;
}
interface Dependencies {
  acquire(provider: LocalProvider): Promise<Lease | null>;
}

/** Per-invocation state, never a process-global leaseAbort shared by two jobs. */
export function createLocalSlotRunner(deps: Dependencies) {
  return async <T>(provider: LocalProvider, signal: AbortSignal, generate: (signal: AbortSignal) => Promise<T>) => {
    signal.throwIfAborted();
    let lease: Lease | null;
    try { lease = await deps.acquire(provider); }
    catch { throw new LocalAdmissionDeferred("Local inference admission unavailable"); }
    if (!lease) throw new LocalAdmissionDeferred("Local laptop busy or yielding to daytime work");
    let started = false;
    try {
      const active = AbortSignal.any([signal, lease.signal]);
      active.throwIfAborted();
      const startedAt = Date.now();
      console.log(JSON.stringify({ event: "local_inference_slot", provider, phase: "started",
        priority: currentLocalPriority(), at: startedAt }));
      try {
        await lease.beforeGenerate?.();
        started = true;
        let result: T;
        try { result = await generate(active); }
        catch (error) { await lease.finishGenerate?.(false); throw error; }
        await lease.finishGenerate?.(true);
        active.throwIfAborted();
        return result;
      }
      finally {
        console.log(JSON.stringify({ event: "local_inference_slot", provider, phase: "finished",
          priority: currentLocalPriority(), at: Date.now(), startedAt }));
      }
    } catch (error) {
      if (lease.signal.aborted) throw new LocalAdmissionDeferred("Local inference admission connection lost", started);
      throw error;
    } finally { await lease.release(); }
  };
}

export const withLocalInferenceSlot = createLocalSlotRunner({
  acquire: async provider => {
    if (!legionBackgroundEnabled() || (currentTenantId() !== null && currentTenantId() !== 1)) {
      throw Error("Local slot owner scope refused");
    }
    // The production and development databases cannot share a PostgreSQL lock.
    // Arming Spark reserves physical Lenovo inference for production; set the
    // opt-in in BOTH environments before activation (see the operator runbook).
    if (!localDeviceEnvironmentAllowed(provider))
      throw new LocalAdmissionDeferred("Spark is armed; Lenovo inference is reserved for production");
    const client = await legionPool().connect();
    let acquired = false;
    const abort = new AbortController();
    const lost = () => abort.abort();
    client.on("error", lost);
    const release = async () => {
      try {
        if (acquired) {
          const released = await client.query("SELECT pg_advisory_unlock(872631,$1) AS released", [localSlotKey(provider)]);
          if (released.rows[0]?.released !== true) throw Error("Local slot ownership lost");
        }
        client.release();
      } catch {
        client.release(true);
        console.warn("[local-inference] slot release uncertain; connection discarded");
      } finally { client.removeListener("error", lost); }
    };
    try {
      acquired = (await client.query("SELECT pg_try_advisory_lock(872631,$1) AS acquired",
        [localSlotKey(provider)])).rows[0]?.acquired === true;
      if (!acquired) { await release(); return null; }
      if (provider === "legion-local") {
        // Spark's short start transaction takes this SAME advisory lock before
        // persisting a reservation. This check closes the cross-transport race
        // without retaining a database connection during remote generation.
        const reserved = await client.query(`SELECT id FROM agent_jobs WHERE tenant_id=1
          AND kind IN ($1,$2) AND status IN ('relay_running','relay_uncertain') LIMIT 1`,
        [RELAY_JOB_KIND, DIRECT_RESERVATION_KIND]);
        if (reserved.rows.length) { await release(); return null; }
      }
      if (currentLocalPriority() === "overnight" && localParallelEnabled()) {
        const kind = provider === "legion-local" ? "legion_runbook_compile" : "surface_runbook_rule";
        // Claimed daytime jobs may already be running in the same unordered
        // RETURNING batch. A short capacity cooldown must not let night work
        // jump ahead either, so include pending daytime work not yet due.
        const pending = await client.query(`SELECT 1 FROM agent_jobs WHERE tenant_id=1
          AND kind=$1 AND (status='pending' OR (status='running' AND lease_until>now()))
          AND payload->>'environment'=$2
          AND payload->>'priority'='daytime' LIMIT 1`, [kind, legionProduction() ? "production" : "development"]);
        if (pending.rowCount) { await release(); return null; }
      }
      let reservation: number | undefined;
      const environment = legionProduction() ? "production" : "development";
      return { signal: abort.signal, release,
        beforeGenerate: provider === "legion-local" ? async () => {
          const payload = JSON.stringify({ environment, task: "direct-reservation", requestId: randomUUID(),
            deadlineAt: new Date(Date.now() + 120_000).toISOString() });
          const prior = await client.query(`SELECT id FROM agent_jobs WHERE tenant_id=1 AND kind=$1
            AND payload->>'environment'=$2 ORDER BY id LIMIT 1`, [DIRECT_RESERVATION_KIND, environment]);
          const result = prior.rows[0]
            ? await client.query(`UPDATE agent_jobs SET status='relay_running',payload=$1::jsonb,
                started_at=NOW(),completed_at=NULL WHERE id=$2 AND tenant_id=1 AND kind=$3 RETURNING id`,
              [payload, prior.rows[0].id, DIRECT_RESERVATION_KIND])
            : await client.query(`INSERT INTO agent_jobs (tenant_id,kind,status,payload,max_attempts)
                VALUES (1,$1,'relay_running',$2::jsonb,1) RETURNING id`, [DIRECT_RESERVATION_KIND, payload]);
          reservation = result.rows[0]?.id;
          if (!reservation) throw Error("Direct Lenovo reservation unavailable");
        } : undefined,
        finishGenerate: provider === "legion-local" ? async definite => {
          try {
            await client.query(`UPDATE agent_jobs SET status=$1,completed_at=NOW() WHERE id=$2
              AND tenant_id=1 AND kind=$3 AND payload->>'environment'=$4 AND status='relay_running'`,
            [definite ? "relay_complete" : "relay_uncertain", reservation, DIRECT_RESERVATION_KIND, environment]);
          } catch {
            console.warn("[local-inference] direct Lenovo outcome persistence uncertain; reservation remains blocked");
          }
        } : undefined,
      };
    } catch (error) {
      await release();
      throw error;
    }
  },
});
