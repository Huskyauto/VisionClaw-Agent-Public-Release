// ─────────────────────────────────────────────────────────────────────────────
// Plan Pre-Warm — "sleep-time compute" for the LOOP plan-replay cache
// (agentic-reasoning survey nugget, arXiv 2601.12538, adopted 2026-08-13)
// ─────────────────────────────────────────────────────────────────────────────
// The plan-replay cache lets orchestration skip the planner LLM call for
// recurring requests, but entries expire after 30 days (MAX_AGE_MS in
// server/plan-replay.ts). A PROVEN plan (multiple replay hits) that ages out
// forces the next identical request back onto the paid planner path.
//
// This job runs off-peak and REFRESHES proven, near-expiry entries: for each
// row with hit_count >= MIN_HITS whose created_at is inside the refresh window
// (older than REFRESH_AFTER_DAYS, younger than the 30-day TTL), it re-inserts
// a copy with a fresh created_at — same tenant, class, objective, embedding,
// and plan_json. $0: no LLM call, no re-embedding (the vector is copied).
//
// Safety:
//   • Dedupe — skipped if ANY newer row exists for the same
//     (tenant_id, request_class, objective) (a fresh recording or a prior
//     refresh already covers it).
//   • Refresh lineage does not compound blindly: the copy starts at
//     hit_count 0, so it must EARN new hits inside its own 30-day window to
//     be refreshed again. Plans that stop being used die naturally.
//   • Class-version keyed — request_class embeds the classifier-mapping hash
//     (keyedClass), so rows from an old narrowing regime are never refreshed
//     into the new one (they simply stop matching and age out).
//   • Bounded — MAX_REFRESH_PER_RUN caps the write volume per run.
//
// Exit codes: 0 success, 1 fatal (DB unreachable / crash).
// Env knobs: PLAN_PREWARM_DRY_RUN=1 (report only), PLAN_PREWARM_MAX (default 25).
// ─────────────────────────────────────────────────────────────────────────────

import { pool } from "../server/db";

const TTL_DAYS = 30;            // must mirror MAX_AGE_MS in server/plan-replay.ts
const REFRESH_AFTER_DAYS = 23;  // refresh window: day 23 → day 30
const MIN_HITS = 2;             // only proven plans earn a refresh

function maxRefresh(): number {
  const raw = Number(process.env.PLAN_PREWARM_MAX ?? 25);
  if (!Number.isFinite(raw) || raw < 1) return 25;
  return Math.min(200, Math.floor(raw));
}

async function main(): Promise<number> {
  const dryRun = process.env.PLAN_PREWARM_DRY_RUN === "1";
  const cap = maxRefresh();

  // Eligible: proven + near-expiry + not already superseded by a newer row
  // for the same (tenant, class, objective). Highest-value first.
  const eligible = await pool.query(
    `SELECT c.id, c.tenant_id, c.request_class, c.objective, c.hit_count,
            round(extract(epoch FROM now() - c.created_at) / 86400) AS age_days
     FROM plan_replay_cache c
     WHERE c.hit_count >= $1
       AND c.created_at < now() - make_interval(days => $2)
       AND c.created_at > now() - make_interval(days => $3)
       AND c.objective_embedding IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM plan_replay_cache n
         WHERE n.tenant_id = c.tenant_id
           AND n.request_class = c.request_class
           AND n.objective = c.objective
           AND n.created_at > c.created_at
       )
     ORDER BY c.hit_count DESC, c.created_at ASC
     LIMIT $4`,
    [MIN_HITS, REFRESH_AFTER_DAYS, TTL_DAYS, cap],
  );

  console.log(
    `[plan-prewarm] window=day ${REFRESH_AFTER_DAYS}–${TTL_DAYS}, min_hits=${MIN_HITS}, cap=${cap} — ` +
      `${eligible.rowCount} proven near-expiry plan(s) eligible` +
      (dryRun ? " — DRY RUN, writing nothing" : ""),
  );

  let refreshed = 0;
  if (!dryRun) {
    for (const row of eligible.rows) {
      // Copy-in-SQL: embedding + plan_json never leave the DB. hit_count
      // resets to 0 so the refreshed copy must earn its next refresh.
      // Concurrency (architect finding): two overlapping runs could both pass
      // the NOT EXISTS recheck under read-committed and double-insert. Take a
      // transaction-scoped advisory lock keyed on (tenant, class, objective)
      // so the recheck+insert is serialized per cache key; the second worker
      // blocks until the first commits and then sees the newer row.
      const client = await pool.connect();
      let inserted = 0;
      try {
        await client.query("BEGIN");
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
          [`plan-prewarm:${row.tenant_id}:${row.request_class}:${row.objective}`],
        );
        const ins = await client.query(
          `INSERT INTO plan_replay_cache
             (tenant_id, request_class, objective, objective_embedding, plan_json,
              step_count, total_duration_ms, hit_count)
           SELECT tenant_id, request_class, objective, objective_embedding, plan_json,
                  step_count, total_duration_ms, 0
           FROM plan_replay_cache
           WHERE id = $1
             AND NOT EXISTS (
               SELECT 1 FROM plan_replay_cache n
               WHERE n.tenant_id = plan_replay_cache.tenant_id
                 AND n.request_class = plan_replay_cache.request_class
                 AND n.objective = plan_replay_cache.objective
                 AND n.created_at > plan_replay_cache.created_at
             )`,
          [row.id],
        );
        await client.query("COMMIT");
        inserted = ins.rowCount ?? 0;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.warn(`[plan-prewarm] refresh failed for cache_id=${row.id}: ${(err as Error).message}`);
      } finally {
        client.release();
      }
      if (inserted > 0) {
        refreshed++;
        console.log(
          `[plan-prewarm] refreshed cache_id=${row.id} tenant=${row.tenant_id} ` +
            `class=${String(row.request_class).split(":")[0]} hits=${row.hit_count} age=${row.age_days}d`,
        );
      }
    }
  }

  console.log(`[plan-prewarm] done — ${refreshed}/${eligible.rowCount} refreshed${dryRun ? " (dry run)" : ""}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[plan-prewarm] FATAL:", err?.message || err);
    process.exit(1);
  });
