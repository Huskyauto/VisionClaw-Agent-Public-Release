/**
 * R79.3 — SQL-injection regression guard for drizzle-orm CVE GHSA-gpj5-g38j-94v9.
 *
 * Background: as of May 2026 we are pinned at drizzle-orm@^0.39.3 while the CVE
 * fix is at 0.45.2 (`isSemVerMajor: true`, 6 minor versions of breaking changes
 * across our 146 import sites). The CVE only fires when user-controlled input
 * flows through `sql.identifier()` or `sql.raw()` as a TABLE/COLUMN identifier
 * (NOT as a value — values are always parameterized).
 *
 * On 2026-05-02 we audited every `sql.raw` and `sql.identifier` callsite in the
 * server and confirmed every argument is one of:
 *   - a hardcoded string literal (e.g. "active_tasks", "queue", DDL bodies)
 *   - a value from a compile-time-fixed allowlist (e.g. felix-verify column
 *     filterables, business-tools updateMap keys, wiring-invariants spec.table)
 *   - a numeric type rendered to string (Map<number> keys, sha1 BigInt locks,
 *     pre-bounded integer constants like INTERVAL '${N} hours')
 *
 * Therefore our actual exposure to the CVE is zero, and we deferred the major
 * bump to a future planned migration round. To prevent that audit conclusion
 * from bit-rotting, this test pins the exact callsite TEXT per file (R79.3b
 * upgrade — was count-only, but architect review correctly flagged that a dev
 * could change the argument of an existing safe callsite without changing the
 * count). Now the trimmed text of every line containing `sql.raw\b` or
 * `sql.identifier\b` is snapshotted; any change forces a code review.
 *
 * Process when this test fails:
 *   1. Read the diff in the assertion failure carefully.
 *   2. For each NEW or CHANGED callsite, verify the argument expression is a
 *      string literal, whitelisted identifier, or numeric type (NEVER user input).
 *   3. Update SQL_RAW_BASELINE / SQL_IDENTIFIER_BASELINE below to match.
 *   4. If the new callsite takes a user-controlled string identifier, DO NOT
 *      land it — either rewrite to use a whitelist, or finally do the
 *      drizzle-orm@^0.45 major bump.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

type CallsiteMap = Record<string, Array<{ line: number; text: string }>>;

// R79.3e — JS-native walker (was: shelled out to ripgrep). The shell version
// silently returned `{}` on environments without `rg` on PATH (e.g. some CI
// runner images), causing snapshot diffs that failed the hard-gate without
// any actual code change. Pure-Node fs walk is deterministic across local
// and CI and has no shell dependencies.
function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTsFiles(p, out);
    else if (entry.isFile() && /\.(c|m)?tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

function findCallsites(pattern: RegExp): CallsiteMap {
  const map: CallsiteMap = {};
  for (const file of walkTsFiles("server")) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      if (pattern.test(text)) {
        if (!map[file]) map[file] = [];
        map[file].push({ line: i + 1, text: text.trim() });
      }
    });
  }
  for (const f of Object.keys(map)) {
    map[f].sort((a, b) => a.line - b.line);
  }
  return map;
}

// Note: the snapshot includes BOTH active callsites and any safety-comment
// mentions of `sql.raw(` or `sql.identifier(` (e.g., R79.3 comment blocks
// that reference these tokens to explain the audit). That's intentional —
// if anyone deletes a safety comment the snapshot fails, forcing a re-audit.
//
// Schema: { "<file>": [ { line: <N>, text: "<trimmed-line>" }, ... ] }
// R115 +sec — baseline refreshed (CI Self-Healer flagged drift). Diff vs prior:
//   NEW comment-only files: server/job-queue.ts (audit comment),
//     server/lib/paper-ingest.ts (audit comment) — both informational,
//     no live sql.raw call.
//   CHANGED: server/process-governor.ts — the active sql.raw(protectedPersonas
//     .join(",")) query was REMOVED in R113.3+sec and replaced with
//     parameterized int[] (architect HIGH closed). Remaining 3 entries are
//     comment-only.
//   Line shifts in embeddings.ts, persona-sync.ts, plan-executor.ts,
//     routes/projects.ts, seed.ts, tools.ts, wiring-invariants.ts — text
//     unchanged, line numbers re-baselined. (Test compares text-only; line
//     numbers are informational, but we keep them current for grep-ability.)
// Every entry audited: string-literal / whitelisted-identifier / numeric
// type only. No user input reaches sql.raw in any active callsite.
const SQL_RAW_BASELINE: CallsiteMap = {
  "server/agent-desk.ts": [
    { line: 377, text: "// it into sql.raw() (drizzle@0.39 bypasses identifier escaping — fixed in" },
    { line: 392, text: "UPDATE agent_desks SET ${sql.raw(field)} = ${jsonVal}::jsonb, updated_at = NOW(), last_active_at = NOW()" },
  ],
  "server/business-tools.ts": [
    { line: 236, text: "// injection vector via sql.raw(key). Enforce the allowlist explicitly so" },
    { line: 250, text: "query = sql`${query}, ${sql.raw(key)} = ${val}`;" },
  ],
  // R125+3.4 +sec — comment-only mention of sql.raw in a doc string explaining
  // why this module does NOT use sql.raw. No executable callsite. Walker picks
  // it up because the regex matches the substring.
  "server/db.ts": [
    { line: 55, text: "// we cast the integer to text inside SQL). No sql.raw, no string" },
  ],
  "server/embeddings.ts": [
    { line: 180, text: "await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_memory_embedding_vec ON memory_entries USING hnsw (embedding_vec vector_cosine_ops)`));" },
    { line: 181, text: "await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_knowledge_embedding_vec ON agent_knowledge USING hnsw (embedding_vec vector_cosine_ops)`));" },
    // R125+13.17+sec — new audit comment added; informational only, no active callsite.
    { line: 199, text: "// interpolating into sql.raw(). Defends against a poisoned provider" },
    { line: 244, text: "1 - (embedding_vec <=> ${sql.raw(`'${vec}'::vector`)}) AS similarity" },
    { line: 252, text: "ORDER BY embedding_vec <=> ${sql.raw(`'${vec}'::vector`)}" },
    { line: 555, text: "1 - (embedding_vec <=> ${sql.raw(`'${vec}'::vector`)}) AS similarity" },
    { line: 561, text: "ORDER BY embedding_vec <=> ${sql.raw(`'${vec}'::vector`)}" },
    { line: 666, text: "// compile time but the runtime sees a plain string sunk into sql.raw()." },
    { line: 680, text: "await db.execute(sql`UPDATE ${sql.raw(table)} SET embedding_vec = ${sql.raw(`'${vec}'::vector`)}, embedding = ${JSON.stringify(embedding)}::jsonb WHERE id = ${id}`);" },
    { line: 722, text: "await db.execute(sql`UPDATE memory_entries SET embedding_vec = ${sql.raw(`'${vec}'::vector`)} WHERE id = ${row.id}`);" },
    { line: 739, text: "await db.execute(sql`UPDATE agent_knowledge SET embedding_vec = ${sql.raw(`'${vec}'::vector`)} WHERE id = ${row.id}`);" },
  ],
  "server/felix-verify.ts": [
    { line: 14, text: "// flow through parameterized queries — never sql.raw on LLM output." },
    { line: 16, text: "// Bob preference: never sql.raw user input (LLM output qualifies)." },
  ],
  "server/job-queue.ts": [
    { line: 328, text: "// Build exclusion clause as a parameterized array (NEVER sql.raw with user input)." },
  ],
  "server/knowledge-diversity-monitor.ts": [
    { line: 189, text: "AND snapshot_at > NOW() - INTERVAL '${sql.raw(String(PER_TENANT_PERSONA_COOLDOWN_HOURS))} hours'" },
    { line: 195, text: "AND snapshot_at > NOW() - INTERVAL '${sql.raw(String(PER_TENANT_PERSONA_COOLDOWN_HOURS))} hours'" },
  ],
  "server/lib/paper-ingest.ts": [
    { line: 457, text: "// user input, no sql.raw. Pattern mirrors replit.md `text[]` guidance." },
  ],
  // R98.24 — Two-channel reputation tensor. Column name comes from a
  // hardcoded record (action_alpha | action_beta | restraint_alpha |
  // restraint_beta) and is re-checked against an explicit allowlist before
  // the sql.raw call; delta is a validated finite number 0<delta<=100.
  "server/lib/restraint-trust.ts": [
    { line: 85, text: "// validated finite number, so sql.raw is safe here. (M1 in the deferred" },
    { line: 90, text: "SET ${sql.raw(column)} = ${sql.raw(column)} + ${delta}," },
  ],
  // R125+3.4 +sec — comment-only mention of sql.raw documenting the safe-by-
  // construction invariant of unified-context. No executable callsite.
  "server/memory/unified-context.ts": [
    { line: 120, text: "// No sql.raw, no template-interpolated identifiers, no template-interpolated" },
  ],
  "server/orchestrator-ledger.ts": [
    { line: 442, text: "await tx.execute(sql`SELECT pg_advisory_xact_lock(${sql.raw(lockKey)}::bigint)`);" },
  ],
  "server/persona-sync.ts": [
    { line: 379, text: "- All verifier SQL is parameterized + table-whitelisted in server/felix-verify.ts — LLM output never reaches sql.raw." },
  ],
  // R125+14+sec4 — plan-executor.ts STALE_EXECUTING_MIN callsite was rewritten
  // to a fully-parameterized numeric multiply (`(${STALE_EXECUTING_MIN} * INTERVAL
  // '1 minute')`), dropping its sql.raw() entirely. A removal is strictly safer
  // (one fewer raw callsite), so the stale baseline entry is deleted here.
  "server/process-governor.ts": [
    { line: 676, text: "// R113.3+sec — replace sql.raw with parameterized int[] (architect HIGH" },
    { line: 891, text: "// raw value into sql.raw() (was doing INTERVAL 'N months' via raw)." },
    { line: 989, text: "// Previously these queries used `sql.raw(check.query)` against global tables" },
  ],
  // R125+13.16+sec — the active sql.raw(Array.from(activeSessions.keys())...)
  // call here was REPLACED with a parameterized int[] (architect HIGH closed).
  // Only the audit comment referencing the prior pattern remains.
  "server/research-engine.ts": [
    { line: 145, text: "// R125+13.16+sec — architect HIGH-1: drop sql.raw() on Map keys (loaded-gun" },
  ],
  "server/routes/projects.ts": [
    { line: 155, text: "const result = await db.execute(sql.join(chunks, sql.raw(\"\")));" },
  ],
  "server/seed.ts": [
    { line: 4408, text: "await db.execute(sql.raw(ddl));" },
  ],
  "server/stability-watchdog.ts": [
    { line: 261, text: "WHERE created_at < NOW() - INTERVAL '${sql.raw(String(MAX_HEARTBEAT_LOG_AGE_HOURS))} hours'" },
  ],
  "server/tools.ts": [
    { line: 6678, text: "await db.execute(sql.join(chunks, sql.raw(\"\")));" },
  ],
  "server/wiring-invariants.ts": [
    { line: 361, text: "const existsResult = await db.execute(sql.raw(" },
    { line: 366, text: "const result = await db.execute(sql.raw(" },
    { line: 535, text: "const r = await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt, pg_total_relation_size('${tbl.name}') AS bytes FROM ${tbl.name}`));" },
  ],
};

const SQL_IDENTIFIER_BASELINE: CallsiteMap = {
  "server/felix-verify.ts": [
    { line: 180, text: "// safely bind values; sql.identifier for the table name and column" },
    { line: 185, text: "// col is whitelisted in entry.filterable; sql.identifier guards it" },
    { line: 186, text: "whereSql = sql`${whereSql} AND ${sql.identifier(col)} = ${val as any}`;" },
    { line: 191, text: "whereSql = sql`${whereSql} AND ${sql.identifier(column)} ILIKE ${\"%\" + substring + \"%\"}`;" },
    { line: 193, text: "const tableIdent = sql.identifier(table);" },
  ],
  // R98.24 — comment-only mention; the actual dynamic column path uses
  // sql.raw with an explicit allowlist (see SQL_RAW_BASELINE above).
  "server/lib/restraint-trust.ts": [
    { line: 69, text: "// in depth: tag the dynamic identifier through sql.identifier-style raw" },
  ],
};

// R95.c.fix — Text-only comparison. Earlier rounds (R79.3b) snapshotted
// {line, text} per callsite, which made the test fail on every line-shift —
// any unrelated edit to a long file (e.g. server/tools.ts is 14k lines)
// would re-trigger CI failure emails. The CVE guard only cares about the
// CONTENT of each sql.raw / sql.identifier call, not its line number.
// We compare the multiset of trimmed texts per file; line shifts are
// invisible, but adding/removing/changing a callsite still fails the test.
function textsOnly(map: CallsiteMap): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of Object.keys(map)) out[f] = map[f].map(e => e.text).sort();
  return out;
}

test("sql.raw callsites match the audited content snapshot (drizzle CVE guard)", () => {
  const actual = findCallsites(/sql\.raw\b/);
  assert.deepEqual(
    textsOnly(actual),
    textsOnly(SQL_RAW_BASELINE),
    "sql.raw callsite TEXT changed from the audited R79.3 snapshot. " +
      "Inspect every new/changed callsite — verify the argument is a string " +
      "literal, whitelisted identifier, or numeric type (NEVER user input). " +
      "Then update SQL_RAW_BASELINE in this test file with the new text " +
      "entries. (Line numbers are informational only; line shifts no longer " +
      "fail this test — only content changes do.)"
  );
});

test("sql.identifier callsites match the audited content snapshot (drizzle CVE guard)", () => {
  const actual = findCallsites(/sql\.identifier\b/);
  assert.deepEqual(
    textsOnly(actual),
    textsOnly(SQL_IDENTIFIER_BASELINE),
    "sql.identifier callsite TEXT changed from the audited R79.3 snapshot. " +
      "All such callsites currently use whitelisted column/table names from " +
      "felix-verify.ts entry.filterable. Inspect each new/changed callsite " +
      "for tainted input then update SQL_IDENTIFIER_BASELINE. " +
      "(Line numbers are informational only.)"
  );
});
