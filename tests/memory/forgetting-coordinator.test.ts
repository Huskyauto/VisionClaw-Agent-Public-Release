import test from "node:test";
import assert from "node:assert/strict";
import {
  createForgettingCoordinator,
  type ActiveRetentionPolicy,
  type ForgettingAction,
  type ForgettingStore,
  type ForgettingTransaction,
} from "../../server/memory/forgetting-coordinator";
import {
  defaultMemoryRetentionPolicy,
  type
  MemoryLifecycleCandidate,
  type MemoryLifecycleCandidatePage,
} from "../../server/memory/forgetting-policy";

function candidate(overrides: Partial<MemoryLifecycleCandidate> = {}): MemoryLifecycleCandidate {
  return {
    id: 7,
    source: "memory_entries",
    status: "active",
    createdAt: "2024-01-01T00:00:00.000Z",
    lastAccessedAt: "2024-01-01T00:00:00.000Z",
    expiresAt: null,
    accessCount: 0,
    ...overrides,
  };
}

function store(rows: MemoryLifecycleCandidate[]) {
  const events: string[] = [];
  const claimed = new Set<string>();
  const db: ForgettingStore = {
    async listCandidates() { return rows; },
    async claimAction(action: ForgettingAction) {
      if (claimed.has(action.actionKey)) return false;
      claimed.add(action.actionKey);
      events.push(`claim:${action.action}`);
      return true;
    },
    async archiveCandidate() { events.push("archive"); },
    async isArchived() { return true; },
    async withTransaction<T>(fn: (tx: ForgettingTransaction) => Promise<T>) {
      return fn({
        async archiveCandidate() { events.push("archive"); },
        async createTombstone() { events.push("tombstone"); },
        async recordAudit(audit) { events.push(`audit:${audit.action}`); },
        async deleteCandidate() { events.push("delete"); return 1; },
      });
    },
  };
  return { db, events };
}

const authorized = { authorize: () => true };

test("report-only is available and never invokes mutation methods", async () => {
  const { db, events } = store([candidate()]);
  const coordinator = createForgettingCoordinator({
    store: db,
    ...authorized,
    env: { MEMORY_FORGETTING_ENABLED: "0" },
    now: () => Date.parse("2026-09-15T00:00:00.000Z"),
  });
  const result = await coordinator.report({ tenantId: 42, batchSize: 1 });
  assert.equal(result.actions[0]?.action, "archive");
  assert.deepEqual(events, []);
});

test("protected evidence and procedural skills are kept", async () => {
  const { db } = store([
    candidate({ id: 1, source: "agent_runs" }),
    candidate({ id: 2, source: "skills" }),
  ]);
  const result = await createForgettingCoordinator({
    store: db,
    ...authorized,
    now: () => Date.parse("2026-09-15T00:00:00.000Z"),
  }).report({ tenantId: 42 });
  assert.equal(result.actions.length, 0);
  assert.equal(result.metrics.skipped, 2);
  assert.deepEqual(result.skipped.map((x) => x.reasonCode), ["protected_evidence", "no_automatic_policy"]);
});

test("mutation requires exact opt-in and claims repeated actions idempotently", async () => {
  const { db, events } = store([candidate()]);
  const coordinator = createForgettingCoordinator({
    store: db,
    ...authorized,
    env: { MEMORY_FORGETTING_ENABLED: "yes" },
    now: () => Date.parse("2026-09-15T00:00:00.000Z"),
  });
  const disabled = await coordinator.run({ tenantId: 42, mode: "mutate" });
  assert.equal(disabled.mutationEnabled, false);
  assert.deepEqual(events, []);

  const enabled = createForgettingCoordinator({
    store: db,
    ...authorized,
    env: { MEMORY_FORGETTING_ENABLED: "1" },
    now: () => Date.parse("2026-09-15T00:00:00.000Z"),
  });
  await enabled.run({ tenantId: 42, mode: "mutate" });
  await enabled.run({ tenantId: 42, mode: "mutate" });
  assert.equal(events.filter((x) => x === "archive").length, 1);
});

test("tenant report-only policy wins over the global mutation switch", async () => {
  const { db, events } = store([candidate()]);
  const policy: ActiveRetentionPolicy = {
    mode: "report_only",
    version: 1,
    sources: {
      memory_entries: {
        archiveAfterDays: 1,
        purgeArchivedAfterDays: 30,
        minimumAccessCountToRetain: 0,
      },
    },
  };
  const result = await createForgettingCoordinator({
    store: db,
    policy,
    ...authorized,
    env: { MEMORY_FORGETTING_ENABLED: "1" },
    now: () => Date.parse("2026-09-15T00:00:00.000Z"),
  }).run({ tenantId: 42, mode: "mutate" });
  assert.equal(result.mutationEnabled, false);
  assert.deepEqual(events, []);
});

test("purge requires prior archive and explicit erase orders tombstone before delete", async () => {
  const archived = candidate({
    id: 8,
    status: "archived",
    createdAt: "2024-01-01T00:00:00.000Z",
    lastAccessedAt: "2024-01-01T00:00:00.000Z",
    archivedAt: "2024-01-01T00:00:00.000Z",
  });
  const { db, events } = store([archived]);
  const coordinator = createForgettingCoordinator({
    store: db,
    ...authorized,
    env: { MEMORY_FORGETTING_ENABLED: "1" },
    tombstoneKey: "test-only-key",
    now: () => Date.parse("2026-09-15T00:00:00.000Z"),
  });
  await coordinator.run({ tenantId: 42, mode: "mutate" });
  assert.ok(events.indexOf("audit:purge") < events.indexOf("delete"));

  events.length = 0;
  await coordinator.explicitErase({
    tenantId: 42,
    requestKey: "erase-1",
    items: [{ source: "memory_entries", sourceId: 8 }],
  });
  assert.deepEqual(events.slice(-3), ["tombstone", "audit:erase", "delete"]);
});

test("wrong tenant and invalid source fail closed", async () => {
  const { db } = store([candidate({ tenantId: 99 })]);
  const coordinator = createForgettingCoordinator({ store: db, ...authorized });
  const report = await coordinator.report({ tenantId: 42 });
  assert.equal(report.actions.length, 0);
  assert.equal(report.metrics.failed, 1);
  await assert.rejects(
    coordinator.report({ tenantId: 42, sources: ["not-a-source" as never] }),
    /invalid source/,
  );
});

test("explicit erase fences failure reporting with the original claim token", async () => {
  let failed: ForgettingAction | undefined;
  const db: ForgettingStore = {
    async listCandidates() { return []; },
    async claimAction() { return true; },
    async markActionFailed(action) { failed = action; return true; },
    async withTransaction<T>(fn: (tx: ForgettingTransaction) => Promise<T>) {
      return fn({
        async createTombstone() {},
        async recordAudit() {},
        async deleteCandidate() { throw new Error("fenced"); },
      });
    },
  };
  await createForgettingCoordinator({
    store: db,
    ...authorized,
    env: { MEMORY_FORGETTING_ENABLED: "1" },
    tombstoneKey: "test-only-key",
  }).explicitErase({
    tenantId: 42,
    requestKey: "erase-fenced",
    items: [{ source: "memory_entries", sourceId: 7 }],
  });
  assert.ok(failed?.claimToken);
  assert.equal(failed?.actionKey, "42:erase-fenced:memory_entries:7:1:erase");
});

test("reconciliation finalizes a stale request from tenant-scoped tombstone progress", async () => {
  let finalized = false;
  const db: ForgettingStore = {
    async listCandidates() { return []; },
    async getErasureProgress() {
      return {
        completedClaims: new Set<string>(),
        tombstones: new Set(["memory_entries:7"]),
      };
    },
    async completeErasureRequest(input) {
      finalized = input.status === "completed" && input.erasedCount === 1;
    },
    async claimAction() { throw new Error("must not retry completed tombstone"); },
    async withTransaction() { throw new Error("must not mutate"); },
  };
  const result = await createForgettingCoordinator({
    store: db,
    ...authorized,
    tombstoneKey: "test-only-key",
  }).reconcileStaleErasureRequests({
    requests: [{
      tenantId: 42,
      requestKey: "stale-1",
      requestedItems: [{ source: "memory_entries", sourceId: "7" }],
    }],
  });
  assert.deepEqual(result, { requests: 1, finalized: 1, retried: 0, failed: 0 });
  assert.equal(finalized, true);
});

test("reconciliation retries only unresolved items and counts pre-crash progress", async () => {
  let finalizedCount = -1;
  const claimed: string[] = [];
  const db: ForgettingStore = {
    async listCandidates() { return []; },
    async getErasureProgress(input) {
      assert.equal(input.policyVersion, 7);
      return {
        completedClaims: new Set(["memory_entries:7"]),
        tombstones: new Set<string>(),
      };
    },
    async completeErasureRequest(input) { finalizedCount = input.erasedCount; },
    async claimAction(action) {
      assert.equal(action.policyVersion, 7);
      claimed.push(action.sourceId);
      return true;
    },
    async markActionCompleted() { return true; },
    async withTransaction<T>(fn: (tx: ForgettingTransaction) => Promise<T>) {
      return fn({
        async createTombstone() {},
        async recordAudit() {},
        async deleteCandidate() { return 1; },
      });
    },
  };
  const result = await createForgettingCoordinator({
    store: db,
    ...authorized,
    policy: { ...defaultMemoryRetentionPolicy, version: 8 },
    env: { MEMORY_FORGETTING_ENABLED: "1" },
    tombstoneKey: "test-only-key",
  }).reconcileStaleErasureRequests({
    requests: [{
      tenantId: 42,
      requestKey: "stale-partial",
      policyVersion: 7,
      requestedItems: [
        { source: "memory_entries", sourceId: "7" },
        { source: "memory_entries", sourceId: "8" },
      ],
    }],
  });
  assert.deepEqual(claimed, ["8"]);
  assert.equal(finalizedCount, 2);
  assert.deepEqual(result, { requests: 1, finalized: 0, retried: 1, failed: 0 });
});

test("report carries source cursors through without invoking operational writes", async () => {
  const { db, events } = store([candidate({ id: 101 })]);
  let received: Record<string, unknown> | undefined;
  db.listCandidates = async (input) => {
    received = input as unknown as Record<string, unknown>;
    const page = [candidate({ id: 101 })] as MemoryLifecycleCandidatePage;
    page.nextCursors = { memory_entries: 101 };
    return page;
  };
  const result = await createForgettingCoordinator({
    store: db,
    ...authorized,
    now: () => Date.parse("2026-09-15T00:00:00.000Z"),
  }).report({
    tenantId: 42,
    sources: ["memory_entries"],
    cursors: { memory_entries: 100 },
    batchSize: 1,
  });
  assert.deepEqual(received?.cursors, { memory_entries: 100 });
  assert.deepEqual(result.nextCursors, { memory_entries: 101 });
  assert.deepEqual(events, []);
});
