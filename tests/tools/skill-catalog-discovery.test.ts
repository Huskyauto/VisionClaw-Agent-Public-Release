import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("every persona gets exact, provenance-gated operational skill discovery", () => {
  const source = read("server/persona-sync.ts");

  assert.match(source, /search_knowledge\(\{query:"skill:<slug>"\}\)/);
  assert.match(source, /category.*agent_skill.*source.*agent_skill/i);
  assert.match(source, /does not grant tool access or\s+override tenant, approval, safety, payment, or customer-delivery controls/i);
  assert.doesNotMatch(source, /then hand payment-provider questions to `monetization`/);
});

test("search_knowledge exposes persisted provenance on semantic and keyword results", () => {
  const handler = read("server/tools/domains/knowledge/handlers.ts");
  const embeddings = read("server/embeddings.ts");

  assert.match(handler, /source:\s*item\.source/);
  assert.match(embeddings, /SELECT id, title, content, category,\s*source,\s*priority,\s*access_count,/s);
  assert.match(embeddings, /source:\s*r\.source as string/);
  assert.match(embeddings, /source:\s*k\.source/);
});

test("the vetted agent-skill catalog is replicated only to active tenant scopes", () => {
  const source = read("scripts/agent-knowledge-refresh.ts");

  assert.match(source, /SELECT id FROM tenants WHERE is_active = true/);
  assert.match(source, /upsertIndexables\(aSkills,\s*"agent_skill",\s*activeTenantIds\)/);
  assert.match(source, /tenant_id = \$\{tenantId\}/);
  assert.match(source, /const activeTenantSql = sql\.join\(activeTenantIds\.map\(\(tenantId\) => sql`\$\{tenantId\}`\), sql`, `\)/);
  assert.match(source, /tenant_id IN \(\$\{activeTenantSql\}\)/);
  assert.match(source, /source IN \('release_log', 'agent_skill', 'output_skill', 'loop_contract', 'platform_briefing', 'knowledge_compile'\)/);
});