import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  isPlatformManagedKnowledgeSource,
  isReservedKnowledgeCategory,
  PLATFORM_MANAGED_KNOWLEDGE_SOURCES,
} from "../../server/lib/reserved-knowledge-categories";

const root = join(import.meta.dirname, "..", "..");
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("agent_skill is reserved from tenant-facing knowledge creation", () => {
  assert.equal(isReservedKnowledgeCategory("agent_skill"), true);
});

test("only server-owned sources can identify platform-managed knowledge", () => {
  for (const source of ["agent_skill", "output_skill", "release_log", "loop_contract", "platform_briefing", "knowledge_compile"]) {
    assert.ok(PLATFORM_MANAGED_KNOWLEDGE_SOURCES.has(source));
    assert.equal(isPlatformManagedKnowledgeSource(source), true);
  }
  assert.equal(isPlatformManagedKnowledgeSource("user"), false);
  assert.equal(isPlatformManagedKnowledgeSource("file-upload"), false);
});

test("storage rejects forged platform provenance and protects replicated catalog rows", () => {
  const storage = read("server/storage.ts");

  const create = storage.slice(storage.indexOf("async createKnowledge("), storage.indexOf("async updateKnowledge("));
  const update = storage.slice(storage.indexOf("async updateKnowledge("), storage.indexOf("async deleteKnowledge("));
  const remove = storage.slice(storage.indexOf("async deleteKnowledge("), storage.indexOf("// ─── Embeddings"));

  assert.match(create, /isPlatformManagedKnowledgeSource\(data\?\.source\)/);
  assert.match(update, /isPlatformManagedKnowledgeSource\(existing\.source\)/);
  assert.match(update, /isPlatformManagedKnowledgeSource\(data\.source\)/);
  assert.match(remove, /isPlatformManagedKnowledgeSource\(existing\.source\)/);
  assert.match(storage, /allowPlatformManagedKnowledge/);
});

test("refresh invalidates changed platform knowledge embeddings for requeue", () => {
  const refresh = read("scripts/agent-knowledge-refresh.ts");
  const indexables = refresh.slice(
    refresh.indexOf("async function upsertIndexables("),
    refresh.indexOf("async function upsertBriefs("),
  );
  const briefings = refresh.slice(
    refresh.indexOf("async function upsertBriefs("),
    refresh.indexOf("async function main()"),
  );

  for (const writer of [indexables, briefings]) {
    assert.match(writer, /SELECT id, content FROM agent_knowledge/);
    assert.match(writer, /contentChanged[\s\S]{0,500}embedding_vec = NULL/);
    assert.match(writer, /contentChanged[\s\S]{0,500}embedding = NULL/);
  }
});

test("catalog reads require an explicit tenant scope", () => {
  const storage = read("server/storage.ts");
  const signature = storage.slice(storage.indexOf("getKnowledge(personaId"), storage.indexOf("createKnowledge(data"));
  const implementation = storage.slice(storage.indexOf("async getKnowledge("), storage.indexOf("async createKnowledge("));

  assert.doesNotMatch(signature, /tenantId\?:/);
  assert.match(signature, /tenantId:\s*TenantScope/);
  assert.match(implementation, /requiredTenantScope\(agentKnowledge\.tenantId,\s*tenantId\)/);
});

test("catalog embedding writes compare the content they were generated from", () => {
  const embeddings = read("server/embeddings.ts");
  const refresh = read("scripts/agent-knowledge-refresh.ts");

  assert.match(embeddings, /expectedKnowledgeContent/);
  assert.match(embeddings, /LEFT\(title \|\| ' ' \|\| content,\s*6000\) = \$\{expectedKnowledgeContent\}/);
  assert.match(refresh, /storeEmbeddingVec\("agent_knowledge", row\.id, emb, \{ expectedKnowledgeContent: text \}\)/);
});