/**
 * R120.1+sec — AHB invariant: every active persona MUST declare a non-empty
 * `safety_profile` with both `intentGate` and a non-empty `restrictedCategories[]`.
 *
 * Why: server/safety/intent-gate.ts:154 defaults mode to "off" and bypasses
 * entirely when `restrictedCategories` is empty. A persona seeded with `{}`
 * receives ZERO AHB intent-gate screening — adversarially-styled requests
 * are passed through to whatever destructive tools the persona's allowlist
 * contains. Architect found 10 of 16 active personas in this state during
 * the R120 round-2 whole-app sweep; backfill migration
 * `scripts/migrations/R120.1-persona-safety-profile-backfill.sql` closed
 * the gap. This test prevents the regression.
 *
 * The test is intentionally a SQL-level check, not a code-level one, because
 * the enforcement layer reads from the live DB row, not the seed file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

test("R120.1+sec — every active persona has intentGate + non-empty restrictedCategories", async () => {
  if (!process.env.DATABASE_URL) {
    console.warn("[ahb-coverage-test] DATABASE_URL missing — skipping");
    return;
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await pool.query(
      `SELECT id, name, role,
              safety_profile->>'intentGate' AS gate,
              jsonb_array_length(COALESCE(safety_profile->'restrictedCategories', '[]'::jsonb)) AS cat_count
         FROM personas
        WHERE is_active = true
        ORDER BY id`,
    );
    const bad: string[] = [];
    for (const row of r.rows) {
      const gate = row.gate as string | null;
      const catCount = Number(row.cat_count ?? 0);
      if (!gate || !["strict", "moderate"].includes(gate)) {
        bad.push(
          `#${row.id} ${row.name} (${row.role}) — intentGate=${JSON.stringify(gate)} (must be "strict" or "moderate")`,
        );
        continue;
      }
      if (catCount === 0) {
        bad.push(
          `#${row.id} ${row.name} (${row.role}) — restrictedCategories is empty (intent gate would bypass)`,
        );
      }
    }
    assert.equal(
      bad.length,
      0,
      `AHB safety_profile coverage gap on ${bad.length} active persona(s):\n  ${bad.join("\n  ")}`,
    );
    assert.ok(
      r.rows.length >= 16,
      `expected at least 16 active personas, got ${r.rows.length}`,
    );
  } finally {
    await pool.end();
  }
});
