/**
 * Unified-memory lifecycle coordinator (S1/S3).
 *
 * This module intentionally has no database import.  The production adapter is
 * supplied by the parent integration and the small boundary below is also
 * useful for seam tests.  Retention decisions remain deterministic and are
 * delegated to forgetting-policy.ts; this coordinator only authorizes, bounds,
 * claims, and applies those decisions.
 */

import { createHmac, randomUUID } from "node:crypto";
import {
  classifyMemorySource,
  decideMemoryLifecycleAction,
  defaultMemoryRetentionPolicy,
  MEMORY_LIFECYCLE_SOURCES,
  type MemoryLifecycleCandidate,
  type MemoryLifecycleCandidatePage,
  type MemoryLifecycleSource,
  type MemoryForgettingCursorMap,
  type MemoryRetentionPolicy,
} from "./forgetting-policy";

export const DEFAULT_FORGETTING_BATCH_SIZE = 100;
export const MAX_FORGETTING_BATCH_SIZE = 500;

export type ForgettingOperation = "report" | "mutate" | "erase";

export interface ForgettingAction {
  tenantId: number;
  source: MemoryLifecycleSource;
  sourceId: string;
  policyVersion: number;
  action: "archive" | "purge" | "erase";
  actionKey: string;
  reasonCode?: string;
  claimToken?: string;
}

export type ActiveRetentionPolicy = MemoryRetentionPolicy & {
  mode?: "report_only" | "mutate";
};

export interface ForgettingAuditRecord {
  tenantId: number;
  actionKey: string;
  action: ForgettingAction["action"];
  source: MemoryLifecycleSource;
  sourceId: string;
  reasonCode: string;
  policyVersion: number;
  requestKey?: string;
}

export interface ForgettingTombstone {
  tenantId: number;
  source: MemoryLifecycleSource;
  sourceId: string;
  /** A keyed digest; source values and content are never stored here. */
  valueDigest: string;
  requestKey: string;
}

export interface ForgettingDeleteRequest {
  tenantId: number;
  source: MemoryLifecycleSource;
  sourceId: string;
  requestKey: string;
}

export interface ForgettingTransaction {
  assertClaim?(action: ForgettingAction): Promise<void>;
  completeAction?(action: ForgettingAction): Promise<void>;
  /**
   * Production adapters should implement this so archive plus its audit row
   * commit together. The optional shape keeps a simple seam adapter possible;
   * the coordinator still records the audit in the same transaction callback.
   */
  archiveCandidate?(input: {
    tenantId: number;
    source: MemoryLifecycleSource;
    sourceId: string;
    actionKey: string;
  }): Promise<void>;
  /**
   * Must insert the tombstone before returning.  A uniqueness conflict is an
   * idempotent success, not permission to delete a different tenant's row.
   */
  createTombstone(tombstone: ForgettingTombstone): Promise<boolean | void>;
  /** Audit rows contain only identifiers/reason codes, never memory values. */
  recordAudit(audit: ForgettingAuditRecord): Promise<void>;
  /** The adapter must include tenant_id in its delete predicate. */
  deleteCandidate(request: ForgettingDeleteRequest): Promise<number>;
}

export interface ForgettingStore {
  /** Atomically claims one eligible tenant for a scheduler worker. */
  claimSchedulerTenant?(input: { leaseMs: number }): Promise<{
    tenantId: number;
    leaseToken: string;
    sourceCursors: MemoryForgettingCursorMap;
    sourceOffset: number;
  } | null>;
  /** Advances operational state only when this worker still owns the lease. */
  completeSchedulerTenant?(input: {
    tenantId: number;
    leaseToken: string;
    sourceCursors: MemoryForgettingCursorMap;
    sourceOffset: number;
  }): Promise<boolean>;
  /**
   * Return the active, tenant-owned retention policy.  Adapters must reject
   * malformed active rows rather than silently falling back to defaults.
   * An absent policy may return null (the coordinator's safe built-in policy
   * remains useful for tenants that have not configured one yet).
   */
  loadActivePolicy?(tenantId: number): Promise<ActiveRetentionPolicy | null>;

  listStaleErasureRequests?(input: {
    limit: number;
    staleMs: number;
  }): Promise<Array<{
    tenantId: number;
    requestKey: string;
    policyVersion: number;
    reason?: string;
    requestedItems: ExplicitEraseItem[];
  }>>;
  getErasureProgress?(input: {
    tenantId: number;
    requestKey: string;
    policyVersion: number;
    requestedItems: readonly ExplicitEraseItem[];
  }): Promise<{ completedClaims: Set<string>; tombstones: Set<string> }>;

  /**
   * Explicit erasure is a durable request, not just a synchronous operation.
   * The store owns the unique (tenant, requestKey) boundary and compares the
   * complete request identity before allowing a retry.
   */
  beginErasureRequest?(input: {
    tenantId: number;
    requestKey: string;
    mode: "explicit" | "compliance" | "offboarding";
    reason?: string;
    requestedItems: readonly ExplicitEraseItem[];
    actorId: number;
  }): Promise<{
    execute: boolean;
    status: string;
    erasedCount: number;
    policyVersion: number;
    error?: string | null;
  }>;
  completeErasureRequest?(input: {
    tenantId: number;
    requestKey: string;
    status: "completed" | "failed";
    erasedCount: number;
    error?: string | null;
  }): Promise<void>;

  /**
   * The adapter must apply tenant scoping itself (and, where available, RLS)
   * rather than relying on the coordinator's caller to filter rows.
   */
  listCandidates(input: {
    tenantId: number;
    sources: readonly MemoryLifecycleSource[];
    limit: number;
    cursors?: MemoryForgettingCursorMap;
  }): Promise<MemoryLifecycleCandidatePage>;

  /** Durable unique claim. false means this action was already completed. */
  claimAction(action: ForgettingAction): Promise<boolean>;
  markActionCompleted?(action: ForgettingAction): Promise<boolean>;
  markActionFailed?(action: ForgettingAction, failureCode: string): Promise<boolean>;

  archiveCandidate(input: {
    tenantId: number;
    source: MemoryLifecycleSource;
    sourceId: string;
    actionKey: string;
  }): Promise<void>;

  /**
   * Optional because some adapters return an authoritative archived status in
   * listCandidates.  If implemented, a false result always blocks purging.
   */
  isArchived?(input: {
    tenantId: number;
    source: MemoryLifecycleSource;
    sourceId: string;
  }): Promise<boolean>;

  /** Tombstone, audit, and delete must share one database transaction. */
  withTransaction<T>(fn: (tx: ForgettingTransaction) => Promise<T>): Promise<T>;
}

export type ForgettingAuthorizer = (input: {
  operation: ForgettingOperation;
  tenantId: number;
  source?: MemoryLifecycleSource;
}) => boolean | Promise<boolean>;

export interface ForgettingMetrics {
  candidates: number;
  archived: number;
  expired: number;
  purged: number;
  erased: number;
  skipped: number;
  failed: number;
  resurrectionBlocked: number;
  idempotent: number;
}

export interface ForgettingReport {
  tenantId: number;
  mode: "report" | "mutate";
  mutationEnabled: boolean;
  candidates: number;
  actions: ForgettingAction[];
  skipped: Array<{ source: MemoryLifecycleSource; sourceId?: string; reasonCode: string }>;
  errors: string[];
  metrics: ForgettingMetrics;
  /** Operational cursor state to persist after this bounded read. */
  nextCursors: MemoryForgettingCursorMap;
}

export interface ForgettingRunRequest {
  tenantId: number;
  /** report is always available; mutate is never enabled by any other value. */
  mode?: "report" | "mutate";
  sources?: readonly MemoryLifecycleSource[];
  batchSize?: number;
  /** Source-local numeric keyset cursors from the previous scheduler slice. */
  cursors?: MemoryForgettingCursorMap;
}

export interface ExplicitEraseItem {
  source: MemoryLifecycleSource;
  sourceId: string | number;
}

export interface ExplicitEraseRequest {
  tenantId: number;
  requestKey: string;
  items: readonly ExplicitEraseItem[];
  reason?: string;
  /** Server-owned immutable version persisted with the durable request. */
  policyVersion?: number;
}

export interface ExplicitEraseResult {
  tenantId: number;
  requestKey: string;
  erased: number;
  idempotent: number;
  skipped: number;
  errors: string[];
  metrics: ForgettingMetrics;
}

export interface ErasureReconciliationResult {
  requests: number;
  finalized: number;
  retried: number;
  failed: number;
}

export interface ForgettingCoordinatorDependencies {
  store: ForgettingStore;
  policy?: MemoryRetentionPolicy;
  now?: () => number;
  env?: { MEMORY_FORGETTING_ENABLED?: string };
  authorize?: ForgettingAuthorizer;
  /** Required for explicit erasure, and never read from the memory row. */
  tombstoneKey?: string | Buffer;
  metrics?: Partial<ForgettingMetricSink>;
}

export interface ForgettingMetricSink {
  increment(name: keyof ForgettingMetrics, value?: number): void;
}

function emptyMetrics(): ForgettingMetrics {
  return {
    candidates: 0,
    archived: 0,
    expired: 0,
    purged: 0,
    erased: 0,
    skipped: 0,
    failed: 0,
    resurrectionBlocked: 0,
    idempotent: 0,
  };
}

function validTenant(tenantId: unknown): tenantId is number {
  return typeof tenantId === "number" && Number.isInteger(tenantId) && tenantId > 0;
}

function sourceIsValid(source: string): source is MemoryLifecycleSource {
  return (MEMORY_LIFECYCLE_SOURCES as readonly string[]).includes(source);
}

function boundedBatch(batchSize: number | undefined): number {
  if (batchSize === undefined) return DEFAULT_FORGETTING_BATCH_SIZE;
  if (!Number.isFinite(batchSize) || !Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("forgetting coordinator: invalid batchSize");
  }
  return Math.min(batchSize, MAX_FORGETTING_BATCH_SIZE);
}

function sourceId(candidate: MemoryLifecycleCandidate): string {
  if (candidate.id === undefined || candidate.id === null || String(candidate.id).length === 0) {
    throw new Error("candidate is missing source id");
  }
  return String(candidate.id);
}

function actionKey(
  tenantId: number,
  source: MemoryLifecycleSource,
  id: string,
  policyVersion: number,
  action: ForgettingAction["action"],
): string {
  return `${tenantId}:${source}:${id}:${policyVersion}:${action}`;
}

function addMetric(
  metrics: ForgettingMetrics,
  sink: Partial<ForgettingMetricSink> | undefined,
  name: keyof ForgettingMetrics,
  value = 1,
): void {
  metrics[name] += value;
  sink?.increment?.(name, value);
}

function noContentDigest(
  key: string | Buffer,
  input: { tenantId: number; source: MemoryLifecycleSource; sourceId: string; requestKey: string },
): string {
  return createHmac("sha256", key)
    .update(`${input.tenantId}\0${input.source}\0${input.sourceId}\0${input.requestKey}`, "utf8")
    .digest("hex");
}

export function createForgettingCoordinator(deps: ForgettingCoordinatorDependencies) {
  const policy: ActiveRetentionPolicy = deps.policy ?? defaultMemoryRetentionPolicy;
  const now = deps.now ?? (() => Date.now());

  async function authorize(
    operation: ForgettingOperation,
    tenantId: number,
    source?: MemoryLifecycleSource,
  ): Promise<void> {
    if (!deps.authorize) throw new Error("forgetting coordinator: authorization required");
    if (!(await deps.authorize({ operation, tenantId, source }))) {
      throw new Error("forgetting coordinator: authorization denied");
    }
  }

  async function report(request: ForgettingRunRequest): Promise<ForgettingReport> {
    if (!validTenant(request.tenantId)) {
      throw new Error("forgetting coordinator: invalid tenantId");
    }
    await authorize("report", request.tenantId);
    const sources = request.sources?.length ? [...request.sources] : [...MEMORY_LIFECYCLE_SOURCES];
    for (const source of sources) {
      if (!sourceIsValid(source)) throw new Error(`forgetting coordinator: invalid source ${source}`);
    }
    const limit = boundedBatch(request.batchSize);
    const listed = await deps.store.listCandidates({
      tenantId: request.tenantId,
      sources,
      limit,
      cursors: request.cursors,
    });
    const rows = listed.slice(0, limit);
    const metrics = emptyMetrics();
    addMetric(metrics, deps.metrics, "candidates", rows.length);
    const actions: ForgettingAction[] = [];
    const skipped: ForgettingReport["skipped"] = [];
    const errors: string[] = [];

    for (const candidate of rows) {
      const id = candidate.id === undefined ? undefined : String(candidate.id);
      if (candidate.tenantId !== undefined && candidate.tenantId !== request.tenantId) {
        addMetric(metrics, deps.metrics, "failed");
        errors.push("candidate tenant scope mismatch");
        continue;
      }
      if (!sourceIsValid(candidate.source) || !sources.includes(candidate.source)) {
        addMetric(metrics, deps.metrics, "failed");
        errors.push("candidate source scope mismatch");
        continue;
      }
      try {
        const decision = decideMemoryLifecycleAction(candidate, policy, now());
        if (decision.action === "keep") {
          addMetric(metrics, deps.metrics, "skipped");
          if (classifyMemorySource(candidate.source).kind === "protected_evidence") {
            skipped.push({ source: candidate.source, sourceId: id, reasonCode: "protected_evidence" });
          } else {
            skipped.push({ source: candidate.source, sourceId: id, reasonCode: decision.reasonCode });
          }
          continue;
        }
        if (!id) throw new Error("candidate is missing source id");
        const key = actionKey(request.tenantId, candidate.source, id, policy.version, decision.action);
        actions.push({
          tenantId: request.tenantId,
          source: candidate.source,
          sourceId: id,
          policyVersion: policy.version,
          action: decision.action,
          actionKey: key,
          reasonCode: decision.reasonCode,
        });
        if (decision.reasonCode === "explicit_expiry") addMetric(metrics, deps.metrics, "expired");
      } catch (error) {
        addMetric(metrics, deps.metrics, "failed");
        errors.push(error instanceof Error ? error.message : "candidate evaluation failed");
      }
    }
    return {
      tenantId: request.tenantId,
      mode: "report",
      mutationEnabled: false,
      candidates: rows.length,
      actions,
      skipped,
      errors,
      metrics,
      nextCursors: listed.nextCursors ?? {},
    };
  }

  async function run(request: ForgettingRunRequest): Promise<ForgettingReport> {
    const requestedMode = request.mode ?? "report";
    if (requestedMode === "report") return report({ ...request, mode: "report" });
    if (requestedMode !== "mutate") throw new Error("forgetting coordinator: invalid mode");
    const mutationEnabled = (deps.env?.MEMORY_FORGETTING_ENABLED ??
      process.env.MEMORY_FORGETTING_ENABLED) === "1";
    // The tenant's active policy is authoritative over the process-wide
    // switch.  A report-only tenant must never mutate when the global switch
    // is enabled.
    if (!mutationEnabled || policy.mode === "report_only") {
      const disabled = await report({ ...request, mode: "report" });
      return { ...disabled, mode: "mutate", mutationEnabled: false };
    }
    await authorize("mutate", request.tenantId);
    const planned = await report({ ...request, mode: "report" });
    const metrics = planned.metrics;
    const errors = [...planned.errors];
    const skipped = [...planned.skipped];
    for (const action of planned.actions) {
      action.claimToken = randomUUID();
      try {
        if (action.action === "purge") {
          const archived = deps.store.isArchived
            ? await deps.store.isArchived({
              tenantId: action.tenantId,
              source: action.source,
              sourceId: action.sourceId,
            })
            : true;
          if (!archived) {
            addMetric(metrics, deps.metrics, "resurrectionBlocked");
            skipped.push({ source: action.source, sourceId: action.sourceId, reasonCode: "not_archived" });
            continue;
          }
        }
        if (!(await deps.store.claimAction(action))) {
          addMetric(metrics, deps.metrics, "idempotent");
          continue;
        }
        if (action.action === "archive") {
          await deps.store.withTransaction(async (tx) => {
            await tx.assertClaim?.(action);
            if (tx.archiveCandidate) {
              await tx.archiveCandidate(action);
            } else {
              await deps.store.archiveCandidate(action);
            }
            await tx.recordAudit({
              tenantId: action.tenantId,
              actionKey: action.actionKey,
              action: "archive",
              source: action.source,
              sourceId: action.sourceId,
              reasonCode: action.reasonCode ?? "retention_age",
              policyVersion: action.policyVersion,
            });
            await tx.completeAction?.(action);
          });
          addMetric(metrics, deps.metrics, "archived");
        } else {
          await deps.store.withTransaction(async (tx) => {
            await tx.assertClaim?.(action);
            await tx.recordAudit({
              tenantId: action.tenantId,
              actionKey: action.actionKey,
              action: "purge",
              source: action.source,
              sourceId: action.sourceId,
              reasonCode: "archived_retention_age",
              policyVersion: action.policyVersion,
            });
            const deleted = await tx.deleteCandidate({
              tenantId: action.tenantId,
              source: action.source,
              sourceId: action.sourceId,
              requestKey: action.actionKey,
            });
            if (deleted !== 1) throw new Error("forgetting coordinator: purge target missing");
            await tx.completeAction?.(action);
          });
          addMetric(metrics, deps.metrics, "purged");
        }
        if (!action.claimToken) await deps.store.markActionCompleted?.(action);
      } catch (error) {
        await deps.store.markActionFailed?.(action, "lifecycle_action_failed").catch(() => false);
        addMetric(metrics, deps.metrics, "failed");
        errors.push(error instanceof Error ? error.message : "lifecycle action failed");
      }
    }
    return {
      ...planned,
      actions: planned.actions.map(({ claimToken: _claimToken, ...action }) => action),
      mode: "mutate",
      mutationEnabled: true,
      metrics,
      errors,
      skipped,
    };
  }

  async function explicitErase(request: ExplicitEraseRequest): Promise<ExplicitEraseResult> {
    if (!validTenant(request.tenantId)) {
      throw new Error("forgetting coordinator: invalid tenantId");
    }
    if (!request.requestKey || request.requestKey.trim().length === 0) {
      throw new Error("forgetting coordinator: requestKey required");
    }
    const mutationEnabled = (deps.env?.MEMORY_FORGETTING_ENABLED ??
      process.env.MEMORY_FORGETTING_ENABLED) === "1";
    if (!mutationEnabled) {
      throw new Error("forgetting coordinator: mutation disabled");
    }
    if (!deps.tombstoneKey) throw new Error("forgetting coordinator: tombstone key required");
    const erasePolicyVersion = request.policyVersion ?? policy.version;
    if (!Number.isInteger(erasePolicyVersion) || erasePolicyVersion < 1) {
      throw new Error("forgetting coordinator: invalid erase policy version");
    }
    await authorize("erase", request.tenantId);
    if (request.items.length > MAX_FORGETTING_BATCH_SIZE) {
      throw new Error("forgetting coordinator: erase batch exceeds maximum");
    }
    const metrics = emptyMetrics();
    const errors: string[] = [];
    let erased = 0;
    let idempotent = 0;
    let skipped = 0;
    const seen = new Set<string>();
    for (const item of request.items) {
      if (!sourceIsValid(item.source)) throw new Error(`forgetting coordinator: invalid source ${item.source}`);
      const id = String(item.sourceId);
      if (!id || id === "undefined" || id === "null") throw new Error("forgetting coordinator: invalid sourceId");
      // Erasure requests have caller idempotency in addition to the scheduled
      // policy key.  A later, distinct request must not be mistaken for the
      // earlier request merely because it targets the same row.
      const key = `${request.tenantId}:${request.requestKey}:${item.source}:${id}:${erasePolicyVersion}:erase`;
      if (seen.has(key)) {
        idempotent++;
        addMetric(metrics, deps.metrics, "idempotent");
        continue;
      }
      seen.add(key);
      const action: ForgettingAction = {
        tenantId: request.tenantId,
        source: item.source,
        sourceId: id,
        policyVersion: erasePolicyVersion,
        action: "erase",
        actionKey: key,
        claimToken: randomUUID(),
      };
      try {
        const kind = classifyMemorySource(item.source).kind;
        if (kind === "protected_evidence" || kind === "container") {
          skipped++;
          addMetric(metrics, deps.metrics, "skipped");
          continue;
        }
        if (!(await deps.store.claimAction(action))) {
          idempotent++;
          addMetric(metrics, deps.metrics, "idempotent");
          continue;
        }
        const tombstone: ForgettingTombstone = {
          tenantId: request.tenantId,
          source: item.source,
          sourceId: id,
          valueDigest: noContentDigest(deps.tombstoneKey, {
            tenantId: request.tenantId,
            source: item.source,
            sourceId: id,
            requestKey: request.requestKey,
          }),
          requestKey: request.requestKey,
        };
        await deps.store.withTransaction(async (tx) => {
          await tx.assertClaim?.(action);
          // Ordering is deliberate: tombstone, audit, then hard delete.
          await tx.createTombstone(tombstone);
          await tx.recordAudit({
            tenantId: request.tenantId,
            actionKey: key,
            action: "erase",
            source: item.source,
            sourceId: id,
            reasonCode: request.reason?.trim() ? "explicit_erasure" : "explicit_erasure_unspecified",
            policyVersion: erasePolicyVersion,
            requestKey: request.requestKey,
          });
          const deleted = await tx.deleteCandidate({
            tenantId: request.tenantId,
            source: item.source,
            sourceId: id,
            requestKey: request.requestKey,
          });
          if (deleted !== 1) throw new Error("forgetting coordinator: erase target missing");
          await tx.completeAction?.(action);
        });
        if (!action.claimToken) await deps.store.markActionCompleted?.(action);
        erased++;
        addMetric(metrics, deps.metrics, "erased");
      } catch (error) {
        // Preserve the token that fenced this attempt.  Reconstructing the
        // action without it could mark a later worker's claim as failed.
        await deps.store.markActionFailed?.(action, "explicit_erasure_failed").catch(() => false);
        addMetric(metrics, deps.metrics, "failed");
        errors.push(error instanceof Error ? error.message : "explicit erasure failed");
      }
    }
    return {
      tenantId: request.tenantId,
      requestKey: request.requestKey,
      erased,
      idempotent,
      skipped,
      errors,
      metrics,
    };
  }

  async function reconcileStaleErasureRequests(input: {
    limit?: number;
    staleMs?: number;
    requests?: Array<{
      tenantId: number;
      requestKey: string;
      policyVersion?: number;
      reason?: string;
      requestedItems: ExplicitEraseItem[];
    }>;
  } = {}): Promise<ErasureReconciliationResult> {
    if (!deps.store.listStaleErasureRequests && !input.requests) {
      return { requests: 0, finalized: 0, retried: 0, failed: 0 };
    }
    const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 20)));
    const staleMs = Math.max(1, Math.floor(input.staleMs ?? 10 * 60 * 1000));
    const durable = input.requests ??
      await deps.store.listStaleErasureRequests!({ limit, staleMs });
    const result: ErasureReconciliationResult = {
      requests: durable.length, finalized: 0, retried: 0, failed: 0,
    };
    for (const request of durable) {
      try {
        if (!validTenant(request.tenantId) ||
          request.requestedItems.length > MAX_FORGETTING_BATCH_SIZE) {
          throw new Error("malformed stale erasure request");
        }
        await authorize("erase", request.tenantId);
        const requestPolicyVersion = request.policyVersion ?? policy.version;
        const progress = await deps.store.getErasureProgress?.({
          tenantId: request.tenantId,
          requestKey: request.requestKey,
          policyVersion: requestPolicyVersion,
          requestedItems: request.requestedItems,
        });
        const key = (item: ExplicitEraseItem) => `${item.source}:${String(item.sourceId)}`;
        // A completed claim is definitive.  A tenant-scoped tombstone is also
        // sufficient evidence that the delete transaction committed (the
        // adapter inserts it in that transaction before deleting), even when
        // an older worker crashed before recording its claim completion.
        const completed = new Set(request.requestedItems
          .filter((item) => !!progress && (
            progress.completedClaims.has(key(item)) || progress.tombstones.has(key(item))
          ))
          .map(key));
        const unresolved = request.requestedItems.filter((item) => !completed.has(key(item)));
        const fullyCompleted = unresolved.length === 0;
        if (fullyCompleted) {
          await deps.store.completeErasureRequest?.({
            tenantId: request.tenantId,
            requestKey: request.requestKey,
            status: "completed",
            erasedCount: request.requestedItems.length,
          });
          result.finalized++;
          continue;
        }
        const retried = await explicitErase({
          tenantId: request.tenantId,
          requestKey: request.requestKey,
          items: unresolved,
          reason: request.reason,
          policyVersion: requestPolicyVersion,
        });
        const erasedCount = completed.size + retried.erased;
        await deps.store.completeErasureRequest?.({
          tenantId: request.tenantId,
          requestKey: request.requestKey,
          status: retried.errors.length ? "failed" : "completed",
          erasedCount,
          error: retried.errors.length ? retried.errors.join("; ").slice(0, 1000) : null,
        });
        result.retried++;
      } catch (error) {
        result.failed++;
        console.error("[memory-forgetting] erasure reconciliation failed", {
          tenantId: request.tenantId,
          requestKey: request.requestKey,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    return result;
  }

  return {
    report,
    run,
    explicitErase,
    reconcileStaleErasureRequests,
    erase: explicitErase,
  };
}

export type ForgettingCoordinator = ReturnType<typeof createForgettingCoordinator>;
export const createMemoryForgettingCoordinator = createForgettingCoordinator;
export const createUnifiedMemoryForgettingCoordinator = createForgettingCoordinator;