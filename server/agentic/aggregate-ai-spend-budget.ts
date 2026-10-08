import { sql } from "drizzle-orm";
import { db } from "../db";

export const AGGREGATE_AI_DAILY_CAP_CENTS = 2_000;

export interface AggregateAiReservation {
  id: number;
  tenantId: number;
  attemptKey: string;
  utcDay: string;
  reservedCents: number;
  actualCents: number | null;
  state: "reserved" | "settled";
}

export interface AggregateAiBudgetTransaction {
  sumForUtcDay(day: string): Promise<number>;
  findAttempt(tenantId: number, attemptKey: string): Promise<AggregateAiReservation | undefined>;
  insertReservation(reservation: Omit<AggregateAiReservation, "id">): Promise<AggregateAiReservation>;
  findReservation(tenantId: number, id: number, attemptKey: string): Promise<AggregateAiReservation | undefined>;
  settleReservation(
    tenantId: number,
    id: number,
    attemptKey: string,
    actualCents: number,
  ): Promise<boolean>;
}

export interface AggregateAiBudgetStore {
  /** Production implementation holds the single global advisory lock in this transaction. */
  transaction<T>(work: (tx: AggregateAiBudgetTransaction) => Promise<T>): Promise<T>;
}

export interface AggregateAiBudgetDeps {
  store?: AggregateAiBudgetStore;
  now?: () => Date;
}

function requirePositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`[aggregate-ai-budget] ${name} must be a positive integer number of cents`);
  }
}

function requireAttemptKey(value: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > 200 || value.trim() !== value) {
    throw new Error("[aggregate-ai-budget] attemptKey must be a non-empty, bounded server-owned key");
  }
}

function utcDayFrom(clock: () => Date): string {
  const date = clock();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error("[aggregate-ai-budget] UTC admission time is invalid");
  }
  return date.toISOString().slice(0, 10);
}

/** Reserve the proven maximum before a paid request. Every retry needs a new attempt key. */
export async function reserveAggregateAiSpend(
  args: { tenantId: number; attemptKey: string; maximumCostCents: number },
  deps: AggregateAiBudgetDeps = {},
): Promise<AggregateAiReservation> {
  requirePositiveSafeInteger(args.tenantId, "tenantId");
  requireAttemptKey(args.attemptKey);
  requirePositiveSafeInteger(args.maximumCostCents, "maximumCostCents");
  if (args.maximumCostCents > AGGREGATE_AI_DAILY_CAP_CENTS) {
    throw new Error("[aggregate-ai-budget] request bound exceeds the $20 UTC-day ceiling");
  }
  const store = deps.store ?? databaseStore;

  return store.transaction(async (tx) => {
    // The transaction holds the global lock here. A waiter that crossed
    // midnight must charge the day on which it can actually be admitted.
    const utcDay = utcDayFrom(deps.now ?? (() => new Date()));
    if (await tx.findAttempt(args.tenantId, args.attemptKey)) {
      throw new Error("[aggregate-ai-budget] attempt key already used; an ambiguous attempt cannot be re-reserved");
    }
    const committedAndHeld = await tx.sumForUtcDay(utcDay);
    if (!Number.isSafeInteger(committedAndHeld) || committedAndHeld < 0) {
      throw new Error("[aggregate-ai-budget] stored daily total is invalid; refusing paid admission");
    }
    if (committedAndHeld + args.maximumCostCents > AGGREGATE_AI_DAILY_CAP_CENTS) {
      throw new Error("[aggregate-ai-budget] $20 UTC-day metered-AI budget exhausted");
    }
    return tx.insertReservation({
      tenantId: args.tenantId,
      attemptKey: args.attemptKey,
      utcDay,
      reservedCents: args.maximumCostCents,
      actualCents: null,
      state: "reserved",
    });
  });
}

/** Settle only the original tenant-bound held row, and never above its reservation. */
export async function settleAggregateAiSpend(
  args: { tenantId: number; reservationId: number; attemptKey: string; actualCostCents: number },
  deps: AggregateAiBudgetDeps = {},
): Promise<AggregateAiReservation> {
  requirePositiveSafeInteger(args.tenantId, "tenantId");
  requirePositiveSafeInteger(args.reservationId, "reservationId");
  requireAttemptKey(args.attemptKey);
  if (!Number.isSafeInteger(args.actualCostCents) || args.actualCostCents < 0) {
    throw new Error("[aggregate-ai-budget] actualCostCents must be a nonnegative integer number of cents");
  }
  const store = deps.store ?? databaseStore;
  return store.transaction(async (tx) => {
    const row = await tx.findReservation(args.tenantId, args.reservationId, args.attemptKey);
    if (!row) throw new Error("[aggregate-ai-budget] reservation not found for this tenant and attempt");
    if (row.state !== "reserved") {
      throw new Error("[aggregate-ai-budget] reservation is not held; duplicate settlement is forbidden");
    }
    if (args.actualCostCents > row.reservedCents) {
      throw new Error("[aggregate-ai-budget] actual usage exceeds the reserved maximum");
    }
    const updated = await tx.settleReservation(
      args.tenantId,
      args.reservationId,
      args.attemptKey,
      args.actualCostCents,
    );
    if (!updated) throw new Error("[aggregate-ai-budget] reservation changed concurrently; settlement rejected");
    return {
      ...row,
      state: "settled",
      actualCents: args.actualCostCents,
    };
  });
}

function rowsOf(result: any): any[] {
  const rows = result?.rows ?? result;
  if (!Array.isArray(rows)) throw new Error("[aggregate-ai-budget] database returned an invalid result");
  return rows;
}

function dbReservation(row: any): AggregateAiReservation {
  const id = Number(row.id);
  const tenantId = Number(row.tenant_id);
  const reservedCents = Number(row.reserved_cents);
  const actualCents = row.actual_cents === null || row.actual_cents === undefined
    ? null : Number(row.actual_cents);
  if (!Number.isSafeInteger(id) || !Number.isSafeInteger(tenantId)
    || !Number.isSafeInteger(reservedCents)
    || (actualCents !== null && !Number.isSafeInteger(actualCents))
    || typeof row.utc_day !== "string"
    || (row.state !== "reserved" && row.state !== "settled")) {
    throw new Error("[aggregate-ai-budget] database reservation contains invalid accounting data");
  }
  return {
    id,
    tenantId,
    attemptKey: String(row.attempt_key),
    utcDay: row.utc_day,
    reservedCents,
    actualCents,
    state: row.state,
  };
}

function createDatabaseTransaction(tx: any): AggregateAiBudgetTransaction {
  return {
    async sumForUtcDay(day) {
      const result: any = await tx.execute(sql`
        SELECT COALESCE(SUM(
          CASE WHEN state = 'reserved' THEN reserved_cents ELSE actual_cents END
        ), 0)::text AS total_cents
        FROM aggregate_ai_spend_reservations
        WHERE utc_day = ${day}::date
      `);
      const total = rowsOf(result)[0]?.total_cents;
      if (typeof total !== "string" || !/^\d+$/.test(total)) {
        throw new Error("[aggregate-ai-budget] daily total could not be verified; refusing paid admission");
      }
      const parsed = Number(total);
      if (!Number.isSafeInteger(parsed)) {
        throw new Error("[aggregate-ai-budget] daily total exceeds safe accounting bounds");
      }
      return parsed;
    },
    async findAttempt(tenantId, attemptKey) {
      const result: any = await tx.execute(sql`
        SELECT id, tenant_id, attempt_key, utc_day::text AS utc_day,
          reserved_cents, actual_cents, state
        FROM aggregate_ai_spend_reservations
        WHERE tenant_id = ${tenantId} AND attempt_key = ${attemptKey}
        LIMIT 1
      `);
      const row = rowsOf(result)[0];
      return row ? dbReservation(row) : undefined;
    },
    async insertReservation(reservation) {
      const result: any = await tx.execute(sql`
        INSERT INTO aggregate_ai_spend_reservations
          (tenant_id, attempt_key, utc_day, reserved_cents, actual_cents, state)
        VALUES (
          ${reservation.tenantId}, ${reservation.attemptKey}, ${reservation.utcDay}::date,
          ${reservation.reservedCents}, NULL, 'reserved'
        )
        RETURNING id, tenant_id, attempt_key, utc_day::text AS utc_day,
          reserved_cents, actual_cents, state
      `);
      const row = rowsOf(result)[0];
      if (!row) throw new Error("[aggregate-ai-budget] reservation was not persisted");
      return dbReservation(row);
    },
    async findReservation(tenantId, id, attemptKey) {
      const result: any = await tx.execute(sql`
        SELECT id, tenant_id, attempt_key, utc_day::text AS utc_day,
          reserved_cents, actual_cents, state
        FROM aggregate_ai_spend_reservations
        WHERE tenant_id = ${tenantId} AND id = ${id} AND attempt_key = ${attemptKey}
        LIMIT 1
      `);
      const row = rowsOf(result)[0];
      return row ? dbReservation(row) : undefined;
    },
    async settleReservation(tenantId, id, attemptKey, actualCents) {
      const result: any = await tx.execute(sql`
        UPDATE aggregate_ai_spend_reservations
        SET state = 'settled', actual_cents = ${actualCents}, settled_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenantId} AND id = ${id} AND attempt_key = ${attemptKey}
          AND state = 'reserved' AND ${actualCents} <= reserved_cents
        RETURNING id
      `);
      return rowsOf(result).length === 1;
    },
  };
}

const databaseStore: AggregateAiBudgetStore = {
  transaction: async (work) => db.transaction(async (tx) => {
    // One platform-wide lock makes every tenant contend on the same UTC-day total.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('aggregate-ai-spend-budget'), 0)`);
    return work(createDatabaseTransaction(tx));
  }),
};