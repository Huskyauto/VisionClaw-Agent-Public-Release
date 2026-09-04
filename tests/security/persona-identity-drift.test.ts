/**
 * Task 112 — Persona identity drift detection.
 *
 * Persona identities live in TWO source files with different sync rules:
 *   - Personas 1–16: PERSONA_DOCS in server/seed-persona-prompts.ts.
 *     A direct run of that file OVERWRITES the DB — so a DB-only edit is
 *     silently wiped on the next sync, and a source edit that never ran
 *     leaves the DB stale.
 *   - Personas 17+: DEFAULT_PERSONAS in server/seed.ts (insert-only
 *     reconcile — DB edits persist but must be mirrored back into seed.ts
 *     for forks + the public-mirror doc extractor).
 *
 * Nothing else alarms when the live DB identity and its source-of-truth
 * literal diverge (2026-08-01: Robert's DB role was stale and the capability
 * registry was 3 personas behind — Echo/Hermes/Robert missing). This test
 * fails loudly on any divergence, in BOTH directions, and asserts
 * capability-registry agent parity. The comparison itself is pure and lives
 * in server/lib/persona-drift.ts; fixture-based unit tests below pin each
 * drift class without a DB.
 *
 * Mechanics: the SoT literals are read via scripts/persona-identity-snapshot.ts
 * run in a SUBPROCESS, because the import chain (seed-persona-prompts →
 * persona-sync → server/tools) is too heavy/side-effectful to import inside a
 * node:test process (pg-pool hang, module side effects). DB rows are read via
 * a plain pg Pool that is always ended (same pattern as
 * persona-safety-profile-coverage.test.ts). No LLM calls anywhere.
 *
 * Resolving a real failure:
 *   - If the SOURCE is the intended truth (ids 1–16): run
 *     `npx tsx server/seed-persona-prompts.ts` (overwrites DB identity/soul/
 *     operating_loop for ids 1–16 and then delegates tools_doc to
 *     persona-sync, the single canonical writer — check the diff first!).
 *   - If the DB is the intended truth: copy the DB value back into the
 *     source literal (PERSONA_DOCS for 1–16, DEFAULT_PERSONAS for 17+).
 *   - If a persona is intentionally DB-only, add it to DB_ONLY_ALLOWLIST
 *     below with a dated comment explaining why.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import {
  computePersonaDriftProblems,
  type PersonaSotSnapshot,
  type DbPersonaRow,
} from "../../server/lib/persona-drift";

/**
 * Personas whose identity intentionally lives ONLY in the DB (in neither
 * source file). Keyed by persona name. Add entries with a dated reason.
 * Historical example: Robert (id 16) was DB-only until he gained a
 * PERSONA_DOCS entry — today the list is empty by design.
 */
const DB_ONLY_ALLOWLIST: Record<string, string> = {
  // "Example": "2026-08-01 — reason this persona has no SoT literal",
};

function loadSotSnapshot(): PersonaSotSnapshot {
  const script = path.join(process.cwd(), "scripts", "persona-identity-snapshot.ts");
  const r = spawnSync("npx", ["tsx", script], {
    encoding: "utf8",
    // Must stay well under the 60s-per-file harness limit in tests/run.sh —
    // a slower snapshot should fail HERE with a clear message, not as an
    // opaque suite-level timeout.
    timeout: 45_000,
    maxBuffer: 64 * 1024 * 1024,
    cwd: process.cwd(),
  });
  // Fail CLOSED: a snapshot that can't be produced means the drift check
  // cannot run — that is a failure, never a silent pass.
  assert.equal(
    r.status,
    0,
    `persona-identity-snapshot.ts failed (status=${r.status}, signal=${r.signal}):\n${(r.stderr || "").slice(-2000)}`,
  );
  // The payload is written to a FILE (Task 113 made it ~180KB and large
  // stdout payloads truncate through the npx→tsx pipe chain at exit);
  // stdout only carries the file path between the markers.
  const out = r.stdout || "";
  const begin = out.indexOf("SNAPSHOT_FILE_BEGIN");
  const end = out.indexOf("SNAPSHOT_FILE_END");
  assert.ok(
    begin >= 0 && end > begin,
    `snapshot markers missing from output (stdout len=${out.length}).\n` +
      `stdout head: ${out.slice(0, 500)}\n` +
      `stderr tail: ${(r.stderr || "").slice(-1000)}`,
  );
  const snapFile = out.slice(begin + "SNAPSHOT_FILE_BEGIN".length, end).trim();
  let snap: PersonaSotSnapshot;
  try {
    snap = JSON.parse(readFileSync(snapFile, "utf8")) as PersonaSotSnapshot;
  } finally {
    try {
      unlinkSync(snapFile);
    } catch {
      // best-effort temp-file cleanup only — never mask the real outcome
    }
  }
  assert.ok(Object.keys(snap.personaDocs).length >= 16, "PERSONA_DOCS unexpectedly small");
  assert.ok(snap.defaultPersonas.length > 0, "DEFAULT_PERSONAS unexpectedly empty");
  assert.ok(snap.capabilityAgents.length > 0, "capability-registry agent list unexpectedly empty");
  return snap;
}

// ---------------------------------------------------------------------------
// Fixture-based unit tests — pin each drift class the pure comparison must
// catch, no DB required.
// ---------------------------------------------------------------------------

const FIXTURE_SNAP: PersonaSotSnapshot = {
  personaDocs: {
    "1": {
      identity: "id-1",
      soul: "soul-1",
      operatingLoop: "loop-1-composed",
      // Task 115 — tools_doc has ONE canonical writer (persona-sync's
      // composeSyncToolsDoc); the DB row must match its recomputed output.
      expectedToolsDoc: "tools-1-sync-composed",
    },
  },
  defaultPersonas: [
    { name: "Alpha", role: "Role A", isActive: true, identity: "id-a", soul: "soul-a" },
  ],
  capabilityAgents: ["One", "Alpha"],
};

const FIXTURE_ROWS: DbPersonaRow[] = [
  { id: 1, name: "One", role: "whatever", identity: "id-1", soul: "soul-1", operatingLoop: "loop-1-composed", toolsDoc: "tools-1-sync-composed" },
  { id: 17, name: "Alpha", role: "Role A", identity: "id-a", soul: "soul-a", operatingLoop: "loop-a", toolsDoc: "tools-a" },
];

test("fixture: fully in-sync snapshot produces zero problems", () => {
  assert.deepEqual(computePersonaDriftProblems(FIXTURE_SNAP, FIXTURE_ROWS), []);
});

test("fixture: an unseeded active DEFAULT_PERSONAS entry FAILS the gate (source→DB direction)", () => {
  const snap: PersonaSotSnapshot = {
    ...FIXTURE_SNAP,
    defaultPersonas: [
      ...FIXTURE_SNAP.defaultPersonas,
      { name: "Ghost", role: "Never Seeded", isActive: true, identity: "id-g", soul: "soul-g" },
    ],
  };
  const problems = computePersonaDriftProblems(snap, FIXTURE_ROWS);
  assert.ok(
    problems.some((p) => p.includes(`DEFAULT_PERSONAS["Ghost"]`) && p.includes("never seeded")),
    `expected an unseeded-source-persona problem, got: ${JSON.stringify(problems)}`,
  );
  // ...but an allowlisted one passes.
  assert.deepEqual(
    computePersonaDriftProblems(snap, FIXTURE_ROWS, { Ghost: "test reason" }),
    [],
  );
  // ...and an isActive:false source entry (historic 1–16 literal) is exempt.
  const inactive = {
    ...snap,
    defaultPersonas: snap.defaultPersonas.map((p) =>
      p.name === "Ghost" ? { ...p, isActive: false } : p,
    ),
  };
  assert.deepEqual(computePersonaDriftProblems(inactive, FIXTURE_ROWS), []);
});

test("fixture: DB-vs-source field drift is reported in every direction", () => {
  // 1–16 identity/soul drift (PERSONA_DOCS).
  let problems = computePersonaDriftProblems(FIXTURE_SNAP, [
    { ...FIXTURE_ROWS[0], soul: "edited-live" },
    FIXTURE_ROWS[1],
  ]);
  assert.ok(problems.some((p) => p.includes("#1 One: soul drift")));

  // Task 113 — 1–16 operating_loop drift (composed field, still
  // overwrite-on-sync: a live DB edit is wiped by the next seed run).
  problems = computePersonaDriftProblems(FIXTURE_SNAP, [
    { ...FIXTURE_ROWS[0], operatingLoop: "loop-1-composed + live DB edit" },
    FIXTURE_ROWS[1],
  ]);
  assert.ok(problems.some((p) => p.includes("#1 One: operating_loop drift")));

  // ...but a 17+ operating_loop difference is NOT flagged (not compared —
  // DEFAULT_PERSONAS loops are insert-only and persona-sync owns them).
  problems = computePersonaDriftProblems(FIXTURE_SNAP, [
    FIXTURE_ROWS[0],
    { ...FIXTURE_ROWS[1], operatingLoop: "edited-live" },
  ]);
  assert.deepEqual(problems, []);

  // Task 115 — 1–16 tools_doc drift. tools_doc has ONE canonical writer
  // (persona-sync's composeSyncToolsDoc — the seed runner delegates to it);
  // the DB value must match the recomputed composition exactly. Any other
  // value = a live DB edit the next sync silently wipes.
  problems = computePersonaDriftProblems(FIXTURE_SNAP, [
    { ...FIXTURE_ROWS[0], toolsDoc: "tools-1-sync-composed + live DB edit" },
    FIXTURE_ROWS[1],
  ]);
  assert.ok(problems.some((p) => p.includes("#1 One: tools_doc drift")));

  // ...the OLD seed writer's composition no longer passes — single-writer
  // contract (Task 115): only the sync composition is legitimate.
  problems = computePersonaDriftProblems(FIXTURE_SNAP, [
    { ...FIXTURE_ROWS[0], toolsDoc: "tools-1-seed-composed" },
    FIXTURE_ROWS[1],
  ]);
  assert.ok(problems.some((p) => p.includes("#1 One: tools_doc drift")));

  // ...a NULL expected value fails CLOSED (unverifiable ≠ pass).
  problems = computePersonaDriftProblems(
    {
      ...FIXTURE_SNAP,
      personaDocs: {
        "1": { ...FIXTURE_SNAP.personaDocs["1"], expectedToolsDoc: null },
      },
    },
    FIXTURE_ROWS,
  );
  assert.ok(problems.some((p) => p.includes("#1 One: tools_doc drift check could not run")));

  // ...but a 17+ tools_doc difference is NOT flagged (persona-sync owns
  // 17+ tools_doc rebuilds; there is no PERSONA_DOCS composition to pin).
  problems = computePersonaDriftProblems(FIXTURE_SNAP, [
    FIXTURE_ROWS[0],
    { ...FIXTURE_ROWS[1], toolsDoc: "edited-live" },
  ]);
  assert.deepEqual(problems, []);

  // 17+ identity/role drift (DEFAULT_PERSONAS).
  problems = computePersonaDriftProblems(FIXTURE_SNAP, [
    FIXTURE_ROWS[0],
    { ...FIXTURE_ROWS[1], role: "Renamed In DB" },
  ]);
  assert.ok(problems.some((p) => p.includes("#17 Alpha: role drift")));

  // Orphaned PERSONA_DOCS entry (source→DB).
  problems = computePersonaDriftProblems(
    { ...FIXTURE_SNAP, personaDocs: { ...FIXTURE_SNAP.personaDocs, "2": { identity: "x", soul: "y", operatingLoop: "z", expectedToolsDoc: "t" } } },
    FIXTURE_ROWS,
  );
  assert.ok(problems.some((p) => p.includes("PERSONA_DOCS[2]")));

  // Active DB persona missing from both SoT files.
  problems = computePersonaDriftProblems(FIXTURE_SNAP, [
    ...FIXTURE_ROWS,
    { id: 18, name: "Rogue", role: "r", identity: "i", soul: "s", operatingLoop: "l", toolsDoc: "t" },
  ]);
  assert.ok(problems.some((p) => p.includes("#18 Rogue") && p.includes("missing from DEFAULT_PERSONAS")));

  // Capability-registry gaps, both directions.
  problems = computePersonaDriftProblems(
    { ...FIXTURE_SNAP, capabilityAgents: ["One"] },
    FIXTURE_ROWS,
  );
  assert.ok(problems.some((p) => p.includes(`missing agent entry for active persona "Alpha"`)));
  problems = computePersonaDriftProblems(
    { ...FIXTURE_SNAP, capabilityAgents: ["One", "Alpha", "Phantom"] },
    FIXTURE_ROWS,
  );
  assert.ok(problems.some((p) => p.includes(`agent "Phantom"`)));
});

// ---------------------------------------------------------------------------
// Live check — real SoT literals (subprocess snapshot) vs the live DB.
// ---------------------------------------------------------------------------

test("Task 112 — persona identity drift: DB matches SoT literals; capability registry matches personas table", async () => {
  if (!process.env.DATABASE_URL) {
    console.warn("[persona-identity-drift] DATABASE_URL missing — skipping");
    return;
  }

  const snap = loadSotSnapshot();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Bound DB access below the harness per-file limit so a slow/hung DB
    // surfaces as a controlled failure, not a suite timeout.
    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
  });
  let rows: DbPersonaRow[];
  try {
    const r = await pool.query(
      `SELECT id, name, role, identity, soul, operating_loop AS "operatingLoop", tools_doc AS "toolsDoc" FROM personas WHERE is_active = true ORDER BY id`,
    );
    rows = r.rows as DbPersonaRow[];
  } finally {
    await pool.end();
  }
  assert.ok(rows.length >= 16, `expected at least 16 active personas, got ${rows.length}`);

  const problems = computePersonaDriftProblems(snap, rows, DB_ONLY_ALLOWLIST);
  assert.equal(
    problems.length,
    0,
    `Persona identity drift detected (${problems.length} problem(s)):\n  ${problems.join("\n  ")}\n` +
      `See the resolution guide at the top of tests/security/persona-identity-drift.test.ts.`,
  );
});
