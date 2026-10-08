import { createForgettingCoordinator } from "./forgetting-coordinator";
import { createForgettingStore } from "./forgetting-store";
import { MEMORY_LIFECYCLE_SOURCES } from "./forgetting-policy";

const TENANT_BATCH = 20;
const ITEM_BATCH = 100;
const SCHEDULER_LEASE_MS = 10 * 60 * 1000;

export async function runScheduledMemoryForgetting(): Promise<{
  tenants: number;
  candidates: number;
  archived: number;
  purged: number;
  failed: number;
  mode: "report" | "mutate";
}> {
  const mutationEnabled = process.env.MEMORY_FORGETTING_ENABLED === "1";
  const store = createForgettingStore();
  const totals = {
    tenants: 0,
    candidates: 0,
    archived: 0,
    purged: 0,
    failed: 0,
    mode: mutationEnabled ? "mutate" as const : "report" as const,
  };
  let mutatedTenant = false;

  // Reconcile a bounded number of abandoned durable erasure requests before
  // scanning lifecycle candidates.  This is deliberately scheduler-owned:
  // no request can cause another request to be resumed synchronously.
  if (store.listStaleErasureRequests) {
    const stale = await store.listStaleErasureRequests({ limit: TENANT_BATCH, staleMs: SCHEDULER_LEASE_MS });
    for (const request of stale) {
      try {
        const policy = await store.loadActivePolicy?.(request.tenantId);
        const reconciler = createForgettingCoordinator({
          store,
          policy: policy ?? undefined,
          env: { MEMORY_FORGETTING_ENABLED: process.env.MEMORY_FORGETTING_ENABLED },
          tombstoneKey: process.env.MEMORY_TOMBSTONE_HMAC_KEY,
          authorize: ({ operation, tenantId }) =>
            operation === "erase" && tenantId === request.tenantId,
        });
        await reconciler.reconcileStaleErasureRequests({
          limit: 1,
          staleMs: SCHEDULER_LEASE_MS,
          requests: [request],
        });
      } catch (error) {
        totals.failed++;
        console.error("[memory-forgetting] stale request reconciliation failed", {
          tenantId: request.tenantId,
          requestKey: request.requestKey,
          error: error instanceof Error ? error.message : "unknown",
        });
        // Candidate processing below remains available if one durable request
        // has malformed metadata or a transient tenant-scoped failure.
      }
    }
  }

  // Claim one tenant at a time.  The store performs tenant selection and
  // lease installation in one transaction, so concurrent scheduler processes
  // cannot receive the same tenant.
  for (let claimed = 0; claimed < TENANT_BATCH; claimed++) {
    const lease = await store.claimSchedulerTenant({ leaseMs: SCHEDULER_LEASE_MS });
    if (!lease) break;
    const offset = lease.sourceOffset % MEMORY_LIFECYCLE_SOURCES.length;
    const sources = [
      ...MEMORY_LIFECYCLE_SOURCES.slice(offset),
      ...MEMORY_LIFECYCLE_SOURCES.slice(0, offset),
    ];
    // Policies are tenant-owned.  In particular, report_only must win over
    // the process-wide mutation switch.
    const tenantPolicy = await store.loadActivePolicy?.(lease.tenantId);
    const tenantMutationEnabled = mutationEnabled && tenantPolicy?.mode !== "report_only";
    if (tenantMutationEnabled) {
      mutatedTenant = true;
      totals.mode = "mutate";
    } else if (!mutatedTenant) {
      totals.mode = "report";
    }
    const coordinator = createForgettingCoordinator({
      store,
      policy: tenantPolicy ?? undefined,
      env: { MEMORY_FORGETTING_ENABLED: process.env.MEMORY_FORGETTING_ENABLED },
      tombstoneKey: process.env.MEMORY_TOMBSTONE_HMAC_KEY,
      authorize: ({ tenantId }) => tenantId === lease.tenantId,
    });
    try {
      const report = await coordinator.run({
        tenantId: lease.tenantId,
        mode: tenantMutationEnabled ? "mutate" : "report",
        batchSize: ITEM_BATCH,
        sources,
        cursors: lease.sourceCursors,
      });
      const completed = await store.completeSchedulerTenant({
        tenantId: lease.tenantId,
        leaseToken: lease.leaseToken,
        sourceCursors: { ...lease.sourceCursors, ...report.nextCursors },
        sourceOffset: (offset + 1) % MEMORY_LIFECYCLE_SOURCES.length,
      });
      // A false completion means this worker lost its lease.  The report is
      // still useful operationally, but its cursor must not overwrite a newer
      // worker's progress.
      if (!completed) {
        totals.failed++;
        console.warn("[memory-forgetting] scheduler lease completion rejected", {
          tenantId: lease.tenantId,
        });
      }
      totals.tenants++;
      totals.candidates += report.metrics.candidates;
      totals.archived += report.metrics.archived;
      totals.purged += report.metrics.purged;
      totals.failed += report.metrics.failed;
    } catch (error) {
      // Leave the lease to expire rather than releasing another worker's
      // lease.  No memory-row bookkeeping is written on a failed run.
      totals.tenants++;
      totals.failed++;
      console.error("[memory-forgetting] tenant lifecycle scan failed", {
        tenantId: lease.tenantId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return totals;
}