/**
 * Static pins for the durable knowledge-triples admin pilot
 * (server/knowledge-graph.ts + research-engine wiring).
 *
 * Repo convention: NEVER import server modules (pg-pool hang) — parse source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const kg = readFileSync("server/knowledge-graph.ts", "utf8");
const engine = readFileSync("server/research-engine.ts", "utf8");
const schema = readFileSync("shared/schema.ts", "utf8");

test("writer is gated to the admin tenant (pilot scope)", () => {
  assert.match(kg, /tenantId !== ADMIN_TENANT_ID\) return/);
  assert.match(kg, /import \{ ADMIN_TENANT_ID \} from "\.\/tenant-constants"/);
});

test("every non-DDL SQL block is tenant-scoped", () => {
  const blocks = kg.split("sql`").slice(1).map((b) => b.split("`")[0]);
  for (const b of blocks) {
    if (/CREATE (UNIQUE )?(TABLE|INDEX)/i.test(b)) continue;
    if (/INSERT INTO/i.test(b)) {
      assert.match(b, /\$\{tenantId\}/, `INSERT missing tenantId value:\n${b}`);
      continue;
    }
    assert.match(b, /tenant_id = \$\{tenantId\}/, `SQL block missing tenant scope:\n${b}`);
  }
});

test("persistence is fire-and-forget and fail-open (logSilentCatch)", () => {
  assert.match(kg, /export function persistSessionTriples/);
  assert.ok(!/export async function persistSessionTriples/.test(kg), "persist must be sync fire-and-forget");
  assert.match(kg, /logSilentCatch\("server\/knowledge-graph\.ts", err\)/);
  assert.match(kg, /return \[\];\s*\}\s*\}/, "loadDurableTriples must fail open to []");
});

test("strict sanitizer applied at write AND render, pipe separator stripped at render", () => {
  const writeSide = kg.split("persistSessionTriples")[1].split("loadDurableTriples")[0];
  assert.match(writeSide, /sanitizeTripleField\(t\.subject/);
  const renderSide = kg.split("formatTriplesForSeeding")[1];
  assert.match(renderSide, /sanitizeTripleField/);
  assert.match(renderSide, /replace\(\/\\\|\/g, "\/"\)/, "render must strip | so stored fields can't fabricate triple boundaries");
  // sanitizeTripleField layers a conservative charset allowlist on top of
  // sanitizeUntrustedRouteText — pin both the composition and the allowlist.
  assert.match(kg, /sanitizeUntrustedRouteText\(raw, maxLen \* 2\)/);
  assert.match(kg, /replace\(\/\[\^a-zA-Z0-9 ,\.\\-_\/%\$\(\)\+#:'&\]\/g, " "\)/);
});

test("dedup is an atomic UPSERT on (tenant_id, norm_key), reinforcement refreshes created_at", () => {
  assert.match(kg, /ON CONFLICT \(tenant_id, norm_key\) DO UPDATE/);
  const conflict = kg.split("ON CONFLICT (tenant_id, norm_key) DO UPDATE")[1].slice(0, 300);
  assert.match(conflict, /seen_count = knowledge_triples\.seen_count \+ 1/);
  assert.match(conflict, /created_at = now\(\)/);
  assert.match(kg, /uq_knowledge_triples_tenant_norm/);
  assert.ok(!/SELECT id FROM knowledge_triples\s+WHERE tenant_id[\s\S]{0,200}lower\(subject\)/.test(kg), "no check-then-insert dedup");
});

test("retention: TTL delete + per-tenant row cap after persist", () => {
  assert.match(kg, /DELETE FROM knowledge_triples WHERE tenant_id = \$\{tenantId\} AND created_at < \$\{cutoff\}/);
  assert.match(kg, /id NOT IN \(\s*SELECT id FROM knowledge_triples WHERE tenant_id = \$\{tenantId\}\s*ORDER BY created_at DESC LIMIT \$\{MAX_ROWS_PER_TENANT\}/);
});

test("ensureTable bootstrap present with retry-on-failure", () => {
  assert.match(kg, /CREATE TABLE IF NOT EXISTS knowledge_triples/);
  assert.match(kg, /_tableEnsured = null/);
});

test("producer wired at session end, consumer seeds at session start (both fail-open)", () => {
  assert.match(engine, /persistSessionTriples\(\{/);
  assert.match(engine, /loadDurableTriples\(session\.objective, session\.tenantId\)/);
  // Both wrapped in dynamic import with a swallow — never block the session.
  const producers = engine.split('import("./knowledge-graph")');
  assert.equal(producers.length, 3, "exactly two wiring points import knowledge-graph");
  for (const after of producers.slice(1)) {
    assert.match(after.slice(0, 800), /\.catch\(\(\) => \{\}\)/);
  }
  // Seeding guards against session teardown race.
  assert.match(engine, /activeSessions\.get\(sessionId\) === session/);
});

test("schema table declared with NOT NULL tenant + tenant index", () => {
  assert.match(schema, /knowledgeTriples = pgTable\("knowledge_triples"/);
  const block = schema.split('pgTable("knowledge_triples"')[1].split("export type")[0];
  assert.match(block, /tenantId: integer\("tenant_id"\)\.notNull\(\)/);
  assert.match(block, /idx_knowledge_triples_tenant/);
});
