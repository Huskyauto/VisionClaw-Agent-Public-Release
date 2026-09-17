// R74.13u — Durable webhook event dedupe (Stripe + Coinbase).
//
// Replaces the per-process in-memory Set used previously, which lost dedupe
// state on every restart and offered zero protection across multiple
// processes. Backing store is a tiny `webhook_events` table with a composite
// primary key on (provider, event_id). The table is created lazily on first
// call (idempotent CREATE TABLE IF NOT EXISTS) so this module is safe to
// import from any code path without a migration step.
//
// CLAIM-then-COMMIT pattern (R74.13u-2 follow-up):
//   The naive "mark seen at receive time" pattern silently drops events on
//   transient processing failure: receive → mark seen → side effect throws
//   → Stripe retries → dedupe says "duplicate" → event lost. We instead
//   record an unfinished claim on receive (`completed_at IS NULL`) and only
//   set `completed_at` after side effects succeed. Retries that arrive
//   while a prior claim was never committed are allowed through and re-run
//   the side effects (the side-effect handlers themselves are idempotent
//   on tenant/customer state).
//
// API:
//   claimWebhookEvent(provider, eventId): one of
//     - "fresh"          — newly inserted, caller should process
//     - "retry"          — claim row exists but was never committed
//                          (previous attempt failed mid-way); caller should
//                          re-process. Side-effect handlers must be
//                          idempotent.
//     - "completed"      — already fully processed; caller should ACK with
//                          200 and skip side effects.
//   markWebhookEventCompleted(provider, eventId): stamps completed_at.
//   cleanupOldWebhookEvents(maxAgeDays = 14): best-effort GC of completed
//     rows older than the threshold (in-flight rows are preserved).

import { db } from "./db";
import { sql } from "drizzle-orm";

export type ClaimResult = "fresh" | "retry" | "completed";

let tableEnsuredPromise: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
  if (tableEnsuredPromise) return tableEnsuredPromise;
  tableEnsuredPromise = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS webhook_events (
        provider text NOT NULL,
        event_id text NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        PRIMARY KEY (provider, event_id)
      )
    `);
    // Older deployments may have the table from the first iteration of this
    // module without the completed_at column; add it if missing.
    await db.execute(sql`
      ALTER TABLE webhook_events
        ADD COLUMN IF NOT EXISTS completed_at timestamptz
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx
        ON webhook_events (received_at)
    `);
  })().catch((err) => {
    tableEnsuredPromise = null;
    throw err;
  });
  return tableEnsuredPromise;
}

export async function claimWebhookEvent(
  provider: string,
  eventId: string,
): Promise<ClaimResult> {
  if (!eventId) return "fresh"; // Cannot dedupe without an id; let caller process.
  await ensureTable();

  // Single-statement INSERT…ON CONFLICT…RETURNING is race-safe across
  // processes: Postgres serializes the conflict, exactly one txn wins the
  // INSERT, the other sees DO NOTHING. We then look up the existing row's
  // completed_at to decide retry vs completed.
  const insertResult: any = await db.execute(sql`
    INSERT INTO webhook_events (provider, event_id)
    VALUES (${provider}, ${eventId})
    ON CONFLICT (provider, event_id) DO NOTHING
    RETURNING event_id
  `);
  const insertedRows = (insertResult as any).rows ?? insertResult ?? [];
  if (Array.isArray(insertedRows) && insertedRows.length > 0) return "fresh";

  // Row already existed — inspect completion state.
  const lookupResult: any = await db.execute(sql`
    SELECT completed_at
    FROM webhook_events
    WHERE provider = ${provider} AND event_id = ${eventId}
    LIMIT 1
  `);
  const lookupRows = (lookupResult as any).rows ?? lookupResult ?? [];
  const row = Array.isArray(lookupRows) ? lookupRows[0] : null;
  if (row && (row as any).completed_at) return "completed";
  return "retry";
}

export async function markWebhookEventCompleted(
  provider: string,
  eventId: string,
): Promise<void> {
  if (!eventId) return;
  await ensureTable();
  await db.execute(sql`
    UPDATE webhook_events
    SET completed_at = now()
    WHERE provider = ${provider} AND event_id = ${eventId}
  `);
}

export async function cleanupOldWebhookEvents(maxAgeDays = 14): Promise<number> {
  await ensureTable();
  // Only delete rows that were committed — never garbage-collect in-flight
  // claims, since deleting them would re-open the lost-event window.
  const result: any = await db.execute(sql`
    DELETE FROM webhook_events
    WHERE completed_at IS NOT NULL
      AND received_at < now() - make_interval(days => ${maxAgeDays})
  `);
  return (result as any).rowCount ?? 0;
}
