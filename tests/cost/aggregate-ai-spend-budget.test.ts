import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reserveAggregateAiSpend,
  settleAggregateAiSpend,
  type AggregateAiBudgetStore,
  type AggregateAiBudgetTransaction,
  type AggregateAiReservation,
} from "../../server/agentic/aggregate-ai-spend-budget";

class MemoryStore implements AggregateAiBudgetStore {
  private rows: AggregateAiReservation[] = [];
  private tail: Promise<void> = Promise.resolve();
  private nextId = 1;

  async transaction<T>(work: (tx: AggregateAiBudgetTransaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await work({
        sumForUtcDay: async (day) => this.rows
          .filter((row) => row.utcDay === day)
          .reduce((sum, row) => sum + (row.state === "reserved" ? row.reservedCents : row.actualCents!), 0),
        findAttempt: async (tenantId, attemptKey) =>
          this.rows.find((row) => row.tenantId === tenantId && row.attemptKey === attemptKey),
        insertReservation: async (row) => {
          const inserted = { ...row, id: this.nextId++ };
          this.rows.push(inserted);
          return inserted;
        },
        findReservation: async (tenantId, id, attemptKey) =>
          this.rows.find((row) => row.tenantId === tenantId && row.id === id && row.attemptKey === attemptKey),
        settleReservation: async (tenantId, id, attemptKey, actualCents) => {
          const row = this.rows.find((candidate) => candidate.tenantId === tenantId
            && candidate.id === id && candidate.attemptKey === attemptKey && candidate.state === "reserved");
          if (!row) return false;
          row.state = "settled";
          row.actualCents = actualCents;
          return true;
        },
      });
    } finally {
      release();
    }
  }
}

test("concurrent tenants cannot reserve more than the global UTC-day ceiling", async () => {
  const store = new MemoryStore();
  const now = () => new Date("2026-09-30T23:59:59.900Z");
  const results = await Promise.allSettled([
    reserveAggregateAiSpend({ tenantId: 1, attemptKey: "attempt-a", maximumCostCents: 1_500 }, { store, now }),
    reserveAggregateAiSpend({ tenantId: 2, attemptKey: "attempt-b", maximumCostCents: 1_500 }, { store, now }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("settlement after UTC midnight preserves the admission day and the next day has a fresh limit", async () => {
  const store = new MemoryStore();
  const reservation = await reserveAggregateAiSpend(
    { tenantId: 7, attemptKey: "midnight-attempt", maximumCostCents: 1_500 },
    { store, now: () => new Date("2026-09-30T23:59:59.900Z") },
  );
  const settled = await settleAggregateAiSpend({
    tenantId: 7,
    reservationId: reservation.id,
    attemptKey: "midnight-attempt",
    actualCostCents: 1_200,
  }, { store, now: () => new Date("2026-10-01T00:00:00.100Z") });
  assert.equal(settled.utcDay, "2026-09-30");
  assert.equal(settled.actualCents, 1_200);
  const nextDay = await reserveAggregateAiSpend(
    { tenantId: 8, attemptKey: "new-utc-day", maximumCostCents: 1_500 },
    { store, now: () => new Date("2026-10-01T00:00:00.100Z") },
  );
  assert.equal(nextDay.utcDay, "2026-10-01");
});

test("an admission waiting for the global lock uses the UTC day after the wait", async () => {
  const store = new MemoryStore();
  let unlock!: () => void;
  let markHeld!: () => void;
  const isHeld = new Promise<void>((resolve) => { markHeld = resolve; });
  const held = store.transaction(async () => {
    markHeld();
    await new Promise<void>((resolve) => { unlock = resolve; });
  });
  await isHeld;
  let currentTime = new Date("2026-09-30T23:59:59.900Z");
  const pending = reserveAggregateAiSpend(
    { tenantId: 7, attemptKey: "waited-across-midnight", maximumCostCents: 100 },
    { store, now: () => currentTime },
  );
  currentTime = new Date("2026-10-01T00:00:00.100Z");
  unlock();
  await held;
  const admitted = await pending;
  assert.equal(admitted.utcDay, "2026-10-01");
});

test("tenant-bound keys prevent cross-tenant settlement and uncertain reservations remain held", async () => {
  const store = new MemoryStore();
  const day = () => new Date("2026-10-01T12:00:00Z");
  const first = await reserveAggregateAiSpend(
    { tenantId: 1, attemptKey: "shared-visible-key", maximumCostCents: 1_500 },
    { store, now: day },
  );
  await assert.rejects(
    settleAggregateAiSpend({
      tenantId: 2,
      reservationId: first.id,
      attemptKey: "shared-visible-key",
      actualCostCents: 0,
    }, { store, now: day }),
    /not found for this tenant/,
  );
  const second = await reserveAggregateAiSpend(
    { tenantId: 2, attemptKey: "shared-visible-key", maximumCostCents: 500 },
    { store, now: day },
  );
  assert.equal(second.tenantId, 2);
  await assert.rejects(
    reserveAggregateAiSpend(
      { tenantId: 1, attemptKey: "shared-visible-key", maximumCostCents: 100 },
      { store, now: day },
    ),
    /already used/,
  );
  await assert.rejects(
    reserveAggregateAiSpend(
      { tenantId: 3, attemptKey: "would-overreserve", maximumCostCents: 1 },
      { store, now: day },
    ),
    /budget exhausted/,
  );
});

test("fractional-cent bounds and settlement above the reservation are refused", async () => {
  const store = new MemoryStore();
  const deps = { store, now: () => new Date("2026-10-01T12:00:00Z") };
  await assert.rejects(
    reserveAggregateAiSpend(
      { tenantId: 1, attemptKey: "fractional", maximumCostCents: 12.5 },
      deps,
    ),
    /positive integer number of cents/,
  );
  const reservation = await reserveAggregateAiSpend(
    { tenantId: 1, attemptKey: "bounded", maximumCostCents: 400 },
    deps,
  );
  await assert.rejects(
    settleAggregateAiSpend({
      tenantId: 1,
      reservationId: reservation.id,
      attemptKey: "bounded",
      actualCostCents: 401,
    }, deps),
    /exceeds the reserved maximum/,
  );
  const settled = await settleAggregateAiSpend({
    tenantId: 1,
    reservationId: reservation.id,
    attemptKey: "bounded",
    actualCostCents: 350,
  }, deps);
  assert.equal(settled.actualCents, 350);
  await assert.rejects(
    settleAggregateAiSpend({
      tenantId: 1,
      reservationId: reservation.id,
      attemptKey: "bounded",
      actualCostCents: 350,
    }, deps),
    /duplicate settlement is forbidden/,
  );
});