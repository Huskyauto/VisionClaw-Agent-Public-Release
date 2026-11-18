import { AsyncLocalStorage } from "node:async_hooks";
import { currentTenantId } from "../lib/tenant-context";
import { legionBackgroundEnabled, legionPool, legionProduction } from "./runtime";
import type { LocalProvider } from "./local-router";

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

interface Lease { signal: AbortSignal; release(): Promise<void> }
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
        started = true;
        const result = await generate(active);
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
      return { signal: abort.signal, release };
    } catch (error) {
      await release();
      throw error;
    }
  },
});
