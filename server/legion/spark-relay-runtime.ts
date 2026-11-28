import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { db } from "../db";
import { sanitizeAgentOutput } from "../safety-layer";
import { currentTenantId } from "../lib/tenant-context";
import { legionBackgroundConfiguration, legionBackgroundEnabled, legionProduction } from "./runtime";
import { LocalAdmissionDeferred, currentLocalPriority } from "./local-slots";
import { createSparkRelayStore, RelayConflict, type RelayDatabase } from "./spark-relay-store";
import { SPARK_RELAY, relayStatus } from "./spark-relay-contract";

export const sparkRelayControlPlane = () =>
  legionBackgroundConfiguration({ ...process.env, LEGION_BACKGROUND_ENABLED: "1" }).enabled;
export const sparkRelayEnabled = () => process.env.APP_ACCESS_MODE === "owner-only" &&
  sparkRelayControlPlane() && process.env.REPLIT_DEPLOYMENT === "1" && legionBackgroundEnabled() &&
  process.env.LEGION_SPARK_RELAY_ENABLED === "1";
export const sparkRelayStore = createSparkRelayStore(db as unknown as RelayDatabase, {
  environment: () => legionProduction() ? "production" : "development",
  enabled: sparkRelayEnabled,
  screen: text => !sanitizeAgentOutput(text).redacted,
});
const workIds = new AsyncLocalStorage<string>();
export const withSparkRelayWork = <T>(workId: string, fn: () => T) => workIds.run(workId, fn);
export const currentSparkRelayWork = () => workIds.getStore();

export async function sparkRelayAvailable() {
  if (!sparkRelayEnabled() || (currentTenantId() !== null && currentTenantId() !== 1)) return false;
  try {
    const status = await sparkRelayStore.status(1);
    return status.worker?.ready === true &&
      !status.jobs.some(j => ["running", "uncertain", "claimed"].includes(j.status));
  } catch { return false; } // Availability only: never represent this as completion.
}
export async function requestSparkRelay(body: Record<string, any>, signal: AbortSignal,
  task: string, workId: string) {
  const assertActive = () => {
    signal.throwIfAborted();
    if (!sparkRelayEnabled() || (currentTenantId() !== null && currentTenantId() !== 1))
      throw new LocalAdmissionDeferred("Spark relay permission revoked", true);
  };
  assertActive();
  let job: any;
  try { job = await sparkRelayStore.enqueue(1, body, task, workId, currentLocalPriority()); }
  catch (error) {
    if (error instanceof RelayConflict) throw new LocalAdmissionDeferred(error.message);
    throw new LocalAdmissionDeferred("Spark relay enqueue outcome uncertain", true);
  }
  try {
    for (;;) {
      assertActive();
      const row = await sparkRelayStore.get(1, job.id);
      if (!row) throw new LocalAdmissionDeferred("Spark relay evidence unavailable", true);
      const state = relayStatus(row.status);
      // An expired/retried parent cannot silently purchase fresh work.
      if (Date.parse(row.payload.deadlineAt) <= Date.now()) {
        await sparkRelayStore.status(1); // Persist the correct expired state.
        throw new LocalAdmissionDeferred("Spark relay deadline; outcome requires inspection",
          !["queued", "claimed", "failed_before_send", "cancelled"].includes(state));
      }
      if (state === "complete") {
        assertActive();
        if (!row.result?.response) throw new LocalAdmissionDeferred("Spark relay result unavailable", true);
        return { response: row.result.response, relayJobId: row.id };
      }
      if (["uncertain", "released"].includes(state))
        throw new LocalAdmissionDeferred("Spark relay generation outcome uncertain; no automatic retry", true);
      if (["failed_before_send", "cancelled"].includes(state))
        throw new LocalAdmissionDeferred("Spark relay ended before inference");
      await delay(1500, undefined, { signal });
    }
  } catch (error) {
    // Persist interruption before releasing the parent; a running reservation
    // remains uncertain even if cancellation/revocation killed the waiter.
    try { await sparkRelayStore.cancel(1, job.id); }
    catch { console.warn("[spark-relay] interrupted request persistence uncertain; do not repeat generation"); }
    if (error instanceof LocalAdmissionDeferred || signal.aborted) throw error;
    throw new LocalAdmissionDeferred("Spark relay persistence outcome uncertain", true);
  }
}
