// R60.B — Reclaim boundary tests.
//
// Verifies the two-pass reclaimExpiredLeases logic against a real DB:
//   Pass 1: expired-lease jobs that already exhausted max_attempts →
//           failed_terminal (no more retry budget, don't thrash).
//   Pass 2: remaining expired-lease jobs → pending with 30s cooldown
//           (legitimately slow handler, not a crashed one).
//
// Uses a unique synthetic kind prefix so the test can't collide with
// or disturb real queue traffic.
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../server/db";
import { sql } from "drizzle-orm";
import { reclaimExpiredLeases } from "../../server/job-queue";

const KIND_PREFIX = "__reclaim_test__";

async function wipeTestRows() {
  await db.execute(sql`DELETE FROM agent_jobs WHERE kind LIKE ${KIND_PREFIX + "%"}`);
}

// Insert a row in a specified state so we can drive reclaim deterministically.
async function insertTestJob(args: {
  kind: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  leaseExpiredMinutesAgo: number | null;
}): Promise<number> {
  const leaseUntil = args.leaseExpiredMinutesAgo === null
    ? null
    : sql`NOW() - INTERVAL '1 minute' * ${args.leaseExpiredMinutesAgo}`;
  const result: any = await db.execute(sql`
    INSERT INTO agent_jobs (
      kind, payload, status, attempts, max_attempts,
      started_at, lease_until, next_run_at
    )
    VALUES (
      ${args.kind}, '{}'::jsonb, ${args.status},
      ${args.attempts}, ${args.maxAttempts},
      NOW() - INTERVAL '10 minutes',
      ${leaseUntil},
      NOW()
    )
    RETURNING id
  `);
  const rows = (result.rows || result) as any[];
  return rows[0].id;
}

async function getJob(id: number): Promise<any> {
  const result: any = await db.execute(sql`
    SELECT id, kind, status, attempts, max_attempts,
           lease_until,
           EXTRACT(EPOCH FROM (next_run_at - NOW()))::float AS seconds_until_next_run
    FROM agent_jobs WHERE id = ${id}
  `);
  return ((result.rows || result) as any[])[0];
}

before(wipeTestRows);
afterEach(wipeTestRows);
after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref(); });

test("expired lease with attempts >= max_attempts → failed_terminal immediately", async () => {
  const id = await insertTestJob({
    kind: `${KIND_PREFIX}exhausted`,
    status: "running",
    attempts: 3,
    maxAttempts: 3,
    leaseExpiredMinutesAgo: 2,
  });

  const touched = await reclaimExpiredLeases();
  assert.ok(touched >= 1, "reclaim reported at least one row touched");

  const job = await getJob(id);
  assert.equal(job.status, "failed_terminal", "exhausted job went terminal (no more retries)");
  assert.equal(job.lease_until, null, "lease cleared");
});

test("expired lease with attempts < max_attempts → pending with ~30s cooldown (no thrash)", async () => {
  const id = await insertTestJob({
    kind: `${KIND_PREFIX}retryable`,
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    leaseExpiredMinutesAgo: 2,
  });

  await reclaimExpiredLeases();

  const job = await getJob(id);
  assert.equal(job.status, "pending", "retryable job went back to pending");
  assert.equal(job.attempts, 1, "attempts preserved (not reset)");
  assert.equal(job.lease_until, null, "lease cleared");
  // Cooldown should be within [25s, 35s] of now — we just set it to +30s.
  // Guard against clock drift / test flakiness with a generous window.
  const delta = Number(job.seconds_until_next_run);
  assert.ok(
    delta > 25 && delta < 35,
    `cooldown should be ~30s, got ${delta}s (prevents hot-spinning reclaim on slow handlers)`,
  );
});

test("non-expired running job is NOT touched by reclaim", async () => {
  const id = await insertTestJob({
    kind: `${KIND_PREFIX}still_running`,
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    leaseExpiredMinutesAgo: -5, // lease in the FUTURE (still valid)
  });

  await reclaimExpiredLeases();

  const job = await getJob(id);
  assert.equal(job.status, "running", "non-expired job left alone");
});

test("two-pass is independent: terminal + retryable in same sweep both handled correctly", async () => {
  const terminalId = await insertTestJob({
    kind: `${KIND_PREFIX}mixed_terminal`,
    status: "running",
    attempts: 5,
    maxAttempts: 5,
    leaseExpiredMinutesAgo: 3,
  });
  const retryableId = await insertTestJob({
    kind: `${KIND_PREFIX}mixed_retryable`,
    status: "running",
    attempts: 2,
    maxAttempts: 5,
    leaseExpiredMinutesAgo: 3,
  });

  const touched = await reclaimExpiredLeases();
  assert.ok(touched >= 2, `expected both rows touched, got ${touched}`);

  const terminal = await getJob(terminalId);
  const retryable = await getJob(retryableId);

  assert.equal(terminal.status, "failed_terminal", "exhausted → terminal");
  assert.equal(retryable.status, "pending", "in-budget → pending");
  // Critical invariant: the retryable job did NOT get dragged into terminal
  // by the first UPDATE. The two passes must be independent.
  assert.notEqual(retryable.status, "failed_terminal");
});
